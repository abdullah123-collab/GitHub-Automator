"""
test_health_checker.py — Comprehensive Unit Tests for Repository Health Check (Phase 1)
"""

import os
import sys
import tempfile
import subprocess
import unittest
from unittest.mock import patch

# Ensure backend is in python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from services.health_checker import (
    check_git_installation,
    check_repository,
    check_remote,
    check_branch,
    check_working_tree,
    check_identity,
    check_gitignore,
    check_tracked_large_files,
    check_repository_health,
    compute_overall_status
)


class HealthCheckerTests(unittest.TestCase):

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.repo_dir = self.temp_dir.name

    def tearDown(self):
        try:
            self.temp_dir.cleanup()
        except Exception:
            pass

    def _init_repo(self, repo_dir=None):
        target = repo_dir or self.repo_dir
        subprocess.run(['git', 'init', '-b', 'main'], cwd=target, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.run(['git', 'config', 'user.name', 'Test Automator'], cwd=target, check=True)
        subprocess.run(['git', 'config', 'user.email', 'test@automator.local'], cwd=target, check=True)

    def _make_commit(self, filename='file.txt', content='hello', repo_dir=None):
        target = repo_dir or self.repo_dir
        filepath = os.path.join(target, filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        subprocess.run(['git', 'add', filename], cwd=target, check=True)
        subprocess.run(['git', 'commit', '-m', f'Add {filename}'], cwd=target, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # 1. Git Installation
    def test_git_installation_detected(self):
        res = check_git_installation()
        self.assertTrue(res['installed'])
        self.assertIsNotNone(res['version'])
        self.assertEqual(res['status'], 'healthy')

    def test_git_not_installed_mocked(self):
        with patch('services.health_checker._run_git', return_value=(False, 'Git is not installed or not in system PATH', -1)):
            res = check_git_installation()
            self.assertFalse(res['installed'])
            self.assertIsNone(res['version'])
            self.assertEqual(res['status'], 'error')

    # 2. Repository Information
    def test_valid_repository_detection(self):
        self._init_repo()
        res = check_repository(self.repo_dir, git_installed=True)
        self.assertTrue(res['exists'])
        self.assertTrue(res['valid'])
        self.assertTrue(res['dotGitExists'])
        self.assertEqual(res['status'], 'healthy')
        self.assertEqual(res['name'], os.path.basename(self.repo_dir))

    def test_non_git_directory(self):
        res = check_repository(self.repo_dir, git_installed=True)
        self.assertTrue(res['exists'])
        self.assertFalse(res['valid'])
        self.assertFalse(res['dotGitExists'])
        self.assertEqual(res['status'], 'error')

    def test_nonexistent_directory(self):
        fake_path = os.path.join(self.repo_dir, 'does_not_exist_xyz')
        res = check_repository(fake_path, git_installed=True)
        self.assertFalse(res['exists'])
        self.assertFalse(res['valid'])
        self.assertEqual(res['status'], 'error')

    # 3. Remote Handling
    def test_remote_local_only_is_healthy(self):
        self._init_repo()
        res = check_remote(self.repo_dir, is_valid_repo=True)
        self.assertFalse(res['hasRemote'])
        self.assertIsNone(res['remoteName'])
        self.assertIsNone(res['remoteUrl'])
        self.assertEqual(res['status'], 'healthy')
        self.assertIn('local-only', res['message'].lower())

    def test_remote_github_https_detected(self):
        self._init_repo()
        subprocess.run(['git', 'remote', 'add', 'origin', 'https://github.com/user/repo.git'], cwd=self.repo_dir, check=True)
        res = check_remote(self.repo_dir, is_valid_repo=True)
        self.assertTrue(res['hasRemote'])
        self.assertEqual(res['remoteName'], 'origin')
        self.assertEqual(res['remoteUrl'], 'https://github.com/user/repo.git')
        self.assertTrue(res['isGitHub'])
        self.assertEqual(res['status'], 'healthy')

    def test_remote_github_ssh_detected(self):
        self._init_repo()
        subprocess.run(['git', 'remote', 'add', 'origin', 'git@github.com:user/repo.git'], cwd=self.repo_dir, check=True)
        res = check_remote(self.repo_dir, is_valid_repo=True)
        self.assertTrue(res['hasRemote'])
        self.assertTrue(res['isGitHub'])
        self.assertEqual(res['status'], 'healthy')

    def test_remote_non_github_detected(self):
        self._init_repo()
        subprocess.run(['git', 'remote', 'add', 'origin', 'https://gitlab.com/user/repo.git'], cwd=self.repo_dir, check=True)
        res = check_remote(self.repo_dir, is_valid_repo=True)
        self.assertTrue(res['hasRemote'])
        self.assertFalse(res['isGitHub'])
        self.assertEqual(res['status'], 'healthy')

    # 4. Branch Handling
    def test_empty_repository_safely_handled(self):
        self._init_repo()
        # 0 commits
        res = check_branch(self.repo_dir, is_valid_repo=True)
        self.assertFalse(res['hasCommits'])
        self.assertFalse(res['isDetached'])
        self.assertFalse(res['hasUpstream'])
        self.assertIsNone(res['ahead'])
        self.assertIsNone(res['behind'])
        self.assertIn('main', res['currentBranch'].lower())
        self.assertEqual(res['status'], 'healthy')

    def test_branch_with_commits_no_upstream(self):
        self._init_repo()
        self._make_commit('readme.md', 'content')
        res = check_branch(self.repo_dir, is_valid_repo=True)
        self.assertTrue(res['hasCommits'])
        self.assertFalse(res['isDetached'])
        self.assertFalse(res['hasUpstream'])
        self.assertEqual(res['status'], 'warning')
        self.assertIn('no upstream', res['message'].lower())

    def test_detached_head_detected(self):
        self._init_repo()
        self._make_commit('file1.txt', '1')
        self._make_commit('file2.txt', '2')
        # Checkout HEAD~1
        subprocess.run(['git', 'checkout', 'HEAD~1'], cwd=self.repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        res = check_branch(self.repo_dir, is_valid_repo=True)
        self.assertTrue(res['isDetached'])
        self.assertEqual(res['status'], 'warning')
        self.assertIn('detached', res['message'].lower())

    # 5. Working Tree Diagnostics
    def test_working_tree_clean(self):
        self._init_repo()
        self._make_commit('clean.txt', 'clean')
        res = check_working_tree(self.repo_dir, is_valid_repo=True)
        self.assertTrue(res['clean'])
        self.assertEqual(res['modified'], 0)
        self.assertEqual(res['staged'], 0)
        self.assertEqual(res['untracked'], 0)
        self.assertEqual(res['deleted'], 0)
        self.assertEqual(res['conflicted'], 0)
        self.assertEqual(res['status'], 'healthy')

    def test_working_tree_modified_staged_untracked_deleted(self):
        self._init_repo()
        self._make_commit('tracked1.txt', 'tracked1')
        self._make_commit('tracked2.txt', 'tracked2')
        self._make_commit('tracked3.txt', 'tracked3')

        # 1. Modify tracked1.txt (unstaged)
        with open(os.path.join(self.repo_dir, 'tracked1.txt'), 'a', encoding='utf-8') as f:
            f.write('\nmore content')

        # 2. Modify tracked2.txt and stage it
        with open(os.path.join(self.repo_dir, 'tracked2.txt'), 'a', encoding='utf-8') as f:
            f.write('\nstaged change')
        subprocess.run(['git', 'add', 'tracked2.txt'], cwd=self.repo_dir, check=True)

        # 3. Create untracked file
        with open(os.path.join(self.repo_dir, 'untracked.txt'), 'w', encoding='utf-8') as f:
            f.write('untracked')

        # 4. Delete tracked3.txt
        os.remove(os.path.join(self.repo_dir, 'tracked3.txt'))

        res = check_working_tree(self.repo_dir, is_valid_repo=True)
        self.assertFalse(res['clean'])
        self.assertEqual(res['modified'], 1)
        self.assertEqual(res['staged'], 1)
        self.assertEqual(res['untracked'], 1)
        self.assertEqual(res['deleted'], 1)
        self.assertEqual(res['status'], 'warning')

    def test_working_tree_merge_conflict_detected(self):
        self._init_repo()
        self._make_commit('base.txt', 'line 1\nline 2')

        # Branch feature
        subprocess.run(['git', 'checkout', '-b', 'feature'], cwd=self.repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with open(os.path.join(self.repo_dir, 'base.txt'), 'w', encoding='utf-8') as f:
            f.write('feature change\nline 2')
        subprocess.run(['git', 'commit', '-am', 'feature commit'], cwd=self.repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # Switch back to main and make conflicting change
        subprocess.run(['git', 'checkout', 'main'], cwd=self.repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        with open(os.path.join(self.repo_dir, 'base.txt'), 'w', encoding='utf-8') as f:
            f.write('main change\nline 2')
        subprocess.run(['git', 'commit', '-am', 'main commit'], cwd=self.repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        # Trigger merge conflict
        subprocess.run(['git', 'merge', 'feature'], cwd=self.repo_dir, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        res = check_working_tree(self.repo_dir, is_valid_repo=True)
        self.assertFalse(res['clean'])
        self.assertGreaterEqual(res['conflicted'], 1)
        self.assertEqual(res['status'], 'error')
        self.assertEqual(res['message'], 'Repository has unresolved merge conflicts')

    # 6. Git Identity
    def test_git_identity_configured(self):
        self._init_repo()
        res = check_identity(self.repo_dir, is_valid_repo=True)
        self.assertTrue(res['configured'])
        self.assertEqual(res['userName'], 'Test Automator')
        self.assertEqual(res['userEmail'], 'test@automator.local')
        self.assertEqual(res['status'], 'healthy')

    def test_git_identity_missing(self):
        self._init_repo()
        subprocess.run(['git', 'config', '--unset', 'user.name'], cwd=self.repo_dir, check=True)
        # Also unset user.email
        subprocess.run(['git', 'config', '--unset', 'user.email'], cwd=self.repo_dir, check=True)

        with patch('services.health_checker._run_git', side_effect=lambda cmd, cwd=None, timeout=15: (False, '', 1) if 'user.' in cmd[1] else (True, '', 0)):
            res = check_identity(self.repo_dir, is_valid_repo=True)
            self.assertFalse(res['configured'])
            self.assertEqual(res['status'], 'warning')

    # 7. Gitignore
    def test_gitignore_missing(self):
        self._init_repo()
        res = check_gitignore(self.repo_dir, is_valid_repo=True)
        self.assertFalse(res['exists'])
        self.assertEqual(res['status'], 'warning')
        self.assertIn('.env', res['patternsMissing'])

    def test_gitignore_with_missing_patterns(self):
        self._init_repo()
        with open(os.path.join(self.repo_dir, '.gitignore'), 'w', encoding='utf-8') as f:
            f.write('.env\nnode_modules/\n')
        res = check_gitignore(self.repo_dir, is_valid_repo=True)
        self.assertTrue(res['exists'])
        self.assertIn('.env', res['patternsDetected'])
        self.assertIn('node_modules/', res['patternsDetected'])
        self.assertIn('__pycache__/', res['patternsMissing'])
        self.assertEqual(res['status'], 'warning')

    def test_gitignore_with_all_patterns(self):
        self._init_repo()
        with open(os.path.join(self.repo_dir, '.gitignore'), 'w', encoding='utf-8') as f:
            f.write('.env\nnode_modules/\n__pycache__/\n*.vsix\n')
        res = check_gitignore(self.repo_dir, is_valid_repo=True)
        self.assertTrue(res['exists'])
        self.assertEqual(len(res['patternsMissing']), 0)
        self.assertEqual(res['status'], 'healthy')

    # 8. Large Files
    def test_tracked_large_file_detected(self):
        self._init_repo()
        # Create a small file and a 2 MB file, with threshold set to 1 MB for testing
        with open(os.path.join(self.repo_dir, 'small.txt'), 'w') as f:
            f.write('small')
        large_file = os.path.join(self.repo_dir, 'large.bin')
        with open(large_file, 'wb') as f:
            f.seek(2 * 1024 * 1024 - 1)
            f.write(b'\0')

        subprocess.run(['git', 'add', 'small.txt', 'large.bin'], cwd=self.repo_dir, check=True)

        res = check_tracked_large_files(self.repo_dir, is_valid_repo=True, threshold_mb=1.0)
        self.assertEqual(res['count'], 1)
        self.assertEqual(res['detected'][0]['path'], 'large.bin')
        self.assertEqual(res['status'], 'warning')

    def test_untracked_large_file_is_strictly_ignored(self):
        self._init_repo()
        # Large file on disk, but UNTRACKED
        large_untracked = os.path.join(self.repo_dir, 'huge_untracked.bin')
        with open(large_untracked, 'wb') as f:
            f.seek(2 * 1024 * 1024 - 1)
            f.write(b'\0')

        # Untracked files must not be scanned for file sizes in Phase 1
        res = check_tracked_large_files(self.repo_dir, is_valid_repo=True, threshold_mb=1.0)
        self.assertEqual(res['count'], 0)
        self.assertEqual(res['status'], 'healthy')

    def test_threshold_validation_fallback(self):
        self._init_repo()
        # Zero threshold
        res1 = check_tracked_large_files(self.repo_dir, is_valid_repo=True, threshold_mb=0)
        self.assertEqual(res1['thresholdMb'], 50.0)

        # Negative threshold
        res2 = check_tracked_large_files(self.repo_dir, is_valid_repo=True, threshold_mb=-10)
        self.assertEqual(res2['thresholdMb'], 50.0)

        # Non-numeric threshold
        res3 = check_tracked_large_files(self.repo_dir, is_valid_repo=True, threshold_mb='invalid')
        self.assertEqual(res3['thresholdMb'], 50.0)

    # 9. Full Diagnostic Integration
    def test_full_health_check_clean_repo(self):
        self._init_repo()
        self._make_commit('init.txt', 'init')
        with open(os.path.join(self.repo_dir, '.gitignore'), 'w', encoding='utf-8') as f:
            f.write('.env\nnode_modules/\n__pycache__/\n*.vsix\n')
        self._make_commit('.gitignore', 'gitignore')

        res = check_repository_health(self.repo_dir)
        self.assertTrue(res['success'])
        self.assertIn('scannedAt', res)
        self.assertIn('scanDurationMs', res)
        self.assertGreaterEqual(res['scanDurationMs'], 0)
        # Only warning is no upstream configured
        self.assertIn(res['overallStatus'], ['HEALTHY', 'NEEDS ATTENTION'])


if __name__ == '__main__':
    unittest.main()
