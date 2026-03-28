from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field


class GitHubTokenLoginRequest(BaseModel):
    token: str = Field(min_length=10)


class OrbitCreateRequest(BaseModel):
    name: str
    description: str = ""
    logo: str | None = None
    private: bool = True
    invite_emails: list[str] = Field(default_factory=list)


class InviteRequest(BaseModel):
    email: str


class MessageCreateRequest(BaseModel):
    body: str


class DmMessageCreateRequest(BaseModel):
    body: str


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


class DashboardPayload(BaseModel):
    me: dict
    recent_orbits: list[dict]
    priority_items: list[dict]
    codespaces: list[dict]
    notifications: list[dict]


class OrbitPayload(BaseModel):
    orbit: dict
    members: list[dict]
    channels: list[dict]
    direct_messages: list[dict]
    messages: list[dict]
    workflow: dict
    prs: list[dict]
    issues: list[dict]
    codespaces: list[dict]
    demos: list[dict]
    navigation: dict | None = None


class TimestampedPayload(BaseModel):
    id: str
    created_at: datetime
