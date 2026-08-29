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
import re
from services.github_api import GitHubAPI

# Hide CMD console window on Windows
CREATION_FLAGS = 0x08000000 if sys.platform == 'win32' else 0
from services.repo_registry import (
    repo_exists_locally, find_repo_by_name, register_repo,
    cleanup_registry, get_repo_info, is_repo_cloned,
    load_registry, save_registry, is_valid_git_repo,
    _get_remote_url, _extract_owner_repo
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
                "id": r.get("id"),
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
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read().decode())
            err_msg = body.get("message", str(e))
        except Exception:
            err_msg = str(e)
        if e.code in (401, 403):
            return {"success": False, "error": f"Authentication failure: {err_msg}", "error_type": "auth"}
        else:
            return {"success": False, "error": f"GitHub API error: {err_msg}", "error_type": "api"}
    except urllib.error.URLError as e:
        return {"success": False, "error": "No internet connection", "error_type": "network"}
    except Exception as e:
        err_str = str(e)
        network_keywords = ["timeout", "dns", "connection", "unreachable", "getaddrinfo", "host", "socket"]
        if any(kw in err_str.lower() for kw in network_keywords):
            return {"success": False, "error": "No internet connection", "error_type": "network"}
        return {"success": False, "error": err_str, "error_type": "unknown"}


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


def validate_repo_name(name: str, current_name: str = None) -> dict:
    """
    Authoritative validation for GitHub repository names.
    Rules:
      - 1 to 100 characters
      - Allowed characters: A-Z, a-z, 0-9, ., _, -
      - No leading . or -
      - No trailing . or -
      - Must not end in .git
      - Must not be empty after trimming
    """
    if name is None:
        return {"valid": False, "error": "Repository name cannot be empty."}

    trimmed = name.strip()
    if not trimmed:
        return {"valid": False, "error": "Repository name cannot be empty."}

    if current_name and trimmed == current_name:
        return {"valid": True, "no_op": True, "name": trimmed}

    if len(trimmed) > 100:
        return {"valid": False, "error": "Repository name cannot exceed 100 characters."}

    if not re.match(r'^[a-zA-Z0-9_.-]+$', trimmed):
        return {"valid": False, "error": "Repository name can only contain letters, numbers, hyphens, periods, and underscores."}

    if trimmed.lower() == '.git' or trimmed.lower().endswith('.git'):
        return {"valid": False, "error": "Repository name cannot end with .git."}

    if trimmed.startswith(('.', '-')) or trimmed.endswith(('.', '-')):
        return {"valid": False, "error": "Repository name cannot start or end with a period or hyphen."}

    return {"valid": True, "no_op": False, "name": trimmed}


def rewrite_git_remote_url(current_url: str, new_repo_name: str, expected_owner: str = None, old_repo_name: str = None) -> str:
    """
    Safely rewrite a GitHub remote URL with a new repository name.

    Preserves:
      - protocol (https://, http://, ssh://, git@)
      - authentication/tokens (https://token@, https://user:pass@)
      - SSH ports (ssh://git@github.com:22/...)
      - owner
      - .git suffix (preserved if present, omitted if absent)

    Does NOT do naive global replacement.
    """
    if not current_url:
        return ""

    if expected_owner and old_repo_name:
        pattern = rf'^(.*?github\.com(?::\d+)?[:/]{re.escape(expected_owner)}/){re.escape(old_repo_name)}(\.git)?/?$'
        match = re.match(pattern, current_url, flags=re.IGNORECASE)
        if match:
            prefix = match.group(1)
            suffix = match.group(2) or ""
            return f"{prefix}{new_repo_name}{suffix}"

    if old_repo_name:
        pattern = rf'^(.*?github\.com(?::\d+)?[:/][^/]+/){re.escape(old_repo_name)}(\.git)?/?$'
        match = re.match(pattern, current_url, flags=re.IGNORECASE)
        if match:
            prefix = match.group(1)
            suffix = match.group(2) or ""
            return f"{prefix}{new_repo_name}{suffix}"

    return current_url


