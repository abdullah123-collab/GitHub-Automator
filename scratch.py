import re

def extract_owner_repo(url: str):
    if not url:
        return "", ""
    # Remove .git suffix
    if url.endswith(".git"):
        url = url[:-4]
    
    # https://github.com/owner/repo
    # git@github.com:owner/repo
    # https://token@github.com/owner/repo
    
    match = re.search(r'github\.com[:/]([^/]+)/([^/]+)$', url)
    if match:
        return match.group(1).lower(), match.group(2).lower()
    return "", ""

urls = [
    "https://github.com/user/test-repo",
    "git@github.com:user/test-repo.git",
    "https://ghp_xxx@github.com/user/test-repo",
    "https://github.com/user/test-repo.git"
]

for u in urls:
    print(f"{u} -> {extract_owner_repo(u)}")
