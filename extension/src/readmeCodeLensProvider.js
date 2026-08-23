const vscode = require('vscode');
const path = require('path');
const fs = require('fs');

class ReadmeCodeLensProvider {
  constructor() {
    this._onDidChangeCodeLenses = new vscode.EventEmitter();
    this.onDidChangeCodeLenses = this._onDidChangeCodeLenses.event;
    this.activeReadmeSessions = null; // Set by extension.js
    this.stateMap = new Map(); // documentUriString -> state
  }

  setState(uri, state) {
    this.stateMap.set(uri.toString(), state);
    this._onDidChangeCodeLenses.fire();
  }

  getState(uri) {
    return this.stateMap.get(uri.toString());
  }

  clearState(uri) {
    this.stateMap.delete(uri.toString());
    this._onDidChangeCodeLenses.fire();
  }

  fire() {
    this._onDidChangeCodeLenses.fire();
  }

  provideCodeLenses(document, token) {
    const fileName = path.basename(document.fileName).toLowerCase();

    // 1. Case-insensitive check for README.md
    if (fileName !== 'readme.md') {
      return [];
    }

    // 2. Must be at the root of a workspace folder
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
    if (!workspaceFolder) {
      return [];
    }
    const docDir = path.normalize(path.dirname(document.uri.fsPath));
    const wsDir = path.normalize(workspaceFolder.uri.fsPath);
    if (docDir !== wsDir) {
      return [];
    }

    // 3. Lightweight check: must have a .git folder at the workspace root
    const gitPath = path.join(wsDir, '.git');
    if (!fs.existsSync(gitPath)) {
      return [];
    }

    // Check if there is an active session
    if (this.activeReadmeSessions) {
      const session = this.activeReadmeSessions.get(document.uri.toString());
      if (session) {
        const lenses = [];
        const topRange = new vscode.Range(0, 0, 0, 0);

        if (session.status === 'generating') {
          lenses.push(new vscode.CodeLens(topRange, {
            title: '⏳ Generating README...',
            command: ''
          }));
          return lenses;
        }

        if (session.status === 'reviewing') {
          lenses.push(new vscode.CodeLens(topRange, {
            title: '⏳ Reviewing README changes...',
            command: ''
          }));
          return lenses;
        }

        if (session.status === 'applied-unsaved') {
          lenses.push(new vscode.CodeLens(topRange, {
            title: '✓ README changes applied. Please save the file (Ctrl+S) to complete.',
            command: ''
          }));
          return lenses;
        }

        if (session.status === 'saved') {
          lenses.push(new vscode.CodeLens(topRange, {
            title: '✓ README saved. Please commit these changes.',
            command: ''
          }));
          lenses.push(new vscode.CodeLens(topRange, {
            title: 'Commit Changes',
            command: 'github-automator.commitReadmeChanges',
            arguments: [document.uri]
          }));
          lenses.push(new vscode.CodeLens(topRange, {
            title: 'Dismiss',
            command: 'github-automator.dismissReadmeSession',
            arguments: [document.uri]
          }));
          return lenses;
        }
      }
    }

    // Default Idle state CodeLens
    let state = this.stateMap.get(document.uri.toString());
    if (!state || state.startsWith('idle')) {
      const isEmpty = document.getText().trim().length === 0;
      state = isEmpty ? 'idle-empty' : 'idle-existing';
      this.stateMap.set(document.uri.toString(), state);
    }

    let title = '⚡ Generate README with AI';
    let hasCommand = true;

    if (state === 'idle-existing') {
      title = '↻ Update README with AI';
    } else if (state === 'generating') {
      title = '⏳ Generating README...';
      hasCommand = false;
    } else if (state === 'error') {
      title = '⚠ Generation failed — click to retry';
    }

    const range = new vscode.Range(0, 0, 0, 0);
    const command = {
      title: title,
      command: hasCommand ? 'github-automator.generateReadme' : '',
      arguments: [document.uri]
    };

    return [new vscode.CodeLens(range, command)];
  }
}

module.exports = {
  ReadmeCodeLensProvider
};
