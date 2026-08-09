import json
import os
import subprocess
import sys
import unittest


class AiCommitCliTests(unittest.TestCase):
    def test_ai_commit_cli_runs_from_backend(self):
        repo_root = os.path.dirname(os.path.dirname(__file__))
        backend_dir = os.path.join(repo_root, 'backend')
        script_path = os.path.join(backend_dir, 'services', 'ai_commit_cli.py')
        payload = json.dumps({
            'diff': 'diff --git a/file.txt b/file.txt\n@@ -1 +1,2 @@\n-old\n+new\n+line',
            'api_key': '',
<<<<<<< HEAD
            'model': 'gemini-3.6-flash'
=======
            'model': 'claude-3-5-haiku-latest'
>>>>>>> dcd6c22624dbf173ff929c5f133afb5303974d15
        })

        result = subprocess.run(
            [sys.executable, script_path],
            cwd=backend_dir,
            input=payload,
            text=True,
            capture_output=True,
            check=False,
        )

        self.assertEqual(result.returncode, 0, msg=result.stderr)
        parsed = json.loads(result.stdout)
        self.assertTrue(parsed['success'])
        self.assertIn('feat', parsed['message'])


if __name__ == '__main__':
    unittest.main()
