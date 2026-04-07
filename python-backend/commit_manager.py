"""
commit_manager.py — Git Commit & Push Manager for Phase 3
Called by gui.py directly (imported, not spawned).

Provides:
  - get_status(repo_path)       → list of changed files
  - get_diff(repo_path)         → full git diff string
  - stage_all(repo_path)        → git add .
  - commit(repo_path, message)  → git commit -m "..."
  - push(repo_path)             → git push
  - stage_commit_push(...)      → all-in-one
"""

import subprocess
from typing import Tuple


def _run(cmd: list, cwd: str, timeout: int = 30) -> Tuple[bool, str]:
    """Run a git command and return (success, output)."""
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
    """Check if the given path is a git repository."""
    ok, _ = _run(["git", "rev-parse", "--is-inside-work-tree"], cwd=repo_path)
    return ok


def get_status(repo_path: str) -> Tuple[bool, list]:
    """
    Returns a list of changed file status lines.
    E.g. [" M src/extension.js", "?? newfile.py"]
    """
    ok, output = _run(["git", "status", "--short"], cwd=repo_path)
    if not ok:
        return False, []
    lines = [l for l in output.splitlines() if l.strip()]
    return True, lines


def get_diff(repo_path: str, staged: bool = False) -> Tuple[bool, str]:
    """
    Returns the diff of the working tree.
    If staged=True, returns only staged diff.
    Limits to 4000 chars to keep AI prompt manageable.
    """
    cmd = ["git", "diff"]
    if staged:
        cmd.append("--staged")
    ok, diff = _run(cmd, cwd=repo_path)
    if not ok:
        return False, diff
    # Also grab untracked file names for context
    _, status = _run(["git", "status", "--short"], cwd=repo_path)
    combined = f"{status}\n\n{diff}"
    return True, combined[:4000]  # Trim for AI prompt


def stage_all(repo_path: str) -> Tuple[bool, str]:
    """Run git add . in the repo."""
    return _run(["git", "add", "."], cwd=repo_path)


def commit(repo_path: str, message: str) -> Tuple[bool, str]:
    """Run git commit -m <message>."""
    if not message.strip():
        return False, "Commit message cannot be empty."
    return _run(["git", "commit", "-m", message], cwd=repo_path)


def push(repo_path: str) -> Tuple[bool, str]:
    """Run git push."""
    return _run(["git", "push"], cwd=repo_path, timeout=60)


def stage_commit_push(repo_path: str, message: str) -> dict:
    """
    All-in-one: stage → commit → push.
    Returns a result dict with per-step status.
    """
    result = {
        "stage":  {"ok": False, "msg": ""},
        "commit": {"ok": False, "msg": ""},
        "push":   {"ok": False, "msg": ""},
        "success": False
    }

    # Step 1: Stage
    ok, msg = stage_all(repo_path)
    result["stage"] = {"ok": ok, "msg": msg}
    if not ok:
        return result

    # Step 2: Commit
    ok, msg = commit(repo_path, message)
    result["commit"] = {"ok": ok, "msg": msg}
    if not ok:
        # "nothing to commit" is a soft failure — don't abort
        if "nothing to commit" in msg.lower():
            result["commit"]["msg"] = "Nothing to commit — working tree clean."
        return result

    # Step 3: Push
    ok, msg = push(repo_path)
    result["push"] = {"ok": ok, "msg": msg}
    result["success"] = ok

    return result


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
        if action == "commit_and_push":
            message = args.get("message", "")
            use_ai = args.get("use_ai", False)
            
            # If no message and use_ai is true, generate one
            if not message and use_ai:
                from ai_commit import generate_commit_message
                ok, diff = get_diff(repo_path)
                if ok:
                    ai_result = generate_commit_message(diff, "")
                    if ai_result.get("success"):
                        message = ai_result.get("message", "Auto-commit")
                    else:
                        message = "Auto-commit"
                else:
                    message = "Auto-commit"
            
            if not message:
                message = "Auto-commit"
            
            result = stage_commit_push(repo_path, message)
            print(json.dumps({
                "success": result["success"],
                "message": f"Staged: {result['stage']['msg']} | Committed | Pushed" if result["success"] else result["push"]["msg"],
                "details": result
            }))
        else:
            print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
    except Exception as e:
        print(json.dumps({"success": False, "error": str(e)}))