"""
local_repo.py — Local Repository Detection & Initialization

Provides:
  - is_git_repo(repo_path)  → bool, checks if path is a valid git repo
  - init_git_repo(repo_path) → dict, initializes a git repo at the path
  - get_repo_info(repo_path) → dict, returns branch, status, origin info
"""

import subprocess
import os
from typing import Tuple, Dict


def _run(cmd: list, cwd: str, timeout: int = 30) -> Tuple[bool, str]:
    """Run a command and return (success, output)."""
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout
        )
        if result.returncode == 0:
            return True, result.stdout.strip()
        else:
            return False, result.stderr.strip() or result.stdout.strip()
    except FileNotFoundError:
        return False, "git is not installed or not in PATH"
    except subprocess.TimeoutExpired:
        return False, f"Command timed out: {' '.join(cmd)}"
    except Exception as e:
        return False, str(e)


def is_git_repo(repo_path: str) -> bool:
    """
    Check if the given path is a valid git repository.
    Returns True if .git directory exists and git recognizes it.
    """
    if not os.path.isdir(repo_path):
        return False
    
    ok, _ = _run(["git", "rev-parse", "--is-inside-work-tree"], cwd=repo_path)
    return ok


def init_git_repo(repo_path: str, default_branch: str = "main") -> Dict:
    """
    Initialize a new git repository at repo_path.
    
    Returns:
        {
            "success": bool,
            "message": str,
            "repo_path": str
        }
    """
    if not os.path.isdir(repo_path):
        return {
            "success": False,
            "message": f"Path does not exist: {repo_path}",
            "repo_path": repo_path
        }
    
    # Check if already a git repo
    if is_git_repo(repo_path):
        return {
            "success": True,
            "message": "Already a git repository",
            "repo_path": repo_path
        }
    
    # Initialize git repo
    ok, msg = _run(["git", "init", "-b", default_branch], cwd=repo_path)
    if not ok:
        return {
            "success": False,
            "message": f"Failed to initialize git: {msg}",
            "repo_path": repo_path
        }
    
    # Configure git user (if not already configured)
    _run(["git", "config", "user.email", "automator@github.local"], cwd=repo_path)
    _run(["git", "config", "user.name", "GitHub Automator"], cwd=repo_path)
    
    return {
        "success": True,
        "message": "Git repository initialized successfully",
        "repo_path": repo_path
    }


def get_repo_info(repo_path: str) -> Dict:
    """
    Get information about a git repository.
    
    Returns:
        {
            "success": bool,
            "is_git_repo": bool,
            "branch": str or None,
            "has_changes": bool,
            "origin_url": str or None,
            "error": str or None
        }
    """
    if not is_git_repo(repo_path):
        return {
            "success": False,
            "is_git_repo": False,
            "branch": None,
            "has_changes": False,
            "origin_url": None,
            "error": "Not a git repository"
        }
    
    # Get current branch
    branch_ok, branch = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)
    branch = branch if branch_ok else None
    
    # Check for changes
    status_ok, status = _run(["git", "status", "--short"], cwd=repo_path)
    has_changes = status_ok and len(status) > 0
    
    # Get origin URL
    origin_ok, origin = _run(["git", "config", "--get", "remote.origin.url"], cwd=repo_path)
    origin_url = origin if origin_ok and origin else None
    
    return {
        "success": True,
        "is_git_repo": True,
        "branch": branch,
        "has_changes": has_changes,
        "origin_url": origin_url,
        "error": None
    }


def is_merge_in_progress(repo_path: str) -> bool:
    """Check if a git merge is currently in progress."""
    import os
    git_dir = os.path.join(repo_path, ".git")
    merge_head = os.path.join(git_dir, "MERGE_HEAD")
    return os.path.exists(merge_head)


def abort_merge(repo_path: str) -> Dict:
    """
    Abort an ongoing git merge.
    
    Returns:
        {
            "success": bool,
            "message": str
        }
    """
    if not is_merge_in_progress(repo_path):
        return {
            "success": True,
            "message": "No merge in progress"
        }
    
    ok, msg = _run(["git", "merge", "--abort"], cwd=repo_path)
    return {
        "success": ok,
        "message": msg if ok else f"Failed to abort merge: {msg}"
    }


def get_conflicted_files(repo_path: str) -> Dict:
    """
    Get list of files with merge conflicts.
    
    Returns:
        {
            "success": bool,
            "files": list of conflicted filenames,
            "message": str
        }
    """
    ok, files = _run(["git", "diff", "--name-only", "--diff-filter=U"], cwd=repo_path)
    if ok:
        file_list = [f for f in files.splitlines() if f.strip()]
        return {
            "success": True,
            "files": file_list,
            "message": f"Found {len(file_list)} conflicted file(s)"
        }
    else:
        return {
            "success": False,
            "files": [],
            "message": files
        }


# ─── Entry Point (Called via pythonBridge.js) ─────────────────────
if __name__ == "__main__":
    import sys
    import json
    
    try:
        args = json.loads(sys.stdin.read())
    except:
        print(json.dumps({"success": False, "error": "Invalid JSON input"}))
        sys.exit(1)
    
    action = args.get("action", "")
    repo_path = args.get("repo_path", "")
    
    if not repo_path:
        print(json.dumps({"success": False, "error": "repo_path is required"}))
        sys.exit(1)
    
    try:
        if action == "is_git_repo":
            is_repo = is_git_repo(repo_path)
            print(json.dumps({
                "success": True,
                "is_git_repo": is_repo
            }))
        elif action == "init_git_repo":
            default_branch = args.get("default_branch", "main")
            result = init_git_repo(repo_path, default_branch)
            print(json.dumps(result))
        elif action == "get_repo_info":
            result = get_repo_info(repo_path)
            print(json.dumps(result))
        elif action == "is_merge_in_progress":
            in_progress = is_merge_in_progress(repo_path)
            print(json.dumps({
                "success": True,
                "in_progress": in_progress
            }))
        elif action == "abort_merge":
            result = abort_merge(repo_path)
            print(json.dumps(result))
        elif action == "get_conflicted_files":
            result = get_conflicted_files(repo_path)
            print(json.dumps(result))
        elif action == "list_branches":
            ok, output = _run(["git", "branch", "--format=%(refname:short)"], cwd=repo_path)
            if ok:
                branches = [b.strip() for b in output.splitlines() if b.strip()]
                print(json.dumps({"success": True, "branches": branches}))
            else:
                print(json.dumps({"success": False, "branches": [], "message": output}))
        elif action == "switch_branch":
            branch = args.get("branch", "")
            ok, msg = _run(["git", "checkout", branch], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "create_branch":
            branch = args.get("branch", "")
            ok, msg = _run(["git", "checkout", "-b", branch], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "merge_branch":
            branch = args.get("branch", "")
            ok, msg = _run(["git", "merge", branch], cwd=repo_path)
            conflict = False
            if not ok and ("conflict" in msg.lower() or "merge failed" in msg.lower()):
                conflict = True
            print(json.dumps({"success": ok, "message": msg, "conflict": conflict}))
        elif action == "delete_branch":
            branch = args.get("branch", "")
            ok, msg = _run(["git", "branch", "-D", branch], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        else:
            print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
