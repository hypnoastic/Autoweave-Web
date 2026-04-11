from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class GitHubTokenLoginRequest(BaseModel):
    token: str = Field(min_length=10)


class GitHubAppInstallationClaimRequest(BaseModel):
    installation_id: int
    state: str = Field(min_length=8)
    setup_action: str | None = None


class OrbitCreateRequest(BaseModel):
    name: str
    description: str = ""
    logo: str | None = None
    private: bool = True
    invite_emails: list[str] = Field(default_factory=list)


class InviteRequest(BaseModel):
    email: str


class OrbitMemberRoleUpdateRequest(BaseModel):
    role: str


class OrbitRepositoryConnectRequest(BaseModel):
    repo_full_name: str
    make_primary: bool = False


class MessageCreateRequest(BaseModel):
    body: str


class DmMessageCreateRequest(BaseModel):
    body: str


class ChannelCreateRequest(BaseModel):
    name: str
    slug: str | None = None


class DmThreadCreateRequest(BaseModel):
    target_kind: str = "member"
    target_login: str | None = None
    target_user_id: str | None = None
    target_agent: str | None = None


class UserPreferencesUpdateRequest(BaseModel):
    theme_preference: str = Field(default="system")


class CodespaceCreateRequest(BaseModel):
    name: str
    branch_name: str | None = None


class DemoPublishRequest(BaseModel):
    title: str
    source_path: str
    work_item_id: str | None = None


class NavigationStateRequest(BaseModel):
    orbit_id: str | None = None
    section: str


class WorkflowHumanAnswerRequest(BaseModel):
    workflow_run_id: str
    request_id: str
    answer_text: str


class WorkflowApprovalRequest(BaseModel):
    workflow_run_id: str
    request_id: str
    approved: bool


class SessionPayload(BaseModel):
    token: str
    user: dict


class UserPreferencesPayload(BaseModel):
    theme_preference: str


class DashboardPayload(BaseModel):
    me: dict
    recent_orbits: list[dict]
    priority_items: list[dict]
    codespaces: list[dict]
    notifications: list[dict]


class InboxPayload(BaseModel):
    me: dict
    summary: dict = Field(default_factory=dict)
    briefing: dict = Field(default_factory=dict)
    items: list[dict] = Field(default_factory=list)
    scopes: list[dict] = Field(default_factory=list)
    active_scope: dict | None = None
    notifications: list[dict] = Field(default_factory=list)


class OrbitPayload(BaseModel):
    orbit: dict
    repositories: list[dict] = Field(default_factory=list)
    members: list[dict]
    channels: list[dict]
    direct_messages: list[dict]
    messages: list[dict]
    human_loop_items: list[dict] = Field(default_factory=list)
    notifications: list[dict] = Field(default_factory=list)
    permissions: dict | None = None
    workflow: dict
    prs: list[dict]
    issues: list[dict]
    codespaces: list[dict]
    demos: list[dict]
    artifacts: list[dict] = Field(default_factory=list)
    navigation: dict | None = None


class TimestampedPayload(BaseModel):
    id: str
    created_at: datetime
