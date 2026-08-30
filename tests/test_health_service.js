/**
 * test_health_service.js — Integration & Schema Tests for healthService.js
 */

const assert = require('assert');
const path = require('path');
const { runRepositoryHealthCheck } = require('../extension/src/services/healthService');

async function runTests() {
  console.log('Running healthService.js integration tests...');

  // Test 1: Empty workspace path handling
  console.log('1. Testing empty workspace path...');
  const emptyRes = await runRepositoryHealthCheck('');
  assert.strictEqual(emptyRes.success, true);
  assert.strictEqual(emptyRes.overallStatus, 'ERROR');
  assert.ok(emptyRes.issues.length > 0);
  assert.strictEqual(emptyRes.repository.exists, false);
  assert.strictEqual(typeof emptyRes.scannedAt, 'string');
  assert.strictEqual(typeof emptyRes.scanDurationMs, 'number');

  // Test 2: Current repository health check
  console.log('2. Testing current repository path...');
  const currentRepoPath = path.resolve(__dirname, '..');
  const res = await runRepositoryHealthCheck(currentRepoPath);

  assert.strictEqual(res.success, true);
  assert.ok(typeof res.scannedAt === 'string');
  assert.ok(typeof res.scanDurationMs === 'number');
  assert.ok(['HEALTHY', 'NEEDS ATTENTION', 'ERROR'].includes(res.overallStatus));
  assert.ok(typeof res.summary === 'string');
  assert.ok(Array.isArray(res.issues));

  // Check 1: Git
  assert.ok(res.git, 'git section missing');
  assert.strictEqual(typeof res.git.installed, 'boolean');
  assert.ok(['healthy', 'warning', 'error', 'not_applicable'].includes(res.git.status));

  // Check 2: Repository
  assert.ok(res.repository, 'repository section missing');
  assert.strictEqual(res.repository.exists, true);
  assert.strictEqual(res.repository.valid, true);
  assert.ok(['healthy', 'warning', 'error', 'not_applicable'].includes(res.repository.status));

  // Check 3: Remote
  assert.ok(res.remote, 'remote section missing');
  assert.strictEqual(typeof res.remote.hasRemote, 'boolean');
  assert.ok(['healthy', 'warning', 'error', 'not_applicable'].includes(res.remote.status));

  // Check 4: Branch
  assert.ok(res.branch, 'branch section missing');
  assert.strictEqual(typeof res.branch.hasCommits, 'boolean');
  assert.ok(['healthy', 'warning', 'error', 'not_applicable'].includes(res.branch.status));

  // Check 5: Working Tree
  assert.ok(res.workingTree, 'workingTree section missing');
  assert.strictEqual(typeof res.workingTree.clean, 'boolean');
  assert.strictEqual(typeof res.workingTree.modified, 'number');
  assert.strictEqual(typeof res.workingTree.staged, 'number');
  assert.strictEqual(typeof res.workingTree.untracked, 'number');
  assert.strictEqual(typeof res.workingTree.deleted, 'number');
  assert.strictEqual(typeof res.workingTree.conflicted, 'number');
  assert.ok(Array.isArray(res.workingTree.modifiedFiles));
  assert.ok(Array.isArray(res.workingTree.stagedFiles));
  assert.ok(Array.isArray(res.workingTree.untrackedFiles));
  assert.ok(Array.isArray(res.workingTree.deletedFiles));
  assert.ok(Array.isArray(res.workingTree.conflictedFiles));

  // Check 6: Identity
  assert.ok(res.identity, 'identity section missing');
  assert.strictEqual(typeof res.identity.configured, 'boolean');
  assert.ok(['healthy', 'warning', 'error', 'not_applicable'].includes(res.identity.status));

  // Check 7: Gitignore
  assert.ok(res.gitignore, 'gitignore section missing');
  assert.strictEqual(typeof res.gitignore.exists, 'boolean');
  assert.ok(Array.isArray(res.gitignore.patternsDetected));
  assert.ok(Array.isArray(res.gitignore.patternsMissing));

  // Check 8: Large Files
  assert.ok(res.largeFiles, 'largeFiles section missing');
  assert.strictEqual(typeof res.largeFiles.thresholdMb, 'number');
  assert.strictEqual(typeof res.largeFiles.thresholdBytes, 'number');
  assert.strictEqual(res.largeFiles.thresholdBytes, res.largeFiles.thresholdMb * 1024 * 1024);
  assert.ok(Array.isArray(res.largeFiles.detected));

  // Issues schema validation
  for (const issue of res.issues) {
    assert.ok(typeof issue.category === 'string');
    assert.ok(['error', 'warning', 'info'].includes(issue.severity));
    assert.ok(typeof issue.title === 'string');
    assert.ok(typeof issue.description === 'string');
    assert.ok(typeof issue.whyItMatters === 'string');
  }

  console.log(`Scan completed in ${res.scanDurationMs} ms. Overall status: ${res.overallStatus}.`);
  console.log('All healthService integration and schema tests passed successfully!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
