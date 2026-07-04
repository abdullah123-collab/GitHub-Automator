const { spawn } = require('child_process');
const path = require('path');

function detectPython() {
  const candidates = process.platform === 'win32'
    ? [['py', '-3'], ['python'], ['python3']]
    : [['python3'], ['python']];

  for (const candidate of candidates) {
    try {
      const { spawnSync } = require('child_process');
      const result = spawnSync(candidate[0], candidate.slice(1).concat(['--version']), {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe']
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

function runPythonScript(scriptPath, payload, backendRoot) {
  return new Promise((resolve, reject) => {
    const pythonCommand = detectPython();
    const args = [...pythonCommand.slice(1), scriptPath];
    const child = spawn(pythonCommand[0], args, {
      cwd: backendRoot || path.dirname(scriptPath),
      env: {
        ...process.env,
        PYTHONPATH: backendRoot ? `${backendRoot}${path.delimiter}${process.env.PYTHONPATH || ''}` : process.env.PYTHONPATH
      },
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', error => {
      reject(new Error(`Failed to run Python process: ${error.message}`));
    });

    child.on('close', code => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `Python exited with code ${code}`));
        return;
      }

      try {
        const parsed = JSON.parse(stdout.trim());
        resolve(parsed);
      } catch (error) {
        reject(new Error(`Invalid JSON from Python process: ${stdout}`));
      }
    });

    child.stdin.write(JSON.stringify(payload || {}));
    child.stdin.end();
  });
}

module.exports = {
  runPythonScript
};
