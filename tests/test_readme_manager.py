import os
import sys
import tempfile
import unittest
import subprocess
from unittest.mock import patch

# Ensure backend path is added
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from managers.readme_manager import (
    analyze_repo_for_readme,
    generate_readme,
    git_ls_files,
    walk_fallback
)

class ReadmeManagerTests(unittest.TestCase):

    def setUp(self):
        # Set up a test API key for testing generate_readme
        os.environ["GEMINI_API_KEY"] = "test-api-key-12345"

    def test_git_ls_files_and_ignores(self):
        """Test that git_ls_files correctly reads non-ignored repo files."""
        with tempfile.TemporaryDirectory() as repo_dir:
            subprocess.run(['git', 'init'], cwd=repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            subprocess.run(['git', 'config', 'user.email', 'test@example.com'], cwd=repo_dir, check=True)
            subprocess.run(['git', 'config', 'user.name', 'Test User'], cwd=repo_dir, check=True)

            # Write ignored directory and file
            os.makedirs(os.path.join(repo_dir, 'node_modules'))
            with open(os.path.join(repo_dir, 'node_modules', 'index.js'), 'w') as f:
                f.write('console.log("hello");')

            # Write .gitignore
            with open(os.path.join(repo_dir, '.gitignore'), 'w') as f:
                f.write('*.log\nnode_modules/\n')

            # Write valid files
            with open(os.path.join(repo_dir, 'index.js'), 'w') as f:
                f.write('console.log("app");')
            with open(os.path.join(repo_dir, 'app.log'), 'w') as f:
                f.write('error logs')

            # Stage only valid files
            subprocess.run(['git', 'add', 'index.js'], cwd=repo_dir, check=True)

            files = git_ls_files(repo_dir)
            self.assertIsNotNone(files)
            # index.js is tracked, app.log is ignored, node_modules is ignored
            self.assertIn('index.js', files)
            self.assertNotIn('app.log', files)
            self.assertNotIn('node_modules/index.js', files)

    def test_repo_analysis_metadata(self):
        """Test metadata extraction (package.json parsing, project type)."""
        with tempfile.TemporaryDirectory() as repo_dir:
            subprocess.run(['git', 'init'], cwd=repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            # package.json
            pkg = {
                "name": "test-project",
                "dependencies": {
                    "react": "^18.0.0",
                    "pg": "^8.0.0"
                }
            }
            with open(os.path.join(repo_dir, 'package.json'), 'w') as f:
                f.write(json_dumps(pkg) if 'json_dumps' in globals() else import_json_dumps(pkg))

            # Entry points
            with open(os.path.join(repo_dir, 'index.js'), 'w') as f:
                f.write('console.log("run");')

            # Run analysis
            analysis = analyze_repo_for_readme(repo_dir)
            self.assertTrue(analysis["success"])
            self.assertEqual(analysis["name"], os.path.basename(repo_dir))
            self.assertEqual(analysis["type"], "React Application")
            self.assertIn("React", analysis["technologies"])
            self.assertIn("Node.js", analysis["technologies"])
            self.assertIn("pg", analysis["dependencies"])
            self.assertIn("pg", analysis["database_info"]) # pg is Postgres (db keyword)
            self.assertIn("index.js", analysis["entryPoints"])

    def test_ignores_sensitive_and_binary_files(self):
        """Verify secrets, large files, and binary files are skipped."""
        with tempfile.TemporaryDirectory() as repo_dir:
            subprocess.run(['git', 'init'], cwd=repo_dir, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            
            # Write sensitive files
            with open(os.path.join(repo_dir, '.env'), 'w') as f:
                f.write('DB_PASS=12345')
            with open(os.path.join(repo_dir, 'id_rsa.key'), 'w') as f:
                f.write('key-content')

            # Write binary files
            with open(os.path.join(repo_dir, 'image.png'), 'wb') as f:
                f.write(b'\x89PNG\r\n\x1a\n')

            # Write huge file (exceeds 50KB)
            with open(os.path.join(repo_dir, 'large.py'), 'w') as f:
                f.write('x = 1\n' * 20000) # > 100KB

            # Run analysis
            analysis = analyze_repo_for_readme(repo_dir)
            self.assertTrue(analysis["success"])
            
            # Assert they are not in important files
            self.assertNotIn('.env', analysis["importantFiles"])
            self.assertNotIn('id_rsa.key', analysis["importantFiles"])
            self.assertNotIn('image.png', analysis["importantFiles"])
            self.assertNotIn('large.py', analysis["importantFiles"])

    @patch('managers.readme_manager.generate_text')
    def test_generate_readme_success(self, mock_generate):
        """Test successful generate_readme call."""
        mock_generate.return_value = {
            "success": True,
            "text": "# Project Title\nThis is a generated README."
        }
        
        with tempfile.TemporaryDirectory() as repo_dir:
            res = generate_readme(repo_dir, existing_content=None)
            self.assertTrue(res["success"])
            self.assertEqual(res["content"], "# Project Title\nThis is a generated README.")
            self.assertIsNone(res["error_type"])

    @patch('managers.readme_manager.generate_text')
    def test_generate_readme_auth_error(self, mock_generate):
        """Test authentication error classification."""
        mock_generate.return_value = {
            "success": False,
            "error": "AuthenticationError: HTTP 403 Forbidden: Invalid key"
        }
        with tempfile.TemporaryDirectory() as repo_dir:
            res = generate_readme(repo_dir)
            self.assertFalse(res["success"])
            self.assertEqual(res["error_type"], "auth")
            self.assertEqual(res["error"], "GitHub authentication/session error.")

    @patch('managers.readme_manager.generate_text')
    def test_generate_readme_rate_limit_error(self, mock_generate):
        """Test API rate limit error classification."""
        mock_generate.return_value = {
            "success": False,
            "error": "RateLimitError: HTTP 429 Too Many Requests"
        }
        with tempfile.TemporaryDirectory() as repo_dir:
            res = generate_readme(repo_dir)
            self.assertFalse(res["success"])
            self.assertEqual(res["error_type"], "api")
            self.assertIn("rate limit", res["error"])

    @patch('managers.readme_manager.generate_text')
    def test_generate_readme_network_error(self, mock_generate):
        """Test connection timeout/network error classification."""
        mock_generate.return_value = {
            "success": False,
            "error": "TimeoutError: The read operation timed out"
        }
        with tempfile.TemporaryDirectory() as repo_dir:
            res = generate_readme(repo_dir)
            self.assertFalse(res["success"])
            self.assertEqual(res["error_type"], "network")
            self.assertIn("No internet connection", res["error"])

def import_json_dumps(obj):
    import json
    return json.dumps(obj)

if __name__ == '__main__':
    unittest.main()
