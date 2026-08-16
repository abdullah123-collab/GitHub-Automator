const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let persistentPythonProcess = null;
let messageIdCounter = 0;
let spawnCallCount = 0;
const pendingRequests = new Map();

function detectPython() {
  const candidates = process.platform === 'win32'
    ? [['py', '-3'], ['python'], ['python3']]
    : [['python3'], ['python']];

  for (const candidate of candidates) {
    try {
      const { spawnSync } = require('child_process');
      const result = spawnSync(candidate[0], candidate.slice(1).concat(['--version']), {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
      if (result.status === 0 || result.error == null) {
        return candidate;
      }
    } catch (error) {
      // Continue to the next candidate.
    }
  }

  return ['python'];
}

function getPersistentPythonProcess(backendRoot) {
  if (persistentPythonProcess) return persistentPythonProcess;

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
    const pythonCommand = detectPython();
    const daemonPath = path.join(backendRoot, 'daemon.py');
    console.log(`[PYTHON BRIDGE] Mode: Development. Spawning python daemon using ${pythonCommand[0]} and ${daemonPath}`);
    console.log(`[PYTHON BRIDGE] CWD: ${backendRoot}`);
    cmd = pythonCommand[0];
    args = [...pythonCommand.slice(1), daemonPath];
  }

  persistentPythonProcess = spawn(cmd, args, {
    cwd: backendRoot,
    env: {
      ...process.env,
      PYTHONPATH: backendRoot ? `${backendRoot}${path.delimiter}${process.env.PYTHONPATH || ''}` : process.env.PYTHONPATH
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });

  let buffer = '';

  persistentPythonProcess.stdout.on('data', chunk => {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); // Keep last partial line

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const response = JSON.parse(line);
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

  persistentPythonProcess.stderr.on('data', chunk => {
    console.error(`Python daemon stderr: ${chunk.toString()}`);
  });

  persistentPythonProcess.on('close', code => {
    persistentPythonProcess = null;
    for (const [id, { reject }] of pendingRequests) {
      reject(new Error(`Python daemon exited with code ${code}`));
    }
    pendingRequests.clear();
    console.error(`[DAEMON CLOSED] code=${code}, time=${Date.now()}`);
  });

  return persistentPythonProcess;
}

function runPythonScript(scriptPath, payload, backendRoot) {
  return new Promise((resolve, reject) => {
    try {
      const process = getPersistentPythonProcess(backendRoot);
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

module.exports = {
  runPythonScript,
  getPersistentPythonProcess
};
