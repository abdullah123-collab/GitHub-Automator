const assert = require('assert');

function validateRepoName(name, currentName) {
  if (name === null || name === undefined) {
    return { valid: false, error: 'Repository name cannot be empty.' };
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return { valid: false, error: 'Repository name cannot be empty.' };
  }
  if (currentName && trimmed === currentName) {
    return { valid: true, noop: true, name: trimmed };
  }
  if (trimmed.length > 100) {
    return { valid: false, error: 'Repository name cannot exceed 100 characters.' };
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(trimmed)) {
    return { valid: false, error: 'Letters, numbers, hyphens, periods, and underscores only.' };
  }
  if (trimmed.toLowerCase() === '.git' || trimmed.toLowerCase().endsWith('.git')) {
    return { valid: false, error: 'Cannot end with .git.' };
  }
  if (/^[.-]/.test(trimmed) || /[.-]$/.test(trimmed)) {
    return { valid: false, error: 'Cannot start or end with a period or hyphen.' };
  }
  return { valid: true, noop: false, name: trimmed };
}

console.log('Running JS repository rename validation tests...');

// 1. Valid names
const validNames = ['my-repo', 'my_repo', 'my.repo', 'repo123', 'A-Z_0-9.test', 'a'.repeat(100)];
for (const n of validNames) {
  const res = validateRepoName(n);
  assert.strictEqual(res.valid, true, `Expected "${n}" to be valid`);
  assert.strictEqual(res.name, n);
  assert.strictEqual(res.noop, false);
}

// 2. Empty / whitespace
assert.strictEqual(validateRepoName(null).valid, false);
assert.strictEqual(validateRepoName('').valid, false);
assert.strictEqual(validateRepoName('   ').valid, false);

// 3. No-op
assert.strictEqual(validateRepoName('same-repo', 'same-repo').noop, true);
assert.strictEqual(validateRepoName('  same-repo  ', 'same-repo').noop, true);

// 4. Over 100 chars
assert.strictEqual(validateRepoName('a'.repeat(101)).valid, false);

// 5. Invalid characters
assert.strictEqual(validateRepoName('repo with spaces').valid, false);
assert.strictEqual(validateRepoName('repo@name').valid, false);
assert.strictEqual(validateRepoName('repo#name').valid, false);

// 6. Leading / trailing dots and hyphens
assert.strictEqual(validateRepoName('.repo').valid, false);
assert.strictEqual(validateRepoName('-repo').valid, false);
assert.strictEqual(validateRepoName('repo.').valid, false);
assert.strictEqual(validateRepoName('repo-').valid, false);

// 7. .git suffix
assert.strictEqual(validateRepoName('.git').valid, false);
assert.strictEqual(validateRepoName('my-repo.git').valid, false);
assert.strictEqual(validateRepoName('my-repo.GIT').valid, false);

console.log('All JS repository rename validation tests passed successfully!');
