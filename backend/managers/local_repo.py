"""
local_repo.py — Local Repository Detection & Initialization

Provides:
  - is_git_repo(repo_path)  → bool, checks if path is a valid git repo
  - init_git_repo(repo_path) → dict, initializes a git repo at the path
  - get_repo_info(repo_path) → dict, returns branch, status, origin info
"""

import subprocess
import os
import sys
from typing import Tuple, Dict

# Hide CMD console window on Windows
CREATION_FLAGS = 0x08000000 if sys.platform == 'win32' else 0


def _run(cmd: list, cwd: str, timeout: int = 30) -> Tuple[bool, str]:
    """Run a command and return (success, output)."""
    try:
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=CREATION_FLAGS
        )
        stdout = result.stdout.strip() if result.stdout else ""
        stderr = result.stderr.strip() if result.stderr else ""
        if result.returncode == 0:
            return True, stdout
        else:
            return False, stderr or stdout
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
        elif action == "compare_branches":
            base = args.get("base", "")
            compare = args.get("compare", "")
            ok, output = _run(["git", "rev-list", "--left-right", "--count", f"{base}...{compare}"], cwd=repo_path)
            if ok:
                parts = output.split()
                if len(parts) == 2:
                    # behind is left (base), ahead is right (compare)
                    print(json.dumps({"success": True, "behind": int(parts[0]), "ahead": int(parts[1])}))
                else:
                    print(json.dumps({"success": False, "error": f"Unexpected count output: {output}"}))
            else:
                print(json.dumps({"success": False, "error": output}))
        elif action == "get_compare_commits":
            base = args.get("base", "")
            compare = args.get("compare", "")
            # Get commits unique to compare (ahead)
            ok_ahead, out_ahead = _run(["git", "log", "-n", "50", "--oneline", f"{base}..{compare}"], cwd=repo_path)
            # Get commits unique to base (behind)
            ok_behind, out_behind = _run(["git", "log", "-n", "50", "--oneline", f"{compare}..{base}"], cwd=repo_path)
            
            ahead_commits = [line.strip() for line in out_ahead.splitlines() if line.strip()] if ok_ahead else []
            behind_commits = [line.strip() for line in out_behind.splitlines() if line.strip()] if ok_behind else []
            print(json.dumps({
                "success": True,
                "ahead": ahead_commits,
                "behind": behind_commits
            }))
        elif action == "fetch_repo":
            ok, msg = _run(["git", "fetch"], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "pull_repo":
            ok, msg = _run(["git", "pull"], cwd=repo_path)
            conflict = False
            if not ok and "conflict" in msg.lower():
                conflict = True
            print(json.dumps({"success": ok, "message": msg, "conflict": conflict}))
        elif action == "push_repo":
            ok, msg = _run(["git", "push"], cwd=repo_path)
            if not ok and ("no upstream branch" in msg.lower() or "set-upstream" in msg.lower()):
                # Get current branch
                ok_br, current_br = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)
                if ok_br and current_br:
                    ok, msg = _run(["git", "push", "--set-upstream", "origin", current_br], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "get_upstream_status":
            ok_up, up_branch = _run(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd=repo_path)
            if not ok_up:
                print(json.dumps({"success": True, "has_upstream": False, "ahead": 0, "behind": 0}))
            else:
                ok, output = _run(["git", "rev-list", "--left-right", "--count", "HEAD...@{u}"], cwd=repo_path)
                if ok:
                    parts = output.split()
                    if len(parts) == 2:
                        print(json.dumps({"success": True, "has_upstream": True, "ahead": int(parts[0]), "behind": int(parts[1])}))
                    else:
                        print(json.dumps({"success": False, "error": f"Unexpected output: {output}"}))
                else:
                    print(json.dumps({"success": False, "error": output}))
        elif action == "rebase_branch":
            branch = args.get("branch", "")
            ok, msg = _run(["git", "rebase", branch], cwd=repo_path)
            conflict = False
            if not ok and ("conflict" in msg.lower() or "merge conflict" in msg.lower()):
                conflict = True
            print(json.dumps({"success": ok, "message": msg, "conflict": conflict}))
        elif action == "cherry_pick":
            commit_hash = args.get("commit_hash", "")
            ok, msg = _run(["git", "cherry-pick", commit_hash], cwd=repo_path)
            conflict = False
            if not ok and ("conflict" in msg.lower() or "merge conflict" in msg.lower()):
                conflict = True
            print(json.dumps({"success": ok, "message": msg, "conflict": conflict}))
        elif action == "stash_changes":
            sub = args.get("sub_action", "")
            if sub == "push":
                msg_val = args.get("message", "Stashed by GitHub Automator")
                ok, msg = _run(["git", "stash", "push", "-m", msg_val], cwd=repo_path)
            elif sub == "pop":
                ok, msg = _run(["git", "stash", "pop"], cwd=repo_path)
            elif sub == "apply":
                ok, msg = _run(["git", "stash", "apply"], cwd=repo_path)
            elif sub == "clear":
                ok, msg = _run(["git", "stash", "clear"], cwd=repo_path)
            elif sub == "list":
                ok, msg = _run(["git", "stash", "list"], cwd=repo_path)
                if ok:
                    stashes = [line.strip() for line in msg.splitlines() if line.strip()]
                    print(json.dumps({"success": True, "stashes": stashes}))
                    sys.exit(0)
            else:
                ok, msg = False, f"Unknown stash sub action: {sub}"
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "manage_tags":
            sub = args.get("sub_action", "")
            if sub == "list":
                ok, msg = _run(["git", "tag"], cwd=repo_path)
                if ok:
                    tags = [line.strip() for line in msg.splitlines() if line.strip()]
                    print(json.dumps({"success": True, "tags": tags}))
                    sys.exit(0)
            elif sub == "create":
                tag_name = args.get("tag", "")
                ok, msg = _run(["git", "tag", tag_name], cwd=repo_path)
            elif sub == "delete":
                tag_name = args.get("tag", "")
                ok, msg = _run(["git", "tag", "-d", tag_name], cwd=repo_path)
            else:
                ok, msg = False, f"Unknown tag sub action: {sub}"
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "rename_branch":
            new_name = args.get("new_name", "")
            ok, msg = _run(["git", "branch", "-m", new_name], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "create_branch_from_commit":
            branch_name = args.get("branch", "")
            commit_hash = args.get("commit_hash", "")
            ok, msg = _run(["git", "checkout", "-b", branch_name, commit_hash], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "clean_merged_branches":
            # Get merged local branches (excluding current branch, main, master)
            ok_curr, current = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)
            current = current.strip() if ok_curr else ""
            
            ok_merged, out_merged = _run(["git", "branch", "--merged"], cwd=repo_path)
            if not ok_merged:
                print(json.dumps({"success": False, "message": out_merged}))
                sys.exit(0)
                
            branches = []
            for line in out_merged.splitlines():
                b = line.replace("*", "").strip()
                if b and b != current and b not in ["main", "master", "develop", "production", "trunk", "staging"]:
                    branches.append(b)
            
            cleaned = []
            failed = []
            for b in branches:
                ok_del, out_del = _run(["git", "branch", "-d", b], cwd=repo_path)
                if ok_del:
                    cleaned.append(b)
                else:
                    failed.append(f"{b} ({out_del.strip()})")
            
            summary = f"Cleaned {len(cleaned)} branch(es): {', '.join(cleaned)}."
            if failed:
                summary += f" Failed to clean {len(failed)}: {'; '.join(failed)}."
            print(json.dumps({"success": True, "message": summary, "cleaned": cleaned, "failed": failed}))
        elif action == "remote_push_current":
            # Get current branch
            ok_br, current_br = _run(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)
            if ok_br and current_br:
                ok, msg = _run(["git", "push", "origin", current_br], cwd=repo_path)
                print(json.dumps({"success": ok, "message": msg}))
            else:
                print(json.dumps({"success": False, "message": "Failed to get current branch."}))
        elif action == "remote_pull_specific":
            remote = args.get("remote", "origin")
            branch = args.get("branch", "main")
            ok, msg = _run(["git", "pull", remote, branch], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "remote_list_branches":
            ok, msg = _run(["git", "branch", "-r", "--format=%(refname:short)"], cwd=repo_path)
            if ok:
                branches = [line.strip() for line in msg.splitlines() if line.strip()]
                print(json.dumps({"success": True, "branches": branches}))
            else:
                print(json.dumps({"success": False, "message": msg}))
        elif action == "remote_add":
            name = args.get("name", "")
            url = args.get("url", "")
            ok, msg = _run(["git", "remote", "add", name, url], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "remote_set_url":
            name = args.get("name", "origin")
            url = args.get("url", "")
            ok, msg = _run(["git", "remote", "set-url", name, url], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "remote_rename":
            old = args.get("old", "")
            new_name = args.get("new", "")
            ok, msg = _run(["git", "remote", "rename", old, new_name], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "remote_remove":
            name = args.get("name", "")
            ok, msg = _run(["git", "remote", "remove", name], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "remote_prune":
            name = args.get("name", "origin")
            ok, msg = _run(["git", "remote", "prune", name], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "remote_change_upstream":
            upstream = args.get("upstream", "")
            ok, msg = _run(["git", "branch", f"--set-upstream-to={upstream}"], cwd=repo_path)
            print(json.dumps({"success": ok, "message": msg}))
        elif action == "list_remotes":
            ok, msg = _run(["git", "remote"], cwd=repo_path)
            if ok:
                remotes = [line.strip() for line in msg.splitlines() if line.strip()]
                print(json.dumps({"success": True, "remotes": remotes}))
            else:
                print(json.dumps({"success": False, "message": msg}))
        else:
            print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))
