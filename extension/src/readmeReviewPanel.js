const vscode = require('vscode');
const path = require('path');

class ReadmeReviewPanel {
  static currentPanel = undefined;
  
  static createOrShow(extensionUri, session, originalSections, generatedSections, matchResult, onComplete) {
    const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
    
    if (ReadmeReviewPanel.currentPanel) {
      ReadmeReviewPanel.currentPanel._panel.reveal(column);
      return;
    }
    
    const panel = vscode.window.createWebviewPanel(
      'readmeReview',
      'AI README Review Wizard',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true
      }
    );
    
    ReadmeReviewPanel.currentPanel = new ReadmeReviewPanel(panel, extensionUri, session, originalSections, generatedSections, matchResult, onComplete);
  }
  
  constructor(panel, extensionUri, session, originalSections, generatedSections, matchResult, onComplete) {
    this._panel = panel;
    this._session = session;
    this._originalSections = originalSections;
    this._generatedSections = generatedSections;
    this._matchResult = matchResult;
    this._onComplete = onComplete;
    
    this._decisions = new Map();
    this._queue = matchResult.reviewQueue;
    this._currentIndex = 0;
    
    this._panel.onDidDispose(() => this.dispose(), null, []);
    
    this._panel.webview.onDidReceiveMessage(
      async message => {
        switch (message.command) {
          case 'keep':
            this.handleDecision(this._queue[this._currentIndex].genIdx, 'keep');
            break;
          case 'skip':
            this.handleDecision(this._queue[this._currentIndex].genIdx, 'skip');
            break;
          case 'keepAllRemaining':
            this.handleKeepAllRemaining();
            break;
          case 'cancel':
            this._panel.dispose();
            break;
        }
      },
      null,
      []
    );
    
    this.update();
  }
  
  handleDecision(genIdx, decision) {
    this._decisions.set(genIdx, decision);
    this._currentIndex++;
    
    if (this._currentIndex < this._queue.length) {
      this.update();
    } else {
      this.finish();
    }
  }
  
  handleKeepAllRemaining() {
    for (let i = this._currentIndex; i < this._queue.length; i++) {
      this._decisions.set(this._queue[i].genIdx, 'keep');
    }
    this.finish();
  }
  
  finish() {
    for (let j = 0; j < this._generatedSections.length; j++) {
      if (!this._decisions.has(j)) {
        this._decisions.set(j, 'skip');
      }
    }
    
    const { reassembleDocument } = require('./readmeSectionParser');
    const finalContent = reassembleDocument(this._originalSections, this._generatedSections, this._decisions, this._matchResult);
    
    this._onComplete(finalContent);
    this._panel.dispose();
  }
  
  update() {
    this._panel.webview.html = this.getHtml();
  }
  
  dispose() {
    ReadmeReviewPanel.currentPanel = undefined;
  }
  
  diffLines(oldLines, newLines) {
    const matrix = Array(oldLines.length + 1).fill(null).map(() => Array(newLines.length + 1).fill(0));
    
    for (let i = 1; i <= oldLines.length; i++) {
      for (let j = 1; j <= newLines.length; j++) {
        if (oldLines[i - 1] === newLines[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1] + 1;
        } else {
          matrix[i][j] = Math.max(matrix[i - 1][j], matrix[i][j - 1]);
        }
      }
    }
    
    const result = [];
    let i = oldLines.length;
    let j = newLines.length;
    
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        result.unshift({ type: 'normal', text: oldLines[i - 1] });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || matrix[i][j - 1] >= matrix[i - 1][j])) {
        result.unshift({ type: 'added', text: newLines[j - 1] });
        j--;
      } else {
        result.unshift({ type: 'removed', text: oldLines[i - 1] });
        i--;
      }
    }
    return result;
  }
  
  getHtml() {
    const item = this._queue[this._currentIndex];
    const oldLines = item.oldContent ? item.oldContent.split(/\r?\n/) : [];
    const newLines = item.newContent ? item.newContent.split(/\r?\n/) : [];
    
    const diff = this.diffLines(oldLines, newLines);
    
    let added = 0;
    let removed = 0;
    diff.forEach(line => {
      if (line.type === 'added') added++;
      if (line.type === 'removed') removed++;
    });
    
    const progress = `Section ${this._currentIndex + 1} of ${this._queue.length}: ${item.title}`;
    const diffRows = diff.map((line, idx) => {
      let className = 'line-normal';
      let prefix = ' ';
      if (line.type === 'added') {
        className = 'line-added';
        prefix = '+';
      } else if (line.type === 'removed') {
        className = 'line-removed';
        prefix = '-';
      }
      const escapedText = line.text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
      return `<tr class="${className}">
        <td class="line-num">${idx + 1}</td>
        <td class="line-prefix">${prefix}</td>
        <td class="line-text">${escapedText}</td>
      </tr>`;
    }).join('\n');
    
    return `<!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>AI README Review</title>
      <style>
        body {
          font-family: var(--vscode-font-family, sans-serif);
          font-size: var(--vscode-font-size, 13px);
          color: var(--vscode-foreground);
          background-color: var(--vscode-editor-background);
          padding: 20px;
          margin: 0;
        }
        .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid var(--vscode-panel-border);
          padding-bottom: 10px;
          margin-bottom: 20px;
        }
        .title {
          font-size: 16px;
          font-weight: bold;
        }
        .stats {
          font-size: 13px;
          font-weight: normal;
        }
        .stat-added {
          color: var(--vscode-gitDecoration-addedResourceForeground, #2ea44f);
          margin-right: 10px;
        }
        .stat-removed {
          color: var(--vscode-gitDecoration-deletedResourceForeground, #cb2431);
        }
        .diff-container {
          border: 1px solid var(--vscode-panel-border);
          border-radius: 4px;
          overflow: auto;
          max-height: 60vh;
          margin-bottom: 20px;
        }
        table {
          width: 100%;
          border-collapse: collapse;
          font-family: var(--vscode-editor-font-family, monospace);
          font-size: var(--vscode-editor-font-size, 12px);
          white-space: pre-wrap;
        }
        td {
          padding: 2px 4px;
          vertical-align: top;
        }
        .line-num {
          text-align: right;
          color: var(--vscode-editorLineNumber-foreground);
          user-select: none;
          width: 40px;
          border-right: 1px solid var(--vscode-panel-border);
          padding-right: 8px;
        }
        .line-prefix {
          text-align: center;
          user-select: none;
          width: 20px;
          padding-left: 8px;
        }
        .line-text {
          word-break: break-all;
        }
        .line-normal {}
        .line-added {
          background-color: var(--vscode-diffEditor-insertedTextBackground, rgba(46, 164, 79, 0.15));
        }
        .line-removed {
          background-color: var(--vscode-diffEditor-removedTextBackground, rgba(203, 36, 49, 0.15));
        }
        .footer {
          display: flex;
          gap: 12px;
          align-items: center;
        }
        button {
          background-color: var(--vscode-button-background);
          color: var(--vscode-button-foreground);
          border: none;
          padding: 8px 16px;
          cursor: pointer;
          border-radius: 2px;
          font-weight: 500;
        }
        button:hover {
          background-color: var(--vscode-button-hoverBackground);
        }
        button.secondary {
          background-color: var(--vscode-button-secondaryBackground, #3a3d41);
          color: var(--vscode-button-secondaryForeground, #ffffff);
        }
        button.secondary:hover {
          background-color: var(--vscode-button-secondaryHoverBackground, #45494e);
        }
        .cancel-link {
          margin-left: auto;
          color: var(--vscode-textLink-foreground);
          text-decoration: none;
          cursor: pointer;
        }
        .cancel-link:hover {
          text-decoration: underline;
        }
      </style>
    </head>
    <body>
      <div class="header">
        <div class="title">${progress}</div>
        <div class="stats">
          <span class="stat-added">+${added}</span>
          <span class="stat-removed">-${removed}</span>
        </div>
      </div>
      
      <div class="diff-container">
        <table>
          <tbody>
            ${diffRows}
          </tbody>
        </table>
      </div>
      
      <div class="footer">
        <button onclick="vscode.postMessage({ command: 'keep' })">Keep</button>
        <button class="secondary" onclick="vscode.postMessage({ command: 'skip' })">Skip</button>
        <button class="secondary" onclick="vscode.postMessage({ command: 'keepAllRemaining' })">Keep All Remaining</button>
        <a class="cancel-link" onclick="vscode.postMessage({ command: 'cancel' })">Cancel Review</a>
      </div>
      
      <script>
        const vscode = acquireVsCodeApi();
      </script>
    </body>
    </html>`;
  }
}

module.exports = ReadmeReviewPanel;
