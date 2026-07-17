import sys
sys.path.append('backend')
from services.repo_registry import is_repo_cloned, register_repo

print("Testing is_repo_cloned...")

# We can test by checking against the current workspace
print("github-automator cloned?", is_repo_cloned("abdullah123-collab", "GitHub-Automator"))
