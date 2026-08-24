const { runPythonScript } = require('../pythonBridge');
const path = require('path');

async function generateGitignore(repoPath, projectType) {
  const fs = require('fs'); const backendRoot = fs.existsSync(path.join(__dirname, '../../backend')) ? path.join(__dirname, '../../backend') : path.join(__dirname, '../../../backend');
  const scriptPath = path.join(backendRoot, 'services/gitignore_generator.py');
  return runPythonScript(scriptPath, { repo_path: repoPath, project_type: projectType }, backendRoot);
}

module.exports = { generateGitignore };
