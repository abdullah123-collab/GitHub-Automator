const { runPythonScript } = require('../pythonBridge');
const path = require('path');

const fs = require('fs'); const backendRoot = fs.existsSync(path.join(__dirname, '../../backend')) ? path.join(__dirname, '../../backend') : path.join(__dirname, '../../../backend');

async function initGitRepo(repoPath, defaultBranch) {
  const scriptPath = path.join(backendRoot, 'managers/local_repo.py');
  return runPythonScript(scriptPath, { action: 'init_git_repo', repo_path: repoPath, default_branch: defaultBranch }, backendRoot);
}

async function getRepoInfo(repoPath) {
  const scriptPath = path.join(backendRoot, 'managers/local_repo.py');
  return runPythonScript(scriptPath, { action: 'get_repo_info', repo_path: repoPath }, backendRoot);
}

async function stageAndCommit(repoPath, commitMessage) {
  const scriptPath = path.join(backendRoot, 'managers/commit_manager.py');
  return runPythonScript(scriptPath, { action: 'commit_and_push', repo_path: repoPath, message: commitMessage, auto_push: false }, backendRoot);
}

async function addRemote(repoPath, remoteName, url) {
  const scriptPath = path.join(backendRoot, 'managers/local_repo.py');
  return runPythonScript(scriptPath, { action: 'remote_add', repo_path: repoPath, name: remoteName, url }, backendRoot);
}

async function pushToRemote(repoPath) {
  const scriptPath = path.join(backendRoot, 'managers/local_repo.py');
  return runPythonScript(scriptPath, { action: 'push_repo', repo_path: repoPath }, backendRoot);
}

async function setRemoteUrl(repoPath, remoteName, url) {
  const scriptPath = path.join(backendRoot, 'managers/local_repo.py');
  return runPythonScript(scriptPath, { action: 'remote_set_url', repo_path: repoPath, name: remoteName, url }, backendRoot);
}

module.exports = {
  initGitRepo,
  getRepoInfo,
  stageAndCommit,
  addRemote,
  pushToRemote,
  setRemoteUrl
};
