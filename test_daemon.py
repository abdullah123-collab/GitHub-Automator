import sys
import time
import json
import subprocess

start = time.time()
p = subprocess.Popen(["python", "daemon.py"], cwd="backend", stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

# Test 1: commit_manager get_diff
req = json.dumps({"id": 1, "scriptName": "managers/commit_manager.py", "payload": {"action": "get_diff", "repo_path": "I:\\github-automator", "staged": False}})
p.stdin.write(req + "\n")
p.stdin.flush()

res = p.stdout.readline()
end = time.time()
print(f"Test 1 (commit_manager get_diff) took: {end - start:.4f}s")
print(res.strip()[:200])

# Test 2: commit_manager commit_and_push (will fail gracefully but tests parsing)
start = time.time()
req2 = json.dumps({"id": 2, "scriptName": "managers/commit_manager.py", "payload": {"action": "commit_and_push", "repo_path": "I:\\github-automator", "message": "test", "auto_push": False}})
p.stdin.write(req2 + "\n")
p.stdin.flush()

res2 = p.stdout.readline()
end = time.time()
print(f"Test 2 (commit_manager commit_and_push) took: {end - start:.4f}s")
print(res2.strip()[:200])

p.terminate()
