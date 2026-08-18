"""
repo_registry.py — Smart Local Repository Registry Management

Manages a registry of cloned repositories to prevent duplicates.
Stores repository paths and metadata in a JSON config file.

Functions:
  - get_registry_path() → str, returns path to registry file
  - load_registry() → dict, loads current registry
  - save_registry(registry) → None, saves registry to disk
  - find_repo_by_name(repo_name) → str or None, finds existing repo path
  - register_repo(repo_name, repo_path, clone_url) → None, adds to registry
  - unregister_repo(repo_name) → None, removes from registry
  - repo_exists_locally(repo_name) → bool, checks if repo is already cloned
  - validate_repo_path(repo_path) → bool, checks if path still exists and is a git repo
"""

import json
import os
import sys
import subprocess
from pathlib import Path
from typing import Optional, Dict

# Hide CMD console window on Windows
CREATION_FLAGS = 0x08000000 if sys.platform == 'win32' else 0


# Registry file location - stored in extension config directory
REGISTRY_FILENAME = "repo_registry.json"

def get_config_dir() -> str:
    """Get the config directory for storing registry."""
    if os.name == 'nt':  # Windows
        config_dir = os.path.join(os.environ.get('APPDATA', os.path.expanduser('~')), 
                                  'GitHub-Automator')
    else:  # Linux/macOS
        config_dir = os.path.join(os.path.expanduser('~'), '.config', 'github-automator')
    
    # Create if doesn't exist
    os.makedirs(config_dir, exist_ok=True)
    return config_dir


def get_registry_path() -> str:
    """Get the full path to the registry file."""
    return os.path.join(get_config_dir(), REGISTRY_FILENAME)


