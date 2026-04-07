const vscode = require('vscode');
const { Octokit } = require('@octokit/rest');
const path = require('path');
const fs = require('fs').promises;
// The fix: We are now importing both spawnPython AND spawnPythonGui
const { spawnPython, spawnPythonGui } = require('./pythonBridge');

let octokit = null;
let currentToken = null;
let repoViewProvider = null;
let context = null;
let loginWebviewPanel = null;

// ────────────────────────────────────────────────────────────────────
// Login Webview Provider
// ────────────────────────────────────────────────────────────────────
class LoginWebviewProvider {
    constructor(extensionContext) {
        this.context = extensionContext;
    }

    show() {
        if (loginWebviewPanel) {
            loginWebviewPanel.reveal(vscode.ViewColumn.One);
            return;
        }

        loginWebviewPanel = vscode.window.createWebviewPanel(
            'github-automator-login',
            'GitHub Automator - Login',
            vscode.ViewColumn.One,
            { enableScripts: true }
        );

        loginWebviewPanel.webview.html = this.getHtmlContent();

        loginWebviewPanel.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'login') {
                const token = message.token;
                if (!token) {
                    loginWebviewPanel.webview.postMessage({
                        command: 'error',
                        message: 'Token cannot be empty.'
                    });
                    return;
                }

                try {
                    // Validate token
                    const tempOctokit = new Octokit({ auth: token });
                    const { data: user } = await tempOctokit.rest.users.getAuthenticated();

                    // Save token
                    await this.context.secrets.store('github-token', token);
                    octokit = tempOctokit;
                    currentToken = token;

                    loginWebviewPanel.webview.postMessage({
                        command: 'success',
                        username: user.login
                    });

                    // Close webview after 1 second
                    setTimeout(() => {
                        if (loginWebviewPanel) {
                            loginWebviewPanel.dispose();
                            loginWebviewPanel = null;
                        }
                        repoViewProvider.refresh();
                    }, 1000);

                } catch (err) {
                    loginWebviewPanel.webview.postMessage({
                        command: 'error',
                        message: 'Invalid token. Please try again.'
                    });
                }
            }
        });

        loginWebviewPanel.onDidDispose(() => {
            loginWebviewPanel = null;
        });
    }

    getHtmlContent() {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>GitHub Automator Login</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            background-color: #1e1e1e;
            color: #e0e0e0;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 20px;
        }

        .login-container {
            background-color: #252526;
            border: 1px solid #3e3e42;
            border-radius: 8px;
            padding: 40px;
            width: 100%;
            max-width: 400px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
        }

        .logo {
            text-align: center;
            margin-bottom: 30px;
        }

        .github-icon {
            font-size: 48px;
            margin-bottom: 15px;
        }

        h1 {
            font-size: 24px;
            font-weight: 600;
            margin-bottom: 8px;
            text-align: center;
        }

        .subtitle {
            text-align: center;
            color: #cccccc;
            font-size: 14px;
            margin-bottom: 30px;
        }

        .form-group {
            margin-bottom: 20px;
        }

        label {
            display: block;
            font-size: 14px;
            font-weight: 500;
            margin-bottom: 8px;
            color: #e0e0e0;
        }

        input {
            width: 100%;
            padding: 10px 12px;
            background-color: #3c3c3c;
            border: 1px solid #3e3e42;
            border-radius: 4px;
            color: #e0e0e0;
            font-size: 14px;
            transition: border-color 0.2s;
        }

        input:focus {
            outline: none;
            border-color: #0e639c;
            background-color: #2d2d30;
        }

        input::placeholder {
            color: #858585;
        }

        .button-group {
            margin-top: 25px;
        }

        button {
            width: 100%;
            padding: 10px 16px;
            background-color: #0e639c;
            color: #ffffff;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background-color 0.2s, opacity 0.2s;
        }

        button:hover:not(:disabled) {
            background-color: #1177bb;
        }

        button:active:not(:disabled) {
            opacity: 0.8;
        }

        button:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .error-message {
            color: #f48771;
            font-size: 13px;
            margin-top: 10px;
            padding: 8px 10px;
            background-color: rgba(244, 135, 113, 0.1);
            border: 1px solid #f48771;
            border-radius: 3px;
            display: none;
        }

        .success-message {
            color: #89d185;
            font-size: 13px;
            margin-top: 10px;
            padding: 8px 10px;
            background-color: rgba(137, 209, 133, 0.1);
            border: 1px solid #89d185;
            border-radius: 3px;
            display: none;
        }

        .loading {
            display: none;
            text-align: center;
            color: #cccccc;
        }

        .spinner {
            border: 2px solid #3e3e42;
            border-top: 2px solid #0e639c;
            border-radius: 50%;
            width: 24px;
            height: 24px;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 10px;
        }

        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }

        .help-text {
            font-size: 12px;
            color: #858585;
            margin-top: 15px;
            text-align: center;
            line-height: 1.4;
        }

        a {
            color: #0e639c;
            text-decoration: none;
        }

        a:hover {
            color: #1177bb;
            text-decoration: underline;
        }
    </style>
