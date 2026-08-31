"""
repository_guard.py — Pre-flight Repository Guard Validation Service (Phase 2)

Performs deterministic rule-based security and safety checks immediately before
Git Commit and Push operations.

Checks:
  1. Literal Secret Detection (API keys, tokens, private keys, passwords, credentials)
  2. Sensitive Filename Detection (.env, credentials, pem, keys)
  3. Large File Protection (threshold default 50 MB)
  4. Git State Protection (merge conflicts, detached HEAD, push upstream/target)

Never exposes detected secret values in results, logs, or stdout.
Independent module: does NOT import local_repo.py.
"""

import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timezone
from typing import Dict, Any, Tuple, List, Optional, Set

CREATION_FLAGS = 0x08000000 if sys.platform == 'win32' else 0
DEFAULT_LARGE_FILE_THRESHOLD_MB = 50.0

# Folders to completely skip during untracked / disk inspection
EXCLUDED_SCAN_DIRS = {
    ".git", "node_modules", "venv", ".venv", "env", ".env_dir",
    "__pycache__", "build", "dist", "out", "target", "bin", "obj",
    ".idea", ".vscode", "coverage", ".pytest_cache", ".mypy_cache"
}

# Sensitive filename patterns (generate WARNING unless actual secret is inside)
SENSITIVE_FILENAME_PATTERNS = [
    (r"^\.env(\.(local|production|staging|test|development))?$", "Environment / Secrets Configuration File"),
    (r"^credentials\.(json|ya?ml)$", "Credentials Configuration File"),
    (r"^id_(rsa|dsa|ecdsa|ed25519)$", "SSH Private Key File"),
    (r"\.(pem|key|pkcs12|pfx|p12)$", "Certificate / Private Key File"),
]

# Patterns explicitly exempted from sensitive filename warnings (safe templates)
EXEMPTED_FILENAME_PATTERNS = [
    r"^\.env\.(example|template|sample|dist)$",
    r"^example\.env$",
]

# Obvious placeholder / dummy values to ignore (case-insensitive)
PLACEHOLDER_SUBSTRINGS = [
    "your_api_key_here", "your_token_here", "your-api-key", "your-token",
    "<your-token>", "<your_api_key>", "<your-api-key>", "<api_key>",
    "example_password", "changeme", "replace_me", "dummy_secret",
    "placeholder", "my_secret_key", "fake_token", "sample_key",
    "test_token", "dummy", "xxx", "..."
]

# Non-literal expressions (environment/config references) to explicitly ignore
ENV_CONFIG_EXCLUSION_REGEX = re.compile(
    r"(os\.getenv\s*\(|os\.environ(\.get|\s*\[)|process\.env\.|import\.meta\.env\.|"
    r"config\.(get|apiKey|token|secret)|settings\.(API_KEY|SECRET)|"
    r"\$\{[A-Za-z0-9_]+\}|\$[A-Za-z0-9_]+)",
    re.IGNORECASE
)

