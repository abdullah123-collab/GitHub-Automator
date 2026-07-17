import sys
sys.path.append('backend')
from services.repo_registry import is_repo_cloned

print("Testing is_repo_cloned with workspace_path...")
result = is_repo_cloned("abdullah123-collab", "GitHub-Automator", workspace_path=r"i:\github-automator")
print("github-automator cloned?", result)
