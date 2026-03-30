from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from autoweave_web.db.session import Base, generate_id, utc_now


class User(Base):
    __tablename__ = "product_users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("user"))
    github_login: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    github_user_id: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    display_name: Mapped[str] = mapped_column(String(255))
    avatar_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    access_token: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SessionToken(Base):
    __tablename__ = "product_sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("session"))
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class UserPreference(Base):
    __tablename__ = "product_user_preferences"
    __table_args__ = (UniqueConstraint("user_id", name="uq_product_user_preference"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("pref"))
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    theme_preference: Mapped[str] = mapped_column(String(32), default="system")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Orbit(Base):
    __tablename__ = "product_orbits"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("orbit"))
    slug: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str] = mapped_column(Text, default="")
    logo: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    repo_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    repo_full_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    repo_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    repo_private: Mapped[bool] = mapped_column(Boolean, default=True)
    default_branch: Mapped[str] = mapped_column(String(255), default="main")
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class OrbitMembership(Base):
    __tablename__ = "product_orbit_memberships"
    __table_args__ = (UniqueConstraint("orbit_id", "user_id", name="uq_product_orbit_member"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("membership"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    role: Mapped[str] = mapped_column(String(64), default="member")
    introduced: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class OrbitInvite(Base):
    __tablename__ = "product_orbit_invites"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("invite"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    invited_by_user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"))
    email: Mapped[str] = mapped_column(String(255), index=True)
    token: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    status: Mapped[str] = mapped_column(String(64), default="pending")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Channel(Base):
    __tablename__ = "product_channels"
    __table_args__ = (UniqueConstraint("orbit_id", "slug", name="uq_product_channel_slug"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("channel"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    slug: Mapped[str] = mapped_column(String(255))
    name: Mapped[str] = mapped_column(String(255))
    kind: Mapped[str] = mapped_column(String(64), default="channel")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DmThread(Base):
    __tablename__ = "product_dm_threads"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("dm"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class DmParticipant(Base):
    __tablename__ = "product_dm_participants"
    __table_args__ = (UniqueConstraint("thread_id", "user_id", name="uq_product_dm_participant"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("dmp"))
    thread_id: Mapped[str] = mapped_column(ForeignKey("product_dm_threads.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Message(Base):
    __tablename__ = "product_messages"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("msg"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    channel_id: Mapped[str | None] = mapped_column(ForeignKey("product_channels.id"), nullable=True, index=True)
    dm_thread_id: Mapped[str | None] = mapped_column(ForeignKey("product_dm_threads.id"), nullable=True, index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("product_users.id"), nullable=True, index=True)
    author_kind: Mapped[str] = mapped_column(String(32), default="user")
    author_name: Mapped[str] = mapped_column(String(255))
    body: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkItem(Base):
    __tablename__ = "product_work_items"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("work"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    requested_by_user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    title: Mapped[str] = mapped_column(String(255))
    request_text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(64), default="ready")
    branch_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    draft_pr_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    workflow_run_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    current_agent: Mapped[str] = mapped_column(String(255), default="ERGO")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PullRequestSnapshot(Base):
    __tablename__ = "product_pull_requests"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("pr"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    github_number: Mapped[int] = mapped_column(Integer, index=True)
    title: Mapped[str] = mapped_column(String(255))
    state: Mapped[str] = mapped_column(String(64), default="open")
    priority: Mapped[str] = mapped_column(String(64), default="medium")
    url: Mapped[str] = mapped_column(Text)
    branch_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class IssueSnapshot(Base):
    __tablename__ = "product_issues"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("issue"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    github_number: Mapped[int] = mapped_column(Integer, index=True)
    title: Mapped[str] = mapped_column(String(255))
    state: Mapped[str] = mapped_column(String(64), default="open")
    priority: Mapped[str] = mapped_column(String(64), default="medium")
    url: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Codespace(Base):
    __tablename__ = "product_codespaces"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("codespace"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    branch_name: Mapped[str] = mapped_column(String(255))
    workspace_path: Mapped[str] = mapped_column(Text)
    container_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    editor_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="provisioning")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Demo(Base):
    __tablename__ = "product_demos"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("demo"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    work_item_id: Mapped[str | None] = mapped_column(ForeignKey("product_work_items.id"), nullable=True, index=True)
    title: Mapped[str] = mapped_column(String(255))
    source_path: Mapped[str] = mapped_column(Text)
    container_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="stopped")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class NavigationState(Base):
    __tablename__ = "product_navigation_states"
    __table_args__ = (UniqueConstraint("user_id", "orbit_id", name="uq_product_navigation_state"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("nav"))
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    orbit_id: Mapped[str | None] = mapped_column(ForeignKey("product_orbits.id"), nullable=True, index=True)
    section: Mapped[str] = mapped_column(String(64), default="dashboard")
    last_opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ContextProjection(Base):
    __tablename__ = "product_context_projections"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("ctx"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    source_kind: Mapped[str] = mapped_column(String(64))
    source_id: Mapped[str] = mapped_column(String(255), index=True)
    summary: Mapped[str] = mapped_column(Text)
    references_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ProductEvent(Base):
    __tablename__ = "product_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("evt"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    event_type: Mapped[str] = mapped_column(String(128))
    payload_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