# Rule-based secret detectors
# Each detector has: (id, category, title, regex, description, reason)
SECRET_RULES = [
    # 1. GitHub Tokens
    {
        "id": "github_token_classic",
        "category": "Secret Detection",
        "title": "GitHub Personal Access Token Detected",
        "regex": re.compile(r"\bghp_[A-Za-z0-9]{36}\b"),
        "description": "Detected a GitHub Personal Access Token (classic pattern: ghp_...).",
        "reason": "Committing GitHub access tokens grants unauthorized access to repositories."
    },
    {
        "id": "github_token_fine_grained",
        "category": "Secret Detection",
        "title": "GitHub Fine-Grained Token Detected",
        "regex": re.compile(r"\bgithub_pat_[A-Za-z0-9_]{82}\b"),
        "description": "Detected a GitHub fine-grained personal access token.",
        "reason": "Committing GitHub tokens compromises repository and organization security."
    },
    {
        "id": "github_token_oauth",
        "category": "Secret Detection",
        "title": "GitHub OAuth / App Token Detected",
        "regex": re.compile(r"\b(gho|ghu|ghs|ghr)_[A-Za-z0-9_]{36,76}\b"),
        "description": "Detected a GitHub OAuth, User-to-Server, Server-to-Server, or Refresh Token.",
        "reason": "Committing GitHub authentication tokens exposes repository permissions."
    },

    # 2. AWS Credentials
    {
        "id": "aws_access_key_id",
        "category": "Secret Detection",
        "title": "AWS Access Key ID Detected",
        "regex": re.compile(r"\b(AKIA|ASIA)[0-9A-Z]{16}\b"),
        "description": "Detected an AWS Access Key ID (AKIA/ASIA pattern).",
        "reason": "Hardcoded AWS keys expose cloud resources to unauthorized usage and billing."
    },
    {
        "id": "aws_secret_key",
        "category": "Secret Detection",
        "title": "AWS Secret Access Key Assignment Detected",
        "regex": re.compile(r"(?i)\b(aws_secret_access_key|aws_secret_key)\s*[:=]\s*['\"]([A-Za-z0-9/+=]{40})['\"]"),
        "description": "Detected an AWS Secret Access Key literal assignment.",
        "reason": "Committing AWS secret keys compromises AWS infrastructure security."
    },

    # 3. Private Keys
    {
        "id": "private_key_header",
        "category": "Secret Detection",
        "title": "Private Cryptographic Key Detected",
        "regex": re.compile(r"-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----"),
        "description": "Detected the beginning of an unencrypted private cryptographic key block.",
        "reason": "Private keys must never be committed to source control."
    },

    # 4. Google API Keys
    {
        "id": "google_api_key",
        "category": "Secret Detection",
        "title": "Google Cloud / Gemini API Key Detected",
        "regex": re.compile(r"\bAIza[0-9A-Za-z\-_]{35}\b"),
        "description": "Detected a Google Cloud / Firebase / Gemini API key (AIza pattern).",
        "reason": "Hardcoded Google API keys can be scraped and abused."
    },

    # 5. Slack Tokens
    {
        "id": "slack_token",
        "category": "Secret Detection",
        "title": "Slack Token Detected",
        "regex": re.compile(r"\bxox[baprs]-[0-9a-zA-Z]{10,48}\b"),
        "description": "Detected a Slack API bot, user, or app token (xox pattern).",
        "reason": "Hardcoded Slack tokens can lead to unauthorized workspace access."
    },

    # 6. Generic API / Secret Key Literal Assignments
    {
        "id": "generic_api_key_assignment",
        "category": "Secret Detection",
        "title": "Hardcoded API Key / Secret Key Assignment Detected",
        "regex": re.compile(r"(?i)\b(api_key|apikey|secret_key|secretkey|access_token|accesstoken|auth_token)\s*[:=]\s*['\"]([A-Za-z0-9_\-\.]{16,})['\"]"),
        "description": "Detected a literal API key or access token assignment with a high-entropy value.",
        "reason": "Hardcoding API secrets in code files risks credential leakage on push."
    },

    # 7. Password / Client Secret Assignments
    {
        "id": "password_assignment",
        "category": "Secret Detection",
        "title": "Hardcoded Password / Client Secret Detected",
        "regex": re.compile(r"(?i)\b(password|passwd|client_secret)\s*[:=]\s*['\"]([^'\"\r\n]{8,})['\"]"),
        "description": "Detected a literal password or client secret assignment.",
        "reason": "Passwords should be stored in secure vaults or environment variables, not in code."
    }
]


def _run_git(cmd: List[str], cwd: Optional[str] = None, timeout: int = 15) -> Tuple[bool, str, int]:
    """Run a git command safely and return (success, stdout_or_stderr, returncode)."""
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


def is_placeholder_or_dummy(value: str) -> bool:
    """Check if matched text is an obvious placeholder, example, or dummy string."""
    val_lower = value.lower()
    for placeholder in PLACEHOLDER_SUBSTRINGS:
        if placeholder in val_lower:
            return True
    # Strip common quotes
    clean_val = value.strip("'\"`")
    # All same characters (e.g. "xxxxxx", "000000")
    if len(set(clean_val)) <= 1:
        return True
    return False


