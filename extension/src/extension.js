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
        case 'deleteRepo':
          await deleteRepoFromCard(message.payload && message.payload.repoName, message.payload && message.payload.owner);
          break;
        case 'updateDescription':
          await updateRepoDescription(message.payload && message.payload.repoName, message.payload && message.payload.owner, message.payload && message.payload.description);
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
          .search-container { position: relative; width: 100%; display: flex; align-items: center; }
          .search-icon { position: absolute; left: 10px; display: flex; align-items: center; color: var(--vscode-icon-foreground); }
          #repoSearch { width: 100%; padding: 8px 10px 8px 32px; border-radius: 4px; background: var(--vscode-input-background, #2d2d2d); border: 1px solid transparent; color: var(--vscode-input-foreground); font-family: inherit; transition: border-color 0.1s; outline: none; }
          #repoSearch:focus { border: 1px solid var(--vscode-focusBorder, #007fd4); }
        </style>
      </head>
      <body>
        <div class="shell">
          <div class="search-container">
            <span class="search-icon">
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M15.7 14.3l-4.2-4.2c.8-1.2 1.3-2.6 1.3-4.1 0-3.9-3.1-7-7-7s-7 3.1-7 7 3.1 7 7 7c1.5 0 2.9-.5 4.1-1.3l4.2 4.2c.4.4 1 .4 1.4 0s.4-1 0-1.4zM2 6c0-2.2 1.8-4 4-4s4 1.8 4 4-1.8 4-4 4-4-1.8-4-4z"/></svg>
            </span>
            <input id="repoSearch" placeholder="Search repositories..." />
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

          function editDescription(repoName, owner, element) {
            const currentDesc = element.innerText;
            element.ondblclick = null;
            element.innerHTML = '<input type="text" class="desc-edit-input" value="' + currentDesc.replace(/"/g, '&quot;') + '" style="width: 100%; box-sizing: border-box; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-focusBorder); outline: none; border-radius: 2px;" />';
            const input = element.querySelector('input');
            input.focus();
            
            const save = () => {
              input.onblur = null;
              const newDesc = input.value;
              element.innerHTML = '<span style="color: var(--vscode-progressBar-background)">Saving...</span>';
              element.dataset.original = currentDesc;
              post('updateDescription', { repoName, owner, description: newDesc });
            };
            
            const cancel = () => {
              element.innerHTML = currentDesc;
              element.ondblclick = function() { editDescription(repoName, owner, element); };
            };
            
            input.onkeydown = (e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') cancel();
            };
            
            input.onblur = cancel;
          }

          window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'descriptionUpdated') {
              const element = document.getElementById('desc-' + message.payload.repoName);
              if (element) {
                if (message.payload.success) {
                  element.innerHTML = message.payload.description;
                } else {
                  element.innerHTML = element.dataset.original || 'No description provided.';
                }
                const owner = element.getAttribute('data-owner');
                element.ondblclick = function() { editDescription(message.payload.repoName, owner, element); };
              }
            }
          });

          // Client-side filtering for repo cards
          document.addEventListener('DOMContentLoaded', () => {
            const input = document.getElementById('repoSearch');
            if (!input) return;
            input.addEventListener('input', () => {
              const q = (input.value || '').toLowerCase().trim();
              document.querySelectorAll('.repo-card').forEach(c => {
                const name = (c.querySelector('.repo-name') && c.querySelector('.repo-name').innerText.toLowerCase()) || '';
                const desc = (c.querySelector('.muted') && c.querySelector('.muted').innerText.toLowerCase()) || '';
                c.style.display = (!q || name.includes(q) || desc.includes(q)) ? '' : 'none';
              });
            });
          });
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
    const lockSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="margin-right:2px"><path d="M4 6V4a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1zm2-2v2h4V4a2 2 0 1 0-4 0z"/></svg>`;
    const globeSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="margin-right:2px; color: var(--vscode-icon-foreground);"><path d="M8 0a8 8 0 1 0 0 16A8 8 0 0 0 8 0zm.5 1.03A7.03 7.03 0 0 1 14.97 8H8.5V1.03zM7.5 1.03V8H1.03A7.03 7.03 0 0 1 7.5 1.03zM1.03 9H7.5v6.97A7.03 7.03 0 0 1 1.03 9zM8.5 14.97V9h6.47a7.03 7.03 0 0 1-6.47 5.97z"/></svg>`;
    const starSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="margin-right:2px"><path d="M8 1L10.3 5.6L15.4 6.3L11.7 9.9L12.6 15L8 12.6L3.4 15L4.3 9.9L0.6 6.3L5.7 5.6L8 1z"/></svg>`;
    const folderSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 4h-4.5L8 2H2C.9 2 0 2.9 0 4v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 8H2V4h5.5l1.5 2H14v6z"/></svg>`;
    const cloudSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 5c-.3 0-.6.1-.9.1A4.5 4.5 0 0 0 2 6.5C.9 6.8 0 8 0 9.5 0 11.4 1.6 13 3.5 13h7.5c2.2 0 4-1.8 4-4s-1.8-4-4-4z"/></svg>`;
    const trashSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 2V0H5v2H0v2h1v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4h1V2h-5zm-4 12H5V5h2v9zm4 0H9V5h2v9z"/></svg>`;

    const visibility = repo.private ? `${lockSvg} Private` : `${globeSvg} Public`;
    const description = repo.description ? repo.description : 'No description provided.';
    const language = repo.language ? repo.language : '';
    const stars = repo.stargazers_count ? `<span class="pill">${starSvg} ${repo.stargazers_count}</span>` : '';
    const repoName = (repo.name || 'Repository').replace(/'/g, "\\'");
    const cloneUrl = (repo.clone_url || '').replace(/'/g, "\\'");
    const isActive = repo.name && repo.name === this.state.workspace;
    const activeClass = isActive ? ' active' : '';
    const playSvg = isActive ? `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="margin-right:4px"><path d="M5 2l6 6-6 6z"/></svg>` : '';
    const owner = repo.owner && repo.owner.login ? repo.owner.login : '';
    const cloneIcon = repo.is_cloned ? folderSvg : cloudSvg;

    return `<div class="repo-card${activeClass}">
      <div class="repo-header" style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
        <div class="repo-title-group" style="display: flex; align-items: center; gap: 8px;">
          <div class="repo-name" style="font-weight: 600; display: flex; align-items: center; color: var(--vscode-textLink-foreground);">${playSvg} ${repo.name || 'Repository'}</div>
          <span class="pill" style="display: flex; align-items: center;">${visibility}</span>
        </div>
        <div class="repo-icon-container" style="width: 28px; text-align: center; flex-shrink: 0; display: flex; justify-content: center; align-items: center;">
          <span onclick="post('openRepo', { repoName: '${repoName}', cloneUrl: '${cloneUrl}' })" title="${repo.is_cloned ? 'Open local repository' : 'Clone repository'}" style="cursor: pointer; color: var(--vscode-icon-foreground); display: inline-flex;">
            ${cloneIcon}
          </span>
        </div>
      </div>
      <div class="muted" style="margin-top: 8px; margin-bottom: 8px; cursor: pointer; white-space: pre-wrap;" title="Double-click to edit description" id="desc-${repoName}" data-owner="${owner.replace(/'/g, "\\\\'")}" ondblclick="editDescription('${repoName}', '${owner.replace(/'/g, "\\\\'")}', this)">${description}</div>
      <div class="repo-meta" style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div style="display:flex; gap:8px;">
          ${language ? `<span class="pill">${language}</span>` : ''}
          ${stars}
        </div>
        <button class="repo-action" onclick="post('deleteRepo', { repoName: '${repoName}', owner: '${owner.replace(/'/g, "\\\\'")}' })" title="Delete repository">
          ${trashSvg}
        </button>
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
          .muted { color: var(--vscode-descriptionForeground); font-size: 11px; font-style: italic; margin-top: 6px; }
          textarea { width:100%; min-height:80px; padding:8px; border-radius:6px; background:#1e1e1e; border:1px solid #3c3c3c; color:var(--vscode-input-foreground); }
          .inline-actions { display:flex; gap:8px; align-items:center; }
          .ai-btn { background:transparent; border:1px solid #3c3c3c; color:var(--vscode-foreground); padding:6px 8px; border-radius:6px; cursor:pointer; }
          .loading { box-shadow: 0 0 0 3px rgba(0,120,212,0.12); animation: pulse 1s infinite; }
          @keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(0,120,212,0.12);} 70% { box-shadow:0 0 0 6px rgba(0,120,212,0);} 100% { box-shadow:0 0 0 0 rgba(0,120,212,0);} }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="header">🗂️ GIT ACTIONS</div>
          <div class="actions">
            <button class="primary" id="commitBtn">⚡ Commit & Push</button>
            <div class="muted">Use the native input box to review and edit your commit message before pushing.</div>
          </div>
        </div>
        <script>
          const vscode = acquireVsCodeApi();
          function post(command, payload) { vscode.postMessage({ command, payload }); }
          document.getElementById('commitBtn').addEventListener('click', () => {
            post('commitAndPush');
          });
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
  console.time(`runBackendScript-${scriptName}`);
  const res = await runPythonScript(path.join(getBackendRoot(), scriptName), payload, getBackendRoot());
  console.timeEnd(`runBackendScript-${scriptName}`);
  return res;
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
  console.time('refreshReposCommand');
  try {
    const token = await getStoredSecret(AUTH_SECRET_KEY);
    if (!token) {
      reposViewProvider.setAuthenticated(false);
      actionsViewProvider.setAuthenticated(false);
      await updateAuthContext(false);
      reposViewProvider.setRepos([]);
      reposViewProvider.setLoading(false);
      console.timeEnd('refreshReposCommand');
      return;
    }

    reposViewProvider.setLoading(true);
    let page = 1;
    let allRepos = [];
    let hasMore = true;

    while (hasMore && page <= 5) { // max 5 pages (500 repos)
      console.time(`repo_manager-list-page-${page}`);
      const result = await runBackendScript('managers/repo_manager.py', { 
        action: 'list', 
        token,
        repo_path: getWorkspacePath(),
        page
      });
      console.timeEnd(`repo_manager-list-page-${page}`);

      if (!result || !result.success) {
        if (page === 1) {
          reposViewProvider.setError(result && result.error ? result.error : 'Unable to load repositories');
          reposViewProvider.setLoading(false);
          console.timeEnd('refreshReposCommand');
          return;
        } else {
          log(`Failed to load page ${page}: ${result && result.error ? result.error : 'Unknown error'}`);
          break;
        }
      }

      allRepos = allRepos.concat(result.repos || []);
      
      if (page === 1) {
        reposViewProvider.setError('');
        reposViewProvider.setRepos(allRepos);
        actionsViewProvider.setAuthenticated(true);
        await updateAuthContext(true);
        reposViewProvider.setLoading(false);
      } else {
        reposViewProvider.setRepos(allRepos);
      }

      hasMore = result.has_more === true;
      page++;
    }

  } catch (error) {
    log(`refreshRepos failed: ${error && error.message ? error.message : error}`);
    reposViewProvider.setError(error && error.message ? error.message : 'Unable to refresh repositories');
    reposViewProvider.setLoading(false);
  }
  console.timeEnd('refreshReposCommand');
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

    const description = await new Promise((resolve) => {
      const inputBox = vscode.window.createInputBox();
      inputBox.title = 'Create Repository';
      inputBox.prompt = 'Auto-Generate Repository Description';
      inputBox.placeHolder = 'Type a description or click the $(wand) button above to generate one.';
      inputBox.ignoreFocusOut = true;
      inputBox.buttons = [
        {
          iconPath: new vscode.ThemeIcon('wand'),
          tooltip: '✨ Auto Generate'
        }
      ];

      inputBox.onDidAccept(() => {
        resolve(inputBox.value);
        inputBox.dispose();
      });

      inputBox.onDidHide(() => {
        resolve(undefined);
        inputBox.dispose();
      });

      inputBox.onDidTriggerButton(async (button) => {
        if (button.iconPath.id === 'wand') {
          inputBox.busy = true;
          inputBox.enabled = false;
          inputBox.placeholder = 'Generating description...';
          inputBox.value = '';

          const apiKey = await getStoredSecret(ANTHROPIC_SECRET_KEY);
          const generated = await runBackendScript('services/ai_description_cli.py', {
            repo_name: name,
            api_key: apiKey || ''
          });

          if (generated && generated.success) {
            inputBox.value = generated.description || '';
            inputBox.placeholder = 'Enter description or click 🪄 to auto-generate';
            inputBox.enabled = true;
            inputBox.busy = false;
            inputBox.validationMessage = '';
          } else {
            const errorMessage = generated && generated.error ? generated.error : 'Generation failed';
            inputBox.enabled = true;
            inputBox.busy = false;
            inputBox.placeholder = 'Enter description or click 🪄 to auto-generate';
            inputBox.value = '';
            inputBox.validationMessage = errorMessage;
          }
        }
      });

      inputBox.show();
    });

    if (description === undefined) {
      return;
    }

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

async function deleteRepoFromCard(repoName, owner) {
  try {
    if (!repoName) {
      return;
    }

    const confirm = await vscode.window.showWarningMessage(
      `Permanently delete '${repoName}'? This cannot be undone.`,
      { modal: true },
      'Delete'
    );

    if (confirm !== 'Delete') {
      return;
    }

    const token = await getStoredSecret(AUTH_SECRET_KEY);
    if (!token) {
      await vscode.window.showErrorMessage('Not authenticated. Please sign in first.');
      return;
    }

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
    log(`deleteRepoFromCard failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`Repository deletion failed: ${error && error.message ? error.message : error}`);
  }
}

