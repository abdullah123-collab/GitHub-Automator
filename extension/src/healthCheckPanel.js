/**
 * healthCheckPanel.js — Dedicated Webview Panel for Repository Health Check (Phase 1: Strictly Read-Only)
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');
const { runRepositoryHealthCheck } = require('./services/healthService');

class HealthCheckPanel {
  static currentPanel = undefined;

  static async createOrShow(extensionUri, repoPath, repoName) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : vscode.ViewColumn.One;

    if (HealthCheckPanel.currentPanel) {
      HealthCheckPanel.currentPanel._panel.reveal(column);
      if (repoPath && repoPath !== HealthCheckPanel.currentPanel._repoPath) {
        HealthCheckPanel.currentPanel._repoPath = repoPath;
        HealthCheckPanel.currentPanel._repoName = repoName || path.basename(repoPath);
        await HealthCheckPanel.currentPanel.runDiagnostics();
      }
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'githubAutomatorHealthCheck',
      'Repository Health Check',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [extensionUri]
      }
    );

    HealthCheckPanel.currentPanel = new HealthCheckPanel(panel, extensionUri, repoPath, repoName);
    await HealthCheckPanel.currentPanel.runDiagnostics();
  }

  constructor(panel, extensionUri, repoPath, repoName) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._repoPath = repoPath;
    this._repoName = repoName || (repoPath ? path.basename(repoPath) : 'Current Workspace');
    this._healthData = null;
    this._loading = true;
    this._errorMessage = '';

    this._panel.onDidDispose(() => this.dispose(), null, []);

    this._panel.webview.onDidReceiveMessage(
      async message => {
        const command = message && message.command;
        if (!command) return;

        switch (command) {
          case 'refresh':
            await this.runDiagnostics();
            break;
          case 'copyJson':
            if (this._healthData) {
              await vscode.env.clipboard.writeText(JSON.stringify(this._healthData, null, 2));
              vscode.window.showInformationMessage('Health check report copied to clipboard.');
            }
            break;
          case 'openFile':
            // Strictly read-only open of file
            if (message.payload && message.payload.filePath && this._repoPath) {
              const fullPath = path.isAbsolute(message.payload.filePath)
                ? message.payload.filePath
                : path.join(this._repoPath, message.payload.filePath);
              if (fs.existsSync(fullPath)) {
                const uri = vscode.Uri.file(fullPath);
                await vscode.commands.executeCommand('vscode.open', uri);
              } else {
                vscode.window.showWarningMessage(`File not found on disk: ${message.payload.filePath}`);
              }
            }
            break;
        }
      },
      null,
      []
    );

    this.render();
  }

  async runDiagnostics() {
    this._loading = true;
    this._errorMessage = '';
    this.render();

    try {
      this._healthData = await runRepositoryHealthCheck(this._repoPath, { thresholdMb: 50 });
      this._loading = false;
      this.render();
    } catch (err) {
      this._loading = false;
      this._errorMessage = err && err.message ? err.message : String(err);
      this.render();
    }
  }

  dispose() {
    HealthCheckPanel.currentPanel = undefined;
    this._panel.dispose();
  }

  render() {
    this._panel.webview.html = this.getHtml();
  }

  getHtml() {
    const data = this._healthData;
    const repoName = this._repoName || 'Workspace';
    const repoPath = this._repoPath || 'No folder open';

    if (this._loading && !data) {
      return `<!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <style>
          body { font-family: var(--vscode-font-family); background: var(--vscode-editor-background); color: var(--vscode-foreground); padding: 24px; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 80vh; }
          .spinner { width: 36px; height: 36px; border: 3px solid rgba(255,255,255,0.2); border-top-color: var(--vscode-button-background); border-radius: 50%; animation: spin 0.8s linear infinite; margin-bottom: 16px; }
          @keyframes spin { to { transform: rotate(360deg); } }
          h2 { margin: 0 0 8px 0; font-size: 18px; font-weight: 600; }
          p { margin: 0; opacity: 0.8; font-size: 13px; }
        </style>
      </head>
      <body>
        <div class="spinner"></div>
        <h2>Running Repository Health Diagnostics...</h2>
        <p>Scanning Git status, working tree, configuration, and tracked files (read-only).</p>
      </body>
      </html>`;
    }

    const overall = (data && data.overallStatus) || 'NEEDS ATTENTION';
    let bannerClass = 'banner-warning';
    let bannerIcon = '⚠';
    let bannerLabel = 'NEEDS ATTENTION';

    if (overall === 'HEALTHY') {
      bannerClass = 'banner-healthy';
      bannerIcon = '✓';
      bannerLabel = 'HEALTHY';
    } else if (overall === 'ERROR') {
      bannerClass = 'banner-error';
      bannerIcon = '✕';
      bannerLabel = 'ERROR';
    }

    const summaryText = (data && data.summary) || 'Diagnostic scan completed.';
    const scannedAt = data && data.scannedAt ? new Date(data.scannedAt).toLocaleTimeString() : 'N/A';
    const durationMs = data && typeof data.scanDurationMs === 'number' ? `${data.scanDurationMs} ms` : '';

    const issues = (data && data.issues) || [];
    const git = (data && data.git) || { status: 'healthy', message: 'Git installed' };
    const repo = (data && data.repository) || { status: 'healthy', message: 'Valid repository' };
    const remote = (data && data.remote) || { status: 'healthy', message: 'Remote origin' };
    const branch = (data && data.branch) || { status: 'healthy', message: 'Branch in sync' };
    const tree = (data && data.workingTree) || { status: 'healthy', message: 'Clean tree' };
    const identity = (data && data.identity) || { status: 'healthy', message: 'Identity set' };
    const gitignore = (data && data.gitignore) || { status: 'healthy', message: '.gitignore valid' };
    const largeFiles = (data && data.largeFiles) || { status: 'healthy', message: 'No large files' };

    const getStatusIcon = (status) => {
      if (status === 'healthy') return '<span class="status-badge badge-healthy">✓ Healthy</span>';
      if (status === 'warning') return '<span class="status-badge badge-warning">⚠ Warning</span>';
      if (status === 'error') return '<span class="status-badge badge-error">✕ Error</span>';
      return '<span class="status-badge badge-na">ℹ N/A</span>';
    };

    const getLeadingIcon = (status) => {
      if (status === 'healthy') return '<span class="lead-icon icon-healthy">✓</span>';
      if (status === 'warning') return '<span class="lead-icon icon-warning">⚠</span>';
      if (status === 'error') return '<span class="lead-icon icon-error">✕</span>';
      return '<span class="lead-icon icon-na">ℹ</span>';
    };

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Repository Health Check</title>
      <style>
        :root {
          color-scheme: dark light;
        }
        body {
          font-family: var(--vscode-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
          font-size: var(--vscode-font-size, 13px);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          margin: 0;
          padding: 20px 24px;
          line-height: 1.5;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 1px solid var(--vscode-panel-border, #3c3c3c);
          padding-bottom: 16px;
          margin-bottom: 20px;
        }
        .title-group h1 {
          margin: 0 0 4px 0;
          font-size: 20px;
          font-weight: 600;
        }
        .repo-meta {
          font-size: 12px;
          color: var(--vscode-descriptionForeground, #8c8c8c);
          display: flex;
          gap: 16px;
        }
        .actions-group {
          display: flex;
          gap: 8px;
        }
        button {
          background-color: var(--vscode-button-background, #0e639c);
          color: var(--vscode-button-foreground, #ffffff);
          border: none;
          border-radius: 4px;
          padding: 6px 14px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          gap: 6px;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground, #1177bb);
        }
        button.secondary {
          background-color: var(--vscode-button-secondaryBackground, #3a3d41);
          color: var(--vscode-button-secondaryForeground, #ffffff);
        }
        button.secondary:hover {
          background-color: var(--vscode-button-secondaryHoverBackground, #45494e);
        }
        .banner {
          border-radius: 6px;
          padding: 16px 20px;
          margin-bottom: 24px;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .banner-healthy {
          background-color: rgba(46, 160, 67, 0.12);
          border: 1px solid rgba(46, 160, 67, 0.4);
        }
        .banner-warning {
          background-color: rgba(210, 153, 34, 0.12);
          border: 1px solid rgba(210, 153, 34, 0.4);
        }
        .banner-error {
          background-color: rgba(248, 81, 73, 0.12);
          border: 1px solid rgba(248, 81, 73, 0.4);
        }
        .banner-icon {
          font-size: 28px;
          line-height: 1;
        }
        .banner-healthy .banner-icon { color: #3fb950; }
        .banner-warning .banner-icon { color: #d29922; }
        .banner-error .banner-icon { color: #f85149; }
        .banner-title {
          font-size: 16px;
          font-weight: 700;
          letter-spacing: 0.5px;
          margin-bottom: 2px;
        }
        .banner-desc {
          font-size: 13px;
          opacity: 0.9;
        }
        .section-title {
          font-size: 14px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.8px;
          color: var(--vscode-descriptionForeground, #8c8c8c);
          margin: 24px 0 12px 0;
        }
        .issues-container {
          display: flex;
          flex-direction: column;
          gap: 10px;
          margin-bottom: 24px;
        }
        .issue-card {
          background: var(--vscode-sideBar-background, #252526);
          border: 1px solid var(--vscode-panel-border, #3c3c3c);
          border-left-width: 4px;
          border-radius: 6px;
          padding: 12px 16px;
        }
        .issue-card.issue-error { border-left-color: #f85149; }
        .issue-card.issue-warning { border-left-color: #d29922; }
        .issue-card.issue-info { border-left-color: #58a6ff; }
        .issue-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-weight: 600;
          margin-bottom: 6px;
        }
        .issue-badge {
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 3px;
          text-transform: uppercase;
        }
        .issue-error .issue-badge { background: rgba(248, 81, 73, 0.2); color: #f85149; }
        .issue-warning .issue-badge { background: rgba(210, 153, 34, 0.2); color: #d29922; }
        .issue-info .issue-badge { background: rgba(88, 166, 255, 0.2); color: #58a6ff; }
        .issue-desc {
          font-size: 13px;
          margin-bottom: 4px;
        }
        .issue-why {
          font-size: 12px;
          color: var(--vscode-descriptionForeground, #8c8c8c);
        }
        .checks-grid {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .check-item {
          background: var(--vscode-sideBar-background, #252526);
          border: 1px solid var(--vscode-panel-border, #3c3c3c);
          border-radius: 6px;
          overflow: hidden;
        }
        .check-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 12px 16px;
          cursor: pointer;
          user-select: none;
        }
        .check-header:hover {
          background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.04));
        }
        .check-lead {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .lead-icon {
          font-size: 15px;
          font-weight: bold;
          width: 20px;
          text-align: center;
        }
        .icon-healthy { color: #3fb950; }
        .icon-warning { color: #d29922; }
        .icon-error { color: #f85149; }
        .icon-na { color: #8c8c8c; }
        .check-title {
          font-weight: 600;
          font-size: 13px;
        }
        .check-summary {
          font-size: 12px;
          color: var(--vscode-descriptionForeground, #8c8c8c);
          margin-left: 8px;
        }
        .check-trail {
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .status-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 12px;
          font-weight: 600;
        }
        .badge-healthy { background: rgba(46, 160, 67, 0.15); color: #3fb950; }
        .badge-warning { background: rgba(210, 153, 34, 0.15); color: #d29922; }
        .badge-error { background: rgba(248, 81, 73, 0.15); color: #f85149; }
        .badge-na { background: rgba(140, 140, 140, 0.15); color: #8c8c8c; }
        .chevron {
          transition: transform 0.2s ease;
          font-size: 11px;
          opacity: 0.6;
        }
        .check-item.open .chevron {
          transform: rotate(90deg);
        }
        .check-details {
          display: none;
          padding: 12px 16px 16px 44px;
          border-top: 1px solid var(--vscode-panel-border, #3c3c3c);
          background: rgba(0,0,0,0.1);
          font-size: 12px;
        }
        .check-item.open .check-details {
          display: block;
        }
        .detail-row {
          display: flex;
          margin-bottom: 6px;
        }
        .detail-label {
          width: 140px;
          color: var(--vscode-descriptionForeground, #8c8c8c);
          flex-shrink: 0;
        }
        .detail-val {
          color: var(--vscode-foreground);
          word-break: break-all;
        }
        .file-list {
          margin-top: 8px;
          max-height: 160px;
          overflow-y: auto;
          border: 1px solid var(--vscode-panel-border, #3c3c3c);
          border-radius: 4px;
          background: var(--vscode-editor-background);
        }
        .file-item {
          padding: 4px 8px;
          font-family: var(--vscode-editor-font-family, monospace);
          font-size: 11px;
          border-bottom: 1px solid rgba(255,255,255,0.05);
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
        }
        .file-item:hover {
          background: var(--vscode-list-hoverBackground, rgba(255,255,255,0.05));
          color: var(--vscode-textLink-foreground, #3794ff);
        }
        .file-badge {
          font-size: 10px;
          padding: 1px 5px;
          border-radius: 3px;
          background: rgba(255,255,255,0.1);
        }
        .tag-pill {
          display: inline-block;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          margin-right: 4px;
          margin-bottom: 4px;
        }
        .tag-detected { background: rgba(46, 160, 67, 0.2); color: #3fb950; }
        .tag-missing { background: rgba(210, 153, 34, 0.2); color: #d29922; }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title-group">
          <h1>Repository Health</h1>
          <div class="repo-meta">
            <span><strong>Repo:</strong> ${this.escape(repoName)}</span>
            <span><strong>Path:</strong> ${this.escape(repoPath)}</span>
            <span><strong>Scanned:</strong> ${scannedAt} ${durationMs ? `(${durationMs})` : ''}</span>
          </div>
        </div>
        <div class="actions-group">
          <button class="secondary" onclick="postCommand('copyJson')">
            <span>📋</span> Copy JSON Report
          </button>
          <button onclick="postCommand('refresh')">
            <span>🔄</span> Re-run Diagnostics
          </button>
        </div>
      </div>

      <div class="banner ${bannerClass}">
        <div class="banner-icon">${bannerIcon}</div>
        <div>
          <div class="banner-title">${bannerLabel}</div>
          <div class="banner-desc">${this.escape(summaryText)}</div>
        </div>
      </div>

      ${issues.length > 0 ? `
        <div class="section-title">Detected Issues (${issues.length})</div>
        <div class="issues-container">
          ${issues.map(iss => `
            <div class="issue-card issue-${iss.severity}">
              <div class="issue-header">
                <span class="issue-badge">${iss.severity}</span>
                <span>${this.escape(iss.title)}</span>
                <span style="opacity:0.5; font-size:11px; margin-left:auto;">${this.escape(iss.category)}</span>
              </div>
              <div class="issue-desc">${this.escape(iss.description)}</div>
              <div class="issue-why"><strong>Why it matters:</strong> ${this.escape(iss.whyItMatters)}</div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <div class="section-title">Individual Checks (8)</div>
      <div class="checks-grid">
        <!-- 1. Git Detection -->
        <div class="check-item" onclick="toggleCard(this)">
          <div class="check-header">
            <div class="check-lead">
              ${getLeadingIcon(git.status)}
              <span class="check-title">Git</span>
              <span class="check-summary">— ${this.escape(git.message)}</span>
            </div>
            <div class="check-trail">
              ${getStatusIcon(git.status)}
              <span class="chevron">▶</span>
            </div>
          </div>
          <div class="check-details" onclick="event.stopPropagation()">
            <div class="detail-row">
              <span class="detail-label">Git Installed:</span>
              <span class="detail-val">${git.installed ? 'Yes' : 'No'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Git Version:</span>
              <span class="detail-val">${this.escape(git.version || 'Not detected')}</span>
            </div>
          </div>
        </div>

        <!-- 2. Repository Information -->
        <div class="check-item" onclick="toggleCard(this)">
          <div class="check-header">
            <div class="check-lead">
              ${getLeadingIcon(repo.status)}
              <span class="check-title">Repository</span>
              <span class="check-summary">— ${this.escape(repo.message)}</span>
            </div>
            <div class="check-trail">
              ${getStatusIcon(repo.status)}
              <span class="chevron">▶</span>
            </div>
          </div>
          <div class="check-details" onclick="event.stopPropagation()">
            <div class="detail-row">
              <span class="detail-label">Repository Root:</span>
              <span class="detail-val">${this.escape(repo.root || 'N/A')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Repository Name:</span>
              <span class="detail-val">${this.escape(repo.name || 'N/A')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">.git Exists:</span>
              <span class="detail-val">${repo.dotGitExists ? 'Yes' : 'No'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Worktree Valid:</span>
              <span class="detail-val">${repo.valid ? 'Yes' : 'No'}</span>
            </div>
          </div>
        </div>

        <!-- 3. Remote -->
        <div class="check-item" onclick="toggleCard(this)">
          <div class="check-header">
            <div class="check-lead">
              ${getLeadingIcon(remote.status)}
              <span class="check-title">Remote</span>
              <span class="check-summary">— ${this.escape(remote.message)}</span>
            </div>
            <div class="check-trail">
              ${getStatusIcon(remote.status)}
              <span class="chevron">▶</span>
            </div>
          </div>
          <div class="check-details" onclick="event.stopPropagation()">
            <div class="detail-row">
              <span class="detail-label">Has Remote:</span>
              <span class="detail-val">${remote.hasRemote ? 'Yes' : 'No (Local-only)'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Remote Name:</span>
              <span class="detail-val">${this.escape(remote.remoteName || 'None')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Remote URL:</span>
              <span class="detail-val">${this.escape(remote.remoteUrl || 'None')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">GitHub Host:</span>
              <span class="detail-val">${remote.isGitHub ? 'Yes (github.com)' : 'No'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Connectivity:</span>
              <span class="detail-val">${this.escape(remote.connectivity || 'Not verified')}</span>
            </div>
          </div>
        </div>

        <!-- 4. Branch -->
        <div class="check-item" onclick="toggleCard(this)">
          <div class="check-header">
            <div class="check-lead">
              ${getLeadingIcon(branch.status)}
              <span class="check-title">Branch</span>
              <span class="check-summary">— ${this.escape(branch.message)}</span>
            </div>
            <div class="check-trail">
              ${getStatusIcon(branch.status)}
              <span class="chevron">▶</span>
            </div>
          </div>
          <div class="check-details" onclick="event.stopPropagation()">
            <div class="detail-row">
              <span class="detail-label">Current Branch:</span>
              <span class="detail-val">${this.escape(branch.currentBranch || 'None')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Detached HEAD:</span>
              <span class="detail-val">${branch.isDetached ? 'Yes (Detached)' : 'No'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Has Commits:</span>
              <span class="detail-val">${branch.hasCommits ? 'Yes' : 'No (Empty repository)'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Upstream Branch:</span>
              <span class="detail-val">${this.escape(branch.upstreamBranch || 'Not configured')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Ahead / Behind:</span>
              <span class="detail-val">${branch.ahead !== null && branch.ahead !== undefined ? `${branch.ahead} ahead, ${branch.behind} behind` : 'N/A'}</span>
            </div>
          </div>
        </div>

        <!-- 5. Working Tree -->
        <div class="check-item" onclick="toggleCard(this)">
          <div class="check-header">
            <div class="check-lead">
              ${getLeadingIcon(tree.status)}
              <span class="check-title">Working Tree</span>
              <span class="check-summary">— ${this.escape(tree.message)}</span>
            </div>
            <div class="check-trail">
              ${getStatusIcon(tree.status)}
              <span class="chevron">▶</span>
            </div>
          </div>
          <div class="check-details" onclick="event.stopPropagation()">
            <div class="detail-row">
              <span class="detail-label">Tree State:</span>
              <span class="detail-val">${tree.clean ? 'Clean' : 'Changes present'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Modified:</span>
              <span class="detail-val">${tree.modified || 0}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Staged:</span>
              <span class="detail-val">${tree.staged || 0}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Untracked:</span>
              <span class="detail-val">${tree.untracked || 0}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Deleted:</span>
              <span class="detail-val">${tree.deleted || 0}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Conflicted:</span>
              <span class="detail-val" style="${tree.conflicted > 0 ? 'color:#f85149;font-weight:bold;' : ''}">${tree.conflicted || 0}</span>
            </div>

            ${(tree.conflictedFiles && tree.conflictedFiles.length > 0) ? `
              <div style="margin-top:10px; font-weight:600; color:#f85149;">Conflicted Files (Click to inspect in editor):</div>
              <div class="file-list">
                ${tree.conflictedFiles.map(f => `
                  <div class="file-item" onclick="openFile('${this.escape(f)}')">
                    <span>${this.escape(f)}</span>
                    <span class="file-badge" style="color:#f85149;">Conflict</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}

            ${(tree.modifiedFiles && tree.modifiedFiles.length > 0) ? `
              <div style="margin-top:10px; font-weight:600;">Modified Files:</div>
              <div class="file-list">
                ${tree.modifiedFiles.map(f => `
                  <div class="file-item" onclick="openFile('${this.escape(f)}')">
                    <span>${this.escape(f)}</span>
                    <span class="file-badge">Modified</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}

            ${(tree.untrackedFiles && tree.untrackedFiles.length > 0) ? `
              <div style="margin-top:10px; font-weight:600;">Untracked Files (Identified via git status):</div>
              <div class="file-list">
                ${tree.untrackedFiles.map(f => `
                  <div class="file-item" onclick="openFile('${this.escape(f)}')">
                    <span>${this.escape(f)}</span>
                    <span class="file-badge">Untracked</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>

        <!-- 6. Git Identity -->
        <div class="check-item" onclick="toggleCard(this)">
          <div class="check-header">
            <div class="check-lead">
              ${getLeadingIcon(identity.status)}
              <span class="check-title">Git Identity</span>
              <span class="check-summary">— ${this.escape(identity.message)}</span>
            </div>
            <div class="check-trail">
              ${getStatusIcon(identity.status)}
              <span class="chevron">▶</span>
            </div>
          </div>
          <div class="check-details" onclick="event.stopPropagation()">
            <div class="detail-row">
              <span class="detail-label">Configured:</span>
              <span class="detail-val">${identity.configured ? 'Yes' : 'Incomplete'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">user.name:</span>
              <span class="detail-val">${this.escape(identity.userName || 'Not set')}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">user.email:</span>
              <span class="detail-val">${this.escape(identity.userEmail || 'Not set')}</span>
            </div>
          </div>
        </div>

        <!-- 7. Gitignore -->
        <div class="check-item" onclick="toggleCard(this)">
          <div class="check-header">
            <div class="check-lead">
              ${getLeadingIcon(gitignore.status)}
              <span class="check-title">Gitignore</span>
              <span class="check-summary">— ${this.escape(gitignore.message)}</span>
            </div>
            <div class="check-trail">
              ${getStatusIcon(gitignore.status)}
              <span class="chevron">▶</span>
            </div>
          </div>
          <div class="check-details" onclick="event.stopPropagation()">
            <div class="detail-row">
              <span class="detail-label">.gitignore Exists:</span>
              <span class="detail-val">${gitignore.exists ? 'Yes' : 'No'}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Detected Patterns:</span>
              <div class="detail-val">
                ${gitignore.patternsDetected && gitignore.patternsDetected.length > 0
                  ? gitignore.patternsDetected.map(p => `<span class="tag-pill tag-detected">✓ ${this.escape(p)}</span>`).join('')
                  : '<span style="opacity:0.6;">None detected</span>'}
              </div>
            </div>
            <div class="detail-row">
              <span class="detail-label">Missing Patterns:</span>
              <div class="detail-val">
                ${gitignore.patternsMissing && gitignore.patternsMissing.length > 0
                  ? gitignore.patternsMissing.map(p => `<span class="tag-pill tag-missing">⚠ ${this.escape(p)} (Recommended)</span>`).join('')
                  : '<span style="opacity:0.6;">None</span>'}
              </div>
            </div>
          </div>
        </div>

        <!-- 8. Large Files -->
        <div class="check-item" onclick="toggleCard(this)">
          <div class="check-header">
            <div class="check-lead">
              ${getLeadingIcon(largeFiles.status)}
              <span class="check-title">Large Files</span>
              <span class="check-summary">— ${this.escape(largeFiles.message)}</span>
            </div>
            <div class="check-trail">
              ${getStatusIcon(largeFiles.status)}
              <span class="chevron">▶</span>
            </div>
          </div>
          <div class="check-details" onclick="event.stopPropagation()">
            <div class="detail-row">
              <span class="detail-label">Threshold:</span>
              <span class="detail-val">${largeFiles.thresholdMb || 50} MB (1024 × 1024 bytes)</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Scanning Scope:</span>
              <span class="detail-val">Tracked files only (via git ls-files)</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">Detected:</span>
              <span class="detail-val">${largeFiles.count || 0} file(s)</span>
            </div>

            ${(largeFiles.detected && largeFiles.detected.length > 0) ? `
              <div style="margin-top:10px; font-weight:600;">Large Tracked Files:</div>
              <div class="file-list">
                ${largeFiles.detected.map(f => `
                  <div class="file-item" onclick="openFile('${this.escape(f.path)}')">
                    <span>${this.escape(f.path)}</span>
                    <span class="file-badge" style="color:#d29922;">${this.escape(f.sizeFormatted)}</span>
                  </div>
                `).join('')}
              </div>
            ` : ''}
          </div>
        </div>
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        function postCommand(command, payload) {
          vscode.postMessage({ command, payload });
        }

        function openFile(filePath) {
          vscode.postMessage({ command: 'openFile', payload: { filePath } });
        }

        function toggleCard(el) {
          el.classList.toggle('open');
        }
      </script>
    </body>
    </html>`;
  }

  escape(text) {
    if (text === null || text === undefined) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}

module.exports = {
  HealthCheckPanel
};