def is_environment_or_config_reference(line: str) -> bool:
    """Check if the line is referencing an environment variable or config object rather than a literal secret."""
    return bool(ENV_CONFIG_EXCLUSION_REGEX.search(line))


def scan_line_for_secrets(line: str, file_rel_path: str, line_num: Optional[int]) -> List[Dict[str, Any]]:
    """
    Scan a single line of text for literal secrets.
    CRITICAL: Never includes the secret value in the returned issue dict!
    """
    detected_issues = []
    
    # Fast check: skip lines referencing environment variables or config
    if is_environment_or_config_reference(line):
        return detected_issues

    for rule in SECRET_RULES:
        match = rule["regex"].search(line)
        if not match:
            continue

        # Extract matched secret candidate
        matched_str = match.group(2) if match.lastindex and match.lastindex >= 2 else match.group(0)
        
        # Verify it is not a placeholder or dummy value
        if is_placeholder_or_dummy(matched_str):
            continue

        # For generic assignments or passwords, ignore short or obviously non-secret terms
        rule_id = rule["id"]
        if rule_id in ("generic_api_key_assignment", "password_assignment"):
            clean_str = matched_str.strip("'\"` ")
            if len(clean_str) < 8 or clean_str.lower() in ("true", "false", "null", "undefined", "none", "password", "secret"):
                continue

        # Create structured issue without exposing the secret
        issue_id = f"{rule_id}_{file_rel_path}_{line_num or 0}"
        detected_issues.append({
            "id": issue_id,
            "severity": "block",
            "category": rule["category"],
            "title": rule["title"],
            "file": file_rel_path,
            "line": line_num,
            "description": rule["description"],
            "reason": rule["reason"]
        })
        # One secret detection per line is sufficient
        break

    return detected_issues


def parse_diff_and_scan(diff_text: str) -> Tuple[List[Dict[str, Any]], Set[str]]:
    """
    Parse a unified git diff, scan only newly added lines ('+'),
    and track line numbers and touched files.
    """
    issues = []
    touched_files: Set[str] = set()
    current_file: Optional[str] = None
    current_new_line = 0

    lines = diff_text.splitlines()
    for line in lines:
        if line.startswith("diff --git "):
            # Extract destination file path
            parts = line.split(" ")
            if len(parts) >= 4:
                b_path = parts[3]
                if b_path.startswith("b/"):
                    current_file = b_path[2:]
                else:
                    current_file = b_path
                touched_files.add(current_file)
            continue

        if line.startswith("+++ "):
            # Updated file header
            target = line[4:].strip()
            if target.startswith("b/"):
                current_file = target[2:]
            elif target != "/dev/null":
                current_file = target
            if current_file:
                touched_files.add(current_file)
            continue

        if line.startswith("@@ "):
            # Unified diff hunk header: @@ -a,b +c,d @@
            match = re.search(r"\+(\d+)(?:,\d+)?\s*@@", line)
            if match:
                current_new_line = int(match.group(1))
            continue

        if line.startswith("+") and not line.startswith("+++"):
            content = line[1:]
            if current_file:
                found = scan_line_for_secrets(content, current_file, current_new_line)
                issues.extend(found)
            current_new_line += 1
        elif not line.startswith("-"):
            # Context line
            current_new_line += 1

    return issues, touched_files


def is_sensitive_filename(file_rel_path: str) -> Optional[str]:
    """Check if the filename matches sensitive patterns (like .env, credentials.json, .pem)."""
    norm_path = file_rel_path.replace("\\", "/")
    basename = os.path.basename(norm_path)

    # Check if explicitly exempted (e.g. .env.example)
    for pattern in EXEMPTED_FILENAME_PATTERNS:
        if re.search(pattern, basename, re.IGNORECASE):
            return None

    for pattern, desc in SENSITIVE_FILENAME_PATTERNS:
        if re.search(pattern, basename, re.IGNORECASE):
            return desc
    return None


