const vscode = require('vscode');
const path = require('path');
const { analyzeProject } = require('./projectAnalyzer');
const { scanProject } = require('./securityScanner');
const { generateGitignore } = require('./gitignoreService');
const { detectReadme, generateReadme, writeReadme } = require('./readmeGenerator');
const { initGitRepo, getRepoInfo, stageAndCommit, addRemote, pushToRemote } = require('./gitService');
const { createRepo, checkRemoteRepoExists } = require('./githubService');
const { runPythonScript } = require('../pythonBridge');

const fs = require('fs'); const backendRoot = fs.existsSync(path.join(__dirname, '../../backend')) ? path.join(__dirname, '../../backend') : path.join(__dirname, '../../../backend');

async function publishFolder(extensionContext, reposViewProvider) {
  try {
    // 1. Select Local Project Folder
    const folder = await vscode.window.showOpenDialog({
      canSelectFiles: false,
      canSelectFolders: true,
      openLabel: 'Select Folder to Publish'
    });

    if (!folder || !folder.length) {
      return;
    }

    const repoPath = folder[0].fsPath;

    // Check token first
    const token = await extensionContext.secrets.get('github-automator.token');
    if (!token) {
      vscode.window.showErrorMessage("No GitHub token found. Please authenticate first.");
      return;
    }

    // Start progress indication
    await vscode.window.withProgress({
      location: vscode.ProgressLocation.Notification,
      title: "Publishing project to GitHub",
      cancellable: false
    }, async (progress) => {

      const report = (message) => progress.report({ message });

      // 2. Analyze Project
      report("Analyzing project type and structure...");
      const projectContext = await analyzeProject(repoPath);
      if (!projectContext || !projectContext.success) {
        throw new Error(projectContext ? projectContext.error : "Project analysis failed.");
      }

      // 3. Check Git Status
      report("Checking Git status...");
      const gitInfo = await getRepoInfo(repoPath);
      let isGit = gitInfo && gitInfo.success && gitInfo.is_git_repo;
      
      if (isGit && gitInfo.origin_url) {
        const choice = await vscode.window.showWarningMessage(
          `This folder is already connected to remote: ${gitInfo.origin_url}. Overwrite or abort?`,
          { modal: true },
          'Overwrite Remote', 'Abort'
        );
        if (choice !== 'Overwrite Remote') {
          return;
        }
      }

      // 4. Check README
      report("Checking README...");
      const readmeResult = await detectReadme(repoPath);
      let shouldGenerateReadme = !readmeResult.exists;
      if (readmeResult.exists) {
        const readmeChoice = await vscode.window.showQuickPick(
          ['Keep existing README', 'Regenerate/Improve with AI', 'Abort Publish'],
          { placeHolder: `README detected: ${readmeResult.filename}. Choose action:` }
        );
        if (!readmeChoice || readmeChoice === 'Abort Publish') {
          return;
        }
        if (readmeChoice === 'Regenerate/Improve with AI') {
          shouldGenerateReadme = true;
        }
      }

      // 5. Security / Sensitive File Scan
      report("Scanning for sensitive files & secrets...");
      const scanResult = await scanProject(repoPath);
      if (!scanResult || !scanResult.success) {
        throw new Error(scanResult ? scanResult.error : "Security scan failed.");
      }

      if (!scanResult.clean) {
        let warningLines = [];
        if (scanResult.suspicious_files && scanResult.suspicious_files.length) {
            warningLines.push("Suspicious files:");
            scanResult.suspicious_files.forEach(f => warningLines.push(`  - ${f.file} (${f.reason})`));
        }
        if (scanResult.found_secrets && scanResult.found_secrets.length) {
            warningLines.push("Potential secrets found:");
            scanResult.found_secrets.forEach(s => warningLines.push(`  - ${s.file}: L${s.line} (${s.type})`));
        }
        
        const details = warningLines.join('\n');
        vscode.window.showWarningMessage(`Security Alert: Secrets/Sensitive files detected!\n${details}`);

        const proceedChoice = await vscode.window.showWarningMessage(
          "Sensitive files or API keys were detected in the project. Proceeding may upload them to GitHub. Proceed anyway?",
          { modal: true },
          "Proceed Anyway", "Cancel"
        );
        if (proceedChoice !== "Proceed Anyway") {
          return;
        }
      }

      // 6. Generate / Validate .gitignore
      report("Generating / validating .gitignore...");
      const gitignoreResult = await generateGitignore(repoPath, projectContext.type);
      if (!gitignoreResult || !gitignoreResult.success) {
        throw new Error(gitignoreResult ? gitignoreResult.error : "Gitignore generation failed.");
      }

      const config = vscode.workspace.getConfiguration('github-automator');
      const geminiModel = config.get('geminiModel', 'gemini-3.6-flash');

      // 7. Generate Repository Description
      report("Generating repository description...");
      let initialDesc = "";
      try {
        const descResult = await runPythonScript(
          path.join(backendRoot, 'services/ai_description_cli.py'),
          { repo_name: projectContext.name, repo_path: repoPath, model: geminiModel },
          backendRoot
        );
        if (descResult && descResult.success) {
          initialDesc = descResult.description;
        }
      } catch (err) {
        // Fallback to empty description if generation fails
      }

      // Prompt User for Repository Name, Visibility, and Description
      const repoNameInput = await vscode.window.showInputBox({
        prompt: 'Enter Repository Name',
        value: projectContext.name,
        ignoreFocusOut: true
      });
      if (!repoNameInput) return;

      report("Checking repository availability on GitHub...");
      const remoteExists = await checkRemoteRepoExists(token, repoNameInput);
      if (remoteExists && remoteExists.success && remoteExists.exists) {
        throw new Error(`Repository '${repoNameInput}' already exists on your GitHub account. Please choose a different name.`);
      }

      const repoDescInput = await vscode.window.showInputBox({
        prompt: 'Enter Repository Description (Review AI proposal below)',
        value: initialDesc,
        ignoreFocusOut: true
      });
      if (repoDescInput === undefined) return;

      const visibilityChoice = await vscode.window.showQuickPick(
        ['Private', 'Public'],
        { placeHolder: 'Select visibility', ignoreFocusOut: true }
      );
      if (!visibilityChoice) return;
      const privateValue = visibilityChoice === 'Private';

      // 8. AI README Generation (if applicable)
      if (shouldGenerateReadme) {
        report("Generating README.md with AI...");
        const readmeGen = await generateReadme(repoPath, repoNameInput, projectContext, geminiModel);
        if (!readmeGen || !readmeGen.success) {
          throw new Error(readmeGen ? readmeGen.error : "AI README generation failed.");
        }
        
        report("Saving generated README.md...");
        const writeResult = await writeReadme(repoPath, readmeGen.text);
        if (!writeResult.success) {
          throw new Error(`Failed to save README.md: ${writeResult.error}`);
        }
        vscode.window.showInformationMessage("AI README.md generated and saved successfully.");
      }

      // 9. Create GitHub Repository (auto_init=false!)
      report("Creating repository on GitHub (without auto_init)...");
      const createResult = await createRepo(token, repoNameInput, privateValue, repoDescInput, false);
      if (!createResult || !createResult.success) {
        throw new Error(createResult ? createResult.error : "Failed to create GitHub repository.");
      }

      const cloneUrl = createResult.clone_url;

      // 10. Initialize Git if required
      if (!isGit) {
        report("Initializing local Git repository...");
        const defaultBranch = config.get('defaultBranch', 'main');
        const initResult = await initGitRepo(repoPath, defaultBranch);
        if (!initResult || !initResult.success) {
          throw new Error(initResult ? initResult.error : "Failed to initialize Git repo.");
        }
      }

      // 11. Add Files and Create Initial Commit
      report("Staging files and creating initial commit...");
      const commitResult = await stageAndCommit(repoPath, "Initial commit by GitHub Automator");
      if (!commitResult || !commitResult.success) {
        throw new Error(commitResult ? (commitResult.message || JSON.stringify(commitResult)) : "Failed to stage and commit files.");
      }

      // 12. Configure Remote
      report("Configuring remote 'origin' URL...");
      if (isGit && gitInfo.origin_url) {
        await runPythonScript(
          path.join(backendRoot, 'managers/local_repo.py'),
          { action: 'remote_remove', repo_path: repoPath, name: 'origin' },
          backendRoot
        );
      }
      
      const remoteResult = await addRemote(repoPath, 'origin', cloneUrl);
      if (!remoteResult || !remoteResult.success) {
        throw new Error(remoteResult ? remoteResult.message : "Failed to add git remote origin.");
      }

      // 13. Push to GitHub
      report("Pushing local repository to GitHub...");
      const pushResult = await pushToRemote(repoPath);
      if (!pushResult || !pushResult.success) {
        throw new Error(pushResult ? pushResult.message : "Failed to push commits to GitHub.");
      }

      // Refresh sidebar repos list if visible
      if (reposViewProvider) {
        await reposViewProvider.refreshState();
      }

      // 14. Show Success
      vscode.window.showInformationMessage(`Successfully published project '${repoNameInput}' to GitHub!`);
    });
  } catch (error) {
    vscode.window.showErrorMessage(`Publishing failed: ${error.message}`);
  }
}

module.exports = { publishFolder };
