const vscode = require('vscode');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

async function execAsync(cmd, args, cwd) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, { cwd, shell: false, windowsHide: true });
        let stdout = '';
        let stderr = '';
        proc.stdout.on('data', data => stdout += data.toString());
        proc.stderr.on('data', data => stderr += data.toString());
        
        proc.on('close', code => {
            if (code === 0) resolve({ stdout, stderr });
            else reject(new Error(`Command failed with code ${code}\nStderr: ${stderr}\nStdout: ${stdout}`));
        });
        proc.on('error', err => reject(err));
    });
}

async function checkGit() {
    try {
        const result = await execAsync('git', ['--version']);
        return result.stdout.trim();
    } catch (e) {
        return null;
    }
}

async function getAvailablePython() {
    const candidates = process.platform === 'win32'
        ? [['py', '-3'], ['python'], ['python3']]
        : [['python3'], ['python']];
    
    for (const candidate of candidates) {
        try {
            // Python < 3.4 prints version to stderr, but >=3.4 prints to stdout. We'll capture both.
            const res = await execAsync(candidate[0], [...candidate.slice(1), '--version']);
            const versionStr = (res.stdout + res.stderr).trim();
            return { cmd: candidate, version: versionStr };
        } catch (e) {
            // ignore and try next
        }
    }
    return null;
}

class DependencyManager {
    constructor(backendRoot) {
        this.backendRoot = backendRoot;
        this.venvPath = path.join(backendRoot, '.venv');
        const isWin = process.platform === 'win32';
        this.venvPython = isWin ? path.join(this.venvPath, 'Scripts', 'python.exe') : path.join(this.venvPath, 'bin', 'python');
    }

    async ensureDependencies(outputChannel) {
        const log = (msg) => {
            console.log(`[DependencyManager] ${msg}`);
            if (outputChannel) outputChannel.appendLine(`[DependencyManager] ${msg}`);
        };

        log('Checking Git...');
        let gitVersion = await checkGit();
        while (!gitVersion) {
            const action = await vscode.window.showErrorMessage('GitHub Automator requires Git.', 'Install Git', 'Retry');
            if (action === 'Install Git') {
                vscode.env.openExternal(vscode.Uri.parse('https://git-scm.com/downloads'));
            } else if (!action) {
                log('User cancelled Git installation check.');
                return false; // Extension can't really function without git, or maybe we just return false
            }
            gitVersion = await checkGit();
        }
        log(`Git detected: ${gitVersion}`);

        return await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "GitHub Automator Setup",
            cancellable: false
        }, async (progress) => {
            
            // Check Python
            progress.report({ message: 'Checking Python...' });
            log('Checking Python...');
            let pythonInfo = await getAvailablePython();
            while (!pythonInfo) {
                const action = await vscode.window.showErrorMessage('GitHub Automator requires Python 3.', 'Install Python', 'Retry');
                if (action === 'Install Python') {
                    vscode.env.openExternal(vscode.Uri.parse('https://www.python.org/downloads/'));
                } else if (!action) {
                    log('User cancelled Python installation check.');
                    return false;
                }
                pythonInfo = await getAvailablePython();
            }
            log(`Python detected: ${pythonInfo.version} (${pythonInfo.cmd.join(' ')})`);

            // Setup Virtual Env
            if (!fs.existsSync(this.venvPath) || !fs.existsSync(this.venvPython)) {
                progress.report({ message: 'Creating Python environment...' });
                log('Creating virtual environment...');
                try {
                    await execAsync(pythonInfo.cmd[0], [...pythonInfo.cmd.slice(1), '-m', 'venv', '.venv'], this.backendRoot);
                    log('Virtual environment created successfully.');
                } catch (e) {
                    log(`Failed to create virtual environment: ${e.message}`);
                    vscode.window.showErrorMessage(`Failed to create virtual environment: ${e.message}`);
                    return false;
                }
            } else {
                log('Virtual environment already exists.');
            }

            // Install Dependencies
            const requirementsPath = path.join(this.backendRoot, 'requirements.txt');
            if (fs.existsSync(requirementsPath)) {
                progress.report({ message: 'Installing backend dependencies...' });
                log('Installing backend dependencies...');
                try {
                    await execAsync(this.venvPython, ['-m', 'pip', 'install', '-r', 'requirements.txt'], this.backendRoot);
                    log('Dependencies installed successfully.');
                } catch (e) {
                    log(`Failed to install dependencies: ${e.message}`);
                    vscode.window.showErrorMessage(`Failed to install dependencies: ${e.message}`);
                    return false;
                }
            } else {
                log('No requirements.txt found, skipping dependency installation.');
            }

            return true;
        });
    }

    getVenvPythonPath() {
        return fs.existsSync(this.venvPython) ? this.venvPython : null;
    }
}

module.exports = { DependencyManager };