</head>
<body>
    <div class="login-container">
        <div class="logo">
            <div class="github-icon">🐙</div>
            <h1>GitHub Automator</h1>
            <p class="subtitle">Sign in to manage your repositories</p>
        </div>

        <div class="form-group">
            <label for="token-input">GitHub Personal Access Token</label>
            <input 
                type="password" 
                id="token-input" 
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                autocomplete="off"
            />
        </div>

        <div class="error-message" id="error-message"></div>
        <div class="success-message" id="success-message"></div>

        <div class="loading" id="loading">
            <div class="spinner"></div>
            <p>Validating token...</p>
        </div>

        <div class="button-group">
            <button id="connect-btn">Connect to GitHub</button>
        </div>

        <p class="help-text">
            Don't have a token? 
            <a href="https://github.com/settings/tokens/new?scopes=repo,user" title="Create a new token">Create one here</a>
        </p>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const tokenInput = document.getElementById('token-input');
        const connectBtn = document.getElementById('connect-btn');
        const errorMsg = document.getElementById('error-message');
        const successMsg = document.getElementById('success-message');
        const loading = document.getElementById('loading');

        // Clear error on input
        tokenInput.addEventListener('input', () => {
            errorMsg.style.display = 'none';
            successMsg.style.display = 'none';
        });

        // Connect button click
        connectBtn.addEventListener('click', () => {
            const token = tokenInput.value.trim();
            if (!token) {
                showError('Please enter your token');
                return;
            }

            connectBtn.disabled = true;
            loading.style.display = 'block';

            vscode.postMessage({
                command: 'login',
                token: token
            });
        });

        // Handle Enter key
        tokenInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                connectBtn.click();
            }
        });

        // Listen for messages from extension
        window.addEventListener('message', (e) => {
            const message = e.data;

            if (message.command === 'error') {
                showError(message.message);
                connectBtn.disabled = false;
                loading.style.display = 'none';
            }

            if (message.command === 'success') {
                loading.style.display = 'none';
                successMsg.textContent = \`✅ Authenticated as \${message.username}. Loading repositories...\`;
                successMsg.style.display = 'block';
                connectBtn.disabled = true;
                tokenInput.disabled = true;
            }
        });

        function showError(message) {
            errorMsg.textContent = \`❌ \${message}\`;
            errorMsg.style.display = 'block';
        }

        // Focus on input on load
        tokenInput.focus();
    </script>
</body>
</html>`;
    }
}

// ────────────────────────────────────────────────────────────────────
// Actions Panel Webview Provider (For Commit & Push & AI Generate buttons)
// ────────────────────────────────────────────────────────────────────
class ActionsWebviewProvider {
    constructor(extensionContext) {
        this.context = extensionContext;
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
    }

    resolveWebviewView(webviewView, context, token) {
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: []
        };

        webviewView.webview.html = this.getHtmlContent();

        webviewView.webview.onDidReceiveMessage(async (message) => {
            if (message.command === 'commitAndPush') {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    vscode.window.showWarningMessage('No workspace folder open');
                    return;
                }

                const message_text = await vscode.window.showInputBox({
                    placeHolder: 'Enter commit message',
                    title: 'Commit Message'
                });

                if (message_text === undefined) return;

                vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Committing and pushing...' },
                    async () => {
                        try {
                            const result = await spawnPython('commit_manager.py', {
                                action: 'commit_and_push',
                                repo_path: workspaceFolders[0].uri.fsPath,
                                message: message_text || '',
                                use_ai: message_text === ''
                            });
                            if (result.success) {
                                vscode.window.showInformationMessage(`✅ ${result.message}`);
                                webviewView.webview.postMessage({ command: 'success' });
                            } else {
                                vscode.window.showErrorMessage(`❌ ${result.error}`);
                            }
                        } catch (err) {
                            vscode.window.showErrorMessage(`❌ Error: ${err.message}`);
                        }
                    }
                );
            } else if (message.command === 'aiGenerate') {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    vscode.window.showWarningMessage('No workspace folder open');
                    return;
                }

                vscode.window.withProgress(
                    { location: vscode.ProgressLocation.Notification, title: 'Generating commit message...' },
                    async () => {
                        try {
                            const result = await spawnPython('ai_commit.py', {
                                action: 'generate_message',
                                repo_path: workspaceFolders[0].uri.fsPath
                            });
                            if (result.success) {
                                const proceed = await vscode.window.showInformationMessage(
                                    `✨ Generated: ${result.message}`,
                                    'Use & Commit', 'Copy', 'Cancel'
                                );

                                if (proceed === 'Use & Commit') {
                                    const commitResult = await spawnPython('commit_manager.py', {
                                        action: 'commit_and_push',
                                        repo_path: workspaceFolders[0].uri.fsPath,
                                        message: result.message,
                                        use_ai: false
                                    });
                                    if (commitResult.success) {
                                        vscode.window.showInformationMessage(`✅ ${commitResult.message}`);
                                    } else {
                                        vscode.window.showErrorMessage(`❌ ${commitResult.error}`);
                                    }
                                } else if (proceed === 'Copy') {
                                    vscode.env.clipboard.writeText(result.message);
                                    vscode.window.showInformationMessage('✅ Copied to clipboard');
                                }
                            } else {
                                vscode.window.showErrorMessage(`❌ ${result.error}`);
                            }
                        } catch (err) {
                            vscode.window.showErrorMessage(`❌ Error: ${err.message}`);
                        }
                    }
                );
            }
        });
    }

    getHtmlContent() {
        return `<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Git Actions</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }

        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, sans-serif;
            padding: 16px;
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
        }

        .container {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }

        .title {
            font-size: 16px;
            font-weight: 600;
            margin-bottom: 8px;
            color: var(--vscode-foreground);
        }

        button {
            padding: 12px 16px;
            border: none;
            border-radius: 4px;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: all 0.2s;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            color: white;
        }

        .btn-commit {
            background-color: #0078d4;
        }

        .btn-commit:hover {
            background-color: #1177bb;
        }

        .btn-commit:active {
            opacity: 0.8;
        }

        .btn-ai {
            background-color: #8a5aff;
        }

        .btn-ai:hover {
            background-color: #9a6aff;
        }

        .btn-ai:active {
            opacity: 0.8;
        }

        .icon {
            font-size: 16px;
        }

        .info {
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
            margin-top: 12px;
            line-height: 1.4;
        }

        .divider {
            height: 1px;
            background-color: var(--vscode-widget-border);
            margin: 8px 0;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="title">⚡ Git Actions</div>
        
        <button class="btn-commit" onclick="commitAndPush()">
            <span class="icon">↑</span>
            <span>Commit & Push</span>
        </button>

        <button class="btn-ai" onclick="aiGenerate()">
            <span class="icon">✨</span>
            <span>AI Generate Message</span>
        </button>

        <div class="divider"></div>

        <div class="info">
            <strong>Tip:</strong> Use AI Generate to automatically create professional commit messages based on your changes.
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();

        function commitAndPush() {
            vscode.postMessage({ command: 'commitAndPush' });
        }

        function aiGenerate() {
            vscode.postMessage({ command: 'aiGenerate' });
        }

        // Listen for messages from extension
        window.addEventListener('message', (e) => {
            const message = e.data;
            if (message.command === 'success') {
                // Could add visual feedback here
            }
        });
    </script>
</body>
</html>`;
    }
}

