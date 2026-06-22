"""
repo_manager.py — Repo Management for Phase 2
Called by pythonBridge.js

Input  (stdin): JSON { "action": "...", "token": "...", ...extra fields }
Output (stdout): JSON result

Actions:
  - create  : { action, token, name, private, description }
  - delete  : { action, token, owner, repo }
  - list    : { action, token }
  - clone   : { action, token, clone_url, dest_path }
  - check_repo_exists : { action, repo_name }
  - get_repo_path : { action, repo_name }
  - smart_clone : { action, token, repo_name, clone_url, dest_path }
"""

import sys
import json
import subprocess
import urllib.request
import urllib.error
from services.github_api import GitHubAPI
from services.repo_registry import (
    repo_exists_locally, find_repo_by_name, register_repo,
    cleanup_registry, get_repo_info
)


def create_repo(api: GitHubAPI, name: str, private: bool, description: str) -> dict:
    try:
        result = api.create_repo(name, private, description)
        return {
            "success": True,
            "name": result.get("name"),
            "url": result.get("html_url"),
            "clone_url": result.get("clone_url")
        }
    except urllib.error.HTTPError as e:
        body = json.loads(e.read().decode())
        return {"success": False, "error": body.get("message", str(e))}
    except Exception as e:
        return {"success": False, "error": str(e)}


def delete_repo(api: GitHubAPI, owner: str, repo: str) -> dict:
    try:
        success = api.delete(f"/repos/{owner}/{repo}")
        return {"success": success}
    except Exception as e:
        return {"success": False, "error": str(e)}


def list_repos(api: GitHubAPI) -> dict:
    try:
        repos = api.list_repos(per_page=30)
        simplified = [
            {
                "name": r.get("name"),
                "private": r.get("private"),
                "description": r.get("description") or "",
                "url": r.get("html_url"),
                "clone_url": r.get("clone_url"),
                "updated_at": r.get("updated_at"),
                "language": r.get("language") or "N/A"
            }
            for r in repos
        ]
        return {"success": True, "repos": simplified}
    except Exception as e:
        return {"success": False, "error": str(e)}


def clone_repo(clone_url: str, dest_path: str, token: str) -> dict:
    try:
        # Inject token into clone URL for auth
        # https://github.com/... → https://token@github.com/...
        auth_url = clone_url.replace("https://", f"https://{token}@")

        result = subprocess.run(
            ["git", "clone", auth_url, dest_path],
            capture_output=True,
            text=True,
            timeout=60
        )

        if result.returncode == 0:
            return {"success": True, "path": dest_path}
        else:
            return {"success": False, "error": result.stderr.strip()}
    except FileNotFoundError:
        return {"success": False, "error": "git is not installed or not in PATH"}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Clone timed out"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def check_repo_exists(repo_name: str) -> dict:
    """Check if a repository exists locally and return its path if found."""
    if repo_exists_locally(repo_name):
        repo_path = find_repo_by_name(repo_name)
        return {
            "success": True,
            "exists": True,
            "path": repo_path,
            "message": f"Repository '{repo_name}' found at {repo_path}"
        }
    else:
        return {
            "success": True,
            "exists": False,
            "path": None,
            "message": f"Repository '{repo_name}' not found locally"
        }


def smart_clone(repo_name: str, clone_url: str, dest_path: str, token: str) -> dict:
    """
    Clone a repository and register it in the local registry.
    
    This prevents duplicate clones by registering the repository location.
    """
    # First check if already exists locally
    if repo_exists_locally(repo_name):
        existing_path = find_repo_by_name(repo_name)
        return {
            "success": False,
            "error": f"Repository '{repo_name}' already exists locally at {existing_path}",
            "already_exists": True,
            "existing_path": existing_path
        }
    
    # Perform clone
    clone_result = clone_repo(clone_url, dest_path, token)
    if not clone_result.get("success"):
        return clone_result
    
    # Register in the registry
    register_result = register_repo(repo_name, dest_path, clone_url)
    if not register_result.get("success"):
        return {
            "success": False,
            "error": f"Clone succeeded but registration failed: {register_result.get('message')}"
        }
    
    return {
        "success": True,
        "path": dest_path,
        "message": f"Repository '{repo_name}' cloned and registered"
    }



if __name__ == "__main__":
    args = json.loads(sys.stdin.read())

    token  = args.get("token", "")
    action = args.get("action", "")
    api    = GitHubAPI(token)

    if action == "create":
        result = create_repo(
            api,
            name=args.get("name", ""),
            private=args.get("private", False),
            description=args.get("description", "")
        )

    elif action == "delete":
        result = delete_repo(
            api,
            owner=args.get("owner", ""),
            repo=args.get("repo", "")
        )

    elif action == "list":
        result = list_repos(api)

    elif action == "clone":
        result = clone_repo(
            clone_url=args.get("clone_url", ""),
            dest_path=args.get("dest_path", ""),
            token=token
        )
    
    elif action == "check_repo_exists":
        result = check_repo_exists(
            repo_name=args.get("repo_name", "")
        )
    
    elif action == "get_repo_path":
        result = check_repo_exists(
            repo_name=args.get("repo_name", "")
        )
    
    elif action == "smart_clone":
        result = smart_clone(
            repo_name=args.get("repo_name", ""),
            clone_url=args.get("clone_url", ""),
            dest_path=args.get("dest_path", ""),
            token=token
        )
    
    elif action == "cleanup_registry":
        result = cleanup_registry()

    else:
        result = {"success": False, "error": f"Unknown action: {action}"}

    print(json.dumps(result))
