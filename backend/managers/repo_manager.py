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

# Hide CMD console window on Windows
CREATION_FLAGS = 0x08000000 if sys.platform == 'win32' else 0
from services.repo_registry import (
    repo_exists_locally, find_repo_by_name, register_repo,
    cleanup_registry, get_repo_info, is_repo_cloned
)


def create_repo(api: GitHubAPI, name: str, private: bool, description: str, auto_init: bool = True) -> dict:
    try:
        result = api.create_repo(name, private, description, auto_init=auto_init)
        return {
            "success": True,
            "name": result.get("name"),
            "url": result.get("html_url"),
            "clone_url": result.get("clone_url"),
            "owner": result.get("owner", {}).get("login")
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


def list_repos(api: GitHubAPI, workspace_path: str = None, page: int = 1) -> dict:
    import time
    start = time.time()
    try:
        from services.repo_registry import get_all_cloned_repos
        
        api_start = time.time()
        repos = api.list_repos_page(per_page=100, page=page)
        api_time = time.time() - api_start
        
        fs_start = time.time()
        cloned_set = get_all_cloned_repos(workspace_path)
        
        from services.repo_registry import load_registry
        registry = load_registry()
        
        # Build a fast mapping of owner/repo to path to grab the local branch
        cloned_paths = {}
        for info in registry.values():
            owner = info.get("owner")
            repo = info.get("repo")
            path = info.get("path")
            if owner and repo and path:
                cloned_paths[f"{owner.lower()}/{repo.lower()}"] = path
        fs_time = time.time() - fs_start
                
        def get_local_branch(repo_path):
            import subprocess
            try:
                res = subprocess.run(
                    ["git", "rev-parse", "--abbrev-ref", "HEAD"],
                    cwd=repo_path,
                    capture_output=True,
                    text=True,
                    timeout=2,
                    creationflags=CREATION_FLAGS
                )
                if res.returncode == 0:
                    return res.stdout.strip()
            except:
                pass
            return ""
        
        simplified = [
            {
                "name": r.get("name"),
                "private": r.get("private"),
                "description": r.get("description") or "",
                "url": r.get("html_url"),
                "clone_url": r.get("clone_url"),
                "updated_at": r.get("updated_at"),
                "pushed_at": r.get("pushed_at"),
                "stargazers_count": r.get("stargazers_count") or 0,
                "language": r.get("language") or "N/A",
                "is_cloned": f"{r.get('owner', {}).get('login', '').lower()}/{r.get('name', '').lower()}" in cloned_set,
                "current_branch": get_local_branch(cloned_paths.get(f"{r.get('owner', {}).get('login', '').lower()}/{r.get('name', '').lower()}", "")) if f"{r.get('owner', {}).get('login', '').lower()}/{r.get('name', '').lower()}" in cloned_set else r.get("default_branch", "main"),
                "owner": r.get("owner", {}).get("login", "")
            }
            for r in repos
        ]
        import sys
        print(f"\n--- SAFE TIMING REPORT ---", file=sys.stderr)
        print(f"GitHub API Call: {api_time*1000:.2f} ms", file=sys.stderr)
        print(f"Filesystem / Registry: {fs_time*1000:.2f} ms", file=sys.stderr)
        print(f"Total list_repos execution: {(time.time() - start)*1000:.2f} ms\n", file=sys.stderr)
        
        return {"success": True, "repos": simplified, "has_more": len(repos) == 100}
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
            timeout=60,
            creationflags=CREATION_FLAGS
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
def check_remote_repo_exists(api: GitHubAPI, name: str) -> dict:
    """Check if a repository exists on GitHub for the authenticated user."""
    try:
        user = api.get_user()
        owner = user.get("login")
        api.get(f"/repos/{owner}/{name}")
        return {"success": True, "exists": True, "owner": owner}
    except urllib.error.HTTPError as e:
        if e.code == 404:
            return {"success": True, "exists": False}
        try:
            body = json.loads(e.read().decode())
            return {"success": False, "error": body.get("message", str(e))}
        except Exception:
            return {"success": False, "error": str(e)}
    except Exception as e:
        return {"success": False, "error": str(e)}


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
            description=args.get("description", ""),
            auto_init=args.get("auto_init", True)
        )

    elif action == "delete":
        result = delete_repo(
            api,
            owner=args.get("owner", ""),
            repo=args.get("repo", "")
        )

    elif action == "list":
        workspace_path = args.get("repo_path")
        page = args.get("page", 1)
        result = list_repos(api, workspace_path=workspace_path, page=page)

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
    
    elif action == "check_remote_repo_exists":
        result = check_remote_repo_exists(
            api,
            name=args.get("name", "")
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

    elif action == "update_description":
        owner = args.get("owner", "")
        repo = args.get("repo", "")
        description = args.get("description", "")
        try:
            if not owner:
                owner = api.get_user().get("login")
            api.update_repo(owner, repo, {"description": description})
            result = {"success": True, "message": "Description updated successfully"}
        except Exception as e:
            result = {"success": False, "error": str(e)}

    else:
        result = {"success": False, "error": f"Unknown action: {action}"}

    print(json.dumps(result))
