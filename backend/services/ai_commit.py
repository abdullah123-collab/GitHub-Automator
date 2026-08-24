"""
ai_commit.py — Commit Message Generator
No API needed — uses smart rule-based analysis of git diff.

Provides:
  - generate_commit_message(diff, api_key) → dict
"""

import re
from services.ai_gateway import generate_text
from services.ai_result import success_result, failure_result, AIErrorCode

def generate_commit_message(diff: str, api_key: str = "", model: str = "gemini-3.6-flash", ai_mode: str = "gemini") -> dict:
    """
    Generate a commit message from a diff.
    If ai_mode is "fallback", or no api_key is provided, uses the local rule-based fallback.
    """
    if not diff.strip():
        return failure_result(AIErrorCode.EMPTY_RESPONSE, "Empty diff", "No diff content provided.")

    if ai_mode == "fallback" or not api_key or api_key.startswith("demo"):
        return success_result(_rule_based_message(diff))

    try:
        prompt = f"Write a concise git commit message in Conventional Commits format for this diff. Only output the commit message, nothing else:\n\n{diff[:3000]}"
        result = generate_text(prompt, api_key, model=model, max_tokens=150)
        
        if result["success"]:
            return success_result(result["text"].strip())
            
        error_msg = result.get('error', 'Unknown error')
        err_lower = error_msg.lower()
        
        if 'timeouterror' in err_lower or 'timeout' in err_lower:
            code = AIErrorCode.TIMEOUT
            msg = "AI commit message generation timed out. Please try again."
        elif 'authenticationerror' in err_lower or 'unauthorized' in err_lower or 'api_key_invalid' in err_lower or '401' in err_lower or '403' in err_lower:
            code = AIErrorCode.INVALID_API_KEY
            msg = "Invalid Gemini API Key or authorization error."
        elif 'ratelimiterror' in err_lower or '429' in err_lower or 'quota' in err_lower:
            code = AIErrorCode.RATE_LIMIT_EXCEEDED
            msg = "Gemini API rate limit exceeded or quota exhausted. Please try again later."
        elif 'networkerror' in err_lower or 'connection' in err_lower or 'dns' in err_lower:
            code = AIErrorCode.NETWORK_FAILURE
            msg = "Network connection error. Please verify your internet connection."
        elif '404' in err_lower or 'not_found' in err_lower:
            code = AIErrorCode.MODEL_NOT_FOUND
            msg = f"Invalid Gemini Model '{model}' selected. Please fix settings."
        else:
            code = AIErrorCode.UNKNOWN
            msg = f"AI Generation Failed: {error_msg}"
            
        return failure_result(code, msg, error_msg, fallback_content=_rule_based_message(diff))

    except Exception as e:
        return failure_result(AIErrorCode.UNKNOWN, str(e), str(e), fallback_content=_rule_based_message(diff))


def _rule_based_message(diff: str) -> str:
    """
    Generate commit message by analyzing the diff content.
    No API needed.
    """
    if not diff.strip():
        return "chore: update files"

    lines = diff.splitlines()

    # Collect added/removed/modified file info
    added_files    = []
    deleted_files  = []
    modified_files = []
    added_lines    = 0
    removed_lines  = 0

    for line in lines:
        if line.startswith("=== NEW FILES ==="):
            continue
        if line.startswith("=== STAGED") or line.startswith("=== UNSTAGED"):
            continue

        # New/modified file markers in diff
        if line.startswith("diff --git"):
            parts = line.split(" b/")
            if len(parts) > 1:
                fname = parts[1].strip()
                modified_files.append(fname)

        elif line.startswith("new file mode"):
            if modified_files:
                added_files.append(modified_files.pop())

        elif line.startswith("deleted file mode"):
            if modified_files:
                deleted_files.append(modified_files.pop())

        elif line.startswith("+") and not line.startswith("+++"):
            added_lines += 1

        elif line.startswith("-") and not line.startswith("---"):
            removed_lines += 1

    # Also check untracked section
    in_new_files = False
    for line in lines:
        if "=== NEW FILES ===" in line:
            in_new_files = True
            continue
        if in_new_files and line.strip():
            added_files.append(line.strip())

    # Remove duplicates
    added_files    = list(dict.fromkeys(added_files))
    deleted_files  = list(dict.fromkeys(deleted_files))
    modified_files = list(dict.fromkeys(
        f for f in modified_files if f not in added_files and f not in deleted_files
    ))

    # ── Determine commit type ──
    commit_type = _detect_type(diff, added_files, modified_files, deleted_files)

    # ── Build scope from file names ──
    all_changed = added_files + modified_files + deleted_files
    scope = _detect_scope(all_changed)

    # ── Build description ──
    desc = _build_description(
        commit_type, added_files, modified_files, deleted_files,
        added_lines, removed_lines
    )

    # ── Assemble final message ──
    if scope:
        header = f"{commit_type}({scope}): {desc}"
    else:
        header = f"{commit_type}: {desc}"

    # Add body if multiple files changed
    body_lines = []
    if len(added_files) > 0:
        body_lines.append(f"- Added: {', '.join(added_files[:3])}")
    if len(modified_files) > 0:
        body_lines.append(f"- Modified: {', '.join(modified_files[:3])}")
    if len(deleted_files) > 0:
        body_lines.append(f"- Deleted: {', '.join(deleted_files[:3])}")

    if body_lines and len(all_changed) > 1:
        return header + "\n\n" + "\n".join(body_lines)

    return header