def should_skip_untracked_path(rel_path: str) -> bool:
    """Determine if an untracked file is inside an excluded directory or should be ignored."""
    norm = rel_path.replace("\\", "/").strip("/")
    parts = norm.split("/")
    for part in parts:
        if part in EXCLUDED_SCAN_DIRS:
            return True
    return False


def scan_untracked_file(repo_path: str, rel_path: str) -> Tuple[List[Dict[str, Any]], Optional[int]]:
    """
    Read and scan an untracked file directly from disk.
    Returns (secret_issues, file_size_in_bytes).
    Skips binary or huge files safely.
    """
    full_path = os.path.join(repo_path, rel_path)
    issues = []
    file_size = None

    try:
        if not os.path.isfile(full_path):
            return issues, None
        
        file_size = os.path.getsize(full_path)
        # Skip content scan for extremely large files (> 20 MB) to keep pre-commit responsive
        if file_size > 20 * 1024 * 1024:
            return issues, file_size

        # Read line by line with utf-8 fallback
        with open(full_path, "r", encoding="utf-8", errors="ignore") as f:
            for line_idx, line in enumerate(f, start=1):
                if len(line) > 2000:
                    continue
                found = scan_line_for_secrets(line, rel_path, line_idx)
                issues.extend(found)
                if len(issues) >= 10:
                    break
    except (OSError, UnicodeDecodeError):
        pass

    return issues, file_size


def check_git_state(repo_path: str, operation: str = "commit", remote: Optional[str] = None, branch: Optional[str] = None) -> Dict[str, Any]:
    """
    Evaluate repository Git state:
      - Repository validity (inside work tree)
      - Merge conflicts (BLOCK)
      - Detached HEAD (WARNING)
      - Push remote & upstream availability
    """
    # 1. Repository validity
    ok_tree, _, _ = _run_git(["git", "rev-parse", "--is-inside-work-tree"], cwd=repo_path)
    if not ok_tree:
        return {
            "valid": False,
            "status": "error",
            "blockingIssues": [{
                "id": "git_invalid_repo",
                "severity": "block",
                "category": "Git State",
                "title": "Not a Git Repository",
                "file": None,
                "line": None,
                "description": f"The directory '{repo_path}' is not a valid Git repository.",
                "reason": "Git operations cannot be performed outside of a Git repository."
            }],
            "warnings": [],
            "info": []
        }

    blocking_issues = []
    warnings = []
    info = []

    # 2. Merge conflict check
    ok_diff_u, diff_u, _ = _run_git(["git", "diff", "--name-only", "--diff-filter=U"], cwd=repo_path)
    conflicted_files = [f.strip() for f in diff_u.splitlines() if f.strip()] if ok_diff_u and diff_u else []
    merge_head = os.path.exists(os.path.join(repo_path, ".git", "MERGE_HEAD"))

    if conflicted_files or merge_head:
        file_summary = ", ".join(conflicted_files[:3]) if conflicted_files else "MERGE_HEAD present"
        blocking_issues.append({
            "id": "git_merge_conflict",
            "severity": "block",
            "category": "Git State",
            "title": "Unresolved Merge Conflicts Detected",
            "file": conflicted_files[0] if conflicted_files else None,
            "line": None,
            "description": f"The repository has unresolved merge conflicts ({file_summary}).",
            "reason": "Committing or pushing with active merge conflicts corrupts project history."
        })

    # 3. Branch & Detached HEAD check
    ok_sym, _, _ = _run_git(["git", "symbolic-ref", "-q", "HEAD"], cwd=repo_path)
    is_detached = not ok_sym
    current_branch = None
    if is_detached:
        ok_hash, hash_out, _ = _run_git(["git", "rev-parse", "--short", "HEAD"], cwd=repo_path)
        current_branch = f"HEAD (detached at {hash_out.strip()})" if ok_hash else "HEAD (detached)"
        warnings.append({
            "id": "git_detached_head",
            "severity": "warning",
            "category": "Git State",
            "title": "Detached HEAD State",
            "file": None,
            "line": None,
            "description": f"The repository is currently in a detached HEAD state ({current_branch}).",
            "reason": "Commits in detached HEAD will not belong to any branch and may be lost."
        })
    else:
        ok_br, br_out, _ = _run_git(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)
        current_branch = br_out.strip() if ok_br else "main"

    # 4. Push-specific upstream / remote check
    if operation == "push":
        ok_remotes, rem_out, _ = _run_git(["git", "remote"], cwd=repo_path)
        configured_remotes = [r.strip() for r in rem_out.splitlines() if r.strip()] if ok_remotes and rem_out else []
        
        target_remote = remote or ("origin" if "origin" in configured_remotes else (configured_remotes[0] if configured_remotes else None))
        target_branch = branch or current_branch

        if not configured_remotes or not target_remote:
            blocking_issues.append({
                "id": "git_push_no_remote",
                "severity": "block",
                "category": "Git State",
                "title": "No Remote Configured for Push",
                "file": None,
                "line": None,
                "description": "No Git remote is configured to push to.",
                "reason": "Push requires a remote destination URL configured in Git."
            })
        else:
            # Check upstream tracking branch
            ok_up, up_out, _ = _run_git(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd=repo_path)
            if not ok_up or not up_out:
                # Check if remote branch ref exists on target remote
                ok_ref, _, _ = _run_git(["git", "rev-parse", "--verify", f"{target_remote}/{target_branch}"], cwd=repo_path)
                if not ok_ref:
                    warnings.append({
                        "id": "git_push_no_upstream",
                        "severity": "warning",
                        "category": "Git State",
                        "title": f"No Upstream Tracking Branch Configured for '{target_branch}'",
                        "file": None,
                        "line": None,
                        "description": f"Branch '{target_branch}' has no upstream tracking branch on '{target_remote}'. Git Automator will set upstream on push.",
                        "reason": "Initial push to a new remote branch will publish all local commits."
                    })

    return {
        "valid": True,
        "currentBranch": current_branch,
        "isDetached": is_detached,
        "conflicted": bool(conflicted_files or merge_head),
        "blockingIssues": blocking_issues,
        "warnings": warnings,
        "info": info
    }


