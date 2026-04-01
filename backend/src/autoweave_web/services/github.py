from __future__ import annotations

import httpx

from autoweave_web.core.settings import Settings


class GitHubGateway:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    def _headers(self, token: str) -> dict[str, str]:
        return {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def get_authenticated_user(self, token: str) -> dict:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(f"{self.settings.github_api_base_url}/user", headers=self._headers(token))
            response.raise_for_status()
            return response.json()

    def get_primary_email(self, token: str) -> str | None:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(f"{self.settings.github_api_base_url}/user/emails", headers=self._headers(token))
            if response.status_code >= 400:
                return None
            emails = response.json()
        for item in emails:
            if item.get("primary"):
                return item.get("email")
        return emails[0]["email"] if emails else None

    def create_repository(self, token: str, *, name: str, description: str, private: bool) -> dict:
        payload = {"name": name, "description": description, "private": private, "auto_init": True}
        with httpx.Client(timeout=60.0) as client:
            response = client.post(f"{self.settings.github_api_base_url}/user/repos", headers=self._headers(token), json=payload)
            response.raise_for_status()
            return response.json()

    def list_repositories(self, token: str, *, per_page: int = 100) -> list[dict]:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{self.settings.github_api_base_url}/user/repos",
                headers=self._headers(token),
                params={
                    "per_page": min(max(per_page, 1), 100),
                    "sort": "updated",
                    "affiliation": "owner,collaborator,organization_member",
                },
            )
            response.raise_for_status()
            return response.json()

    def get_repository(self, token: str, repo_full_name: str) -> dict:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{self.settings.github_api_base_url}/repos/{repo_full_name}",
                headers=self._headers(token),
            )
            response.raise_for_status()
            return response.json()

    def list_pull_requests(self, token: str, repo_full_name: str) -> list[dict]:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{self.settings.github_api_base_url}/repos/{repo_full_name}/pulls",
                headers=self._headers(token),
                params={"state": "open", "per_page": 50},
            )
            response.raise_for_status()
            return response.json()

    def list_issues(self, token: str, repo_full_name: str) -> list[dict]:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{self.settings.github_api_base_url}/repos/{repo_full_name}/issues",
                headers=self._headers(token),
                params={"state": "open", "per_page": 50},
            )
            response.raise_for_status()
            return response.json()

    def get_branch_sha(self, token: str, repo_full_name: str, branch_name: str) -> str:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{self.settings.github_api_base_url}/repos/{repo_full_name}/git/ref/heads/{branch_name}",
                headers=self._headers(token),
            )
            response.raise_for_status()
            return response.json()["object"]["sha"]

    def create_branch(self, token: str, repo_full_name: str, *, branch_name: str, base_branch: str) -> None:
        sha = self.get_branch_sha(token, repo_full_name, base_branch)
        payload = {"ref": f"refs/heads/{branch_name}", "sha": sha}
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{self.settings.github_api_base_url}/repos/{repo_full_name}/git/refs",
                headers=self._headers(token),
                json=payload,
            )
            if response.status_code not in {201, 422}:
                response.raise_for_status()

    def create_draft_pull_request(
        self,
        token: str,
        repo_full_name: str,
        *,
        title: str,
        head: str,
        base: str,
        body: str,
    ) -> dict:
        payload = {"title": title, "head": head, "base": base, "body": body, "draft": True}
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{self.settings.github_api_base_url}/repos/{repo_full_name}/pulls",
                headers=self._headers(token),
                json=payload,
            )
            if response.status_code == 422:
                return {"html_url": None}
            response.raise_for_status()
            return response.json()

    def add_collaborator(self, token: str, repo_full_name: str, github_login: str) -> None:
        with httpx.Client(timeout=30.0) as client:
            response = client.put(
                f"{self.settings.github_api_base_url}/repos/{repo_full_name}/collaborators/{github_login}",
                headers=self._headers(token),
                json={"permission": "push"},
            )
            if response.status_code not in {201, 204}:
                response.raise_for_status()
