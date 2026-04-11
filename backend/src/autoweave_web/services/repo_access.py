from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from autoweave_web.models.entities import IntegrationInstallation, RepositoryConnection, User
from autoweave_web.services.github import GitHubGateway
from autoweave_web.services.product_state import (
    active_github_app_installation_for_user,
    ensure_installation_for_user,
    fallback_github_app_installation,
)


@dataclass(frozen=True)
class RepositoryAccessContext:
    installation: IntegrationInstallation | None
    token: str
    mode: str


class RepositoryAccessService:
    def __init__(self, github: GitHubGateway) -> None:
        self.github = github

    def _context_for_installation(
        self,
        db: Session,
        *,
        actor_user: User,
        installation: IntegrationInstallation | None,
    ) -> RepositoryAccessContext:
        if installation is not None and installation.installation_kind == "github_app_installation":
            installation_id = installation.metadata_json.get("installation_id")
            if installation_id is None:
                raise RuntimeError("The configured GitHub App installation is missing an installation id.")
            token = self.github.create_installation_access_token(installation_id)
            return RepositoryAccessContext(installation=installation, token=token, mode="github_app_installation")
        if installation is not None and installation.installation_kind == "user_token_dev":
            owner = db.get(User, installation.owner_user_id) if installation.owner_user_id else actor_user
            if owner is None or not owner.access_token:
                raise RuntimeError("The configured repository installation is missing a usable token.")
            return RepositoryAccessContext(installation=installation, token=owner.access_token, mode="user_token_dev")
        if actor_user.access_token:
            return RepositoryAccessContext(installation=installation, token=actor_user.access_token, mode="actor_token_fallback")
        raise RuntimeError("No repository access token is available for this action.")

    def context_for_user(self, db: Session, *, user: User) -> RepositoryAccessContext:
        installation = active_github_app_installation_for_user(db, user) or fallback_github_app_installation(db)
        if installation is None:
            installation = ensure_installation_for_user(db, user)
        return self._context_for_installation(db, actor_user=user, installation=installation)

    def account_context_for_user(self, db: Session, *, user: User) -> RepositoryAccessContext:
        installation = ensure_installation_for_user(db, user)
        return self._context_for_installation(db, actor_user=user, installation=installation)

    def context_for_repository(
        self,
        db: Session,
        *,
        actor_user: User,
        repository: RepositoryConnection,
    ) -> RepositoryAccessContext:
        installation = db.get(IntegrationInstallation, repository.installation_id) if repository.installation_id else None
        return self._context_for_installation(db, actor_user=actor_user, installation=installation)

    def create_repository(
        self,
        db: Session,
        *,
        user: User,
        name: str,
        description: str,
        private: bool,
    ) -> tuple[RepositoryAccessContext, dict[str, Any]]:
        context = self.account_context_for_user(db, user=user)
        return context, self.github.create_repository(context.token, name=name, description=description, private=private)

    def list_accessible_repositories(self, db: Session, *, user: User) -> tuple[RepositoryAccessContext, list[dict[str, Any]]]:
        context = self.context_for_user(db, user=user)
        if context.mode == "github_app_installation":
            return context, self.github.list_installation_repositories(context.token)
        return context, self.github.list_repositories(context.token)

    def get_repository(
        self,
        db: Session,
        *,
        user: User,
        repo_full_name: str,
    ) -> tuple[RepositoryAccessContext, dict[str, Any]]:
        context = self.context_for_user(db, user=user)
        return context, self.github.get_repository(context.token, repo_full_name)

    def list_pull_requests(self, db: Session, *, actor_user: User, repository: RepositoryConnection) -> list[dict[str, Any]]:
        context = self.context_for_repository(db, actor_user=actor_user, repository=repository)
        return self.github.list_pull_requests(context.token, repository.full_name)

    def list_issues(self, db: Session, *, actor_user: User, repository: RepositoryConnection) -> list[dict[str, Any]]:
        context = self.context_for_repository(db, actor_user=actor_user, repository=repository)
        return self.github.list_issues(context.token, repository.full_name)

    def create_branch(
        self,
        db: Session,
        *,
        actor_user: User,
        repository: RepositoryConnection,
        branch_name: str,
        base_branch: str,
    ) -> None:
        context = self.context_for_repository(db, actor_user=actor_user, repository=repository)
        self.github.create_branch(context.token, repository.full_name, branch_name=branch_name, base_branch=base_branch)

    def create_draft_pull_request(
        self,
        db: Session,
        *,
        actor_user: User,
        repository: RepositoryConnection,
        title: str,
        head: str,
        base: str,
        body: str,
    ) -> dict[str, Any]:
        context = self.context_for_repository(db, actor_user=actor_user, repository=repository)
        return self.github.create_draft_pull_request(
            context.token,
            repository.full_name,
            title=title,
            head=head,
            base=base,
            body=body,
        )

    def add_collaborator(
        self,
        db: Session,
        *,
        actor_user: User,
        repository: RepositoryConnection,
        github_login: str,
    ) -> None:
        context = self.context_for_repository(db, actor_user=actor_user, repository=repository)
        self.github.add_collaborator(context.token, repository.full_name, github_login)

    def clone_url(
        self,
        db: Session,
        *,
        actor_user: User,
        repository: RepositoryConnection,
    ) -> str:
        context = self.context_for_repository(db, actor_user=actor_user, repository=repository)
        return f"https://x-access-token:{context.token}@github.com/{repository.full_name}.git"
