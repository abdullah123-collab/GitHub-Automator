import os
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from managers.commit_manager import get_diff


class CommitManagerTests(unittest.TestCase):
    def test_get_diff_returns_staged_changes(self):
        with tempfile.TemporaryDirectory() as repo_dir:
            subprocess.run(['git', 'init'], cwd=repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['git', 'config', 'user.email', 'test@example.com'], cwd=repo_dir, check=True)
            subprocess.run(['git', 'config', 'user.name', 'Test User'], cwd=repo_dir, check=True)

            with open(os.path.join(repo_dir, 'app.txt'), 'w', encoding='utf-8') as handle:
                handle.write('hello\n')

            subprocess.run(['git', 'add', 'app.txt'], cwd=repo_dir, check=True)
            subprocess.run(['git', 'commit', '-m', 'initial'], cwd=repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

            with open(os.path.join(repo_dir, 'app.txt'), 'a', encoding='utf-8') as handle:
                handle.write('world\n')

            subprocess.run(['git', 'add', 'app.txt'], cwd=repo_dir, check=True)

            ok, diff = get_diff(repo_dir, staged=True)

            self.assertTrue(ok)
            self.assertIn('world', diff)
            self.assertIn('diff --git', diff)


if __name__ == '__main__':
    unittest.main()