def determine_commit_set(repo_path: str) -> Dict[str, Any]:
    """
    Determine the ACTUAL set of files and contents about to enter the commit.
    Because GitHub Automator's commit_manager.py runs `stage_all` (`git add .`),
    the actual commit set consists of:
      1. Already staged changes (`git diff --cached`)
      2. Unstaged tracked modifications (`git diff`)
      3. Untracked files that git add . will stage (`git status --porcelain=v1`)
    """
    staged_diff = ""
    unstaged_diff = ""
    untracked_files: List[str] = []

    ok_staged, out_staged, _ = _run_git(["git", "diff", "--cached"], cwd=repo_path)
    if ok_staged:
        staged_diff = out_staged

    ok_unstaged, out_unstaged, _ = _run_git(["git", "diff"], cwd=repo_path)
    if ok_unstaged:
        unstaged_diff = out_unstaged

    ok_status, out_status, _ = _run_git(["git", "status", "--porcelain=v1"], cwd=repo_path)
    if ok_status and out_status:
        for line in out_status.splitlines():
            if line.startswith("??"):
                rel_file = line[3:].strip().strip('"')
                if not should_skip_untracked_path(rel_file):
                    untracked_files.append(rel_file)

    return {
        "stagedDiff": staged_diff,
        "unstagedDiff": unstaged_diff,
        "untrackedFiles": untracked_files
    }


