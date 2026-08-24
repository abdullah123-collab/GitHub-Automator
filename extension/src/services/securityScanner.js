const { runPythonScript } = require('../pythonBridge');
const path = require('path');

async function scanProject(repoPath) {
  const fs = require('fs'); const backendRoot = fs.existsSync(path.join(__dirname, '../../backend')) ? path.join(__dirname, '../../backend') : path.join(__dirname, '../../../backend');
  const scriptPath = path.join(backendRoot, 'services/security_scanner.py');
  return runPythonScript(scriptPath, { repo_path: repoPath }, backendRoot);
}

module.exports = { scanProject };
