from __future__ import annotations

import base64
from datetime import datetime, timedelta, timezone
import httpx
import json
from pathlib import Path
import subprocess
import tempfile

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

    def _app_headers(self, jwt_token: str) -> dict[str, str]:
        return {
            "Accept": "application/vnd.github+json",
            "Authorization": f"Bearer {jwt_token}",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    def _load_github_app_private_key(self) -> str:
        inline_key = self.settings.github_app_private_key.strip()
        if inline_key:
            return inline_key.replace("\\n", "\n")
        key_path = self.settings.github_app_private_key_file.strip()
        if not key_path:
            raise RuntimeError("GitHub App private key is not configured.")
        return Path(key_path).expanduser().read_text(encoding="utf-8")

    def create_github_app_jwt(self) -> str:
        if not self.settings.github_app_is_configured:
            raise RuntimeError("GitHub App credentials are not configured.")
        issued_at = datetime.now(timezone.utc)
        payload = {
            "iat": int((issued_at - timedelta(seconds=60)).timestamp()),
            "exp": int((issued_at + timedelta(minutes=9)).timestamp()),
            "iss": self.settings.github_app_id.strip(),
        }
        header_segment = self._b64url_json({"alg": "RS256", "typ": "JWT"})
        payload_segment = self._b64url_json(payload)
        signing_input = f"{header_segment}.{payload_segment}".encode("utf-8")
        signature = self._sign_github_app_jwt(signing_input)
        signature_segment = base64.urlsafe_b64encode(signature).rstrip(b"=").decode("utf-8")
        return f"{header_segment}.{payload_segment}.{signature_segment}"

    def _b64url_json(self, payload: dict) -> str:
        raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("utf-8")

    def _sign_github_app_jwt(self, signing_input: bytes) -> bytes:
        private_key = self._load_github_app_private_key()
        with tempfile.NamedTemporaryFile("w", delete=False, encoding="utf-8", prefix="autoweave-gh-app-", suffix=".pem") as handle:
            handle.write(private_key)
            temp_path = handle.name
        try:
            result = subprocess.run(
                ["openssl", "dgst", "-binary", "-sha256", "-sign", temp_path],
                input=signing_input,
                capture_output=True,
                check=True,
            )
        except FileNotFoundError as exc:
            raise RuntimeError("OpenSSL is required to sign GitHub App tokens in this environment.") from exc
        finally:
            Path(temp_path).unlink(missing_ok=True)
        return result.stdout

    def get_app_installation(self, installation_id: int | str) -> dict:
        jwt_token = self.create_github_app_jwt()
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{self.settings.github_api_base_url}/app/installations/{installation_id}",
                headers=self._app_headers(jwt_token),
            )
            response.raise_for_status()
            return response.json()

    def create_installation_access_token(self, installation_id: int | str) -> str:
        jwt_token = self.create_github_app_jwt()
        with httpx.Client(timeout=30.0) as client:
            response = client.post(
                f"{self.settings.github_api_base_url}/app/installations/{installation_id}/access_tokens",
                headers=self._app_headers(jwt_token),
            )
            response.raise_for_status()
            payload = response.json()
        token = str(payload.get("token") or "").strip()
        if not token:
            raise RuntimeError("GitHub App installation token response did not include a token.")
        return token

    def list_installation_repositories(self, token: str, *, per_page: int = 100) -> list[dict]:
        with httpx.Client(timeout=30.0) as client:
            response = client.get(
                f"{self.settings.github_api_base_url}/installation/repositories",
                headers=self._headers(token),
                params={"per_page": min(max(per_page, 1), 100)},
            )
            response.raise_for_status()
            payload = response.json()
        return list(payload.get("repositories") or [])

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
