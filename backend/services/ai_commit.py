"""
ai_commit.py — Commit Message Generator
No API needed — uses smart rule-based analysis of git diff.

Provides:
  - generate_commit_message(diff, api_key) → dict
"""

import re


def generate_commit_message(diff: str, api_key: str = "", model: str = "claude-3-5-haiku-latest") -> dict:
    """
    Generate a commit message from a diff.
    If api_key is provided, uses Anthropic API.
    Otherwise, uses the local rule-based fallback.
    """
    if not diff.strip():
        return {"success": False, "error": "Empty diff"}

    try:
        # Try Anthropic API first if key is provided
        if api_key and api_key != "" and not api_key.startswith("demo"):
            result = _try_anthropic(diff, api_key, model)
            if result["success"]:
                return result
            # If API fails (credits etc), fall through to rule-based

        # Rule-based generator (always free)
        message = _rule_based_message(diff)
        return {"success": True, "message": message}

    except Exception as e:
        return {"success": False, "error": str(e)}


def _try_anthropic(diff: str, api_key: str, model: str) -> dict:
    """Try to use Anthropic API for commit message."""
    try:
        import urllib.request
        import json

        payload = json.dumps({
            "model": model,
            "max_tokens": 200,
            "messages": [{
                "role": "user",
                "content": f"Write a concise git commit message in Conventional Commits format for this diff. Only output the commit message, nothing else:\n\n{diff[:3000]}"
            }]
        }).encode()

        req = urllib.request.Request(
            "https://api.anthropic.com/v1/messages",
            data=payload,
            headers={
                "x-api-key": api_key,
                "anthropic-version": "2023-06-01",
                "content-type": "application/json"
            }
        )

        with urllib.request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read())
            message = data["content"][0]["text"].strip()
            return {"success": True, "message": message}

    except Exception as e:
        return {"success": False, "error": str(e)}


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