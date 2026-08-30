/**
 * healthService.js — Repository Health Check Service (Phase 1: Strictly Read-Only)
 *
 * Calls the backend health_checker via pythonBridge.
 * Independent from gitService.js.
 */

const path = require('path');
const fs = require('fs');
const { runPythonScript } = require('../pythonBridge');

function getBackendRoot() {
  const localBackend = path.join(__dirname, '../../backend');
  if (fs.existsSync(localBackend)) {
    return localBackend;
  }
  const rootBackend = path.join(__dirname, '../../../backend');
  if (fs.existsSync(rootBackend)) {
    return rootBackend;
  }
  return path.resolve(__dirname, '../../backend');
}

/**
 * Executes read-only repository health diagnostics on the specified repository path.
 *
 * @param {string} repoPath Absolute path to the local repository.
 * @param {object} [options]
 * @param {number} [options.thresholdMb=50] Large file threshold in megabytes.
 * @returns {Promise<object>} Structured RepositoryHealth result.
 */
async function runRepositoryHealthCheck(repoPath, options = {}) {
  const startTime = Date.now();
  const thresholdMb = (typeof options.thresholdMb === 'number' && options.thresholdMb > 0)
    ? options.thresholdMb
    : 50;

  if (!repoPath || typeof repoPath !== 'string' || !repoPath.trim()) {
    return {
      success: true,
      scannedAt: new Date().toISOString(),
      scanDurationMs: 0,
      overallStatus: 'ERROR',
      summary: 'No workspace folder or repository path is open.',
      issues: [
        {
          category: 'Repository',
          severity: 'error',
          title: 'No Workspace Open',
          description: 'No folder or repository is open in the current VS Code workspace.',
          whyItMatters: 'Repository health check inspects local files, Git configuration, and working tree state of an active workspace.'
        }
      ],
      git: { installed: false, version: null, status: 'not_applicable', message: 'No workspace open.' },
      repository: { exists: false, valid: false, root: null, name: null, dotGitExists: false, status: 'error', message: 'No workspace open.' },
      remote: { hasRemote: false, remoteName: null, remoteUrl: null, isGitHub: false, connectivity: 'None', status: 'not_applicable', message: 'No workspace open.' },
      branch: { currentBranch: null, isDetached: false, hasCommits: false, hasUpstream: false, upstreamBranch: null, ahead: null, behind: null, status: 'not_applicable', message: 'No workspace open.' },
      workingTree: { clean: true, modified: 0, staged: 0, untracked: 0, deleted: 0, conflicted: 0, modifiedFiles: [], stagedFiles: [], untrackedFiles: [], deletedFiles: [], conflictedFiles: [], status: 'not_applicable', message: 'No workspace open.' },
      identity: { configured: false, userName: null, userEmail: null, status: 'not_applicable', message: 'No workspace open.' },
      gitignore: { exists: false, patternsDetected: [], patternsMissing: [], status: 'not_applicable', message: 'No workspace open.' },
      largeFiles: { thresholdMb, thresholdBytes: thresholdMb * 1024 * 1024, detected: [], count: 0, status: 'not_applicable', message: 'No workspace open.' }
    };
  }

  const backendRoot = getBackendRoot();
  const scriptPath = path.join(backendRoot, 'managers/local_repo.py');

  try {
    const result = await runPythonScript(
      scriptPath,
      {
        action: 'health_check',
        repo_path: repoPath,
        threshold_mb: thresholdMb
      },
      backendRoot
    );

    if (result && typeof result === 'object' && result.overallStatus) {
      return result;
    }

    throw new Error('Backend returned unexpected result format');
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      success: false,
      scannedAt: new Date().toISOString(),
      scanDurationMs: durationMs,
      overallStatus: 'ERROR',
      summary: `Diagnostic runner failed: ${error && error.message ? error.message : String(error)}`,
      issues: [
        {
          category: 'Diagnostic Runner',
          severity: 'error',
          title: 'Backend Diagnostics Error',
          description: error && error.message ? error.message : 'Unknown backend execution failure',
          whyItMatters: 'The Python backend was unable to execute the diagnostic check. Ensure Python is installed and accessible.'
        }
      ],
      git: { installed: false, version: null, status: 'error', message: 'Could not query Git.' },
      repository: { exists: true, valid: false, root: repoPath, name: path.basename(repoPath), dotGitExists: false, status: 'error', message: 'Diagnostic failed.' },
      remote: { hasRemote: false, remoteName: null, remoteUrl: null, isGitHub: false, connectivity: 'None', status: 'not_applicable', message: 'Diagnostic failed.' },
      branch: { currentBranch: null, isDetached: false, hasCommits: false, hasUpstream: false, upstreamBranch: null, ahead: null, behind: null, status: 'not_applicable', message: 'Diagnostic failed.' },
      workingTree: { clean: false, modified: 0, staged: 0, untracked: 0, deleted: 0, conflicted: 0, modifiedFiles: [], stagedFiles: [], untrackedFiles: [], deletedFiles: [], conflictedFiles: [], status: 'not_applicable', message: 'Diagnostic failed.' },
      identity: { configured: false, userName: null, userEmail: null, status: 'not_applicable', message: 'Diagnostic failed.' },
      gitignore: { exists: false, patternsDetected: [], patternsMissing: [], status: 'not_applicable', message: 'Diagnostic failed.' },
      largeFiles: { thresholdMb, thresholdBytes: thresholdMb * 1024 * 1024, detected: [], count: 0, status: 'not_applicable', message: 'Diagnostic failed.' }
    };
  }
}

module.exports = {
  runRepositoryHealthCheck
};
