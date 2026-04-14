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


class AuthState(Base):
    __tablename__ = "product_auth_states"

    state: Mapped[str] = mapped_column(String(255), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    purpose: Mapped[str] = mapped_column(String(64), index=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)


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
    transport_state: Mapped[str] = mapped_column(String(64), default="local_only")
    transport_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class MatrixUserMapping(Base):
    __tablename__ = "product_matrix_user_mappings"
    __table_args__ = (
        UniqueConstraint("user_id", name="uq_product_matrix_user_mapping_user"),
        UniqueConstraint("matrix_user_id", name="uq_product_matrix_user_mapping_matrix_user"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("mxuser"))
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    matrix_user_id: Mapped[str] = mapped_column(String(255), index=True)
    matrix_localpart: Mapped[str] = mapped_column(String(255), index=True)
    latest_device_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class MatrixRoomBinding(Base):
    __tablename__ = "product_matrix_room_bindings"
    __table_args__ = (
        UniqueConstraint("channel_id", name="uq_product_matrix_room_binding_channel"),
        UniqueConstraint("dm_thread_id", name="uq_product_matrix_room_binding_dm"),
        UniqueConstraint("matrix_room_id", name="uq_product_matrix_room_binding_room"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("mxroom"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    channel_id: Mapped[str | None] = mapped_column(ForeignKey("product_channels.id"), nullable=True, index=True)
    dm_thread_id: Mapped[str | None] = mapped_column(ForeignKey("product_dm_threads.id"), nullable=True, index=True)
    matrix_room_id: Mapped[str] = mapped_column(String(255), index=True)
    room_kind: Mapped[str] = mapped_column(String(64), default="channel")
    provision_state: Mapped[str] = mapped_column(String(64), default="ready")
    last_event_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class MatrixMessageLink(Base):
    __tablename__ = "product_matrix_message_links"
    __table_args__ = (
        UniqueConstraint("message_id", name="uq_product_matrix_message_link_message"),
        UniqueConstraint("matrix_event_id", name="uq_product_matrix_message_link_event"),
        UniqueConstraint("matrix_txn_id", name="uq_product_matrix_message_link_txn"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("mxmsg"))
    message_id: Mapped[str] = mapped_column(ForeignKey("product_messages.id"), index=True)
    room_binding_id: Mapped[str] = mapped_column(ForeignKey("product_matrix_room_bindings.id"), index=True)
    matrix_event_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    matrix_txn_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    direction: Mapped[str] = mapped_column(String(64), default="outbound")
    send_state: Mapped[str] = mapped_column(String(64), default="queued")
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class MatrixSyncState(Base):
    __tablename__ = "product_matrix_sync_states"
    __table_args__ = (UniqueConstraint("worker_name", name="uq_product_matrix_sync_worker"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("mxsync"))
    worker_name: Mapped[str] = mapped_column(String(255), index=True)
    next_batch: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class MatrixMembershipState(Base):
    __tablename__ = "product_matrix_membership_states"
    __table_args__ = (
        UniqueConstraint("room_binding_id", "user_id", name="uq_product_matrix_membership_user"),
        UniqueConstraint("room_binding_id", "matrix_user_id", name="uq_product_matrix_membership_matrix_user"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("mxmember"))
    room_binding_id: Mapped[str] = mapped_column(ForeignKey("product_matrix_room_bindings.id"), index=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("product_users.id"), nullable=True, index=True)
    matrix_user_id: Mapped[str] = mapped_column(String(255), index=True)
    membership: Mapped[str] = mapped_column(String(64), default="join")
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


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
    source_channel_id: Mapped[str | None] = mapped_column(ForeignKey("product_channels.id"), nullable=True, index=True)
    source_dm_thread_id: Mapped[str | None] = mapped_column(ForeignKey("product_dm_threads.id"), nullable=True, index=True)
    repo_scope_mode: Mapped[str] = mapped_column(String(64), default="legacy_primary")
    current_agent: Mapped[str] = mapped_column(String(255), default="ERGO")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class PullRequestSnapshot(Base):
    __tablename__ = "product_pull_requests"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("pr"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    repository_connection_id: Mapped[str | None] = mapped_column(
        ForeignKey("product_repository_connections.id"),
        nullable=True,
        index=True,
    )
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
    repository_connection_id: Mapped[str | None] = mapped_column(
        ForeignKey("product_repository_connections.id"),
        nullable=True,
        index=True,
    )
    github_number: Mapped[int] = mapped_column(Integer, index=True)
    title: Mapped[str] = mapped_column(String(255))
    state: Mapped[str] = mapped_column(String(64), default="open")
    priority: Mapped[str] = mapped_column(String(64), default="medium")
    url: Mapped[str] = mapped_column(Text)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class OrbitCycle(Base):
    __tablename__ = "product_orbit_cycles"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("cycle"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    name: Mapped[str] = mapped_column(String(255))
    goal: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="active")
    starts_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    ends_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class OrbitIssue(Base):
    __tablename__ = "product_orbit_native_issues"
    __table_args__ = (UniqueConstraint("orbit_id", "sequence_no", name="uq_product_orbit_native_issue_seq"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("pmissue"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    cycle_id: Mapped[str | None] = mapped_column(ForeignKey("product_orbit_cycles.id"), nullable=True, index=True)
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    assignee_user_id: Mapped[str | None] = mapped_column(ForeignKey("product_users.id"), nullable=True, index=True)
    parent_issue_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    repository_connection_id: Mapped[str | None] = mapped_column(
        ForeignKey("product_repository_connections.id"),
        nullable=True,
        index=True,
    )
    sequence_no: Mapped[int] = mapped_column(Integer, index=True)
    title: Mapped[str] = mapped_column(String(255))
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="triage")
    priority: Mapped[str] = mapped_column(String(64), default="medium")
    source_kind: Mapped[str] = mapped_column(String(64), default="manual")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class IssueLabel(Base):
    __tablename__ = "product_issue_labels"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("label"))
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("product_users.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(128))
    slug: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    tone: Mapped[str] = mapped_column(String(32), default="muted")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class OrbitIssueLabel(Base):
    __tablename__ = "product_orbit_issue_labels"
    __table_args__ = (UniqueConstraint("issue_id", "label_id", name="uq_product_orbit_issue_label"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("issuelabel"))
    issue_id: Mapped[str] = mapped_column(ForeignKey("product_orbit_native_issues.id"), index=True)
    label_id: Mapped[str] = mapped_column(ForeignKey("product_issue_labels.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class OrbitIssueRelation(Base):
    __tablename__ = "product_orbit_issue_relations"
    __table_args__ = (
        UniqueConstraint("issue_id", "related_issue_id", "relation_kind", name="uq_product_orbit_issue_relation"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("issuerel"))
    issue_id: Mapped[str] = mapped_column(ForeignKey("product_orbit_native_issues.id"), index=True)
    related_issue_id: Mapped[str] = mapped_column(ForeignKey("product_orbit_native_issues.id"), index=True)
    relation_kind: Mapped[str] = mapped_column(String(64), index=True)
    created_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("product_users.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class SavedView(Base):
    __tablename__ = "product_saved_views"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("view"))
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    orbit_id: Mapped[str | None] = mapped_column(ForeignKey("product_orbits.id"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    filters_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Codespace(Base):
    __tablename__ = "product_codespaces"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("codespace"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    created_by_user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    repository_connection_id: Mapped[str | None] = mapped_column(
        ForeignKey("product_repository_connections.id"),
        nullable=True,
        index=True,
    )
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
    repository_connection_id: Mapped[str | None] = mapped_column(
        ForeignKey("product_repository_connections.id"),
        nullable=True,
        index=True,
    )
    title: Mapped[str] = mapped_column(String(255))
    source_path: Mapped[str] = mapped_column(Text)
    container_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="stopped")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class Artifact(Base):
    __tablename__ = "product_artifacts"
    __table_args__ = (
        UniqueConstraint("orbit_id", "source_kind", "source_id", name="uq_product_artifact_source"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("artifact"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    repository_connection_id: Mapped[str | None] = mapped_column(
        ForeignKey("product_repository_connections.id"),
        nullable=True,
        index=True,
    )
    work_item_id: Mapped[str | None] = mapped_column(ForeignKey("product_work_items.id"), nullable=True, index=True)
    workflow_run_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    source_kind: Mapped[str] = mapped_column(String(64))
    source_id: Mapped[str] = mapped_column(String(255), index=True)
    artifact_kind: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="draft")
    external_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class NavigationState(Base):
    __tablename__ = "product_navigation_states"
    __table_args__ = (UniqueConstraint("user_id", "orbit_id", name="uq_product_navigation_state"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("nav"))
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    orbit_id: Mapped[str | None] = mapped_column(ForeignKey("product_orbits.id"), nullable=True, index=True)
    section: Mapped[str] = mapped_column(String(64), default="inbox")
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


class IntegrationInstallation(Base):
    __tablename__ = "product_integration_installations"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("install"))
    provider: Mapped[str] = mapped_column(String(64), default="github")
    installation_kind: Mapped[str] = mapped_column(String(64), default="user_token_dev")
    installation_key: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    owner_user_id: Mapped[str | None] = mapped_column(ForeignKey("product_users.id"), nullable=True, index=True)
    display_name: Mapped[str] = mapped_column(String(255), default="Local development GitHub access")
    status: Mapped[str] = mapped_column(String(64), default="active")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RepositoryConnection(Base):
    __tablename__ = "product_repository_connections"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("repo"))
    provider: Mapped[str] = mapped_column(String(64), default="github")
    installation_id: Mapped[str | None] = mapped_column(
        ForeignKey("product_integration_installations.id"),
        nullable=True,
        index=True,
    )
    external_repo_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    owner_name: Mapped[str] = mapped_column(String(255))
    repo_name: Mapped[str] = mapped_column(String(255))
    full_name: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    url: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_private: Mapped[bool] = mapped_column(Boolean, default=True)
    default_branch: Mapped[str] = mapped_column(String(255), default="main")
    status: Mapped[str] = mapped_column(String(64), default="active")
    health_state: Mapped[str] = mapped_column(String(64), default="healthy")
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class OrbitRepositoryBinding(Base):
    __tablename__ = "product_orbit_repository_bindings"
    __table_args__ = (
        UniqueConstraint("orbit_id", "repository_connection_id", name="uq_product_orbit_repository_binding"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("binding"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    repository_connection_id: Mapped[str] = mapped_column(ForeignKey("product_repository_connections.id"), index=True)
    added_by_user_id: Mapped[str | None] = mapped_column(ForeignKey("product_users.id"), nullable=True, index=True)
    is_primary: Mapped[bool] = mapped_column(Boolean, default=False)
    status: Mapped[str] = mapped_column(String(64), default="active")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RepoGrant(Base):
    __tablename__ = "product_repo_grants"
    __table_args__ = (
        UniqueConstraint("orbit_id", "repository_connection_id", "user_id", name="uq_product_repo_grant"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("grant"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    repository_connection_id: Mapped[str] = mapped_column(ForeignKey("product_repository_connections.id"), index=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    grant_level: Mapped[str] = mapped_column(String(64), default="view")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class WorkItemRepoScope(Base):
    __tablename__ = "product_work_item_repo_scopes"
    __table_args__ = (
        UniqueConstraint("work_item_id", "repository_connection_id", name="uq_product_work_item_repo_scope"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("wscope"))
    work_item_id: Mapped[str] = mapped_column(ForeignKey("product_work_items.id"), index=True)
    repository_connection_id: Mapped[str] = mapped_column(ForeignKey("product_repository_connections.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RunRepoScope(Base):
    __tablename__ = "product_run_repo_scopes"
    __table_args__ = (
        UniqueConstraint("workflow_run_id", "repository_connection_id", name="uq_product_run_repo_scope"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("rscope"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    workflow_run_id: Mapped[str] = mapped_column(String(255), index=True)
    repository_connection_id: Mapped[str] = mapped_column(ForeignKey("product_repository_connections.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RuntimeRunProjection(Base):
    __tablename__ = "product_runtime_runs"
    __table_args__ = (
        UniqueConstraint("orbit_id", "workflow_run_id", name="uq_product_runtime_run"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("runview"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    workflow_run_id: Mapped[str] = mapped_column(String(255), index=True)
    work_item_id: Mapped[str | None] = mapped_column(ForeignKey("product_work_items.id"), nullable=True, index=True)
    source_channel_id: Mapped[str | None] = mapped_column(ForeignKey("product_channels.id"), nullable=True, index=True)
    source_dm_thread_id: Mapped[str | None] = mapped_column(ForeignKey("product_dm_threads.id"), nullable=True, index=True)
    title: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(64), default="created")
    operator_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    execution_status: Mapped[str | None] = mapped_column(String(64), nullable=True)
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    snapshot_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class RuntimeHumanLoopItem(Base):
    __tablename__ = "product_runtime_human_loop_items"
    __table_args__ = (
        UniqueConstraint("orbit_id", "request_id", name="uq_product_runtime_human_loop_item"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("loop"))
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    workflow_run_id: Mapped[str] = mapped_column(String(255), index=True)
    work_item_id: Mapped[str | None] = mapped_column(ForeignKey("product_work_items.id"), nullable=True, index=True)
    request_kind: Mapped[str] = mapped_column(String(64))
    request_id: Mapped[str] = mapped_column(String(255), index=True)
    task_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    task_key: Mapped[str | None] = mapped_column(String(255), nullable=True)
    source_channel_id: Mapped[str | None] = mapped_column(ForeignKey("product_channels.id"), nullable=True, index=True)
    source_dm_thread_id: Mapped[str | None] = mapped_column(ForeignKey("product_dm_threads.id"), nullable=True, index=True)
    status: Mapped[str] = mapped_column(String(64), default="open")
    title: Mapped[str] = mapped_column(String(255))
    detail: Mapped[str] = mapped_column(Text)
    response_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Notification(Base):
    __tablename__ = "product_notifications"
    __table_args__ = (
        UniqueConstraint("user_id", "source_kind", "source_id", name="uq_product_notification_source"),
    )

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("notif"))
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    orbit_id: Mapped[str | None] = mapped_column(ForeignKey("product_orbits.id"), nullable=True, index=True)
    channel_id: Mapped[str | None] = mapped_column(ForeignKey("product_channels.id"), nullable=True, index=True)
    dm_thread_id: Mapped[str | None] = mapped_column(ForeignKey("product_dm_threads.id"), nullable=True, index=True)
    kind: Mapped[str] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    detail: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(32), default="unread")
    source_kind: Mapped[str] = mapped_column(String(64))
    source_id: Mapped[str] = mapped_column(String(255), index=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationPreference(Base):
    __tablename__ = "product_notification_preferences"
    __table_args__ = (UniqueConstraint("user_id", name="uq_product_notification_preference"),)

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("npref"))
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    inbox_mode: Mapped[str] = mapped_column(String(32), default="mentions_only")
    dm_mode: Mapped[str] = mapped_column(String(32), default="all_activity")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class ConversationState(Base):
    __tablename__ = "product_conversation_states"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("cstate"))
    user_id: Mapped[str] = mapped_column(ForeignKey("product_users.id"), index=True)
    orbit_id: Mapped[str] = mapped_column(ForeignKey("product_orbits.id"), index=True)
    channel_id: Mapped[str | None] = mapped_column(ForeignKey("product_channels.id"), nullable=True, index=True)
    dm_thread_id: Mapped[str | None] = mapped_column(ForeignKey("product_dm_threads.id"), nullable=True, index=True)
    notification_mode: Mapped[str] = mapped_column(String(32), default="all_activity")
    last_read_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_seen_message_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)


class AuditEvent(Base):
    __tablename__ = "product_audit_events"

    id: Mapped[str] = mapped_column(String(64), primary_key=True, default=lambda: generate_id("audit"))
    orbit_id: Mapped[str | None] = mapped_column(ForeignKey("product_orbits.id"), nullable=True, index=True)
    actor_user_id: Mapped[str | None] = mapped_column(ForeignKey("product_users.id"), nullable=True, index=True)
    action_type: Mapped[str] = mapped_column(String(128))
    target_kind: Mapped[str] = mapped_column(String(64))
    target_id: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    metadata_json: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now)
