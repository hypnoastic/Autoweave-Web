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


class OrbitCycleCreateRequest(BaseModel):
    name: str
    goal: str | None = None
    status: str = "active"
    starts_at: datetime | None = None
    ends_at: datetime | None = None


class OrbitIssueCreateRequest(BaseModel):
    title: str
    detail: str | None = None
    priority: str = "medium"
    status: str = "triage"
    cycle_id: str | None = None
    assignee_user_id: str | None = None
    parent_issue_id: str | None = None
    labels: list[str] = Field(default_factory=list)
    blocked_by_issue_ids: list[str] = Field(default_factory=list)
    related_issue_ids: list[str] = Field(default_factory=list)
    duplicate_issue_ids: list[str] = Field(default_factory=list)


class OrbitIssueUpdateRequest(BaseModel):
    title: str | None = None
    detail: str | None = None
    priority: str | None = None
    status: str | None = None
    cycle_id: str | None = None
    assignee_user_id: str | None = None
    parent_issue_id: str | None = None
    labels: list[str] | None = None
    blocked_by_issue_ids: list[str] | None = None
    related_issue_ids: list[str] | None = None
    duplicate_issue_ids: list[str] | None = None


class SavedViewCreateRequest(BaseModel):
    name: str
    description: str | None = None
    orbit_id: str | None = None
    statuses: list[str] = Field(default_factory=list)
    priorities: list[str] = Field(default_factory=list)
    labels: list[str] = Field(default_factory=list)
    assignee_scope: str = "all"
    cycle_scope: str = "any"
    stale_only: bool = False
    relation_scope: str = "any"
    hierarchy_scope: str = "any"


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


class MyWorkPayload(BaseModel):
    me: dict
    summary: dict = Field(default_factory=dict)
    work_items: list[dict] = Field(default_factory=list)
    active_issues: list[dict] = Field(default_factory=list)
    blocked_issues: list[dict] = Field(default_factory=list)
    stale_issues: list[dict] = Field(default_factory=list)
    review_queue: list[dict] = Field(default_factory=list)
    native_issues: list[dict] = Field(default_factory=list)
    issue_labels: list[dict] = Field(default_factory=list)
    approvals: list[dict] = Field(default_factory=list)
    recent_orbits: list[dict] = Field(default_factory=list)
    codespaces: list[dict] = Field(default_factory=list)
    notifications: list[dict] = Field(default_factory=list)


class SavedViewsPayload(BaseModel):
    views: list[dict] = Field(default_factory=list)


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
    native_issues: list[dict] = Field(default_factory=list)
    issue_labels: list[dict] = Field(default_factory=list)
    cycles: list[dict] = Field(default_factory=list)
    codespaces: list[dict]
    demos: list[dict]
    artifacts: list[dict] = Field(default_factory=list)
    navigation: dict | None = None


class TimestampedPayload(BaseModel):
    id: str
    created_at: datetime
