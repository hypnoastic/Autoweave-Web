from __future__ import annotations

from dataclasses import dataclass


ORBIT_ROLE_OWNER = "owner"
ORBIT_ROLE_MANAGER = "manager"
ORBIT_ROLE_CONTRIBUTOR = "contributor"
ORBIT_ROLE_VIEWER = "viewer"
ORBIT_ROLE_MEMBER_ALIAS = "member"

REPO_GRANT_VIEW = "view"
REPO_GRANT_OPERATE = "operate"
REPO_GRANT_ADMIN = "admin"

APPROVAL_STATUSES = {"requested", "approved", "rejected", "cancelled"}

_ROLE_ALIASES = {
    ORBIT_ROLE_MEMBER_ALIAS: ORBIT_ROLE_CONTRIBUTOR,
}

_ROLE_PRIORITY = {
    ORBIT_ROLE_VIEWER: 10,
    ORBIT_ROLE_CONTRIBUTOR: 20,
    ORBIT_ROLE_MANAGER: 30,
    ORBIT_ROLE_OWNER: 40,
}

_REPO_GRANT_PRIORITY = {
    REPO_GRANT_VIEW: 10,
    REPO_GRANT_OPERATE: 20,
    REPO_GRANT_ADMIN: 30,
}


def normalize_orbit_role(value: str | None) -> str:
    normalized = str(value or ORBIT_ROLE_VIEWER).strip().lower()
    return _ROLE_ALIASES.get(normalized, normalized)


def normalize_repo_grant(value: str | None) -> str:
    normalized = str(value or REPO_GRANT_VIEW).strip().lower()
    if normalized not in _REPO_GRANT_PRIORITY:
        return REPO_GRANT_VIEW
    return normalized


def role_at_least(current_role: str | None, required_role: str) -> bool:
    return _ROLE_PRIORITY.get(normalize_orbit_role(current_role), 0) >= _ROLE_PRIORITY.get(required_role, 0)


def repo_grant_at_least(current_grant: str | None, required_grant: str) -> bool:
    return _REPO_GRANT_PRIORITY.get(normalize_repo_grant(current_grant), 0) >= _REPO_GRANT_PRIORITY.get(required_grant, 0)


@dataclass(frozen=True)
class OrbitPermissionSnapshot:
    orbit_role: str
    repo_grants: dict[str, str]

    def can_manage_members(self) -> bool:
        return role_at_least(self.orbit_role, ORBIT_ROLE_MANAGER)

    def can_manage_settings(self) -> bool:
        return role_at_least(self.orbit_role, ORBIT_ROLE_MANAGER)

    def can_manage_integrations(self) -> bool:
        return role_at_least(self.orbit_role, ORBIT_ROLE_OWNER)

    def can_bind_repo(self) -> bool:
        return role_at_least(self.orbit_role, ORBIT_ROLE_OWNER)

    def can_publish_artifact(self) -> bool:
        return role_at_least(self.orbit_role, ORBIT_ROLE_MANAGER)

    def can_trigger_run_for_repos(self, repository_ids: list[str]) -> bool:
        if not role_at_least(self.orbit_role, ORBIT_ROLE_CONTRIBUTOR):
            return False
        return all(repo_grant_at_least(self.repo_grants.get(repository_id), REPO_GRANT_OPERATE) for repository_id in repository_ids)

    def can_resolve_approval_for_repos(self, repository_ids: list[str]) -> bool:
        if not role_at_least(self.orbit_role, ORBIT_ROLE_MANAGER):
            return False
        return all(repo_grant_at_least(self.repo_grants.get(repository_id), REPO_GRANT_OPERATE) for repository_id in repository_ids)
