"""
ai_commit.py — AI Commit Message Generator for Phase 3
Uses Anthropic Claude API (claude-sonnet-4-20250514).

Usage (imported by gui.py):
    from ai_commit import generate_commit_message
    message = generate_commit_message(diff_text, anthropic_key)

No external dependencies beyond standard library + urllib.
"""

import json
import urllib.request
import urllib.error

CLAUDE_API_URL = "https://api.anthropic.com/v1/messages"
MODEL = "claude-sonnet-4-20250514"

SYSTEM_PROMPT = """You are an expert software engineer who writes clean, concise Git commit messages.

Rules:
- Follow Conventional Commits format: <type>(<scope>): <short description>
- Types: feat, fix, refactor, docs, style, test, chore
- First line: max 72 characters
- Be specific — mention what changed, not just "updated files"
- If multiple concerns exist, list them as bullet points after a blank line
- Output ONLY the commit message — no explanation, no markdown, no quotes"""

USER_PROMPT_TEMPLATE = """Generate a Git commit message for the following changes:

```
{diff}
```

Output only the commit message."""


def generate_commit_message(diff: str, api_key: str) -> dict:
    """
    Calls Claude API to generate a commit message from a git diff.

    Returns:
        { "success": True,  "message": "feat(gui): add commit dialog" }
        { "success": False, "error": "..." }
    """
    if not diff.strip():
        return {"success": False, "error": "No changes detected to describe."}

    if not api_key or not api_key.strip():
        return {"success": False, "error": "Anthropic API key is required."}

    payload = {
        "model": MODEL,
        "max_tokens": 256,
        "system": SYSTEM_PROMPT,
        "messages": [
            {
                "role": "user",
                "content": USER_PROMPT_TEMPLATE.format(diff=diff[:3500])
            }
        ]
    }

    req = urllib.request.Request(
        CLAUDE_API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "x-api-key": api_key.strip(),
            "anthropic-version": "2023-06-01"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=20) as response:
            data = json.loads(response.read().decode("utf-8"))
            message = data["content"][0]["text"].strip()
            return {"success": True, "message": message}

    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode())
            err = body.get("error", {}).get("message", str(e))
        except Exception:
            err = f"HTTP {e.code}: {e.reason}"
        return {"success": False, "error": err}

    except urllib.error.URLError as e:
        return {"success": False, "error": f"Network error: {e.reason}"}

    except Exception as e:
        return {"success": False, "error": str(e)}


# ─── Entry Point (Called via pythonBridge.js) ─────────────────────
if __name__ == "__main__":
    import sys
    import os
    
    try:
        args = json.loads(sys.stdin.read())
    except:
        print(json.dumps({"success": False, "error": "Invalid JSON input"}))
        sys.exit(1)
    
    action = args.get("action", "")
    repo_path = args.get("repo_path", "")
    api_key = os.getenv("ANTHROPIC_API_KEY", "")
    
    if action == "generate_message":
        if not repo_path:
            print(json.dumps({"success": False, "error": "repo_path is required"}))
            sys.exit(1)
        
        if not api_key:
            print(json.dumps({"success": False, "error": "ANTHROPIC_API_KEY environment variable not set"}))
            sys.exit(1)
        
        try:
            # Get git diff
            import subprocess
            result = subprocess.run(
                ["git", "diff"],
                cwd=repo_path,
                capture_output=True,
                text=True,
                timeout=5
            )
            diff = result.stdout
            
            if not diff.strip():
                # Try to get status if no diff
                result = subprocess.run(
                    ["git", "status", "--short"],
                    cwd=repo_path,
                    capture_output=True,
                    text=True,
                    timeout=5
                )
                diff = result.stdout
            
            # Generate message
            ai_result = generate_commit_message(diff, api_key)
            print(json.dumps(ai_result))
        except Exception as e:
            print(json.dumps({"success": False, "error": str(e)}))
    else:
        print(json.dumps({"success": False, "error": f"Unknown action: {action}"}))