async function updateRepoDescription(repoName, owner, description) {
  console.time(`updateRepoDescription-${repoName}`);
  try {
    if (!await ensureAuthenticated()) {
      console.timeEnd(`updateRepoDescription-${repoName}`);
      return;
    }

    const token = await getStoredSecret(AUTH_SECRET_KEY);
    console.time(`repo_manager-update_description`);
    const result = await runBackendScript('managers/repo_manager.py', {
      action: 'update_description',
      token,
      owner: owner || '',
      repo: repoName,
      description: description || ''
    });
    console.timeEnd(`repo_manager-update_description`);

    if (!result || !result.success) {
      const message = result && result.error ? result.error : 'Failed to update description';
      vscode.window.showErrorMessage(message);
      if (actionsViewProvider && actionsViewProvider.view) {
        actionsViewProvider.view.webview.postMessage({ command: 'descriptionUpdated', payload: { repoName, success: false, error: message } });
      }
    } else {
      if (actionsViewProvider && actionsViewProvider.view) {
        actionsViewProvider.view.webview.postMessage({ command: 'descriptionUpdated', payload: { repoName, success: true, description } });
      }
    }
  } catch (error) {
    log(`updateRepoDescription failed: ${error && error.message ? error.message : error}`);
    vscode.window.showErrorMessage(`Error updating description: ${error && error.message ? error.message : error}`);
    if (actionsViewProvider && actionsViewProvider.view) {
      actionsViewProvider.view.webview.postMessage({ command: 'descriptionUpdated', payload: { repoName, success: false, error: error && error.message ? error.message : String(error) } });
    }
  }
  console.timeEnd(`updateRepoDescription-${repoName}`);
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
    const config = vscode.workspace.getConfiguration('github-automator');
    const defaultBranch = config.get('defaultBranch', 'main');
    const result = await runBackendScript('managers/local_repo.py', { action: 'init_git_repo', repo_path: repoPath, default_branch: defaultBranch });
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

async function commitAndPushCommand(payload) {
  try {
    const repoPath = getWorkspacePath();
    if (!repoPath) {
      await vscode.window.showWarningMessage('Open a folder before running commit and push.');
      return;
    }

    const inputBox = vscode.window.createInputBox();
    inputBox.title = 'Commit & Push';
    inputBox.prompt = 'Auto-Generate Commit Message';
    inputBox.placeHolder = 'Type a commit message or click the $(wand) button above to generate one.';
    inputBox.ignoreFocusOut = true;
    inputBox.buttons = [
      {
        iconPath: new vscode.ThemeIcon('wand'),
        tooltip: '✨ Auto Generate'
      }
    ];

    const commitMessage = (payload && payload.message !== undefined) ? payload.message : '';
    if (commitMessage) {
      inputBox.value = commitMessage;
    }

    let resolvedMessage = '';
    let generationPending = false;

    const finalizeCommit = async (message) => {
      if (!message || !message.trim()) {
        await vscode.window.showWarningMessage('A commit message is required.');
        return;
      }

      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Committing changes',
        cancellable: false
      }, async () => {
        const config = vscode.workspace.getConfiguration('github-automator');
        const autoPush = config.get('autoPush', true);
        const token = await getStoredSecret(AUTH_SECRET_KEY);
        const announcement = await runBackendScript('managers/commit_manager.py', {
          action: 'commit_and_push',
          repo_path: repoPath,
          message: message.trim(),
          use_ai: false,
          api_key: token || '',
          auto_push: autoPush
        });

        if (!announcement || !announcement.success) {
          const detail = announcement && announcement.message ? announcement.message : 'The commit workflow failed.';
          throw new Error(detail);
        }

        await vscode.window.showInformationMessage(announcement.message || 'Commit and push completed.');
      });
    };

    inputBox.onDidAccept(async () => {
      if (generationPending) {
        return;
      }

      const message = inputBox.value.trim();
      inputBox.dispose();
      await finalizeCommit(message);
    });

    inputBox.onDidTriggerButton(async (button) => {
      if (generationPending) {
        return;
      }

      generationPending = true;
      inputBox.busy = true;
      inputBox.enabled = false;
      inputBox.placeholder = 'Generating commit message...';
      inputBox.value = '';

      try {
        const diffResult = await runBackendScript('managers/commit_manager.py', {
          action: 'get_diff',
          repo_path: repoPath,
          staged: true
        });

        if (!diffResult || !diffResult.success) {
          throw new Error(diffResult && diffResult.message ? diffResult.message : 'Unable to inspect the staged changes.');
        }

        const config = vscode.workspace.getConfiguration('github-automator');
        const anthropicModel = config.get('anthropicModel', 'claude-3-5-haiku-latest');
        const apiKey = (await getStoredSecret(ANTHROPIC_SECRET_KEY)) || '';
        const generated = await runBackendScript('services/ai_commit_cli.py', {
          diff: diffResult.diff || '',
          api_key: apiKey,
          model: anthropicModel
        });

        if (!generated || !generated.success) {
          throw new Error(generated && generated.error ? generated.error : 'AI generation failed.');
        }

        inputBox.value = generated.message || '';
        inputBox.placeholder = 'Enter a commit message';
        inputBox.enabled = true;
        inputBox.busy = false;
        inputBox.validationMessage = '';
      } catch (error) {
        inputBox.enabled = true;
        inputBox.busy = false;
        inputBox.placeholder = 'Enter a commit message';
        inputBox.value = '';
        const errorMessage = error && error.message ? error.message : 'Failed to generate commit message.';
        inputBox.validationMessage = errorMessage;
        await vscode.window.showErrorMessage(errorMessage);
      } finally {
        generationPending = false;
      }
    });

    inputBox.show();
  } catch (error) {
    log(`commitAndPush failed: ${error && error.message ? error.message : error}`);
    const msg = error && error.message ? error.message : String(error);
    if (msg.toLowerCase().includes('merge conflict')) {
      const action = await vscode.window.showErrorMessage(`Commit and push failed: ${msg}`, 'View Conflicts', 'Abort Merge');
      const repoPath = getWorkspacePath();
      if (action === 'Abort Merge') {
        const result = await runBackendScript('managers/local_repo.py', { action: 'abort_merge', repo_path: repoPath });
        if (result && result.success) {
          await vscode.window.showInformationMessage('Merge aborted successfully.');
        } else {
          await vscode.window.showErrorMessage(`Failed to abort merge: ${result ? result.error : 'Unknown error'}`);
        }
      } else if (action === 'View Conflicts') {
        const result = await runBackendScript('managers/local_repo.py', { action: 'get_conflicted_files', repo_path: repoPath });
        if (result && result.success && result.files && result.files.length > 0) {
          await vscode.window.showInformationMessage(`Conflicted files: ${result.files.join(', ')}`);
        } else {
          await vscode.window.showInformationMessage('No conflicted files found or could not retrieve them.');
        }
      }
    } else {
      await vscode.window.showErrorMessage(`Commit and push failed: ${msg}`);
    }
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

    const config = vscode.workspace.getConfiguration('github-automator');
    const anthropicModel = config.get('anthropicModel', 'claude-3-5-haiku-latest');
    const apiKey = (await getStoredSecret(ANTHROPIC_SECRET_KEY)) || '';
    const generated = await runBackendScript('services/ai_commit_cli.py', {
      diff: diffResult.diff || '',
      api_key: apiKey,
      model: anthropicModel
    });

    if (!generated || !generated.success) {
      const detail = generated && generated.error ? generated.error : 'AI generation failed.';
      await vscode.window.showErrorMessage(detail);
      return;
    }
      // If actions view is open, post the generated message to it for inline insertion
      try {
        if (actionsViewProvider && actionsViewProvider.view && actionsViewProvider.view.webview) {
          actionsViewProvider.view.webview.postMessage({ command: 'aiGenerated', message: generated.message || '' });
          return;
        }
      } catch (e) {
        // fall through to inputBox fallback
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
