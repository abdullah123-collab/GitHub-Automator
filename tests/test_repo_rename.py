import os
import sys
import tempfile
import subprocess
import unittest
from unittest.mock import MagicMock
import urllib.error
import io
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from managers.repo_manager import validate_repo_name, rewrite_git_remote_url, rename_repo
import services.repo_registry as repo_registry


class RepoRenameValidationTests(unittest.TestCase):
    def test_valid_repo_names(self):
        valid_names = [
            "my-repo",
            "my_repo",
            "my.repo",
            "repo123",
            "A-Z_0-9.test",
            "a" * 100
        ]
        for name in valid_names:
            res = validate_repo_name(name)
            self.assertTrue(res["valid"], f"Expected '{name}' to be valid")
            self.assertEqual(res["name"], name)
            self.assertFalse(res.get("no_op", False))

    def test_empty_and_whitespace_names(self):
        for name in [None, "", "   ", "\t\n"]:
            res = validate_repo_name(name)
            self.assertFalse(res["valid"])
            self.assertIn("cannot be empty", res["error"])

    def test_no_op_when_name_unchanged(self):
        res = validate_repo_name("same-name", current_name="same-name")
        self.assertTrue(res["valid"])
        self.assertTrue(res.get("no_op"))

        # Trimming whitespace should still match if identical
        res = validate_repo_name("  same-name  ", current_name="same-name")
        self.assertTrue(res["valid"])
        self.assertTrue(res.get("no_op"))

    def test_name_exceeds_100_characters(self):
        res = validate_repo_name("a" * 101)
        self.assertFalse(res["valid"])
        self.assertIn("100 characters", res["error"])

    def test_invalid_characters(self):
        invalid_names = [
            "my repo",
            "my@repo",
            "my#repo",
            "my$repo",
            "my/repo",
            "my\\repo",
            "my:repo",
            "my?repo",
            "my*repo"
        ]
        for name in invalid_names:
            res = validate_repo_name(name)
            self.assertFalse(res["valid"], f"Expected '{name}' to be invalid")
            self.assertIn("letters, numbers", res["error"])

    def test_leading_and_trailing_periods_and_hyphens(self):
        disallowed = [
            ".repo",
            "-repo",
            "repo.",
            "repo-",
            ".repo.",
            "-repo-",
            ".-repo",
            "repo-."
        ]
        for name in disallowed:
            res = validate_repo_name(name)
            self.assertFalse(res["valid"], f"Expected '{name}' to be rejected due to leading/trailing dot or hyphen")
            self.assertIn("start or end with a period or hyphen", res["error"])

    def test_git_suffix_rejected(self):
        disallowed = [
            ".git",
            "my-repo.git",
            "test.GIT",
            "another.Git"
        ]
        for name in disallowed:
            res = validate_repo_name(name)
            self.assertFalse(res["valid"], f"Expected '{name}' to be rejected due to .git suffix")
            self.assertIn("cannot end with .git", res["error"])


class RemoteUrlRewritingTests(unittest.TestCase):
    def test_https_standard_url(self):
        url = "https://github.com/alice/old-repo.git"
        new_url = rewrite_git_remote_url(url, "new-repo", expected_owner="alice", old_repo_name="old-repo")
        self.assertEqual(new_url, "https://github.com/alice/new-repo.git")

    def test_https_without_git_suffix(self):
        url = "https://github.com/alice/old-repo"
        new_url = rewrite_git_remote_url(url, "new-repo", expected_owner="alice", old_repo_name="old-repo")
        self.assertEqual(new_url, "https://github.com/alice/new-repo")

    def test_https_with_token_auth(self):
        url = "https://ghp_secretToken12345@github.com/alice/old-repo.git"
        new_url = rewrite_git_remote_url(url, "new-repo", expected_owner="alice", old_repo_name="old-repo")
        self.assertEqual(new_url, "https://ghp_secretToken12345@github.com/alice/new-repo.git")

    def test_https_with_username_and_token(self):
        url = "https://alice:ghp_secretToken12345@github.com/alice/old-repo.git"
        new_url = rewrite_git_remote_url(url, "new-repo", expected_owner="alice", old_repo_name="old-repo")
        self.assertEqual(new_url, "https://alice:ghp_secretToken12345@github.com/alice/new-repo.git")

    def test_ssh_standard_url(self):
        url = "git@github.com:alice/old-repo.git"
        new_url = rewrite_git_remote_url(url, "new-repo", expected_owner="alice", old_repo_name="old-repo")
        self.assertEqual(new_url, "git@github.com:alice/new-repo.git")

    def test_ssh_without_git_suffix(self):
        url = "git@github.com:alice/old-repo"
        new_url = rewrite_git_remote_url(url, "new-repo", expected_owner="alice", old_repo_name="old-repo")
        self.assertEqual(new_url, "git@github.com:alice/new-repo")

    def test_ssh_protocol_url(self):
        url = "ssh://git@github.com/alice/old-repo.git"
        new_url = rewrite_git_remote_url(url, "new-repo", expected_owner="alice", old_repo_name="old-repo")
        self.assertEqual(new_url, "ssh://git@github.com/alice/new-repo.git")

    def test_ssh_protocol_with_custom_port(self):
        url = "ssh://git@github.com:22/alice/old-repo.git"
        new_url = rewrite_git_remote_url(url, "new-repo", expected_owner="alice", old_repo_name="old-repo")
        self.assertEqual(new_url, "ssh://git@github.com:22/alice/new-repo.git")

    def test_does_not_replace_credentials_matching_old_repo_name(self):
        url = "https://old-repo:pass-old-repo@github.com/alice/old-repo.git"
        new_url = rewrite_git_remote_url(url, "new-repo", expected_owner="alice", old_repo_name="old-repo")
        self.assertEqual(new_url, "https://old-repo:pass-old-repo@github.com/alice/new-repo.git")

    def test_case_insensitive_owner_matching(self):
        url = "https://github.com/Alice/old-repo.git"
        new_url = rewrite_git_remote_url(url, "new-repo", expected_owner="alice", old_repo_name="old-repo")
        self.assertEqual(new_url, "https://github.com/Alice/new-repo.git")


class RenameRepoIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.original_get_config_dir = repo_registry.get_config_dir
        self.temp_dir = tempfile.TemporaryDirectory()
        repo_registry.get_config_dir = lambda: self.temp_dir.name

    def tearDown(self):
        repo_registry.get_config_dir = self.original_get_config_dir
        self.temp_dir.cleanup()

    def test_successful_rename_with_local_git_remote(self):
        # 1. Setup temporary local git repo with origin remote
        with tempfile.TemporaryDirectory() as repo_path:
            subprocess.run(["git", "init", "-b", "main"], cwd=repo_path, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(["git", "remote", "add", "origin", "https://github.com/test-owner/test-old-repo.git"], cwd=repo_path, check=True)

            # 2. Register in repo_registry
            repo_registry.register_repo("test-old-repo", repo_path, "https://github.com/test-owner/test-old-repo.git")

            # 3. Mock GitHub API
            mock_api = MagicMock()
            mock_api.update_repo.return_value = {
                "id": 987654321,
                "name": "test-new-repo",
                "html_url": "https://github.com/test-owner/test-new-repo",
                "clone_url": "https://github.com/test-owner/test-new-repo.git",
                "ssh_url": "git@github.com:test-owner/test-new-repo.git"
            }

            # 4. Perform rename
            res = rename_repo(mock_api, "test-owner", "test-old-repo", "test-new-repo")

            # Verify API was called with correct parameters
            mock_api.update_repo.assert_called_once_with("test-owner", "test-old-repo", {"name": "test-new-repo"})

            # Verify result
            self.assertTrue(res["success"])
            self.assertFalse(res["no_op"])
            self.assertEqual(res["name"], "test-new-repo")
            self.assertEqual(res["id"], 987654321)
            self.assertTrue(res["remote_updated"])
            self.assertIsNone(res["remote_warning"])

            # Verify local git remote origin was updated
            res_git = subprocess.run(["git", "config", "--get", "remote.origin.url"], cwd=repo_path, capture_output=True, text=True)
            self.assertEqual(res_git.stdout.strip(), "https://github.com/test-owner/test-new-repo.git")

            # Verify registry was migrated from old to new name
            registry = repo_registry.load_registry()
            self.assertNotIn("test-old-repo", registry)
            self.assertIn("test-new-repo", registry)
            self.assertEqual(registry["test-new-repo"]["path"], repo_path)
            self.assertEqual(registry["test-new-repo"]["repo"], "test-new-repo")

    def test_rename_when_not_in_registry_succeeds(self):
        mock_api = MagicMock()
        mock_api.update_repo.return_value = {
            "id": 112233,
            "name": "brand-new",
            "html_url": "https://github.com/alice/brand-new",
            "clone_url": "https://github.com/alice/brand-new.git"
        }

        res = rename_repo(mock_api, "alice", "old-brand", "brand-new")
        self.assertTrue(res["success"])
        self.assertEqual(res["name"], "brand-new")
        self.assertFalse(res["remote_updated"])
        self.assertIsNone(res["remote_warning"])

    def test_github_404_error_handling(self):
        mock_api = MagicMock()
        err_response = urllib.error.HTTPError(
            url="https://api.github.com/repos/alice/missing",
            code=404,
            msg="Not Found",
            hdrs={},
            fp=io.BytesIO(b'{"message": "Not Found"}')
        )
        mock_api.update_repo.side_effect = err_response

        res = rename_repo(mock_api, "alice", "missing", "found")
        self.assertFalse(res["success"])
        self.assertEqual(res["error_code"], 404)
        self.assertIn("not found on GitHub", res["error"])

    def test_github_403_error_handling(self):
        mock_api = MagicMock()
        err_response = urllib.error.HTTPError(
            url="https://api.github.com/repos/alice/forbidden",
            code=403,
            msg="Forbidden",
            hdrs={},
            fp=io.BytesIO(b'{"message": "Must have admin rights to Repository."}')
        )
        mock_api.update_repo.side_effect = err_response

        res = rename_repo(mock_api, "alice", "forbidden", "allowed")
        self.assertFalse(res["success"])
        self.assertEqual(res["error_code"], 403)
        self.assertIn("admin rights", res["error"])

    def test_github_422_error_handling(self):
        mock_api = MagicMock()
        err_response = urllib.error.HTTPError(
            url="https://api.github.com/repos/alice/repo",
            code=422,
            msg="Unprocessable Entity",
            hdrs={},
            fp=io.BytesIO(b'{"message": "Validation Failed", "errors": [{"resource": "Repository", "code": "custom", "field": "name", "message": "name already exists on this account"}]}')
        )
        mock_api.update_repo.side_effect = err_response

        res = rename_repo(mock_api, "alice", "repo", "existing-repo")
        self.assertFalse(res["success"])
        self.assertEqual(res["error_code"], 422)
        self.assertIn("already exists", res["error"])

    def test_network_failure_handling(self):
        mock_api = MagicMock()
        mock_api.update_repo.side_effect = urllib.error.URLError("getaddrinfo failed")

        res = rename_repo(mock_api, "alice", "repo", "new-repo")
        self.assertFalse(res["success"])
        self.assertIn("internet connection or network failure", res["error"])


if __name__ == '__main__':
    unittest.main()