def determine_push_diff(repo_path: str, remote: Optional[str] = None, branch: Optional[str] = None) -> Tuple[bool, str, int, str]:
    """
    Determine the COMPLETE outgoing diff across ALL outgoing commits.
    Returns (success, diff_text, outgoing_commit_count, range_description).
    """
    # 1. Try upstream tracking branch @{u}
    ok_up, up_out, _ = _run_git(["git", "rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], cwd=repo_path)
    if ok_up and up_out.strip():
        upstream = up_out.strip()
        ok_cnt, cnt_out, _ = _run_git(["git", "rev-list", "--count", f"{upstream}..HEAD"], cwd=repo_path)
        count = int(cnt_out.strip()) if ok_cnt and cnt_out.strip().isdigit() else 0
        if count == 0:
            return True, "", 0, f"In sync with {upstream}"
        
        ok_diff, diff_out, _ = _run_git(["git", "diff", f"{upstream}..HEAD"], cwd=repo_path)
        if ok_diff:
            return True, diff_out, count, f"{count} commit(s) ahead of {upstream}"

    # 2. Try remote target e.g. origin/<branch>
    target_remote = remote or "origin"
    ok_br, br_out, _ = _run_git(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo_path)
    target_branch = branch or (br_out.strip() if ok_br else "main")
    remote_ref = f"{target_remote}/{target_branch}"

    ok_ref, _, _ = _run_git(["git", "rev-parse", "--verify", remote_ref], cwd=repo_path)
    if ok_ref:
        ok_cnt, cnt_out, _ = _run_git(["git", "rev-list", "--count", f"{remote_ref}..HEAD"], cwd=repo_path)
        count = int(cnt_out.strip()) if ok_cnt and cnt_out.strip().isdigit() else 0
        if count == 0:
            return True, "", 0, f"In sync with {remote_ref}"
        ok_diff, diff_out, _ = _run_git(["git", "diff", f"{remote_ref}..HEAD"], cwd=repo_path)
        if ok_diff:
            return True, diff_out, count, f"{count} commit(s) ahead of {remote_ref}"

    # 3. No upstream and remote ref does not exist yet (brand new branch / initial push)
    ok_head, _, _ = _run_git(["git", "rev-parse", "--verify", "HEAD"], cwd=repo_path)
    if not ok_head:
        return True, "", 0, "Empty repository (no commits)"

    ok_cnt, cnt_out, _ = _run_git(["git", "rev-list", "--count", "HEAD"], cwd=repo_path)
    count = int(cnt_out.strip()) if ok_cnt and cnt_out.strip().isdigit() else 1
    
    diff_range = "HEAD"
    for base in ["main", "master"]:
        ok_base, _, _ = _run_git(["git", "rev-parse", "--verify", f"{target_remote}/{base}"], cwd=repo_path)
        if ok_base:
            diff_range = f"{target_remote}/{base}..HEAD"
            break

    ok_diff, diff_out, _ = _run_git(["git", "diff", diff_range], cwd=repo_path)
    if not ok_diff:
        ok_diff, diff_out, _ = _run_git(["git", "diff", "4b825dc642cb6eb9a060e54bf8d69288fbee4904", "HEAD"], cwd=repo_path)
    
    return ok_diff, diff_out if ok_diff else "", count, f"New branch '{target_branch}' ({count} commit(s) to publish)"


def _check_repository_guard_impl(
    repo_path: Optional[str],
    operation: str,
    remote: Optional[str],
    branch: Optional[str],
    threshold_mb: float,
    start_time: float,
    scanned_at: str
) -> Dict[str, Any]:
    try:
        t_mb = float(threshold_mb)
        if t_mb <= 0:
            t_mb = DEFAULT_LARGE_FILE_THRESHOLD_MB
    except (ValueError, TypeError):
        t_mb = DEFAULT_LARGE_FILE_THRESHOLD_MB
    threshold_bytes = int(t_mb * 1024 * 1024)

    # Validate repo path
    if not repo_path or not os.path.exists(repo_path):
        return {
            "allowed": False,
            "overallStatus": "ERROR",
            "blockingIssues": [{
                "id": "guard_invalid_path",
                "severity": "block",
                "category": "Repository",
                "title": "Invalid Repository Path",
                "file": None,
                "line": None,
                "description": f"The workspace path '{repo_path}' does not exist.",
                "reason": "Cannot run repository guard on a missing directory."
            }],
            "warnings": [],
            "info": [],
            "checks": {},
            "operation": operation,
            "scannedAt": scanned_at,
            "scanDurationMs": int((time.time() - start_time) * 1000)
        }

    # 1. Git State Check
    git_state = check_git_state(repo_path, operation=operation, remote=remote, branch=branch)
    if not git_state["valid"]:
        return {
            "allowed": False,
            "overallStatus": "ERROR",
            "blockingIssues": git_state["blockingIssues"],
            "warnings": git_state["warnings"],
            "info": git_state["info"],
            "checks": {"gitState": git_state},
            "operation": operation,
            "scannedAt": scanned_at,
            "scanDurationMs": int((time.time() - start_time) * 1000)
        }

    blocking_issues: List[Dict[str, Any]] = list(git_state["blockingIssues"])
    warnings: List[Dict[str, Any]] = list(git_state["warnings"])
    info: List[Dict[str, Any]] = list(git_state["info"])

    all_touched_files: Set[str] = set()
    large_files_detected: List[Dict[str, Any]] = []
    secrets_detected: List[Dict[str, Any]] = []

    # 2. Diff & Secret Scanning
    if operation == "commit":
        commit_set = determine_commit_set(repo_path)
        
        # Scan staged diff
        if commit_set["stagedDiff"]:
            issues, files = parse_diff_and_scan(commit_set["stagedDiff"])
            secrets_detected.extend(issues)
            all_touched_files.update(files)

        # Scan unstaged diff (since GitHub Automator stages everything on commit)
        if commit_set["unstagedDiff"]:
            issues, files = parse_diff_and_scan(commit_set["unstagedDiff"])
            secrets_detected.extend(issues)
            all_touched_files.update(files)

        # Scan untracked files that will be staged
        for untracked in commit_set["untrackedFiles"]:
            all_touched_files.add(untracked)
            issues, f_size = scan_untracked_file(repo_path, untracked)
            secrets_detected.extend(issues)
            if f_size and f_size >= threshold_bytes:
                size_mb = f_size / (1024 * 1024)
                large_files_detected.append({
                    "path": untracked,
                    "sizeBytes": f_size,
                    "sizeFormatted": f"{size_mb:.1f} MB",
                    "tracked": False
                })

    elif operation == "push":
        ok_push, push_diff, outgoing_count, range_desc = determine_push_diff(repo_path, remote=remote, branch=branch)
        if not ok_push:
            warnings.append({
                "id": "push_diff_undetermined",
                "severity": "warning",
                "category": "Git State",
                "title": "Outgoing Push Range Could Not Be Safely Determined",
                "file": None,
                "line": None,
                "description": f"Could not compute diff for push target ({range_desc}).",
                "reason": "Push diff scanning fell back to basic Git inspection."
            })
        else:
            if push_diff:
                issues, files = parse_diff_and_scan(push_diff)
                secrets_detected.extend(issues)
                all_touched_files.update(files)
            info.append({
                "id": "push_scope_info",
                "severity": "info",
                "category": "Push Scope",
                "title": "Outgoing Commits Scanned",
                "file": None,
                "line": None,
                "description": f"Scanned complete outgoing range: {range_desc}.",
                "reason": "Ensures all outgoing commits are free from secrets."
            })

    # Secrets are BLOCKING issues
    for secret in secrets_detected:
        blocking_issues.append(secret)

    # 3. Sensitive Filename Detection
    for file_rel in sorted(all_touched_files):
        sens_desc = is_sensitive_filename(file_rel)
        if sens_desc:
            warnings.append({
                "id": f"sensitive_file_{file_rel}",
                "severity": "warning",
                "category": "Sensitive Files",
                "title": f"Sensitive File Detected: {os.path.basename(file_rel)}",
                "file": file_rel,
                "line": None,
                "description": f"File '{file_rel}' matches a sensitive file pattern ({sens_desc}).",
                "reason": "Sensitive configuration or key files should typically be listed in .gitignore."
            })

    # 4. Large File Protection for Touched Tracked/Staged Files
    for file_rel in sorted(all_touched_files):
        if any(lf["path"] == file_rel for lf in large_files_detected):
            continue
        full_path = os.path.join(repo_path, file_rel)
        try:
            if os.path.isfile(full_path):
                size = os.path.getsize(full_path)
                if size >= threshold_bytes:
                    size_mb = size / (1024 * 1024)
                    large_files_detected.append({
                        "path": file_rel,
                        "sizeBytes": size,
                        "sizeFormatted": f"{size_mb:.1f} MB",
                        "tracked": True
                    })
        except OSError:
            continue

    for lf in large_files_detected:
        warnings.append({
            "id": f"large_file_{lf['path']}",
            "severity": "warning",
            "category": "Large Files",
            "title": f"Large File Detected: {lf['path']} ({lf['sizeFormatted']})",
            "file": lf["path"],
            "line": None,
            "description": f"File size of {lf['sizeFormatted']} exceeds the {t_mb:.0f} MB warning threshold.",
            "reason": "Large files can bloat Git history and cause remote push failures on GitHub (>100 MB)."
        })

    # 5. Overall Status Classification
    if blocking_issues:
        overall_status = "BLOCKED"
        allowed = False
    elif warnings:
        overall_status = "WARNING"
        allowed = True
    else:
        overall_status = "PASS"
        allowed = True

    duration_ms = int((time.time() - start_time) * 1000)

    return {
        "allowed": allowed,
        "overallStatus": overall_status,
        "blockingIssues": blocking_issues,
        "warnings": warnings,
        "info": info,
        "checks": {
            "gitState": git_state,
            "secrets": {
                "detected": len(secrets_detected),
                "issues": secrets_detected
            },
            "sensitiveFiles": {
                "count": sum(1 for w in warnings if w["category"] == "Sensitive Files")
            },
            "largeFiles": {
                "thresholdMb": t_mb,
                "thresholdBytes": threshold_bytes,
                "detected": large_files_detected
            },
            "touchedFilesCount": len(all_touched_files)
        },
        "operation": operation,
        "scannedAt": scanned_at,
        "scanDurationMs": duration_ms
    }


def check_repository_guard(
    repo_path: Optional[str],
    operation: str = "commit",
    remote: Optional[str] = None,
    branch: Optional[str] = None,
    threshold_mb: float = DEFAULT_LARGE_FILE_THRESHOLD_MB
) -> Dict[str, Any]:
    """
    Main entry point for Repository Guard pre-flight validation.

    Parameters:
      repo_path: Absolute path to the Git repository.
      operation: 'commit' or 'push'.
      remote: Optional target remote name.
      branch: Optional target branch name.
      threshold_mb: Large file warning threshold in MB (default 50.0).

    Returns structured RepositoryGuardResult.
    """
    start_time = time.time()
    scanned_at = datetime.now(timezone.utc).isoformat()
    try:
        return _check_repository_guard_impl(repo_path, operation, remote, branch, threshold_mb, start_time, scanned_at)
    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        return {
            "allowed": False,
            "overallStatus": "ERROR",
            "blockingIssues": [{
                "id": "guard_scanner_exception",
                "severity": "block",
                "category": "Guard Failure",
                "title": "Repository Guard Scanner Failure",
                "file": None,
                "line": None,
                "description": f"Guard scanner could not be completed: {str(e)}",
                "reason": "Security-sensitive failures must be handled conservatively. Operation halted."
            }],
            "warnings": [],
            "info": [],
            "checks": {},
            "operation": operation,
            "scannedAt": scanned_at,
            "scanDurationMs": duration_ms
        }


if __name__ == "__main__":
    import sys
    try:
        payload = json.loads(sys.stdin.buffer.read().decode('utf-8'))
    except Exception:
        payload = {}
    
    r_path = payload.get("repo_path")
    op = payload.get("operation", "commit")
    rem = payload.get("remote")
    br = payload.get("branch")
    t = payload.get("threshold_mb", DEFAULT_LARGE_FILE_THRESHOLD_MB)
    
    guard_result = check_repository_guard(r_path, operation=op, remote=rem, branch=br, threshold_mb=t)
    print(json.dumps(guard_result))
