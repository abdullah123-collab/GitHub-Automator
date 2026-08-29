const vscode = require('vscode');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { runPythonScript, getPersistentPythonProcess, killPersistentPythonProcess } = require('./pythonBridge');
const { callAiService, CancellationError } = require('./services/aiClient');
const { initCredentialManager, configureGeminiApiKey, removeGeminiApiKey } = require('./services/credentialManager');
const { publishFolder } = require('./services/repositoryPublisher');
const { ReadmeCodeLensProvider } = require('./readmeCodeLensProvider');
const { parseSections, matchSections, reassembleDocument } = require('./readmeSectionParser');
const { DependencyManager } = require('./services/dependencyManager');

const EXTENSION_NAME = 'GitHub Automator';
const AUTH_SECRET_KEY = 'github-automator.token';

let outputChannel;
let extensionContext;
let reposViewProvider;
let actionsViewProvider;
let readmeCodeLensProvider;
const activeReadmeSessions = new Map();

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
    webviewView.onDidChangeVisibility(() => {
      webviewView.webview.postMessage({ command: 'closePopovers' });
    });

    // If repos are already loaded from a previous session, just re-render
    // the cached state instead of calling the GitHub API again.
    if (this.state.repos.length > 0) {
      this.update();
    } else {
      await this.refreshState();
    }
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
        case 'renameRepo':
          await renameRepoCommand(message.payload);
          break;
        case 'updateDescription':
          await updateRepoDescription(message.payload && message.payload.repoName, message.payload && message.payload.owner, message.payload && message.payload.description);
          break;
        case 'autoGenerateExistingDesc':
          await autoGenerateExistingDescCommand(message.payload);
          break;
        case 'manageBranch':
          await manageBranchCommand(message.payload);
          break;
        case 'publishFolder':
          await publishFolder(extensionContext, this);
          break;
        case 'popoverAction':
          await handlePopoverAction(message.payload);
          break;
        case 'repoOptionsAction':
          await handleRepoOptionsAction(message.payload);
          break;
        default:
          break;
      }
    } catch (error) {
      this.setError(error && error.message ? error.message : 'Unexpected error');
    }
  }

  setError(message, errorType = '') {
    this.state.error = message || '';
    this.state.errorType = errorType || '';
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

  appendRepos(repos) {
    this.state.repos = this.state.repos.concat(repos);
    if (this.view) {
      const html = repos.map(repo => this.renderRepoCard(repo)).join('');
      this.view.webview.postMessage({ command: 'appendRepos', payload: html });
    }
  }

  setWorkspace(name) {
    const oldWorkspace = this.state.workspace;
    this.state.workspace = name || '';
    if (this.view && oldWorkspace !== this.state.workspace) {
      const config = vscode.workspace.getConfiguration('github-automator');
      const pinActive = config.get('pinActiveRepositoryToTop', true);
      this.view.webview.postMessage({ 
        command: 'workspaceChanged', 
        oldWorkspace, 
        newWorkspace: this.state.workspace,
        pinActive 
      });
    }
  }

  async refreshState() {
    console.log('[DIAGNOSTIC] refreshState START');
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
    console.log('[DIAGNOSTIC] refreshState END');
  }

  update() {
    if (!this.view) {
      return;
    }
    this.view.webview.html = this.getHtml();
  }

  getReposHtml() {
    const state = this.state;
    let displayRepos = [...state.repos];

    // 1. Filtering
    const visibility = state.visibilityFilter || 'all';
    if (visibility === 'public') {
      displayRepos = displayRepos.filter(r => !r.private);
    } else if (visibility === 'private') {
      displayRepos = displayRepos.filter(r => r.private);
    }

    const lang = state.languageFilter || 'all';
    if (lang !== 'all') {
      if (lang === 'N/A') {
        displayRepos = displayRepos.filter(r => !r.language || r.language === 'N/A');
      } else if (lang === 'Other') {
        const commonLangs = ['Python', 'TypeScript', 'JavaScript', 'HTML', 'CSS', 'C++', 'Java', 'Go', 'Rust', 'PHP', 'C#'];
        displayRepos = displayRepos.filter(r => r.language && r.language !== 'N/A' && !commonLangs.includes(r.language));
      } else {
        displayRepos = displayRepos.filter(r => r.language === lang);
      }
    }

    // 2. Sorting
    const sorting = state.sortOption || 'name';
    if (sorting === 'name') {
      displayRepos.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
    } else if (sorting === 'lastCommit') {
      displayRepos.sort((a, b) => {
        const da = new Date(a.pushed_at || a.updated_at || 0);
        const db = new Date(b.pushed_at || b.updated_at || 0);
        return db - da;
      });
    } else if (sorting === 'recentlyOpened') {
      const openedList = extensionContext ? extensionContext.workspaceState.get('recently-opened-repos') || [] : [];
      displayRepos.sort((a, b) => {
        let idxA = openedList.indexOf(a.name);
        let idxB = openedList.indexOf(b.name);
        if (idxA === -1) idxA = Infinity;
        if (idxB === -1) idxB = Infinity;
        return idxA - idxB;
      });
    } else if (sorting === 'stars') {
      displayRepos.sort((a, b) => (b.stargazers_count || 0) - (a.stargazers_count || 0));
    }

    // 3. Pinning active workspace at top
    if (state.pinActive !== false && state.workspace) {
      const activeIdx = displayRepos.findIndex(r => r.name === state.workspace);
      if (activeIdx > -1) {
        const [activeRepo] = displayRepos.splice(activeIdx, 1);
        displayRepos.unshift(activeRepo);
      }
    }

    const isNetworkError = state.errorType === 'network';
    const isAuthError = state.errorType === 'auth';

    let errorBannerHtml = '';
    if (state.error) {
      errorBannerHtml = `<div class="error-banner" style="padding: 8px 12px; margin-bottom: 8px; border-radius: 4px; background: rgba(244, 135, 113, 0.15); border: 1px solid var(--vscode-errorForeground, #f48771); color: var(--vscode-errorForeground, #f48771); font-size: 12px; display: flex; flex-direction: column; gap: 4px;">
        <span style="font-weight: 600;">${state.error}</span>
      </div>`;
    }

    if (displayRepos.length > 0) {
      return `${errorBannerHtml}<div class="repo-grid">${displayRepos.map(repo => this.renderRepoCard(repo)).join('')}</div>`;
    }

    if (isNetworkError) {
      return `
        <div class="network-error-container" style="display: flex; flex-direction: column; gap: 12px; align-items: center; justify-content: center; padding: 20px 10px; text-align: center;">
          <svg width="32" height="32" viewBox="0 0 16 16" fill="currentColor" style="color: var(--vscode-errorForeground, #f48771);"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 3a5 5 0 0 0-4.667 3.195l.939.342A4 4 0 0 1 8 4a4 4 0 0 1 3.728 2.537l.939-.342A5 5 0 0 0 8 3zm0 3a2 2 0 0 0-1.83 1.196l.939.342c.184-.504.663-.838 1.191-.838s1.007.334 1.191.838l.939-.342A2 2 0 0 0 8 6zm0 3a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1zm-1.5.5a1.5 1.5 0 1 1 3 0 1.5 1.5 0 0 1-3 0zm-1.5 0a3 3 0 1 1 6 0 3 3 0 0 1-6 0z"/></svg>
          <div style="font-size: 13px; font-weight: 600; color: var(--vscode-errorForeground, #f48771);">No internet connection</div>
          <div class="muted" style="font-size: 11px; margin-bottom: 5px;">Unable to connect to GitHub. Please check your internet connection.</div>
          
          <div id="offline-game-container" style="width: 100%; max-width: 100%; height: 150px; border: 1px solid var(--vscode-panel-border, #3c3c3c); background: #1a202c; position: relative; overflow: hidden; margin-top: 5px; border-radius: 4px; user-select: none; display: flex; flex-direction: column;">
            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 8px; background: rgba(0,0,0,0.3); border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c); font-family: var(--vscode-font-family); font-size: 10px; color: var(--vscode-foreground, #cccccc); font-weight: bold; pointer-events: none; z-index: 10;">
              <div style="display: flex; gap: 12px;">
                <div>SCORE: <span id="game-score">0</span></div>
                <div>BEST: <span id="game-best">0</span></div>
              </div>
              <div id="network-status-indicator" style="color: #f48771; font-weight: bold; display: none; align-items: center; gap: 4px;">
                <span style="font-size: 8px;">●</span> Offline
              </div>
            </div>
            
            <div style="position: relative; flex-grow: 1; overflow: hidden;">
              <div id="network-online-notification" style="position: absolute; top: 6px; left: 50%; transform: translateX(-50%); padding: 4px 8px; border-radius: 4px; background: #89d185; color: #1e1e1e; font-size: 10px; font-weight: bold; display: none; z-index: 11; font-family: sans-serif; pointer-events: none; white-space: nowrap; box-shadow: 0 2px 4px rgba(0,0,0,0.2);">
                ✓ Back Online!
              </div>
              
              <canvas id="offlineGameCanvas" style="display: block; width: 100%; height: 100%;"></canvas>
              
              <div id="game-overlay" style="position: absolute; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.7); display: flex; flex-direction: column; align-items: center; justify-content: center; color: white; font-family: inherit; font-size: 10px; z-index: 5; text-align: center;">
                <div id="overlay-title" style="font-weight: bold; font-size: 12px; margin-bottom: 4px; color: #61afef;">Hot Air Balloon</div>
                <div id="overlay-instructions" style="margin-bottom: 8px; color: #abb2bf; padding: 0 8px; line-height: 1.3;">
                  Press Up/W to fly up, Down/S to fly down.<br>Or click/hold canvas to fly up.
                </div>
                <button id="play-again-btn" style="width: auto; padding: 4px 10px; font-size: 10px; background: #007fd4; color: white; border: none; border-radius: 3px; cursor: pointer; font-weight: bold;">START GAME</button>
              </div>
            </div>
          </div>
        </div>
      `;
    }

    if (isAuthError) {
      return `${errorBannerHtml}<div class="muted" style="padding-top: 10px;">GitHub authentication/session error. Please connect again.</div>`;
    }

    if (state.repos.length === 0) {
      if (state.error) {
        return `${errorBannerHtml}<div class="muted" style="padding-top: 10px;">Unable to load repositories.</div>`;
      }
      return '<div class="muted" style="padding-top: 10px;">No repositories found.</div>';
    }

    return '<div class="muted" style="padding-top: 10px;">No repositories match the current filters.</div>';
  }

  getHtml() {
    const state = this.state;
    const reposHtml = state.loading
      ? '<div class="muted">Loading repositories…</div>'
      : state.authenticated
        ? this.getReposHtml()
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
          .repo-card { background: #252526; border: 1px solid transparent; border-radius: 6px; padding: 10px; transition: border-color 0.2s ease-in-out; }
          .repo-card.active { border: 1px solid var(--vscode-focusBorder); }
          .repo-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
          .repo-title-group { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
          .repo-name { font-weight: 600; margin-bottom: 4px; display: inline-block; white-space: normal; overflow: visible; text-overflow: clip; word-break: break-word; }
          .repo-action { flex-shrink: 0; margin-left: auto; width: 28px; height: 28px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: center; background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); border: none; cursor: pointer; }
          .repo-meta { font-size: 11px; color: var(--vscode-descriptionForeground); display: flex; gap: 8px; flex-wrap: wrap; margin-top: 4px; }
          .actions { display: flex; gap: 8px; margin-top: 8px; }
          .actions button { width: auto; flex: 1; }
          .pill { display: inline-flex; align-items: center; gap: 4px; font-size: 11px; padding: 2px 6px; border-radius: 999px; background: rgba(255,255,255,0.06); }
          .branch-badge { cursor: pointer; transition: background-color 0.15s ease, color 0.15s ease; }
          .branch-badge:hover { background: var(--vscode-button-secondaryHoverBackground, rgba(255,255,255,0.15)); color: var(--vscode-button-secondaryForeground, var(--vscode-foreground)); }
          .search-container { position: relative; width: 100%; display: flex; align-items: center; }
          .search-icon { position: absolute; left: 10px; display: flex; align-items: center; color: var(--vscode-icon-foreground); }
          #repoSearch { width: 100%; padding: 8px 10px 8px 32px; border-radius: 4px; background: var(--vscode-input-background, #2d2d2d); border: 1px solid transparent; color: var(--vscode-input-foreground); font-family: inherit; transition: border-color 0.1s; outline: none; }
          #repoSearch:focus { border: 1px solid var(--vscode-focusBorder, #007fd4); }

          /* Popover Styles */
          .popover {
            position: fixed;
            background: var(--vscode-menu-background, rgba(37, 37, 38, 0.96));
            border: 1px solid var(--vscode-menu-border, #3c3c3c);
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
            padding: 4px 0;
            z-index: 1000000;
            min-width: 175px;
            opacity: 0;
            transform: scale(0.96) translateY(-4px);
            transform-origin: top left;
            transition: opacity 150ms cubic-bezier(0.4, 0, 0.2, 1), transform 150ms cubic-bezier(0.4, 0, 0.2, 1);
            pointer-events: none;
            backdrop-filter: blur(8px);
            -webkit-backdrop-filter: blur(8px);
            color: var(--vscode-menu-foreground, var(--vscode-foreground));
          }
          .popover.visible {
            opacity: 1;
            transform: scale(1) translateY(0);
            pointer-events: auto;
          }
          
          .popover.submenu {
            transform: translateX(8px);
            transition: opacity 130ms cubic-bezier(0.4, 0, 0.2, 1), transform 130ms cubic-bezier(0.4, 0, 0.2, 1);
          }
          .popover.submenu.slide-left {
            transform: translateX(-8px);
          }
          .popover.submenu.visible {
            opacity: 1;
            transform: translateX(0);
          }

          .popover-item {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            transition: background 0.1s ease, color 0.1s ease;
            color: var(--vscode-menu-foreground, var(--vscode-foreground));
          }
          .popover-item:hover,
          .popover-item.focused,
          .popover-item.active-parent {
            background: var(--vscode-menu-selectionBackground, var(--vscode-list-activeSelectionBackground, #0e639c));
            color: var(--vscode-menu-selectionForeground, #ffffff);
            outline: none;
          }
          .popover-item.disabled {
            opacity: 0.4;
            cursor: not-allowed;
            pointer-events: none;
          }
          .popover-item-label {
            display: flex;
            align-items: center;
            gap: 8px;
          }
          .popover-item-label svg {
            flex-shrink: 0;
          }
          .popover-divider {
            height: 1px;
            background: var(--vscode-menu-separatorBackground, rgba(255, 255, 255, 0.08));
            margin: 4px 6px;
          }
          .branch-badge.active-badge {
            background: var(--vscode-button-background, #0e639c) !important;
            color: var(--vscode-button-foreground, #ffffff) !important;
            outline: 1px solid var(--vscode-focusBorder, #007fd4) !important;
          }
          @keyframes desc-progress-anim {
            0% { left: -100%; }
            50% { left: 0%; }
            100% { left: 100%; }
          }
          .desc-progress-line {
            height: 100%;
            width: 100%;
            background: var(--vscode-progressBar-background, #007fd4);
            position: absolute;
            left: -100%;
            animation: desc-progress-anim 1.5s infinite linear;
          }
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
          <div id="searchEmpty" class="muted" style="display: none; padding-top: 10px;">No repositories match your search.</div>
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

          const icons = {
            switchBranch: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.378a2.251 2.251 0 11-1.5 0V4.242a2.251 2.251 0 111.5 0v3.758h4a1 1 0 001-1V5.372a2.25 2.25 0 01-1.5-2.122zM3.5 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zM4.25 12a.75.75 0 10-1.5 0 .75.75 0 001.5 0z"/></svg>',
            createBranch: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 7H9V2H7v5H2v2h5v5h2V9h5z"/></svg>',
            mergeBranch: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M10 1.75a1.75 1.75 0 113.5 0 1.75 1.75 0 01-3.5 0zM11.75 3a.5.5 0 100-1 .5.5 0 000 1zm-7 5.25a1.75 1.75 0 11-3.5 0 1.75 1.75 0 013.5 0zM3 9.5a.5.5 0 100-1 .5.5 0 000 1zm8.75.75a1.75 1.75 0 113.5 0 1.75 1.75 0 01-3.5 0zm1.75 1a.5.5 0 100-1 .5.5 0 000 1zm-9.5-6h2v1h-2a2.5 2.5 0 00-2.5 2.5v1.25H2.5V8.75A3.5 3.5 0 016 5.25zM11.75 5v3.25A2.5 2.5 0 019.25 11h-2v-1h2a1.5 1.5 0 001.5-1.5V5h1z"/></svg>',
            deleteBranch: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M10 2V1H6v1H3v1h10V2h-3zM4.5 4h7v9.5a1.5 1.5 0 01-1.5 1.5h-4a1.5 1.5 0 01-2.12 0L1.44 7.81A1.5 1.5 0 011 6.75V1.5A1.5 1.5 0 012.5 0zm1.06 1.44A.5.5 0 002 2.5v4.25a.5.5 0 00.15.35l7.75 7.75a.5.5 0 00.7 0l4.25-4.25a.5.5 0 000-.7l-7.75-7.75A.5.5 0 006.75 2h-4.25zm.94.56a1 1 0 11-2 0 1 1 0 012 0z"/></svg>',
            compareBranches: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M4 1.75C4 .784 4.784 0 5.75 0h5.586a1 1 0 01.707.293l3.664 3.664a1 1 0 01.293.707v9.586A1.75 1.75 0 0114.25 16H5.75A1.75 1.75 0 014 14.25V1.75zM5.75 1.5a.25.25 0 00-.25.25v12.5c0 .138.112.25.25.25h8.5a.25.25 0 00.25-.25v-8.5H11.5a1 1 0 01-1-1V1.5H5.75zm5.75.31V4.5h2.69L11.5 1.81zM7 6h6v1H7V6zm0 3h6v1H7V9zm0 3h4v1H7v-1z"/></svg>',
            history: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1.5 8a6.5 6.5 0 119.34 5.92l-.56-.83A5.5 5.5 0 102.5 8H5V7H1v4h1V9a6.5 6.5 0 01-.5-1zm6.5-4a.5.5 0 01.5.5v3.29l1.85 1.86-.7.71-2-2A.5.5 0 017 8V4.5a.5.5 0 01.5-.5z"/></svg>',
            chevronRight: '<svg class="codicon" width="10" height="10" viewBox="0 0 16 16" fill="currentColor" style="margin-left: 8px;"><path fill-rule="evenodd" d="M4.646 1.646a.5.5 0 01.708 0l6 6a.5.5 0 010 .708l-6 6a.5.5 0 01-.708-.708L10.293 8 4.646 2.354a.5.5 0 010-.708z"/></svg>',
            fetch: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M7.47 10.78a.75.75 0 001.06 0l3.75-3.75a.75.75 0 00-1.06-1.06L8.75 8.44V1.75a.75.75 0 00-1.5 0v6.69L4.78 5.97a.75.75 0 00-1.06 1.06l3.75 3.75zM14.25 12H1.75a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5z"/></svg>',
            pull: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M7.47 10.78a.75.75 0 001.06 0l3.75-3.75a.75.75 0 00-1.06-1.06L8.75 8.44V1.75a.75.75 0 00-1.5 0v6.69L4.78 5.97a.75.75 0 00-1.06 1.06l3.75 3.75zM14.25 12H1.75a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5z"/></svg>',
            push: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8.53 1.22a.75.75 0 00-1.06 0L3.72 4.97a.75.75 0 001.06 1.06l2.47-2.47v6.69a.75.75 0 001.5 0V3.56l2.47 2.47a.75.75 0 001.06-1.06L8.53 1.22zM14.25 12H1.75a.75.75 0 000 1.5h12.5a.75.75 0 000-1.5z"/></svg>',
            sync: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1.5 8a6.5 6.5 0 0110.34-5.26l.7-.72A7.5 7.5 0 1014.24 9.5h-1.03A6.5 6.5 0 011.5 8zm10.74 3.76l-.7.71A7.5 7.5 0 101.76 6.5h1.03a6.5 6.5 0 119.45 5.26z"/></svg>',
            rebase: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M2.5 14v-2.25h11V14h-11zm5.5-3.5L4.72 7.22l.71-.72 2.52 2.53v-6.3h1.1v6.3l2.53-2.53.71.72-3.79 3.28z"/></svg>',
            cherryPick: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L10.3 5.6L15.4 6.3L11.7 9.9L12.6 15L8 12.6L3.4 15L4.3 9.9L0.6 6.3L5.7 5.6L8 1z"/></svg>',
            stash: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1 3.5A1.5 1.5 0 012.5 2h11A1.5 1.5 0 0115 3.5v2A1.5 1.5 0 0113.5 7h-.09A4.75 4.75 0 019 11.25V14.5a1.5 1.5 0 01-1.5 1.5h-3A1.5 1.5 0 013 14.5v-3.25A4.75 4.75 0 013.59 7H2.5A1.5 1.5 0 011 5.5v-2zm1.5-.5a.5.5 0 00-.5.5v2a.5.5 0 00.5.5h11a.5.5 0 00.5-.5v-2a.5.5 0 00-.5-.5h-11zm2.09 5A3.75 3.75 0 004 11.25V14.5a.5.5 0 00.5.5h3a.5.5 0 00.5-.5v-3.25c0-1.42.8-2.65 1.91-3.25h-5.41z"/></svg>',
            tag: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1.5 1h4.25a1.5 1.5 0 011.06.44l7.75 7.75a1.5 1.5 0 010 2.12l-4.25 4.25a1.5 1.5 0 01-2.12 0L1.44 7.81A1.5 1.5 0 011 6.75V1.5A1.5 1.5 0 012.5 0zm1.06 1.44A.5.5 0 002 2.5v4.25a.5.5 0 00.15.35l7.75 7.75a.5.5 0 00.7 0l4.25-4.25a.5.5 0 000-.7l-7.75-7.75A.5.5 0 006.75 2h-4.25zm.94.56a1 1 0 11-2 0 1 1 0 012 0z"/></svg>',
            rename: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.5 1h1.5v1.5L11.5 5H10v1.5L7.5 9H6v1.5L3.5 13H1v-2.5L3.5 8H5v-1.5L7.5 4H9V2.5L12.5 1z"/></svg>',
            branchFromCommit: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M8 12a4 4 0 100-8 4 4 0 000 8zm0-1a3 3 0 100-6 3 3 0 000 6zM8 4V0h1v4H8zm0 12v-4h1v4H8z"/></svg>',
            cleanMerged: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M4.5 1.75a.75.75 0 01.75-.75h8a.75.75 0 01.75.75V3h1a.75.75 0 010 1.5h-1v2.75a.75.75 0 01.75.75v1a.75.75 0 010 1.5h-.75v1a.75.75 0 01-.22.53l-3 3a.75.75 0 01-.53.22h-5a.75.75 0 01-.75-.75V11H3a.75.75 0 010-1.5h1.25V7.75a.75.75 0 01-.75-.75v-1a.75.75 0 010-1.5H4V3H3.25A.75.75 0 012.5 3V1.75zM5.5 3h7V2h-7v1zM6.5 14H10v-3H6.5v3z"/></svg>',
            lock: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M4 6V4a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1zm2-2v2h4V4a2 2 0 1 0-4 0z"/></svg>',
            remotePushCurrent: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M12.75 10a.75.75 0 01.75.75v3.5a.75.75 0 01-.75.75h-9.5A.75.75 0 012.5 14.25v-3.5a.75.75 0 011.5 0v2.75h8v-2.75a.75.75 0 01.75-.75zM7.47 1.22a.75.75 0 011.06 0l3.75 3.75a.75.75 0 01-1.06 1.06L8.75 3.56v6.69a.75.75 0 01-1.5 0V3.56L4.78 5.97a.75.75 0 01-1.06-1.06l3.75-3.75z"/></svg>',
            remotePullSpecific: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M12.75 10a.75.75 0 01.75.75v3.5a.75.75 0 01-.75.75h-9.5A.75.75 0 012.5 14.25v-3.5a.75.75 0 011.5 0v2.75h8v-2.75a.75.75 0 01.75-.75zM8.53 10.78a.75.75 0 01-1.06 0L3.72 7.03a.75.75 0 011.06-1.06L7.25 8.44V1.75a.75.75 0 011.5 0v6.69l2.47-2.47a.75.75 0 011.06 1.06l-3.75 3.75z"/></svg>',
            remoteBrowseBranches: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11.5 3h2v10h-2V3zM9 13H7V3h2v10zM4.5 13H2.5V3h2v10z"/></svg>',
            remoteAdd: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M7.75 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 017.75 2z"/></svg>',
            remoteRename: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M12.5 1h1.5v1.5L11.5 5H10v1.5L7.5 9H6v1.5L3.5 13H1v-2.5L3.5 8H5v-1.5L7.5 4H9V2.5L12.5 1z"/></svg>',
            remoteRemove: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M10 2V1H6v1H3v1h10V2h-3zM4.5 4h7v9.5a1.5 1.5 0 01-1.5 1.5h-4a1.5 1.5 0 01-1.5-1.5V4zm1 1v7.5h1V5h-1zm3 0v7.5h1V5h-1z"/></svg>',
            remotePrune: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M9.5 2V1H6.5v1H3v1h10V2H9.5zM4.5 4h7v9.5c0 .83-.67 1.5-1.5 1.5h-4c-.83 0-1.5-.67-1.5-1.5V4zM5.5 12h1V5h-1v7zm3.5-7h-1v7h1V5z"/></svg>',
            remoteChangeUpstream: '<svg class="codicon" width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" d="M1.5 8a6.5 6.5 0 0110.34-5.26l.7-.72A7.5 7.5 0 1014.24 9.5h-1.03A6.5 6.5 0 011.5 8zm10.74 3.76l-.7.71A7.5 7.5 0 101.76 6.5h1.03a6.5 6.5 0 119.45 5.26z"/></svg>'
          };

          let popovers = [];
          let lastPayload = null;
          let activeEditSession = null;

          function closeAllPopovers() {
            popovers.forEach(p => { p.element.remove(); });
            popovers = [];
            document.querySelectorAll('.branch-badge').forEach(b => {
              b.classList.remove('active-badge');
            });
          }

          function updateActiveParentHighlights() {
            document.querySelectorAll('.popover-item').forEach(el => {
              el.classList.remove('active-parent');
            });
            for (let i = 1; i < popovers.length; i++) {
              if (popovers[i].triggerItem) {
                popovers[i].triggerItem.classList.add('active-parent');
              }
            }
          }

          function createPopoverMenu(payload, menuType) {
            const el = document.createElement('div');
            el.className = 'popover';
            el.dataset.menuType = menuType;
            if (menuType !== 'main') {
              el.classList.add('submenu');
            }
            
            let html = '';
            const repoName = payload.repoName;
            
            if (!payload.isCloned) {
              html += '<div class="popover-item disabled"><span class="popover-item-label">Repository is not cloned.</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'clone\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.remoteAdd + 'Clone Repository</span></div>';
              el.innerHTML = html;
              return el;
            }
            
            if (menuType === 'main') {
              if (payload.branches && payload.branches.length > 1) {
                html += '<div class="popover-item" onclick="postAction(\\'switch\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.switchBranch + 'Switch Branch</span></div>';
              }
              html += '<div class="popover-item" onclick="postAction(\\'create\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.createBranch + 'Create Branch</span></div>';
              html += '<div class="popover-divider"></div>';
              if (payload.branches && payload.branches.length > 1) {
                html += '<div class="popover-item" onclick="openSubmenu(event, \\'branches\\')"><span class="popover-item-label">' + icons.switchBranch + 'Branches</span>' + icons.chevronRight + '</div>';
              }
              html += '<div class="popover-item" onclick="openSubmenu(event, \\'remote\\')"><span class="popover-item-label">' + icons.sync + 'Remote</span>' + icons.chevronRight + '</div>';
            }
            else if (menuType === 'branches') {
              html += '<div class="popover-item" onclick="postAction(\\'merge\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.mergeBranch + 'Merge Branch</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'delete\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.deleteBranch + 'Delete Branch</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'compare\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.compareBranches + 'Compare Branches</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'history\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.history + 'Branch History</span></div>';
              html += '<div class="popover-divider"></div>';
              html += '<div class="popover-item" onclick="openSubmenu(event, \\'advanced_branches\\')"><span class="popover-item-label">' + icons.sync + 'Advanced</span>' + icons.chevronRight + '</div>';
            }
            else if (menuType === 'advanced_branches') {
              html += '<div class="popover-item" onclick="postAction(\\'rebase\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.rebase + 'Rebase</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'cherryPick\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.cherryPick + 'Cherry Pick</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'stash\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.stash + 'Stash</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'tags\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.tag + 'Tags</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'renameBranch\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.rename + 'Rename Branch</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'branchFromCommit\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.branchFromCommit + 'Create Branch From Commit</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'cleanMerged\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.cleanMerged + 'Clean Merged Branches</span></div>';
              html += '<div class="popover-item disabled"><span class="popover-item-label">' + icons.lock + 'Protect Branch (Coming Soon)</span></div>';
            }
            else if (menuType === 'remote') {
              html += '<div class="popover-item" onclick="postAction(\\'fetch\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.fetch + 'Fetch</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'pull\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.pull + 'Pull</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'push\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.push + 'Push</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'sync\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.sync + 'Sync Repository</span></div>';
              html += '<div class="popover-divider"></div>';
              html += '<div class="popover-item" onclick="openSubmenu(event, \\'advanced_remote\\')"><span class="popover-item-label">' + icons.sync + 'Advanced</span>' + icons.chevronRight + '</div>';
            }
            else if (menuType === 'advanced_remote') {
              html += '<div class="popover-item" onclick="postAction(\\'remotePushCurrent\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.remotePushCurrent + 'Push Current Branch</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'remotePullSpecific\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.remotePullSpecific + 'Pull Specific Branch</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'remoteBrowseBranches\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.remoteBrowseBranches + 'Browse Remote Branches</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'remoteAdd\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.remoteAdd + 'Add Remote</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'remoteRename\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.remoteRename + 'Rename Remote</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'remoteRemove\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.remoteRemove + 'Remove Remote</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'remotePrune\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.remotePrune + 'Prune Remote</span></div>';
              html += '<div class="popover-item" onclick="postAction(\\'remoteChangeUpstream\\', \\'' + repoName + '\\')"><span class="popover-item-label">' + icons.remoteChangeUpstream + 'Change Upstream Branch</span></div>';
            }
            
            el.innerHTML = html;
            return el;
          }

          function openPopover(payload) {
            closeAllPopovers();
            lastPayload = payload;
            
            const badge = document.getElementById('badge-' + payload.repoName);
            if (!badge) return;
            
            badge.classList.add('active-badge');
            
            const mainPop = createPopoverMenu(payload, 'main');
            document.body.appendChild(mainPop);
            
            const rect = badge.getBoundingClientRect();
            const popHeight = mainPop.offsetHeight || 120;
            const popWidth = mainPop.offsetWidth || 175;
            
            let top = rect.bottom + 4;
            if (top + popHeight > window.innerHeight) {
              top = rect.top - popHeight - 4;
            }
            let left = rect.left;
            if (left + popWidth > window.innerWidth) {
              left = window.innerWidth - popWidth - 8;
            }
            if (left < 8) left = 8;
            
            mainPop.style.top = top + 'px';
            mainPop.style.left = left + 'px';
            
            requestAnimationFrame(() => {
              mainPop.classList.add('visible');
            });
            
            const items = Array.from(mainPop.querySelectorAll('.popover-item:not(.disabled)'));
            popovers.push({ id: 'main', element: mainPop, activeIndex: -1, items: items });
          }

          function openSubmenu(event, submenuType) {
            event.stopPropagation();
            const itemEl = event.currentTarget;
            const parentPopoverEl = itemEl.closest('.popover');
            
            const parentIdx = popovers.findIndex(p => p.element === parentPopoverEl);
            if (parentIdx === -1) return;
            
            for (let i = popovers.length - 1; i > parentIdx; i--) {
              popovers[i].element.remove();
              popovers.pop();
            }
            
            const subPop = createPopoverMenu(lastPayload, submenuType);
            document.body.appendChild(subPop);
            
            const itemRect = itemEl.getBoundingClientRect();
            const popWidth = subPop.offsetWidth || 175;
            const popHeight = subPop.offsetHeight || 200;
            
            let subLeft = itemRect.right + 2;
            let isSlideLeft = false;
            if (subLeft + popWidth > window.innerWidth) {
              subLeft = itemRect.left - popWidth - 2;
              isSlideLeft = true;
            }
            if (subLeft < 8) subLeft = 8;
            
            if (isSlideLeft) {
              subPop.classList.add('slide-left');
            }
            
            let subTop = itemRect.top;
            if (subTop + popHeight > window.innerHeight) {
              subTop = window.innerHeight - popHeight - 8;
            }
            if (subTop < 8) subTop = 8;
            
            subPop.style.left = subLeft + 'px';
            subPop.style.top = subTop + 'px';
            
            requestAnimationFrame(() => {
              subPop.classList.add('visible');
            });
            
            const items = Array.from(subPop.querySelectorAll('.popover-item:not(.disabled)'));
            popovers.push({ id: submenuType, element: subPop, activeIndex: -1, items: items, triggerItem: itemEl });
            updateActiveParentHighlights();
          }

          function postAction(action, repoName) {
            const currentBranch = lastPayload ? lastPayload.currentBranch : 'main';
            post('popoverAction', { action, repoName, currentBranch, isCloned: lastPayload.isCloned, cloneUrl: lastPayload.cloneUrl });
            closeAllPopovers();
          }

          function openRepoOptionsPopover(payload) {
            closeAllPopovers();
            lastPayload = payload;
            
            const pop = document.createElement('div');
            pop.className = 'popover';
            pop.dataset.menuType = 'options_main';
            
            let html = '';
            html += '<div class="popover-item disabled"><span class="popover-item-label">Repository Options</span></div>';
            html += '<div class="popover-divider"></div>';
            
            const pinChecked = payload.pinActive ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
            html += '<div class="popover-item" onclick="postOptionsAction(\\'togglePin\\')"><span class="popover-item-label">Pin Active Repository at Top</span>' + pinChecked + '</div>';
            html += '<div class="popover-divider"></div>';
            
            html += '<div class="popover-item" onclick="openOptionsSubmenu(event, \\'options_sort\\')"><span class="popover-item-label">Sort By</span>' + icons.chevronRight + '</div>';
            html += '<div class="popover-divider"></div>';
            
            const recentlyOpenedChecked = payload.sortOption === 'recentlyOpened' ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
            html += '<div class="popover-item" onclick="postOptionsAction(\\'setSort\\', \\'recentlyOpened\\')"><span class="popover-item-label">Recently Opened</span>' + recentlyOpenedChecked + '</div>';
            
            html += '<div class="popover-item" onclick="openOptionsSubmenu(event, \\'options_visibility\\')"><span class="popover-item-label">Visibility</span>' + icons.chevronRight + '</div>';
            
            html += '<div class="popover-item" onclick="openOptionsSubmenu(event, \\'options_language\\')"><span class="popover-item-label">Language</span>' + icons.chevronRight + '</div>';
            
            const starsChecked = payload.sortOption === 'stars' ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
            html += '<div class="popover-item" onclick="postOptionsAction(\\'setSort\\', \\'stars\\')"><span class="popover-item-label">Stars</span>' + starsChecked + '</div>';
            
            pop.innerHTML = html;
            document.body.appendChild(pop);
            
            pop.style.top = '4px';
            pop.style.right = '12px';
            pop.style.left = 'auto';
            pop.style.transformOrigin = 'top right';
            
            requestAnimationFrame(() => {
              pop.classList.add('visible');
            });
            
            const items = Array.from(pop.querySelectorAll('.popover-item:not(.disabled)'));
            popovers.push({ id: 'options_main', element: pop, activeIndex: -1, items: items });
          }

          function createOptionsSubmenu(submenuType) {
            const el = document.createElement('div');
            el.className = 'popover submenu';
            el.dataset.menuType = submenuType;
            
            let html = '';
            
            if (submenuType === 'options_sort') {
              const nameCheck = lastPayload.sortOption === 'name' ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
              const commitCheck = lastPayload.sortOption === 'lastCommit' ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
              html += '<div class="popover-item" onclick="postOptionsAction(\\'setSort\\', \\'name\\')"><span class="popover-item-label">Name</span>' + nameCheck + '</div>';
              html += '<div class="popover-item" onclick="postOptionsAction(\\'setSort\\', \\'lastCommit\\')"><span class="popover-item-label">Last Commit</span>' + commitCheck + '</div>';
            }
            else if (submenuType === 'options_visibility') {
              const publicCheck = lastPayload.visibilityFilter === 'public' ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
              const privateCheck = lastPayload.visibilityFilter === 'private' ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
              const allCheck = lastPayload.visibilityFilter === 'all' ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
              html += '<div class="popover-item" onclick="postOptionsAction(\\'setVisibility\\', \\'public\\')"><span class="popover-item-label">Public</span>' + publicCheck + '</div>';
              html += '<div class="popover-item" onclick="postOptionsAction(\\'setVisibility\\', \\'private\\')"><span class="popover-item-label">Private</span>' + privateCheck + '</div>';
              html += '<div class="popover-item" onclick="postOptionsAction(\\'setVisibility\\', \\'all\\')"><span class="popover-item-label">All</span>' + allCheck + '</div>';
            }
            else if (submenuType === 'options_language') {
              const allCheck = lastPayload.languageFilter === 'all' ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
              html += '<div class="popover-item" onclick="postOptionsAction(\\'setLanguage\\', \\'all\\')"><span class="popover-item-label">All</span>' + allCheck + '</div>';
              
              if (lastPayload.languages) {
                lastPayload.languages.forEach(lang => {
                  const check = lastPayload.languageFilter === lang ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
                  html += '<div class="popover-item" onclick="postOptionsAction(\\'setLanguage\\', \\'' + lang + '\\')"><span class="popover-item-label">' + lang + '</span>' + check + '</div>';
                });
              }
              
              const naCheck = lastPayload.languageFilter === 'N/A' ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
              html += '<div class="popover-item" onclick="postOptionsAction(\\'setLanguage\\', \\'N/A\\')"><span class="popover-item-label">N/A</span>' + naCheck + '</div>';
              
              const otherCheck = lastPayload.languageFilter === 'Other' ? ' <span style="font-weight:bold; margin-left:auto;">✓</span>' : '';
              html += '<div class="popover-item" onclick="postOptionsAction(\\'setLanguage\\', \\'Other\\')"><span class="popover-item-label">Other</span>' + otherCheck + '</div>';
            }
            
            el.innerHTML = html;
            return el;
          }

          function openOptionsSubmenu(event, submenuType) {
            event.stopPropagation();
            const itemEl = event.currentTarget;
            const parentPopoverEl = itemEl.closest('.popover');
            
            const parentIdx = popovers.findIndex(p => p.element === parentPopoverEl);
            if (parentIdx === -1) return;
            
            for (let i = popovers.length - 1; i > parentIdx; i--) {
              popovers[i].element.remove();
              popovers.pop();
            }
            
            const subPop = createOptionsSubmenu(submenuType);
            document.body.appendChild(subPop);
            
            const itemRect = itemEl.getBoundingClientRect();
            const popWidth = subPop.offsetWidth || 175;
            const popHeight = subPop.offsetHeight || 200;
            
            let subLeft = itemRect.right + 2;
            let isSlideLeft = false;
            if (subLeft + popWidth > window.innerWidth) {
              subLeft = itemRect.left - popWidth - 2;
              isSlideLeft = true;
            }
            if (subLeft < 8) subLeft = 8;
            
            if (isSlideLeft) {
              subPop.classList.add('slide-left');
            }
            
            let subTop = itemRect.top;
            if (subTop + popHeight > window.innerHeight) {
              subTop = window.innerHeight - popHeight - 8;
            }
            if (subTop < 8) subTop = 8;
            
            subPop.style.left = subLeft + 'px';
            subPop.style.top = subTop + 'px';
            
            requestAnimationFrame(() => {
              subPop.classList.add('visible');
            });
            
            const items = Array.from(subPop.querySelectorAll('.popover-item:not(.disabled)'));
            popovers.push({ id: submenuType, element: subPop, activeIndex: -1, items: items, triggerItem: itemEl });
            updateActiveParentHighlights();
          }

          function postOptionsAction(action, value) {
            post('repoOptionsAction', { action, value });
            closeAllPopovers();
          }

          // Outside Click using Capture phase to immediately dismiss on any click outside
          document.addEventListener('click', (e) => {
            if (e.target.closest('.branch-badge') || e.target.closest('.popover')) {
              return;
            }
            closeAllPopovers();
          }, true);
          
          // Close immediately on scroll of viewport/containers
          window.addEventListener('scroll', () => {
            closeAllPopovers();
          }, true);

          // Keyboard Navigation
          document.addEventListener('keydown', (e) => {
            if (popovers.length === 0) {
              return;
            }

            const current = popovers[popovers.length - 1];
            const items = current.items;

            if (e.key === 'Escape') {
              e.preventDefault();
              if (popovers.length > 1) {
                const popped = popovers.pop();
                popped.element.remove();
                updateActiveParentHighlights();
              } else {
                closeAllPopovers();
              }
            }
            else if (e.key === 'ArrowDown') {
              e.preventDefault();
              if (items.length === 0) return;
              if (current.activeIndex >= 0 && current.activeIndex < items.length) {
                items[current.activeIndex].classList.remove('focused');
              }
              current.activeIndex = (current.activeIndex + 1) % items.length;
              items[current.activeIndex].classList.add('focused');
            }
            else if (e.key === 'ArrowUp') {
              e.preventDefault();
              if (items.length === 0) return;
              if (current.activeIndex >= 0 && current.activeIndex < items.length) {
                items[current.activeIndex].classList.remove('focused');
              }
              current.activeIndex = (current.activeIndex - 1 + items.length) % items.length;
              items[current.activeIndex].classList.add('focused');
            }
            else if (e.key === 'ArrowRight') {
              e.preventDefault();
              if (current.activeIndex >= 0 && current.activeIndex < items.length) {
                const item = items[current.activeIndex];
                if (item.getAttribute('onclick') && item.getAttribute('onclick').includes('openSubmenu')) {
                  item.click();
                  setTimeout(() => {
                    if (popovers.length > 0) {
                      const nextMenu = popovers[popovers.length - 1];
                      if (nextMenu.items.length > 0) {
                        nextMenu.activeIndex = 0;
                        nextMenu.items[0].classList.add('focused');
                      }
                    }
                  }, 50);
                }
              }
            }
            else if (e.key === 'ArrowLeft') {
              e.preventDefault();
              if (popovers.length > 1) {
                const popped = popovers.pop();
                popped.element.remove();
                updateActiveParentHighlights();
              }
            }
            else if (e.key === 'Enter') {
              e.preventDefault();
              if (current.activeIndex >= 0 && current.activeIndex < items.length) {
                items[current.activeIndex].click();
              }
            }
          });

          let activeNameEditSession = null;

          function editRepoName(element) {
            if (activeNameEditSession) {
              if (activeNameEditSession.element === element) return;
              activeNameEditSession.cancel();
            }

            const currentName = element.getAttribute('data-repo') || element.innerText.trim();
            const owner = element.getAttribute('data-owner') || '';
            const repoId = element.getAttribute('data-id') || '';
            const originalHtml = element.innerHTML;

            element.classList.add('editing');
            element.innerHTML = 
              '<div class="repo-name-editor" style="display: flex; flex-direction: column; gap: 2px; width: 100%; box-sizing: border-box; cursor: default;">' +
                '<div style="display: flex; align-items: center; gap: 4px; width: 100%; box-sizing: border-box;">' +
                  '<input type="text" class="repo-name-input" aria-label="Repository name" value="' + currentName.replace(/"/g, '&quot;') + '" style="flex: 1; min-width: 80px; max-width: 220px; box-sizing: border-box; padding: 2px 6px; font-size: 13px; font-weight: 600; font-family: inherit; background: var(--vscode-input-background, #1e1e1e); color: var(--vscode-input-foreground, #cccccc); border: 1px solid var(--vscode-focusBorder, #007fd4); border-radius: 3px; outline: none;" />' +
                  '<button class="repo-name-btn confirm" aria-label="Confirm rename" title="Confirm rename (Enter)" style="flex-shrink: 0; width: 22px; height: 22px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: var(--vscode-button-background, #0e639c); color: var(--vscode-button-foreground, #ffffff); border: none; border-radius: 3px; cursor: pointer; font-size: 12px; font-weight: bold;">✓</button>' +
                  '<button class="repo-name-btn cancel" aria-label="Cancel rename" title="Cancel rename (Escape)" style="flex-shrink: 0; width: 22px; height: 22px; padding: 0; display: inline-flex; align-items: center; justify-content: center; background: var(--vscode-button-secondaryBackground, #3a3d41); color: var(--vscode-button-secondaryForeground, #ffffff); border: none; border-radius: 3px; cursor: pointer; font-size: 12px;">✕</button>' +
                '</div>' +
                '<div class="repo-name-error" style="color: var(--vscode-errorForeground, #f48771); font-size: 11px; display: none; margin-top: 2px; line-height: 1.2;"></div>' +
              '</div>';

            const input = element.querySelector('.repo-name-input');
            const confirmBtn = element.querySelector('.repo-name-btn.confirm');
            const cancelBtn = element.querySelector('.repo-name-btn.cancel');
            const errorEl = element.querySelector('.repo-name-error');

            input.focus();
            input.select();

            let isSubmitting = false;

            const validateClientSide = (val) => {
              const trimmed = (val || '').trim();
              if (!trimmed) {
                return 'Repository name cannot be empty.';
              }
              if (trimmed.length > 100) {
                return 'Repository name cannot exceed 100 characters.';
              }
              if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
                return 'Only letters, numbers, hyphens, periods, and underscores allowed.';
              }
              if (/^[.-]/.test(trimmed) || /[.-]$/.test(trimmed)) {
                return 'Cannot start or end with a period or hyphen.';
              }
              if (trimmed.toLowerCase() === '.git' || trimmed.toLowerCase().endsWith('.git')) {
                return 'Cannot end with .git.';
              }
              return null;
            };

            const cancel = () => {
              if (activeNameEditSession && activeNameEditSession.element === element) {
                activeNameEditSession = null;
              }
              element.classList.remove('editing');
              element.innerHTML = originalHtml;
            };

            const save = () => {
              if (isSubmitting) return;
              const newName = input.value.trim();
              if (newName === currentName) {
                cancel();
                return;
              }

              const err = validateClientSide(newName);
              if (err) {
                errorEl.innerText = err;
                errorEl.style.display = 'block';
                input.style.borderColor = 'var(--vscode-errorForeground, #f48771)';
                return;
              }

              isSubmitting = true;
              input.disabled = true;
              confirmBtn.disabled = true;
              cancelBtn.disabled = true;
              confirmBtn.innerHTML = '<span class="loading" style="width: 10px; height: 10px; display: inline-block; border-radius: 50%;"></span>';
              errorEl.style.display = 'none';

              post('renameRepo', {
                oldName: currentName,
                newName: newName,
                owner: owner,
                id: repoId
              });
            };

            const handleRenamed = (payload) => {
              if (payload.noOp) {
                cancel();
                return;
              }
              const confirmedName = payload.newName || input.value.trim();
              if (activeNameEditSession && activeNameEditSession.element === element) {
                activeNameEditSession = null;
              }
              element.classList.remove('editing');
              element.setAttribute('data-repo', confirmedName);
              element.innerText = confirmedName;

              const card = element.closest('.repo-card');
              if (card) {
                card.id = 'repo-card-' + confirmedName;
                const openCloneSpan = card.querySelector('.repo-icon-container span');
                if (openCloneSpan && payload.cloneUrl) {
                  openCloneSpan.setAttribute('onclick', "post('openRepo', { repoName: '" + confirmedName.replace(/'/g, "\\'") + "', cloneUrl: '" + payload.cloneUrl.replace(/'/g, "\\'") + "' })");
                }
                const descEl = card.querySelector('[id^="desc-"]');
                if (descEl) {
                  descEl.id = 'desc-' + confirmedName;
                  descEl.setAttribute('ondblclick', "editDescription('" + confirmedName.replace(/'/g, "\\'") + "', '" + owner.replace(/'/g, "\\'") + "', this)");
                }
                const badgeEl = card.querySelector('.branch-badge');
                if (badgeEl) {
                  badgeEl.id = 'badge-' + confirmedName;
                  const branchName = badgeEl.innerText.trim();
                  badgeEl.setAttribute('onclick', "post('manageBranch', { repoName: '" + confirmedName.replace(/'/g, "\\'") + "', owner: '" + owner.replace(/'/g, "\\'") + "', isCloned: " + (payload.cloneUrl ? 'true' : 'false') + ", cloneUrl: '" + (payload.cloneUrl || '').replace(/'/g, "\\'") + "', currentBranch: '" + branchName + "' })");
                }
                const trashBtn = card.querySelector('.repo-action');
                if (trashBtn) {
                  trashBtn.setAttribute('onclick', "post('deleteRepo', { repoName: '" + confirmedName.replace(/'/g, "\\'") + "', owner: '" + owner.replace(/'/g, "\\'") + "' })");
                }

                if (payload.sortOption === 'name') {
                  const grid = document.querySelector('.repo-grid');
                  if (grid) {
                    const cards = Array.from(grid.querySelectorAll('.repo-card'));
                    cards.sort((a, b) => {
                      const nameA = (a.querySelector('.repo-name') && a.querySelector('.repo-name').getAttribute('data-repo') || '').toLowerCase();
                      const nameB = (b.querySelector('.repo-name') && b.querySelector('.repo-name').getAttribute('data-repo') || '').toLowerCase();
                      return nameA.localeCompare(nameB);
                    });
                    cards.forEach(c => grid.appendChild(c));
                  }
                }
              }
            };

            const handleFailed = (payload) => {
              isSubmitting = false;
              input.disabled = false;
              confirmBtn.disabled = false;
              cancelBtn.disabled = false;
              confirmBtn.innerHTML = '✓';
              errorEl.innerText = payload.error || 'Failed to rename repository';
              errorEl.style.display = 'block';
              input.style.borderColor = 'var(--vscode-errorForeground, #f48771)';
              input.focus();
            };

            activeNameEditSession = {
              element,
              repoName: currentName,
              owner,
              cancel,
              save,
              handleRenamed,
              handleFailed
            };

            confirmBtn.onmousedown = (e) => e.preventDefault();
            confirmBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              save();
            };

            cancelBtn.onmousedown = (e) => e.preventDefault();
            cancelBtn.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              cancel();
            };

            input.onkeydown = (e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                save();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            };

            input.onblur = (e) => {
              if (isSubmitting) return;
              if (e.relatedTarget === confirmBtn || e.relatedTarget === cancelBtn) return;
              cancel();
            };
          }

          document.addEventListener('dblclick', (e) => {
            const repoNameEl = e.target.closest('.repo-name');
            if (!repoNameEl || repoNameEl.classList.contains('editing') || repoNameEl.querySelector('input')) return;
            e.stopPropagation();
            e.preventDefault();
            editRepoName(repoNameEl);
          });

          function editDescription(repoName, owner, element) {
            if (activeEditSession) {
              if (activeEditSession.element === element) return;
              activeEditSession.cancel();
            }

            const currentDesc = element.innerText === 'No description provided.' ? '' : element.innerText;
            element.ondblclick = null;
            
            element.innerHTML = 
              '<div style="display: flex; flex-direction: column; width: 100%; box-sizing: border-box; cursor: default;">' +
                '<div style="display: flex; gap: 4px; align-items: flex-start; width: 100%; box-sizing: border-box;">' +
                  '<textarea class="desc-edit-input" style="flex: 1; box-sizing: border-box; padding: 4px; background: var(--vscode-input-background); color: var(--vscode-input-foreground); border: 1px solid var(--vscode-focusBorder); outline: none; border-radius: 2px; min-height: 24px; max-height: 120px; resize: vertical; font-family: inherit; font-size: 12px; font-style: normal; width: 100%; min-width: 0; height: auto;">' + currentDesc.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</textarea>' +
                  '<button title="✨ Auto Generate Description" style="background: transparent; border: none; cursor: pointer; padding: 4px; color: var(--vscode-icon-foreground); display: flex; align-items: center; justify-content: center; margin-top: 2px; flex-shrink: 0; width: auto;">' +
                    '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.158 13.844L12.784 5.22l-.707-.707-8.625 8.624.706.707zm7.575-8.544l2.122 2.122 1.414-1.414-2.121-2.122-1.415 1.414zM1.5 15.5l1.414 1.414 2.121-2.121L3.62 12.67 1.5 14.793v.707zM11 2.5a.5.5 0 0 1 .5-.5h2V0h1v2h2v1h-2v2h-1V3h-2a.5.5 0 0 1-.5-.5zm-4-1a.5.5 0 0 1 .5-.5h1V0h1v1h1v1H9v1H8V2H7a.5.5 0 0 1-.5-.5z"/></svg>' +
                  '</button>' +
                '</div>' +
                '<div class="desc-progress-container" style="height: 3px; width: 100%; background: var(--vscode-input-background, #1e1e1e); overflow: hidden; position: relative; border-radius: 2px; margin-top: 4px; display: none;">' +
                  '<div class="desc-progress-line"></div>' +
                '</div>' +
                '<div class="desc-status-text" style="font-size: 11px; margin-top: 4px; min-height: 14px; display: none;"></div>' +
              '</div>';

            const input = element.querySelector('textarea');
            const button = element.querySelector('button');
            const progressContainer = element.querySelector('.desc-progress-container');
            const statusText = element.querySelector('.desc-status-text');

            input.focus();

            const setEditorState = (newState, payload = {}) => {
              if (!activeEditSession || activeEditSession.element !== element) return;
              activeEditSession.state = newState;

              if (newState === 'generating') {
                input.disabled = true;
                progressContainer.style.display = 'block';
                statusText.style.display = 'block';
                statusText.className = 'desc-status-text';
                statusText.innerText = 'Generating description...';
                statusText.style.color = 'var(--vscode-descriptionForeground)';
                button.innerHTML = '<span class="loading" style="width: 14px; height: 14px; display: inline-block; border-radius: 50%;"></span>';
              } 
              else if (newState === 'generated/review') {
                input.disabled = false;
                progressContainer.style.display = 'none';
                statusText.style.display = 'block';
                statusText.className = 'desc-status-text modified';
                statusText.innerText = 'Description has been modified';
                statusText.style.color = 'var(--vscode-progressBar-background, #007fd4)';
                button.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.158 13.844L12.784 5.22l-.707-.707-8.625 8.624.706.707zm7.575-8.544l2.122 2.122 1.414-1.414-2.121-2.122-1.415 1.414zM1.5 15.5l1.414 1.414 2.121-2.121L3.62 12.67 1.5 14.793v.707zM11 2.5a.5.5 0 0 1 .5-.5h2V0h1v2h2v1h-2v2h-1V3h-2a.5.5 0 0 1-.5-.5zm-4-1a.5.5 0 0 1 .5-.5h1V0h1v1h1v1H9v1H8V2H7a.5.5 0 0 1-.5-.5z"/></svg>';
                input.focus();
              } 
              else if (newState === 'saving') {
                input.disabled = true;
                progressContainer.style.display = 'none';
                statusText.style.display = 'block';
                statusText.className = 'desc-status-text saving';
                statusText.innerText = 'Saving...';
                statusText.style.color = 'var(--vscode-descriptionForeground)';
              } 
              else if (newState === 'saved') {
                input.disabled = true;
                progressContainer.style.display = 'none';
                statusText.style.display = 'block';
                statusText.className = 'desc-status-text modified';
                statusText.innerText = 'Description has been modified';
                statusText.style.color = 'var(--vscode-progressBar-background, #007fd4)';
              } 
              else if (newState === 'error') {
                input.disabled = false;
                progressContainer.style.display = 'none';
                statusText.style.display = 'block';
                statusText.className = 'desc-status-text error';
                statusText.innerText = payload.error || 'Failed to save description';
                statusText.style.color = 'var(--vscode-errorForeground, #f48771)';
                button.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.158 13.844L12.784 5.22l-.707-.707-8.625 8.624.706.707zm7.575-8.544l2.122 2.122 1.414-1.414-2.121-2.122-1.415 1.414zM1.5 15.5l1.414 1.414 2.121-2.121L3.62 12.67 1.5 14.793v.707zM11 2.5a.5.5 0 0 1 .5-.5h2V0h1v2h2v1h-2v2h-1V3h-2a.5.5 0 0 1-.5-.5zm-4-1a.5.5 0 0 1 .5-.5h1V0h1v1h1v1H9v1H8V2H7a.5.5 0 0 1-.5-.5z"/></svg>';
                input.focus();
              }
            };

            const triggerGeneration = () => {
              setEditorState('generating');
              post('autoGenerateExistingDesc', { repoName, owner });
            };

            const save = () => {
              if (!activeEditSession || activeEditSession.element !== element) return;
              if (activeEditSession.state === 'saving') return;
              
              const newDesc = input.value;
              setEditorState('saving');
              element.dataset.original = currentDesc || 'No description provided.';
              post('updateDescription', { repoName, owner, description: newDesc });
            };

            const cancel = () => {
              if (activeEditSession && activeEditSession.element === element) {
                activeEditSession = null;
              }
              element.innerHTML = currentDesc || 'No description provided.';
              element.dataset.generating = 'false';
              element.ondblclick = function() { editDescription(repoName, owner, element); };
            };

            const handleGenerated = (payload) => {
              if (payload.success) {
                input.value = payload.description;
                setEditorState('generated/review');
              } else {
                setEditorState('error', { error: payload.error || 'Generation failed' });
              }
            };

            const handleUpdated = (payload) => {
              if (payload.success) {
                setEditorState('saved');
                setTimeout(() => {
                  if (activeEditSession && activeEditSession.element === element) {
                    activeEditSession = null;
                  }
                  element.innerHTML = payload.description || 'No description provided.';
                  element.ondblclick = function() { editDescription(repoName, owner, element); };
                }, 1000);
              } else {
                setEditorState('error', { error: payload.error || 'Failed to update description' });
              }
            };

            activeEditSession = {
              element,
              repoName,
              owner,
              state: 'idle',
              cancel,
              save,
              handleGenerated,
              handleUpdated
            };

            button.onmousedown = (e) => e.preventDefault();
            button.onclick = (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (activeEditSession.state === 'generating' || activeEditSession.state === 'saving') return;
              triggerGeneration();
            };

            input.onkeydown = (e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (activeEditSession.state === 'generating' || activeEditSession.state === 'saving') {
                  return;
                }
                save();
              }
              if (e.key === 'Escape') {
                cancel();
              }
            };

            input.onblur = (e) => {
              if (activeEditSession.state === 'generating' || activeEditSession.state === 'saving') return;
              if (e.relatedTarget === button || button.contains(e.relatedTarget)) return;
              cancel();
            };
          }

          ${fs.readFileSync(path.join(__dirname, 'game', 'offlineGame.js'), 'utf8')}

           window.addEventListener('message', event => {
            const message = event.data;
            if (message.command === 'openPopover') {
              openPopover(message.payload);
              window.focus();
            } else if (message.command === 'openRepoOptionsPopover') {
              openRepoOptionsPopover(message.payload);
              window.focus();
            } else if (message.command === 'descriptionGenerated') {
              if (activeEditSession && activeEditSession.repoName === message.payload.repoName) {
                activeEditSession.handleGenerated(message.payload);
              } else {
                const el = document.getElementById('desc-' + message.payload.repoName);
                if (el) {
                  el.dataset.generating = 'false';
                  const input = el.querySelector('textarea');
                  const btn = el.querySelector('button');
                  if (input && btn) {
                    input.disabled = false;
                    if (message.payload.success) {
                      input.value = message.payload.description;
                    }
                    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M4.158 13.844L12.784 5.22l-.707-.707-8.625 8.624.706.707zm7.575-8.544l2.122 2.122 1.414-1.414-2.121-2.122-1.415 1.414zM1.5 15.5l1.414 1.414 2.121-2.121L3.62 12.67 1.5 14.793v.707zM11 2.5a.5.5 0 0 1 .5-.5h2V0h1v2h2v1h-2v2h-1V3h-2a.5.5 0 0 1-.5-.5zm-4-1a.5.5 0 0 1 .5-.5h1V0h1v1h1v1H9v1H8V2H7a.5.5 0 0 1-.5-.5z"/></svg>';
                    input.focus();
                  }
                }
              }
            } else if (message.command === 'closePopovers') {
              closeAllPopovers();
            } else if (message.command === 'reposUpdated') {
              const grid = document.querySelector('.repo-grid');
              if (grid) {
                const activeEditInput = document.querySelector('.desc-edit-input');
                if (activeEditInput) {
                  const editingCard = activeEditInput.closest('.repo-card');
                  const editingCardId = editingCard ? editingCard.id : null;
                  
                  const parser = new DOMParser();
                  const doc = parser.parseFromString(message.payload.html, 'text/html');
                  const newCards = doc.querySelectorAll('.repo-card');
                  
                  const currentCards = Array.from(grid.querySelectorAll('.repo-card'));
                  
                  grid.innerHTML = '';
                  newCards.forEach(newCard => {
                    if (editingCardId && newCard.id === editingCardId) {
                      const oldCard = currentCards.find(c => c.id === editingCardId);
                      if (oldCard) {
                        grid.appendChild(oldCard);
                        return;
                      }
                    }
                    grid.appendChild(newCard);
                  });
                } else {
                  grid.innerHTML = message.payload.html;
                }
              } else {
                const shell = document.querySelector('.shell');
                if (shell) {
                  const oldGrid = shell.querySelector('.repo-grid');
                  if (oldGrid) oldGrid.remove();
                  const oldMuted = shell.querySelector('.muted');
                  if (oldMuted) oldMuted.remove();
                  shell.insertAdjacentHTML('beforeend', message.payload.html);
                }
              }
            } else if (message.command === 'descriptionUpdated') {
              if (activeEditSession && activeEditSession.repoName === message.payload.repoName) {
                activeEditSession.handleUpdated(message.payload);
              } else {
                const element = document.getElementById('desc-' + message.payload.repoName);
                if (element) {
                  if (message.payload.success) {
                    element.innerHTML = message.payload.description || 'No description provided.';
                  } else {
                    element.innerHTML = element.dataset.original || 'No description provided.';
                  }
                  const owner = element.getAttribute('data-owner');
                  element.ondblclick = function() { editDescription(message.payload.repoName, owner, element); };
                }
              }
            } else if (message.command === 'repoRenamed') {
              if (activeNameEditSession && activeNameEditSession.repoName === message.payload.oldName) {
                activeNameEditSession.handleRenamed(message.payload);
              } else {
                const el = document.getElementById('repo-name-' + message.payload.oldName);
                if (el) {
                  el.setAttribute('data-repo', message.payload.newName);
                  el.innerText = message.payload.newName;
                  el.id = 'repo-name-' + message.payload.newName;
                }
                const card = document.getElementById('repo-card-' + message.payload.oldName);
                if (card) {
                  card.id = 'repo-card-' + message.payload.newName;
                }
              }
            } else if (message.command === 'repoRenameFailed') {
              if (activeNameEditSession && activeNameEditSession.repoName === message.payload.oldName) {
                activeNameEditSession.handleFailed(message.payload);
              }
            } else if (message.command === 'appendRepos') {
              const grid = document.querySelector('.repo-grid');
              if (grid) {
                grid.insertAdjacentHTML('beforeend', message.payload);
              }
            } else if (message.command === 'repoCreated') {
              const grid = document.querySelector('.repo-grid');
              if (grid) {
                grid.insertAdjacentHTML('afterbegin', message.payload.html);
              }
            } else if (message.command === 'repoDeleted') {
              const element = document.getElementById('repo-card-' + message.payload.repoName);
              if (element) {
                element.remove();
              }
            } else if (message.command === 'workspaceChanged') {
              if (message.oldWorkspace) {
                const oldCard = document.getElementById('repo-card-' + message.oldWorkspace);
                if (oldCard) oldCard.classList.remove('active');
              }
              if (message.newWorkspace) {
                const newCard = document.getElementById('repo-card-' + message.newWorkspace);
                if (newCard) {
                  newCard.classList.add('active');
                  if (message.pinActive) {
                    const grid = document.querySelector('.repo-grid');
                    if (grid) {
                      grid.prepend(newCard);
                    }
                  }
                }
              }
            }
          });

          // Initialize game if elements exist
          initOfflineGame();

          document.addEventListener('DOMContentLoaded', () => {
            initOfflineGame();
            const input = document.getElementById('repoSearch');
            if (!input) return;
            input.addEventListener('input', () => {
              const q = (input.value || '').toLowerCase().trim();
              let hasMatch = false;
              document.querySelectorAll('.repo-card').forEach(c => {
                const name = (c.querySelector('.repo-name') && c.querySelector('.repo-name').innerText.toLowerCase()) || '';
                const desc = (c.querySelector('.muted') && c.querySelector('.muted').innerText.toLowerCase()) || '';
                const match = (!q || name.includes(q) || desc.includes(q));
                c.style.display = match ? '' : 'none';
                if (match) hasMatch = true;
              });
              const searchEmpty = document.getElementById('searchEmpty');
              if (searchEmpty) {
                searchEmpty.style.display = (!hasMatch && q) ? 'block' : 'none';
              }
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
    const languageColors = {
      JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219',
      'C++': '#f34b7d', C: '#555555', 'C#': '#178600', Ruby: '#701516', Go: '#00ADD8',
      Rust: '#dea584', PHP: '#4F5D95', HTML: '#e34c26', CSS: '#563d7c', Swift: '#F05138',
      Kotlin: '#A97BFF', Dart: '#00B4AB', Shell: '#89e051', Vue: '#41b883',
      ObjectiveC: '#438eff', Lua: '#000080', Scala: '#c22d40', Perl: '#0298c3',
      Haskell: '#5e5086', Elixir: '#6e4a7e', Clojure: '#db5855'
    };

    const lockSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="margin-right:2px"><path d="M4 6V4a4 4 0 1 1 8 0v2h1a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h1zm2-2v2h4V4a2 2 0 1 0-4 0z"/></svg>`;
    const globeSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="margin-right:2px; vertical-align: middle;"><path fill-rule="evenodd" clip-rule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14zm0 1c4.418 0 8-3.582 8-8s-3.582-8-8-8-8 3.582-8 8 3.582 8 8 8zm0-14a6 6 0 0 1 3.53 1.156c-.22.441-.497.8-.823 1.047-.367.279-.81.428-1.282.445a1.86 1.86 0 0 1-1.396-.549l-.096-.1a.75.75 0 0 0-1.127.05L5.787 5.25a.75.75 0 0 0-.022 1.026l1.246 1.353-.162.324A1.332 1.332 0 0 1 5.655 8.71H4.25c-.247 0-.482-.09-.663-.25l-.89-.79a5.98 5.98 0 0 1 .496-4.577C3.996 2.378 5.862 2 8 2zM3.486 9.475a5.972 5.972 0 0 1-.365-2.22l.487.433c.362.32.83.502 1.318.513l.89-.96-.467-.507a2.25 2.25 0 0 1 .067-3.078l1.037-.951A6.02 6.02 0 0 1 8 3.018c.28.326.657.518 1.059.543.645.04 1.258-.231 1.7-.732a5.992 5.992 0 0 1 2.128 4.296h-1.579a.75.75 0 0 0-.663.398l-.403.805a.75.75 0 0 0 .285.993l1.378.827A5.975 5.975 0 0 1 8 13.98c-1.354 0-2.585-.45-3.568-1.206L5.38 12.3c.34-.145.603-.42.727-.76a1.996 1.996 0 0 0-1.134-2.459L3.486 9.475zm9.467.575a6.002 6.002 0 0 0 1.93-3.05H12.89a2.25 2.25 0 0 1-1.99-1.194l-.403-.805A2.25 2.25 0 0 1 11.35 1.5c.01-.17.013-.34.009-.508A5.995 5.995 0 0 1 14.887 5H12.92c-.398 0-.78-.158-1.06-.44L10.3 3a.75.75 0 0 0-1.06 0L8.204 4.037a.75.75 0 0 0 .217 1.242l.623.25c.348.14.568.49.544.866-.023.359-.22.682-.533.86a2.247 2.247 0 0 1-1.92.203l-.402-.16a.75.75 0 0 0-.895.234l-.8 1.067a.75.75 0 0 0-.115.654l.32 1.282a6.006 6.006 0 0 0 3.731 3.513c-.046-.388-.002-.782.13-1.146l.45-1.238c.182-.5.59-.88 1.1-.986l1.385-.29z"/></svg>`;
    const starSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="margin-right:2px"><path d="M8 1L10.3 5.6L15.4 6.3L11.7 9.9L12.6 15L8 12.6L3.4 15L4.3 9.9L0.6 6.3L5.7 5.6L8 1z"/></svg>`;
    const folderSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M14 4h-4.5L8 2H2C.9 2 0 2.9 0 4v8c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 8H2V4h5.5l1.5 2H14v6z"/></svg>`;
    const cloudSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 5c-.3 0-.6.1-.9.1A4.5 4.5 0 0 0 2 6.5C.9 6.8 0 8 0 9.5 0 11.4 1.6 13 3.5 13h7.5c2.2 0 4-1.8 4-4s-1.8-4-4-4z"/></svg>`;
    const trashSvg = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M11 2V0H5v2H0v2h1v10c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V4h1V2h-5zm-4 12H5V5h2v9zm4 0H9V5h2v9z"/></svg>`;

    const visibility = repo.private ? `${lockSvg} Private` : `${globeSvg} Public`;
    const description = repo.description ? repo.description : 'No description provided.';
    
    const langName = repo.language || 'N/A';
    const langColor = languageColors[langName] || '#888888';
    const languageHtml = `<span class="pill" style="display:flex; align-items:center;"><span style="display:inline-block; width:8px; height:8px; border-radius:50%; background-color:${langColor}; margin-right:4px;"></span>${langName}</span>`;
    
    const repoName = (repo.name || 'Repository').replace(/'/g, "\\'");
    const cloneUrl = (repo.clone_url || '').replace(/'/g, "\\'");
    const owner = typeof repo.owner === 'string' ? repo.owner : (repo.owner && repo.owner.login ? repo.owner.login : '');

    const branchName = repo.current_branch || 'main';
    const branchSvg = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="margin-right:2px"><path fill-rule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.378a2.251 2.251 0 11-1.5 0V4.242a2.251 2.251 0 111.5 0v3.758h4a1 1 0 001-1V5.372a2.25 2.25 0 01-1.5-2.122zM3.5 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zM4.25 12a.75.75 0 10-1.5 0 .75.75 0 001.5 0z"/></svg>`;
    const branchHtml = `<span id="badge-${repoName}" class="pill branch-badge" onclick="post('manageBranch', { repoName: '${repoName}', owner: '${owner.replace(/'/g, "\\\\'")}', isCloned: ${repo.is_cloned}, cloneUrl: '${cloneUrl}', currentBranch: '${branchName}' })" title="Manage Branches">${branchSvg}${branchName}</span>`;
    
    const stars = repo.stargazers_count ? `<span class="pill">${starSvg} ${repo.stargazers_count}</span>` : '';
    const isActive = repo.name && repo.name === this.state.workspace;
    const activeClass = isActive ? ' active' : '';
    const cloneIcon = repo.is_cloned ? folderSvg : cloudSvg;

    const repoIdAttr = repo.id ? ` data-repo-id="${repo.id}"` : '';

    return `<div class="repo-card${activeClass}" id="repo-card-${repoName}"${repoIdAttr}>
      <div class="repo-header" style="display: flex; justify-content: space-between; align-items: flex-start; width: 100%;">
        <div class="repo-title-group" style="display: flex; align-items: center; gap: 8px;">
          <div class="repo-name" id="repo-name-${repoName}" data-repo="${(repo.name || 'Repository').replace(/"/g, '&quot;')}" data-owner="${owner.replace(/"/g, '&quot;')}" data-id="${repo.id || ''}" title="Double-click to rename" style="font-weight: 600; display: inline-flex; align-items: center; color: var(--vscode-textLink-foreground); cursor: pointer; user-select: none;">${repo.name || 'Repository'}</div>
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
        <div style="display:flex; gap:8px; align-items:center;">
          ${languageHtml}
          ${branchHtml}
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
  const prodPath = path.join(extensionContext.extensionPath, 'backend');
  if (fs.existsSync(prodPath)) {
    return prodPath;
  }
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
  reposViewProvider.setAuthenticated(false);
  actionsViewProvider.setAuthenticated(false);
  await updateAuthContext(false);
  reposViewProvider.setError('');
  reposViewProvider.setRepos([]);
  reposViewProvider.setLoading(false);
  await vscode.window.showInformationMessage('Signed out from GitHub Automator.');
}

let isRefreshing = false;

async function refreshReposCommand() {
  if (isRefreshing) return;
  isRefreshing = true;
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
      isRefreshing = false;
      return;
    }

    reposViewProvider.setLoading(true);
    let page = 1;
    let allRepos = [];
    let hasMore = true;

    while (hasMore && page <= 10) { // max 10 pages (1000 repos)
      console.time(`repo_manager-list-page-${page}`);
      const result = await runBackendScript('managers/repo_manager.py', { 
        action: 'list', 
        token,
        repo_path: getWorkspacePath(),
        page
      });
      console.timeEnd(`repo_manager-list-page-${page}`);

      if (!result || !result.success) {
        const errType = result && result.error_type ? result.error_type : 'api';
        const errMsg = result && result.error ? result.error : 'Unable to load repositories';
        if (page === 1) {
          reposViewProvider.setError(errMsg, errType);
          if (errType === 'auth') {
            reposViewProvider.setRepos([]);
            reposViewProvider.setAuthenticated(false);
            actionsViewProvider.setAuthenticated(false);
            await updateAuthContext(false);
          }
          reposViewProvider.setLoading(false);
          console.timeEnd('refreshReposCommand');
          isRefreshing = false;
          return;
        } else {
          log(`Failed to load page ${page}: ${errMsg}`);
          break;
        }
      }

      allRepos = allRepos.concat(result.repos || []);
      
      if (page === 1) {
        reposViewProvider.setError('', '');
        reposViewProvider.setRepos(allRepos);
        actionsViewProvider.setAuthenticated(true);
        await updateAuthContext(true);
        reposViewProvider.setLoading(false);
      } else {
        reposViewProvider.appendRepos(result.repos || []);
      }

      hasMore = result.has_more === true;
      page++;
    }

  } catch (error) {
    log(`refreshRepos failed: ${error && error.message ? error.message : error}`);
    const errMsg = error && error.message ? error.message : String(error);
    let errType = 'unknown';
    const network_keywords = ["timeout", "dns", "connection", "unreachable", "getaddrinfo", "host", "socket", "network", "internet", "offline"];
    if (network_keywords.some(kw => errMsg.toLowerCase().includes(kw))) {
      errType = 'network';
    }
    reposViewProvider.setError(errMsg, errType);
    if (errType === 'auth') {
      reposViewProvider.setRepos([]);
      reposViewProvider.setAuthenticated(false);
      actionsViewProvider.setAuthenticated(false);
      await updateAuthContext(false);
    }
    reposViewProvider.setLoading(false);
  }
  console.timeEnd('refreshReposCommand');
  isRefreshing = false;
}

async function recordOpenedRepo(repoName) {
  const key = 'recently-opened-repos';
  let list = extensionContext.workspaceState.get(key) || [];
  list = list.filter(name => name !== repoName);
  list.unshift(repoName);
  if (list.length > 50) list = list.slice(0, 50);
  await extensionContext.workspaceState.update(key, list);
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
      await recordOpenedRepo(repoName);
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

    await recordOpenedRepo(repoName);
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
      inputBox.prompt = '✨ AI Auto-Generation';
      inputBox.placeholder = 'Click the ✨ icon on the top right to auto-generate, or type manually';
      inputBox.ignoreFocusOut = true;
      inputBox.buttons = [
        {
          iconPath: new vscode.ThemeIcon('sparkle'),
          tooltip: '✨ Auto Generate Description'
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
        if (button === inputBox.buttons[0]) {
          const prevValue = inputBox.value;
          inputBox.busy = true;
          inputBox.enabled = false;
          inputBox.placeholder = 'Generating description...';
          inputBox.value = '';

          const config = vscode.workspace.getConfiguration('github-automator');
          const geminiModel = config.get('geminiModel', 'gemini-3.6-flash');

          try {
            const generated = await callAiService('services/ai_description_cli.py', {
              repo_name: name,
              model: geminiModel
            }, getBackendRoot());

            if (generated && generated.success) {
              inputBox.value = generated.content || prevValue;
              inputBox.placeholder = 'Click the ✨ icon on the top right to auto-generate, or type manually';
              inputBox.enabled = true;
              inputBox.busy = false;
              inputBox.validationMessage = '';
            } else {
              const errorMessage = generated && generated.error && generated.error.message ? generated.error.message : (generated && generated.error ? String(generated.error) : 'Generation failed');
              inputBox.enabled = true;
              inputBox.busy = false;
              inputBox.placeholder = 'Click the ✨ icon on the top right to auto-generate, or type manually';
              inputBox.value = prevValue;
              inputBox.validationMessage = errorMessage;
            }
          } catch (e) {
            inputBox.enabled = true;
            inputBox.busy = false;
            inputBox.placeholder = 'Click the ✨ icon on the top right to auto-generate, or type manually';
            inputBox.value = prevValue;
            if (e instanceof CancellationError) {
              inputBox.validationMessage = '';
            } else {
              inputBox.validationMessage = e.message || 'Generation failed';
            }
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
    
    if (reposViewProvider) {
      const newRepo = {
        name: result.name,
        private: privateValue,
        description: description || '',
        clone_url: result.clone_url,
        owner: result.owner || '',
        is_cloned: false
      };
      // Add to in-memory state so sidebar switch doesn't lose it
      reposViewProvider.state.repos.unshift(newRepo);
      const repoHTML = reposViewProvider.renderRepoCard(newRepo);
      if (reposViewProvider.view) {
        reposViewProvider.view.webview.postMessage({ command: 'repoCreated', payload: { html: repoHTML } });
      }
    }
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
    if (reposViewProvider) {
      reposViewProvider.state.repos = reposViewProvider.state.repos.filter(r => r.name !== repoName);
      if (reposViewProvider.view) {
        reposViewProvider.view.webview.postMessage({ command: 'repoDeleted', payload: { repoName } });
      }
    }
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
    if (reposViewProvider) {
      // Remove from in-memory state so sidebar switch doesn't bring it back
      reposViewProvider.state.repos = reposViewProvider.state.repos.filter(r => r.name !== repoName);
      if (reposViewProvider.view) {
        reposViewProvider.view.webview.postMessage({ command: 'repoDeleted', payload: { repoName } });
      }
    }
  } catch (error) {
    log(`deleteRepoFromCard failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`Repository deletion failed: ${error && error.message ? error.message : error}`);
  }
}

async function renameRepoCommand(payload) {
  const { oldName, newName, owner, id } = payload || {};
  console.time(`renameRepo-${oldName}`);
  try {
    if (!oldName) {
      return;
    }

    const trimmedNewName = (newName || '').trim();
    if (!trimmedNewName) {
      vscode.window.showErrorMessage('Repository name cannot be empty.');
      if (reposViewProvider && reposViewProvider.view) {
        reposViewProvider.view.webview.postMessage({
          command: 'repoRenameFailed',
          payload: { oldName, error: 'Repository name cannot be empty.' }
        });
      }
      return;
    }

    if (trimmedNewName === oldName) {
      if (reposViewProvider && reposViewProvider.view) {
        reposViewProvider.view.webview.postMessage({
          command: 'repoRenamed',
          payload: { oldName, newName: oldName, noOp: true }
        });
      }
      return;
    }

    if (!await ensureAuthenticated()) {
      if (reposViewProvider && reposViewProvider.view) {
        reposViewProvider.view.webview.postMessage({
          command: 'repoRenameFailed',
          payload: { oldName, error: 'Not authenticated. Please sign in first.' }
        });
      }
      return;
    }

    const token = await getStoredSecret(AUTH_SECRET_KEY);
    const { renameRepo } = require('./services/githubService');
    const result = await renameRepo(token, owner, oldName, trimmedNewName, getWorkspacePath());

    if (!result || !result.success) {
      const errMsg = (result && result.error) || 'Failed to rename repository';
      vscode.window.showErrorMessage(`Rename failed: ${errMsg}`);
      if (reposViewProvider && reposViewProvider.view) {
        reposViewProvider.view.webview.postMessage({
          command: 'repoRenameFailed',
          payload: { oldName, error: errMsg }
        });
      }
      return;
    }

    if (result.no_op) {
      if (reposViewProvider && reposViewProvider.view) {
        reposViewProvider.view.webview.postMessage({
          command: 'repoRenamed',
          payload: { oldName, newName: oldName, noOp: true }
        });
      }
      return;
    }

    const confirmedName = result.name || trimmedNewName;

    // Update in-memory state in reposViewProvider
    if (reposViewProvider && reposViewProvider.state && reposViewProvider.state.repos) {
      let repoIndex = -1;
      if (id) {
        repoIndex = reposViewProvider.state.repos.findIndex(r => r.id === id);
      }
      if (repoIndex === -1) {
        repoIndex = reposViewProvider.state.repos.findIndex(r => r.name === oldName && (!owner || !r.owner || r.owner.toLowerCase() === owner.toLowerCase()));
      }
      if (repoIndex === -1) {
        repoIndex = reposViewProvider.state.repos.findIndex(r => r.name === oldName);
      }

      if (repoIndex !== -1) {
        const repo = reposViewProvider.state.repos[repoIndex];
        repo.name = confirmedName;
        if (result.url) repo.url = result.url;
        if (result.clone_url) repo.clone_url = result.clone_url;
        if (result.id) repo.id = result.id;
      }

      // Re-sort if current sort mode is name
      if (reposViewProvider.state.sortOption === 'name') {
        reposViewProvider.state.repos.sort((a, b) => (a.name || '').toLowerCase().localeCompare((b.name || '').toLowerCase()));
      }
    }

    // Update recently opened repositories in workspaceState
    const recentsKey = 'recently-opened-repos';
    let openedList = extensionContext.workspaceState.get(recentsKey) || [];
    if (openedList.includes(oldName)) {
      openedList = openedList.map(n => n === oldName ? confirmedName : n);
      await extensionContext.workspaceState.update(recentsKey, openedList);
    }

    // Notifications
    if (result.remote_warning) {
      vscode.window.showWarningMessage(result.remote_warning);
    }
    vscode.window.showInformationMessage(`Repository renamed to '${confirmedName}' successfully.`);

    // Notify webview
    if (reposViewProvider && reposViewProvider.view) {
      reposViewProvider.view.webview.postMessage({
        command: 'repoRenamed',
        payload: {
          oldName,
          newName: confirmedName,
          owner: result.owner || owner,
          url: result.url,
          cloneUrl: result.clone_url,
          id: result.id || id,
          sortOption: reposViewProvider.state.sortOption || 'name'
        }
      });
    }
  } catch (error) {
    const errText = error && error.message ? error.message : String(error);
    log(`renameRepoCommand failed: ${errText}`);
    vscode.window.showErrorMessage(`Rename failed: ${errText}`);
    if (reposViewProvider && reposViewProvider.view) {
      reposViewProvider.view.webview.postMessage({
        command: 'repoRenameFailed',
        payload: { oldName, error: errText }
      });
    }
  } finally {
    console.timeEnd(`renameRepo-${oldName}`);
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
      if (reposViewProvider && reposViewProvider.view) {
        reposViewProvider.view.webview.postMessage({ command: 'descriptionUpdated', payload: { repoName, success: false, error: message } });
      }
    } else {
      if (reposViewProvider && reposViewProvider.state && reposViewProvider.state.repos) {
        const repoIndex = reposViewProvider.state.repos.findIndex(r => r.name === repoName);
        if (repoIndex !== -1) {
          reposViewProvider.state.repos[repoIndex].description = description;
        }
      }
      if (reposViewProvider && reposViewProvider.view) {
        reposViewProvider.view.webview.postMessage({ command: 'descriptionUpdated', payload: { repoName, success: true, description } });
      }
    }
  } catch (error) {
    log(`updateRepoDescription failed: ${error && error.message ? error.message : error}`);
    vscode.window.showErrorMessage(`Error updating description: ${error && error.message ? error.message : error}`);
    if (reposViewProvider && reposViewProvider.view) {
      reposViewProvider.view.webview.postMessage({ command: 'descriptionUpdated', payload: { repoName, success: false, error: error && error.message ? error.message : String(error) } });
    }
  }
  console.timeEnd(`updateRepoDescription-${repoName}`);
}

async function autoGenerateExistingDescCommand(payload) {
  const { repoName, owner } = payload;
  console.log('[Auto Description] Wand clicked');
  console.log('[Auto Description] Generation started');
  try {
    const pathResult = await runBackendScript('managers/repo_manager.py', {
      action: 'check_repo_exists',
      repo_name: repoName
    });

    let repo_path = '';
    if (pathResult && pathResult.success && pathResult.exists) {
      repo_path = pathResult.path;
    }

    let projectContext = null;
    if (repo_path) {
      const { analyzeProject } = require('./services/projectAnalyzer');
      projectContext = await analyzeProject(repo_path);
    }
    console.log('[Auto Description] Project context collected');

    const config = vscode.workspace.getConfiguration('github-automator');
    const geminiModel = config.get('geminiModel', 'gemini-3.6-flash');

    console.log('[Auto Description] Sending Gemini request');
    let generated;
    try {
      generated = await callAiService('services/ai_description_cli.py', {
        repo_name: repoName,
        repo_path: repo_path,
        model: geminiModel,
        project_context: projectContext || {}
      }, getBackendRoot());
    } catch (e) {
      if (e instanceof CancellationError) return;
      throw e;
    }

    if (reposViewProvider && reposViewProvider.view) {
      if (!generated || !generated.success) {
        const err = generated && generated.error && generated.error.message ? generated.error.message : (generated && generated.error ? String(generated.error) : 'Failed to generate');
        console.log(`[Auto Description] Generation failed: ${err}`);
        vscode.window.showErrorMessage(`Auto Description failed: ${err}`);
        reposViewProvider.view.webview.postMessage({
          command: 'descriptionGenerated',
          payload: {
            repoName,
            success: false,
            description: '',
            error: err
          }
        });
        return;
      }

      console.log('[Auto Description] Gemini response received');
      // Do NOT auto-save the description here anymore!
      
      // Also notify webview to restore editor button/input state
      reposViewProvider.view.webview.postMessage({
        command: 'descriptionGenerated',
        payload: {
          repoName,
          success: true,
          description: generated.content,
          error: ''
        }
      });
    }
  } catch (error) {
    const errMsg = error && error.message ? error.message : String(error);
    console.log(`[Auto Description] Error: ${errMsg}`);
    vscode.window.showErrorMessage(`Auto Description failed: ${errMsg}`);
    if (reposViewProvider && reposViewProvider.view) {
      reposViewProvider.view.webview.postMessage({
        command: 'descriptionGenerated',
        payload: { repoName, success: false, error: errMsg }
      });
    }
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

async function updateBranchHistory(repoName, branchName) {
  if (!extensionContext || !repoName || !branchName) {
    return;
  }
  const key = `branch-history-${repoName}`;
  let history = extensionContext.workspaceState.get(key) || [];
  history = history.filter(b => b !== branchName);
  history.unshift(branchName);
  if (history.length > 5) {
    history = history.slice(0, 5);
  }
  await extensionContext.workspaceState.update(key, history);
}

async function manageBranchCommand(payload) {
  if (!payload || !payload.repoName) {
    return;
  }

  if (!payload.isCloned) {
    reposViewProvider.view.webview.postMessage({
      command: 'openPopover',
      payload: {
        repoName: payload.repoName,
        isCloned: false,
        cloneUrl: payload.cloneUrl
      }
    });
    return;
  }

  const pathResult = await runBackendScript('managers/repo_manager.py', {
    action: 'check_repo_exists',
    repo_name: payload.repoName
  });

  if (!pathResult || !pathResult.success || !pathResult.exists || !pathResult.path) {
    reposViewProvider.view.webview.postMessage({
      command: 'openPopover',
      payload: {
        repoName: payload.repoName,
        isCloned: false,
        cloneUrl: payload.cloneUrl
      }
    });
    return;
  }

  const repoPath = pathResult.path;

  const branchesResult = await runBackendScript('managers/local_repo.py', {
    action: 'list_branches',
    repo_path: repoPath
  });

  const branches = (branchesResult && branchesResult.success) ? branchesResult.branches : [];

  const remotesResult = await runBackendScript('managers/local_repo.py', {
    action: 'list_remotes',
    repo_path: repoPath
  });
  const remotes = (remotesResult && remotesResult.success) ? remotesResult.remotes : [];

  reposViewProvider.view.webview.postMessage({
    command: 'openPopover',
    payload: {
      repoName: payload.repoName,
      currentBranch: payload.currentBranch || 'main',
      isCloned: true,
      branches,
      remotes
    }
  });
}

async function repoOptionsCommand() {
  if (reposViewProvider && reposViewProvider.view) {
    const uniqueLangs = new Set();
    reposViewProvider.state.repos.forEach(r => {
      if (r.language && r.language !== 'N/A') {
        uniqueLangs.add(r.language);
      }
    });
    const languages = Array.from(uniqueLangs).sort();

    reposViewProvider.view.webview.postMessage({
      command: 'openRepoOptionsPopover',
      payload: {
        pinActive: reposViewProvider.state.pinActive !== false,
        sortOption: reposViewProvider.state.sortOption || 'name',
        visibilityFilter: reposViewProvider.state.visibilityFilter || 'all',
        languageFilter: reposViewProvider.state.languageFilter || 'all',
        languages
      }
    });
  }
}

async function handleRepoOptionsAction(payload) {
  const { action, value } = payload;
  const state = reposViewProvider.state;

  if (action === 'togglePin') {
    state.pinActive = state.pinActive === false ? true : false;
  } else if (action === 'setSort') {
    state.sortOption = value;
  } else if (action === 'setVisibility') {
    state.visibilityFilter = value;
  } else if (action === 'setLanguage') {
    state.languageFilter = value;
  }

  // Update repository grid
  if (reposViewProvider && reposViewProvider.view) {
    const displayHtml = reposViewProvider.getReposHtml();
    reposViewProvider.view.webview.postMessage({
      command: 'reposUpdated',
      payload: { html: displayHtml }
    });
  }
}

async function handlePopoverAction(payload) {
  const { action, repoName, currentBranch, isCloned, cloneUrl } = payload;
  if (!isCloned && action !== 'clone') {
    return;
  }

  if (action === 'clone') {
    await openRepoCommand(repoName, cloneUrl);
    return;
  }

  const pathResult = await runBackendScript('managers/repo_manager.py', {
    action: 'check_repo_exists',
    repo_name: repoName
  });

  if (!pathResult || !pathResult.success || !pathResult.exists || !pathResult.path) {
    vscode.window.showErrorMessage("Repository path not found.");
    return;
  }

  const repoPath = pathResult.path;

  const writeActions = ['switch', 'create', 'merge', 'delete', 'pull', 'push', 'sync', 'rebase', 'cherryPick', 'renameBranch', 'branchFromCommit', 'remotePushCurrent'];
  if (currentBranch === 'HEAD' && writeActions.includes(action)) {
    vscode.window.showErrorMessage("Branch management is not available in a detached HEAD state.");
    return;
  }

  if (action === 'switch') {
    const branchesResult = await runBackendScript('managers/local_repo.py', {
      action: 'list_branches',
      repo_path: repoPath
    });
    const branches = (branchesResult && branchesResult.success) ? branchesResult.branches : [];

    const branchItems = branches.map(b => {
      const isActive = b === currentBranch;
      return {
        label: isActive ? `✓ ${b}` : b,
        description: isActive ? '(current branch)' : '',
        branchName: b
      };
    });

    const selectedBranchItem = await vscode.window.showQuickPick(branchItems, {
      placeHolder: 'Select branch to switch to'
    });

    if (!selectedBranchItem) return;

    const switchResult = await runBackendScript('managers/local_repo.py', {
      action: 'switch_branch',
      repo_path: repoPath,
      branch: selectedBranchItem.branchName
    });

    if (switchResult && switchResult.success) {
      vscode.window.showInformationMessage(`Checked out branch: ${selectedBranchItem.branchName}`);
      await updateBranchHistory(repoName, selectedBranchItem.branchName);
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(switchResult.message || `Failed to checkout branch: ${selectedBranchItem.branchName}`);
    }
  }

  else if (action === 'create') {
    const branchesResult = await runBackendScript('managers/local_repo.py', {
      action: 'list_branches',
      repo_path: repoPath
    });
    const branches = (branchesResult && branchesResult.success) ? branchesResult.branches : [];

    const newBranchName = await vscode.window.showInputBox({
      placeHolder: 'Enter new branch name...',
      prompt: 'Create a new branch from the current branch.',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || !value.trim()) return 'Branch name cannot be empty';
        const branchReg = /^(?!-)(?!.*?\.\.)(?!.*?\/\.)[^\s~^:?*\[\\@\{\}]+(?<!\.lock)(?<!\/)(?<!\.)$/;
        if (!branchReg.test(value)) return 'Invalid git branch name format';
        if (branches.includes(value.trim())) return 'A branch with this name already exists locally';
        return null;
      }
    });

    if (!newBranchName) return;

    const createResult = await runBackendScript('managers/local_repo.py', {
      action: 'create_branch',
      repo_path: repoPath,
      branch: newBranchName.trim()
    });

    if (createResult && createResult.success) {
      vscode.window.showInformationMessage(`Created and checked out branch: ${newBranchName.trim()}`);
      await updateBranchHistory(repoName, newBranchName.trim());
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(createResult.message || `Failed to create branch: ${newBranchName.trim()}`);
    }
  }

  else if (action === 'merge') {
    const branchesResult = await runBackendScript('managers/local_repo.py', {
      action: 'list_branches',
      repo_path: repoPath
    });
    const branches = (branchesResult && branchesResult.success) ? branchesResult.branches : [];
    const eligibleBranches = branches.filter(b => b !== currentBranch);

    if (eligibleBranches.length === 0) {
      vscode.window.showInformationMessage('No eligible local branches to merge.');
      return;
    }

    const mergeItems = eligibleBranches.map(b => ({ label: b, branchName: b }));
    const selectedMergeItem = await vscode.window.showQuickPick(mergeItems, {
      title: 'Merge Branch',
      placeHolder: `Select branch to merge into ${currentBranch}`
    });

    if (!selectedMergeItem) return;

    const confirm = await vscode.window.showWarningMessage(
      `Merge ${selectedMergeItem.branchName} into ${currentBranch}?`,
      { modal: true },
      'Merge',
      'Cancel'
    );

    if (confirm !== 'Merge') return;

    const mergeResult = await runBackendScript('managers/local_repo.py', {
      action: 'merge_branch',
      repo_path: repoPath,
      branch: selectedMergeItem.branchName
    });

    if (mergeResult && mergeResult.success) {
      vscode.window.showInformationMessage(`Successfully merged ${selectedMergeItem.branchName} into ${currentBranch}.`);
      await refreshReposCommand();
    } else if (mergeResult && mergeResult.conflict) {
      vscode.window.showErrorMessage("Merge conflicts detected. Please manually resolve conflicts in VS Code.");
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(mergeResult.message || `Failed to merge ${selectedMergeItem.branchName} into ${currentBranch}.`);
    }
  }

  else if (action === 'delete') {
    const branchesResult = await runBackendScript('managers/local_repo.py', {
      action: 'list_branches',
      repo_path: repoPath
    });
    const branches = (branchesResult && branchesResult.success) ? branchesResult.branches : [];
    const deletableBranches = branches.filter(b => b !== currentBranch);

    if (deletableBranches.length === 0) {
      vscode.window.showInformationMessage('No eligible local branches to delete.');
      return;
    }

    const deleteItems = deletableBranches.map(b => ({ label: b, branchName: b }));
    const selectedDeleteItem = await vscode.window.showQuickPick(deleteItems, {
      title: 'Delete Branch',
      placeHolder: 'Select branch to delete'
    });

    if (!selectedDeleteItem) return;

    const confirm = await vscode.window.showWarningMessage(
      `Delete branch ${selectedDeleteItem.branchName}? This action cannot be undone.`,
      { modal: true },
      'Delete',
      'Cancel'
    );

    if (confirm !== 'Delete') return;

    const deleteResult = await runBackendScript('managers/local_repo.py', {
      action: 'delete_branch',
      repo_path: repoPath,
      branch: selectedDeleteItem.branchName
    });

    if (deleteResult && deleteResult.success) {
      vscode.window.showInformationMessage(`Successfully deleted branch ${selectedDeleteItem.branchName}.`);
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(deleteResult.message || `Failed to delete branch ${selectedDeleteItem.branchName}.`);
    }
  }

  else if (action === 'compare') {
    const branchesResult = await runBackendScript('managers/local_repo.py', {
      action: 'list_branches',
      repo_path: repoPath
    });
    const branches = (branchesResult && branchesResult.success) ? branchesResult.branches : [];

    const baseSelect = await vscode.window.showQuickPick(branches, {
      title: 'Compare Branches: Choose Base Branch',
      placeHolder: 'Select base branch'
    });

    if (!baseSelect) return;

    const compareBranches = branches.filter(b => b !== baseSelect);
    if (compareBranches.length === 0) {
      vscode.window.showInformationMessage('No other branches to compare.');
      return;
    }

    const compareSelect = await vscode.window.showQuickPick(compareBranches, {
      title: 'Compare Branches: Choose Compare Branch',
      placeHolder: 'Select branch to compare'
    });

    if (!compareSelect) return;

    const compResult = await runBackendScript('managers/local_repo.py', {
      action: 'compare_branches',
      repo_path: repoPath,
      base: baseSelect,
      compare: compareSelect
    });

    if (!compResult || !compResult.success) {
      vscode.window.showErrorMessage(compResult.error || 'Failed to compare branches.');
      return;
    }

    const compOptions = [
      { label: '🔍 View Commits', description: 'Show list of ahead and behind commits' },
      { label: 'Cancel' }
    ];

    const compPick = await vscode.window.showQuickPick(compOptions, {
      title: `Comparing ${baseSelect} ➔ ${compareSelect}`,
      placeHolder: `Ahead: ${compResult.ahead} commits | Behind: ${compResult.behind} commits`
    });

    if (compPick && compPick.label === '🔍 View Commits') {
      const logResult = await runBackendScript('managers/local_repo.py', {
        action: 'get_compare_commits',
        repo_path: repoPath,
        base: baseSelect,
        compare: compareSelect
      });

      if (!logResult || !logResult.success) {
        vscode.window.showErrorMessage('Failed to load compare commits.');
        return;
      }

      const logItems = [];
      logItems.push({ label: 'Ahead Commits', kind: vscode.QuickPickItemKind.Separator });
      if (logResult.ahead && logResult.ahead.length > 0) {
        logResult.ahead.forEach(c => logItems.push({ label: `+ ${c}` }));
      } else {
        logItems.push({ label: 'No ahead commits' });
      }

      logItems.push({ label: 'Behind Commits', kind: vscode.QuickPickItemKind.Separator });
      if (logResult.behind && logResult.behind.length > 0) {
        logResult.behind.forEach(c => logItems.push({ label: `- ${c}` }));
      } else {
        logItems.push({ label: 'No behind commits' });
      }

      await vscode.window.showQuickPick(logItems, {
        title: `Commits: ${baseSelect} ➔ ${compareSelect}`,
        placeHolder: 'Close'
      });
    }
  }

  else if (action === 'history') {
    const history = extensionContext.workspaceState.get(`branch-history-${repoName}`) || [];
    if (history.length === 0) {
      vscode.window.showInformationMessage('No branch history available for this repository.');
      return;
    }

    const selectedHistoryItem = await vscode.window.showQuickPick(history, {
      title: 'Recent Branches',
      placeHolder: 'Select a branch from history to checkout'
    });

    if (selectedHistoryItem) {
      const switchResult = await runBackendScript('managers/local_repo.py', {
        action: 'switch_branch',
        repo_path: repoPath,
        branch: selectedHistoryItem
      });

      if (switchResult && switchResult.success) {
        vscode.window.showInformationMessage(`Checked out branch: ${selectedHistoryItem}`);
        await updateBranchHistory(repoName, selectedHistoryItem);
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(switchResult.message || `Failed to checkout branch: ${selectedHistoryItem}`);
      }
    }
  }

  else if (action === 'fetch') {
    const fetchResult = await runBackendScript('managers/local_repo.py', {
      action: 'fetch_repo',
      repo_path: repoPath
    });

    if (fetchResult && fetchResult.success) {
      vscode.window.showInformationMessage("Fetched updates from remote successfully.");
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(fetchResult.message || "Fetch failed.");
    }
  }

  else if (action === 'pull') {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Pulling updates from remote repository...",
      cancellable: false
    }, async () => {
      const pullResult = await runBackendScript('managers/local_repo.py', {
        action: 'pull_repo',
        repo_path: repoPath
      });

      if (pullResult && pullResult.success) {
        vscode.window.showInformationMessage("Pulled updates successfully.");
        await refreshReposCommand();
      } else if (pullResult && pullResult.conflict) {
        vscode.window.showErrorMessage("Merge conflicts detected. Please resolve them manually.");
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(pullResult.message || "Pull failed.");
      }
    });
  }

  else if (action === 'push') {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Pushing changes to remote repository...",
      cancellable: false
    }, async () => {
      const pushResult = await runBackendScript('managers/local_repo.py', {
        action: 'push_repo',
        repo_path: repoPath
      });

      if (pushResult && pushResult.success) {
        vscode.window.showInformationMessage(pushResult.message || "Pushed changes successfully.");
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(pushResult.message || "Push failed.");
      }
    });
  }

  else if (action === 'sync') {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Syncing repository...",
      cancellable: false
    }, async (progress) => {
      progress.report({ message: "Fetching remote updates..." });
      const fetchRes = await runBackendScript('managers/local_repo.py', {
        action: 'fetch_repo',
        repo_path: repoPath
      });
      if (!fetchRes || !fetchRes.success) {
        vscode.window.showErrorMessage(`Sync Fetch failed: ${fetchRes.message}`);
        return;
      }

      progress.report({ message: "Checking upstream sync status..." });
      const statusRes = await runBackendScript('managers/local_repo.py', {
        action: 'get_upstream_status',
        repo_path: repoPath
      });

      if (!statusRes || !statusRes.success) {
        vscode.window.showErrorMessage(`Sync check failed: ${statusRes.error || "Upstream tracking branch is not configured."}`);
        return;
      }

      if (!statusRes.has_upstream) {
        progress.report({ message: "No upstream branch. Publishing local branch..." });
        const pushRes = await runBackendScript('managers/local_repo.py', {
          action: 'push_repo',
          repo_path: repoPath
        });
        if (pushRes && pushRes.success) {
          vscode.window.showInformationMessage("Sync completed: Published local branch to origin.");
        } else {
          vscode.window.showErrorMessage(`Sync push failed: ${pushRes.message}`);
        }
        await refreshReposCommand();
        return;
      }

      const { ahead, behind } = statusRes;
      let pulled = 0;
      let pushed = 0;

      if (behind > 0) {
        progress.report({ message: `Pulling ${behind} remote commit(s)...` });
        const pullRes = await runBackendScript('managers/local_repo.py', {
          action: 'pull_repo',
          repo_path: repoPath
        });
        if (!pullRes || !pullRes.success) {
          if (pullRes && pullRes.conflict) {
            vscode.window.showErrorMessage("Sync paused: Merge conflicts detected. Please resolve them manually.");
          } else {
            vscode.window.showErrorMessage(`Sync Pull failed: ${pullRes.message}`);
          }
          await refreshReposCommand();
          return;
        }
        pulled = behind;
      }

      if (ahead > 0) {
        progress.report({ message: `Pushing ${ahead} local commit(s)...` });
        const pushRes = await runBackendScript('managers/local_repo.py', {
          action: 'push_repo',
          repo_path: repoPath
        });
        if (!pushRes || !pushRes.success) {
          vscode.window.showErrorMessage(`Sync Push failed: ${pushRes.message}`);
          await refreshReposCommand();
          return;
        }
        pushed = ahead;
      }

      await refreshReposCommand();
      vscode.window.showInformationMessage(`Sync completed: Pulled ${pulled} commit(s), pushed ${pushed} commit(s).`);
    });
  }

  else if (action === 'rebase') {
    const branchesResult = await runBackendScript('managers/local_repo.py', {
      action: 'list_branches',
      repo_path: repoPath
    });
    const branches = (branchesResult && branchesResult.success) ? branchesResult.branches : [];
    const eligible = branches.filter(b => b !== currentBranch);

    if (eligible.length === 0) {
      vscode.window.showInformationMessage('No eligible local branches to rebase onto.');
      return;
    }

    const targetBranch = await vscode.window.showQuickPick(eligible, {
      title: 'Rebase current branch',
      placeHolder: `Select target branch to rebase ${currentBranch} onto`
    });

    if (!targetBranch) return;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Rebasing ${currentBranch} onto ${targetBranch}...`,
      cancellable: false
    }, async () => {
      const result = await runBackendScript('managers/local_repo.py', {
        action: 'rebase_branch',
        repo_path: repoPath,
        branch: targetBranch
      });

      if (result && result.success) {
        vscode.window.showInformationMessage(`Successfully rebased ${currentBranch} onto ${targetBranch}.`);
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(result.message || `Rebase failed. Conflicted? Run 'git rebase --abort'.`);
      }
    });
  }

  else if (action === 'cherryPick') {
    const commitHash = await vscode.window.showInputBox({
      title: 'Cherry Pick',
      prompt: 'Enter the commit hash to cherry pick onto current branch',
      ignoreFocusOut: true,
      validateInput: (value) => {
        if (!value || !value.trim()) return 'Commit hash is required';
        return null;
      }
    });

    if (!commitHash) return;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Cherry picking ${commitHash}...`,
      cancellable: false
    }, async () => {
      const result = await runBackendScript('managers/local_repo.py', {
        action: 'cherry_pick',
        repo_path: repoPath,
        commit: commitHash.trim()
      });

      if (result && result.success) {
        vscode.window.showInformationMessage(`Successfully cherry-picked ${commitHash}.`);
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(result.message || `Cherry pick failed.`);
      }
    });
  }

  else if (action === 'stash') {
    const stashOpts = [
      { label: 'Push changes', subAction: 'push' },
      { label: 'Pop latest stash', subAction: 'pop' },
      { label: 'Apply latest stash', subAction: 'apply' },
      { label: 'Clear all stashes', subAction: 'clear' },
      { label: 'List stashes', subAction: 'list' }
    ];

    const pick = await vscode.window.showQuickPick(stashOpts, {
      title: 'Git Stash Management',
      placeHolder: 'Select stash sub-action'
    });

    if (!pick) return;

    if (pick.subAction === 'push') {
      const message = await vscode.window.showInputBox({
        prompt: 'Enter stash message (optional)',
        ignoreFocusOut: true
      });
      const result = await runBackendScript('managers/local_repo.py', {
        action: 'stash_changes',
        repo_path: repoPath,
        sub_action: 'push',
        message: message || ''
      });
      if (result && result.success) {
        vscode.window.showInformationMessage(result.message || 'Stashed changes successfully.');
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(result.message || 'Failed to stash changes.');
      }
    } else if (pick.subAction === 'list') {
      const result = await runBackendScript('managers/local_repo.py', {
        action: 'stash_changes',
        repo_path: repoPath,
        sub_action: 'list'
      });
      if (result && result.success) {
        const list = result.stashes || [];
        if (list.length === 0) {
          vscode.window.showInformationMessage('No stashes found.');
        } else {
          await vscode.window.showQuickPick(list.map(s => ({ label: s })), { title: 'Stash List' });
        }
      } else {
        vscode.window.showErrorMessage(result.message || 'Failed to list stashes.');
      }
    } else {
      const result = await runBackendScript('managers/local_repo.py', {
        action: 'stash_changes',
        repo_path: repoPath,
        sub_action: pick.subAction
      });
      if (result && result.success) {
        vscode.window.showInformationMessage(result.message || `Stash ${pick.subAction} completed successfully.`);
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(result.message || `Failed to ${pick.subAction} stash.`);
      }
    }
  }

  else if (action === 'tags') {
    const tagOpts = [
      { label: 'List tags', subAction: 'list' },
      { label: 'Create tag', subAction: 'create' },
      { label: 'Delete tag', subAction: 'delete' }
    ];

    const pick = await vscode.window.showQuickPick(tagOpts, {
      title: 'Git Tags Management',
      placeHolder: 'Select tag sub-action'
    });

    if (!pick) return;

    if (pick.subAction === 'list') {
      const result = await runBackendScript('managers/local_repo.py', {
        action: 'manage_tags',
        repo_path: repoPath,
        sub_action: 'list'
      });
      if (result && result.success) {
        const list = result.tags || [];
        if (list.length === 0) {
          vscode.window.showInformationMessage('No tags found.');
        } else {
          await vscode.window.showQuickPick(list.map(t => ({ label: t })), { title: 'Tags List' });
        }
      } else {
        vscode.window.showErrorMessage(result.message || 'Failed to list tags.');
      }
    } else if (pick.subAction === 'create') {
      const tagName = await vscode.window.showInputBox({
        prompt: 'Enter tag name',
        ignoreFocusOut: true,
        validateInput: v => (!v || !v.trim()) ? 'Tag name is required' : null
      });
      if (!tagName) return;

      const tagMsg = await vscode.window.showInputBox({
        prompt: 'Enter tag message (optional)',
        ignoreFocusOut: true
      });

      const result = await runBackendScript('managers/local_repo.py', {
        action: 'manage_tags',
        repo_path: repoPath,
        sub_action: 'create',
        tag_name: tagName.trim(),
        message: tagMsg || ''
      });

      if (result && result.success) {
        vscode.window.showInformationMessage(`Successfully created tag ${tagName}.`);
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(result.message || 'Failed to create tag.');
      }
    } else if (pick.subAction === 'delete') {
      const listRes = await runBackendScript('managers/local_repo.py', {
        action: 'manage_tags',
        repo_path: repoPath,
        sub_action: 'list'
      });
      const list = (listRes && listRes.success) ? listRes.tags || [] : [];
      if (list.length === 0) {
        vscode.window.showInformationMessage('No tags to delete.');
        return;
      }

      const tagToDelete = await vscode.window.showQuickPick(list, { title: 'Select tag to delete' });
      if (!tagToDelete) return;

      const result = await runBackendScript('managers/local_repo.py', {
        action: 'manage_tags',
        repo_path: repoPath,
        sub_action: 'delete',
        tag_name: tagToDelete
      });

      if (result && result.success) {
        vscode.window.showInformationMessage(`Successfully deleted tag ${tagToDelete}.`);
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(result.message || 'Failed to delete tag.');
      }
    }
  }

  else if (action === 'renameBranch') {
    const newName = await vscode.window.showInputBox({
      title: `Rename current branch (${currentBranch})`,
      prompt: 'Enter new branch name',
      ignoreFocusOut: true,
      validateInput: v => (!v || !v.trim()) ? 'Branch name is required' : null
    });

    if (!newName) return;

    const result = await runBackendScript('managers/local_repo.py', {
      action: 'rename_branch',
      repo_path: repoPath,
      new_name: newName.trim()
    });

    if (result && result.success) {
      vscode.window.showInformationMessage(`Successfully renamed branch to ${newName.trim()}.`);
      await updateBranchHistory(repoName, newName.trim());
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(result.message || 'Failed to rename branch.');
    }
  }

  else if (action === 'branchFromCommit') {
    const commitHash = await vscode.window.showInputBox({
      prompt: 'Enter commit hash or branch/tag name to start from',
      ignoreFocusOut: true,
      validateInput: v => (!v || !v.trim()) ? 'Start point is required' : null
    });
    if (!commitHash) return;

    const newBranch = await vscode.window.showInputBox({
      prompt: 'Enter new branch name',
      ignoreFocusOut: true,
      validateInput: v => (!v || !v.trim()) ? 'Branch name is required' : null
    });
    if (!newBranch) return;

    const result = await runBackendScript('managers/local_repo.py', {
      action: 'create_branch_from_commit',
      repo_path: repoPath,
      branch: newBranch.trim(),
      commit: commitHash.trim()
    });

    if (result && result.success) {
      vscode.window.showInformationMessage(`Successfully created and checked out branch ${newBranch.trim()} from ${commitHash.trim()}.`);
      await updateBranchHistory(repoName, newBranch.trim());
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(result.message || 'Failed to checkout branch from commit.');
    }
  }

  else if (action === 'cleanMerged') {
    const result = await runBackendScript('managers/local_repo.py', {
      action: 'clean_merged_branches',
      repo_path: repoPath
    });

    if (result && result.success) {
      vscode.window.showInformationMessage(result.message || 'Cleaned merged branches successfully.');
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(result.message || 'Failed to clean merged branches.');
    }
  }

  else if (action === 'remotePushCurrent') {
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Pushing ${currentBranch} to origin...`,
      cancellable: false
    }, async () => {
      const result = await runBackendScript('managers/local_repo.py', {
        action: 'remote_push_current',
        repo_path: repoPath
      });
      if (result && result.success) {
        vscode.window.showInformationMessage(result.message || 'Pushed successfully.');
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(result.message || 'Failed to push current branch.');
      }
    });
  }

  else if (action === 'remotePullSpecific') {
    const branchesRes = await runBackendScript('managers/local_repo.py', {
      action: 'remote_list_branches',
      repo_path: repoPath
    });
    const list = (branchesRes && branchesRes.success) ? branchesRes.branches || [] : [];
    if (list.length === 0) {
      vscode.window.showInformationMessage('No remote branches found.');
      return;
    }

    const selectedBranch = await vscode.window.showQuickPick(list, { title: 'Select remote branch to pull' });
    if (!selectedBranch) return;

    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: `Pulling ${selectedBranch}...`,
      cancellable: false
    }, async () => {
      const parts = selectedBranch.split('/');
      const remote = parts[0];
      const branch = parts.slice(1).join('/');

      const result = await runBackendScript('managers/local_repo.py', {
        action: 'remote_pull_specific',
        repo_path: repoPath,
        remote,
        branch
      });
      if (result && result.success) {
        vscode.window.showInformationMessage(result.message || `Pulled ${selectedBranch} successfully.`);
        await refreshReposCommand();
      } else {
        vscode.window.showErrorMessage(result.message || `Failed to pull remote branch.`);
      }
    });
  }

  else if (action === 'remoteBrowseBranches') {
    const branchesRes = await runBackendScript('managers/local_repo.py', {
      action: 'remote_list_branches',
      repo_path: repoPath
    });
    const list = (branchesRes && branchesRes.success) ? branchesRes.branches || [] : [];
    if (list.length === 0) {
      vscode.window.showInformationMessage('No remote branches found.');
      return;
    }
    await vscode.window.showQuickPick(list.map(b => ({ label: b })), { title: 'Remote Branches' });
  }

  else if (action === 'remoteAdd') {
    const name = await vscode.window.showInputBox({
      prompt: 'Enter remote name (e.g., origin)',
      ignoreFocusOut: true,
      validateInput: v => (!v || !v.trim()) ? 'Remote name is required' : null
    });
    if (!name) return;

    const url = await vscode.window.showInputBox({
      prompt: 'Enter remote git repository URL',
      ignoreFocusOut: true,
      validateInput: v => (!v || !v.trim()) ? 'Remote URL is required' : null
    });
    if (!url) return;

    const result = await runBackendScript('managers/local_repo.py', {
      action: 'remote_add',
      repo_path: repoPath,
      name: name.trim(),
      url: url.trim()
    });

    if (result && result.success) {
      vscode.window.showInformationMessage(`Successfully added remote ${name.trim()}.`);
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(result.message || 'Failed to add remote.');
    }
  }

  else if (action === 'remoteRename') {
    const remotesRes = await runBackendScript('managers/local_repo.py', {
      action: 'list_remotes',
      repo_path: repoPath
    });
    const remotes = (remotesRes && remotesRes.success) ? remotesRes.remotes || [] : [];
    if (remotes.length === 0) {
      vscode.window.showInformationMessage('No remotes found to rename.');
      return;
    }

    const selectedRemote = await vscode.window.showQuickPick(remotes, { title: 'Select remote to rename' });
    if (!selectedRemote) return;

    const newName = await vscode.window.showInputBox({
      prompt: `Enter new name for remote ${selectedRemote}`,
      ignoreFocusOut: true,
      validateInput: v => (!v || !v.trim()) ? 'Remote name is required' : null
    });
    if (!newName) return;

    const result = await runBackendScript('managers/local_repo.py', {
      action: 'remote_rename',
      repo_path: repoPath,
      old_name: selectedRemote,
      new_name: newName.trim()
    });

    if (result && result.success) {
      vscode.window.showInformationMessage(`Successfully renamed remote to ${newName.trim()}.`);
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(result.message || 'Failed to rename remote.');
    }
  }

  else if (action === 'remoteRemove') {
    const remotesRes = await runBackendScript('managers/local_repo.py', {
      action: 'list_remotes',
      repo_path: repoPath
    });
    const remotes = (remotesRes && remotesRes.success) ? remotesRes.remotes || [] : [];
    if (remotes.length === 0) {
      vscode.window.showInformationMessage('No remotes found to remove.');
      return;
    }

    const selectedRemote = await vscode.window.showQuickPick(remotes, { title: 'Select remote to remove' });
    if (!selectedRemote) return;

    const result = await runBackendScript('managers/local_repo.py', {
      action: 'remote_remove',
      repo_path: repoPath,
      name: selectedRemote
    });

    if (result && result.success) {
      vscode.window.showInformationMessage(`Successfully removed remote ${selectedRemote}.`);
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(result.message || 'Failed to remove remote.');
    }
  }

  else if (action === 'remotePrune') {
    const remotesRes = await runBackendScript('managers/local_repo.py', {
      action: 'list_remotes',
      repo_path: repoPath
    });
    const remotes = (remotesRes && remotesRes.success) ? remotesRes.remotes || [] : [];
    if (remotes.length === 0) {
      vscode.window.showInformationMessage('No remotes found to prune.');
      return;
    }

    const selectedRemote = await vscode.window.showQuickPick(remotes, { title: 'Select remote to prune' });
    if (!selectedRemote) return;

    const result = await runBackendScript('managers/local_repo.py', {
      action: 'remote_prune',
      repo_path: repoPath,
      name: selectedRemote
    });

    if (result && result.success) {
      vscode.window.showInformationMessage(`Successfully pruned remote ${selectedRemote}.`);
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(result.message || 'Failed to prune remote.');
    }
  }

  else if (action === 'remoteChangeUpstream') {
    const branchesRes = await runBackendScript('managers/local_repo.py', {
      action: 'remote_list_branches',
      repo_path: repoPath
    });
    const list = (branchesRes && branchesRes.success) ? branchesRes.branches || [] : [];
    if (list.length === 0) {
      vscode.window.showInformationMessage('No remote branches found.');
      return;
    }

    const selectedBranch = await vscode.window.showQuickPick(list, { title: 'Select remote tracking branch' });
    if (!selectedBranch) return;

    const result = await runBackendScript('managers/local_repo.py', {
      action: 'remote_change_upstream',
      repo_path: repoPath,
      branch: selectedBranch
    });

    if (result && result.success) {
      vscode.window.showInformationMessage(`Successfully set tracking branch to ${selectedBranch}.`);
      await refreshReposCommand();
    } else {
      vscode.window.showErrorMessage(result.message || 'Failed to set upstream tracking branch.');
    }
  }
}

async function commitAndPushCommand(payload) {
  try {
    const repoPath = getWorkspacePath();
    if (!repoPath) {
      await vscode.window.showWarningMessage('Open a folder before running commit and push.');
      return;
    }

    const handleCommitError = async (error) => {
      log(`commitAndPush failed: ${error && error.message ? error.message : error}`);
      const msg = error && error.message ? error.message : String(error);
      
      if (msg.toLowerCase().includes('conflict')) {
        vscode.commands.executeCommand('git.refresh');
      }

      if (msg.toLowerCase().includes('merge conflict')) {
        const action = await vscode.window.showErrorMessage(`Commit and push failed: ${msg}`, 'View Conflicts', 'Abort Merge');
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
    };

    const inputBox = vscode.window.createInputBox();
    inputBox.title = 'Commit & Push';
    inputBox.prompt = '✨ AI Auto-Generation';
    inputBox.placeholder = 'Click the ✨ icon on the top right to auto-generate, or type manually';
    inputBox.ignoreFocusOut = true;
    inputBox.buttons = [
      {
        iconPath: new vscode.ThemeIcon('sparkle'),
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

      let commitResult;
      await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: 'Committing changes',
        cancellable: false
      }, async () => {
        const config = vscode.workspace.getConfiguration('github-automator');
        const autoPush = config.get('autoPush', true);
        const token = await getStoredSecret(AUTH_SECRET_KEY);
        commitResult = await runBackendScript('managers/commit_manager.py', {
          action: 'commit_and_push',
          repo_path: repoPath,
          message: message.trim(),
          use_ai: false,
          api_key: token || '',
          auto_push: autoPush
        });

        if (!commitResult || !commitResult.success) {
          const detail = commitResult && commitResult.message ? commitResult.message : 'The commit workflow failed.';
          throw new Error(detail);
        }
      });

      // Show success message outside withProgress so the progress notification closes immediately
      if (commitResult && commitResult.success) {
        await vscode.window.showInformationMessage(commitResult.message || 'Commit and push completed.');
      }
    };

    inputBox.onDidAccept(async () => {
      if (generationPending) {
        return;
      }

      const message = inputBox.value.trim();
      inputBox.dispose();
      try {
        await finalizeCommit(message);
      } catch (e) {
        await handleCommitError(e);
      }
    });

    inputBox.onDidTriggerButton(async (button) => {
      if (generationPending) {
        return;
      }

      generationPending = true;
      const prevValue = inputBox.value;
      inputBox.busy = true;
      inputBox.enabled = false;
      inputBox.placeholder = 'Generating commit message...';
      inputBox.value = '';

      try {
        const diffResult = await runBackendScript('managers/commit_manager.py', {
          action: 'get_diff',
          repo_path: repoPath
        });

        if (!diffResult || !diffResult.success) {
          throw new Error(diffResult && diffResult.message ? diffResult.message : 'Unable to inspect the staged changes.');
        }

        const config = vscode.workspace.getConfiguration('github-automator');
        const geminiModel = config.get('geminiModel', 'gemini-3.6-flash');

        let generated;
        try {
          generated = await callAiService('services/ai_commit_cli.py', {
            diff: diffResult.diff || '',
            model: geminiModel
          }, getBackendRoot());
        } catch (e) {
          if (e instanceof CancellationError) {
            inputBox.enabled = true;
            inputBox.busy = false;
            inputBox.placeholder = 'Click the ✨ icon on the top right to auto-generate, or type manually';
            inputBox.value = prevValue;
            inputBox.validationMessage = '';
            generationPending = false;
            return;
          }
          throw e;
        }

        if (!generated || !generated.success) {
          const err = generated && generated.error && generated.error.message ? generated.error.message : (generated && generated.error ? String(generated.error) : 'AI generation failed.');
          throw new Error(err);
        }

        inputBox.value = generated.content || prevValue;
        inputBox.placeholder = 'Click the ✨ icon on the top right to auto-generate, or type manually';
        inputBox.enabled = true;
        inputBox.busy = false;
        inputBox.validationMessage = '';
      } catch (error) {
        inputBox.enabled = true;
        inputBox.busy = false;
        inputBox.placeholder = 'Click the ✨ icon on the top right to auto-generate, or type manually';
        inputBox.value = prevValue;
        const errorMessage = error && error.message ? error.message : 'Failed to generate commit message.';
        inputBox.validationMessage = errorMessage;
        await vscode.window.showErrorMessage(errorMessage);
      } finally {
        generationPending = false;
      }
    });

    inputBox.show();
  } catch (error) {
    await handleCommitError(error);
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
    const geminiModel = config.get('geminiModel', 'gemini-3.6-flash');

    let generated;
    try {
      generated = await callAiService('services/ai_commit_cli.py', {
        diff: diffResult.diff || '',
        model: geminiModel
      }, getBackendRoot());
    } catch (e) {
      if (e instanceof CancellationError) return;
      throw e;
    }

    if (!generated || !generated.success) {
      const errDetail = generated && generated.error && generated.error.message ? generated.error.message : (generated && generated.error ? String(generated.error) : 'AI generation failed.');
      await vscode.window.showErrorMessage(errDetail);
      return;
    }
      // If actions view is open, post the generated message to it for inline insertion
      try {
        if (actionsViewProvider && actionsViewProvider.view && actionsViewProvider.view.webview) {
          actionsViewProvider.view.webview.postMessage({ command: 'aiGenerated', message: generated.content || '' });
          return;
        }
      } catch (e) {
        // fall through to inputBox fallback
      }

      const edited = await vscode.window.showInputBox({
        prompt: 'Review the generated commit message',
        value: generated.content || '',
        ignoreFocusOut: true
      });

      if (edited === undefined) {
        return;
      }

      const finalMessage = edited && edited.trim() ? edited.trim() : generated.content || 'Auto-commit';
      await vscode.window.showInformationMessage(`Generated commit message: ${finalMessage}`);
  } catch (error) {
    log(`aiGenerate failed: ${error && error.message ? error.message : error}`);
    await vscode.window.showErrorMessage(`AI generation failed: ${error && error.message ? error.message : error}`);
  }
}

async function generateReadmeCommand(uri) {
  let readmeUri = uri;
  if (!readmeUri && vscode.window.activeTextEditor) {
    const doc = vscode.window.activeTextEditor.document;
    if (path.basename(doc.fileName).toLowerCase() === 'readme.md') {
      readmeUri = doc.uri;
    }
  }

  if (!readmeUri) {
    await vscode.window.showWarningMessage('Please open a README.md file first.');
    return;
  }

  const activeSession = activeReadmeSessions.get(readmeUri.toString());
  if (activeSession && activeSession.status === 'generating') {
    return;
  }

  const repoPath = path.dirname(readmeUri.fsPath);
  
  const { getRepoInfo } = require('./services/gitService');
  let repoInfo;
  try {
    repoInfo = await getRepoInfo(repoPath);
  } catch (err) {
    repoInfo = null;
  }
  if (!repoInfo || !repoInfo.is_git_repo) {
    await vscode.window.showWarningMessage('The README.md must be located at the root of a Git repository.');
    return;
  }

  if (readmeCodeLensProvider) {
    readmeCodeLensProvider.setState(readmeUri, 'generating');
  }

  const sessionId = Date.now().toString() + Math.random().toString(36).substring(2, 5);
  
  let document;
  try {
    document = await vscode.workspace.openTextDocument(readmeUri);
  } catch (err) {
    if (readmeCodeLensProvider) {
      readmeCodeLensProvider.setState(readmeUri, 'error');
    }
    return;
  }

  const initialVersion = document.version;
  const initialText = document.getText();

  const session = {
    sessionId,
    documentUri: readmeUri,
    repoPath,
    initialDocumentVersion: initialVersion,
    initialContent: initialText,
    status: 'generating',
    isApplyingOwnEdit: false,
    finalContent: ''
  };

  activeReadmeSessions.set(readmeUri.toString(), session);
  if (readmeCodeLensProvider) {
    readmeCodeLensProvider.fire();
  }

  await vscode.window.withProgress({
    location: vscode.ProgressLocation.Notification,
    title: "Generating README.md suggestions with AI...",
    cancellable: false
  }, async () => {
    const config = vscode.workspace.getConfiguration('github-automator');
    const geminiModel = config.get('geminiModel', 'gemini-3.6-flash');

    let backendResult;
    try {
      backendResult = await callAiService('managers/readme_manager.py', {
        repo_path: repoPath,
        existing_content: initialText,
        model: geminiModel
      }, getBackendRoot());
    } catch (err) {
      if (err instanceof CancellationError) {
        if (readmeCodeLensProvider) readmeCodeLensProvider.setState(readmeUri, 'idle');
        activeReadmeSessions.delete(readmeUri.toString());
        return;
      }
      backendResult = { success: false, error: err.message, error_type: 'unknown' };
    }

    let currentDoc;
    try {
      currentDoc = await vscode.workspace.openTextDocument(readmeUri);
    } catch (e) {
      currentDoc = null;
    }

    if (!currentDoc || currentDoc.version !== initialVersion || currentDoc.getText() !== initialText) {
      if (readmeCodeLensProvider) {
        readmeCodeLensProvider.setState(readmeUri, 'error');
      }
      activeReadmeSessions.delete(readmeUri.toString());
      vscode.window.showWarningMessage('README changed while AI was generating. Generate again to ensure the suggestion uses the latest content.');
      return;
    }

    if (!backendResult || !backendResult.success) {
      if (readmeCodeLensProvider) {
        readmeCodeLensProvider.setState(readmeUri, 'error');
      }
      session.status = 'error';
      if (readmeCodeLensProvider) {
        readmeCodeLensProvider.fire();
      }

      let errMsg = 'README generation failed.';
      if (backendResult) {
        const errType = backendResult.error_type;
        const errSource = backendResult.error_source;

        if (errType === 'network') {
          errMsg = 'No internet connection. Please check your connection and try again.';
        } else if (errType === 'auth') {
          if (errSource === 'github') {
            errMsg = 'GitHub authentication/session error. Please check your GitHub token.';
          } else if (errSource === 'gemini') {
            errMsg = 'AI authentication failed. Please check your Gemini API configuration.';
          } else {
            errMsg = 'Authentication failed.';
          }
        } else if (errType === 'quota') {
          errMsg = 'AI request limit reached. Please try again later.';
        } else if (errType === 'context_limit') {
          errMsg = 'README context is too large for the AI model. Please try again with a smaller repository context.';
        } else if (backendResult.error) {
          errMsg = backendResult.error;
        }
      }
      vscode.window.showErrorMessage(errMsg);
      return;
    }

    const originalSections = parseSections(initialText);
    const generatedSections = parseSections(backendResult.content);
    
    const matchResult = matchSections(originalSections, generatedSections);
    
    if (matchResult.reviewQueue.length === 0) {
      vscode.window.showInformationMessage('No section changes suggested.');
      activeReadmeSessions.delete(readmeUri.toString());
      if (readmeCodeLensProvider) {
        readmeCodeLensProvider.setState(readmeUri, 'idle');
      }
      return;
    }
    
    session.status = 'reviewing';
    if (readmeCodeLensProvider) {
      readmeCodeLensProvider.fire();
    }
    
    const ReadmeReviewPanel = require('./readmeReviewPanel');
    ReadmeReviewPanel.createOrShow(
      extensionContext.extensionUri,
      session,
      originalSections,
      generatedSections,
      matchResult,
      async (finalContent) => {
        session.finalContent = finalContent;
        session.status = 'completed';
        await applyReviewedChangesCommand(readmeUri);
      }
    );
  });
}

async function applyReviewedChangesCommand(uri) {
  const readmeUri = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
  if (!readmeUri) return;
  const session = activeReadmeSessions.get(readmeUri.toString());
  if (!session) return;

  const document = await vscode.workspace.openTextDocument(readmeUri);
  if (document.version !== session.initialDocumentVersion || document.getText() !== session.initialContent) {
    vscode.window.showWarningMessage('README changed while AI review was in progress. Please generate again.');
    activeReadmeSessions.delete(readmeUri.toString());
    if (readmeCodeLensProvider) {
      readmeCodeLensProvider.clearState(readmeUri);
    }
    return;
  }

  const edit = new vscode.WorkspaceEdit();
  const fullRange = new vscode.Range(
    document.positionAt(0),
    document.positionAt(document.getText().length)
  );
  edit.replace(readmeUri, fullRange, session.finalContent);
  
  session.isApplyingOwnEdit = true;
  const editApplied = await vscode.workspace.applyEdit(edit);
  session.isApplyingOwnEdit = false;

  if (editApplied) {
    session.status = 'applied-unsaved';
    if (readmeCodeLensProvider) {
      readmeCodeLensProvider.fire();
    }
  }
}

async function reviewFullDiffCommand(uri) {
  const readmeUri = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
  if (!readmeUri) return;
  const session = activeReadmeSessions.get(readmeUri.toString());
  if (!session) return;

  const originalFileName = `README.${session.sessionId}.original.md`;
  const pendingFileName = `README.${session.sessionId}.pending.md`;
  
  const originalPath = path.join(os.tmpdir(), originalFileName);
  const pendingPath = path.join(os.tmpdir(), pendingFileName);
  
  await fs.promises.writeFile(originalPath, session.initialContent, 'utf8');
  await fs.promises.writeFile(pendingPath, session.finalContent, 'utf8');
  
  const originalUri = vscode.Uri.file(originalPath);
  const pendingUri = vscode.Uri.file(pendingPath);
  
  await vscode.commands.executeCommand('vscode.diff', originalUri, pendingUri, 'README.md (Original) ↔ README.md (Reviewed Suggestion)');
}

async function discardReadmeSuggestionCommand(uri) {
  const readmeUri = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
  if (!readmeUri) return;
  const session = activeReadmeSessions.get(readmeUri.toString());
  if (!session) return;

  const ReadmeReviewPanel = require('./readmeReviewPanel');
  if (ReadmeReviewPanel.currentPanel) {
    ReadmeReviewPanel.currentPanel._panel.dispose();
  }

  const originalFileName = `README.${session.sessionId}.original.md`;
  const pendingFileName = `README.${session.sessionId}.pending.md`;
  const originalPath = path.join(os.tmpdir(), originalFileName);
  const pendingPath = path.join(os.tmpdir(), pendingFileName);
  
  const tabs = vscode.window.tabGroups.all.flatMap(tg => tg.tabs);
  for (const tab of tabs) {
    if (tab.input && tab.input.uri) {
      const uriStr = tab.input.uri.toString();
      if (uriStr === vscode.Uri.file(originalPath).toString() || uriStr === vscode.Uri.file(pendingPath).toString()) {
        await vscode.window.tabGroups.close(tab);
      }
    }
  }

  try {
    await fs.promises.unlink(originalPath);
  } catch (e) {}
  try {
    await fs.promises.unlink(pendingPath);
  } catch (e) {}

  activeReadmeSessions.delete(readmeUri.toString());
  if (readmeCodeLensProvider) {
    readmeCodeLensProvider.clearState(readmeUri);
  }
}

async function commitReadmeChangesCommand(uri) {
  await vscode.commands.executeCommand('github-automator.commitAndPush');
  await dismissReadmeSessionCommand(uri);
}

async function dismissReadmeSessionCommand(uri) {
  const readmeUri = uri || (vscode.window.activeTextEditor && vscode.window.activeTextEditor.document.uri);
  if (!readmeUri) return;
  
  activeReadmeSessions.delete(readmeUri.toString());
  if (readmeCodeLensProvider) {
    readmeCodeLensProvider.clearState(readmeUri);
  }
}

// Old whole-file commands removed. Replaced by section-by-section handlers.


async function showPanelCommand() {
  const panel = vscode.window.createWebviewPanel('githubAutomatorPanel', 'GitHub Automator', vscode.ViewColumn.One, { enableScripts: true });
  panel.webview.html = `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <style>body{font-family:var(--vscode-font-family);padding:16px;color:var(--vscode-foreground)} button{background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:8px 12px;border:0;border-radius:4px;margin-right:6px;margin-bottom:6px}</style>
    </head>
    <body>
      <h2>GitHub Automator</h2>
      <p>Use the commands below to manage repositories and git workflows.</p>
      <button onclick="vscode.postMessage({ command: 'authenticate' })">Authenticate</button>
      <button onclick="vscode.postMessage({ command: 'refreshRepos' })">Refresh</button>
      <button onclick="vscode.postMessage({ command: 'createRepo' })">Create Repo</button>
      <button onclick="vscode.postMessage({ command: 'publishFolder' })">Publish Folder</button>
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
      case 'publishFolder':
        await publishFolder(extensionContext, reposViewProvider);
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

async function activate(context) {
  const startTime = Date.now();
  console.log('[GitHub Automator] activate() started');
  
  extensionContext = context;
  initCredentialManager(context);
  outputChannel = createOutputChannel();
  context.subscriptions.push(outputChannel);
  console.log(`[GitHub Automator] output channel created: ${Date.now() - startTime} ms`);

  const depManager = new DependencyManager(getBackendRoot());
  const depsOk = await depManager.ensureDependencies(outputChannel);
  if (!depsOk) {
    vscode.window.showErrorMessage('GitHub Automator requires missing dependencies to be installed. Some features may not work.');
  }

  // Automatically migrate legacy 'gemini-1.5-flash' setting to 'gemini-3.6-flash'
  try {
    const config = vscode.workspace.getConfiguration('github-automator');
    const currentModel = config.get('geminiModel');
    if (currentModel === 'gemini-1.5-flash') {
      config.update('geminiModel', 'gemini-3.6-flash', vscode.ConfigurationTarget.Global);
      log('Automatically migrated legacy geminiModel setting from gemini-1.5-flash to gemini-3.6-flash');
    }
  } catch (e) {
    log(`Failed to migrate legacy geminiModel setting: ${e && e.message ? e.message : e}`);
  }
  console.log(`[GitHub Automator] config migrated: ${Date.now() - startTime} ms`);

  console.log('[GitHub Automator] Python bridge initialization started');
  // Wait for the Python daemon to be ready
  try {
    await getPersistentPythonProcess(getBackendRoot());
    console.log(`[GitHub Automator] Python bridge initialization finished: ${Date.now() - startTime} ms`);
  } catch (e) {
    log(`Daemon startup failed: ${e && e.message ? e.message : e}`);
    vscode.window.showErrorMessage(`GitHub Automator: Backend failed to start. ${e.message}`);
  }

  console.log('[GitHub Automator] providers registered');
  reposViewProvider = new RepositoriesWebviewProvider(context);
  actionsViewProvider = new ActionsWebviewProvider(context);

  readmeCodeLensProvider = new ReadmeCodeLensProvider();
  readmeCodeLensProvider.activeReadmeSessions = activeReadmeSessions;

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('github-automator.repoView', reposViewProvider),
    vscode.window.registerWebviewViewProvider('github-automator.actionsView', actionsViewProvider),
    vscode.languages.registerCodeLensProvider(
      { language: 'markdown', scheme: 'file' },
      readmeCodeLensProvider
    ),
    vscode.workspace.onDidChangeTextDocument(e => {
      const fileName = path.basename(e.document.fileName).toLowerCase();
      if (fileName === 'readme.md') {
        const session = activeReadmeSessions.get(e.document.uri.toString());
        if (session) {
          if (session.isApplyingOwnEdit) return;
          if (session.status === 'reviewing' || session.status === 'completed' || session.status === 'applied-unsaved') {
            session.status = 'error';
            readmeCodeLensProvider.fire();
            vscode.window.showWarningMessage('README changed while AI review was in progress. Please close and re-evaluate.');
            discardReadmeSuggestionCommand(e.document.uri);
          }
        } else {
          readmeCodeLensProvider.clearState(e.document.uri);
        }
      }
    }),
    vscode.workspace.onDidOpenTextDocument(e => {
      const fileName = path.basename(e.document.fileName).toLowerCase();
      if (fileName === 'readme.md') {
        const session = activeReadmeSessions.get(e.document.uri.toString());
        if (!session) {
          readmeCodeLensProvider.clearState(e.document.uri);
        }
      }
    }),
    vscode.workspace.onDidSaveTextDocument(e => {
      const fileName = path.basename(e.fileName).toLowerCase();
      if (fileName === 'readme.md') {
        const session = activeReadmeSessions.get(e.uri.toString());
        if (session && session.status === 'applied-unsaved') {
          session.status = 'saved';
          readmeCodeLensProvider.fire();
        }
      }
    })
  );
  console.log(`[GitHub Automator] providers registered: ${Date.now() - startTime} ms`);

  function closeWebviewPopovers() {
    if (reposViewProvider && reposViewProvider.view) {
      reposViewProvider.view.webview.postMessage({ command: 'closePopovers' });
    }
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(() => closeWebviewPopovers()),
    vscode.window.onDidChangeTextEditorSelection(() => closeWebviewPopovers()),
    vscode.window.onDidChangeVisibleTextEditors(() => closeWebviewPopovers()),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (e.affectsConfiguration('github-automator.pinActiveRepositoryToTop')) {
        reposViewProvider.update();
      }
    })
  );

  console.log('[GitHub Automator] commands registered');
  const commands = [
    vscode.commands.registerCommand('github-automator.authenticate', () => authenticateCommand()),
    vscode.commands.registerCommand('github-automator.logout', () => logoutCommand()),
    vscode.commands.registerCommand('github-automator.showPanel', () => showPanelCommand()),
    vscode.commands.registerCommand('github-automator.refreshRepos', () => refreshReposCommand()),
    vscode.commands.registerCommand('github-automator.repoOptions', () => repoOptionsCommand()),
    vscode.commands.registerCommand('github-automator.createRepo', () => createRepoCommand()),
    vscode.commands.registerCommand('github-automator.publishFolder', () => publishFolder(extensionContext, reposViewProvider)),
    vscode.commands.registerCommand('github-automator.deleteRepo', () => deleteRepoCommand()),
    vscode.commands.registerCommand('github-automator.cloneRepo', () => cloneRepoCommand()),
    vscode.commands.registerCommand('github-automator.initializeRepo', () => initializeRepoCommand()),
    vscode.commands.registerCommand('github-automator.commitAndPush', () => commitAndPushCommand()),
    vscode.commands.registerCommand('github-automator.aiGenerate', () => aiGenerateCommand()),
    vscode.commands.registerCommand('github-automator.generateReadme', (uri) => generateReadmeCommand(uri)),
    vscode.commands.registerCommand('github-automator.applyReviewedChanges', (uri) => applyReviewedChangesCommand(uri)),
    vscode.commands.registerCommand('github-automator.reviewFullDiff', (uri) => reviewFullDiffCommand(uri)),
    vscode.commands.registerCommand('github-automator.discardReadmeSuggestion', (uri) => discardReadmeSuggestionCommand(uri)),
    vscode.commands.registerCommand('github-automator.commitReadmeChanges', (uri) => commitReadmeChangesCommand(uri)),
    vscode.commands.registerCommand('github-automator.dismissReadmeSession', (uri) => dismissReadmeSessionCommand(uri)),

    vscode.commands.registerCommand('github-automator.configureGeminiApiKey', () => configureGeminiApiKey()),
    vscode.commands.registerCommand('github-automator.removeGeminiApiKey', () => removeGeminiApiKey())
  ];

  context.subscriptions.push(...commands);
  console.log(`[GitHub Automator] commands registered: ${Date.now() - startTime} ms`);

  console.log('[GitHub Automator] repository initialization started');
  updateAuthContext(false).catch(() => {});
  console.log(`[GitHub Automator] repository initialization started: ${Date.now() - startTime} ms`);

  console.log(`[GitHub Automator] activation completed in ${Date.now() - startTime} ms`);
  return { extendContextMenu: undefined };
}

function deactivate() {
  log('Extension deactivated');
  killPersistentPythonProcess();
}

module.exports = {
  activate,
  deactivate
};
