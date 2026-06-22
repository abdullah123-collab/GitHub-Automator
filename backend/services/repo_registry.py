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
import subprocess
from pathlib import Path
from typing import Optional, Dict


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
            timeout=5
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
    
    Returns:
        {"success": bool, "message": str}
    """
    if not is_valid_git_repo(repo_path):
        return {
            "success": False,
            "message": f"Path is not a valid git repository: {repo_path}"
        }
    
    registry = load_registry()
    registry[repo_name] = {
        "path": repo_path,
        "clone_url": clone_url,
        "registered_at": _get_timestamp()
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


def repo_exists_locally(repo_name: str) -> bool:
    """Check if a repository exists locally in the registry."""
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