// ────────────────────────────────────────────────────────────────────
class RepoTreeProvider {
    constructor() {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;
        this.repos = [];
    }

    refresh = async () => {
        try {
            if (!octokit || !currentToken) {
                this.repos = [];
                this._onDidChangeTreeData.fire(undefined);
                return;
            }
            const { data } = await octokit.rest.repos.listForAuthenticatedUser({
                sort: 'updated',
                per_page: 50
            });
            this.repos = data;
            this._onDidChangeTreeData.fire(undefined);
        } catch (err) {
            vscode.window.showErrorMessage(`Failed to load repos: ${err.message}`);
            this.repos = [];
        }
    };

    getTreeItem(element) {
        if (element.isPlaceholder) {
            return {
                label: element.label,
                collapsibleState: vscode.TreeItemCollapsibleState.None
            };
        }
        return {
            label: element.name,
            description: element.private ? '🔒 Private' : '🌐 Public',
            collapsibleState: vscode.TreeItemCollapsibleState.None,
            iconPath: new vscode.ThemeIcon(element.private ? 'lock' : 'globe'),
            contextValue: 'repo',
            command: {
                command: 'vscode.open',
                title: 'Open',
                arguments: [vscode.Uri.parse(element.html_url)]
            }
        };
    }

    getChildren() {
        if (this.repos.length === 0) {
            return [{ label: '📌 Authenticate to load repos', isPlaceholder: true }];
        }
        return this.repos;
    }
}

