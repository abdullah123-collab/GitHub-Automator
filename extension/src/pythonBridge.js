const { spawn } = require('child_process');
const path = require('path');

/**
 * ── Background Tasks (Returns JSON) ───────────────────────────
 * Used for background API calls like creating/deleting repos.
 * Waits for Python to finish and parses the stdout.
 */
function spawnPython(scriptName, args = {}) {
    return new Promise((resolve, reject) => {
        // Go up one level from 'src' to 'extension', then into 'python-backend'
        const scriptPath = path.join(__dirname, '..', '..', 'python-backend', scriptName);
        const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
        
        const pythonProcess = spawn(pythonCmd, [scriptPath]);
        
        let response = '';
        let errors = '';
        
        pythonProcess.stdout.on('data', (chunk) => {
            response += chunk.toString();
        });

        pythonProcess.stderr.on('data', (chunk) => {
            errors += chunk.toString();
            console.error(`[${scriptName} stderr]: ${chunk.toString()}`);
        });

        pythonProcess.on('error', (err) => {
            console.error(`[${scriptName} Process Error]:`, err);
            reject(new Error(`Failed to spawn Python: ${err.message}`));
        });

        pythonProcess.on('close', (code) => {
            if (errors && !response) {
                reject(new Error(`Python script failed: ${errors}`));
                return;
            }
            try {
                if (!response.trim()) {
                    reject(new Error(`Python script produced no output. Script: ${scriptPath}`));
                    return;
                }
                resolve(JSON.parse(response));
            } catch (e) {
                console.error(`[${scriptName} Parse Error]:`, e.message);
                console.error(`[${scriptName} Response]:`, response);
                reject(new Error(`Failed to parse Python response: ${e.message}`));
            }
        });

        // Write the data to stdin and close the stream
        pythonProcess.stdin.write(JSON.stringify(args));
        pythonProcess.stdin.end();
    });
}

/**
 * ── GUI Tasks (Fire and Forget) ───────────────────────────────
 * Opens the Tkinter window independently without blocking VS Code.
 */
function spawnPythonGui(scriptName, args = {}) {
    // Go up one level from 'src' to 'extension', then into 'python-backend'
    const scriptPath = path.join(__dirname, '..', 'python-backend', scriptName);
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    
    const child = spawn(pythonCmd, [scriptPath], {
        env: { ...process.env },
        detached: true,   // Let the window run independently
        stdio: ['pipe', 'ignore', 'ignore'] // Send stdin, ignore stdout/stderr
    });
    
    // Send the token to the Tkinter script
    child.stdin.write(JSON.stringify(args));
    child.stdin.end();
    
    // Disconnect the process from VS Code so VS Code doesn't wait for it
    child.unref(); 
}

module.exports = { spawnPython, spawnPythonGui };