def _detect_type(diff: str, added: list, modified: list, deleted: list) -> str:
    """Detect conventional commit type from diff content."""
    diff_lower = diff.lower()

    # Check file names for clues
    all_files = " ".join(added + modified + deleted).lower()

    if deleted and not added and not modified:
        return "chore"

    if any(w in diff_lower for w in ["fix", "bug", "error", "issue", "crash", "exception", "traceback"]):
        return "fix"

    if any(w in diff_lower for w in ["test", "spec", "assert", "unittest", "pytest"]):
        return "test"

    if any(w in all_files for w in ["readme", "docs", ".md", "changelog", "license", "contributing"]):
        return "docs"

    if any(w in all_files for w in ["style", ".css", ".scss", ".less"]):
        return "style"

    if any(w in diff_lower for w in ["refactor", "rename", "restructure", "reorganize", "cleanup"]):
        return "refactor"

    if any(w in all_files for w in ["config", "setup", ".env", "requirements", "package.json",
                                     "dockerfile", ".yml", ".yaml", ".toml", ".cfg", ".ini"]):
        return "chore"

    if added:
        return "feat"

    if modified:
        return "fix" if any(w in diff_lower for w in ["fix", "correct", "resolve", "solve"]) else "feat"

    return "chore"


def _detect_scope(files: list) -> str:
    """Detect scope from file paths."""
    if not files:
        return ""

    # Get folder names as scope
    folders = []
    for f in files:
        parts = f.replace("\\", "/").split("/")
        if len(parts) > 1:
            folders.append(parts[0])

    if folders:
        # Most common folder
        most_common = max(set(folders), key=folders.count)
        if most_common not in ("src", ".", ""):
            return most_common

    # Use file extension as scope
    if files:
        ext = files[0].rsplit(".", 1)[-1] if "." in files[0] else ""
        ext_map = {
            "py": "python", "js": "js", "ts": "ts",
            "html": "html", "css": "css", "md": "docs",
            "json": "config", "yml": "ci", "yaml": "ci"
        }
        return ext_map.get(ext, "")

    return ""


def _build_description(commit_type, added, modified, deleted, added_lines, removed_lines):
    """Build a human-readable description."""
    total = len(added) + len(modified) + len(deleted)

    if total == 0:
        if added_lines > 0:
            return f"add {added_lines} lines of code"
        return "update project files"

    if total == 1:
        fname = (added + modified + deleted)[0]
        # Get just filename without path
        short = fname.replace("\\", "/").split("/")[-1]

        if added:
            return f"add {short}"
        elif deleted:
            return f"remove {short}"
        else:
            if commit_type == "fix":
                return f"fix issue in {short}"
            return f"update {short}"

    # Multiple files
    if added and not modified and not deleted:
        return f"add {len(added)} new file{'s' if len(added) > 1 else ''}"
    elif deleted and not added and not modified:
        return f"remove {len(deleted)} file{'s' if len(deleted) > 1 else ''}"
    elif modified and not added and not deleted:
        return f"update {len(modified)} file{'s' if len(modified) > 1 else ''}"
    else:
        parts = []
        if added:   parts.append(f"{len(added)} added")
        if modified: parts.append(f"{len(modified)} modified")
        if deleted:  parts.append(f"{len(deleted)} deleted")
        return f"update files ({', '.join(parts)})"


# ─── Entry Point ──────────────────────────────────────────────────
if __name__ == "__main__":
    import sys
    import json

    try:
        args = json.loads(sys.stdin.read())
    except:
        print(json.dumps({"success": False, "error": "Invalid JSON input"}))
        sys.exit(1)

    diff    = args.get("diff", "")
    api_key = args.get("api_key", "")

    result = generate_commit_message(diff, api_key)
    print(json.dumps(result))