async function activate(extensionContext) {
    console.log('GitHub Automator is now active!');
    context = extensionContext;

    // Register TreeDataProvider
    repoViewProvider = new RepoTreeProvider();
    vscode.window.registerTreeDataProvider('github-automator.repoView', repoViewProvider);

    // Register Webview Provider for Git Actions
    const actionsProvider = new ActionsWebviewProvider(context);
    vscode.window.registerWebviewViewProvider('github-automator.actionsView', actionsProvider);

    // Check if token exists - if yes, restore session; if no, show login
    const savedToken = await context.secrets.get('github-token');
    if (!savedToken) {
        // Show login webview on first launch
        const loginProvider = new LoginWebviewProvider(context);
        loginProvider.show();
    } else {
        // Restore session automatically
        await restoreSession(context);
    }

    // ── Refresh Repos Button ───────────────────────────────────────
    const refreshCommand = vscode.commands.registerCommand(
        'github-automator.refreshRepos',
        async () => {
            await repoViewProvider.refresh();
            vscode.window.showInformationMessage('✅ Repositories refreshed!');
        }
    );

    // ── Authenticate ──────────────────────────────────────────────
    const authCommand = vscode.commands.registerCommand(
        'github-automator.authenticate',
        async () => {
            const loginProvider = new LoginWebviewProvider(context);
            loginProvider.show();
        }
    );

    // ── Logout ─────────────────────────────────────────────────────
    const logoutCommand = vscode.commands.registerCommand(
        'github-automator.logout',
        async () => {
            const confirm = await vscode.window.showWarningMessage(
                '⚠️ Are you sure you want to logout?',
                { modal: true },
                'Yes, Logout'
            );
            if (confirm !== 'Yes, Logout') return;

            octokit = null;
            currentToken = null;
            await context.secrets.delete('github-token');
            repoViewProvider.repos = [];
            repoViewProvider._onDidChangeTreeData.fire(undefined);

            const loginProvider = new LoginWebviewProvider(context);
            loginProvider.show();

            vscode.window.showInformationMessage('✅ Logged out successfully');
        }
    );

    // ── Show Panel → opens tkinter GUI ───────────────────────────
    const panelCommand = vscode.commands.registerCommand(
        'github-automator.showPanel',
        async () => {
            await ensureAuth(context);

            if (!currentToken) {
                vscode.window.showWarningMessage('Please authenticate first: GitHub Automator: Authenticate');
                return;
            }

            // Launch gui.py — it opens a tkinter window
            try {
                spawnPythonGui('gui.py', { token: currentToken });
                vscode.window.showInformationMessage('✅ GitHub Automator window opened!');
            } catch (err) {
                vscode.window.showErrorMessage(`❌ Failed to open GUI: ${err.message}`);
            }
        }
    );

    // ── Create Repo (Command Palette) ─────────────────────────────
    const createRepoCommand = vscode.commands.registerCommand(
        'github-automator.createRepo',
        async () => {
            await ensureAuth(context);
            if (!currentToken) return;

            const name = await vscode.window.showInputBox({
                prompt: 'Repository name',
                placeHolder: 'my-new-repo'
            });
            if (!name) return;

            const description = await vscode.window.showInputBox({
                prompt: 'Description (optional)',
                placeHolder: 'A short description...'
            });

            const visibility = await vscode.window.showQuickPick(['Public', 'Private'], {
                placeHolder: 'Select visibility'
            });
            if (!visibility) return;

            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Creating repository...' },
                async () => {
                    const result = await spawnPython('repo_manager.py', {
                        action: 'create',
                        token: currentToken,
                        name,
                        description: description || '',
                        private: visibility === 'Private'
                    });
                    if (result.success) {
                        const open = await vscode.window.showInformationMessage(
                            `✅ Repo "${result.name}" created!`, 'Open on GitHub');
                        if (open) vscode.env.openExternal(vscode.Uri.parse(result.url));
                    } else {
                        vscode.window.showErrorMessage(`❌ Failed: ${result.error}`);
                    }
                }
            );
        }
    );

    // ── Delete Repo (Command Palette) ─────────────────────────────
    const deleteRepoCommand = vscode.commands.registerCommand(
        'github-automator.deleteRepo',
        async () => {
            await ensureAuth(context);
            if (!currentToken) return;

            const { data: user } = await octokit.rest.users.getAuthenticated();
            const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
                sort: 'updated', per_page: 30
            });

            const picked = await vscode.window.showQuickPick(
                repos.map(r => ({
                    label: r.name,
                    description: r.private ? '🔒 Private' : '🌐 Public',
                    detail: r.description || ''
                })),
                { placeHolder: 'Select a repository to DELETE' }
            );
            if (!picked) return;

            const confirm = await vscode.window.showWarningMessage(
                `⚠️ Permanently delete "${picked.label}"? This cannot be undone!`,
                { modal: true }, 'Yes, Delete'
            );
            if (confirm !== 'Yes, Delete') return;

            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Deleting repository...' },
                async () => {
                    const result = await spawnPython('repo_manager.py', {
                        action: 'delete',
                        token: currentToken,
                        owner: user.login,
                        repo: picked.label
                    });
                    if (result.success) {
                        vscode.window.showInformationMessage(`🗑️ "${picked.label}" deleted.`);
                    } else {
                        vscode.window.showErrorMessage(`❌ Failed: ${result.error}`);
                    }
                }
            );
        }
    );

    // ── Initialize Repository Locally ─────────────────────────────
    const initializeRepoCommand = vscode.commands.registerCommand(
        'github-automator.initializeRepo',
        async (element) => {
            if (!element) return;

            const repoName = element.name;
            const repoDescription = element.description || 'Repository initialized via GitHub Automation Extension';

            try {
                // Show folder picker
                const folderUri = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    openLabel: 'Select Folder Location'
                });

                if (!folderUri || folderUri.length === 0) return;

                const parentPath = folderUri[0].fsPath;
                const repoPath = path.join(parentPath, repoName);

                // Create the repo folder
                await fs.mkdir(repoPath, { recursive: true });

                // Create README.md
                const readmeContent = `# ${repoName}\n\n${repoDescription}\n`;
                const readmePath = path.join(repoPath, 'README.md');
                await fs.writeFile(readmePath, readmeContent, 'utf8');

                // Show success message with option to open
                const open = await vscode.window.showInformationMessage(
                    `✅ Initialized repo folder at ${repoPath}`,
                    'Open Folder'
                );

                if (open) {
                    vscode.commands.executeCommand('vscode.openFolder', vscode.Uri.file(repoPath));
                }
            } catch (err) {
                vscode.window.showErrorMessage(`❌ Failed to initialize repo: ${err.message}`);
            }
        }
    );

    // ── Clone Repo (Command Palette) ──────────────────────────────
    const cloneRepoCommand = vscode.commands.registerCommand(
        'github-automator.cloneRepo',
        async () => {
            await ensureAuth(context);
            if (!currentToken) return;

            const { data: repos } = await octokit.rest.repos.listForAuthenticatedUser({
                sort: 'updated', per_page: 30
            });

            const picked = await vscode.window.showQuickPick(
                repos.map(r => ({
                    label: r.name,
                    description: r.private ? '🔒 Private' : '🌐 Public',
                    detail: r.clone_url,
                    clone_url: r.clone_url
                })),
                { placeHolder: 'Select a repository to clone' }
            );
            if (!picked) return;

            const folderUri = await vscode.window.showOpenDialog({
                canSelectFolders: true,
                canSelectFiles: false,
                openLabel: 'Select Clone Destination'
            });
            if (!folderUri || folderUri.length === 0) return;

            const destPath = folderUri[0].fsPath + '\\' + picked.label;

            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: `Cloning ${picked.label}...` },
                async () => {
                    const result = await spawnPython('repo_manager.py', {
                        action: 'clone',
                        token: currentToken,
                        clone_url: picked.clone_url,
                        dest_path: destPath
                    });
                    if (result.success) {
                        const open = await vscode.window.showInformationMessage(
                            `✅ Cloned to ${result.path}`, 'Open Folder');
                        if (open) vscode.commands.executeCommand(
                            'vscode.openFolder', vscode.Uri.file(result.path));
                    } else {
                        vscode.window.showErrorMessage(`❌ Clone failed: ${result.error}`);
                    }
                }
            );
        }
    );

    // ── Commit & Push (Command Palette) ───────────────────────────
    const commitAndPushCommand = vscode.commands.registerCommand(
        'github-automator.commitAndPush',
        async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showWarningMessage('No workspace folder open');
                return;
            }

            const repoPath = workspaceFolders[0].uri.fsPath;

            // Ask for commit message
            const message = await vscode.window.showInputBox({
                placeHolder: 'Enter commit message or leave empty to generate with AI',
                title: 'Commit Message'
            });

            if (message === undefined) return; // User cancelled

            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Committing and pushing...' },
                async () => {
                    try {
                        const result = await spawnPython('commit_manager.py', {
                            action: 'commit_and_push',
                            repo_path: repoPath,
                            message: message || '',
                            use_ai: message === ''
                        });
                        if (result.success) {
                            vscode.window.showInformationMessage(`✅ ${result.message}`);
                        } else {
                            vscode.window.showErrorMessage(`❌ ${result.error}`);
                        }
                    } catch (err) {
                        vscode.window.showErrorMessage(`❌ Error: ${err.message}`);
                    }
                }
            );
        }
    );

    // ── AI Generate Commit Message (Command Palette) ───────────────
    const aiGenerateCommand = vscode.commands.registerCommand(
        'github-automator.aiGenerate',
        async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showWarningMessage('No workspace folder open');
                return;
            }

            const repoPath = workspaceFolders[0].uri.fsPath;

            vscode.window.withProgress(
                { location: vscode.ProgressLocation.Notification, title: 'Generating commit message...' },
                async () => {
                    try {
                        const result = await spawnPython('ai_commit.py', {
                            action: 'generate_message',
                            repo_path: repoPath
                        });
                        if (result.success) {
                            // Show the AI-generated message
                            const proceed = await vscode.window.showInformationMessage(
                                `✨ Generated: ${result.message}`,
                                'Use & Commit', 'Copy to Clipboard', 'Cancel'
                            );

                            if (proceed === 'Use & Commit') {
                                const commitResult = await spawnPython('commit_manager.py', {
                                    action: 'commit_and_push',
                                    repo_path: repoPath,
                                    message: result.message,
                                    use_ai: false
                                });
                                if (commitResult.success) {
                                    vscode.window.showInformationMessage(`✅ ${commitResult.message}`);
                                } else {
                                    vscode.window.showErrorMessage(`❌ ${commitResult.error}`);
                                }
                            } else if (proceed === 'Copy to Clipboard') {
                                vscode.env.clipboard.writeText(result.message);
                                vscode.window.showInformationMessage('✅ Copied to clipboard');
                            }
                        } else {
                            vscode.window.showErrorMessage(`❌ ${result.error}`);
                        }
                    } catch (err) {
                        vscode.window.showErrorMessage(`❌ Error: ${err.message}`);
                    }
                }
            );
        }
    );

    context.subscriptions.push(
        authCommand, panelCommand, refreshCommand,
        createRepoCommand, deleteRepoCommand, cloneRepoCommand,
        initializeRepoCommand, logoutCommand,
        commitAndPushCommand, aiGenerateCommand
    );

    await restoreSession(context);
}

// ─── Helpers ──────────────────────────────────────────────────────
async function ensureAuth(context) {
    if (!octokit || !currentToken) {
        const savedToken = await context.secrets.get('github-token');
        if (savedToken) {
            octokit = new Octokit({ auth: savedToken });
            currentToken = savedToken;
        } else {
            vscode.window.showWarningMessage('Please authenticate first.');
        }
    }
}

async function restoreSession(context) {
    const savedToken = await context.secrets.get('github-token');
    if (savedToken) {
        octokit = new Octokit({ auth: savedToken });
        currentToken = savedToken;
        console.log('GitHub session restored.');
        
        // Refresh repos after restoring session
        if (repoViewProvider) {
            await repoViewProvider.refresh();
        }
    }
}

function deactivate() {}

module.exports = { activate, deactivate };