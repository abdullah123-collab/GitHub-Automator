"""
auth.py — GitHub token validation via Python
Called by the VS Code extension through pythonBridge.js

Input:  JSON via stdin  { "token": "ghp_xxx" }
Output: JSON via stdout { "valid": true, "login": "username", "name": "Full Name" }
"""

import sys
import json
import urllib.request
import urllib.error


def validate_token(token: str) -> dict:
    req = urllib.request.Request(
        "https://api.github.com/user",
        headers={
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json"
        }
    )
    try:
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            return {
                "valid": True,
                "login": data.get("login"),
                "name": data.get("name"),
                "avatar_url": data.get("avatar_url"),
                "public_repos": data.get("public_repos")
            }
    except urllib.error.HTTPError as e:
        return {"valid": False, "error": f"HTTP {e.code}: {e.reason}"}
    except Exception as e:
        return {"valid": False, "error": str(e)}


if __name__ == "__main__":
    args = json.loads(sys.stdin.read())
    result = validate_token(args.get("token", ""))
    print(json.dumps(result))
