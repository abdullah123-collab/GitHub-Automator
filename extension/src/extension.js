const vscode = require('vscode');
const path = require('path');
const { runPythonScript } = require('./pythonBridge');

const EXTENSION_NAME = 'GitHub Automator';
const AUTH_SECRET_KEY = 'github-automator.token';
const ANTHROPIC_SECRET_KEY = 'github-automator.anthropic-key';

let outputChannel;
let extensionContext;
let reposViewProvider;
let actionsViewProvider;

class RepositoriesWebviewProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.state = {
      authenticated: false,
      loading: true,
      error: '',
      repos: [],
      workspace: ''
    };
  }

  async resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message));
    await this.refreshState();
  }

  async handleMessage(message) {
    const command = message && message.command;
    if (!command) {
      return;
    }

    try {
      switch (command) {
        case 'connectToken':
          await authenticateCommand(message.payload && message.payload.token);
          break;
        case 'logout':
          await logoutCommand();
          break;
        case 'refreshRepos':
          await refreshReposCommand();
          break;
        case 'openRepo':
          await openRepoCommand(message.payload && message.payload.repoName, message.payload && message.payload.cloneUrl);
          break;
        case 'commitAndPush':
          await commitAndPushCommand();
          break;
        case 'aiGenerate':
          await aiGenerateCommand();
          break;
        default:
          break;
      }
    } catch (error) {
      this.setError(error && error.message ? error.message : 'Unexpected error');
    }
  }

  setError(message) {
    this.state.error = message || '';
    this.update();
  }

  setLoading(loading) {
    this.state.loading = loading;
    this.update();
  }

  setAuthenticated(authenticated) {
    this.state.authenticated = authenticated;
    this.update();
  }

  setRepos(repos) {
    this.state.repos = repos || [];
    this.update();
  }

  setWorkspace(name) {
    this.state.workspace = name || '';
    this.update();
  }

  async refreshState() {
    const token = await getStoredSecret(AUTH_SECRET_KEY);
    this.state.authenticated = Boolean(token);
    this.state.workspace = getWorkspacePath() ? path.basename(getWorkspacePath()) : 'No workspace';
    this.state.loading = false;
    this.state.error = '';
    if (this.state.authenticated) {
      await refreshReposCommand();
    } else {
      this.setRepos([]);
    }
  }

  update() {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.getHtml();
  }

  getHtml() {
    const state = this.state;
    const reposHtml = state.loading
      ? '<div class="muted">Loading repositories…</div>'
      : state.authenticated
        ? (state.repos.length
          ? `<div class="repo-grid">${state.repos.map(repo => this.renderRepoCard(repo)).join('')}</div>`
          : '<div class="muted">No repositories found for this account.</div>')
        : this.renderLoginCard();

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          :root { color-scheme: dark; }
          body { margin: 0; padding: 12px; font-family: var(--vscode-font-family); background: #1e1e1e; color: var(--vscode-foreground); }
          .shell { display: flex; flex-direction: column; gap: 12px; }
          .header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
          .title { font-size: 13px; font-weight: 600; }
          .muted { color: var(--vscode-descriptionForeground); font-size: 12px; font-style: italic; }
          .card { background: #252526; border: 1px solid #3c3c3c; border-radius: 8px; padding: 12px; box-shadow: 0 1px 0 rgba(255,255,255,0.04); }
          .login-card { display: flex; flex-direction: column; gap: 10px; }
          .logo { width: 36px; height: 36px; display: flex; align-items: center; justify-content: center; border-radius: 6px; background: #2f80ed; color: white; }
          .login-title { font-size: 16px; font-weight: 600; margin: 0; }
          .subtitle { font-size: 12px; color: var(--vscode-descriptionForeground); margin: 0; }
          label { font-size: 12px; font-weight: 600; }
          input { width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 4px; background: #1e1e1e; border: 1px solid #3c3c3c; color: var(--vscode-input-foreground); }
          button { width: 100%; padding: 8px 10px; border: none; border-radius: 4px; background: #0e639c; color: white; cursor: pointer; font-weight: 600; }
          button.secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
          .error { color: #f48771; font-size: 12px; }
          .repo-grid { display: flex; flex-direction: column; gap: 8px; }
          .repo-card { background: #252526; border: 1px solid #3c3c3c; border-radius: 6px; padding: 10px; }
          .repo-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
          .repo-title-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
          .repo-name { font-weight: 600; margin-bottom: 4px; display: inline-block; white-space: normal; overflow: visible; text-overflow: clip; word-break: break-word; }
          .repo-action { flex-shrink: 0; margin-left: auto; width: 28px; height: 28px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; cursor: pointer; }
          .repo-meta { font-size: 11px; color: var(--vscode-descriptionForeground); display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
          .actions { display: flex; gap: 8px; margin-top: 8px; }
          .actions button { width: auto; flex: 1; }
          .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 6px; border-radius: 999px; background: rgba(255,255,255,0.06); }
        </style>
      </head>
      <body>
        <div class="shell">
          <div class="header">
            <div class="title">Repositories</div>
            <div class="muted">${state.workspace || 'Workspace'}</div>
          </div>
          ${reposHtml}
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          function post(command, payload) { vscode.postMessage({ command, payload }); }
          function submitToken() {
            const token = document.getElementById('tokenInput').value.trim();
            post('connectToken', { token });
          }
          function logout() { post('logout'); }
          function refresh() { post('refreshRepos'); }
          function commitAndPush() { post('commitAndPush'); }
          function aiGenerate() { post('aiGenerate'); }
        </script>
      </body>
      </html>`;
  }

  renderLoginCard() {
    return `<div class="card login-card">
      <div class="logo" aria-hidden="true">⌘</div>
      <h3 class="login-title">GitHub Automator</h3>
      <p class="subtitle">Connect your GitHub account to manage repositories.</p>
      <label for="tokenInput">GitHub Personal Access Token</label>
      <input id="tokenInput" type="password" placeholder="ghp_..." />
      <button onclick="submitToken()">Connect to GitHub</button>
      ${this.state.error ? `<div class="error">${this.state.error}</div>` : ''}
    </div>`;
  }

  renderRepoCard(repo) {
    const visibility = repo.private ? '🔒 Private' : '🌍 Public';
    const description = repo.description ? repo.description : 'No description provided.';
    const language = repo.language ? repo.language : '';
    const stars = repo.stargazers_count ? `<span class="pill">⭐ ${repo.stargazers_count}</span>` : '';
    const repoName = (repo.name || 'Repository').replace(/'/g, "\\'");
    const cloneUrl = (repo.clone_url || '').replace(/'/g, "\\'");
    return `<div class="repo-card">
      <div class="repo-header">
        <div class="repo-title-group">
          <div class="repo-name">${repo.name || 'Repository'}</div>
          <span class="pill">${visibility}</span>
        </div>
        <button class="repo-action" onclick="post('openRepo', { repoName: '${repoName}', cloneUrl: '${cloneUrl}' })" title="Open local repository">+</button>
      </div>
      <div class="muted">${description}</div>
      <div class="repo-meta">
        ${language ? `<span class="pill">${language}</span>` : ''}
        ${stars}
      </div>
    </div>`;
  }
}

class ActionsWebviewProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.authenticated = false;
  }

  resolveWebviewView(webviewView) {
    this.view = webviewView;
    webviewView.webview.options = { enableScripts: true };
    webviewView.webview.html = this.getHtml();
    webviewView.webview.onDidReceiveMessage(message => this.handleMessage(message));
  }

  setAuthenticated(authenticated) {
    this.authenticated = authenticated;
    if (this.view) {
      this.view.webview.html = this.getHtml();
    }
  }

  handleMessage(message) {
    const command = message && message.command;
    if (!command) {
      return;
    }

    if (command === 'commitAndPush') {
      commitAndPushCommand();
    } else if (command === 'aiGenerate') {
      aiGenerateCommand();
    }
  }

  getHtml() {
    if (!this.authenticated) {
      return `<!DOCTYPE html><html><body style="margin:0;padding:0"></body></html>`;
    }

    return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <style>
          :root { color-scheme: dark; }
          body { margin: 0; padding: 12px; font-family: var(--vscode-font-family); background: transparent; color: var(--vscode-foreground); }
          .card { background: #252526; border: 1px solid #3c3c3c; border-radius: 8px; padding: 12px; }
          .header { display: flex; align-items: center; gap: 8px; font-weight: 600; margin-bottom: 10px; }
          .actions { display: flex; flex-direction: column; gap: 8px; }
          button { width: 100%; padding: 8px 10px; border: none; border-radius: 4px; color: white; cursor: pointer; font-weight: 600; }
          .primary { background: #0e639c; }
          .secondary { background: #7b61ff; }
          .muted { color: var(--vscode-descriptionForeground); font-size: 11px; font-style: italic; margin-top: 6px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">🗂️ GIT ACTIONS</div>
          <div class="actions">
            <button class="primary" onclick="post('commitAndPush')">⚡ Commit & Push</button>
            <button class="secondary" onclick="post('aiGenerate')">✨ AI Generate Message</button>
            <div class="muted">Tip: Use AI Generate to automatically create professional commit messages based on your changes.</div>
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          function post(command) { vscode.postMessage({ command }); }
        </script>
      </body>
      </html>`;
  }
}

function createOutputChannel() {
  const channel = vscode.window.createOutputChannel(EXTENSION_NAME);
  channel.appendLine(`[${new Date().toISOString()}] Extension activated`);
  return channel;
}

function log(message) {
  if (outputChannel) {
    outputChannel.appendLine(message);
  }
}

function getRepoRoot() {
  return path.resolve(extensionContext.extensionPath, '..');
}

function getBackendRoot() {
  return path.join(getRepoRoot(), 'backend');
}

async function runBackendScript(scriptName, payload) {
  return runPythonScript(path.join(getBackendRoot(), scriptName), payload, getBackendRoot());
}

async function getStoredSecret(key) {
  return extensionContext.secrets.get(key);
}

async function updateAuthContext(isAuthenticated) {
  if (!extensionContext) {
    return;
  }
  await vscode.commands.executeCommand('setContext', 'githubAutomator.authenticated', isAuthenticated);
}

async function setStoredSecret(key, value) {
  if (!value) {
    await extensionContext.secrets.delete(key);
    return;
  }
  await extensionContext.secrets.store(key, value);
}

function getWorkspacePath() {
  const workspaceFolders = vscode.workspace.workspaceFolders || [];
  if (workspaceFolders.length) {
    return workspaceFolders[0].uri.fsPath;
  }
  return undefined;
}

async function ensureAuthenticated() {
  const token = await getStoredSecret(AUTH_SECRET_KEY);
  if (!token) {
    reposViewProvider.setAuthenticated(false);
    actionsViewProvider.setAuthenticated(false);
    await updateAuthContext(false);
    reposViewProvider.setError('');
    reposViewProvider.setRepos([]);
    return false;
  }
  return true;
}

async function authenticateCommand(tokenOverride) {
  try {
    const token = tokenOverride || await vscode.window.showInputBox({
      prompt: 'Enter your GitHub personal access token',
      password: true,
      ignoreFocusOut: true,
      placeHolder: 'ghp_...'
    });

    if (!token) {
      return;
    }

    reposViewProvider.setLoading(true);
    const result = await runBackendScript('auth.py', { token });

    if (!result || !result.valid) {
      reposViewProvider.setError('Invalid token. Please try again.');
      reposViewProvider.setLoading(false);
      return;
    }

    await setStoredSecret(AUTH_SECRET_KEY, token);
    reposViewProvider.setError('');
    reposViewProvider.setAuthenticated(true);
    actionsViewProvider.setAuthenticated(true);
    await updateAuthContext(true);
    reposViewProvider.setLoading(true);
    await refreshReposCommand();
  } catch (error) {
    log(`authenticate failed: ${error && error.message ? error.message : error}`);
    reposViewProvider.setError('Invalid token. Please try again.');
    reposViewProvider.setLoading(false);
  }
}

async function logoutCommand() {
  await setStoredSecret(AUTH_SECRET_KEY, '');
  await setStoredSecret(ANTHROPIC_SECRET_KEY, '');
  reposViewProvider.setAuthenticated(false);
  actionsViewProvider.setAuthenticated(false);
  await updateAuthContext(false);
  reposViewProvider.setError('');
  reposViewProvider.setRepos([]);
  reposViewProvider.setLoading(false);
  await vscode.window.showInformationMessage('Signed out from GitHub Automator.');
}

async function refreshReposCommand() {
  try {
    const token = await getStoredSecret(AUTH_SECRET_KEY);
    if (!token) {
      reposViewProvider.setAuthenticated(false);
      actionsViewProvider.setAuthenticated(false);
      await updateAuthContext(false);
      reposViewProvider.setRepos([]);
      reposViewProvider.setLoading(false);
      return;
    }

    reposViewProvider.setLoading(true);
    const result = await runBackendScript('managers/repo_manager.py', { action: 'list', token });
    if (!result || !result.success) {
      reposViewProvider.setError(result && result.error ? result.error : 'Unable to load repositories');
      reposViewProvider.setLoading(false);
      return;
    }

    reposViewProvider.setError('');
    reposViewProvider.setRepos(result.repos || []);
    actionsViewProvider.setAuthenticated(true);
    await updateAuthContext(true);
    reposViewProvider.setLoading(false);
  } catch (error) {
    log(`refreshRepos failed: ${error && error.message ? error.message : error}`);
    reposViewProvider.setError(error && error.message ? error.message : 'Unable to refresh repositories');
    reposViewProvider.setLoading(false);
  }
}

async function openRepoCommand(repoName, cloneUrl) {
  try {
    if (!repoName) {
      return;
    }

    const result = await runBackendScript('managers/repo_manager.py', {
      action: 'check_repo_exists',
      repo_name: repoName
    });

    if (result && result.success && result.exists && result.path) {
      const uri = vscode.Uri.file(result.path);
      await vscode.commands.executeCommand('vscode.openFolder', uri, false);
      return;
    }

    const choice = await vscode.window.showWarningMessage(
      'This repository is not open locally. Would you like to open/clone it now?',
      { modal: false },
      'Yes, clone/open it',
      'Cancel'
    );

    if (choice !== 'Yes, clone/open it') {
      return;
    }

    const folder = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      openLabel: 'Select destination folder'
    });

    if (!folder || !folder.length) {
      return;
    }

    const token = await getStoredSecret(AUTH_SECRET_KEY);
    const destinationPath = path.join(folder[0].fsPath, repoName.replace(/\.git$/, ''));
    const cloneResult = await runBackendScript('managers/repo_manager.py', {
      action: 'smart_clone',
      token,
      repo_name: repoName.replace(/\.git$/, ''),
      clone_url: cloneUrl || '',
      dest_path: destinationPath
    });

    if (!cloneResult || !cloneResult.success) {
      const message = cloneResult && cloneResult.error ? cloneResult.error : 'Unable to clone or open the repository.';
      await vscode.window.showWarningMessage(message);
      return;
    }

    const uri = vscode.Uri.file(cloneResult.path || destinationPath);
    await vscode.commands.executeCommand('vscode.openFolder', uri, false);
  } catch (error) {
    log(`openRepo failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`Unable to open repository: ${error && error.message ? error.message : error}`);
  }
}

async function createRepoCommand() {
  try {
    if (!await ensureAuthenticated()) {
      return;
    }

    const name = await vscode.window.showInputBox({ prompt: 'Repository name', ignoreFocusOut: true });
    if (!name) {
      return;
    }

    const description = await vscode.window.showInputBox({ prompt: 'Repository description (optional)', ignoreFocusOut: true });
    const privateChoice = await vscode.window.showQuickPick(['Public', 'Private'], { placeHolder: 'Visibility' });
    const privateValue = privateChoice === 'Private';
    const token = await getStoredSecret(AUTH_SECRET_KEY);
    const result = await runBackendScript('managers/repo_manager.py', {
      action: 'create',
      token,
      name,
      private: privateValue,
      description: description || ''
    });

    if (!result || !result.success) {
      const message = result && result.error ? result.error : 'Repository creation failed';
      await vscode.window.showErrorMessage(message);
      return;
    }

    await vscode.window.showInformationMessage(`Created repository ${result.name}.`);
    await refreshReposCommand();
  } catch (error) {
    log(`createRepo failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`Repository creation failed: ${error && error.message ? error.message : error}`);
  }
}

async function deleteRepoCommand() {
  try {
    if (!await ensureAuthenticated()) {
      return;
    }

    const repoName = await vscode.window.showInputBox({ prompt: 'Repository name to delete', ignoreFocusOut: true });
    if (!repoName) {
      return;
    }

    const owner = await vscode.window.showInputBox({ prompt: 'Owner (leave blank to use current account)', ignoreFocusOut: true });
    const token = await getStoredSecret(AUTH_SECRET_KEY);
    const result = await runBackendScript('managers/repo_manager.py', {
      action: 'delete',
      token,
      owner: owner || '',
      repo: repoName
    });

    if (!result || !result.success) {
      const message = result && result.error ? result.error : 'Repository deletion failed';
      await vscode.window.showErrorMessage(message);
      return;
    }

    await vscode.window.showInformationMessage(`Deleted repository ${repoName}.`);
    await refreshReposCommand();
  } catch (error) {
    log(`deleteRepo failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`Repository deletion failed: ${error && error.message ? error.message : error}`);
  }
}

async function cloneRepoCommand() {
  try {
    if (!await ensureAuthenticated()) {
      return;
    }

    const cloneUrl = await vscode.window.showInputBox({ prompt: 'Repository clone URL', ignoreFocusOut: true });
    if (!cloneUrl) {
      return;
    }

    const folder = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, openLabel: 'Select destination folder' });
    if (!folder || !folder.length) {
      return;
    }

    const token = await getStoredSecret(AUTH_SECRET_KEY);
    const repoName = cloneUrl.split('/').filter(Boolean).pop() || 'repository';
    const result = await runBackendScript('managers/repo_manager.py', {
      action: 'smart_clone',
      token,
      repo_name: repoName.replace(/\.git$/, ''),
      clone_url: cloneUrl,
      dest_path: path.join(folder[0].fsPath, repoName.replace(/\.git$/, '')),
      token
    });

    if (!result || !result.success) {
      const message = result && result.error ? result.error : 'Clone failed';
      await vscode.window.showErrorMessage(message);
      return;
    }

    await vscode.window.showInformationMessage(`Cloned repository to ${result.path}.`);
  } catch (error) {
    log(`cloneRepo failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`Clone failed: ${error && error.message ? error.message : error}`);
  }
}

async function initializeRepoCommand() {
  try {
    const folder = await vscode.window.showOpenDialog({ canSelectFiles: false, canSelectFolders: true, openLabel: 'Select folder to initialize' });
    if (!folder || !folder.length) {
      return;
    }

    const repoPath = folder[0].fsPath;
    const result = await runBackendScript('managers/local_repo.py', { action: 'init_git_repo', repo_path: repoPath });
    if (!result || !result.success) {
      const message = result && result.error ? result.error : 'Repository initialization failed';
      await vscode.window.showErrorMessage(message);
      return;
    }

    await vscode.window.showInformationMessage(`Initialized Git repository at ${repoPath}.`);
  } catch (error) {
    log(`initializeRepo failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`Repository initialization failed: ${error && error.message ? error.message : error}`);
  }
}

async function commitAndPushCommand() {
  try {
    const repoPath = getWorkspacePath();
    if (!repoPath) {
      await vscode.window.showWarningMessage('Open a folder before running commit and push.');
      return;
    }

    const message = await vscode.window.showInputBox({ prompt: 'Commit message (leave empty for AI-generated message)', ignoreFocusOut: true });
    const token = await getStoredSecret(AUTH_SECRET_KEY);
    const announcement = await runBackendScript('managers/commit_manager.py', {
      action: 'commit_and_push',
      repo_path: repoPath,
      message: message || '',
      use_ai: true,
      api_key: token || ''
    });

    if (!announcement || !announcement.success) {
      const detail = announcement && announcement.message ? announcement.message : 'The commit workflow failed.';
      await vscode.window.showErrorMessage(detail);
      return;
    }

    await vscode.window.showInformationMessage(announcement.message || 'Commit and push completed.');
  } catch (error) {
    log(`commitAndPush failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`Commit and push failed: ${error && error.message ? error.message : error}`);
  }
}

async function aiGenerateCommand() {
  try {
    const repoPath = getWorkspacePath();
    if (!repoPath) {
      await vscode.window.showWarningMessage('Open a folder before generating a commit message.');
      return;
    }

    const diffResult = await runBackendScript('managers/commit_manager.py', {
      action: 'get_diff',
      repo_path: repoPath
    });

    if (!diffResult || !diffResult.success) {
      await vscode.window.showErrorMessage(diffResult && diffResult.message ? diffResult.message : 'Unable to inspect the working tree.');
      return;
    }

    const apiKey = (await getStoredSecret(ANTHROPIC_SECRET_KEY)) || (await getStoredSecret(AUTH_SECRET_KEY)) || '';
    const generated = await runBackendScript('services/ai_commit_cli.py', {
      diff: diffResult.diff || '',
      api_key: apiKey
    });

    if (!generated || !generated.success) {
      const detail = generated && generated.error ? generated.error : 'AI generation failed.';
      await vscode.window.showErrorMessage(detail);
      return;
    }

    const edited = await vscode.window.showInputBox({
      prompt: 'Review the generated commit message',
      value: generated.message || '',
      ignoreFocusOut: true
    });

    if (edited === undefined) {
      return;
    }

    const finalMessage = edited && edited.trim() ? edited.trim() : generated.message || 'Auto-commit';
    await vscode.window.showInformationMessage(`Generated commit message: ${finalMessage}`);
  } catch (error) {
    log(`aiGenerate failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`AI generation failed: ${error && error.message ? error.message : error}`);
  }
}

async function setAnthropicKeyCommand() {
  try {
    const key = await vscode.window.showInputBox({ prompt: 'Enter Anthropic API key', password: true, ignoreFocusOut: true });
    if (!key) {
      return;
    }
    await setStoredSecret(ANTHROPIC_SECRET_KEY, key);
    await vscode.window.showInformationMessage('Anthropic API key saved.');
  } catch (error) {
    log(`setAnthropicKey failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`Unable to save Anthropic key: ${error && error.message ? error.message : error}`);
  }
}

async function showPanelCommand() {
  const panel = vscode.window.createWebviewPanel('githubAutomatorPanel', 'GitHub Automator', vscode.ViewColumn.One, { enableScripts: true });
  panel.webview.html = `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)} button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:8px 12px;border:0;border-radius:4px;margin-right:6px}</style>
    </head>
    <body>
      <h2>GitHub Automator</h2>
      <p>Use the commands below to manage repositories and git workflows.</p>
      <button onclick="vscode.postMessage({ command: 'authenticate' })">Authenticate</button>
      <button onclick="vscode.postMessage({ command: 'refreshRepos' })">Refresh</button>
      <button onclick="vscode.postMessage({ command: 'createRepo' })">Create Repo</button>
      <button onclick="vscode.postMessage({ command: 'commitAndPush' })">Commit & Push</button>
      <button onclick="vscode.postMessage({ command: 'aiGenerate' })">AI Generate</button>
      <script>const vscode = acquireVsCodeApi();</script>
    </body>
    </html>`;

  panel.webview.onDidReceiveMessage(async message => {
    switch (message.command) {
      case 'authenticate':
        await authenticateCommand();
        break;
      case 'refreshRepos':
        await refreshReposCommand();
        break;
      case 'createRepo':
        await createRepoCommand();
        break;
      case 'commitAndPush':
        await commitAndPushCommand();
        break;
      case 'aiGenerate':
        await aiGenerateCommand();
        break;
      default:
        break;
    }
  });
}

function activate(context) {
  extensionContext = context;
  outputChannel = createOutputChannel();
  context.subscriptions.push(outputChannel);

  reposViewProvider = new RepositoriesWebviewProvider(context);
  actionsViewProvider = new ActionsWebviewProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('github-automator.repoView', reposViewProvider),
    vscode.window.registerWebviewViewProvider('github-automator.actionsView', actionsViewProvider)
  );

  const commands = [
    vscode.commands.registerCommand('github-automator.authenticate', () => authenticateCommand()),
    vscode.commands.registerCommand('github-automator.logout', () => logoutCommand()),
    vscode.commands.registerCommand('github-automator.showPanel', () => showPanelCommand()),
    vscode.commands.registerCommand('github-automator.refreshRepos', () => refreshReposCommand()),
    vscode.commands.registerCommand('github-automator.createRepo', () => createRepoCommand()),
    vscode.commands.registerCommand('github-automator.deleteRepo', () => deleteRepoCommand()),
    vscode.commands.registerCommand('github-automator.cloneRepo', () => cloneRepoCommand()),
    vscode.commands.registerCommand('github-automator.initializeRepo', () => initializeRepoCommand()),
    vscode.commands.registerCommand('github-automator.commitAndPush', () => commitAndPushCommand()),
    vscode.commands.registerCommand('github-automator.aiGenerate', () => aiGenerateCommand()),
    vscode.commands.registerCommand('github-automator.setAnthropicKey', () => setAnthropicKeyCommand())
  ];

  context.subscriptions.push(...commands);
  updateAuthContext(false).catch(() => {});
  refreshReposCommand().catch(error => {
    log(`initial refresh failed: ${error && error.message ? error.message : error}`);
  });

  return { extendContextMenu: undefined };
}

function deactivate() {
  log('Extension deactivated');
}

module.exports = {
  activate,
  deactivate
};
