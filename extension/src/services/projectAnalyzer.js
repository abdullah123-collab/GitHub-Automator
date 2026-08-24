const { runPythonScript } = require('../pythonBridge');
const path = require('path');

async function analyzeProject(repoPath) {
  const fs = require('fs'); const backendRoot = fs.existsSync(path.join(__dirname, '../../backend')) ? path.join(__dirname, '../../backend') : path.join(__dirname, '../../../backend');
  const scriptPath = path.join(backendRoot, 'services/project_analyzer.py');
  return runPythonScript(scriptPath, { repo_path: repoPath }, backendRoot);
}

module.exports = { analyzeProject };
