"""
github_api.py — Reusable GitHub API helper for Python backend scripts.
Used by other scripts (commit gen, README gen, etc.) in later phases.

No external dependencies — uses only Python standard library.
"""

import json
import urllib.request
import urllib.error

BASE_URL = "https://api.github.com"


class GitHubAPI:
    def __init__(self, token: str):
        self.token = token
        self.headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json"
        }

    def get(self, endpoint: str) -> dict:
        req = urllib.request.Request(
            f"{BASE_URL}{endpoint}",
            headers=self.headers
        )
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode())

    def post(self, endpoint: str, data: dict) -> dict:
        payload = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{BASE_URL}{endpoint}",
            data=payload,
            headers=self.headers,
            method="POST"
        )
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode())

    def patch(self, endpoint: str, data: dict) -> dict:
        payload = json.dumps(data).encode()
        req = urllib.request.Request(
            f"{BASE_URL}{endpoint}",
            data=payload,
            headers=self.headers,
            method="PATCH"
        )
        with urllib.request.urlopen(req) as res:
            return json.loads(res.read().decode())

    def delete(self, endpoint: str) -> bool:
        req = urllib.request.Request(
            f"{BASE_URL}{endpoint}",
            headers=self.headers,
            method="DELETE"
        )
        try:
            urllib.request.urlopen(req)
            return True
        except urllib.error.HTTPError:
            return False

    # ── Convenience methods (used by Phase 2+) ────────────────────

    def get_user(self) -> dict:
        return self.get("/user")

    def list_repos_page(self, per_page: int = 100, page: int = 1) -> list:
        return self.get(f"/user/repos?sort=updated&per_page={per_page}&page={page}")

    def list_repos(self, per_page: int = 100, max_pages: int = 5) -> list:
        all_repos = []
        for page in range(1, max_pages + 1):
            repos = self.list_repos_page(per_page, page)
            if not repos:
                break
            all_repos.extend(repos)
            if len(repos) < per_page:
                break
        return all_repos

    def create_repo(self, name: str, private: bool = False, description: str = "", auto_init: bool = True) -> dict:
        return self.post("/user/repos", {
            "name": name,
            "private": private,
            "description": description,
            "auto_init": auto_init
        })

    def update_repo(self, owner: str, repo: str, data: dict) -> dict:
        return self.patch(f"/repos/{owner}/{repo}", data)

    def delete_repo(self, owner: str, repo: str) -> bool:
        return self.delete(f"/repos/{owner}/{repo}")
