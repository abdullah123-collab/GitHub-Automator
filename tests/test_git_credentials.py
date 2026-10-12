import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from managers.repo_manager import clone_repo, smart_clone
from services.git_credentials import (
    build_git_clone_command,
    build_git_environment,
    redact_git_output,
    sanitize_git_url,
    validate_clone_url,
)


class GitCredentialTests(unittest.TestCase):
    TOKEN = "synthetic-github-token-not-real"
    URL = "https://github.com/example/project.git"

    def test_clone_command_does_not_contain_token(self):
        command = build_git_clone_command(self.URL, "C:\\tmp\\project")
        self.assertNotIn(self.TOKEN, command)
        self.assertNotIn("@", command[4])
        self.assertEqual(command[0:3], ["git", "-c", "credential.helper="])

    def test_valid_github_https_url_is_accepted(self):
        self.assertEqual(validate_clone_url(self.URL), (True, self.URL))

    def test_http_url_is_rejected(self):
        valid, error = validate_clone_url("http://github.com/example/project.git")
        self.assertFalse(valid)
        self.assertIn("HTTPS", error)

    def test_arbitrary_host_is_rejected(self):
        valid, error = validate_clone_url("https://example.com/example/project.git")
        self.assertFalse(valid)
        self.assertIn("github.com", error)

    def test_malformed_url_is_rejected(self):
        valid, error = validate_clone_url("https://[invalid/example/project.git")
        self.assertFalse(valid)
        self.assertIn("malformed", error.lower())

    def test_embedded_credentials_are_rejected(self):
        valid, error = validate_clone_url(
            "https://user:synthetic-github-token-not-real@github.com/example/project.git"
        )
        self.assertFalse(valid)
        self.assertIn("credentials", error.lower())

    def test_rejected_url_never_starts_git(self):
        with patch("managers.repo_manager.subprocess.run") as run:
            result = clone_repo("https://example.com/example/project.git", "C:\\tmp\\project", self.TOKEN)

        self.assertFalse(result["success"])
        run.assert_not_called()

    @patch("managers.repo_manager.register_repo")
    @patch("managers.repo_manager.repo_exists_locally", return_value=True)
    def test_smart_clone_rejects_url_before_existing_repo_check(
        self, exists_mock, register_repo_mock
    ):
        result = smart_clone(
            "project",
            "https://example.com/example/project.git",
            "C:\\tmp\\project",
            self.TOKEN,
        )

        self.assertFalse(result["success"])
        exists_mock.assert_not_called()
        register_repo_mock.assert_not_called()

    def test_token_is_only_supplied_in_child_environment(self):
        env = build_git_environment(self.TOKEN)
        self.assertNotIn(self.TOKEN, env["GIT_CONFIG_VALUE_0"])
        self.assertEqual(env["GIT_CONFIG_KEY_0"], "http.extraheader")
        self.assertEqual(env["GIT_CONFIG_COUNT"], "1")

    def test_sanitize_url_removes_credentials(self):
        url = "https://user:synthetic-github-token-not-real@github.com/example/project.git"
        self.assertEqual(sanitize_git_url(url), self.URL)

    def test_clone_failure_redacts_stderr_and_does_not_expose_token(self):
        class Result:
            returncode = 1
            stderr = f"fatal: https://{self.TOKEN}@github.com rejected the token"

        with patch("managers.repo_manager.subprocess.run", return_value=Result()) as run:
            result = clone_repo(self.URL, "C:\\tmp\\project", self.TOKEN)

        self.assertFalse(result["success"])
        self.assertNotIn(self.TOKEN, result["error"])
        self.assertNotIn(self.TOKEN, run.call_args.kwargs["env"]["GIT_CONFIG_VALUE_0"])
        self.assertEqual(run.call_args.args[0][4], self.URL)

    def test_clone_timeout_message_does_not_expose_token(self):
        with patch(
            "managers.repo_manager.subprocess.run",
            side_effect=TimeoutError(self.TOKEN),
        ):
            result = clone_repo(self.URL, "C:\\tmp\\project", self.TOKEN)

        self.assertFalse(result["success"])
        self.assertNotIn(self.TOKEN, result["error"])

    def test_redact_output_removes_token_and_url_userinfo(self):
        output = (
            f"fatal: https://user:{self.TOKEN}@github.com/example/project.git "
            f"used {self.TOKEN}"
        )
        redacted = redact_git_output(output, self.TOKEN)
        self.assertNotIn(self.TOKEN, redacted)
        self.assertNotIn("user:", redacted)

    @patch("managers.repo_manager.register_repo")
    @patch("managers.repo_manager.clone_repo", return_value={"success": True})
    @patch("managers.repo_manager.repo_exists_locally", return_value=False)
    def test_smart_clone_registers_sanitized_url(
        self, _exists, _clone, register_repo_mock
    ):
        result = smart_clone("project", self.URL, "C:\\tmp\\project", self.TOKEN)

        self.assertTrue(result["success"])
        registered_url = register_repo_mock.call_args.args[2]
        self.assertEqual(registered_url, self.URL)
        self.assertNotIn(self.TOKEN, registered_url)

    def test_non_github_clone_cannot_create_git_config(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            clone_path = Path(temp_dir, "project")
            result = clone_repo("file:///C:/source/project.git", str(clone_path), self.TOKEN)

        self.assertFalse(result["success"])
        self.assertFalse((clone_path / ".git" / "config").exists())


if __name__ == "__main__":
    unittest.main()
