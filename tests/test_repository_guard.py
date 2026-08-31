"""
test_repository_guard.py — Comprehensive Unit & Security Boundary Tests for Repository Guard (Phase 2)
"""

import os
import sys
import json
import tempfile
import subprocess
import unittest
from unittest.mock import patch

# Ensure backend is in python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from services.repository_guard import (
    check_repository_guard,
    scan_line_for_secrets,
    is_placeholder_or_dummy,
    is_environment_or_config_reference,
    is_sensitive_filename,
    should_skip_untracked_path,
    determine_commit_set,
    determine_push_diff,
    check_git_state
)


class RepositoryGuardTests(unittest.TestCase):

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
        subprocess.run(['git', 'config', 'user.name', 'Guard Tester'], cwd=target, check=True)
        subprocess.run(['git', 'config', 'user.email', 'tester@guard.local'], cwd=target, check=True)

    def _make_commit(self, filename='file.txt', content='hello', repo_dir=None):
        target = repo_dir or self.repo_dir
        filepath = os.path.join(target, filename)
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        subprocess.run(['git', 'add', filename], cwd=target, check=True)
        subprocess.run(['git', 'commit', '-m', f'Add {filename}'], cwd=target, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    # 1. API Key Detection
    def test_01_api_key_detected(self):
        line = 'api_key = "AIzaSyD9x8w7v6u5t4s3r2q1p0o9n8m7l6k5j4"'
        issues = scan_line_for_secrets(line, "config.py", 12)
        self.assertTrue(len(issues) > 0)
        self.assertEqual(issues[0]["severity"], "block")
        self.assertEqual(issues[0]["file"], "config.py")
        self.assertEqual(issues[0]["line"], 12)

    # 2. GitHub Token Detection (classic and fine-grained)
    def test_02_github_tokens_detected(self):
        classic_line = 'GITHUB_PAT = "ghp_123456789012345678901234567890123456"'
        issues_classic = scan_line_for_secrets(classic_line, "token.js", 5)
        self.assertTrue(len(issues_classic) > 0)
        self.assertEqual(issues_classic[0]["id"], "github_token_classic_token.js_5")

        fine_grained_line = 'PAT = "github_pat_11AABCDEF0123456789012345678901234567890123456789012345678901234567890123456789012"'
        issues_fine = scan_line_for_secrets(fine_grained_line, "auth.py", 8)
        self.assertTrue(len(issues_fine) > 0)

    # 3. AWS Credential Detection
    def test_03_aws_credentials_detected(self):
        access_key = 'AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"'
        issues_ak = scan_line_for_secrets(access_key, "deploy.py", 3)
        self.assertTrue(len(issues_ak) > 0)
        self.assertEqual(issues_ak[0]["severity"], "block")

        secret_key = 'aws_secret_access_key = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"'
        issues_sk = scan_line_for_secrets(secret_key, "aws.ini", 4)
        self.assertTrue(len(issues_sk) > 0)

    # 4. Private Key Detection
    def test_04_private_key_detected(self):
        key_line = '-----BEGIN RSA PRIVATE KEY-----'
        issues = scan_line_for_secrets(key_line, "server.key", 1)
        self.assertTrue(len(issues) > 0)
        self.assertEqual(issues[0]["title"], "Private Cryptographic Key Detected")

    # 5. Password / Token Literal Assignment Detection
    def test_05_password_literal_detected(self):
        line = 'client_secret = "super_unhashed_secret_998877"'
        issues = scan_line_for_secrets(line, "settings.json", 15)
        self.assertTrue(len(issues) > 0)
        self.assertEqual(issues[0]["severity"], "block")

    # 6. os.getenv() is NOT falsely flagged
    def test_06_os_getenv_not_flagged(self):
        line = 'API_KEY = os.getenv("API_KEY")'
        issues = scan_line_for_secrets(line, "app.py", 10)
        self.assertEqual(len(issues), 0)

    # 7. os.environ[] is NOT falsely flagged
    def test_07_os_environ_not_flagged(self):
        line = 'token = os.environ["GITHUB_TOKEN"]'
        issues = scan_line_for_secrets(line, "main.py", 11)
        self.assertEqual(len(issues), 0)

    # 8. process.env is NOT falsely flagged
    def test_08_process_env_not_flagged(self):
        line = 'const API_KEY = process.env.API_KEY;'
        issues = scan_line_for_secrets(line, "index.js", 2)
        self.assertEqual(len(issues), 0)

    # 9. Placeholder values are ignored
    def test_09_placeholders_ignored(self):
        placeholders = [
            'API_KEY = "your_api_key_here"',
            'TOKEN = "YOUR_TOKEN"',
            'password = "example_password"',
            'secret = "changeme"',
            'api_key = "<your-token>"',
            'token = "replace_me"'
        ]
        for p in placeholders:
            issues = scan_line_for_secrets(p, "sample.py", 1)
            self.assertEqual(len(issues), 0, f"Failed for placeholder: {p}")

    # 10. Secret values never appear in result
    def test_10_secret_values_never_in_result(self):
        raw_secret = "ghp_123456789012345678901234567890123456"
        line = f'TOKEN = "{raw_secret}"'
        issues = scan_line_for_secrets(line, "auth.py", 10)
        self.assertTrue(len(issues) > 0)
        serialized = json.dumps(issues)
        self.assertNotIn(raw_secret, serialized)

    # 11. .env file warning
    def test_11_env_file_warning(self):
        desc = is_sensitive_filename(".env")
        self.assertIsNotNone(desc)
        desc_local = is_sensitive_filename(".env.local")
        self.assertIsNotNone(desc_local)

    # 12. credentials.json warning
    def test_12_credentials_file_warning(self):
        self.assertIsNotNone(is_sensitive_filename("credentials.json"))
        self.assertIsNotNone(is_sensitive_filename("credentials.yaml"))

    # 13. .pem file warning
    def test_13_pem_key_file_warning(self):
        self.assertIsNotNone(is_sensitive_filename("cert.pem"))
        self.assertIsNotNone(is_sensitive_filename("privkey.key"))
        self.assertIsNotNone(is_sensitive_filename("id_rsa"))

    # 14. .env.example allowed unless containing actual secret
    def test_14_env_example_allowed_without_secret(self):
        self.assertIsNone(is_sensitive_filename(".env.example"))
        self.assertIsNone(is_sensitive_filename(".env.template"))

    # 15. 50 MB+ file warning
    def test_15_large_file_warning(self):
        self._init_repo()
        large_path = os.path.join(self.repo_dir, 'large_model.bin')
        # Create sparse file or 1 MB file tested against custom 0.5 MB threshold
        with open(large_path, 'wb') as f:
            f.seek((1024 * 1024) - 1)
            f.write(b'\0')
        
        res = check_repository_guard(self.repo_dir, operation="commit", threshold_mb=0.5)
        self.assertTrue(res["allowed"])
        self.assertEqual(res["overallStatus"], "WARNING")
        large_issues = [w for w in res["warnings"] if w["category"] == "Large Files"]
        self.assertTrue(len(large_issues) > 0)

    # 16. Below-threshold file passes
    def test_16_below_threshold_passes(self):
        self._init_repo()
        small_path = os.path.join(self.repo_dir, 'small.txt')
        with open(small_path, 'w') as f:
            f.write("small file")
        res = check_repository_guard(self.repo_dir, operation="commit", threshold_mb=50.0)
        self.assertTrue(res["allowed"])
        large_issues = [w for w in res["warnings"] if w["category"] == "Large Files"]
        self.assertEqual(len(large_issues), 0)

    # 17. Unrelated workspace files are not scanned
    def test_17_unrelated_workspace_files_not_scanned(self):
        self.assertTrue(should_skip_untracked_path("node_modules/pkg/secret.js"))
        self.assertTrue(should_skip_untracked_path(".venv/lib/config.py"))
        self.assertTrue(should_skip_untracked_path(".git/objects/abc"))

    # 18. Case B — Untracked file that WILL be committed is scanned
    def test_18_untracked_secret_file_scanned_and_blocked(self):
        self._init_repo()
        self._make_commit("README.md", "# Initial")
        
        # Create untracked secret file (not yet added with git add)
        untracked_file = os.path.join(self.repo_dir, "untracked_secrets.py")
        with open(untracked_file, "w", encoding="utf-8") as f:
            f.write('API_KEY = "ghp_123456789012345678901234567890123456"\n')

        res = check_repository_guard(self.repo_dir, operation="commit")
        self.assertFalse(res["allowed"])
        self.assertEqual(res["overallStatus"], "BLOCKED")
        secret_issues = [i for i in res["blockingIssues"] if i["category"] == "Secret Detection"]
        self.assertTrue(len(secret_issues) > 0)
        self.assertEqual(secret_issues[0]["file"], "untracked_secrets.py")

    # 19. Untracked file in excluded dir is NOT scanned
    def test_19_untracked_in_excluded_dir_not_scanned(self):
        self._init_repo()
        nm_dir = os.path.join(self.repo_dir, "node_modules", "somepkg")
        os.makedirs(nm_dir, exist_ok=True)
        with open(os.path.join(nm_dir, "secret.js"), "w") as f:
            f.write('API_KEY = "ghp_123456789012345678901234567890123456"\n')
        
        commit_set = determine_commit_set(self.repo_dir)
        self.assertNotIn("node_modules/somepkg/secret.js", commit_set["untrackedFiles"])

    # 20. Merge conflict blocks
    def test_20_merge_conflict_blocks(self):
        self._init_repo()
        self._make_commit("file.txt", "base content")
        # Create fake MERGE_HEAD
        merge_head_path = os.path.join(self.repo_dir, ".git", "MERGE_HEAD")
        with open(merge_head_path, "w") as f:
            f.write("0000000000000000000000000000000000000000\n")

        res = check_repository_guard(self.repo_dir, operation="commit")
        self.assertFalse(res["allowed"])
        self.assertEqual(res["overallStatus"], "BLOCKED")
        conflict_issues = [i for i in res["blockingIssues"] if "Merge Conflict" in i["title"]]
        self.assertTrue(len(conflict_issues) > 0)

    # 21. Detached HEAD warns
    def test_21_detached_head_warns(self):
        self._init_repo()
        self._make_commit("file.txt", "v1")
        # Checkout commit directly to enter detached HEAD
        rev = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=self.repo_dir, capture_output=True, text=True).stdout.strip()
        subprocess.run(['git', 'checkout', rev], cwd=self.repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

        res = check_repository_guard(self.repo_dir, operation="commit")
        self.assertTrue(res["allowed"])
        self.assertEqual(res["overallStatus"], "WARNING")
        head_issues = [w for w in res["warnings"] if "Detached HEAD" in w["title"]]
        self.assertTrue(len(head_issues) > 0)

    # 22. Missing remote behavior follows actual push target
    def test_22_push_missing_remote_blocks(self):
        self._init_repo()
        self._make_commit("file.txt", "content")
        # No remote added
        res = check_repository_guard(self.repo_dir, operation="push")
        self.assertFalse(res["allowed"])
        self.assertEqual(res["overallStatus"], "BLOCKED")
        remote_issues = [i for i in res["blockingIssues"] if "No Remote" in i["title"]]
        self.assertTrue(len(remote_issues) > 0)

    # 23. Missing upstream does not produce false PASS
    def test_23_push_missing_upstream_warns(self):
        self._init_repo()
        self._make_commit("file.txt", "content")
        # Add remote origin pointing to another temp repo
        remote_dir = tempfile.mkdtemp()
        try:
            subprocess.run(['git', 'init', '--bare'], cwd=remote_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['git', 'remote', 'add', 'origin', remote_dir], cwd=self.repo_dir, check=True)

            res = check_repository_guard(self.repo_dir, operation="push")
            # Should produce WARNING (no upstream configured yet), NOT a blind PASS
            self.assertEqual(res["overallStatus"], "WARNING")
            upstream_warnings = [w for w in res["warnings"] if "No Upstream" in w["title"]]
            self.assertTrue(len(upstream_warnings) > 0)
        finally:
            import shutil
            shutil.rmtree(remote_dir, ignore_errors=True)

    # 24. Case D — Complete outgoing push range is scanned (5 commits ahead, secret in commit #2)
    def test_24_push_scans_complete_outgoing_range(self):
        self._init_repo()
        # Set up a bare remote and initial push
        remote_dir = tempfile.mkdtemp()
        try:
            subprocess.run(['git', 'init', '--bare'], cwd=remote_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['git', 'remote', 'add', 'origin', remote_dir], cwd=self.repo_dir, check=True)
            self._make_commit("base.txt", "base")
            subprocess.run(['git', 'push', '-u', 'origin', 'main'], cwd=self.repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            # Now create 5 commits ahead:
            # Commit 1: clean
            self._make_commit("c1.txt", "clean 1")
            # Commit 2: contains secret!
            self._make_commit("c2.txt", 'TOKEN = "ghp_123456789012345678901234567890123456"')
            # Commit 3: clean
            self._make_commit("c3.txt", "clean 3")
            # Commit 4: clean
            self._make_commit("c4.txt", "clean 4")
            # Commit 5: clean
            self._make_commit("c5.txt", "clean 5")

            # Push Guard must inspect ALL 5 commits and catch secret in commit #2!
            res = check_repository_guard(self.repo_dir, operation="push")
            self.assertFalse(res["allowed"])
            self.assertEqual(res["overallStatus"], "BLOCKED")
            secret_issues = [i for i in res["blockingIssues"] if i["category"] == "Secret Detection"]
            self.assertTrue(len(secret_issues) > 0)
            self.assertEqual(secret_issues[0]["file"], "c2.txt")
        finally:
            import shutil
            shutil.rmtree(remote_dir, ignore_errors=True)

    # 25. Case A — Clean operation returns PASS
    def test_25_clean_operation_returns_pass(self):
        self._init_repo()
        self._make_commit("doc.txt", "clean documentation")
        # Add normal modification
        with open(os.path.join(self.repo_dir, "doc.txt"), "a") as f:
            f.write("\nmore clean documentation")

        res = check_repository_guard(self.repo_dir, operation="commit")
        self.assertTrue(res["allowed"])
        self.assertEqual(res["overallStatus"], "PASS")
        self.assertEqual(len(res["blockingIssues"]), 0)
        self.assertEqual(len(res["warnings"]), 0)

    # 26. Warning returns WARNING + allowed=True
    def test_26_warning_returns_allowed_true(self):
        self._init_repo()
        self._make_commit("README.md", "# Hello")
        # Create .env with harmless comments
        with open(os.path.join(self.repo_dir, ".env"), "w") as f:
            f.write("# Environment config\nPORT=3000\n")

        res = check_repository_guard(self.repo_dir, operation="commit")
        self.assertTrue(res["allowed"])
        self.assertEqual(res["overallStatus"], "WARNING")
        self.assertEqual(len(res["blockingIssues"]), 0)
        self.assertTrue(len(res["warnings"]) > 0)

    # 27. Case C — Staged secret returns BLOCKED + allowed=False
    def test_27_staged_secret_returns_blocked_allowed_false(self):
        self._init_repo()
        self._make_commit("README.md", "# Hello")
        # Stage secret
        secret_file = os.path.join(self.repo_dir, "keys.py")
        with open(secret_file, "w") as f:
            f.write('api_key = "AIzaSyA1B2C3D4E5F6G7H8I9J0K1L2M3N4O5P6"\n')
        subprocess.run(['git', 'add', 'keys.py'], cwd=self.repo_dir, check=True)

        res = check_repository_guard(self.repo_dir, operation="commit")
        self.assertFalse(res["allowed"])
        self.assertEqual(res["overallStatus"], "BLOCKED")
        self.assertTrue(len(res["blockingIssues"]) > 0)

    # 28. Case F — Scanner failure returns ERROR + allowed=False
    def test_28_scanner_failure_returns_error(self):
        with patch("services.repository_guard.check_git_state", side_effect=RuntimeError("Simulated scanner crash")):
            res = check_repository_guard(self.repo_dir, operation="commit")
            # Must fail safe: allowed=False, overallStatus=ERROR
            self.assertFalse(res["allowed"])
            self.assertEqual(res["overallStatus"], "ERROR")

    # 29. Invalid repository returns ERROR / BLOCKED
    def test_29_invalid_repository_returns_error(self):
        non_repo_dir = tempfile.mkdtemp()
        try:
            res = check_repository_guard(non_repo_dir, operation="commit")
            self.assertFalse(res["allowed"])
            self.assertEqual(res["overallStatus"], "ERROR")
        finally:
            import shutil
            shutil.rmtree(non_repo_dir, ignore_errors=True)

    # 30. Staged vs unstaged vs untracked boundary verification
    def test_30_commit_set_covers_staged_unstaged_and_untracked(self):
        self._init_repo()
        self._make_commit("base.txt", "v1")

        # Staged change
        with open(os.path.join(self.repo_dir, "base.txt"), "w") as f:
            f.write("v2 staged")
        subprocess.run(['git', 'add', 'base.txt'], cwd=self.repo_dir, check=True)

        # Unstaged modification
        with open(os.path.join(self.repo_dir, "base.txt"), "a") as f:
            f.write("\nv3 unstaged")

        # Untracked file
        with open(os.path.join(self.repo_dir, "new_untracked.txt"), "w") as f:
            f.write("new content")

        commit_set = determine_commit_set(self.repo_dir)
        self.assertTrue("base.txt" in commit_set["stagedDiff"])
        self.assertTrue("base.txt" in commit_set["unstagedDiff"])
        self.assertIn("new_untracked.txt", commit_set["untrackedFiles"])


if __name__ == "__main__":
    unittest.main()