def rename_repo(api: GitHubAPI, owner: str, old_name: str, new_name: str, workspace_path: str = None) -> dict:
    old_name = (old_name or "").strip()

    # 1. Authoritative validation
    val = validate_repo_name(new_name, old_name)
    if not val["valid"]:
        return {
            "success": False,
            "no_op": False,
            "error": val["error"],
            "error_code": 400
        }

    if val.get("no_op"):
        return {
            "success": True,
            "no_op": True,
            "old_name": old_name,
            "name": old_name,
            "owner": owner,
            "remote_updated": False,
            "remote_warning": None
        }

    clean_new_name = val["name"]

    # 2. Get owner if not provided
    if not owner:
        try:
            user = api.get_user()
            owner = user.get("login", "")
        except Exception as e:
            return {
                "success": False,
                "no_op": False,
                "error": f"Failed to retrieve authenticated user: {str(e)}",
                "error_code": 401
            }

    # 3. Call GitHub API: PATCH /repos/{owner}/{old_name} with {"name": clean_new_name}
    try:
        updated_repo = api.update_repo(owner, old_name, {"name": clean_new_name})
    except urllib.error.HTTPError as e:
        error_code = e.code
        err_text = ""
        try:
            body = json.loads(e.read().decode())
            if "errors" in body and body["errors"]:
                err_msgs = [err.get("message", "") for err in body["errors"] if err.get("message")]
                if err_msgs:
                    err_text = "; ".join(err_msgs)
                else:
                    err_text = body.get("message", str(e))
            else:
                err_text = body.get("message", str(e))
        except Exception:
            err_text = str(e)

        if error_code == 404:
            user_msg = f"Repository '{old_name}' not found on GitHub."
        elif error_code == 403:
            user_msg = f"Permission denied: You do not have admin rights to rename '{old_name}'."
        elif error_code == 422:
            user_msg = f"Rename rejected by GitHub: {err_text}"
        else:
            user_msg = f"GitHub API error ({error_code}): {err_text}"

        return {
            "success": False,
            "no_op": False,
            "error": user_msg,
            "error_code": error_code
        }
    except urllib.error.URLError as e:
        return {
            "success": False,
            "no_op": False,
            "error": "No internet connection or network failure.",
            "error_code": 0
        }
    except Exception as e:
        return {
            "success": False,
            "no_op": False,
            "error": str(e),
            "error_code": 500
        }

    # 4. GitHub confirmed success!
    confirmed_new_name = updated_repo.get("name", clean_new_name)
    repo_id = updated_repo.get("id")
    html_url = updated_repo.get("html_url")
    clone_url = updated_repo.get("clone_url")
    ssh_url = updated_repo.get("ssh_url")

    # 5. Update local Git remote URL if a local clone exists
    remote_updated = False
    remote_warning = None

    local_path = None
    if repo_exists_locally(old_name):
        local_path = find_repo_by_name(old_name)
    elif workspace_path and is_valid_git_repo(workspace_path):
        remote_url = _get_remote_url(workspace_path)
        rem_owner, rem_repo = _extract_owner_repo(remote_url)
        if rem_owner.lower() == owner.lower() and rem_repo.lower() == old_name.lower():
            local_path = workspace_path

    if local_path and is_valid_git_repo(local_path):
        current_remote = _get_remote_url(local_path)
        if current_remote:
            new_remote = rewrite_git_remote_url(current_remote, confirmed_new_name, expected_owner=owner, old_repo_name=old_name)
            res = subprocess.run(
                ["git", "remote", "set-url", "origin", new_remote],
                cwd=local_path,
                capture_output=True,
                text=True,
                timeout=10,
                creationflags=CREATION_FLAGS
            )
            if res.returncode == 0:
                remote_updated = True
            else:
                remote_warning = f"GitHub repository was renamed to '{confirmed_new_name}', but failed to update local remote 'origin': {res.stderr.strip()}"
        else:
            remote_warning = f"GitHub repository was renamed to '{confirmed_new_name}', but no remote 'origin' URL found on local clone."

    # 6. Update registry/state/persistence
    registry = load_registry()
    migrated = False
    if old_name in registry:
        info = registry.pop(old_name)
        info["repo"] = confirmed_new_name
        if clone_url:
            info["clone_url"] = clone_url
        registry[confirmed_new_name] = info
        migrated = True
    else:
        for k, v in list(registry.items()):
            if v.get("owner", "").lower() == owner.lower() and v.get("repo", "").lower() == old_name.lower():
                info = registry.pop(k)
                info["repo"] = confirmed_new_name
                if clone_url:
                    info["clone_url"] = clone_url
                registry[confirmed_new_name] = info
                migrated = True
                break

    if migrated:
        save_registry(registry)

    return {
        "success": True,
        "no_op": False,
        "id": repo_id,
        "old_name": old_name,
        "name": confirmed_new_name,
        "owner": owner,
        "url": html_url,
        "clone_url": clone_url,
        "ssh_url": ssh_url,
        "remote_updated": remote_updated,
        "remote_warning": remote_warning
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

    elif action == "rename":
        result = rename_repo(
            api,
            owner=args.get("owner", ""),
            old_name=args.get("old_name", ""),
            new_name=args.get("new_name", ""),
            workspace_path=args.get("repo_path")
        )

    else:
        result = {"success": False, "error": f"Unknown action: {action}"}

    print(json.dumps(result))
