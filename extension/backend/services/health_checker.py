"""
health_checker.py — Repository Health Check Diagnostic Service (Phase 1: Strictly Read-Only)

Performs comprehensive read-only diagnostics on a Git workspace without modifying
any files, configs, branches, staging, or remotes.

Independent module: does NOT import local_repo.py to prevent circular dependencies.
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Dict, Any, Tuple, List, Optional

CREATION_FLAGS = 0x08000000 if sys.platform == 'win32' else 0
DEFAULT_LARGE_FILE_THRESHOLD_MB = 50.0

RECOMMENDED_GITIGNORE_PATTERNS = [
    {
        "id": ".env",
        "label": ".env",
        "description": "Environment / secrets file",
        "regex": r"^\.?env(\.|$)"
    },
    {
        "id": "node_modules/",
        "label": "node_modules/",
        "description": "Node.js package dependencies",
        "regex": r"(^|\/)node_modules(\/|$)"
    },
    {
        "id": "__pycache__/",
        "label": "__pycache__/",
        "description": "Python bytecode cache",
        "regex": r"(^|\/)__pycache__(\/|$)|^\*\.py\[cod\]$"
    },
    {
        "id": "*.vsix",
        "label": "*.vsix",
        "description": "VS Code extension package build",
        "regex": r"\*\.vsix$"
    }
]


def _run_git(cmd: List[str], cwd: Optional[str] = None, timeout: int = 15) -> Tuple[bool, str, int]:
    """
    Run a git command safely.
    Returns (success, stdout/stderr, returncode).
    """
    try:
        env = os.environ.copy()
        env["GIT_TERMINAL_PROMPT"] = "0"
        env["GIT_MERGE_AUTOEDIT"] = "no"
        result = subprocess.run(
            cmd,
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=timeout,
            creationflags=CREATION_FLAGS,
            env=env
        )
        stdout = result.stdout.rstrip("\r\n") if result.stdout else ""
        stderr = result.stderr.rstrip("\r\n") if result.stderr else ""
        output = stdout if result.returncode == 0 else (stderr or stdout)
        return (result.returncode == 0, output, result.returncode)
    except FileNotFoundError:
        return (False, "Git is not installed or not in system PATH", -1)
    except subprocess.TimeoutExpired:
        return (False, f"Command timed out: {' '.join(cmd)}", -2)
    except Exception as e:
        return (False, str(e), -3)


def check_git_installation() -> Dict[str, Any]:
    """Detect whether Git is installed and parse version."""
    ok, output, code = _run_git(["git", "--version"])
    if not ok:
        return {
            "installed": False,
            "version": None,
            "status": "error",
            "message": "Git is not installed or not found in system PATH."
        }
    
    # Parse version e.g. "git version 2.52.0.windows.1"
    match = re.search(r"git version ([\w\.\-]+)", output, re.IGNORECASE)
    version = match.group(1) if match else output
    return {
        "installed": True,
        "version": version,
        "status": "healthy",
        "message": f"Git version {version} detected"
    }


def check_repository(repo_path: Optional[str], git_installed: bool) -> Dict[str, Any]:
    """Detect repository existence, validity, root, name, and .git presence."""
    if not repo_path or not os.path.exists(repo_path):
        return {
            "exists": False,
            "valid": False,
            "root": None,
            "name": None,
            "dotGitExists": False,
            "status": "error",
            "message": "Workspace path does not exist or is not specified."
        }
    
    dot_git_path = os.path.join(repo_path, ".git")
    dot_git_exists = os.path.exists(dot_git_path)
    
    if not git_installed:
        return {
            "exists": os.path.isdir(repo_path),
            "valid": False,
            "root": repo_path,
            "name": os.path.basename(os.path.abspath(repo_path)),
            "dotGitExists": dot_git_exists,
            "status": "error",
            "message": "Git is not installed; cannot verify repository status."
        }
    
    ok, output, _ = _run_git(["git", "rev-parse", "--is-inside-work-tree"], cwd=repo_path)
    is_valid = ok and output.strip() == "true"
    
    root_path = None
    if is_valid:
        ok_root, root_out, _ = _run_git(["git", "rev-parse", "--show-toplevel"], cwd=repo_path)
        if ok_root and root_out:
            root_path = root_out.strip()
    
    if not root_path:
        root_path = os.path.abspath(repo_path)
        
    repo_name = os.path.basename(root_path)
    
    if not is_valid:
        return {
            "exists": True,
            "valid": False,
            "root": root_path,
            "name": repo_name,
            "dotGitExists": dot_git_exists,
            "status": "error",
            "message": "Current workspace is not a valid Git repository."
        }
        
    return {
        "exists": True,
        "valid": True,
        "root": root_path,
        "name": repo_name,
        "dotGitExists": dot_git_exists,
        "status": "healthy",
        "message": f"Valid Git repository '{repo_name}'"
    }


def check_remote(repo_path: str, is_valid_repo: bool) -> Dict[str, Any]:
    """Detect remote origin, URL, GitHub hostname. Handled gracefully if no remote."""
    if not is_valid_repo:
        return {
            "hasRemote": False,
            "remoteName": None,
            "remoteUrl": None,
            "isGitHub": False,
            "connectivity": "Not applicable",
            "status": "not_applicable",
            "message": "Not a Git repository."
        }
    
    ok_remotes, remotes_out, _ = _run_git(["git", "remote"], cwd=repo_path)
    remotes = [r.strip() for r in remotes_out.splitlines() if r.strip()] if ok_remotes else []
    
    if not remotes:
        # Local-only repo is completely healthy, not an error!
        return {
            "hasRemote": False,
            "remoteName": None,
            "remoteUrl": None,
            "isGitHub": False,
            "connectivity": "None",
            "status": "healthy",
            "message": "No remote configured (local-only repository)."
        }
    
    remote_name = "origin" if "origin" in remotes else remotes[0]
    ok_url, url_out, _ = _run_git(["git", "remote", "get-url", remote_name], cwd=repo_path)
    if not ok_url or not url_out:
        ok_url, url_out, _ = _run_git(["git", "config", f"remote.{remote_name}.url"], cwd=repo_path)
        
    remote_url = url_out.strip() if ok_url and url_out else None
    
    is_github = False
    if remote_url:
        # Match https://github.com/..., git@github.com:..., ssh://git@github.com/...
        pattern = r"^(https?:\/\/)?([a-zA-Z0-9_\-\.]+@)?github\.com[:\/]"
        if re.search(pattern, remote_url, re.IGNORECASE):
            is_github = True
            
    return {
        "hasRemote": True,
        "remoteName": remote_name,
        "remoteUrl": remote_url,
        "isGitHub": is_github,
        "connectivity": "Not verified (safe read-only diagnostic)",
        "status": "healthy",
        "message": f"Remote '{remote_name}' configured ({'GitHub' if is_github else 'non-GitHub'})."
    }


def check_branch(repo_path: str, is_valid_repo: bool) -> Dict[str, Any]:
    """Detect branch, detached HEAD, commits existence, and upstream status."""
    if not is_valid_repo:
        return {
            "currentBranch": None,
            "isDetached": False,
            "hasCommits": False,
            "hasUpstream": False,
            "upstreamBranch": None,
            "ahead": None,
            "behind": None,
            "status": "not_applicable",
            "message": "Not a Git repository."
        }
    
    # Check if repo has any commits
    ok_head, _, _ = _run_git(["git", "rev-parse", "--verify", "HEAD"], cwd=repo_path)
    has_commits = ok_head
    
    if not has_commits:
        # Empty repository: safely read branch without crashing
        ok_br, br_out, _ = _run_git(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)
        current_branch = br_out.strip() if ok_br and br_out else "main"
        return {
            "currentBranch": current_branch,
            "isDetached": False,
            "hasCommits": False,
            "hasUpstream": False,
            "upstreamBranch": None,
            "ahead": None,
            "behind": None,
            "status": "healthy",
            "message": f"Empty repository (0 commits, default branch '{current_branch}')."
        }
    
    # Check detached HEAD
    ok_sym, _, _ = _run_git(["git", "symbolic-ref", "-q", "HEAD"], cwd=repo_path)
    is_detached = not ok_sym
    
    current_branch = None
    if is_detached:
        ok_short, short_hash, _ = _run_git(["git", "rev-parse", "--short", "HEAD"], cwd=repo_path)
        current_branch = f"HEAD (detached at {short_hash})" if ok_short else "HEAD (detached)"
        return {
            "currentBranch": current_branch,
            "isDetached": True,
            "hasCommits": True,
            "hasUpstream": False,
            "upstreamBranch": None,
            "ahead": None,
            "behind": None,
            "status": "warning",
            "message": f"Repository is in detached HEAD state ({current_branch})."
        }
    
    ok_br, br_out, _ = _run_git(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)
    current_branch = br_out.strip() if ok_br else "unknown"
    
    # Upstream detection
    ok_up, up_out, _ = _run_git(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd=repo_path)
    if not ok_up or not up_out:
        return {
            "currentBranch": current_branch,
            "isDetached": False,
            "hasCommits": True,
            "hasUpstream": False,
            "upstreamBranch": None,
            "ahead": None,
            "behind": None,
            "status": "warning",
            "message": f"Branch '{current_branch}' has no upstream tracking branch configured."
        }
    
    upstream_branch = up_out.strip()
    ok_cnt, cnt_out, _ = _run_git(["git", "rev-list", "--left-right", "--count", "HEAD...@{u}"], cwd=repo_path)
    ahead = 0
    behind = 0
    if ok_cnt and cnt_out:
        parts = cnt_out.split()
        if len(parts) == 2:
            try:
                ahead = int(parts[0])
                behind = int(parts[1])
            except ValueError:
                pass
    
    if ahead > 0 or behind > 0:
        details = []
        if ahead > 0:
            details.append(f"{ahead} ahead")
        if behind > 0:
            details.append(f"{behind} behind")
        return {
            "currentBranch": current_branch,
            "isDetached": False,
            "hasCommits": True,
            "hasUpstream": True,
            "upstreamBranch": upstream_branch,
            "ahead": ahead,
            "behind": behind,
            "status": "warning",
            "message": f"Branch '{current_branch}' is {', '.join(details)} '{upstream_branch}'."
        }
        
    return {
        "currentBranch": current_branch,
        "isDetached": False,
        "hasCommits": True,
        "hasUpstream": True,
        "upstreamBranch": upstream_branch,
        "ahead": 0,
        "behind": 0,
        "status": "healthy",
        "message": f"Branch '{current_branch}' is in sync with '{upstream_branch}'."
    }


def check_working_tree(repo_path: str, is_valid_repo: bool) -> Dict[str, Any]:
    """
    Detect working tree status: modified, staged, untracked, deleted, conflicted.
    Uses direct read-only Git commands without importing local_repo.py.
    """
    if not is_valid_repo:
        return {
            "clean": True,
            "modified": 0,
            "staged": 0,
            "untracked": 0,
            "deleted": 0,
            "conflicted": 0,
            "modifiedFiles": [],
            "stagedFiles": [],
            "untrackedFiles": [],
            "deletedFiles": [],
            "conflictedFiles": [],
            "status": "not_applicable",
            "message": "Not a Git repository."
        }
    
    ok_status, status_out, _ = _run_git(["git", "status", "--porcelain=v1"], cwd=repo_path)
    if not ok_status:
        return {
            "clean": False,
            "modified": 0,
            "staged": 0,
            "untracked": 0,
            "deleted": 0,
            "conflicted": 0,
            "modifiedFiles": [],
            "stagedFiles": [],
            "untrackedFiles": [],
            "deletedFiles": [],
            "conflictedFiles": [],
            "status": "error",
            "message": f"Failed to retrieve working tree status: {status_out}"
        }
    
    modified_files = []
    staged_files = []
    untracked_files = []
    deleted_files = []
    conflicted_files = []
    
    # Conflict indicators in porcelain v1
    conflict_codes = {"DD", "AU", "UD", "UA", "DU", "AA", "UU"}
    
    for line in status_out.splitlines():
        if len(line) < 3:
            continue
        code = line[0:2]
        file_path = line[3:].strip()
        # Handle rename format "orig -> new"
        if " -> " in file_path:
            file_path = file_path.split(" -> ")[-1].strip()
            
        x = code[0]
        y = code[1]
        
        if code in conflict_codes or x == 'U' or y == 'U':
            conflicted_files.append(file_path)
            continue
            
        if code == "??":
            untracked_files.append(file_path)
            continue
            
        if x in ("M", "A", "D", "R", "C"):
            staged_files.append(file_path)
            
        if y == "M":
            modified_files.append(file_path)
            
        if x == "D" or y == "D":
            deleted_files.append(file_path)
            
    # Direct conflict check via git diff filter U and MERGE_HEAD
    ok_diff, diff_out, _ = _run_git(["git", "diff", "--name-only", "--diff-filter=U"], cwd=repo_path)
    if ok_diff and diff_out:
        for f in diff_out.splitlines():
            f_clean = f.strip()
            if f_clean and f_clean not in conflicted_files:
                conflicted_files.append(f_clean)
                
    merge_head_exists = os.path.exists(os.path.join(repo_path, ".git", "MERGE_HEAD"))
    
    total_changed = len(modified_files) + len(staged_files) + len(untracked_files) + len(deleted_files) + len(conflicted_files)
    is_clean = total_changed == 0 and not merge_head_exists
    
    if len(conflicted_files) > 0 or merge_head_exists:
        return {
            "clean": False,
            "modified": len(modified_files),
            "staged": len(staged_files),
            "untracked": len(untracked_files),
            "deleted": len(deleted_files),
            "conflicted": len(conflicted_files),
            "modifiedFiles": modified_files[:20],
            "stagedFiles": staged_files[:20],
            "untrackedFiles": untracked_files[:20],
            "deletedFiles": deleted_files[:20],
            "conflictedFiles": conflicted_files[:20],
            "status": "error",
            "message": "Repository has unresolved merge conflicts"
        }
        
    if not is_clean:
        parts = []
        if modified_files:
            parts.append(f"{len(modified_files)} modified")
        if staged_files:
            parts.append(f"{len(staged_files)} staged")
        if untracked_files:
            parts.append(f"{len(untracked_files)} untracked")
        if deleted_files:
            parts.append(f"{len(deleted_files)} deleted")
            
        return {
            "clean": False,
            "modified": len(modified_files),
            "staged": len(staged_files),
            "untracked": len(untracked_files),
            "deleted": len(deleted_files),
            "conflicted": 0,
            "modifiedFiles": modified_files[:20],
            "stagedFiles": staged_files[:20],
            "untrackedFiles": untracked_files[:20],
            "deletedFiles": deleted_files[:20],
            "conflictedFiles": [],
            "status": "warning",
            "message": f"Working tree has {', '.join(parts)} ({total_changed} total changes)."
        }
        
    return {
        "clean": True,
        "modified": 0,
        "staged": 0,
        "untracked": 0,
        "deleted": 0,
        "conflicted": 0,
        "modifiedFiles": [],
        "stagedFiles": [],
        "untrackedFiles": [],
        "deletedFiles": [],
        "conflictedFiles": [],
        "status": "healthy",
        "message": "Working tree is clean."
    }


def check_identity(repo_path: str, is_valid_repo: bool) -> Dict[str, Any]:
    """Read Git user.name and user.email strictly without modifying."""
    if not is_valid_repo:
        return {
            "configured": False,
            "userName": None,
            "userEmail": None,
            "status": "not_applicable",
            "message": "Not a Git repository."
        }
    
    ok_name, name_out, _ = _run_git(["git", "config", "user.name"], cwd=repo_path)
    ok_email, email_out, _ = _run_git(["git", "config", "user.email"], cwd=repo_path)
    
    user_name = name_out.strip() if ok_name and name_out else None
    user_email = email_out.strip() if ok_email and email_out else None
    
    is_configured = bool(user_name and user_email)
    
    if not is_configured:
        missing = []
        if not user_name:
            missing.append("user.name")
        if not user_email:
            missing.append("user.email")
        return {
            "configured": False,
            "userName": user_name,
            "userEmail": user_email,
            "status": "warning",
            "message": f"Git identity incomplete ({', '.join(missing)} not set)."
        }
        
    return {
        "configured": True,
        "userName": user_name,
        "userEmail": user_email,
        "status": "healthy",
        "message": f"Configured as {user_name} <{user_email}>."
    }


def check_gitignore(repo_path: str, is_valid_repo: bool) -> Dict[str, Any]:
    """
    Detect whether .gitignore exists and check presence of common recommended patterns.
    Does NOT modify .gitignore. Distinguishes between file exists, pattern exists, pattern missing.
    """
    if not is_valid_repo or not repo_path:
        return {
            "exists": False,
            "patternsDetected": [],
            "patternsMissing": [p["label"] for p in RECOMMENDED_GITIGNORE_PATTERNS],
            "status": "not_applicable",
            "message": "Not a Git repository."
        }
    
    gitignore_path = os.path.join(repo_path, ".gitignore")
    if not os.path.exists(gitignore_path):
        return {
            "exists": False,
            "patternsDetected": [],
            "patternsMissing": [p["label"] for p in RECOMMENDED_GITIGNORE_PATTERNS],
            "status": "warning",
            "message": "No .gitignore file detected in repository root."
        }
    
    try:
        with open(gitignore_path, "r", encoding="utf-8", errors="replace") as f:
            raw_lines = f.read().splitlines()
    except Exception as e:
        return {
            "exists": True,
            "patternsDetected": [],
            "patternsMissing": [p["label"] for p in RECOMMENDED_GITIGNORE_PATTERNS],
            "status": "warning",
            "message": f"Could not read .gitignore: {str(e)}"
        }
    
    cleaned_lines = [l.strip() for l in raw_lines if l.strip() and not l.strip().startswith("#")]
    
    detected = []
    missing = []
    
    for pattern in RECOMMENDED_GITIGNORE_PATTERNS:
        pat_id = pattern["id"]
        pat_regex = pattern["regex"]
        found = False
        for line in cleaned_lines:
            # Check exact match or regex
            if line == pat_id or line == pat_id.rstrip("/") or re.search(pat_regex, line, re.IGNORECASE):
                found = True
                break
        if found:
            detected.append(pattern["label"])
        else:
            missing.append(pattern["label"])
            
    if missing:
        return {
            "exists": True,
            "patternsDetected": detected,
            "patternsMissing": missing,
            "status": "warning",
            "message": f"Recommended pattern missing: {', '.join(missing)}."
        }
        
    return {
        "exists": True,
        "patternsDetected": detected,
        "patternsMissing": [],
        "status": "healthy",
        "message": ".gitignore exists with all common recommended patterns."
    }


def check_tracked_large_files(repo_path: str, is_valid_repo: bool, threshold_mb: float = DEFAULT_LARGE_FILE_THRESHOLD_MB) -> Dict[str, Any]:
    """
    Scan TRACKED files only using git ls-files.
    Does NOT scan untracked files on disk (postponed to Phase 2) to avoid hanging on heavy folders.
    Threshold conversion: 1024 * 1024 bytes. Safe fallback to 50 MB if invalid.
    """
    try:
        t_val = float(threshold_mb)
        if t_val <= 0:
            t_val = DEFAULT_LARGE_FILE_THRESHOLD_MB
    except (ValueError, TypeError):
        t_val = DEFAULT_LARGE_FILE_THRESHOLD_MB
        
    threshold_bytes = int(t_val * 1024 * 1024)
    
    if not is_valid_repo or not repo_path:
        return {
            "thresholdMb": t_val,
            "thresholdBytes": threshold_bytes,
            "detected": [],
            "count": 0,
            "status": "not_applicable",
            "message": "Not a Git repository."
        }
    
    ok, output, _ = _run_git(["git", "ls-files"], cwd=repo_path)
    if not ok:
        return {
            "thresholdMb": t_val,
            "thresholdBytes": threshold_bytes,
            "detected": [],
            "count": 0,
            "status": "warning",
            "message": "Could not list tracked files."
        }
        
    large_files = []
    lines = output.splitlines()
    for rel_path in lines:
        rel_clean = rel_path.strip()
        if not rel_clean:
            continue
        full_path = os.path.join(repo_path, rel_clean)
        try:
            if os.path.isfile(full_path):
                size = os.path.getsize(full_path)
                if size >= threshold_bytes:
                    size_mb = size / (1024 * 1024)
                    large_files.append({
                        "path": rel_clean,
                        "sizeBytes": size,
                        "sizeFormatted": f"{size_mb:.1f} MB",
                        "tracked": True
                    })
        except OSError:
            # Skip if permission denied or transient file
            continue
            
    if large_files:
        return {
            "thresholdMb": t_val,
            "thresholdBytes": threshold_bytes,
            "detected": large_files,
            "count": len(large_files),
            "status": "warning",
            "message": f"Found {len(large_files)} tracked file(s) exceeding {t_val:.0f} MB."
        }
        
    return {
        "thresholdMb": t_val,
        "thresholdBytes": threshold_bytes,
        "detected": [],
        "count": 0,
        "status": "healthy",
        "message": f"No tracked files exceed {t_val:.0f} MB."
    }


def compute_overall_status(
    git_res: Dict[str, Any],
    repo_res: Dict[str, Any],
    remote_res: Dict[str, Any],
    branch_res: Dict[str, Any],
    tree_res: Dict[str, Any],
    identity_res: Dict[str, Any],
    gitignore_res: Dict[str, Any],
    large_files_res: Dict[str, Any]
) -> Tuple[str, str, List[Dict[str, Any]]]:
    """
    Determine overall status: HEALTHY, NEEDS ATTENTION, ERROR.
    Rules:
      - ERROR: Git not installed, invalid repository, or merge conflicts present.
      - NEEDS ATTENTION: Any warning present.
      - HEALTHY: Clean, no errors or warnings.
    """
    issues: List[Dict[str, Any]] = []
    
    # 1. Git Installation
    if git_res["status"] == "error":
        issues.append({
            "category": "Git Detection",
            "severity": "error",
            "title": "Git Not Found",
            "description": git_res["message"],
            "whyItMatters": "GitHub Automator requires Git to perform version control diagnostics and repository operations."
        })
        
    # 2. Repository
    if repo_res["status"] == "error":
        issues.append({
            "category": "Repository",
            "severity": "error",
            "title": "Invalid Repository",
            "description": repo_res["message"],
            "whyItMatters": "The selected workspace is not recognized as a Git repository."
        })
        
    # 3. Merge conflicts / Working tree error
    if tree_res["status"] == "error":
        issues.append({
            "category": "Working Tree",
            "severity": "error",
            "title": "Unresolved Merge Conflicts",
            "description": "Repository has unresolved merge conflicts in working tree.",
            "whyItMatters": "Unresolved merge conflicts halt Git operations. Conflicts must be resolved before committing or switching branches."
        })
    elif tree_res["status"] == "warning":
        issues.append({
            "category": "Working Tree",
            "severity": "warning",
            "title": "Uncommitted Changes",
            "description": tree_res["message"],
            "whyItMatters": "Uncommitted changes can be lost or conflict with branch operations."
        })
        
    # 4. Branch
    if branch_res.get("isDetached"):
        issues.append({
            "category": "Branch",
            "severity": "warning",
            "title": "Detached HEAD State",
            "description": branch_res["message"],
            "whyItMatters": "Commits made in detached HEAD state do not belong to any branch and can become untracked."
        })
    elif branch_res["status"] == "warning":
        issues.append({
            "category": "Branch",
            "severity": "warning",
            "title": "Branch Not in Sync or No Upstream",
            "description": branch_res["message"],
            "whyItMatters": "Without an upstream or when out of sync, push and pull operations require manual configuration or syncing."
        })
        
    # 5. Git Identity
    if identity_res["status"] == "warning":
        issues.append({
            "category": "Git Identity",
            "severity": "warning",
            "title": "Incomplete Git Identity",
            "description": identity_res["message"],
            "whyItMatters": "Git requires author name and email for every commit. Missing identity may cause commits to fail or use system defaults."
        })
        
    # 6. Gitignore
    if gitignore_res["status"] == "warning":
        issues.append({
            "category": "Gitignore",
            "severity": "warning",
            "title": "Recommended .gitignore Pattern Missing",
            "description": gitignore_res["message"],
            "whyItMatters": "Ignoring secrets (.env) and dependency caches prevents accidental commits of sensitive data and bloated repo sizes."
        })
        
    # 7. Large Files
    if large_files_res["status"] == "warning":
        issues.append({
            "category": "Large Files",
            "severity": "warning",
            "title": "Tracked Large Files Detected",
            "description": large_files_res["message"],
            "whyItMatters": "GitHub rejects pushes containing files > 100 MB and warns for files > 50 MB. Tracked large files bloat repository history."
        })
        
    # Determine overall status
    has_error = any(i["severity"] == "error" for i in issues)
    has_warning = any(i["severity"] == "warning" for i in issues)
    
    if has_error:
        overall_status = "ERROR"
        summary = f"Repository health check encountered {sum(1 for i in issues if i['severity'] == 'error')} error(s)."
    elif has_warning:
        overall_status = "NEEDS ATTENTION"
        summary = f"Repository is functional but has {len(issues)} item(s) that require attention."
    else:
        overall_status = "HEALTHY"
        summary = "All checks passed. Repository is healthy and properly configured."
        
    return overall_status, summary, issues


def check_repository_health(repo_path: Optional[str], threshold_mb: float = DEFAULT_LARGE_FILE_THRESHOLD_MB) -> Dict[str, Any]:
    """
    Main entry point for Repository Health Check Phase 1 (Strictly Read-Only).
    """
    start_time = time.time()
    scanned_at = datetime.now(timezone.utc).isoformat()
    
    # 1. Git Installation
    git_res = check_git_installation()
    git_installed = git_res["installed"]
    
    # 2. Repository
    repo_res = check_repository(repo_path, git_installed)
    is_valid_repo = repo_res["valid"]
    resolved_path = repo_res["root"] if is_valid_repo else repo_path
    
    # 3. Remote
    remote_res = check_remote(resolved_path, is_valid_repo) if resolved_path else {
        "hasRemote": False, "remoteName": None, "remoteUrl": None, "isGitHub": False,
        "connectivity": "Not applicable", "status": "not_applicable", "message": "No repository specified."
    }
    
    # 4. Branch
    branch_res = check_branch(resolved_path, is_valid_repo) if resolved_path else {
        "currentBranch": None, "isDetached": False, "hasCommits": False, "hasUpstream": False,
        "upstreamBranch": None, "ahead": None, "behind": None, "status": "not_applicable", "message": "No repository specified."
    }
    
    # 5. Working Tree
    tree_res = check_working_tree(resolved_path, is_valid_repo) if resolved_path else {
        "clean": True, "modified": 0, "staged": 0, "untracked": 0, "deleted": 0, "conflicted": 0,
        "modifiedFiles": [], "stagedFiles": [], "untrackedFiles": [], "deletedFiles": [], "conflictedFiles": [],
        "status": "not_applicable", "message": "No repository specified."
    }
    
    # 6. Git Identity
    identity_res = check_identity(resolved_path, is_valid_repo) if resolved_path else {
        "configured": False, "userName": None, "userEmail": None, "status": "not_applicable", "message": "No repository specified."
    }
    
    # 7. Gitignore
    gitignore_res = check_gitignore(resolved_path, is_valid_repo) if resolved_path else {
        "exists": False, "patternsDetected": [], "patternsMissing": [], "status": "not_applicable", "message": "No repository specified."
    }
    
    # 8. Tracked Large Files
    large_files_res = check_tracked_large_files(resolved_path, is_valid_repo, threshold_mb) if resolved_path else {
        "thresholdMb": threshold_mb, "thresholdBytes": int(threshold_mb * 1024 * 1024), "detected": [], "count": 0,
        "status": "not_applicable", "message": "No repository specified."
    }
    
    # Overall Status & Issues
    overall_status, summary, issues = compute_overall_status(
        git_res, repo_res, remote_res, branch_res, tree_res, identity_res, gitignore_res, large_files_res
    )
    
    duration_ms = int((time.time() - start_time) * 1000)
    
    return {
        "success": True,
        "scannedAt": scanned_at,
        "scanDurationMs": duration_ms,
        "overallStatus": overall_status,
        "summary": summary,
        "issues": issues,
        "git": git_res,
        "repository": repo_res,
        "remote": remote_res,
        "branch": branch_res,
        "workingTree": tree_res,
        "identity": identity_res,
        "gitignore": gitignore_res,
        "largeFiles": large_files_res
    }


if __name__ == "__main__":
    try:
        raw_input = sys.stdin.read()
        args = json.loads(raw_input) if raw_input.strip() else {}
    except Exception:
        args = {}
        
    repo_path = args.get("repo_path")
    threshold_mb = args.get("threshold_mb", DEFAULT_LARGE_FILE_THRESHOLD_MB)
    
    result = check_repository_health(repo_path, threshold_mb)
    print(json.dumps(result))
