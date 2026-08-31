/**
 * repositoryGuardPanel.js — Dedicated Webview Panel for Repository Guard (Phase 2C)
 */

const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

class RepositoryGuardPanel {
  static currentPanel = undefined;

  /**
   * Shows the Repository Guard panel and waits for user decision.
   *
   * @param {vscode.Uri} extensionUri
   * @param {string} repoPath
   * @param {object} guardResult
   * @returns {Promise<{ action: 'cancel' | 'continue' | 'review' }>}
   */
  static showOrPrompt(extensionUri, repoPath, guardResult) {
    return new Promise((resolve) => {
      let isResolved = false;

      const safeResolve = (action) => {
        if (!isResolved) {
          isResolved = true;
          resolve({ action });
        }
      };

      const column = vscode.window.activeTextEditor
        ? vscode.window.activeTextEditor.viewColumn
        : vscode.ViewColumn.Beside;

      if (RepositoryGuardPanel.currentPanel) {
        RepositoryGuardPanel.currentPanel._panel.reveal(column || vscode.ViewColumn.Beside);
        RepositoryGuardPanel.currentPanel.update(repoPath, guardResult, safeResolve);
        return;
      }

      const panel = vscode.window.createWebviewPanel(
        'githubAutomatorRepoGuard',
        'Repository Guard',
        column || vscode.ViewColumn.Beside,
        {
          enableScripts: true,
          retainContextWhenHidden: true,
          localResourceRoots: [extensionUri]
        }
      );

      RepositoryGuardPanel.currentPanel = new RepositoryGuardPanel(panel, extensionUri, repoPath, guardResult, safeResolve);
    });
  }

  constructor(panel, extensionUri, repoPath, guardResult, resolveCallback) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._repoPath = repoPath;
    this._guardResult = guardResult;
    this._resolveCallback = resolveCallback;

    this._panel.onDidDispose(() => {
      this.dispose();
    }, null, []);

    this._panel.webview.onDidReceiveMessage(
      async (message) => {
        const command = message && message.command;
        if (!command) return;

        switch (command) {
          case 'continue':
            this._resolveCallback('continue');
            this._panel.dispose();
            break;

          case 'cancel':
            this._resolveCallback('cancel');
            this._panel.dispose();
            break;

          case 'openFile':
            if (message.payload && message.payload.filePath && this._repoPath) {
              await this.openFileAtLine(message.payload.filePath, message.payload.line);
            }
            break;
        }
      },
      null,
      []
    );

