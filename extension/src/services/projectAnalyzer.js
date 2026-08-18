const { runPythonScript } = require('../pythonBridge');
const path = require('path');

async function analyzeProject(repoPath) {
  const backendRoot = path.join(__dirname, '../../../backend');
  const scriptPath = path.join(backendRoot, 'services/project_analyzer.py');
  return runPythonScript(scriptPath, { repo_path: repoPath }, backendRoot);
}

module.exports = { analyzeProject };
