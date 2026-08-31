/**
 * repositoryGuardService.js — Repository Guard Diagnostic Service (Phase 2)
 *
 * Calls the backend repository_guard via pythonBridge.
 * Independent from gitService.js and healthService.js.
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
 * Runs Repository Guard pre-flight checks before Commit or Push.
 *
 * @param {string} repoPath Absolute path to the local repository.
 * @param {object} [options]
 * @param {'commit'|'push'} [options.operation='commit'] The Git operation being performed.
 * @param {string} [options.remote] Optional target remote name.
 * @param {string} [options.branch] Optional target branch name.
 * @param {number} [options.thresholdMb=50] Large file threshold in MB.
 * @returns {Promise<object>} Structured RepositoryGuardResult.
 */
async function runGuardCheck(repoPath, options = {}) {
  const startTime = Date.now();
  const operation = options.operation === 'push' ? 'push' : 'commit';
  const remote = options.remote || null;
  const branch = options.branch || null;
  const thresholdMb = (typeof options.thresholdMb === 'number' && options.thresholdMb > 0)
    ? options.thresholdMb
    : 50;

  if (!repoPath || typeof repoPath !== 'string' || !repoPath.trim()) {
    return {
      allowed: false,
      overallStatus: 'ERROR',
      blockingIssues: [
        {
          id: 'guard_no_workspace',
          severity: 'block',
          category: 'Repository',
          title: 'No Workspace Open',
          file: null,
          line: null,
          description: 'No folder or repository is open in the active workspace.',
          reason: 'Repository Guard requires an active local Git repository to validate.'
        }
      ],
      warnings: [],
      info: [],
      checks: {},
      operation,
      scannedAt: new Date().toISOString(),
      scanDurationMs: 0
    };
  }

  const backendRoot = getBackendRoot();
  const scriptPath = path.join(backendRoot, 'managers/local_repo.py');

  try {
    const result = await runPythonScript(
      scriptPath,
      {
        action: 'repository_guard',
        repo_path: repoPath,
        operation,
        remote,
        branch,
        threshold_mb: thresholdMb
      },
      backendRoot
    );

    if (result && typeof result === 'object' && result.overallStatus && typeof result.allowed === 'boolean') {
      return result;
    }

    throw new Error('Backend returned unexpected or invalid Guard result format');
  } catch (error) {
    const durationMs = Date.now() - startTime;
    return {
      allowed: false,
      overallStatus: 'ERROR',
      blockingIssues: [
        {
          id: 'guard_backend_failure',
          severity: 'block',
          category: 'Guard Failure',
          title: 'Repository Guard Check Failed',
          file: null,
          line: null,
          description: error && error.message ? error.message : String(error),
          reason: 'Guard scanner encountered an error and cannot verify repository safety. Operation halted.'
        }
      ],
      warnings: [],
      info: [],
      checks: {},
      operation,
      scannedAt: new Date().toISOString(),
      scanDurationMs: durationMs
    };
  }
}

module.exports = {
  runGuardCheck
};