    this.render();
  }

  update(repoPath, guardResult, resolveCallback) {
    this._repoPath = repoPath;
    this._guardResult = guardResult;
    this._resolveCallback = resolveCallback;
    this.render();
  }

  async openFileAtLine(relPath, lineNum) {
    try {
      const fullPath = path.isAbsolute(relPath)
        ? relPath
        : path.join(this._repoPath, relPath);

      if (!fs.existsSync(fullPath)) {
        vscode.window.showWarningMessage(`File not found: ${relPath}`);
        return;
      }

      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(fullPath));
      const line = typeof lineNum === 'number' && lineNum > 0 ? lineNum - 1 : 0;
      const pos = new vscode.Position(line, 0);
      const range = new vscode.Range(pos, pos);

      await vscode.window.showTextDocument(doc, {
        preview: false,
        selection: range
      });
    } catch (e) {
      vscode.window.showErrorMessage(`Unable to open file: ${e && e.message ? e.message : e}`);
    }
  }

  dispose() {
    // Panel disposal always defaults to 'cancel' for safety
    if (this._resolveCallback) {
      this._resolveCallback('cancel');
    }
    RepositoryGuardPanel.currentPanel = undefined;
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  render() {
    this._panel.webview.html = this.getHtml();
  }

  getHtml() {
    const data = this._guardResult || {};
    const repoName = this._repoPath ? path.basename(this._repoPath) : 'Current Repository';
    const operation = data.operation ? data.operation.toUpperCase() : 'OPERATION';
    const status = data.overallStatus || 'BLOCKED';

    const blockingIssues = Array.isArray(data.blockingIssues) ? data.blockingIssues : [];
    const warnings = Array.isArray(data.warnings) ? data.warnings : [];
    const info = Array.isArray(data.info) ? data.info : [];

    let statusBadgeClass = 'badge-blocked';
    let statusIcon = '🔴';
    let statusText = 'BLOCKED';
    let summaryText = 'One or more blocking security issues detected. Operation cannot continue.';

    if (status === 'PASS') {
      statusBadgeClass = 'badge-pass';
      statusIcon = '✓';
      statusText = 'PASS';
      summaryText = 'Repository passed all security and state pre-flight checks.';
    } else if (status === 'WARNING') {
      statusBadgeClass = 'badge-warning';
      statusIcon = '⚠';
      statusText = 'WARNING';
      summaryText = 'Potential repository issues detected. Review before continuing.';
    } else if (status === 'ERROR') {
      statusBadgeClass = 'badge-error';
      statusIcon = '✕';
      statusText = 'ERROR';
      summaryText = 'Repository Guard scanner encountered an error. Operation halted for safety.';
    }

    const canContinue = status === 'WARNING';

    const renderIssueCard = (issue, isBlocking) => {
      const icon = isBlocking ? '🔴' : '⚠';
      const fileBadge = issue.file
        ? `<span class="issue-file" onclick="openFile('${this.escapeHtml(issue.file)}', ${issue.line || 0})" title="Click to view in editor">📄 ${this.escapeHtml(issue.file)}${issue.line ? `:${issue.line}` : ''}</span>`
        : '';
      const reviewBtn = issue.file
        ? `<button class="btn-review" onclick="openFile('${this.escapeHtml(issue.file)}', ${issue.line || 0})">Review File</button>`
        : '';

      return `
        <div class="issue-card ${isBlocking ? 'issue-block' : 'issue-warn'}">
          <div class="issue-header">
            <span class="issue-icon">${icon}</span>
            <span class="issue-title">${this.escapeHtml(issue.title)}</span>
            <span class="issue-category">${this.escapeHtml(issue.category || '')}</span>
          </div>
          <div class="issue-body">
            <div class="issue-desc">${this.escapeHtml(issue.description)}</div>
            ${issue.reason ? `<div class="issue-reason"><strong>Why it matters:</strong> ${this.escapeHtml(issue.reason)}</div>` : ''}
            <div class="issue-footer">
              ${fileBadge}
              ${reviewBtn}
            </div>
          </div>
        </div>
      `;
    };

    const blockingHtml = blockingIssues.length > 0
      ? `
        <div class="section-title">
          <span>Blocking Issues (${blockingIssues.length})</span>
          <span class="section-badge badge-blocked">Must Be Resolved</span>
        </div>
        ${blockingIssues.map(i => renderIssueCard(i, true)).join('')}
      `
      : '';

    const warningsHtml = warnings.length > 0
      ? `
        <div class="section-title">
          <span>Warnings (${warnings.length})</span>
          <span class="section-badge badge-warning">Review Recommended</span>
        </div>
        ${warnings.map(i => renderIssueCard(i, false)).join('')}
      `
      : '';

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Repository Guard</title>
      <style>
        :root {
          --card-bg: var(--vscode-editor-inactiveSelectionBackground, rgba(255,255,255,0.05));
          --border-color: var(--vscode-widget-border, rgba(255,255,255,0.12));
          --red: #f14c4c;
          --red-bg: rgba(241, 76, 76, 0.12);
          --amber: #cca700;
          --amber-bg: rgba(204, 167, 0, 0.12);
          --green: #89d185;
          --green-bg: rgba(137, 209, 133, 0.12);
        }
        body {
          font-family: var(--vscode-font-family);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          padding: 20px;
          margin: 0;
          line-height: 1.5;
        }
        .header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 14px;
          margin-bottom: 18px;
        }
        .header-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .header-title h1 {
          margin: 0;
          font-size: 18px;
          font-weight: 600;
        }
        .header-op {
          background: var(--vscode-badge-background);
          color: var(--vscode-badge-foreground);
          padding: 2px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: bold;
          text-transform: uppercase;
        }
        .header-repo {
          font-size: 12px;
          opacity: 0.7;
        }
        .status-banner {
          display: flex;
          align-items: center;
          gap: 14px;
          padding: 14px 18px;
          border-radius: 6px;
          margin-bottom: 22px;
        }
        .banner-blocked {
          background: var(--red-bg);
          border: 1px solid var(--red);
        }
        .banner-warning {
          background: var(--amber-bg);
          border: 1px solid var(--amber);
        }
        .banner-pass {
          background: var(--green-bg);
          border: 1px solid var(--green);
        }
        .banner-error {
          background: var(--red-bg);
          border: 1px solid var(--red);
        }
        .banner-icon {
          font-size: 26px;
        }
        .banner-text h2 {
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 600;
        }
        .banner-text p {
          margin: 0;
          font-size: 13px;
          opacity: 0.9;
        }
        .section-title {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 14px;
          font-weight: 600;
          margin: 20px 0 10px 0;
          border-bottom: 1px solid var(--border-color);
          padding-bottom: 6px;
        }
        .section-badge {
          font-size: 11px;
          padding: 2px 8px;
          border-radius: 10px;
          font-weight: normal;
        }
        .badge-blocked {
          background: var(--red-bg);
          color: var(--red);
          border: 1px solid var(--red);
        }
        .badge-warning {
          background: var(--amber-bg);
          color: var(--amber);
          border: 1px solid var(--amber);
        }
        .badge-pass {
          background: var(--green-bg);
          color: var(--green);
          border: 1px solid var(--green);
        }
        .issue-card {
          background: var(--card-bg);
          border-radius: 6px;
          padding: 12px 14px;
          margin-bottom: 12px;
          border-left: 4px solid;
        }
        .issue-block {
          border-left-color: var(--red);
          border: 1px solid rgba(241, 76, 76, 0.3);
          border-left-width: 4px;
        }
        .issue-warn {
          border-left-color: var(--amber);
          border: 1px solid rgba(204, 167, 0, 0.3);
          border-left-width: 4px;
        }
        .issue-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 6px;
        }
        .issue-title {
          font-weight: 600;
          font-size: 13px;
        }
        .issue-category {
          margin-left: auto;
          font-size: 11px;
          opacity: 0.6;
          text-transform: uppercase;
        }
        .issue-desc {
          font-size: 13px;
          margin-bottom: 6px;
        }
        .issue-reason {
          font-size: 12px;
          opacity: 0.8;
          margin-bottom: 8px;
          padding-left: 8px;
          border-left: 2px solid var(--border-color);
        }
        .issue-footer {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-top: 8px;
        }
        .issue-file {
          font-family: var(--vscode-editor-font-family, monospace);
          font-size: 12px;
          padding: 3px 8px;
          background: rgba(255,255,255,0.08);
          border-radius: 4px;
          cursor: pointer;
          color: var(--vscode-textLink-foreground);
          text-decoration: underline;
        }
        .issue-file:hover {
          background: rgba(255,255,255,0.15);
        }
        .btn-review {
          background: transparent;
          color: var(--vscode-button-background);
          border: 1px solid var(--vscode-button-background);
          padding: 3px 10px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 11px;
        }
        .btn-review:hover {
          background: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
        }
        .actions-bar {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
          margin-top: 28px;
          padding-top: 16px;
          border-top: 1px solid var(--border-color);
        }
        button.action-btn {
          padding: 8px 18px;
          border-radius: 4px;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          border: none;
        }
        .btn-cancel {
          background: var(--vscode-button-secondaryBackground, #3a3d41);
          color: var(--vscode-button-secondaryForeground, #ffffff);
        }
        .btn-cancel:hover {
          background: var(--vscode-button-secondaryHoverBackground, #45494e);
        }
        .btn-continue {
          background: var(--vscode-button-background, #0e639c);
          color: var(--vscode-button-foreground, #ffffff);
        }
        .btn-continue:hover {
          background: var(--vscode-button-hoverBackground, #1177bb);
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div>
          <div class="header-title">
            <h1>🛡️ Repository Guard</h1>
            <span class="header-op">${operation} PRE-FLIGHT</span>
          </div>
          <div class="header-repo">${this.escapeHtml(repoName)}</div>
        </div>
      </div>

      <div class="status-banner banner-${status.toLowerCase()}">
        <div class="banner-icon">${statusIcon}</div>
        <div class="banner-text">
          <h2>${statusText}</h2>
          <p>${this.escapeHtml(summaryText)}</p>
        </div>
      </div>

      ${blockingHtml}
      ${warningsHtml}

      <div class="actions-bar">
        <button class="action-btn btn-cancel" onclick="cancelOperation()">Cancel ${operation}</button>
        ${canContinue ? `<button class="action-btn btn-continue" onclick="continueOperation()">Continue Anyway</button>` : ''}
      </div>

      <script>
        const vscode = acquireVsCodeApi();

        function cancelOperation() {
          vscode.postMessage({ command: 'cancel' });
        }

        function continueOperation() {
          vscode.postMessage({ command: 'continue' });
        }

        function openFile(filePath, line) {
          vscode.postMessage({
            command: 'openFile',
            payload: { filePath, line }
          });
        }
      </script>
    </body>
    </html>`;
  }
}

module.exports = {
  RepositoryGuardPanel
};