def load_registry() -> Dict:
    """Load the repository registry from disk."""
    registry_path = get_registry_path()
    
    if not os.path.exists(registry_path):
        return {}
    
    try:
        with open(registry_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        # If corrupted, return empty registry
        return {}


def save_registry(registry: Dict) -> None:
    """Save the repository registry to disk."""
    registry_path = get_registry_path()
    
    try:
        with open(registry_path, 'w', encoding='utf-8') as f:
            json.dump(registry, f, indent=2, ensure_ascii=False)
    except IOError as e:
        print(f"Warning: Could not save registry: {e}")


def is_valid_git_repo(repo_path: str) -> bool:
    """Check if the given path is a valid git repository."""
    if not os.path.isdir(repo_path):
        return False
    
    try:
        result = subprocess.run(
            ["git", "rev-parse", "--is-inside-work-tree"],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=CREATION_FLAGS
        )
        return result.returncode == 0
    except Exception:
        return False


def find_repo_by_name(repo_name: str) -> Optional[str]:
    """
    Find an existing repository by name.
    
    Returns:
        Path to the repository if found and valid, None otherwise
    """
    registry = load_registry()
    
    if repo_name not in registry:
        return None
    
    repo_info = registry[repo_name]
    repo_path = repo_info.get("path")
    
    if not repo_path:
        return None
    
    # Validate that the path still exists and is a valid git repo
    if is_valid_git_repo(repo_path):
        return repo_path
    
    # If path is no longer valid, clean it up from registry
    del registry[repo_name]
    save_registry(registry)
    return None


def register_repo(repo_name: str, repo_path: str, clone_url: str) -> Dict:
    """
    Register a newly cloned repository in the registry.

    When possible, extract and store owner/repo information so the system can reliably
    map local repositories to GitHub "owner/repo" identifiers.

    Returns:
        {"success": bool, "message": str}
    """
    if not is_valid_git_repo(repo_path):
        return {
            "success": False,
            "message": f"Path is not a valid git repository: {repo_path}"
        }

    registry = load_registry()

    owner, repo = _extract_owner_repo(clone_url)

    registry[repo_name] = {
        "path": repo_path,
        "clone_url": clone_url,
        "registered_at": _get_timestamp(),
        "owner": owner if owner else None,
        "repo": repo if repo else None
    }

    save_registry(registry)
    return {
        "success": True,
        "message": f"Repository '{repo_name}' registered at {repo_path}"
    }


def unregister_repo(repo_name: str) -> Dict:
    """
    Remove a repository from the registry.
    
    Returns:
        {"success": bool, "message": str}
    """
    registry = load_registry()
    
    if repo_name not in registry:
        return {
            "success": False,
            "message": f"Repository '{repo_name}' not found in registry"
        }
    
    del registry[repo_name]
    save_registry(registry)
    return {
        "success": True,
        "message": f"Repository '{repo_name}' unregistered"
    }


import re

def _extract_owner_repo(url: str) -> tuple:
    """Extract owner and repo from a GitHub URL."""
    if not url:
        return "", ""
    if url.endswith(".git"):
        url = url[:-4]
    match = re.search(r'github\.com[:/]([^/]+)/([^/]+)$', url)
    if match:
        return match.group(1).lower(), match.group(2).lower()
    return "", ""

def _get_remote_url(repo_path: str) -> str:
    """Get the remote origin URL of a local git repository."""
    try:
        result = subprocess.run(
            ["git", "config", "--get", "remote.origin.url"],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=CREATION_FLAGS
        )
        if result.returncode == 0:
            return result.stdout.strip()
    except Exception:
        pass
    return ""


def _has_remote_tracking_branches(repo_path: str) -> bool:
    """Return True if the repository has any remote-tracking branches (excluding origin/HEAD redirects).

    This is a safer indicator that the repo was cloned (or at least has fetched from the remote)
    rather than merely having a remote URL configured after a local git init.
    """
    try:
        result = subprocess.run(
            ["git", "branch", "-r"],
            cwd=repo_path,
            capture_output=True,
            text=True,
            timeout=5,
            creationflags=CREATION_FLAGS
        )
        if result.returncode != 0:
            return False

        lines = [l.strip() for l in result.stdout.splitlines() if l.strip()]
        # Exclude origin/HEAD -> origin/main style symbolic refs
        branches = [l for l in lines if "->" not in l and not l.lower().startswith("origin/head")]
        return len(branches) > 0
    except Exception:
        return False


def get_all_cloned_repos(workspace_path: str = None) -> set:
    """Returns a set of 'owner/repo' strings for all locally cloned repositories, caching results in the registry.

    Improved logic:
    - Prefer registry entries that already contain owner/repo metadata (explicitly registered clones).
    - For discovered/local paths, only consider a repository "cloned" (map to owner/repo) when it both
      has a remote.origin.url that points to GitHub AND has at least one remote-tracking branch. This
      avoids labeling repos "cloned" when the user simply did `git init` and later added a remote URL.
    """
    registry = load_registry()
    cloned_set = set()
    changed = False

    paths_to_check = []
    for repo_name, info in registry.items():
        repo_path = info.get("path")
        if not repo_path or not os.path.isdir(os.path.join(repo_path, ".git")):
            continue

        # If we already recorded owner/repo in registry (explicit registration), trust that
        owner = info.get("owner")
        repo = info.get("repo")
        if owner and repo:
            cloned_set.add(f"{owner.lower()}/{repo.lower()}")
        else:
            paths_to_check.append((repo_name, repo_path))

    # Also check workspace path if provided and not already in registry
    if workspace_path and workspace_path not in [info.get("path") for info in registry.values() if info.get("path")]:
        paths_to_check.append((workspace_path, workspace_path))

    for repo_name, repo_path in paths_to_check:
        if not repo_path or not os.path.isdir(os.path.join(repo_path, ".git")):
            continue

        remote_url = _get_remote_url(repo_path)
        local_owner, local_repo = _extract_owner_repo(remote_url)

        # Only treat as a cloned GitHub repo if a remote URL maps to owner/repo AND there are remote-tracking branches
        if local_owner and local_repo and _has_remote_tracking_branches(repo_path):
            cloned_set.add(f"{local_owner.lower()}/{local_repo.lower()}")

        # Update registry metadata for future faster checks (store owner/repo even if we don't mark cloned now)
        if repo_name:
            if repo_name not in registry:
                registry[repo_name] = {"path": repo_path}
            registry[repo_name]["owner"] = local_owner if local_owner else None
            registry[repo_name]["repo"] = local_repo if local_repo else None
            changed = True

    if changed:
        save_registry(registry)

    return cloned_set

def is_repo_cloned(owner: str, repo_name: str, workspace_path: str = None) -> bool:
    """Check if a specific GitHub repository is cloned."""
    if not owner or not repo_name:
        return False
    cloned_set = get_all_cloned_repos(workspace_path)
    return f"{owner.lower()}/{repo_name.lower()}" in cloned_set

def repo_exists_locally(repo_name: str) -> bool:
    """Legacy check if a repository exists locally in the registry purely by name."""
    return find_repo_by_name(repo_name) is not None


def get_repo_info(repo_name: str) -> Optional[Dict]:
    """Get full information about a registered repository."""
    registry = load_registry()
    
    if repo_name not in registry:
        return None
    
    repo_info = registry[repo_name]
    repo_path = repo_info.get("path")
    
    # Validate path still exists
    if not is_valid_git_repo(repo_path):
        del registry[repo_name]
        save_registry(registry)
        return None
    
    return {
        "name": repo_name,
        "path": repo_path,
        "clone_url": repo_info.get("clone_url"),
        "registered_at": repo_info.get("registered_at")
    }


def list_all_repos() -> Dict:
    """List all registered repositories."""
    registry = load_registry()
    valid_repos = {}
    changed = False
    
    # Filter out invalid paths
    for repo_name, repo_info in list(registry.items()):
        repo_path = repo_info.get("path")
        if is_valid_git_repo(repo_path):
            valid_repos[repo_name] = repo_info
        else:
            # Remove invalid entry
            del registry[repo_name]
            changed = True
    
    if changed:
        save_registry(registry)
    
    return valid_repos


def cleanup_registry() -> Dict:
    """
    Clean up the registry by removing entries with invalid paths.
    
    Returns:
        {"success": bool, "removed_count": int}
    """
    registry = load_registry()
    initial_count = len(registry)
    
    valid_registry = {}
    for repo_name, repo_info in registry.items():
        repo_path = repo_info.get("path")
        if is_valid_git_repo(repo_path):
            valid_registry[repo_name] = repo_info
    
    removed_count = initial_count - len(valid_registry)
    save_registry(valid_registry)
    
    return {
        "success": True,
        "removed_count": removed_count,
        "remaining_count": len(valid_registry)
    }


def _get_timestamp() -> str:
    """Get current timestamp in ISO format."""
    from datetime import datetime
    return datetime.now().isoformat()
