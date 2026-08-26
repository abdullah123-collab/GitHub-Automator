const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let persistentPythonProcess = null;
let messageIdCounter = 0;
let spawnCallCount = 0;
const pendingRequests = new Map();

let detectedPythonCommandPromise = null;

function detectPythonAsync() {
  if (detectedPythonCommandPromise) return detectedPythonCommandPromise;

  detectedPythonCommandPromise = (async () => {
    const candidates = process.platform === 'win32'
      ? [['py', '-3'], ['python'], ['python3']]
      : [['python3'], ['python']];

    const { spawn } = require('child_process');

    const checkCandidate = (candidate) => {
      return new Promise((resolve) => {
        try {
          const cp = spawn(candidate[0], candidate.slice(1).concat(['--version']), {
            stdio: ['ignore', 'pipe', 'pipe'],
            windowsHide: true
          });
          
          let resolved = false;
          cp.on('error', () => {
            if (!resolved) {
              resolved = true;
              resolve(false);
            }
          });
          
          cp.on('close', (code) => {
            if (!resolved) {
              resolved = true;
              resolve(code === 0);
            }
          });
          
          // Safety timeout in case the process hangs (e.g. Windows Store stub)
          setTimeout(() => {
            if (!resolved) {
              resolved = true;
              try { cp.kill(); } catch (e) {}
              resolve(false);
            }
          }, 1500);
        } catch (e) {
          resolve(false);
        }
      });
    };

    for (const candidate of candidates) {
      const ok = await checkCandidate(candidate);
      if (ok) {
        return candidate;
      }
    }

    return ['python'];
  })();

  return detectedPythonCommandPromise;
}

let persistentPythonProcessPromise = null;

function getPersistentPythonProcess(backendRoot) {
  if (persistentPythonProcessPromise) return persistentPythonProcessPromise;

  persistentPythonProcessPromise = (async () => {
    spawnCallCount++;
    console.log(`[PYTHON BRIDGE] getPersistentPythonProcess() called (Call Count: ${spawnCallCount})`);
    console.log(`[PYTHON BRIDGE] No existing persistent process. Spawning new process...`);

    const isWin = process.platform === 'win32';
    const daemonExePath = path.join(backendRoot, isWin ? 'daemon.exe' : 'daemon');
    const useExe = fs.existsSync(daemonExePath);

    let cmd;
    let args;

    if (useExe) {
      console.log(`[PYTHON BRIDGE] Mode: Production. Spawning standalone daemon from ${daemonExePath}`);
      console.log(`[PYTHON BRIDGE] CWD: ${backendRoot}`);
      cmd = daemonExePath;
      args = [];
    } else {
      let pythonCommand;
      const venvPythonPath = isWin ? path.join(backendRoot, '.venv', 'Scripts', 'python.exe') : path.join(backendRoot, '.venv', 'bin', 'python');
      if (fs.existsSync(venvPythonPath)) {
        pythonCommand = [venvPythonPath];
        console.log(`[PYTHON BRIDGE] Found virtual environment at ${venvPythonPath}`);
      } else {
        pythonCommand = await detectPythonAsync();
      }
      
      const daemonPath = path.join(backendRoot, 'daemon.py');
      console.log(`[PYTHON BRIDGE] Mode: Development. Spawning python daemon using ${pythonCommand[0]} and ${daemonPath}`);
      console.log(`[PYTHON BRIDGE] CWD: ${backendRoot}`);
      cmd = pythonCommand[0];
      args = [...pythonCommand.slice(1), daemonPath];
    }

    const proc = spawn(cmd, args, {
      cwd: backendRoot,
      env: {
        ...process.env,
        PYTHONPATH: backendRoot ? `${backendRoot}${path.delimiter}${process.env.PYTHONPATH || ''}` : process.env.PYTHONPATH
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });

    return new Promise((resolveReady, rejectReady) => {
      let isReady = false;
      const readyTimeout = setTimeout(() => {
        if (!isReady) {
          console.warn('[PYTHON BRIDGE] Daemon ready timeout reached, assuming ready.');
          isReady = true;
          resolveReady(proc);
        }
      }, 5000);

      let buffer = '';

      proc.stdout.on('data', chunk => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop(); // Keep last partial line

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const response = JSON.parse(line);
            
            if (response.type === 'ready') {
              if (!isReady) {
                isReady = true;
                clearTimeout(readyTimeout);
                console.log('[PYTHON BRIDGE] Daemon is ready.');
                resolveReady(proc);
              }
              continue;
            }

            if (response.id && pendingRequests.has(response.id)) {
              const { resolve, reject } = pendingRequests.get(response.id);
              pendingRequests.delete(response.id);
              
              if (response.error) {
                reject(new Error(response.error));
              } else {
                resolve(response.result);
              }
            }
          } catch (e) {
            // Ignore unparseable lines
          }
        }
      });

      proc.stderr.on('data', chunk => {
        console.error(`Python daemon stderr: ${chunk.toString()}`);
      });

      proc.on('close', code => {
        persistentPythonProcessPromise = null;
        if (!isReady) {
          clearTimeout(readyTimeout);
          rejectReady(new Error(`Daemon exited prematurely with code ${code}`));
        }
        for (const [id, { reject }] of pendingRequests) {
          reject(new Error(`Python daemon exited with code ${code}`));
        }
        pendingRequests.clear();
        console.error(`[DAEMON CLOSED] code=${code}, time=${Date.now()}`);
      });
    });
  })();

  return persistentPythonProcessPromise;
}

async function runPythonScript(scriptPath, payload, backendRoot) {
  const process = await getPersistentPythonProcess(backendRoot);
  return new Promise((resolve, reject) => {
    try {
      const id = ++messageIdCounter;
      pendingRequests.set(id, { resolve, reject });
      
      const relativePath = path.relative(backendRoot, scriptPath).replace(/\\/g, '/');
      const req = JSON.stringify({ id, scriptName: relativePath, payload }) + '\n';
      process.stdin.write(req);
    } catch (error) {
      reject(error);
    }
  });
}

async function killPersistentPythonProcess() {
  if (persistentPythonProcessPromise) {
    try {
      const proc = await persistentPythonProcessPromise;
      if (proc) proc.kill();
    } catch (e) {
      // Ignore
    }
    persistentPythonProcessPromise = null;
  }
}

module.exports = {
  runPythonScript,
  getPersistentPythonProcess,
  killPersistentPythonProcess
};
