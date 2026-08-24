const { runPythonScript } = require('../pythonBridge');
const path = require('path');
const fs = require('fs');

const backendRoot = fs.existsSync(path.join(__dirname, '../../backend')) ? path.join(__dirname, '../../backend') : path.join(__dirname, '../../../backend');

async function detectReadme(repoPath) {
  try {
    const items = await fs.promises.readdir(repoPath);
    const readmeFile = items.find(name => {
      const lower = name.toLowerCase();
      return lower === 'readme.md' || lower === 'readme' || lower === 'readme.txt';
    });
    if (readmeFile) {
      return { exists: true, path: path.join(repoPath, readmeFile), filename: readmeFile };
    }
    return { exists: false };
  } catch (error) {
    return { exists: false, error: error.message };
  }
}

async function generateReadme(repoPath, repoName, projectContext, model) {
  const scriptPath = path.join(backendRoot, 'services/ai_readme_cli.py');
  return runPythonScript(scriptPath, {
    repo_name: repoName,
    repo_path: repoPath,
    model: model,
    project_context: projectContext
  }, backendRoot);
}

async function writeReadme(repoPath, content) {
  try {
    const targetPath = path.join(repoPath, 'README.md');
    await fs.promises.writeFile(targetPath, content, 'utf8');
    return { success: true, path: targetPath };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

module.exports = {
  detectReadme,
  generateReadme,
  writeReadme
};
