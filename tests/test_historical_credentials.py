import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from services import repo_registry
from services.git_credentials import normalize_historical_remote_url


class HistoricalCredentialCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_config_dir = repo_registry.get_config_dir
        repo_registry.get_config_dir = lambda: self.temp_dir.name

    def tearDown(self):
        repo_registry.get_config_dir = self.original_config_dir
        self.temp_dir.cleanup()

    def create_repo(self, remote_url=None):
        repo_path = Path(self.temp_dir.name) / f"repo-{len(list(Path(self.temp_dir.name).iterdir()))}"
        repo_path.mkdir()
        subprocess.run(
            ["git", "init", str(repo_path)],
            check=True,
            capture_output=True,
            text=True,
        )
        if remote_url:
            subprocess.run(
                ["git", "remote", "add", "origin", remote_url],
                cwd=repo_path,
                check=True,
                capture_output=True,
                text=True,
            )
        return repo_path

    def write_registry(self, registry):
        registry_path = Path(repo_registry.get_registry_path())
        registry_path.write_text(json.dumps(registry), encoding="utf-8")

    def test_https_credentials_are_removed_from_remote_and_registry(self):
        secret = "synthetic-secret-not-real"
        remote = f"https://token:{secret}@github.com/owner/project.git"
        repo_path = self.create_repo(remote)
        self.write_registry({
            "project": {
                "path": str(repo_path),
                "clone_url": remote,
                "owner": "owner",
                "repo": "project",
                "unrelated": "preserved",
            }
        })

        preview = repo_registry.cleanup_historical_credentials(dry_run=True)
        self.assertEqual(preview["changed_count"], 1)
        self.assertEqual(preview["repositories"][0]["status"], "would_clean")
        self.assertNotIn(secret, json.dumps(preview))
        self.assertEqual(
            repo_registry._get_remote_url(str(repo_path)),
            remote,
        )

        result = repo_registry.cleanup_historical_credentials(dry_run=False)
        self.assertEqual(result["changed_count"], 1)
        self.assertNotIn(secret, repo_registry._get_remote_url(str(repo_path)))
        registry = repo_registry.load_registry()
        self.assertEqual(
            registry["project"]["clone_url"],
            "https://github.com/owner/project.git",
        )
        self.assertEqual(registry["project"]["unrelated"], "preserved")

    def test_token_like_usernames_and_passwords_are_detected(self):
        for remote in (
            "https://ghp_synthetic@github.com/owner/project.git",
            "https://owner:synthetic-password@github.com/owner/project.git",
        ):
            status, normalized = normalize_historical_remote_url(remote)
            self.assertEqual(status, "cleanup_required")
            self.assertNotIn("ghp_synthetic", normalized)
            self.assertNotIn("synthetic-password", normalized)

    def test_clean_remote_is_unchanged_and_cleanup_is_idempotent(self):
        repo_path = self.create_repo("https://github.com/owner/project.git")
        self.write_registry({
            "project": {
                "path": str(repo_path),
                "clone_url": "https://github.com/owner/project.git",
                "marker": "keep",
            }
        })

        first = repo_registry.cleanup_historical_credentials(dry_run=False)
        second = repo_registry.cleanup_historical_credentials(dry_run=False)
        self.assertEqual(first["changed_count"], 0)
        self.assertEqual(second["changed_count"], 0)
        self.assertEqual(repo_registry.load_registry()["project"]["marker"], "keep")

    def test_arbitrary_host_is_preserved_not_rewritten(self):
        secret = "synthetic-secret-not-real"
        remote = f"https://user:{secret}@gitlab.example/owner/project.git"
        repo_path = self.create_repo(remote)
        self.write_registry({"project": {"path": str(repo_path), "clone_url": remote}})

        result = repo_registry.cleanup_historical_credentials(dry_run=False)
        self.assertEqual(result["changed_count"], 1)
        cleaned = repo_registry._get_remote_url(str(repo_path))
        self.assertEqual(cleaned, "https://gitlab.example/owner/project.git")
        self.assertNotIn("github.com", cleaned)

    def test_malformed_and_unsupported_urls_require_manual_review(self):
        for remote in (
            "https://[invalid/owner/project.git",
            "ftp://user:secret@example.com/owner/project.git",
        ):
            status, _normalized = normalize_historical_remote_url(remote)
            self.assertEqual(status, "manual_review")

    def test_missing_repository_is_reported_without_exposing_registry_values(self):
        secret = "synthetic-secret-not-real"
        self.write_registry({
            "missing-project": {
                "path": str(Path(self.temp_dir.name) / "missing"),
                "clone_url": f"https://user:{secret}@github.com/owner/project.git",
            }
        })

        result = repo_registry.cleanup_historical_credentials(dry_run=True)
        self.assertEqual(result["repositories"][0]["status"], "manual_review")
        self.assertNotIn(secret, json.dumps(result))

    def test_registry_write_failure_preserves_original_file(self):
        original = {"project": {"path": "preserved", "marker": "keep"}}
        self.write_registry(original)
        registry_path = repo_registry.get_registry_path()

        with patch("services.repo_registry.os.replace", side_effect=OSError("synthetic interruption")):
            repo_registry.save_registry({"project": {"path": "new", "marker": "changed"}})

        self.assertEqual(json.loads(Path(registry_path).read_text(encoding="utf-8")), original)


if __name__ == "__main__":
    unittest.main()
