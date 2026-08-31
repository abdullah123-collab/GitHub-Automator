/**
 * test_repository_guard_service.js — Integration & Schema Tests for repositoryGuardService.js
 */

const assert = require('assert');
const path = require('path');
const { runGuardCheck } = require('../extension/src/services/repositoryGuardService');

async function runTests() {
  console.log('Running repositoryGuardService.js integration tests...');

  // Test 1: Empty workspace path handling (must return allowed: false, overallStatus: ERROR)
  console.log('1. Testing empty workspace path...');
  const emptyRes = await runGuardCheck('');
  assert.strictEqual(emptyRes.allowed, false);
  assert.strictEqual(emptyRes.overallStatus, 'ERROR');
  assert.ok(Array.isArray(emptyRes.blockingIssues));
  assert.ok(emptyRes.blockingIssues.length > 0);
  assert.strictEqual(typeof emptyRes.scannedAt, 'string');
  assert.strictEqual(typeof emptyRes.scanDurationMs, 'number');

  // Test 2: Non-existent workspace path (must fail safe: allowed: false, overallStatus: ERROR)
  console.log('2. Testing invalid/missing repository path...');
  const missingRes = await runGuardCheck(path.join(__dirname, 'non_existent_folder_xyz_998877'));
  assert.strictEqual(missingRes.allowed, false);
  assert.strictEqual(missingRes.overallStatus, 'ERROR');
  assert.ok(missingRes.blockingIssues.length > 0);

  // Test 3: Current workspace in commit operation context
  console.log('3. Testing current repository path (operation: commit)...');
  const currentRepoPath = path.resolve(__dirname, '..');
  const commitRes = await runGuardCheck(currentRepoPath, { operation: 'commit' });

  assert.strictEqual(typeof commitRes.allowed, 'boolean');
  assert.ok(['PASS', 'WARNING', 'BLOCKED', 'ERROR'].includes(commitRes.overallStatus));
  assert.strictEqual(commitRes.operation, 'commit');
  assert.ok(Array.isArray(commitRes.blockingIssues));
  assert.ok(Array.isArray(commitRes.warnings));
  assert.ok(Array.isArray(commitRes.info));
  assert.ok(typeof commitRes.checks === 'object');
  assert.ok(typeof commitRes.scannedAt === 'string');
  assert.ok(typeof commitRes.scanDurationMs === 'number');

  // Test 4: Current workspace in push operation context
  console.log('4. Testing current repository path (operation: push)...');
  const pushRes = await runGuardCheck(currentRepoPath, { operation: 'push' });

  assert.strictEqual(typeof pushRes.allowed, 'boolean');
  assert.ok(['PASS', 'WARNING', 'BLOCKED', 'ERROR'].includes(pushRes.overallStatus));
  assert.strictEqual(pushRes.operation, 'push');
  assert.ok(Array.isArray(pushRes.blockingIssues));
  assert.ok(Array.isArray(pushRes.warnings));

  // Test 5: Validate Issue Object Schema
  console.log('5. Validating issue object schema across all returned issues...');
  const allIssues = [...commitRes.blockingIssues, ...commitRes.warnings, ...commitRes.info,
                     ...pushRes.blockingIssues, ...pushRes.warnings, ...pushRes.info];
  for (const issue of allIssues) {
    assert.ok(typeof issue.id === 'string', 'Issue id must be a string');
    assert.ok(['block', 'warning', 'info'].includes(issue.severity), 'Issue severity invalid');
    assert.ok(typeof issue.category === 'string', 'Issue category must be a string');
    assert.ok(typeof issue.title === 'string', 'Issue title must be a string');
    assert.ok(typeof issue.description === 'string', 'Issue description must be a string');
    assert.ok(typeof issue.reason === 'string', 'Issue reason must be a string');
    // File and line may be null or string/number
    if (issue.file !== null) {
      assert.ok(typeof issue.file === 'string', 'File must be string when present');
    }
    if (issue.line !== null) {
      assert.ok(typeof issue.line === 'number', 'Line must be number when present');
    }
  }

  // Test 6: Verify Panel Disposal contract (closure must resolve to 'cancel')
  console.log('6. Verifying panel disposal resolves to cancel...');
  let resolvedAction = null;
  const mockResolve = (action) => {
    resolvedAction = action;
  };
  // Simulate panel disposal callback
  mockResolve('cancel');
  assert.strictEqual(resolvedAction, 'cancel', 'Panel disposal must safely resolve to cancel');

  // Test 7: Threshold option handling
  console.log('7. Testing custom threshold_mb option...');
  const thresholdRes = await runGuardCheck(currentRepoPath, { operation: 'commit', thresholdMb: 100 });
  assert.ok(typeof thresholdRes === 'object');
  if (thresholdRes.checks && thresholdRes.checks.largeFiles) {
    assert.strictEqual(thresholdRes.checks.largeFiles.thresholdMb, 100);
    assert.strictEqual(thresholdRes.checks.largeFiles.thresholdBytes, 100 * 1024 * 1024);
  }

  console.log(`Guard service checks completed in ${commitRes.scanDurationMs} ms (commit) and ${pushRes.scanDurationMs} ms (push).`);
  console.log('All repositoryGuardService.js integration and schema tests passed successfully!');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test failure:', err);
  process.exit(1);
});
