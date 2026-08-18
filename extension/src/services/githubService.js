const { runPythonScript } = require('../pythonBridge');
const path = require('path');

const backendRoot = path.join(__dirname, '../../../backend');

async function createRepo(token, name, privateValue, description, autoInit = true) {
  const scriptPath = path.join(backendRoot, 'managers/repo_manager.py');
  return runPythonScript(scriptPath, {
    action: 'create',
    token,
    name,
    private: privateValue,
    description: description || '',
    auto_init: autoInit
  }, backendRoot);
}

async function checkRemoteRepoExists(token, name) {
  const scriptPath = path.join(backendRoot, 'managers/repo_manager.py');
  return runPythonScript(scriptPath, {
    action: 'check_remote_repo_exists',
    token,
    name
  }, backendRoot);
}

module.exports = {
  createRepo,
  checkRemoteRepoExists
};
