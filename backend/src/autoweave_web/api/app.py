from __future__ import annotations

import logging
import re
import secrets
import smtplib
from datetime import datetime, timedelta
from email.message import EmailMessage
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy import delete, func, select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from autoweave_web.core.settings import Settings, get_settings
from autoweave_web.db.session import get_db, init_database, utc_now
from autoweave_web.models.entities import (
    AuthState,
    AuditEvent,
    Artifact,
    Channel,
    Codespace,
    Demo,
    DmParticipant,
    DmThread,
    IntegrationInstallation,
    IssueLabel,
    IssueSnapshot,
    Message,
    NavigationState,
    Notification,
    Orbit,
    OrbitCycle,
    OrbitInvite,
    OrbitIssue,
    OrbitIssueLabel,
    OrbitIssueRelation,
    OrbitMembership,
    OrbitRepositoryBinding,
    MatrixRoomBinding,
    RepoGrant,
    PullRequestSnapshot,
    RepositoryConnection,
    RuntimeHumanLoopItem,
    RuntimeRunProjection,
    SavedView,
    SessionToken,
    User,
    UserPreference,
    WorkItem,
)
from autoweave_web.schemas.api import (
    ChannelCreateRequest,
    CodespaceCreateRequest,
    DashboardPayload,
    DemoPublishRequest,
    DmThreadCreateRequest,
    DmMessageCreateRequest,
    GitHubAppInstallationClaimRequest,
    GitHubTokenLoginRequest,
    InboxPayload,
    InviteRequest,
    LocalSessionBootstrapRequest,
    MessageCreateRequest,
    MyWorkPayload,
    NavigationStateRequest,
    PlanningCyclesPayload,
    OrbitCycleCreateRequest,
    OrbitCycleUpdateRequest,
    OrbitCreateRequest,
    OrbitIssueCreateRequest,
    OrbitIssueUpdateRequest,
    OrbitMemberRoleUpdateRequest,
    OrbitRepositoryConnectRequest,
    OrbitPayload,
    SessionPayload,
    SavedViewCreateRequest,
    SavedViewUpdateRequest,
    SavedViewsPayload,
    TimestampedPayload,
    UserPreferencesPayload,
    UserPreferencesUpdateRequest,
    WorkflowApprovalRequest,
    WorkflowHumanAnswerRequest,
)
from autoweave_web.services.containers import ContainerOrchestrator
from autoweave_web.services.context import ingest_product_event
from autoweave_web.services.flags import flag_enabled
from autoweave_web.services.github import GitHubGateway
from autoweave_web.services.navigation import NavigationStore
from autoweave_web.services.repo_access import RepositoryAccessService
from autoweave_web.services.product_state import (
    artifacts_for_orbit,
    bind_repository_to_orbit,
    create_message_notifications,
    ensure_matrix_user_mapping,
    matrix_message_link_for_message,
    matrix_room_binding_for_conversation,
    upsert_matrix_message_link,
    ensure_primary_repo_binding,
    ensure_repo_grant,
    ensure_run_repo_scope,
    ensure_work_item_repo_scope,
    human_loop_items_for_conversation,
    human_loop_submission_receipt,
    mark_conversation_seen,
    notify_artifact_generated,
    notifications_for_user,
    permission_snapshot_for_user,
    primary_repository_for_orbit,
    record_audit_event,
    record_human_loop_submission,
    repositories_for_orbit,
    repository_ids_for_work_item,
    repository_ids_for_run,
    runtime_human_loop_item_for_request,
    serialize_permission_snapshot,
    sync_runtime_projection,
    upsert_artifact,
    upsert_repository_connection,
    set_primary_repository_binding,
)
from autoweave_web.services.matrix import (
    MatrixProvisioningService,
    MatrixService,
    MatrixTransportError,
    matrix_txn_id_for_message,
)
from autoweave_web.services.policy import (
    ORBIT_ROLE_CONTRIBUTOR,
    ORBIT_ROLE_MANAGER,
    ORBIT_ROLE_OWNER,
    ORBIT_ROLE_VIEWER,
    normalize_orbit_role,
    role_at_least,
)
from autoweave_web.services.runtime import RuntimeManager, slugify

logger = logging.getLogger(__name__)
ORBIT_HOT_READ_MESSAGE_LIMIT = 120
ORBIT_ISSUE_STATUS_ORDER = (
    "triage",
    "backlog",
    "planned",
    "in_progress",
    "in_review",
    "ready_to_merge",
    "done",
    "canceled",
)
ORBIT_ISSUE_RELATION_KINDS = ("blocked_by", "related", "duplicate")
SAVED_VIEW_PRIORITY_ORDER = ("low", "medium", "high", "urgent")
SAVED_VIEW_RELATION_SCOPES = ("any", "blocked", "related")
SAVED_VIEW_HIERARCHY_SCOPES = ("any", "root", "parent", "child")
STALE_WORKING_DAY_THRESHOLD = 3
ISSUE_LABEL_TONES = ("accent", "warning", "success", "muted")


def create_app(
    *,
    settings: Settings | None = None,
    github: GitHubGateway | None = None,
    runtime_manager: RuntimeManager | None = None,
    navigation: NavigationStore | None = None,
    containers: ContainerOrchestrator | None = None,
    matrix_service: MatrixService | None = None,
    matrix_provisioning: MatrixProvisioningService | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    init_database()

    app = FastAPI(title=settings.app_name)
    cors_origins = sorted(
        {
            settings.frontend_base_url.rstrip("/"),
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        }
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    github = github or GitHubGateway(settings)
    repo_access = RepositoryAccessService(github)
    runtime_manager = runtime_manager or RuntimeManager(settings)
    navigation = navigation or NavigationStore(settings.redis_url, ttl_seconds=settings.navigation_ttl_seconds)
    containers = containers or ContainerOrchestrator(settings)
    matrix_service = matrix_service or MatrixService(settings)
    matrix_provisioning = matrix_provisioning or MatrixProvisioningService(settings, matrix_service)

    app.state.settings = settings
    app.state.github = github
    app.state.repo_access = repo_access
    app.state.runtime_manager = runtime_manager
    app.state.navigation = navigation
    app.state.containers = containers
    app.state.matrix_service = matrix_service
    app.state.matrix_provisioning = matrix_provisioning

    def current_user(
        authorization: str | None = Header(default=None),
        db: Session = Depends(get_db),
    ) -> User:
        if not authorization or not authorization.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Missing session token")
        token = authorization.removeprefix("Bearer ").strip()
        session = db.scalar(select(SessionToken).where(SessionToken.token == token))
        if session is None:
            raise HTTPException(status_code=401, detail="Invalid session token")
        expires_at = session.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=utc_now().tzinfo)
        if expires_at <= utc_now():
            raise HTTPException(status_code=401, detail="Session expired")
        user = db.get(User, session.user_id)
        if user is None:
            raise HTTPException(status_code=401, detail="User missing")
        return user

    def _serialize_user(user: User) -> dict[str, Any]:
        return {
            "id": user.id,
            "github_login": user.github_login,
            "display_name": user.display_name,
            "email": user.email,
            "avatar_url": user.avatar_url,
        }

    def _cleanup_expired_auth_states(db: Session) -> None:
        expired_states = db.scalars(select(AuthState).where(AuthState.expires_at <= utc_now())).all()
        for item in expired_states:
            db.delete(item)
        if expired_states:
            db.flush()

    def _create_auth_state(
        db: Session,
        *,
        user: User,
        purpose: str,
        metadata_json: dict[str, Any] | None = None,
        ttl_seconds: int = 60 * 10,
    ) -> str:
        _cleanup_expired_auth_states(db)
        state = secrets.token_urlsafe(24)
        db.add(
            AuthState(
                state=state,
                user_id=user.id,
                purpose=purpose,
                metadata_json=metadata_json or {},
                expires_at=utc_now() + timedelta(seconds=ttl_seconds),
            )
        )
        db.commit()
        return state

    def _consume_auth_state(
        db: Session,
        *,
        user: User,
        state: str,
        purpose: str,
    ) -> AuthState:
        _cleanup_expired_auth_states(db)
        auth_state = db.scalar(
            select(AuthState).where(
                AuthState.state == state,
                AuthState.user_id == user.id,
                AuthState.purpose == purpose,
            )
        )
        if auth_state is None:
            raise HTTPException(status_code=400, detail="GitHub App setup state is missing or expired.")
        db.delete(auth_state)
        db.flush()
        return auth_state

    def _serialize_installation(installation: IntegrationInstallation) -> dict[str, Any]:
        metadata = installation.metadata_json or {}
        installation_id = metadata.get("installation_id")
        return {
            "id": installation.id,
            "installation_id": int(installation_id) if installation_id is not None else None,
            "account_login": metadata.get("account_login"),
            "account_type": metadata.get("account_type"),
            "display_name": installation.display_name,
            "setup_action": metadata.get("setup_action"),
        }

    def _github_app_installation_for_user(db: Session, user: User) -> IntegrationInstallation | None:
        return db.scalar(
            select(IntegrationInstallation)
            .where(
                IntegrationInstallation.provider == "github",
                IntegrationInstallation.installation_kind == "github_app_installation",
                IntegrationInstallation.status == "active",
                IntegrationInstallation.owner_user_id == user.id,
            )
            .order_by(IntegrationInstallation.updated_at.desc())
        )

    def _serialize_orbit(orbit: Orbit) -> dict[str, Any]:
        return {
            "id": orbit.id,
            "slug": orbit.slug,
            "name": orbit.name,
            "description": orbit.description,
            "logo": orbit.logo,
            "repo_full_name": orbit.repo_full_name,
            "repo_url": orbit.repo_url,
            "repo_private": orbit.repo_private,
            "default_branch": orbit.default_branch,
        }

    def _serialize_repository_connection(
        repository: RepositoryConnection,
        binding: OrbitRepositoryBinding | None = None,
    ) -> dict[str, Any]:
        return {
            "id": repository.id,
            "provider": repository.provider,
            "full_name": repository.full_name,
            "owner_name": repository.owner_name,
            "repo_name": repository.repo_name,
            "url": repository.url,
            "is_private": repository.is_private,
            "default_branch": repository.default_branch,
            "status": repository.status,
            "health_state": repository.health_state,
            "is_primary": binding.is_primary if binding else False,
            "binding_status": binding.status if binding else None,
        }

    def _serialize_accessible_repository(
        repository_payload: dict[str, Any],
        *,
        connected_repository: RepositoryConnection | None = None,
    ) -> dict[str, Any]:
        full_name = str(repository_payload.get("full_name") or "").strip()
        owner_name = str(repository_payload.get("owner", {}).get("login") or "").strip()
        repo_name = str(repository_payload.get("name") or "").strip()
        return {
            "id": connected_repository.id if connected_repository else None,
            "provider": "github",
            "full_name": full_name,
            "owner_name": owner_name or full_name.partition("/")[0],
            "repo_name": repo_name or full_name.partition("/")[2],
            "url": repository_payload.get("html_url"),
            "is_private": bool(repository_payload.get("private", True)),
            "default_branch": str(repository_payload.get("default_branch") or "main"),
            "status": "connected" if connected_repository else "available",
            "health_state": connected_repository.health_state if connected_repository else "healthy",
            "already_connected": connected_repository is not None,
        }

    def _serialize_message(message: Message) -> dict[str, Any]:
        return {
            "id": message.id,
            "channel_id": message.channel_id,
            "dm_thread_id": message.dm_thread_id,
            "user_id": message.user_id,
            "author_kind": message.author_kind,
            "author_name": message.author_name,
            "body": message.body,
            "metadata": message.metadata_json,
            "transport_state": message.transport_state,
            "transport_error": message.transport_error,
            "created_at": message.created_at.isoformat(),
        }

    def _matrix_channel_bridge_enabled() -> bool:
        return flag_enabled(settings, "ff_matrix_chat_backend_v1") and flag_enabled(settings, "ff_matrix_room_provisioning_v1")

    def _matrix_dm_bridge_enabled() -> bool:
        return _matrix_channel_bridge_enabled() and flag_enabled(settings, "ff_matrix_dm_bridge_v1")

    def _queue_message_for_matrix(
        *,
        db: Session,
        orbit: Orbit,
        actor_user: User,
        message: Message,
        channel: Channel | None = None,
        thread: DmThread | None = None,
    ) -> MatrixRoomBinding | None:
        if channel is not None and not _matrix_channel_bridge_enabled():
            return None
        if thread is not None and not _matrix_dm_bridge_enabled():
            return None
        try:
            binding = matrix_provisioning.ensure_room_binding(
                db,
                orbit=orbit,
                actor_user=actor_user,
                channel=channel,
                thread=thread,
            )
            txn_id = matrix_txn_id_for_message(message.id)
            upsert_matrix_message_link(
                db,
                message_id=message.id,
                room_binding_id=binding.id,
                direction="outbound",
                send_state="queued",
                matrix_txn_id=txn_id,
            )
            message.transport_state = "pending_remote"
            message.transport_error = None
            return binding
        except MatrixTransportError as exc:
            message.transport_state = "failed_remote"
            message.transport_error = str(exc)
            logger.warning("Matrix queueing failed for message %s: %s", message.id, exc)
            return None

    def _format_state_label(value: str | None) -> str:
        normalized = str(value or "").strip().replace("_", " ")
        if not normalized:
            return "unknown"
        return normalized[:1].upper() + normalized[1:]

    def _is_legacy_workflow_prompt_message(message: Message) -> bool:
        metadata = message.metadata_json or {}
        if isinstance(metadata, dict) and (
            metadata.get("workflow_prompt")
            or metadata.get("workflow_prompt_type")
            or metadata.get("workflow_prompt_phase")
        ):
            return True
        if message.author_kind != "system":
            return False
        body = str(message.body or "").lower()
        return any(
            phrase in body
            for phrase in (
                "answered an ergo clarification request",
                "approved an ergo release signoff",
                "rejected an ergo release signoff",
            )
        )

    def _serialize_member_summary(member_user: User, membership: OrbitMembership, *, viewer: User) -> dict[str, Any]:
        return {
            "id": member_user.id,
            "user_id": member_user.id,
            "login": member_user.github_login,
            "github_login": member_user.github_login,
            "display_name": member_user.display_name,
            "avatar_url": member_user.avatar_url,
            "role": normalize_orbit_role(membership.role),
            "introduced": membership.introduced,
            "is_self": member_user.id == viewer.id,
        }

    def _normalize_theme_preference(value: str | None) -> str:
        normalized = (value or "system").strip().lower()
        if normalized not in {"system", "light", "dark"}:
            raise HTTPException(status_code=400, detail="Unsupported theme preference")
        return normalized

    def _user_preferences(db: Session, user: User, *, create: bool = False) -> UserPreference | None:
        preference = db.scalar(select(UserPreference).where(UserPreference.user_id == user.id))
        if preference is None and create:
            preference = UserPreference(user_id=user.id, theme_preference="system")
            db.add(preference)
            db.flush()
        return preference

    def _serialize_preferences(preference: UserPreference | None) -> dict[str, Any]:
        return {
            "theme_preference": preference.theme_preference if preference else "system",
        }

    def _repository_identity(db: Session, repository_connection_id: str | None, metadata_json: dict[str, Any] | None = None) -> dict[str, Any]:
        metadata = metadata_json or {}
        repository = db.get(RepositoryConnection, repository_connection_id) if repository_connection_id else None
        return {
            "repository_id": repository_connection_id,
            "repository_full_name": repository.full_name if repository is not None else metadata.get("repository_full_name"),
            "repository_url": repository.url if repository is not None else metadata.get("repository_url"),
        }

    def _linked_work_item_for_branch(
        db: Session,
        *,
        orbit_id: str,
        branch_name: str | None,
        repository_connection_id: str | None,
    ) -> WorkItem | None:
        if not branch_name:
            return None
        candidates = db.scalars(
            select(WorkItem).where(
                WorkItem.orbit_id == orbit_id,
                WorkItem.branch_name == branch_name,
            ).order_by(WorkItem.updated_at.desc())
        ).all()
        if repository_connection_id is None:
            return candidates[0] if candidates else None
        for candidate in candidates:
            if repository_connection_id in repository_ids_for_work_item(db, candidate):
                return candidate
        return candidates[0] if candidates else None

    def _serialize_codespace(db: Session, item: Codespace) -> dict[str, Any]:
        linked_work_item = _linked_work_item_for_branch(
            db,
            orbit_id=item.orbit_id,
            branch_name=item.branch_name,
            repository_connection_id=item.repository_connection_id,
        )
        return {
            "id": item.id,
            "name": item.name,
            "branch_name": item.branch_name,
            "workspace_path": item.workspace_path,
            "status": item.status,
            "editor_url": item.editor_url,
            "work_item_id": linked_work_item.id if linked_work_item is not None else None,
            "workflow_run_id": linked_work_item.workflow_run_id if linked_work_item is not None else None,
            **_repository_identity(db, item.repository_connection_id),
        }

    def _serialize_demo(db: Session, item: Demo) -> dict[str, Any]:
        work_item = db.get(WorkItem, item.work_item_id) if item.work_item_id else None
        return {
            "id": item.id,
            "title": item.title,
            "source_path": item.source_path,
            "status": item.status,
            "url": item.url,
            "work_item_id": item.work_item_id,
            "workflow_run_id": work_item.workflow_run_id if work_item is not None else None,
            **_repository_identity(db, item.repository_connection_id),
        }

    def _serialize_artifact(db: Session, item: Artifact) -> dict[str, Any]:
        identity = _repository_identity(db, item.repository_connection_id, item.metadata_json)
        return {
            "id": item.id,
            "artifact_kind": item.artifact_kind,
            "title": item.title,
            "summary": item.summary,
            "status": item.status,
            "external_url": item.external_url,
            "work_item_id": item.work_item_id,
            "workflow_run_id": item.workflow_run_id,
            "source_kind": item.source_kind,
            "source_id": item.source_id,
            "metadata": item.metadata_json,
            "updated_at": item.updated_at.isoformat(),
            **identity,
        }

    def _serialize_work_item(item: WorkItem) -> dict[str, Any]:
        return {
            "id": item.id,
            "title": item.title,
            "status": item.status,
            "agent": item.current_agent,
            "branch_name": item.branch_name,
            "draft_pr_url": item.draft_pr_url,
            "workflow_run_id": item.workflow_run_id,
            "summary": item.summary,
            "updated_at": item.updated_at.isoformat(),
        }

    def _serialize_human_loop_item(item: RuntimeHumanLoopItem) -> dict[str, Any]:
        return {
            "id": item.id,
            "request_id": item.request_id,
            "request_kind": item.request_kind,
            "workflow_run_id": item.workflow_run_id,
            "work_item_id": item.work_item_id,
            "task_id": item.task_id,
            "task_key": item.task_key,
            "status": item.status,
            "title": item.title,
            "detail": item.detail,
            "response_text": item.response_text,
            "channel_id": item.source_channel_id,
            "dm_thread_id": item.source_dm_thread_id,
            "metadata": item.metadata_json,
            "created_at": item.created_at.isoformat(),
            "updated_at": item.updated_at.isoformat(),
            "resolved_at": item.resolved_at.isoformat() if item.resolved_at else None,
        }

    def _serialize_notification(item: Notification) -> dict[str, Any]:
        return {
            "id": item.id,
            "kind": item.kind,
            "title": item.title,
            "detail": item.detail,
            "status": item.status,
            "channel_id": item.channel_id,
            "dm_thread_id": item.dm_thread_id,
            "source_kind": item.source_kind,
            "source_id": item.source_id,
            "created_at": item.created_at.isoformat(),
            "metadata": item.metadata_json,
        }

    def _inbox_navigation(
        *,
        orbit_id: str | None = None,
        section: str = "inbox",
        conversation_kind: str | None = None,
        conversation_id: str | None = None,
        detail_kind: str | None = None,
        detail_id: str | None = None,
    ) -> dict[str, Any]:
        return {
            "orbit_id": orbit_id,
            "section": section,
            "conversation_kind": conversation_kind,
            "conversation_id": conversation_id,
            "detail_kind": detail_kind,
            "detail_id": detail_id,
        }

    def _inbox_action(
        label: str,
        *,
        navigation_target: dict[str, Any] | None = None,
        href: str | None = None,
    ) -> dict[str, Any]:
        return {
            "label": label,
            "navigation": navigation_target,
            "href": href,
        }

    def _inbox_detail(
        *,
        summary: str,
        key_context: list[dict[str, str]] | None = None,
        related_entities: list[dict[str, str]] | None = None,
        next_actions: list[dict[str, Any]] | None = None,
        metadata: list[dict[str, str]] | None = None,
        conversation_excerpt: list[dict[str, str]] | None = None,
    ) -> dict[str, Any]:
        return {
            "summary": summary,
            "key_context": key_context or [],
            "related_entities": related_entities or [],
            "next_actions": next_actions or [],
            "metadata": metadata or [],
            "conversation_excerpt": conversation_excerpt or [],
        }

    def _inbox_item(
        *,
        item_id: str,
        kind: str,
        bucket: str | None = None,
        reason_label: str | None = None,
        title: str,
        preview: str,
        source_label: str,
        status_label: str,
        attention: str,
        unread: bool,
        created_at: str,
        orbit_id: str | None,
        orbit_name: str | None,
        navigation_target: dict[str, Any] | None,
        action_context: dict[str, Any] | None = None,
        detail: dict[str, Any],
    ) -> dict[str, Any]:
        return {
            "id": item_id,
            "kind": kind,
            "bucket": bucket,
            "reason_label": reason_label,
            "title": title,
            "preview": preview,
            "source_label": source_label,
            "status_label": status_label,
            "attention": attention,
            "unread": unread,
            "created_at": created_at,
            "orbit_id": orbit_id,
            "orbit_name": orbit_name,
            "navigation": navigation_target,
            "action_context": action_context,
            "detail": detail,
        }

    def _build_inbox_payload(user: User, db: Session) -> dict[str, Any]:
        orbit_ids = [membership.orbit_id for membership in db.scalars(select(OrbitMembership).where(OrbitMembership.user_id == user.id)).all()]
        orbits = db.scalars(select(Orbit).where(Orbit.id.in_(orbit_ids)).order_by(Orbit.created_at.desc())).all() if orbit_ids else []
        orbit_by_id = {orbit.id: orbit for orbit in orbits}
        navigation_state = navigation.get_state(user.id) or {}
        active_orbit = orbit_by_id.get(str(navigation_state.get("orbit_id") or "")) if navigation_state.get("orbit_id") else None
        if active_orbit is None and orbits:
            active_orbit = orbits[0]

        scopes: list[dict[str, Any]] = []
        for orbit in orbits[:8]:
            ergo_thread = db.scalar(select(DmThread).where(DmThread.orbit_id == orbit.id, DmThread.title == "ERGO"))
            scopes.append(
                {
                    "orbit_id": orbit.id,
                    "orbit_name": orbit.name,
                    "orbit_slug": orbit.slug,
                    "repository_full_name": orbit.repo_full_name,
                    "ergo_thread_id": ergo_thread.id if ergo_thread is not None else None,
                    "is_active": active_orbit is not None and active_orbit.id == orbit.id,
                }
            )
        active_scope = next((scope for scope in scopes if scope["is_active"]), scopes[0] if scopes else None)

        notifications = notifications_for_user(db, user_id=user.id)[:18]
        approval_notifications = [item for item in notifications if item.kind == "approval"]
        mention_notifications = [item for item in notifications if item.kind == "mention"]
        agent_notifications = [item for item in notifications if item.kind in {"clarification", "run_failed", "dm"}]
        review_prs = [
            item
            for item in db.scalars(
                select(PullRequestSnapshot)
                .where(PullRequestSnapshot.orbit_id.in_(orbit_ids))
                .order_by(PullRequestSnapshot.updated_at.desc())
            ).all()
            if _normalize_pull_request_status(item) in {"awaiting_review", "changes_requested"}
        ][:6] if orbit_ids else []
        native_issues = db.scalars(
            select(OrbitIssue).where(OrbitIssue.orbit_id.in_(orbit_ids)).order_by(OrbitIssue.updated_at.desc())
        ).all() if orbit_ids else []
        issue_context = _build_orbit_issue_context(db, native_issues)
        native_issue_payloads = {
            item.id: _serialize_orbit_issue(db, item, context=issue_context)
            for item in native_issues
        }
        native_issue_board_items = {
            item.id: _serialize_native_issue_as_board_item(db, item, context=issue_context)
            for item in native_issues
        }
        active_native_issues = [item for item in native_issues if _normalize_native_issue_status(item.status) not in {"done", "canceled"}]
        stale_native_issues = [item for item in active_native_issues if _is_stale_orbit_issue(item)]
        blocked_native_issues = [
            item
            for item in active_native_issues
            if bool(native_issue_board_items.get(item.id, {}).get("is_blocked"))
        ]
        native_review_queue = [item for item in active_native_issues if _normalize_native_issue_status(item.status) in {"in_review", "ready_to_merge"}]
        open_human_loop_items = db.scalars(
            select(RuntimeHumanLoopItem)
            .where(RuntimeHumanLoopItem.orbit_id.in_(orbit_ids), RuntimeHumanLoopItem.status != "resolved")
            .order_by(RuntimeHumanLoopItem.updated_at.desc())
        ).all()[:8] if orbit_ids else []
        recent_artifacts = db.scalars(
            select(Artifact).where(Artifact.orbit_id.in_(orbit_ids)).order_by(Artifact.updated_at.desc())
        ).all()[:6] if orbit_ids else []

        recent_messages = db.scalars(
            select(Message).where(Message.orbit_id.in_(orbit_ids)).order_by(Message.created_at.desc())
        ).all()[:48] if orbit_ids else []
        recent_conversations: list[dict[str, Any]] = []
        seen_conversations: set[str] = set()
        for message in recent_messages:
            if _is_legacy_workflow_prompt_message(message):
                continue
            if message.channel_id:
                conversation_key = f"channel:{message.channel_id}"
            elif message.dm_thread_id:
                conversation_key = f"dm:{message.dm_thread_id}"
            else:
                continue
            if conversation_key in seen_conversations:
                continue
            seen_conversations.add(conversation_key)
            recent_conversations.append(
                {
                    "message": message,
                    "channel": db.get(Channel, message.channel_id) if message.channel_id else None,
                    "thread": db.get(DmThread, message.dm_thread_id) if message.dm_thread_id else None,
                }
            )
            if len(recent_conversations) >= 8:
                break

        def native_issue_rank(item: OrbitIssue) -> tuple[int, int, int, float]:
            return (
                0 if item.assignee_user_id == user.id else 1,
                0 if bool(native_issue_board_items.get(item.id, {}).get("is_blocked")) else 1,
                0 if _is_stale_orbit_issue(item) else 1,
                -item.updated_at.timestamp(),
            )

        blocked_native_issues = sorted(blocked_native_issues, key=native_issue_rank)
        stale_native_issues = sorted(stale_native_issues, key=native_issue_rank)
        native_review_queue = sorted(native_review_queue, key=native_issue_rank)

        attention_counts = {
            "needs_attention": len([item for item in notifications if item.status == "unread"]),
            "review_queue": len(review_prs) + len(native_review_queue),
            "review_requests": len(review_prs) + len(native_review_queue),
            "blocked_work": len(blocked_native_issues),
            "stale_work": len(stale_native_issues),
            "approvals": len(approval_notifications),
            "mentions": len(mention_notifications),
            "agent_asks": len(open_human_loop_items) + len(agent_notifications),
            "active_sources": len(recent_artifacts),
            "recent_chats": len(recent_conversations),
        }
        briefing_lines: list[str] = []
        if active_orbit is not None:
            briefing_lines.append(f"{active_orbit.name} is the active ERGO scope for current project triage.")
        if attention_counts["review_requests"]:
            briefing_lines.append(f"{attention_counts['review_requests']} review requests still need a decision.")
        if attention_counts["blocked_work"]:
            briefing_lines.append(f"{attention_counts['blocked_work']} items are blocked and need attention.")
        if attention_counts["stale_work"]:
            briefing_lines.append(f"{attention_counts['stale_work']} items have gone stale.")
        if not briefing_lines:
            briefing_lines.append("Your workspace is quiet. Inbox is ready for the next approval, review, or ERGO ask.")

        briefing_excerpt: list[dict[str, str]] = []
        if active_scope and active_scope.get("ergo_thread_id"):
            ergo_messages = db.scalars(
                select(Message)
                .where(
                    Message.orbit_id == active_scope["orbit_id"],
                    Message.dm_thread_id == active_scope["ergo_thread_id"],
                )
                .order_by(Message.created_at.desc())
            ).all()[:4]
            for message in reversed(ergo_messages):
                briefing_excerpt.append(
                    {
                        "author": message.author_name,
                        "body": message.body,
                        "created_at": message.created_at.isoformat(),
                    }
                )

        items: list[dict[str, Any]] = [
            _inbox_item(
                item_id="briefing-ergo",
                kind="briefing",
                bucket="agent",
                reason_label="Briefing",
                title="ERGO briefing",
                preview=briefing_lines[0],
                source_label=active_orbit.name if active_orbit is not None else "Workspace",
                status_label="Pinned",
                attention="high" if attention_counts["needs_attention"] else "normal",
                unread=False,
                created_at=utc_now().isoformat(),
                orbit_id=active_scope["orbit_id"] if active_scope else None,
                orbit_name=active_scope["orbit_name"] if active_scope else None,
                navigation_target=_inbox_navigation(
                    orbit_id=active_scope["orbit_id"] if active_scope else None,
                    section="chat",
                    conversation_kind="dm",
                    conversation_id=active_scope["ergo_thread_id"] if active_scope else None,
                ),
                detail=_inbox_detail(
                    summary=" ".join(briefing_lines),
                    key_context=[
                        {"label": "Review", "value": str(attention_counts["review_requests"])},
                        {"label": "Blocked", "value": str(attention_counts["blocked_work"])},
                        {"label": "Stale", "value": str(attention_counts["stale_work"])},
                        {"label": "Agent asks", "value": str(attention_counts["agent_asks"])},
                    ],
                    related_entities=[
                        {"label": "Default scope", "value": active_scope["orbit_name"] if active_scope else "No orbit selected"},
                        {"label": "Repository", "value": active_scope["repository_full_name"] if active_scope and active_scope.get("repository_full_name") else "Awaiting source binding"},
                    ],
                    next_actions=[
                        _inbox_action(
                            "Open chat",
                            navigation_target=_inbox_navigation(
                                orbit_id=active_scope["orbit_id"] if active_scope else None,
                                section="chat",
                            ),
                        ),
                        _inbox_action(
                            "Open issues",
                            navigation_target=_inbox_navigation(
                                orbit_id=active_scope["orbit_id"] if active_scope else None,
                                section="issues",
                            ),
                        ),
                    ],
                    metadata=[
                        {"label": "Mode", "value": "Triage briefing"},
                        {"label": "Scope", "value": active_scope["orbit_name"] if active_scope else "Global"},
                    ],
                    conversation_excerpt=briefing_excerpt,
                ),
            )
        ]
        seen_item_ids = {"briefing-ergo"}

        def push_item(item: dict[str, Any]) -> None:
            if item["id"] in seen_item_ids:
                return
            seen_item_ids.add(item["id"])
            items.append(item)

        for notification in approval_notifications:
            orbit = orbit_by_id.get(notification.orbit_id) if notification.orbit_id else None
            repository_name = str(notification.metadata_json.get("repository_full_name") or "").strip() if isinstance(notification.metadata_json, dict) else ""
            detail_summary = f"{notification.title} requires a human decision before execution can continue."
            push_item(
                _inbox_item(
                    item_id=notification.id,
                    kind="approval",
                    bucket="approvals",
                    reason_label="Approval",
                    title=notification.title,
                    preview=notification.detail,
                    source_label=" · ".join([part for part in [orbit.name if orbit is not None else None, repository_name or None] if part]),
                    status_label="Needs approval",
                    attention="high",
                    unread=notification.status == "unread",
                    created_at=notification.created_at.isoformat(),
                    orbit_id=orbit.id if orbit is not None else None,
                    orbit_name=orbit.name if orbit is not None else None,
                    navigation_target=_inbox_navigation(orbit_id=orbit.id if orbit is not None else None, section="workflow"),
                    action_context={
                        "notification_id": notification.id,
                        "workflow_run_id": str(notification.metadata_json.get("workflow_run_id") or ""),
                        "request_id": notification.source_id,
                        "request_kind": "approval",
                    },
                    detail=_inbox_detail(
                        summary=detail_summary,
                        key_context=[
                            {"label": "Type", "value": "Approval"},
                            {"label": "State", "value": "Unread" if notification.status == "unread" else "Open"},
                        ],
                        related_entities=[
                            {"label": "Orbit", "value": orbit.name if orbit is not None else "Workspace"},
                            {"label": "Source", "value": repository_name or notification.source_kind},
                        ],
                        next_actions=[
                            _inbox_action(
                                "Open workflow",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit is not None else None,
                                    section="workflow",
                                ),
                            ),
                            _inbox_action(
                                "Open chat",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit is not None else None,
                                    section="chat",
                                ),
                            ),
                        ],
                        metadata=[
                            {"label": "Created", "value": notification.created_at.isoformat()},
                            {"label": "Source id", "value": notification.source_id},
                        ],
                    ),
                )
            )

        for notification in mention_notifications:
            orbit = orbit_by_id.get(notification.orbit_id) if notification.orbit_id else None
            repository_name = str(notification.metadata_json.get("repository_full_name") or "").strip() if isinstance(notification.metadata_json, dict) else ""
            push_item(
                _inbox_item(
                    item_id=notification.id,
                    kind="mention",
                    bucket="mentions",
                    reason_label="Mention",
                    title=notification.title,
                    preview=notification.detail,
                    source_label=" · ".join([part for part in [orbit.name if orbit is not None else None, repository_name or None] if part]),
                    status_label="Mentioned",
                    attention="high" if notification.status == "unread" else "normal",
                    unread=notification.status == "unread",
                    created_at=notification.created_at.isoformat(),
                    orbit_id=orbit.id if orbit is not None else None,
                    orbit_name=orbit.name if orbit is not None else None,
                    navigation_target=_inbox_navigation(orbit_id=orbit.id if orbit is not None else None, section="chat"),
                    action_context={"notification_id": notification.id},
                    detail=_inbox_detail(
                        summary=notification.detail or f"You were mentioned in {orbit.name if orbit is not None else 'the workspace'}.",
                        key_context=[
                            {"label": "Type", "value": "Mention"},
                            {"label": "State", "value": "Unread" if notification.status == "unread" else "Open"},
                        ],
                        related_entities=[
                            {"label": "Orbit", "value": orbit.name if orbit is not None else "Workspace"},
                            {"label": "Source", "value": repository_name or notification.source_kind},
                        ],
                        next_actions=[
                            _inbox_action(
                                "Open chat",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit is not None else None,
                                    section="chat",
                                ),
                            )
                        ],
                        metadata=[{"label": "Created", "value": notification.created_at.isoformat()}],
                    ),
                )
            )

        for item in open_human_loop_items:
            orbit = orbit_by_id.get(item.orbit_id)
            push_item(
                _inbox_item(
                    item_id=f"human-loop-{item.id}",
                    kind="agent_ask",
                    bucket="agent",
                    reason_label="Agent ask",
                    title=item.title or "ERGO needs input",
                    preview=item.detail or "ERGO needs a clarification or approval before continuing.",
                    source_label=" · ".join([part for part in [orbit.name if orbit else None, _format_state_label(item.request_kind)] if part]),
                    status_label=_format_state_label(item.status),
                    attention="high",
                    unread=item.status != "resolved",
                    created_at=item.updated_at.isoformat(),
                    orbit_id=orbit.id if orbit else None,
                    orbit_name=orbit.name if orbit else None,
                    navigation_target=_inbox_navigation(
                        orbit_id=orbit.id if orbit else None,
                        section="chat",
                        conversation_kind="dm" if item.source_dm_thread_id else "channel" if item.source_channel_id else None,
                        conversation_id=item.source_dm_thread_id or item.source_channel_id,
                    ),
                    action_context={
                        "workflow_run_id": item.workflow_run_id,
                        "request_id": item.request_id,
                        "request_kind": item.request_kind,
                    },
                    detail=_inbox_detail(
                        summary=item.detail or "ERGO has paused for human input.",
                        key_context=[
                            {"label": "Request", "value": _format_state_label(item.request_kind)},
                            {"label": "State", "value": _format_state_label(item.status)},
                        ],
                        related_entities=[
                            {"label": "Orbit", "value": orbit.name if orbit else "Workspace"},
                            {"label": "Workflow run", "value": item.workflow_run_id or "Pending"},
                        ],
                        next_actions=[
                            _inbox_action(
                                "Open chat",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit else None,
                                    section="chat",
                                    conversation_kind="dm" if item.source_dm_thread_id else "channel" if item.source_channel_id else None,
                                    conversation_id=item.source_dm_thread_id or item.source_channel_id,
                                ),
                            )
                        ],
                        metadata=[
                            {"label": "Task", "value": item.task_key or item.task_id or "Awaiting task context"},
                        ],
                    ),
                )
            )

        for notification in agent_notifications:
            orbit = orbit_by_id.get(notification.orbit_id) if notification.orbit_id else None
            repository_name = str(notification.metadata_json.get("repository_full_name") or "").strip() if isinstance(notification.metadata_json, dict) else ""
            push_item(
                _inbox_item(
                    item_id=notification.id,
                    kind="agent_ask",
                    bucket="agent",
                    reason_label="Agent ask",
                    title=notification.title,
                    preview=notification.detail,
                    source_label=" · ".join([part for part in [orbit.name if orbit is not None else None, repository_name or None] if part]),
                    status_label=_format_state_label(notification.kind),
                    attention="high" if notification.status == "unread" else "normal",
                    unread=notification.status == "unread",
                    created_at=notification.created_at.isoformat(),
                    orbit_id=orbit.id if orbit is not None else None,
                    orbit_name=orbit.name if orbit is not None else None,
                    navigation_target=_inbox_navigation(orbit_id=orbit.id if orbit is not None else None, section="chat"),
                    action_context={
                        "notification_id": notification.id,
                        "workflow_run_id": str(notification.metadata_json.get("workflow_run_id") or ""),
                        "request_id": notification.source_id,
                        "request_kind": notification.kind,
                    },
                    detail=_inbox_detail(
                        summary=notification.detail or f"{notification.title} needs an ERGO follow-up.",
                        key_context=[
                            {"label": "Type", "value": _format_state_label(notification.kind)},
                            {"label": "State", "value": "Unread" if notification.status == "unread" else "Open"},
                        ],
                        related_entities=[
                            {"label": "Orbit", "value": orbit.name if orbit is not None else "Workspace"},
                            {"label": "Source", "value": repository_name or notification.source_kind},
                        ],
                        next_actions=[
                            _inbox_action(
                                "Open chat",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit is not None else None,
                                    section="chat",
                                ),
                            )
                        ],
                        metadata=[{"label": "Created", "value": notification.created_at.isoformat()}],
                    ),
                )
            )

        for issue in native_review_queue:
            orbit = orbit_by_id.get(issue.orbit_id)
            serialized = native_issue_payloads[issue.id]
            board_item = native_issue_board_items[issue.id]
            repository_name = serialized.get("repository_full_name") or orbit.name if orbit else "Orbit"
            push_item(
                _inbox_item(
                    item_id=f"native-review-{issue.id}",
                    kind="native_issue",
                    bucket="review",
                    reason_label="Review request",
                    title=f"PM-{issue.sequence_no} · {issue.title}",
                    preview=serialized.get("detail") or f"{issue.title} is waiting in {_format_state_label(issue.status)}.",
                    source_label=" · ".join([part for part in [orbit.name if orbit else None, str(repository_name)] if part]),
                    status_label=_format_state_label(issue.status),
                    attention="high",
                    unread=issue.assignee_user_id == user.id,
                    created_at=issue.updated_at.isoformat(),
                    orbit_id=orbit.id if orbit else None,
                    orbit_name=orbit.name if orbit else None,
                    navigation_target=_inbox_navigation(
                        orbit_id=orbit.id if orbit else None,
                        section="issues",
                        detail_kind="native_issue",
                        detail_id=issue.id,
                    ),
                    detail=_inbox_detail(
                        summary=serialized.get("detail") or f"{issue.title} needs a stage decision or merge follow-up.",
                        key_context=[
                            {"label": "Stage", "value": _format_state_label(issue.status)},
                            {"label": "Assignee", "value": serialized.get("assignee_display_name") or "Unassigned"},
                            {"label": "Priority", "value": _format_state_label(issue.priority)},
                        ],
                        related_entities=[
                            {"label": "Orbit", "value": orbit.name if orbit else "Workspace"},
                            {"label": "Repository", "value": str(repository_name)},
                        ],
                        next_actions=[
                            _inbox_action(
                                "Open issue",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit else None,
                                    section="issues",
                                    detail_kind="native_issue",
                                    detail_id=issue.id,
                                ),
                            ),
                            _inbox_action(
                                "Open chat",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit else None,
                                    section="chat",
                                    detail_kind="native_issue",
                                    detail_id=issue.id,
                                ),
                            ),
                        ],
                        metadata=[
                            {"label": "Cycle", "value": serialized.get("cycle_name") or "No cycle"},
                            {"label": "Labels", "value": ", ".join(label["name"] for label in board_item.get("labels", [])[:3]) or "No labels"},
                        ],
                    ),
                )
            )

        for issue in blocked_native_issues:
            orbit = orbit_by_id.get(issue.orbit_id)
            serialized = native_issue_payloads[issue.id]
            repository_name = serialized.get("repository_full_name") or orbit.name if orbit else "Orbit"
            blocked_by_count = int(serialized.get("relation_counts", {}).get("blocked_by", 0))
            push_item(
                _inbox_item(
                    item_id=f"native-blocked-{issue.id}",
                    kind="native_issue",
                    bucket="blocked",
                    reason_label="Blocked",
                    title=f"PM-{issue.sequence_no} · {issue.title}",
                    preview=f"{issue.title} is blocked{f' by {blocked_by_count} linked item(s)' if blocked_by_count else ''}.",
                    source_label=" · ".join([part for part in [orbit.name if orbit else None, str(repository_name)] if part]),
                    status_label=_format_state_label(issue.status),
                    attention="high",
                    unread=issue.assignee_user_id == user.id,
                    created_at=issue.updated_at.isoformat(),
                    orbit_id=orbit.id if orbit else None,
                    orbit_name=orbit.name if orbit else None,
                    navigation_target=_inbox_navigation(
                        orbit_id=orbit.id if orbit else None,
                        section="issues",
                        detail_kind="native_issue",
                        detail_id=issue.id,
                    ),
                    detail=_inbox_detail(
                        summary=serialized.get("detail") or f"{issue.title} is blocked and needs a dependency or ownership decision.",
                        key_context=[
                            {"label": "Stage", "value": _format_state_label(issue.status)},
                            {"label": "Blocked by", "value": str(blocked_by_count)},
                            {"label": "Assignee", "value": serialized.get("assignee_display_name") or "Unassigned"},
                        ],
                        related_entities=[
                            {"label": "Orbit", "value": orbit.name if orbit else "Workspace"},
                            {"label": "Repository", "value": str(repository_name)},
                        ],
                        next_actions=[
                            _inbox_action(
                                "Open issue",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit else None,
                                    section="issues",
                                    detail_kind="native_issue",
                                    detail_id=issue.id,
                                ),
                            ),
                            _inbox_action(
                                "Open chat",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit else None,
                                    section="chat",
                                    detail_kind="native_issue",
                                    detail_id=issue.id,
                                ),
                            ),
                        ],
                        metadata=[{"label": "Cycle", "value": serialized.get("cycle_name") or "No cycle"}],
                    ),
                )
            )

        for issue in stale_native_issues:
            orbit = orbit_by_id.get(issue.orbit_id)
            serialized = native_issue_payloads[issue.id]
            repository_name = serialized.get("repository_full_name") or orbit.name if orbit else "Orbit"
            stale_days = int(serialized.get("stale_working_days") or 0)
            push_item(
                _inbox_item(
                    item_id=f"native-stale-{issue.id}",
                    kind="native_issue",
                    bucket="stale",
                    reason_label="Stale",
                    title=f"PM-{issue.sequence_no} · {issue.title}",
                    preview=f"{issue.title} has been quiet for {stale_days} working day{'s' if stale_days != 1 else ''}.",
                    source_label=" · ".join([part for part in [orbit.name if orbit else None, str(repository_name)] if part]),
                    status_label=f"{stale_days}d stale" if stale_days else "Stale",
                    attention="normal",
                    unread=False,
                    created_at=issue.updated_at.isoformat(),
                    orbit_id=orbit.id if orbit else None,
                    orbit_name=orbit.name if orbit else None,
                    navigation_target=_inbox_navigation(
                        orbit_id=orbit.id if orbit else None,
                        section="issues",
                        detail_kind="native_issue",
                        detail_id=issue.id,
                    ),
                    detail=_inbox_detail(
                        summary=serialized.get("detail") or f"{issue.title} needs a fresh update or a stage change.",
                        key_context=[
                            {"label": "Stale days", "value": str(stale_days)},
                            {"label": "Assignee", "value": serialized.get("assignee_display_name") or "Unassigned"},
                            {"label": "Stage", "value": _format_state_label(issue.status)},
                        ],
                        related_entities=[
                            {"label": "Orbit", "value": orbit.name if orbit else "Workspace"},
                            {"label": "Repository", "value": str(repository_name)},
                        ],
                        next_actions=[
                            _inbox_action(
                                "Open issue",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit else None,
                                    section="issues",
                                    detail_kind="native_issue",
                                    detail_id=issue.id,
                                ),
                            ),
                            _inbox_action(
                                "Open chat",
                                navigation_target=_inbox_navigation(
                                    orbit_id=orbit.id if orbit else None,
                                    section="chat",
                                    detail_kind="native_issue",
                                    detail_id=issue.id,
                                ),
                            ),
                        ],
                        metadata=[{"label": "Cycle", "value": serialized.get("cycle_name") or "No cycle"}],
                    ),
                )
            )

        for pr in review_prs:
            orbit = orbit_by_id.get(pr.orbit_id)
            pr_status = _normalize_pull_request_status(pr)
            repository_name = _repository_identity(db, pr.repository_connection_id, pr.metadata_json).get("repository_full_name") or "Repository"
            push_item(
                _inbox_item(
                    item_id=f"pr-{pr.id}",
                    kind="pr",
                    bucket="review",
                    reason_label="PR review",
                    title=f"PR #{pr.github_number} · {pr.title}",
                    preview=f"{pr.title} is {_format_state_label(pr_status)} and waiting on review follow-up.",
                    source_label=" · ".join([part for part in [orbit.name if orbit else None, str(repository_name), "Pull request"] if part]),
                    status_label=_format_state_label(pr_status),
                    attention="high" if pr_status == "changes_requested" else "normal",
                    unread=pr_status in {"awaiting_review", "changes_requested"},
                    created_at=pr.updated_at.isoformat(),
                    orbit_id=orbit.id if orbit else None,
                    orbit_name=orbit.name if orbit else None,
                    navigation_target=_inbox_navigation(
                        orbit_id=orbit.id if orbit else None,
                        section="prs",
                        detail_kind="pr",
                        detail_id=pr.id,
                    ),
                    detail=_inbox_detail(
                        summary=f"{pr.title} is part of the review queue for {repository_name}.",
                        key_context=[
                            {"label": "Number", "value": f"#{pr.github_number}"},
                            {"label": "State", "value": _format_state_label(pr_status)},
                            {"label": "Priority", "value": _format_state_label(pr.priority)},
                        ],
                        related_entities=[
                            {"label": "Orbit", "value": orbit.name if orbit else "Workspace"},
                            {"label": "Repository", "value": str(repository_name)},
                        ],
                        next_actions=[
                            _inbox_action(
                                "Open PR",
                                navigation_target=_inbox_navigation(orbit_id=orbit.id if orbit else None, section="prs", detail_kind="pr", detail_id=pr.id),
                            ),
                            _inbox_action(
                                "Open chat",
                                navigation_target=_inbox_navigation(orbit_id=orbit.id if orbit else None, section="chat"),
                            ),
                        ],
                        metadata=[
                            {"label": "Branch", "value": pr.branch_name or "n/a"},
                            {"label": "Updated", "value": pr.updated_at.isoformat()},
                        ],
                    ),
                )
            )

        for artifact in recent_artifacts:
            orbit = orbit_by_id.get(artifact.orbit_id)
            serialized = _serialize_artifact(db, artifact)
            source_label = " · ".join(
                [
                    part
                    for part in [
                        orbit.name if orbit else None,
                        serialized.get("repository_full_name"),
                        _format_state_label(artifact.artifact_kind),
                    ]
                    if part
                ]
            )
            push_item(
                _inbox_item(
                    item_id=f"artifact-{artifact.id}",
                    kind="source",
                    bucket="sources",
                    reason_label="Source",
                    title=artifact.title,
                    preview=artifact.summary or f"{_format_state_label(artifact.artifact_kind)} artifact is {artifact.status}.",
                    source_label=source_label,
                    status_label=_format_state_label(artifact.status),
                    attention="normal",
                    unread=False,
                    created_at=artifact.updated_at.isoformat(),
                    orbit_id=orbit.id if orbit else None,
                    orbit_name=orbit.name if orbit else None,
                    navigation_target=_inbox_navigation(orbit_id=orbit.id if orbit else None, section="demos"),
                    detail=_inbox_detail(
                        summary=artifact.summary or f"{artifact.title} is available as a recent source artifact.",
                        key_context=[
                            {"label": "Kind", "value": _format_state_label(artifact.artifact_kind)},
                            {"label": "State", "value": _format_state_label(artifact.status)},
                        ],
                        related_entities=[
                            {"label": "Orbit", "value": orbit.name if orbit else "Workspace"},
                            {"label": "Repository", "value": str(serialized.get("repository_full_name") or "Awaiting source binding")},
                        ],
                        next_actions=[
                            _inbox_action(
                                "Open source",
                                navigation_target=_inbox_navigation(orbit_id=orbit.id if orbit else None, section="demos"),
                            ),
                            _inbox_action(
                                "Open chat",
                                navigation_target=_inbox_navigation(orbit_id=orbit.id if orbit else None, section="chat"),
                            ),
                        ],
                        metadata=[{"label": "Updated", "value": artifact.updated_at.isoformat()}],
                    ),
                )
            )

        for conversation in recent_conversations:
            message = conversation["message"]
            orbit = orbit_by_id.get(message.orbit_id)
            channel = conversation["channel"]
            thread = conversation["thread"]
            is_ergo = thread is not None and thread.title == "ERGO"
            source_label = " · ".join(
                [
                    part
                    for part in [
                        orbit.name if orbit else None,
                        thread.title if thread is not None else (channel.name if channel is not None else None),
                        "Chat",
                    ]
                    if part
                ]
            )
            detail_summary = f"{message.author_name} last said: {message.body}"
            push_item(
                _inbox_item(
                    item_id=f"conversation-{message.id}",
                    kind="chat" if not is_ergo else "briefing_chat",
                    bucket="agent",
                    reason_label="Recent chat" if not is_ergo else "ERGO chat",
                    title=thread.title if thread is not None else (channel.name if channel is not None else "Conversation"),
                    preview=message.body,
                    source_label=source_label,
                    status_label="Recent",
                    attention="normal",
                    unread=False,
                    created_at=message.created_at.isoformat(),
                    orbit_id=orbit.id if orbit else None,
                    orbit_name=orbit.name if orbit else None,
                    navigation_target=_inbox_navigation(
                        orbit_id=orbit.id if orbit else None,
                        section="chat",
                        conversation_kind="dm" if thread is not None else "channel",
                        conversation_id=thread.id if thread is not None else channel.id if channel is not None else None,
                    ),
                    detail=_inbox_detail(
                        summary=detail_summary,
                        key_context=[
                            {"label": "Author", "value": message.author_name},
                            {"label": "Surface", "value": "ERGO DM" if is_ergo else "Conversation"},
                        ],
                        related_entities=[
                            {"label": "Orbit", "value": orbit.name if orbit else "Workspace"},
                            {"label": "Channel", "value": channel.name if channel is not None else (thread.title if thread is not None else "Conversation")},
                        ],
                        next_actions=[
                            _inbox_action(
                                "Open orbit chat",
                                navigation_target=_inbox_navigation(orbit_id=orbit.id if orbit else None, section="chat"),
                            )
                        ],
                        metadata=[{"label": "Time", "value": message.created_at.isoformat()}],
                        conversation_excerpt=[
                            {
                                "author": message.author_name,
                                "body": message.body,
                                "created_at": message.created_at.isoformat(),
                            }
                        ],
                    ),
                )
            )

        return {
            "me": _serialize_user(user),
            "summary": {
                **attention_counts,
                "recent_orbits": len(orbits),
            },
            "briefing": items[0],
            "items": items,
            "scopes": scopes,
            "active_scope": active_scope,
            "notifications": [_serialize_notification(item) for item in notifications[:8]],
        }

    def _build_my_work_payload(user: User, db: Session) -> dict[str, Any]:
        orbit_ids = [membership.orbit_id for membership in db.scalars(select(OrbitMembership).where(OrbitMembership.user_id == user.id)).all()]
        orbits = db.scalars(select(Orbit).where(Orbit.id.in_(orbit_ids)).order_by(Orbit.created_at.desc())).all() if orbit_ids else []
        work_items = db.scalars(select(WorkItem).where(WorkItem.orbit_id.in_(orbit_ids)).order_by(WorkItem.updated_at.desc())).all() if orbit_ids else []
        issues = db.scalars(select(IssueSnapshot).where(IssueSnapshot.orbit_id.in_(orbit_ids)).order_by(IssueSnapshot.updated_at.desc())).all() if orbit_ids else []
        native_issues = db.scalars(select(OrbitIssue).where(OrbitIssue.orbit_id.in_(orbit_ids)).order_by(OrbitIssue.updated_at.desc())).all() if orbit_ids else []
        prs = db.scalars(select(PullRequestSnapshot).where(PullRequestSnapshot.orbit_id.in_(orbit_ids)).order_by(PullRequestSnapshot.updated_at.desc())).all() if orbit_ids else []
        codespaces = db.scalars(select(Codespace).where(Codespace.orbit_id.in_(orbit_ids)).order_by(Codespace.created_at.desc())).all() if orbit_ids else []
        notifications = notifications_for_user(db, user_id=user.id)
        issue_context = _build_orbit_issue_context(db, native_issues)
        native_issue_payloads = [
            _serialize_orbit_issue(db, item, context=issue_context)
            for item in native_issues
        ]
        native_issue_board_items = {
            item.id: _serialize_native_issue_as_board_item(db, item, context=issue_context)
            for item in native_issues
        }

        active_work_items = [
            item
            for item in work_items
            if item.status in {"ready", "in_process", "in_review", "needs_input", "blocked"}
        ]
        active_issues = [item for item in issues if _normalize_issue_status(item) not in {"closed", "done", "resolved"}]
        active_native_issues = [item for item in native_issues if _normalize_native_issue_status(item.status) not in {"done", "canceled"}]
        stale_native_issues = [item for item in active_native_issues if _is_stale_orbit_issue(item)]
        blocked_native_issues = [
            item
            for item in active_native_issues
            if bool(native_issue_board_items.get(item.id, {}).get("is_blocked"))
        ]
        blocked_issues = [item for item in issues if _normalize_issue_status(item) == "blocked"]
        review_queue = [item for item in prs if _normalize_pull_request_status(item) in {"awaiting_review", "changes_requested"}]
        native_review_queue = [item for item in native_issues if _normalize_native_issue_status(item.status) in {"in_review", "ready_to_merge"}]
        approvals = [item for item in notifications if item.kind in {"approval", "clarification", "run_failed"}]
        running_codespaces = [item for item in codespaces if item.status == "running"]

        def native_issue_rank(item: OrbitIssue) -> tuple[int, int, int, float]:
            return (
                0 if item.assignee_user_id == user.id else 1,
                0 if bool(native_issue_board_items.get(item.id, {}).get("is_blocked")) else 1,
                0 if _is_stale_orbit_issue(item) else 1,
                -item.updated_at.timestamp(),
            )

        active_native_issues = sorted(active_native_issues, key=native_issue_rank)
        stale_native_issues = sorted(stale_native_issues, key=native_issue_rank)
        blocked_native_issues = sorted(blocked_native_issues, key=native_issue_rank)
        native_review_queue = sorted(native_review_queue, key=native_issue_rank)

        return {
            "me": _serialize_user(user),
            "summary": {
                "active_work_items": len(active_work_items),
                "active_issues": len(active_issues) + len(active_native_issues),
                "blocked_issues": len(blocked_issues) + len(blocked_native_issues),
                "stale_issues": len(stale_native_issues),
                "review_queue": len(review_queue) + len(native_review_queue),
                "approvals": len(approvals),
                "running_codespaces": len(running_codespaces),
                "recent_orbits": len(orbits[:6]),
            },
            "work_items": [_serialize_work_item(item) for item in active_work_items[:8]],
            "active_issues": (
                [native_issue_board_items[item.id] for item in active_native_issues[:8]]
                + [_serialize_issue(db, item) for item in active_issues[:10]]
            )[:10],
            "blocked_issues": (
                [native_issue_board_items[item.id] for item in blocked_native_issues[:8]]
                + [_serialize_issue(db, item) for item in blocked_issues[:8]]
            )[:10],
            "stale_issues": [native_issue_board_items[item.id] for item in stale_native_issues[:8]],
            "review_queue": (
                [native_issue_board_items[item.id] for item in native_review_queue[:6]]
                + [_serialize_pull_request(db, item) for item in review_queue[:8]]
            )[:10],
            "native_issues": native_issue_payloads,
            "issue_labels": _serialize_issue_label_catalog(issue_context),
            "approvals": [_serialize_notification(item) for item in approvals[:8]],
            "recent_orbits": [_serialize_orbit(item) for item in orbits[:6]],
            "codespaces": [_serialize_codespace(db, item) for item in codespaces[:6]],
            "notifications": [_serialize_notification(item) for item in notifications[:12]],
        }

    def _serialize_search_result(
        *,
        key: str,
        kind: str,
        label: str,
        detail: str,
        section: str,
        conversation_kind: str | None = None,
        conversation_id: str | None = None,
        detail_kind: str | None = None,
        detail_id: str | None = None,
        workflow_run_id: str | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        return {
            "key": key,
            "kind": kind,
            "label": label,
            "detail": detail,
            "section": section,
            "conversation_kind": conversation_kind,
            "conversation_id": conversation_id,
            "detail_kind": detail_kind,
            "detail_id": detail_id,
            "workflow_run_id": workflow_run_id,
            "metadata": metadata or {},
        }

    def _load_workflow_snapshot(
        db: Session,
        orbit: Orbit,
        *,
        timeout_seconds: float = 1.25,
        sync_projection: bool = False,
    ) -> dict[str, Any]:
        workflow_snapshot = runtime_manager.monitoring_snapshot(orbit, timeout_seconds=timeout_seconds)
        workflow_snapshot = _attach_work_item_context(db, orbit, workflow_snapshot)
        workflow_snapshot = _hydrate_workflow_from_projection(db, orbit, workflow_snapshot)
        _sync_work_items_from_snapshot(db, orbit, workflow_snapshot)
        if sync_projection:
            sync_runtime_projection(db, orbit=orbit, workflow_snapshot=workflow_snapshot)
        return workflow_snapshot

    def _projection_refresh_due(
        db: Session,
        orbit: Orbit,
        workflow_snapshot: dict[str, Any],
        *,
        minimum_age: timedelta = timedelta(seconds=12),
    ) -> bool:
        runs = workflow_snapshot.get("runs")
        if not isinstance(runs, list) or not runs:
            return False
        latest_projection = db.scalar(
            select(RuntimeRunProjection)
            .where(RuntimeRunProjection.orbit_id == orbit.id)
            .order_by(RuntimeRunProjection.updated_at.desc(), RuntimeRunProjection.created_at.desc())
        )
        if latest_projection is None:
            return True
        latest_projection_updated_at = latest_projection.updated_at
        if latest_projection_updated_at.tzinfo is None:
            latest_projection_updated_at = latest_projection_updated_at.replace(tzinfo=utc_now().tzinfo)
        if latest_projection_updated_at <= utc_now() - minimum_age:
            return True
        open_request_ids: set[str] = set()
        run_ids: set[str] = set()
        for run in runs:
            if not isinstance(run, dict):
                continue
            run_id = str(run.get("id") or "").strip()
            if run_id:
                run_ids.add(run_id)
            for request in run.get("human_requests", []):
                if isinstance(request, dict) and str(request.get("status") or "").strip().lower() == "open":
                    request_id = str(request.get("id") or "").strip()
                    if request_id:
                        open_request_ids.add(request_id)
            for request in run.get("approval_requests", []):
                if isinstance(request, dict) and str(request.get("status") or "").strip().lower() == "requested":
                    request_id = str(request.get("id") or "").strip()
                    if request_id:
                        open_request_ids.add(request_id)
        projected_run_ids = {
            projection.workflow_run_id
            for projection in db.scalars(select(RuntimeRunProjection).where(RuntimeRunProjection.orbit_id == orbit.id)).all()
        }
        if not run_ids.issubset(projected_run_ids):
            return True
        projected_open_request_ids = {
            item.request_id
            for item in db.scalars(select(RuntimeHumanLoopItem).where(RuntimeHumanLoopItem.orbit_id == orbit.id)).all()
            if item.status in {"open", "requested"}
        }
        return not open_request_ids.issubset(projected_open_request_ids)

    def _sync_runtime_projection_if_due(db: Session, orbit: Orbit, workflow_snapshot: dict[str, Any]) -> None:
        if not _projection_refresh_due(db, orbit, workflow_snapshot):
            return
        sync_runtime_projection(db, orbit=orbit, workflow_snapshot=workflow_snapshot)

    def _normalize_pull_request_status(item: PullRequestSnapshot) -> str:
        metadata = item.metadata_json or {}
        if metadata.get("merged_at"):
            return "merged"
        if item.state == "closed":
            return "closed"
        if metadata.get("review_decision") == "changes_requested":
            return "changes_requested"
        if metadata.get("blocked"):
            return "blocked"
        if metadata.get("draft"):
            return "queued"
        return "awaiting_review"

    def _normalize_issue_status(item: IssueSnapshot) -> str:
        metadata = item.metadata_json or {}
        labels = {str(label).lower() for label in metadata.get("labels", [])}
        if item.state == "closed":
            return "closed"
        if {"blocked", "needs-blocker"} & labels:
            return "blocked"
        if {"changes-requested", "changes_requested"} & labels:
            return "changes_requested"
        if {"review", "awaiting-review", "awaiting_review"} & labels:
            return "awaiting_review"
        if {"in-progress", "in_progress", "doing"} & labels:
            return "in_progress"
        return "queued"

    def _serialize_pull_request(db: Session, item: PullRequestSnapshot) -> dict[str, Any]:
        linked_work_item = _linked_work_item_for_branch(
            db,
            orbit_id=item.orbit_id,
            branch_name=item.branch_name,
            repository_connection_id=item.repository_connection_id,
        )
        return {
            "id": item.id,
            "number": item.github_number,
            "title": item.title,
            "state": item.state,
            "url": item.url,
            "priority": item.priority,
            "branch_name": item.branch_name,
            "operational_status": _normalize_pull_request_status(item),
            "linked_work_item_id": linked_work_item.id if linked_work_item is not None else None,
            "linked_workflow_run_id": linked_work_item.workflow_run_id if linked_work_item is not None else None,
            "source_kind": "github_pr",
            "orbit_id": item.orbit_id,
            **_repository_identity(db, item.repository_connection_id, item.metadata_json),
        }

    def _serialize_issue(db: Session, item: IssueSnapshot) -> dict[str, Any]:
        return {
            "id": item.id,
            "number": item.github_number,
            "title": item.title,
            "state": item.state,
            "url": item.url,
            "priority": item.priority,
            "operational_status": _normalize_issue_status(item),
            "source_kind": "github_issue",
            "orbit_id": item.orbit_id,
            **_repository_identity(db, item.repository_connection_id, item.metadata_json),
        }

    def _normalize_native_issue_status(value: str | None) -> str:
        normalized = str(value or "triage").strip().lower()
        return normalized if normalized in ORBIT_ISSUE_STATUS_ORDER else "triage"

    def _normalize_native_issue_priority(value: str | None) -> str:
        normalized = str(value or "medium").strip().lower()
        return normalized if normalized in SAVED_VIEW_PRIORITY_ORDER else "medium"

    def _normalize_saved_view_labels(values: list[str] | None) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for value in values or []:
            slug = slugify(str(value or "").strip())
            if not slug or slug in seen:
                continue
            seen.add(slug)
            normalized.append(slug)
        return normalized

    def _normalize_saved_view_relation_scope(value: str | None) -> str:
        normalized = str(value or "any").strip().lower()
        return normalized if normalized in SAVED_VIEW_RELATION_SCOPES else "any"

    def _normalize_saved_view_hierarchy_scope(value: str | None) -> str:
        normalized = str(value or "any").strip().lower()
        return normalized if normalized in SAVED_VIEW_HIERARCHY_SCOPES else "any"

    def _normalize_issue_label_names(values: list[str] | None) -> list[str]:
        normalized: list[str] = []
        seen: set[str] = set()
        for value in values or []:
            name = " ".join(str(value or "").replace(",", " ").split()).strip()
            slug = slugify(name)
            if not slug or slug in seen:
                continue
            seen.add(slug)
            normalized.append(name)
        return normalized

    def _canonicalize_issue_relation(
        issue_id: str,
        related_issue_id: str,
        relation_kind: str,
    ) -> tuple[str, str]:
        if relation_kind in {"related", "duplicate"}:
            return tuple(sorted((issue_id, related_issue_id)))
        return issue_id, related_issue_id

    def _working_days_since(value: datetime | None, *, reference: datetime | None = None) -> int:
        if value is None:
            return 0
        if value.tzinfo is None:
            value = value.replace(tzinfo=utc_now().tzinfo)
        reference = reference or utc_now()
        if reference.tzinfo is None:
            reference = reference.replace(tzinfo=utc_now().tzinfo)
        start_date = value.date()
        end_date = reference.date()
        if end_date <= start_date:
            return 0
        days = 0
        cursor = start_date + timedelta(days=1)
        while cursor <= end_date:
            if cursor.weekday() < 5:
                days += 1
            cursor += timedelta(days=1)
        return days

    def _is_stale_orbit_issue(item: OrbitIssue, *, reference: datetime | None = None) -> bool:
        if _normalize_native_issue_status(item.status) in {"done", "canceled"}:
            return False
        return _working_days_since(item.updated_at, reference=reference) >= STALE_WORKING_DAY_THRESHOLD

    def _label_tone_for_slug(slug: str) -> str:
        if not slug:
            return "muted"
        return ISSUE_LABEL_TONES[sum(ord(char) for char in slug) % len(ISSUE_LABEL_TONES)]

    def _serialize_issue_label_entry(label: IssueLabel, *, issue_count: int | None = None) -> dict[str, Any]:
        payload = {
            "id": label.id,
            "name": label.name,
            "slug": label.slug,
            "tone": label.tone,
        }
        if issue_count is not None:
            payload["issue_count"] = issue_count
        return payload

    def _build_orbit_issue_context(db: Session, issues: list[OrbitIssue]) -> dict[str, Any]:
        if not issues:
            return {
                "issue_map": {},
                "orbit_map": {},
                "cycle_map": {},
                "user_map": {},
                "labels_by_issue": {},
                "label_map": {},
                "label_usage": {},
                "children_map": {},
                "outgoing_relations": {},
                "incoming_relations": {},
                "activity_map": {},
                "stale_days": {},
            }
        orbit_ids = sorted({item.orbit_id for item in issues if item.orbit_id})
        scoped_issues = db.scalars(
            select(OrbitIssue)
            .where(OrbitIssue.orbit_id.in_(orbit_ids))
            .order_by(OrbitIssue.updated_at.desc(), OrbitIssue.sequence_no.desc())
        ).all()
        issue_map = {item.id: item for item in scoped_issues}
        for item in issues:
            issue_map[item.id] = item
        issue_ids = list(issue_map)
        cycle_ids = sorted({item.cycle_id for item in issue_map.values() if item.cycle_id})
        user_ids = sorted(
            {
                user_id
                for item in issue_map.values()
                for user_id in (item.assignee_user_id, item.created_by_user_id)
                if user_id
            }
        )
        relations = db.scalars(
            select(OrbitIssueRelation)
            .where(
                (OrbitIssueRelation.issue_id.in_(issue_ids))
                | (OrbitIssueRelation.related_issue_id.in_(issue_ids))
            )
            .order_by(OrbitIssueRelation.created_at.desc())
        ).all()
        for relation in relations:
            if relation.created_by_user_id:
                user_ids.append(relation.created_by_user_id)
        activity_events = db.scalars(
            select(AuditEvent)
            .where(
                AuditEvent.target_kind == "native_issue",
                AuditEvent.target_id.in_(issue_ids),
            )
            .order_by(AuditEvent.created_at.desc())
        ).all()
        for event in activity_events:
            if event.actor_user_id:
                user_ids.append(event.actor_user_id)
        user_map = {
            item.id: item
            for item in db.scalars(select(User).where(User.id.in_(sorted(set(user_ids))))).all()
        } if user_ids else {}
        orbit_map = {
            item.id: item
            for item in db.scalars(select(Orbit).where(Orbit.id.in_(orbit_ids))).all()
        } if orbit_ids else {}
        cycle_map = {
            item.id: item
            for item in db.scalars(select(OrbitCycle).where(OrbitCycle.id.in_(cycle_ids))).all()
        } if cycle_ids else {}
        label_bindings = db.scalars(
            select(OrbitIssueLabel)
            .where(OrbitIssueLabel.issue_id.in_(issue_ids))
            .order_by(OrbitIssueLabel.created_at.asc())
        ).all()
        label_ids = sorted({binding.label_id for binding in label_bindings})
        label_map = {
            item.id: item
            for item in db.scalars(select(IssueLabel).where(IssueLabel.id.in_(label_ids))).all()
        } if label_ids else {}
        labels_by_issue: dict[str, list[IssueLabel]] = {issue_id: [] for issue_id in issue_ids}
        label_usage: dict[str, int] = {}
        for binding in label_bindings:
            label = label_map.get(binding.label_id)
            if label is None:
                continue
            labels_by_issue.setdefault(binding.issue_id, []).append(label)
            label_usage[label.id] = label_usage.get(label.id, 0) + 1
        for issue_id, labels in labels_by_issue.items():
            labels_by_issue[issue_id] = sorted(labels, key=lambda item: item.name.lower())
        children_map: dict[str, list[OrbitIssue]] = {}
        for child in issue_map.values():
            if child.parent_issue_id:
                children_map.setdefault(child.parent_issue_id, []).append(child)
        for parent_issue_id, children in children_map.items():
            children_map[parent_issue_id] = sorted(children, key=lambda item: item.sequence_no)
        outgoing_relations: dict[str, list[OrbitIssueRelation]] = {}
        incoming_relations: dict[str, list[OrbitIssueRelation]] = {}
        for relation in relations:
            outgoing_relations.setdefault(relation.issue_id, []).append(relation)
            incoming_relations.setdefault(relation.related_issue_id, []).append(relation)
        activity_map: dict[str, list[AuditEvent]] = {}
        for event in activity_events:
            if not event.target_id:
                continue
            activity_map.setdefault(event.target_id, [])
            if len(activity_map[event.target_id]) < 6:
                activity_map[event.target_id].append(event)
        stale_days = {
            issue_id: _working_days_since(item.updated_at)
            for issue_id, item in issue_map.items()
        }
        return {
            "issue_map": issue_map,
            "orbit_map": orbit_map,
            "cycle_map": cycle_map,
            "user_map": user_map,
            "labels_by_issue": labels_by_issue,
            "label_map": label_map,
            "label_usage": label_usage,
            "children_map": children_map,
            "outgoing_relations": outgoing_relations,
            "incoming_relations": incoming_relations,
            "activity_map": activity_map,
            "stale_days": stale_days,
        }

    def _serialize_issue_reference(item: OrbitIssue, *, context: dict[str, Any]) -> dict[str, Any]:
        cycle = context["cycle_map"].get(item.cycle_id) if item.cycle_id else None
        assignee = context["user_map"].get(item.assignee_user_id) if item.assignee_user_id else None
        orbit = context["orbit_map"].get(item.orbit_id)
        stale_days = int(context["stale_days"].get(item.id, 0))
        return {
            "id": item.id,
            "number": item.sequence_no,
            "title": item.title,
            "status": _normalize_native_issue_status(item.status),
            "priority": _normalize_native_issue_priority(item.priority),
            "cycle_id": item.cycle_id,
            "cycle_name": cycle.name if cycle else None,
            "assignee_user_id": item.assignee_user_id,
            "assignee_display_name": assignee.display_name if assignee else None,
            "orbit_id": item.orbit_id,
            "orbit_name": orbit.name if orbit else None,
            "labels": [
                _serialize_issue_label_entry(label)
                for label in context["labels_by_issue"].get(item.id, [])
            ],
            "stale": _is_stale_orbit_issue(item),
            "stale_working_days": stale_days,
        }

    def _serialize_issue_activity(event: AuditEvent, *, context: dict[str, Any]) -> dict[str, Any]:
        actor = context["user_map"].get(event.actor_user_id) if event.actor_user_id else None
        return {
            "id": event.id,
            "action_type": event.action_type,
            "actor_user_id": event.actor_user_id,
            "actor_display_name": actor.display_name if actor else None,
            "metadata": event.metadata_json or {},
            "created_at": event.created_at.isoformat(),
        }

    def _serialize_orbit_cycle(db: Session, item: OrbitCycle) -> dict[str, Any]:
        issues = db.scalars(
            select(OrbitIssue)
            .where(OrbitIssue.orbit_id == item.orbit_id, OrbitIssue.cycle_id == item.id)
            .order_by(OrbitIssue.updated_at.desc())
        ).all()
        completed_count = len([issue for issue in issues if _normalize_native_issue_status(issue.status) == "done"])
        review_count = len([issue for issue in issues if _normalize_native_issue_status(issue.status) in {"in_review", "ready_to_merge"}])
        return {
            "id": item.id,
            "name": item.name,
            "goal": item.goal,
            "status": item.status,
            "starts_at": item.starts_at.isoformat() if item.starts_at else None,
            "ends_at": item.ends_at.isoformat() if item.ends_at else None,
            "issue_count": len(issues),
            "completed_count": completed_count,
            "active_count": len(issues) - completed_count,
            "review_count": review_count,
            "created_at": item.created_at.isoformat(),
            "updated_at": item.updated_at.isoformat(),
        }

    def _serialize_orbit_issue(
        db: Session,
        item: OrbitIssue,
        *,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        context = context or _build_orbit_issue_context(db, [item])
        cycle = context["cycle_map"].get(item.cycle_id) if item.cycle_id else None
        assignee = context["user_map"].get(item.assignee_user_id) if item.assignee_user_id else None
        creator = context["user_map"].get(item.created_by_user_id) if item.created_by_user_id else None
        orbit = context["orbit_map"].get(item.orbit_id)
        parent_issue = context["issue_map"].get(item.parent_issue_id) if item.parent_issue_id else None
        outgoing_relations = context["outgoing_relations"].get(item.id, [])
        incoming_relations = context["incoming_relations"].get(item.id, [])

        def unique_issue_references(entries: list[OrbitIssue]) -> list[dict[str, Any]]:
            seen: set[str] = set()
            serialized: list[dict[str, Any]] = []
            for entry in entries:
                if entry.id in seen:
                    continue
                seen.add(entry.id)
                serialized.append(_serialize_issue_reference(entry, context=context))
            return serialized

        blocked_by_issues = [
            context["issue_map"][relation.related_issue_id]
            for relation in outgoing_relations
            if relation.relation_kind == "blocked_by" and relation.related_issue_id in context["issue_map"]
        ]
        blocking_issues = [
            context["issue_map"][relation.issue_id]
            for relation in incoming_relations
            if relation.relation_kind == "blocked_by" and relation.issue_id in context["issue_map"]
        ]
        related_issues = [
            context["issue_map"][relation.related_issue_id]
            for relation in outgoing_relations
            if relation.relation_kind == "related" and relation.related_issue_id in context["issue_map"]
        ] + [
            context["issue_map"][relation.issue_id]
            for relation in incoming_relations
            if relation.relation_kind == "related" and relation.issue_id in context["issue_map"]
        ]
        duplicate_issues = [
            context["issue_map"][relation.related_issue_id]
            for relation in outgoing_relations
            if relation.relation_kind == "duplicate" and relation.related_issue_id in context["issue_map"]
        ] + [
            context["issue_map"][relation.issue_id]
            for relation in incoming_relations
            if relation.relation_kind == "duplicate" and relation.issue_id in context["issue_map"]
        ]
        sub_issues = context["children_map"].get(item.id, [])
        stale_days = int(context["stale_days"].get(item.id, 0))
        blocked_by_payload = unique_issue_references(blocked_by_issues)
        blocking_payload = unique_issue_references(blocking_issues)
        related_payload = unique_issue_references(related_issues)
        duplicate_payload = unique_issue_references(duplicate_issues)
        return {
            "id": item.id,
            "number": item.sequence_no,
            "title": item.title,
            "detail": item.detail,
            "status": _normalize_native_issue_status(item.status),
            "priority": _normalize_native_issue_priority(item.priority),
            "source_kind": item.source_kind,
            "cycle_id": item.cycle_id,
            "cycle_name": cycle.name if cycle else None,
            "assignee_user_id": item.assignee_user_id,
            "assignee_display_name": assignee.display_name if assignee else None,
            "created_by_user_id": item.created_by_user_id,
            "created_by_display_name": creator.display_name if creator else None,
            "orbit_id": item.orbit_id,
            "orbit_name": orbit.name if orbit else None,
            "repository_connection_id": item.repository_connection_id,
            "labels": [
                _serialize_issue_label_entry(label)
                for label in context["labels_by_issue"].get(item.id, [])
            ],
            "parent_issue_id": item.parent_issue_id,
            "parent_issue": _serialize_issue_reference(parent_issue, context=context) if parent_issue else None,
            "sub_issues": [
                _serialize_issue_reference(child, context=context)
                for child in sub_issues
            ],
            "relations": {
                "blocked_by": blocked_by_payload,
                "blocking": blocking_payload,
                "related": related_payload,
                "duplicate": duplicate_payload,
            },
            "relation_counts": {
                "blocked_by": len(blocked_by_payload),
                "blocking": len(blocking_payload),
                "related": len(related_payload),
                "duplicate": len(duplicate_payload),
            },
            "is_blocked": _normalize_native_issue_status(item.status) == "blocked" or bool(blocked_by_payload),
            "has_sub_issues": bool(sub_issues),
            "stale": _is_stale_orbit_issue(item),
            "stale_working_days": stale_days,
            "activity": [
                _serialize_issue_activity(event, context=context)
                for event in context["activity_map"].get(item.id, [])
            ],
            **_repository_identity(db, item.repository_connection_id, None),
            "created_at": item.created_at.isoformat(),
            "updated_at": item.updated_at.isoformat(),
        }

    def _serialize_issue_label_catalog(context: dict[str, Any]) -> list[dict[str, Any]]:
        labels = list(context.get("label_map", {}).values())
        labels.sort(
            key=lambda item: (
                -int(context.get("label_usage", {}).get(item.id, 0)),
                item.name.lower(),
            )
        )
        return [
            _serialize_issue_label_entry(item, issue_count=int(context.get("label_usage", {}).get(item.id, 0)))
            for item in labels
        ]

    def _serialize_native_issue_as_board_item(
        db: Session,
        item: OrbitIssue,
        *,
        context: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        serialized = _serialize_orbit_issue(db, item, context=context)
        return {
            "id": item.id,
            "number": item.sequence_no,
            "title": item.title,
            "state": item.status,
            "operational_status": item.status,
            "url": "",
            "priority": item.priority,
            "branch_name": None,
            "repository_id": serialized.get("repository_id"),
            "repository_full_name": serialized.get("repository_full_name") or serialized.get("orbit_name"),
            "repository_url": serialized.get("repository_url"),
            "linked_work_item_id": None,
            "linked_workflow_run_id": None,
            "source_kind": "native_issue",
            "orbit_id": item.orbit_id,
            "cycle_id": item.cycle_id,
            "cycle_name": serialized.get("cycle_name"),
            "assignee_user_id": item.assignee_user_id,
            "assignee_display_name": serialized.get("assignee_display_name"),
            "labels": serialized.get("labels", []),
            "stale": serialized.get("stale", False),
            "stale_working_days": serialized.get("stale_working_days", 0),
            "parent_issue_id": item.parent_issue_id,
            "sub_issue_count": len(serialized.get("sub_issues", [])),
            "blocked_by_count": serialized.get("relation_counts", {}).get("blocked_by", 0),
            "related_count": (
                serialized.get("relation_counts", {}).get("related", 0)
                + serialized.get("relation_counts", {}).get("duplicate", 0)
            ),
            "is_blocked": serialized.get("is_blocked", False),
        }

    def _next_orbit_issue_sequence(db: Session, orbit_id: str) -> int:
        current = db.scalar(select(func.max(OrbitIssue.sequence_no)).where(OrbitIssue.orbit_id == orbit_id))
        return int(current or 0) + 1

    def _normalize_saved_view_statuses(values: list[str] | None) -> list[str]:
        normalized: list[str] = []
        for value in values or []:
            status = _normalize_native_issue_status(value)
            if status not in normalized:
                normalized.append(status)
        return normalized

    def _normalize_saved_view_priorities(values: list[str] | None) -> list[str]:
        normalized: list[str] = []
        for value in values or []:
            priority = str(value or "").strip().lower()
            if priority in SAVED_VIEW_PRIORITY_ORDER and priority not in normalized:
                normalized.append(priority)
        return normalized

    def _normalize_saved_view_assignee_scope(value: str | None) -> str:
        normalized = str(value or "all").strip().lower()
        return normalized if normalized in {"all", "me"} else "all"

    def _normalize_saved_view_cycle_scope(value: str | None) -> str:
        normalized = str(value or "any").strip().lower()
        return normalized if normalized in {"any", "with_cycle", "without_cycle"} else "any"

    def _saved_view_filters_payload(
        *,
        statuses: list[str] | None,
        priorities: list[str] | None,
        labels: list[str] | None,
        assignee_scope: str | None,
        cycle_scope: str | None,
        stale_only: bool | None,
        relation_scope: str | None,
        hierarchy_scope: str | None,
    ) -> dict[str, Any]:
        return {
            "statuses": _normalize_saved_view_statuses(statuses),
            "priorities": _normalize_saved_view_priorities(priorities),
            "labels": _normalize_saved_view_labels(labels),
            "assignee_scope": _normalize_saved_view_assignee_scope(assignee_scope),
            "cycle_scope": _normalize_saved_view_cycle_scope(cycle_scope),
            "stale_only": bool(stale_only),
            "relation_scope": _normalize_saved_view_relation_scope(relation_scope),
            "hierarchy_scope": _normalize_saved_view_hierarchy_scope(hierarchy_scope),
        }

    def _saved_view_matches_issue(
        item: OrbitIssue,
        *,
        filters: dict[str, Any],
        user: User,
        context: dict[str, Any],
    ) -> bool:
        if filters.get("orbit_id") and item.orbit_id != filters["orbit_id"]:
            return False

        status = _normalize_native_issue_status(item.status)
        statuses = _normalize_saved_view_statuses(filters.get("statuses"))
        if statuses:
            if status not in statuses:
                return False
        elif status in {"done", "canceled"}:
            return False

        priorities = _normalize_saved_view_priorities(filters.get("priorities"))
        if priorities and str(item.priority or "").strip().lower() not in priorities:
            return False

        assignee_scope = _normalize_saved_view_assignee_scope(filters.get("assignee_scope"))
        if assignee_scope == "me" and item.assignee_user_id != user.id:
            return False

        cycle_scope = _normalize_saved_view_cycle_scope(filters.get("cycle_scope"))
        if cycle_scope == "with_cycle" and not item.cycle_id:
            return False
        if cycle_scope == "without_cycle" and item.cycle_id:
            return False

        labels = _normalize_saved_view_labels(filters.get("labels"))
        if labels:
            issue_label_slugs = {
                label.slug
                for label in context["labels_by_issue"].get(item.id, [])
            }
            if not issue_label_slugs.intersection(labels):
                return False

        if bool(filters.get("stale_only")) and not _is_stale_orbit_issue(item):
            return False

        relation_scope = _normalize_saved_view_relation_scope(filters.get("relation_scope"))
        outgoing_relations = context["outgoing_relations"].get(item.id, [])
        incoming_relations = context["incoming_relations"].get(item.id, [])
        blocked_count = len([relation for relation in outgoing_relations if relation.relation_kind == "blocked_by"]) + len(
            [relation for relation in incoming_relations if relation.relation_kind == "blocked_by"]
        )
        related_count = len([relation for relation in outgoing_relations if relation.relation_kind in {"related", "duplicate"}]) + len(
            [relation for relation in incoming_relations if relation.relation_kind in {"related", "duplicate"}]
        )
        if relation_scope == "blocked" and (
            blocked_count == 0
            and status != "blocked"
        ):
            return False
        if relation_scope == "related" and related_count == 0:
            return False

        hierarchy_scope = _normalize_saved_view_hierarchy_scope(filters.get("hierarchy_scope"))
        if hierarchy_scope == "parent" and not item.parent_issue_id:
            return False
        if hierarchy_scope == "child" and not context["children_map"].get(item.id):
            return False
        if hierarchy_scope == "root" and item.parent_issue_id:
            return False

        return True

    def _saved_view_tone(items: list[OrbitIssue], *, context: dict[str, Any]) -> str:
        if not items:
            return "muted"
        if any(str(item.priority or "").strip().lower() == "urgent" for item in items):
            return "danger"
        if any(_is_stale_orbit_issue(item) for item in items):
            return "warning"
        if any(
            _normalize_native_issue_status(item.status) == "blocked"
            or bool(
                len([relation for relation in context["outgoing_relations"].get(item.id, []) if relation.relation_kind == "blocked_by"])
                + len([relation for relation in context["incoming_relations"].get(item.id, []) if relation.relation_kind == "blocked_by"])
            )
            for item in items
        ):
            return "danger"
        if any(_normalize_native_issue_status(item.status) in {"in_review", "ready_to_merge"} for item in items):
            return "warning"
        return "accent"

    def _serialize_saved_view_preview_item(
        item: OrbitIssue,
        *,
        orbit_map: dict[str, Orbit],
        cycle_map: dict[str, OrbitCycle],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        orbit = orbit_map.get(item.orbit_id)
        cycle = cycle_map.get(item.cycle_id) if item.cycle_id else None
        detail_parts = [
            cycle.name if cycle else "No cycle",
            f"Priority {str(item.priority or 'medium').strip().lower()}",
        ]
        labels = context["labels_by_issue"].get(item.id, [])
        if labels:
            detail_parts.append(", ".join(label.name for label in labels[:2]))
        if _is_stale_orbit_issue(item):
            detail_parts.append(f"Stale {context['stale_days'].get(item.id, 0)}d")
        preview = {
            "id": f"native-{item.id}",
            "kind": "native_issue",
            "eyebrow": orbit.name if orbit else "Orbit issue",
            "title": f"PM-{item.sequence_no} · {item.title}",
            "detail": " · ".join(detail_parts),
            "status": _format_state_label(_normalize_native_issue_status(item.status)),
            "tone": _saved_view_tone([item], context=context),
            "href": f"/app/orbits/{item.orbit_id}?section=issues&detailKind=native_issue&detailId={item.id}",
            "timestamp": item.updated_at.isoformat(),
        }
        if orbit and orbit.repo_full_name:
            preview["supporting"] = orbit.repo_full_name
        return preview

    def _saved_view_filter_summary(
        filters: dict[str, Any],
        *,
        orbit_map: dict[str, Orbit],
    ) -> list[str]:
        summary: list[str] = []
        orbit_id = str(filters.get("orbit_id") or "").strip()
        if orbit_id and orbit_id in orbit_map:
            summary.append(orbit_map[orbit_id].name)
        else:
            summary.append("All orbits")

        assignee_scope = _normalize_saved_view_assignee_scope(filters.get("assignee_scope"))
        summary.append("Assigned to me" if assignee_scope == "me" else "All assignees")

        statuses = _normalize_saved_view_statuses(filters.get("statuses"))
        if statuses:
            summary.extend(_format_state_label(status) for status in statuses[:2])
            if len(statuses) > 2:
                summary.append(f"+{len(statuses) - 2} stages")
        else:
            summary.append("Open work")

        priorities = _normalize_saved_view_priorities(filters.get("priorities"))
        if priorities:
            summary.append("Priority " + ", ".join(_format_state_label(priority) for priority in priorities))

        labels = _normalize_saved_view_labels(filters.get("labels"))
        if labels:
            summary.append("Labels " + ", ".join(labels[:2]))
            if len(labels) > 2:
                summary.append(f"+{len(labels) - 2} labels")

        cycle_scope = _normalize_saved_view_cycle_scope(filters.get("cycle_scope"))
        if cycle_scope == "with_cycle":
            summary.append("In a cycle")
        elif cycle_scope == "without_cycle":
            summary.append("No cycle")

        if bool(filters.get("stale_only")):
            summary.append("Stale work")

        relation_scope = _normalize_saved_view_relation_scope(filters.get("relation_scope"))
        if relation_scope == "blocked":
            summary.append("Dependency risk")
        elif relation_scope == "related":
            summary.append("Has linked work")

        hierarchy_scope = _normalize_saved_view_hierarchy_scope(filters.get("hierarchy_scope"))
        if hierarchy_scope == "parent":
            summary.append("Sub-issue")
        elif hierarchy_scope == "child":
            summary.append("Parent issue")
        elif hierarchy_scope == "root":
            summary.append("Root issue")

        return summary

    def _saved_view_is_pinned(item: SavedView | None) -> bool:
        return bool(item and int(item.pin_rank or 0) > 0)

    def _next_saved_view_pin_rank(db: Session, *, user_id: str) -> int:
        current = db.scalar(select(func.max(SavedView.pin_rank)).where(SavedView.created_by_user_id == user_id))
        return int(current or 0) + 1

    def _system_saved_views(user: User) -> list[dict[str, Any]]:
        return [
            {
                "id": "system-assigned-to-me",
                "name": "Assigned to me",
                "description": "Everything currently owned by you across orbit-native issue work.",
                "kind": "system",
                "filters": {"assignee_scope": "me"},
            },
            {
                "id": "system-needs-review",
                "name": "Needs review",
                "description": "Native issues currently waiting on review or merge readiness.",
                "kind": "system",
                "filters": {"statuses": ["in_review", "ready_to_merge"]},
            },
            {
                "id": "system-dependency-risk",
                "name": "Dependency risk",
                "description": "Issues blocked by upstream work or already acting as blockers for downstream delivery.",
                "kind": "system",
                "filters": {"relation_scope": "blocked"},
            },
            {
                "id": "system-stale-owned-work",
                "name": "Stale owned work",
                "description": "Assigned work with no meaningful updates across three working days.",
                "kind": "system",
                "filters": {"assignee_scope": "me", "stale_only": True},
            },
            {
                "id": "system-active-cycle",
                "name": "Active cycle",
                "description": "Scheduled work already committed into an explicit delivery cycle.",
                "kind": "system",
                "filters": {"cycle_scope": "with_cycle"},
            },
        ]

    def _serialize_saved_view_entry(
        definition: dict[str, Any],
        *,
        issues: list[OrbitIssue],
        user: User,
        orbit_map: dict[str, Orbit],
        cycle_map: dict[str, OrbitCycle],
        context: dict[str, Any],
    ) -> dict[str, Any]:
        filters = dict(definition.get("filters") or {})
        matched = [item for item in issues if _saved_view_matches_issue(item, filters=filters, user=user, context=context)]
        matched.sort(key=lambda item: item.updated_at, reverse=True)
        return {
            "id": definition["id"],
            "label": definition["name"],
            "detail": definition.get("description") or "Saved issue view.",
            "tone": _saved_view_tone(matched, context=context),
            "count": len(matched),
            "kind": definition.get("kind") or "custom",
            "filter_summary": _saved_view_filter_summary(filters, orbit_map=orbit_map),
            "filters": filters,
            "pinned": bool(definition.get("pinned")),
            "pin_rank": int(definition.get("pin_rank") or 0),
            "preview": [
                _serialize_saved_view_preview_item(item, orbit_map=orbit_map, cycle_map=cycle_map, context=context)
                for item in matched[:6]
            ],
            "created_at": definition.get("created_at"),
            "updated_at": definition.get("updated_at"),
        }

    def _build_saved_views_payload(user: User, db: Session) -> dict[str, Any]:
        memberships = db.scalars(select(OrbitMembership).where(OrbitMembership.user_id == user.id)).all()
        orbit_ids = [membership.orbit_id for membership in memberships]
        orbits = db.scalars(select(Orbit).where(Orbit.id.in_(orbit_ids)).order_by(Orbit.created_at.desc())).all() if orbit_ids else []
        orbit_map = {orbit.id: orbit for orbit in orbits}
        cycles = db.scalars(select(OrbitCycle).where(OrbitCycle.orbit_id.in_(orbit_ids)).order_by(OrbitCycle.updated_at.desc())).all() if orbit_ids else []
        cycle_map = {cycle.id: cycle for cycle in cycles}
        issues = db.scalars(select(OrbitIssue).where(OrbitIssue.orbit_id.in_(orbit_ids)).order_by(OrbitIssue.updated_at.desc())).all() if orbit_ids else []
        issue_context = _build_orbit_issue_context(db, issues)
        custom_views = db.scalars(
            select(SavedView)
            .where(SavedView.created_by_user_id == user.id)
            .order_by(SavedView.pin_rank.desc(), SavedView.updated_at.desc(), SavedView.created_at.desc())
        ).all()
        entries = [
            _serialize_saved_view_entry(spec, issues=issues, user=user, orbit_map=orbit_map, cycle_map=cycle_map, context=issue_context)
            for spec in _system_saved_views(user)
        ]
        entries.extend(
            _serialize_saved_view_entry(
                {
                    "id": item.id,
                    "name": item.name,
                    "description": item.description,
                    "kind": "custom",
                    "filters": {**(item.filters_json or {}), "orbit_id": item.orbit_id},
                    "pinned": _saved_view_is_pinned(item),
                    "pin_rank": int(item.pin_rank or 0),
                    "created_at": item.created_at.isoformat(),
                    "updated_at": item.updated_at.isoformat(),
                },
                issues=issues,
                user=user,
                orbit_map=orbit_map,
                cycle_map=cycle_map,
                context=issue_context,
            )
            for item in custom_views
        )
        return {"views": entries}

    def _cycle_window_label(item: OrbitCycle) -> str:
        if item.starts_at or item.ends_at:
            parts = []
            if item.starts_at:
                parts.append(f"{item.starts_at.strftime('%b')} {item.starts_at.day}")
            if item.ends_at:
                parts.append(f"{item.ends_at.strftime('%b')} {item.ends_at.day}")
            if len(parts) == 2:
                return f"{parts[0]} - {parts[1]}"
            if parts:
                return parts[0]
        return _format_state_label(item.status)

    def _workspace_cycle_tone(issue_payloads: list[dict[str, Any]]) -> str:
        if not issue_payloads:
            return "muted"
        if any(item.get("is_blocked") or item.get("stale") for item in issue_payloads):
            return "danger"
        if any(str(item.get("status") or "").strip().lower() in {"in_review", "ready_to_merge"} for item in issue_payloads):
            return "warning"
        if any(str(item.get("status") or "").strip().lower() not in {"done", "canceled"} for item in issue_payloads):
            return "accent"
        return "success"

    def _serialize_workspace_cycle_entry(
        db: Session,
        item: OrbitCycle,
        *,
        orbit: Orbit | None,
        issues: list[OrbitIssue],
        context: dict[str, Any],
        cycle_map: dict[str, OrbitCycle],
    ) -> dict[str, Any]:
        issue_payloads = [_serialize_orbit_issue(db, issue, context=context) for issue in issues]
        blocked_count = len([issue for issue in issue_payloads if issue.get("is_blocked")])
        stale_count = len([issue for issue in issue_payloads if issue.get("stale")])
        review_count = len([issue for issue in issue_payloads if str(issue.get("status") or "").strip().lower() in {"in_review", "ready_to_merge"}])
        completed_count = len([issue for issue in issue_payloads if str(issue.get("status") or "").strip().lower() == "done"])
        sorted_issues = sorted(issues, key=lambda entry: entry.updated_at, reverse=True)
        return {
            "id": item.id,
            "orbit_id": item.orbit_id,
            "orbit_name": orbit.name if orbit else "Orbit",
            "label": item.name,
            "detail": item.goal or f"{orbit.name if orbit else 'Orbit'} delivery cycle",
            "window_label": _cycle_window_label(item),
            "tone": _workspace_cycle_tone(issue_payloads),
            "status": item.status,
            "goal": item.goal,
            "starts_at": item.starts_at.isoformat() if item.starts_at else None,
            "ends_at": item.ends_at.isoformat() if item.ends_at else None,
            "metrics": {
                "count": len(sorted_issues),
                "review": review_count,
                "blocked": blocked_count,
                "stale": stale_count,
                "completed": completed_count,
            },
            "highlights": [
                _serialize_saved_view_preview_item(issue, orbit_map=context["orbit_map"], cycle_map=cycle_map, context=context)
                for issue in sorted_issues[:6]
            ],
            "created_at": item.created_at.isoformat(),
            "updated_at": item.updated_at.isoformat(),
        }

    def _build_planning_cycles_payload(user: User, db: Session) -> dict[str, Any]:
        memberships = db.scalars(select(OrbitMembership).where(OrbitMembership.user_id == user.id)).all()
        orbit_ids = [membership.orbit_id for membership in memberships]
        orbits = db.scalars(select(Orbit).where(Orbit.id.in_(orbit_ids)).order_by(Orbit.created_at.desc())).all() if orbit_ids else []
        orbit_map = {orbit.id: orbit for orbit in orbits}
        cycles = db.scalars(
            select(OrbitCycle)
            .where(OrbitCycle.orbit_id.in_(orbit_ids))
            .order_by(OrbitCycle.starts_at.desc(), OrbitCycle.ends_at.desc(), OrbitCycle.updated_at.desc(), OrbitCycle.created_at.desc())
        ).all() if orbit_ids else []
        issues = db.scalars(
            select(OrbitIssue)
            .where(OrbitIssue.orbit_id.in_(orbit_ids), OrbitIssue.cycle_id.is_not(None))
            .order_by(OrbitIssue.updated_at.desc())
        ).all() if orbit_ids else []
        issue_context = _build_orbit_issue_context(db, issues)
        cycle_map = {cycle.id: cycle for cycle in cycles}
        issues_by_cycle: dict[str, list[OrbitIssue]] = {}
        for issue in issues:
            if issue.cycle_id:
                issues_by_cycle.setdefault(issue.cycle_id, []).append(issue)

        entries = [
            _serialize_workspace_cycle_entry(
                db,
                cycle,
                orbit=orbit_map.get(cycle.orbit_id),
                issues=issues_by_cycle.get(cycle.id, []),
                context=issue_context,
                cycle_map=cycle_map,
            )
            for cycle in cycles
        ]
        return {"cycles": entries}

    def _resolve_issue_assignee_user_id(db: Session, orbit: Orbit, assignee_user_id: str | None) -> str | None:
        normalized = str(assignee_user_id or "").strip() or None
        if normalized is None:
            return None
        membership = db.scalar(
            select(OrbitMembership).where(
                OrbitMembership.orbit_id == orbit.id,
                OrbitMembership.user_id == normalized,
            )
        )
        if membership is None:
            raise HTTPException(status_code=404, detail="Assignee is not a member of this orbit")
        return normalized

    def _resolve_issue_parent(
        db: Session,
        orbit: Orbit,
        parent_issue_id: str | None,
        *,
        issue: OrbitIssue | None = None,
    ) -> str | None:
        normalized = str(parent_issue_id or "").strip() or None
        if normalized is None:
            return None
        parent_issue = db.get(OrbitIssue, normalized)
        if parent_issue is None or parent_issue.orbit_id != orbit.id:
            raise HTTPException(status_code=404, detail="Parent issue not found")
        if issue is not None and parent_issue.id == issue.id:
            raise HTTPException(status_code=400, detail="An issue cannot parent itself")
        cursor = parent_issue.parent_issue_id
        while cursor:
            if issue is not None and cursor == issue.id:
                raise HTTPException(status_code=400, detail="This parent would create a cycle in the issue hierarchy")
            ancestor = db.get(OrbitIssue, cursor)
            cursor = ancestor.parent_issue_id if ancestor is not None else None
        return parent_issue.id

    def _ensure_issue_label(db: Session, *, user: User, name: str) -> IssueLabel | None:
        normalized_name = " ".join(str(name or "").split()).strip()
        slug = slugify(normalized_name)
        if not slug:
            return None
        label = db.scalar(select(IssueLabel).where(IssueLabel.slug == slug))
        if label is None:
            label = IssueLabel(
                created_by_user_id=user.id,
                name=normalized_name,
                slug=slug,
                tone=_label_tone_for_slug(slug),
            )
            db.add(label)
            db.flush()
        elif normalized_name and label.name != normalized_name:
            label.name = normalized_name
            label.updated_at = utc_now()
        return label

    def _replace_issue_labels(db: Session, issue: OrbitIssue, *, labels: list[str], user: User) -> None:
        label_names = _normalize_issue_label_names(labels)
        db.execute(delete(OrbitIssueLabel).where(OrbitIssueLabel.issue_id == issue.id))
        for label_name in label_names:
            label = _ensure_issue_label(db, user=user, name=label_name)
            if label is None:
                continue
            db.add(OrbitIssueLabel(issue_id=issue.id, label_id=label.id))
        issue.updated_at = utc_now()
        db.flush()

    def _replace_issue_relations(
        db: Session,
        issue: OrbitIssue,
        *,
        relation_kind: str,
        related_issue_ids: list[str],
        orbit: Orbit,
        user: User,
    ) -> None:
        normalized_ids: list[str] = []
        seen: set[str] = set()
        for related_issue_id in related_issue_ids:
            normalized = str(related_issue_id or "").strip()
            if not normalized or normalized == issue.id or normalized in seen:
                continue
            related_issue = db.get(OrbitIssue, normalized)
            if related_issue is None or related_issue.orbit_id != orbit.id:
                raise HTTPException(status_code=404, detail="Related issue not found")
            seen.add(normalized)
            normalized_ids.append(normalized)

        if relation_kind in {"related", "duplicate"}:
            db.execute(
                delete(OrbitIssueRelation).where(
                    OrbitIssueRelation.relation_kind == relation_kind,
                    (OrbitIssueRelation.issue_id == issue.id) | (OrbitIssueRelation.related_issue_id == issue.id),
                )
            )
        else:
            db.execute(
                delete(OrbitIssueRelation).where(
                    OrbitIssueRelation.relation_kind == relation_kind,
                    OrbitIssueRelation.issue_id == issue.id,
                )
            )

        for related_issue_id in normalized_ids:
            left_id, right_id = _canonicalize_issue_relation(issue.id, related_issue_id, relation_kind)
            db.add(
                OrbitIssueRelation(
                    issue_id=left_id,
                    related_issue_id=right_id,
                    relation_kind=relation_kind,
                    created_by_user_id=user.id,
                )
            )
        issue.updated_at = utc_now()
        db.flush()

    def _mapped_work_item_status(run_payload: dict[str, Any]) -> str:
        status = str(run_payload.get("status") or "").strip().lower()
        operator_status = str(run_payload.get("operator_status") or "").strip().lower()
        execution_status = str(run_payload.get("execution_status") or "").strip().lower()
        if status == "completed":
            return "completed"
        if status == "failed" or execution_status == "failed":
            return "blocked"
        if operator_status == "waiting_for_human":
            return "needs_input"
        if operator_status == "waiting_for_approval":
            return "in_review"
        return "in_process"

    def _sync_work_items_from_snapshot(db: Session, orbit: Orbit, workflow_snapshot: dict[str, Any]) -> None:
        runs = workflow_snapshot.get("runs")
        if not isinstance(runs, list) or not runs:
            return
        run_map = {
            str(run.get("id")): run
            for run in runs
            if isinstance(run, dict) and str(run.get("id", "")).strip()
        }
        if not run_map:
            return
        work_items = db.scalars(
            select(WorkItem).where(
                WorkItem.orbit_id == orbit.id,
                WorkItem.workflow_run_id.is_not(None),
            )
        ).all()
        changed = False
        for item in work_items:
            if not item.workflow_run_id:
                continue
            run_payload = run_map.get(item.workflow_run_id)
            if run_payload is None:
                continue
            next_status = _mapped_work_item_status(run_payload)
            next_summary = str(
                run_payload.get("operator_summary")
                or run_payload.get("execution_summary")
                or item.summary
                or ""
            ).strip() or None
            if item.status != next_status or item.summary != next_summary:
                item.status = next_status
                item.summary = next_summary
                item.updated_at = utc_now()
                changed = True
        if changed:
            db.flush()

    def _attach_work_item_context(db: Session, orbit: Orbit, workflow_snapshot: dict[str, Any]) -> dict[str, Any]:
        runs = workflow_snapshot.get("runs")
        if not isinstance(runs, list):
            return workflow_snapshot
        work_items = db.scalars(
            select(WorkItem).where(
                WorkItem.orbit_id == orbit.id,
                WorkItem.workflow_run_id.is_not(None),
            )
        ).all()
        work_items_by_run = {item.workflow_run_id: item for item in work_items if item.workflow_run_id}
        enriched_runs: list[dict[str, Any]] = []
        selected_run_id = str(workflow_snapshot.get("selected_run_id") or "").strip() or None
        selected_run = None
        for run in runs:
            if not isinstance(run, dict):
                enriched_runs.append(run)
                continue
            run_id = str(run.get("id") or "").strip()
            item = work_items_by_run.get(run_id)
            enriched = dict(run)
            if item is not None:
                repository_ids = repository_ids_for_run(db, run_id) or repository_ids_for_work_item(db, item)
                enriched.update(
                    {
                        "work_item_id": item.id,
                        "source_channel_id": item.source_channel_id,
                        "source_dm_thread_id": item.source_dm_thread_id,
                        "repository_ids": repository_ids,
                    }
                )
            if selected_run_id and run_id == selected_run_id:
                selected_run = enriched
            enriched_runs.append(enriched)
        workflow_snapshot = {
            **workflow_snapshot,
            "runs": enriched_runs,
            "selected_run": selected_run or workflow_snapshot.get("selected_run"),
        }
        return workflow_snapshot

    def _hydrate_workflow_from_projection(db: Session, orbit: Orbit, workflow_snapshot: dict[str, Any]) -> dict[str, Any]:
        runs = workflow_snapshot.get("runs")
        if isinstance(runs, list) and runs:
            return workflow_snapshot
        projections = db.scalars(
            select(RuntimeRunProjection)
            .where(RuntimeRunProjection.orbit_id == orbit.id)
            .order_by(RuntimeRunProjection.updated_at.desc(), RuntimeRunProjection.created_at.desc())
        ).all()
        if not projections:
            return workflow_snapshot
        hydrated_runs: list[dict[str, Any]] = []
        for projection in projections:
            if isinstance(projection.snapshot_json, dict) and projection.snapshot_json:
                hydrated = dict(projection.snapshot_json)
            else:
                hydrated = {
                    "id": projection.workflow_run_id,
                    "title": projection.title,
                    "status": projection.status,
                    "operator_status": projection.operator_status,
                    "execution_status": projection.execution_status,
                    "operator_summary": projection.summary,
                    "execution_summary": projection.summary,
                    "tasks": [],
                    "events": [],
                    "human_requests": [],
                    "approval_requests": [],
                }
            hydrated.setdefault("id", projection.workflow_run_id)
            hydrated_runs.append(hydrated)
        selected_run = hydrated_runs[0] if hydrated_runs else None
        hydrated_snapshot = {
            **workflow_snapshot,
            "status": "degraded",
            "stale": True,
            "runs": hydrated_runs,
            "selected_run_id": selected_run.get("id") if isinstance(selected_run, dict) else None,
            "selected_run": selected_run,
        }
        return _attach_work_item_context(db, orbit, hydrated_snapshot)

    def _workflow_payload_from_work_item(db: Session, work_item: WorkItem) -> dict[str, Any]:
        normalized_status = str(work_item.status or "").strip().lower()
        if normalized_status == "completed":
            status = "completed"
            operator_status = "completed"
            execution_status = "completed"
        elif normalized_status in {"blocked", "failed"}:
            status = "failed"
            operator_status = "failed"
            execution_status = "failed"
        elif normalized_status == "needs_input":
            status = "running"
            operator_status = "waiting_for_human"
            execution_status = "waiting_for_human"
        elif normalized_status == "in_review":
            status = "running"
            operator_status = "waiting_for_approval"
            execution_status = "waiting_for_approval"
        elif normalized_status in {"queued", "ready"}:
            status = "queued"
            operator_status = "queued"
            execution_status = "queued"
        else:
            status = "running"
            operator_status = "active"
            execution_status = "active"
        summary = work_item.summary or "Workflow detail will refresh from the runtime board shortly."
        return {
            "id": work_item.workflow_run_id,
            "title": work_item.title or work_item.request_text or work_item.workflow_run_id,
            "status": status,
            "operator_status": operator_status,
            "operator_summary": summary,
            "execution_status": execution_status,
            "execution_summary": summary,
            "tasks": [],
            "events": [],
            "human_requests": [],
            "approval_requests": [],
            "work_item_id": work_item.id,
            "source_channel_id": work_item.source_channel_id,
            "source_dm_thread_id": work_item.source_dm_thread_id,
            "repository_ids": repository_ids_for_work_item(db, work_item),
        }

    def _workflow_hot_read(db: Session, orbit: Orbit) -> dict[str, Any]:
        empty_snapshot = {
            "status": "ok",
            "load_error": None,
            "selected_run_id": None,
            "selected_run": None,
            "runs": [],
        }
        hydrated = _hydrate_workflow_from_projection(db, orbit, empty_snapshot)
        runs = hydrated.get("runs")
        if isinstance(runs, list) and runs:
            return hydrated
        work_items = db.scalars(
            select(WorkItem)
            .where(
                WorkItem.orbit_id == orbit.id,
                WorkItem.workflow_run_id.is_not(None),
            )
            .order_by(WorkItem.updated_at.desc(), WorkItem.created_at.desc())
        ).all()
        fallback_runs = [
            _workflow_payload_from_work_item(db, item)
            for item in work_items
            if str(item.workflow_run_id or "").strip()
        ]
        if not fallback_runs:
            return empty_snapshot
        selected_run = fallback_runs[0]
        return {
            "status": "degraded",
            "load_error": "Serving the last saved workflow view while runtime sync catches up.",
            "stale": True,
            "selected_run_id": selected_run["id"],
            "selected_run": selected_run,
            "runs": fallback_runs,
        }

    def _orbit_membership_for_user(db: Session, orbit_id: str, user_id: str) -> OrbitMembership | None:
        return db.scalar(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit_id, OrbitMembership.user_id == user_id))

    def _require_permission(condition: bool, detail: str) -> None:
        if not condition:
            raise HTTPException(status_code=403, detail=detail)

    def _orbit_for_member(db: Session, orbit_id: str, user: User) -> Orbit:
        membership = db.scalar(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit_id, OrbitMembership.user_id == user.id))
        if membership is None:
            raise HTTPException(status_code=404, detail="Orbit not found")
        orbit = db.get(Orbit, orbit_id)
        if orbit is None:
            raise HTTPException(status_code=404, detail="Orbit missing")
        return orbit

    def _orbit_channel(db: Session, orbit_id: str) -> Channel:
        channel = db.scalar(select(Channel).where(Channel.orbit_id == orbit_id, Channel.slug == "general"))
        if channel is None:
            raise HTTPException(status_code=404, detail="Orbit channel not found")
        return channel

    def _orbit_channel_by_id(db: Session, orbit_id: str, channel_id: str) -> Channel:
        channel = db.scalar(select(Channel).where(Channel.id == channel_id, Channel.orbit_id == orbit_id))
        if channel is None:
            raise HTTPException(status_code=404, detail="Channel not found")
        return channel

    def _orbit_dm_thread(db: Session, orbit_id: str, thread_id: str) -> DmThread:
        thread = db.scalar(select(DmThread).where(DmThread.id == thread_id, DmThread.orbit_id == orbit_id))
        if thread is None:
            raise HTTPException(status_code=404, detail="DM thread not found")
        return thread

    def _ensure_dm_participant_access(db: Session, thread: DmThread, user: User) -> None:
        participant = db.scalar(select(DmParticipant).where(DmParticipant.thread_id == thread.id, DmParticipant.user_id == user.id))
        if participant is None:
            raise HTTPException(status_code=404, detail="DM thread not found")

    def _unique_orbit_slug(db: Session, name: str) -> str:
        base_slug = slugify(name)
        candidate = base_slug
        suffix = 2
        while db.scalar(select(Orbit).where(Orbit.slug == candidate)) is not None:
            candidate = f"{base_slug}-{suffix}"
            suffix += 1
        return candidate

    def _unique_channel_slug(db: Session, orbit_id: str, name: str, preferred_slug: str | None = None) -> str:
        base_slug = slugify(preferred_slug or name)
        candidate = base_slug
        suffix = 2
        while db.scalar(select(Channel).where(Channel.orbit_id == orbit_id, Channel.slug == candidate)) is not None:
            candidate = f"{base_slug}-{suffix}"
            suffix += 1
        return candidate

    def _ergo_dm_thread(db: Session, orbit: Orbit, user: User) -> DmThread:
        ergo_dm = db.scalar(select(DmThread).where(DmThread.orbit_id == orbit.id, DmThread.title == "ERGO"))
        if ergo_dm is None:
            ergo_dm = DmThread(orbit_id=orbit.id, title="ERGO")
            db.add(ergo_dm)
            db.flush()
        existing_participant = db.scalar(
            select(DmParticipant).where(DmParticipant.thread_id == ergo_dm.id, DmParticipant.user_id == user.id)
        )
        if existing_participant is None:
            db.add(DmParticipant(thread_id=ergo_dm.id, user_id=user.id))
            db.flush()
        return ergo_dm

    def _serialize_channel(channel: Channel) -> dict[str, Any]:
        return {
            "id": channel.id,
            "slug": channel.slug,
            "name": channel.name,
            "kind": channel.kind,
        }

    def _serialize_dm_thread(db: Session, thread: DmThread, *, viewer: User) -> dict[str, Any]:
        participants = db.scalars(select(DmParticipant).where(DmParticipant.thread_id == thread.id)).all()
        participant_users = [db.get(User, participant.user_id) for participant in participants]
        visible_participants = [member for member in participant_users if member is not None and member.id != viewer.id]
        counterpart = visible_participants[0] if visible_participants else None
        is_ergo = thread.title == "ERGO"
        return {
            "id": thread.id,
            "title": thread.title,
            "kind": "agent" if is_ergo else "member",
            "participant": (
                {
                    "id": "ergo",
                    "user_id": None,
                    "login": "ERGO",
                    "github_login": "ERGO",
                    "display_name": "ERGO",
                    "avatar_url": None,
                    "role": "agent",
                    "is_self": False,
                }
                if is_ergo
                else (
                    {
                        "id": counterpart.id,
                        "user_id": counterpart.id,
                        "login": counterpart.github_login,
                        "github_login": counterpart.github_login,
                        "display_name": counterpart.display_name,
                        "avatar_url": counterpart.avatar_url,
                        "role": "member",
                        "is_self": False,
                    }
                    if counterpart
                    else None
                )
            ),
        }

    def _ensure_default_orbit_records(db: Session, orbit: Orbit, user: User) -> None:
        general = db.scalar(select(Channel).where(Channel.orbit_id == orbit.id, Channel.slug == "general"))
        if general is None:
            general = Channel(orbit_id=orbit.id, slug="general", name="general")
            db.add(general)
        _ergo_dm_thread(db, orbit, user)

    def _send_invite_email(invite: OrbitInvite, orbit: Orbit) -> None:
        message = EmailMessage()
        message["Subject"] = f"Invitation to join {orbit.name}"
        message["From"] = settings.mail_from
        message["To"] = invite.email
        message.set_content(
            f"You were invited to join {orbit.name}.\n\n"
            f"Accept the invite in AutoWeave Web with token: {invite.token}\n"
        )
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as smtp:
                smtp.send_message(message)
        except OSError:
            # Local development should keep the invite usable even if the email sink is unavailable.
            return

    def _record_context(orbit: Orbit, *, source_kind: str, source_id: str, event_type: str, body: str, payload_json: dict[str, Any], db: Session) -> None:
        projection = ingest_product_event(
            db,
            orbit_id=orbit.id,
            source_kind=source_kind,
            source_id=source_id,
            event_type=event_type,
            body=body,
            payload_json=payload_json,
        )
        runtime_manager.project_context_memory(
            orbit,
            content=f"{source_kind}: {projection.summary}",
            metadata_json={
                "orbit_id": orbit.id,
                "source_kind": projection.source_kind,
                "source_id": projection.source_id,
                "references": projection.references_json,
            },
        )

    def _ergo_reply_for(body: str) -> tuple[str | None, bool]:
        text = body.strip()
        lowered = text.lower()
        if lowered in {"@ergo hello", "ergo hello", "hello @ergo"}:
            return "hello", False
        build_cues = ("build", "make", "create", "ship", "implement")
        if any(cue in lowered for cue in build_cues):
            detail_markers = (
                "app",
                "artifact",
                "dashboard",
                "api",
                "workflow",
                "landing",
                "frontend",
                "backend",
                "orbit",
                "issue",
                "screen",
                "report",
                "demo",
                "release notes",
                "docs",
            )
            if not any(marker in lowered for marker in detail_markers):
                return "What should I build exactly inside this orbit?", False
            return "working on it", True
        return None, False

    def _start_work_item(
        db: Session,
        orbit: Orbit,
        user: User,
        *,
        request_text: str,
        summary: str | None,
        source_channel_id: str | None = None,
        source_dm_thread_id: str | None = None,
    ) -> dict[str, Any]:
        primary_repo = primary_repository_for_orbit(db, orbit)
        branch_name = f"ergo/{slugify(request_text)[:40]}"
        draft_pr_url = None
        if primary_repo is not None:
            repo_access.create_branch(
                db,
                actor_user=user,
                repository=primary_repo,
                branch_name=branch_name,
                base_branch=primary_repo.default_branch,
            )
            pr = repo_access.create_draft_pull_request(
                db,
                actor_user=user,
                repository=primary_repo,
                title=f"ERGO: {request_text[:72]}",
                head=branch_name,
                base=primary_repo.default_branch,
                body="Draft PR opened automatically for ERGO work tracking.",
            )
            draft_pr_url = pr.get("html_url")
        work_item = WorkItem(
            orbit_id=orbit.id,
            requested_by_user_id=user.id,
            title=request_text[:80],
            request_text=request_text,
            status="in_process",
            branch_name=branch_name,
            draft_pr_url=draft_pr_url,
            source_channel_id=source_channel_id,
            source_dm_thread_id=source_dm_thread_id,
            summary=summary,
        )
        db.add(work_item)
        db.flush()
        if primary_repo is not None:
            ensure_work_item_repo_scope(db, work_item=work_item, repository_connection_id=primary_repo.id)
        workflow_result = runtime_manager.queue_workflow(orbit, request_text=request_text)
        work_item.workflow_run_id = workflow_result.get("workflow_run_id") or workflow_result.get("celery_task_id")
        if primary_repo is not None and work_item.workflow_run_id:
            ensure_run_repo_scope(
                db,
                orbit_id=orbit.id,
                workflow_run_id=work_item.workflow_run_id,
                repository_connection_id=primary_repo.id,
            )
        if draft_pr_url:
            upsert_artifact(
                db,
                orbit_id=orbit.id,
                repository_connection_id=primary_repo.id if primary_repo is not None else None,
                work_item_id=work_item.id,
                workflow_run_id=work_item.workflow_run_id,
                source_kind="work_item",
                source_id=work_item.id,
                artifact_kind="draft_pr",
                title=f"Draft PR · {work_item.title}",
                summary=summary or "Draft pull request prepared for ERGO work.",
                status="ready",
                external_url=draft_pr_url,
                metadata_json={"branch_name": branch_name},
            )
        work_item.updated_at = utc_now()
        return {
            "id": work_item.id,
            "status": work_item.status,
            "branch_name": work_item.branch_name,
            "draft_pr_url": work_item.draft_pr_url,
            "workflow_ref": work_item.workflow_run_id,
        }

    def _workflow_origin_target(
        db: Session,
        orbit: Orbit,
        *,
        workflow_run_id: str | None,
    ) -> tuple[str | None, str | None]:
        run_id = (workflow_run_id or "").strip()
        if not run_id:
            return None, None
        messages = db.scalars(
            select(Message)
            .where(Message.orbit_id == orbit.id)
            .order_by(Message.created_at.desc())
        ).all()
        for message in messages:
            metadata = message.metadata_json or {}
            if not isinstance(metadata, dict):
                continue
            if not metadata.get("workflow_origin"):
                continue
            if str(metadata.get("workflow_run_id") or "").strip() != run_id:
                continue
            return message.channel_id, message.dm_thread_id
        return None, None

    def _project_workflow_prompts_into_chat(db: Session, orbit: Orbit, workflow_snapshot: dict[str, Any]) -> None:
        runs = workflow_snapshot.get("runs")
        if not isinstance(runs, list) or not runs:
            return

        messages = db.scalars(
            select(Message)
            .where(Message.orbit_id == orbit.id)
            .order_by(Message.created_at.asc())
        ).all()
        existing_prompt_keys: set[tuple[str, str, str, str]] = set()
        seen_prompt_ids: set[tuple[str, str, str]] = set()
        duplicate_prompt_messages: list[Message] = []
        for message in messages:
            metadata = message.metadata_json or {}
            if not isinstance(metadata, dict):
                continue
            request_kind = str(metadata.get("workflow_prompt_type") or "").strip()
            request_phase = str(metadata.get("workflow_prompt_phase") or "").strip()
            run_id = str(metadata.get("workflow_run_id") or "").strip()
            request_id = str(metadata.get("request_id") or "").strip()
            if request_kind and request_phase and request_id:
                dedupe_key = (run_id, request_id, request_kind, request_phase)
                if dedupe_key in existing_prompt_keys:
                    duplicate_prompt_messages.append(message)
                    continue
                existing_prompt_keys.add(dedupe_key)
                request_key = (run_id, request_id, request_kind)
                if request_phase == "open":
                    if request_key in seen_prompt_ids:
                        duplicate_prompt_messages.append(message)
                        continue
                    seen_prompt_ids.add(request_key)

        for message in duplicate_prompt_messages:
            db.delete(message)

        fallback_general = _orbit_channel(db, orbit.id)

        for run in runs:
            if not isinstance(run, dict):
                continue
            run_id = str(run.get("id") or "").strip()
            if not run_id:
                continue
            target_channel_id, target_dm_thread_id = _workflow_origin_target(db, orbit, workflow_run_id=run_id)
            if not target_channel_id and not target_dm_thread_id:
                target_channel_id = fallback_general.id

            human_requests = run.get("human_requests")
            if isinstance(human_requests, list):
                for request in human_requests:
                    if not isinstance(request, dict):
                        continue
                    request_id = str(request.get("id") or "").strip()
                    if not request_id:
                        continue
                    if str(request.get("status") or "").strip().lower() != "open":
                        continue
                    key = (run_id, request_id, "human_request", "open")
                    if key in existing_prompt_keys:
                        continue
                    question = str(request.get("question") or "").strip() or "I need a clarification before continuing."
                    db.add(
                        Message(
                            orbit_id=orbit.id,
                            channel_id=target_channel_id,
                            dm_thread_id=target_dm_thread_id,
                            author_kind="agent",
                            author_name="ERGO",
                            body=f"Clarification needed: {question}",
                            metadata_json={
                                "workflow_prompt": True,
                                "workflow_prompt_type": "human_request",
                                "workflow_prompt_phase": "open",
                                "workflow_run_id": run_id,
                                "request_id": request_id,
                                "task_id": request.get("task_id"),
                                "question": question,
                            },
                        )
                    )
                    existing_prompt_keys.add(key)

            approval_requests = run.get("approval_requests")
            if isinstance(approval_requests, list):
                for request in approval_requests:
                    if not isinstance(request, dict):
                        continue
                    request_id = str(request.get("id") or "").strip()
                    if not request_id:
                        continue
                    if str(request.get("status") or "").strip().lower() != "requested":
                        continue
                    key = (run_id, request_id, "approval_request", "open")
                    if key in existing_prompt_keys:
                        continue
                    reason = str(request.get("reason") or "").strip() or "Approval required to continue execution."
                    db.add(
                        Message(
                            orbit_id=orbit.id,
                            channel_id=target_channel_id,
                            dm_thread_id=target_dm_thread_id,
                            author_kind="agent",
                            author_name="ERGO",
                            body=f"Approval required: {reason}",
                            metadata_json={
                                "workflow_prompt": True,
                                "workflow_prompt_type": "approval_request",
                                "workflow_prompt_phase": "open",
                                "workflow_run_id": run_id,
                                "request_id": request_id,
                                "task_id": request.get("task_id"),
                                "reason": reason,
                            },
                        )
                    )
                    existing_prompt_keys.add(key)

    def _orbit_search(
        db: Session,
        orbit: Orbit,
        *,
        query: str,
        viewer: User,
        limit: int = 16,
    ) -> list[dict[str, Any]]:
        term = query.strip().lower()
        if not term:
            return []

        members = db.scalars(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit.id)).all()
        channels = db.scalars(select(Channel).where(Channel.orbit_id == orbit.id).order_by(Channel.slug)).all()
        dms = db.scalars(select(DmThread).where(DmThread.orbit_id == orbit.id).order_by(DmThread.created_at.desc())).all()
        work_items = db.scalars(select(WorkItem).where(WorkItem.orbit_id == orbit.id).order_by(WorkItem.updated_at.desc())).all()
        run_projections = db.scalars(
            select(RuntimeRunProjection)
            .where(RuntimeRunProjection.orbit_id == orbit.id)
            .order_by(RuntimeRunProjection.updated_at.desc(), RuntimeRunProjection.created_at.desc())
        ).all()
        cycles = db.scalars(select(OrbitCycle).where(OrbitCycle.orbit_id == orbit.id).order_by(OrbitCycle.updated_at.desc())).all()
        native_issues = db.scalars(select(OrbitIssue).where(OrbitIssue.orbit_id == orbit.id).order_by(OrbitIssue.updated_at.desc())).all()
        prs = db.scalars(select(PullRequestSnapshot).where(PullRequestSnapshot.orbit_id == orbit.id).order_by(PullRequestSnapshot.updated_at.desc())).all()
        issues = db.scalars(select(IssueSnapshot).where(IssueSnapshot.orbit_id == orbit.id).order_by(IssueSnapshot.updated_at.desc())).all()
        codespaces = db.scalars(select(Codespace).where(Codespace.orbit_id == orbit.id).order_by(Codespace.created_at.desc())).all()
        artifacts = artifacts_for_orbit(db, orbit_id=orbit.id)
        messages = db.scalars(select(Message).where(Message.orbit_id == orbit.id).order_by(Message.created_at.desc())).all()
        channel_lookup = {channel.id: channel for channel in channels}
        dm_lookup = {thread.id: thread for thread in dms}
        results: list[dict[str, Any]] = []

        def matches(*values: str | None) -> bool:
            haystack = " ".join(str(value or "").lower() for value in values)
            return term in haystack

        for channel in channels:
            if matches(channel.name, channel.slug):
                results.append(
                    _serialize_search_result(
                        key=f"channel-{channel.id}",
                        kind="channel",
                        label=f"#{channel.name}",
                        detail="Channel",
                        section="chat",
                        conversation_kind="channel",
                        conversation_id=channel.id,
                    )
                )

        for thread in dms:
            payload = _serialize_dm_thread(db, thread, viewer=viewer)
            if matches(thread.title, payload.get("participant", {}).get("display_name"), payload.get("participant", {}).get("login")):
                results.append(
                    _serialize_search_result(
                        key=f"dm-{thread.id}",
                        kind="dm",
                        label=str(payload.get("participant", {}).get("display_name") or thread.title),
                        detail="Direct message",
                        section="chat",
                        conversation_kind="dm",
                        conversation_id=thread.id,
                    )
                )

        for membership in members:
            member_user = db.get(User, membership.user_id)
            if member_user is None or not matches(member_user.display_name, member_user.github_login, membership.role):
                continue
            results.append(
                _serialize_search_result(
                    key=f"member-{member_user.id}",
                    kind="member",
                    label=member_user.display_name,
                    detail=f"Member · {normalize_orbit_role(membership.role)}",
                    section="chat",
                    metadata={"user_id": member_user.id, "github_login": member_user.github_login},
                )
            )

        for item in work_items:
            if not matches(item.title, item.summary, item.request_text, item.branch_name):
                continue
            results.append(
                    _serialize_search_result(
                        key=f"work-item-{item.id}",
                        kind="work_item",
                        label=item.title,
                        detail=f"Task · {_format_state_label(item.status)}",
                        section="workflow",
                        workflow_run_id=item.workflow_run_id,
                        metadata={"work_item_id": item.id},
                    )
            )

        for projection in run_projections:
            if not matches(projection.title, projection.summary, projection.workflow_run_id, projection.status):
                continue
            results.append(
                    _serialize_search_result(
                        key=f"run-{projection.workflow_run_id}",
                        kind="workflow_run",
                        label=projection.title or projection.workflow_run_id,
                        detail=f"Run · {_format_state_label(projection.operator_status or projection.status)}",
                        section="workflow",
                        workflow_run_id=projection.workflow_run_id,
                    )
                )

        for cycle in cycles:
            if not matches(cycle.name, cycle.goal, cycle.status):
                continue
            results.append(
                _serialize_search_result(
                    key=f"cycle-{cycle.id}",
                    kind="cycle",
                    label=cycle.name,
                    detail=f"Cycle · {_format_state_label(cycle.status)}",
                    section="issues",
                    metadata={"cycle_id": cycle.id},
                )
            )

        for item in native_issues:
            if matches(item.title, item.detail, item.priority, item.status):
                results.append(
                    _serialize_search_result(
                        key=f"native-issue-{item.id}",
                        kind="native_issue",
                        label=item.title,
                        detail=f"PM-{item.sequence_no} · {_format_state_label(item.status)}",
                        section="issues",
                        detail_kind="native_issue",
                        detail_id=item.id,
                        metadata={"cycle_id": item.cycle_id},
                    )
                )

        for item in prs:
            if matches(item.title, item.url, item.branch_name, item.metadata_json.get("repository_full_name")):
                results.append(
                    _serialize_search_result(
                        key=f"pr-{item.id}",
                        kind="pull_request",
                        label=item.title,
                        detail=f"PR #{item.github_number}",
                        section="prs",
                        detail_kind="pr",
                        detail_id=item.id,
                    )
                )

        for item in issues:
            if matches(item.title, item.url, item.metadata_json.get("repository_full_name")):
                results.append(
                    _serialize_search_result(
                        key=f"issue-{item.id}",
                        kind="issue",
                        label=item.title,
                        detail=f"Issue #{item.github_number}",
                        section="prs",
                        detail_kind="issue",
                        detail_id=item.id,
                    )
                )

        for item in codespaces:
            if matches(item.name, item.branch_name, item.workspace_path):
                results.append(
                    _serialize_search_result(
                        key=f"codespace-{item.id}",
                        kind="codespace",
                        label=item.name,
                        detail=item.branch_name,
                        section="codespaces",
                        detail_id=item.id,
                    )
                )

        for item in artifacts:
            if matches(item.title, item.summary, item.artifact_kind, item.metadata_json.get("repository_full_name")):
                results.append(
                    _serialize_search_result(
                        key=f"artifact-{item.id}",
                        kind="artifact",
                        label=item.title,
                        detail=item.summary or formatStateLabel(item.artifact_kind),
                        section="demos",
                        detail_id=item.id,
                    )
                )

        for message in messages:
            if _is_legacy_workflow_prompt_message(message):
                continue
            if not matches(message.body, message.author_name):
                continue
            conversation_label = "Chat message"
            conversation_kind = None
            conversation_id = None
            if message.channel_id:
                channel = channel_lookup.get(message.channel_id)
                conversation_label = f"Message in #{channel.name}" if channel is not None else "Channel message"
                conversation_kind = "channel"
                conversation_id = message.channel_id
            elif message.dm_thread_id:
                thread = dm_lookup.get(message.dm_thread_id)
                conversation_label = f"Message in {thread.title}" if thread is not None else "Direct message"
                conversation_kind = "dm"
                conversation_id = message.dm_thread_id
            results.append(
                _serialize_search_result(
                    key=f"message-{message.id}",
                    kind="message",
                    label=message.body,
                    detail=conversation_label,
                    section="chat",
                    conversation_kind=conversation_kind,
                    conversation_id=conversation_id,
                    metadata={"message_id": message.id},
                )
            )

        return results[:limit]

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        return {
            "ok": True,
            "service": settings.app_name,
            "package": runtime_manager.package_report(),
        }

    def _issue_session_payload(db: Session, user: User) -> SessionPayload:
        token = secrets.token_urlsafe(24)
        session = SessionToken(
            user_id=user.id,
            token=token,
            expires_at=utc_now() + timedelta(seconds=settings.session_ttl_seconds),
        )
        db.add(session)
        db.commit()
        return SessionPayload(token=token, user=_serialize_user(user))

    @app.get("/api/auth/github/url")
    def github_login_url() -> dict[str, Any]:
        if not settings.github_client_id:
            return {"configured": False, "url": None}
        state = secrets.token_urlsafe(16)
        url = (
            f"{settings.github_oauth_authorize_url}?client_id={settings.github_client_id}"
            f"&redirect_uri={settings.github_oauth_callback_url}&scope={settings.github_oauth_scopes}&state={state}"
        )
        return {"configured": True, "url": url, "state": state}

    @app.get("/api/auth/github-app")
    def github_app_status(
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        installation = _github_app_installation_for_user(db, user)
        if not settings.github_app_is_configured:
            return {"configured": False, "app_slug": settings.github_app_slug or None, "install_url": None, "active_installation": None}
        state = _create_auth_state(db, user=user, purpose="github_app_install")
        install_url = f"https://github.com/apps/{settings.github_app_slug.strip()}/installations/new?state={state}"
        return {
            "configured": True,
            "app_slug": settings.github_app_slug.strip(),
            "install_url": install_url,
            "active_installation": _serialize_installation(installation) if installation else None,
        }

    @app.get("/api/auth/github/callback")
    def github_callback(code: str | None = Query(default=None), state: str | None = Query(default=None)) -> RedirectResponse:
        target = f"{settings.github_oauth_callback_url}?code={code or ''}"
        if state:
            target = f"{target}&state={state}"
        return RedirectResponse(target, status_code=307)

    @app.post("/api/auth/github-app/installations/claim")
    def github_app_claim_installation(
        payload: GitHubAppInstallationClaimRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        if not settings.github_app_is_configured:
            raise HTTPException(status_code=400, detail="GitHub App is not configured")
        _consume_auth_state(db, user=user, state=payload.state, purpose="github_app_install")
        try:
            installation_payload = github.get_app_installation(payload.installation_id)
        except httpx.HTTPStatusError as exc:
            raise HTTPException(status_code=502, detail="Unable to read the GitHub App installation") from exc
        installation_key = f"github:app_installation:{payload.installation_id}"
        installation = db.scalar(
            select(IntegrationInstallation).where(IntegrationInstallation.installation_key == installation_key)
        )
        account = installation_payload.get("account") or {}
        account_login = str(account.get("login") or "").strip() or None
        display_name = account_login or str(installation_payload.get("target_type") or "GitHub installation")
        metadata_json = {
            "installation_id": int(payload.installation_id),
            "account_login": account_login,
            "account_type": account.get("type"),
            "repository_selection": installation_payload.get("repository_selection"),
            "permissions": installation_payload.get("permissions") or {},
            "app_slug": settings.github_app_slug.strip(),
            "setup_action": payload.setup_action,
        }
        if installation is None:
            installation = IntegrationInstallation(
                provider="github",
                installation_kind="github_app_installation",
                installation_key=installation_key,
                owner_user_id=user.id,
                display_name=f"{display_name} GitHub App access",
                status="active",
                metadata_json=metadata_json,
            )
            db.add(installation)
            db.flush()
        else:
            installation.owner_user_id = user.id
            installation.display_name = f"{display_name} GitHub App access"
            installation.status = "active"
            installation.metadata_json = metadata_json
            installation.updated_at = utc_now()
        db.commit()
        return {"ok": True, "installation": _serialize_installation(installation)}

    @app.post("/api/auth/github-token", response_model=SessionPayload)
    def github_token_login(payload: GitHubTokenLoginRequest, db: Session = Depends(get_db)) -> SessionPayload:
        try:
            github_user = github.get_authenticated_user(payload.token)
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code in {401, 403}:
                raise HTTPException(status_code=401, detail="Invalid GitHub token") from exc
            raise HTTPException(status_code=502, detail="GitHub authentication failed") from exc
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail="GitHub authentication failed") from exc
        email = github.get_primary_email(payload.token)
        user = db.scalar(select(User).where(User.github_user_id == str(github_user["id"])))
        if user is None:
            user = User(
                github_login=github_user["login"],
                github_user_id=str(github_user["id"]),
                email=email,
                display_name=github_user.get("name") or github_user["login"],
                avatar_url=github_user.get("avatar_url"),
                access_token=payload.token,
            )
            db.add(user)
            db.flush()
        else:
            user.access_token = payload.token
            user.email = email or user.email
            user.avatar_url = github_user.get("avatar_url") or user.avatar_url
            user.display_name = github_user.get("name") or user.display_name
        return _issue_session_payload(db, user)

    @app.post("/api/auth/dev-session", response_model=SessionPayload)
    def local_dev_session_bootstrap(
        payload: LocalSessionBootstrapRequest,
        db: Session = Depends(get_db),
    ) -> SessionPayload:
        if settings.environment.strip().lower() not in {"development", "dev", "local", "test"}:
            raise HTTPException(status_code=404, detail="Local session bootstrap is not enabled")
        raw_login = str(payload.github_login or "").strip().lower()
        login = re.sub(r"\s+", "_", raw_login) if raw_login else "playwright"
        login = re.sub(r"[^a-z0-9_-]+", "_", login).strip("_-") or "playwright"
        github_user_id = f"dev:{login}"
        user = db.scalar(select(User).where(User.github_login == login))
        if user is None:
            user = User(
                github_login=login,
                github_user_id=github_user_id,
                email=payload.email,
                display_name=payload.display_name.strip() or login,
                avatar_url=None,
                access_token="dev-session",
            )
            db.add(user)
            db.flush()
        else:
            user.github_user_id = user.github_user_id or github_user_id
            user.email = payload.email or user.email
            user.display_name = payload.display_name.strip() or user.display_name
            user.access_token = "dev-session"
        return _issue_session_payload(db, user)

    @app.post("/api/auth/github/exchange", response_model=SessionPayload)
    def github_exchange(code: str = Query(...), db: Session = Depends(get_db)) -> SessionPayload:
        if not settings.github_client_id or not settings.github_client_secret:
            raise HTTPException(status_code=400, detail="GitHub OAuth is not configured")
        with httpx.Client(timeout=30.0) as client:
            token_response = client.post(
                settings.github_oauth_access_url,
                headers={"Accept": "application/json"},
                json={
                    "client_id": settings.github_client_id,
                    "client_secret": settings.github_client_secret,
                    "code": code,
                    "redirect_uri": settings.github_oauth_callback_url,
                },
            )
            token_response.raise_for_status()
            access_token = token_response.json().get("access_token")
        if not access_token:
            raise HTTPException(status_code=400, detail="GitHub did not return an access token")
        return github_token_login(GitHubTokenLoginRequest(token=access_token), db)

    @app.get("/api/me")
    def me(user: User = Depends(current_user)) -> dict[str, Any]:
        return _serialize_user(user)

    @app.post("/api/notifications/{notification_id}/read")
    def mark_notification_read_endpoint(
        notification_id: str,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        notification = db.get(Notification, notification_id)
        if notification is None or notification.user_id != user.id:
            raise HTTPException(status_code=404, detail="Notification not found")
        if notification.status != "read":
            notification.status = "read"
            notification.read_at = utc_now()
            db.commit()
        return _serialize_notification(notification)

    @app.get("/api/chat/sync/bootstrap")
    def chat_sync_bootstrap(
        orbit_id: str = Query(...),
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        if not _matrix_channel_bridge_enabled():
            return {"provider": "product", "enabled": False, "room_bindings": []}
        orbit = _orbit_for_member(db, orbit_id, user)
        try:
            payload = matrix_provisioning.bootstrap_payload_for_orbit(db, orbit=orbit, user=user)
        except MatrixTransportError as exc:
            logger.warning("Matrix bootstrap unavailable for orbit %s: %s", orbit.id, exc)
            return {
                "provider": "product",
                "enabled": False,
                "room_bindings": [],
                "reason": "matrix_unavailable",
            }
        db.commit()
        return {"enabled": True, **payload}

    @app.get("/api/preferences", response_model=UserPreferencesPayload)
    def get_preferences(user: User = Depends(current_user), db: Session = Depends(get_db)) -> UserPreferencesPayload:
        return UserPreferencesPayload(**_serialize_preferences(_user_preferences(db, user)))

    @app.put("/api/preferences", response_model=UserPreferencesPayload)
    def update_preferences(
        payload: UserPreferencesUpdateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> UserPreferencesPayload:
        preference = _user_preferences(db, user, create=True)
        preference.theme_preference = _normalize_theme_preference(payload.theme_preference)
        preference.updated_at = utc_now()
        db.commit()
        return UserPreferencesPayload(**_serialize_preferences(preference))

    @app.get("/api/dashboard", response_model=DashboardPayload)
    def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)) -> DashboardPayload:
        orbit_ids = [membership.orbit_id for membership in db.scalars(select(OrbitMembership).where(OrbitMembership.user_id == user.id)).all()]
        orbits = db.scalars(select(Orbit).where(Orbit.id.in_(orbit_ids)).order_by(Orbit.created_at.desc())).all() if orbit_ids else []
        work_items = db.scalars(select(WorkItem).where(WorkItem.orbit_id.in_(orbit_ids)).order_by(WorkItem.updated_at.desc())).all() if orbit_ids else []
        codespaces = db.scalars(select(Codespace).where(Codespace.orbit_id.in_(orbit_ids)).order_by(Codespace.created_at.desc())).all() if orbit_ids else []
        demos = db.scalars(select(Demo).where(Demo.orbit_id.in_(orbit_ids)).order_by(Demo.created_at.desc())).all() if orbit_ids else []
        navigation_state = navigation.get_state(user.id) or {}
        notifications: list[dict[str, str]] = []
        if flag_enabled(settings, "ff_inbox_v2"):
            notifications = [
                {
                    "kind": notification.kind,
                    "label": notification.title,
                    "detail": notification.detail,
                }
                for notification in notifications_for_user(db, user_id=user.id)[:8]
            ]
        else:
            if navigation_state:
                notifications.append({"kind": "navigation", "label": f"Last orbit: {navigation_state.get('orbit_id') or 'none'}"})
            for demo in demos[:2]:
                notifications.append({"kind": "demo", "label": f"Live demo ready: {demo.title}"})
        return DashboardPayload(
            me=_serialize_user(user),
            recent_orbits=[_serialize_orbit(item) for item in orbits[:5]],
            priority_items=[_serialize_work_item(item) for item in work_items[:8]]
            + [
                {"id": demo.id, "title": demo.title, "status": demo.status, "agent": "ERGO", "demo_url": demo.url}
                for demo in demos[:2]
            ],
            codespaces=[_serialize_codespace(db, item) for item in codespaces[:6]],
            notifications=notifications,
        )

    @app.get("/api/my-work", response_model=MyWorkPayload)
    def my_work(user: User = Depends(current_user), db: Session = Depends(get_db)) -> MyWorkPayload:
        return MyWorkPayload(**_build_my_work_payload(user, db))

    @app.get("/api/cycles", response_model=PlanningCyclesPayload)
    def planning_cycles(user: User = Depends(current_user), db: Session = Depends(get_db)) -> PlanningCyclesPayload:
        return PlanningCyclesPayload(**_build_planning_cycles_payload(user, db))

    @app.get("/api/views", response_model=SavedViewsPayload)
    def saved_views(user: User = Depends(current_user), db: Session = Depends(get_db)) -> SavedViewsPayload:
        return SavedViewsPayload(**_build_saved_views_payload(user, db))

    @app.post("/api/views", response_model=SavedViewsPayload)
    def create_saved_view(
        payload: SavedViewCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        name = payload.name.strip()
        if not name:
            raise HTTPException(status_code=400, detail="Saved view name is required")
        orbit_id = str(payload.orbit_id or "").strip() or None
        if orbit_id is not None:
            _orbit_for_member(db, orbit_id, user)
        saved_view = SavedView(
            created_by_user_id=user.id,
            orbit_id=orbit_id,
            name=name,
            description=(payload.description or "").strip() or None,
            filters_json=_saved_view_filters_payload(
                statuses=payload.statuses,
                priorities=payload.priorities,
                labels=payload.labels,
                assignee_scope=payload.assignee_scope,
                cycle_scope=payload.cycle_scope,
                stale_only=payload.stale_only,
                relation_scope=payload.relation_scope,
                hierarchy_scope=payload.hierarchy_scope,
            ),
        )
        db.add(saved_view)
        db.flush()
        record_audit_event(
            db,
            orbit_id=orbit_id,
            actor_user_id=user.id,
            action_type="saved_view.created",
            target_kind="saved_view",
            target_id=saved_view.id,
            metadata_json={"saved_view_id": saved_view.id},
        )
        db.commit()
        return _build_saved_views_payload(user, db)

    @app.patch("/api/views/{view_id}", response_model=SavedViewsPayload)
    def update_saved_view(
        view_id: str,
        payload: SavedViewUpdateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        saved_view = db.scalar(
            select(SavedView).where(SavedView.id == view_id, SavedView.created_by_user_id == user.id)
        )
        if saved_view is None:
            raise HTTPException(status_code=404, detail="Saved view not found")

        updates = payload.model_dump(exclude_unset=True)
        if "name" in updates:
            name = str(updates.get("name") or "").strip()
            if not name:
                raise HTTPException(status_code=400, detail="Saved view name is required")
            saved_view.name = name
        if "description" in updates:
            saved_view.description = str(updates.get("description") or "").strip() or None
        if "orbit_id" in updates:
            orbit_id = str(updates.get("orbit_id") or "").strip() or None
            if orbit_id is not None:
                _orbit_for_member(db, orbit_id, user)
            saved_view.orbit_id = orbit_id

        current_filters = dict(saved_view.filters_json or {})
        saved_view.filters_json = _saved_view_filters_payload(
            statuses=updates["statuses"] if "statuses" in updates else current_filters.get("statuses"),
            priorities=updates["priorities"] if "priorities" in updates else current_filters.get("priorities"),
            labels=updates["labels"] if "labels" in updates else current_filters.get("labels"),
            assignee_scope=updates["assignee_scope"] if "assignee_scope" in updates else current_filters.get("assignee_scope"),
            cycle_scope=updates["cycle_scope"] if "cycle_scope" in updates else current_filters.get("cycle_scope"),
            stale_only=updates["stale_only"] if "stale_only" in updates else current_filters.get("stale_only"),
            relation_scope=updates["relation_scope"] if "relation_scope" in updates else current_filters.get("relation_scope"),
            hierarchy_scope=updates["hierarchy_scope"] if "hierarchy_scope" in updates else current_filters.get("hierarchy_scope"),
        )
        if "pinned" in updates:
            if bool(updates.get("pinned")):
                if not _saved_view_is_pinned(saved_view):
                    saved_view.pin_rank = _next_saved_view_pin_rank(db, user_id=user.id)
            else:
                saved_view.pin_rank = 0

        saved_view.updated_at = utc_now()
        record_audit_event(
            db,
            orbit_id=saved_view.orbit_id,
            actor_user_id=user.id,
            action_type="saved_view.updated",
            target_kind="saved_view",
            target_id=saved_view.id,
            metadata_json={"saved_view_id": saved_view.id, "pinned": _saved_view_is_pinned(saved_view)},
        )
        db.commit()
        return _build_saved_views_payload(user, db)

    @app.delete("/api/views/{view_id}", response_model=SavedViewsPayload)
    def delete_saved_view(
        view_id: str,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        saved_view = db.scalar(
            select(SavedView).where(SavedView.id == view_id, SavedView.created_by_user_id == user.id)
        )
        if saved_view is None:
            raise HTTPException(status_code=404, detail="Saved view not found")
        orbit_id = saved_view.orbit_id
        db.delete(saved_view)
        record_audit_event(
            db,
            orbit_id=orbit_id,
            actor_user_id=user.id,
            action_type="saved_view.deleted",
            target_kind="saved_view",
            target_id=view_id,
            metadata_json={"saved_view_id": view_id},
        )
        db.commit()
        return _build_saved_views_payload(user, db)

    @app.get("/api/inbox", response_model=InboxPayload)
    def inbox(user: User = Depends(current_user), db: Session = Depends(get_db)) -> InboxPayload:
        return InboxPayload(**_build_inbox_payload(user, db))

    @app.get("/api/navigation")
    def get_navigation(user: User = Depends(current_user)) -> dict[str, Any]:
        return navigation.get_state(user.id) or {"orbit_id": None, "section": "inbox"}

    @app.put("/api/navigation")
    def put_navigation(payload: NavigationStateRequest, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
        navigation.set_state(user.id, payload.model_dump())
        state = db.scalar(select(NavigationState).where(NavigationState.user_id == user.id, NavigationState.orbit_id == payload.orbit_id))
        if state is None:
            state = NavigationState(user_id=user.id, orbit_id=payload.orbit_id, section=payload.section)
            db.add(state)
        else:
            state.section = payload.section
            state.last_opened_at = utc_now()
        db.commit()
        return payload.model_dump()

    @app.get("/api/orbits")
    def list_orbits(user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
        orbit_ids = [membership.orbit_id for membership in db.scalars(select(OrbitMembership).where(OrbitMembership.user_id == user.id)).all()]
        orbits = db.scalars(select(Orbit).where(Orbit.id.in_(orbit_ids)).order_by(Orbit.created_at.desc())).all() if orbit_ids else []
        return [_serialize_orbit(orbit) for orbit in orbits]

    @app.post("/api/orbits")
    def create_orbit(payload: OrbitCreateRequest, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
        orbit_slug = _unique_orbit_slug(db, payload.name)
        local_session_orbit = (
            settings.environment.strip().lower() in {"development", "dev", "local", "test"}
            and user.access_token == "dev-session"
        )
        installation_context = None
        repo = None
        if not local_session_orbit:
            installation_context, repo = repo_access.create_repository(
                db,
                user=user,
                name=orbit_slug,
                description=payload.description,
                private=payload.private,
            )
        orbit = Orbit(
            slug=orbit_slug,
            name=payload.name,
            description=payload.description,
            logo=payload.logo,
            repo_owner=repo["owner"]["login"] if repo else None,
            repo_name=repo["name"] if repo else None,
            repo_full_name=repo["full_name"] if repo else None,
            repo_url=repo["html_url"] if repo else None,
            repo_private=bool(repo["private"]) if repo else payload.private,
            default_branch=repo.get("default_branch") or "main" if repo else "main",
            created_by_user_id=user.id,
        )
        db.add(orbit)
        db.flush()
        db.add(OrbitMembership(orbit_id=orbit.id, user_id=user.id, role="owner", introduced=True))
        if installation_context and repo:
            repository = upsert_repository_connection(db, installation=installation_context.installation, repo_payload=repo)
            bind_repository_to_orbit(
                db,
                orbit=orbit,
                repository=repository,
                added_by_user_id=user.id,
                make_primary=True,
            )
        _ensure_default_orbit_records(db, orbit, user)
        general = _orbit_channel(db, orbit.id)
        db.add(
            Message(
                orbit_id=orbit.id,
                channel_id=general.id,
                author_kind="system",
                author_name="system",
                body=f"{user.display_name} created orbit {orbit.name}.",
            )
        )
        for email in payload.invite_emails:
            invite = OrbitInvite(orbit_id=orbit.id, invited_by_user_id=user.id, email=email, token=secrets.token_urlsafe(18))
            db.add(invite)
            db.flush()
            _send_invite_email(invite, orbit)
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="orbit.created",
            target_kind="orbit",
            target_id=orbit.id,
            metadata_json={"repo_full_name": orbit.repo_full_name},
        )
        db.commit()
        runtime_manager.orbit_root(orbit)
        navigation.set_state(user.id, {"orbit_id": orbit.id, "section": "chat"})
        return _serialize_orbit(orbit)

    @app.post("/api/orbits/{orbit_id}/invites")
    def invite_to_orbit(
        orbit_id: str,
        payload: InviteRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permissions = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        _require_permission(permissions.can_manage_members(), "You do not have permission to invite members to this orbit.")
        invite = OrbitInvite(orbit_id=orbit.id, invited_by_user_id=user.id, email=payload.email, token=secrets.token_urlsafe(18))
        db.add(invite)
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="orbit.invite.created",
            target_kind="invite",
            target_id=invite.id,
            metadata_json={"email": payload.email},
        )
        db.commit()
        _send_invite_email(invite, orbit)
        return {"id": invite.id, "email": invite.email, "token": invite.token, "status": invite.status}

    @app.put("/api/orbits/{orbit_id}/members/{member_user_id}/role")
    def update_orbit_member_role(
        orbit_id: str,
        member_user_id: str,
        payload: OrbitMemberRoleUpdateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permissions = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        _require_permission(permissions.can_manage_roles(), "Only orbit owners can change member roles.")
        target_membership = _orbit_membership_for_user(db, orbit.id, member_user_id)
        if target_membership is None:
            raise HTTPException(status_code=404, detail="Member not found")

        next_role = normalize_orbit_role(payload.role)
        if next_role not in {ORBIT_ROLE_OWNER, ORBIT_ROLE_MANAGER, ORBIT_ROLE_CONTRIBUTOR, ORBIT_ROLE_VIEWER}:
            raise HTTPException(status_code=400, detail="Unsupported orbit role")
        current_role = normalize_orbit_role(target_membership.role)
        if current_role == next_role:
            target_user = db.get(User, member_user_id)
            if target_user is None:
                raise HTTPException(status_code=404, detail="Member not found")
            return _serialize_member_summary(target_user, target_membership, viewer=user)
        if member_user_id == user.id and next_role != ORBIT_ROLE_OWNER:
            raise HTTPException(status_code=400, detail="Owners cannot demote themselves.")
        if current_role == ORBIT_ROLE_OWNER and next_role != ORBIT_ROLE_OWNER:
            owner_count = sum(
                1
                for membership in db.scalars(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit.id)).all()
                if normalize_orbit_role(membership.role) == ORBIT_ROLE_OWNER
            )
            if owner_count <= 1:
                raise HTTPException(status_code=400, detail="At least one orbit owner is required.")

        target_membership.role = next_role
        bound_repositories = repositories_for_orbit(db, orbit.id)
        if next_role == ORBIT_ROLE_OWNER:
            for repository, _ in bound_repositories:
                ensure_repo_grant(
                    db,
                    orbit_id=orbit.id,
                    repository_connection_id=repository.id,
                    user_id=member_user_id,
                    grant_level="admin",
                )
        elif next_role in {ORBIT_ROLE_MANAGER, ORBIT_ROLE_CONTRIBUTOR}:
            existing_grants = db.scalars(
                select(RepoGrant).where(RepoGrant.orbit_id == orbit.id, RepoGrant.user_id == member_user_id)
            ).all()
            for grant in existing_grants:
                grant.grant_level = "view"
            for repository, _ in bound_repositories:
                ensure_repo_grant(
                    db,
                    orbit_id=orbit.id,
                    repository_connection_id=repository.id,
                    user_id=member_user_id,
                    grant_level="view",
                )
        else:
            for grant in db.scalars(
                select(RepoGrant).where(RepoGrant.orbit_id == orbit.id, RepoGrant.user_id == member_user_id)
            ).all():
                db.delete(grant)

        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="orbit.member.role_changed",
            target_kind="membership",
            target_id=target_membership.id,
            metadata_json={"member_user_id": member_user_id, "from_role": current_role, "to_role": next_role},
        )
        db.commit()
        target_user = db.get(User, member_user_id)
        if target_user is None:
            raise HTTPException(status_code=404, detail="Member not found")
        return _serialize_member_summary(target_user, target_membership, viewer=user)

    @app.post("/api/invites/{token}/accept")
    def accept_invite(token: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
        invite = db.scalar(select(OrbitInvite).where(OrbitInvite.token == token))
        if invite is None:
            raise HTTPException(status_code=404, detail="Invite not found")
        orbit = db.get(Orbit, invite.orbit_id)
        if orbit is None:
            raise HTTPException(status_code=404, detail="Orbit missing")
        existing = db.scalar(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit.id, OrbitMembership.user_id == user.id))
        if existing is None:
            db.add(OrbitMembership(orbit_id=orbit.id, user_id=user.id, role=ORBIT_ROLE_CONTRIBUTOR, introduced=True))
        invite.status = "accepted"
        invite.accepted_at = utc_now()
        primary_repo = primary_repository_for_orbit(db, orbit)
        if primary_repo is not None:
            repo_access.add_collaborator(db, actor_user=user, repository=primary_repo, github_login=user.github_login)
            ensure_repo_grant(
                db,
                orbit_id=orbit.id,
                repository_connection_id=primary_repo.id,
                user_id=user.id,
                grant_level="view",
            )
        _ensure_default_orbit_records(db, orbit, user)
        general = _orbit_channel(db, orbit.id)
        db.add(
            Message(
                orbit_id=orbit.id,
                channel_id=general.id,
                author_kind="system",
                author_name="system",
                body=f"{user.display_name} joined the orbit.",
            )
        )
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="orbit.invite.accepted",
            target_kind="invite",
            target_id=invite.id,
            metadata_json={"email": invite.email},
        )
        db.commit()
        return {"ok": True, "orbit_id": orbit.id}

    @app.get("/api/orbits/{orbit_id}/available-repositories")
    def list_available_repositories(
        orbit_id: str,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> list[dict[str, Any]]:
        if not flag_enabled(settings, "ff_repo_installations_v1"):
            raise HTTPException(status_code=404, detail="Repository installations are not enabled.")
        orbit = _orbit_for_member(db, orbit_id, user)
        ensure_primary_repo_binding(db, orbit)
        permissions = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        _require_permission(
            permissions.can_bind_repo(),
            "You do not have permission to manage repository bindings in this orbit.",
        )
        _, repositories = repo_access.list_accessible_repositories(db, user=user)
        connected_by_full_name = {repository.full_name: repository for repository, _ in repositories_for_orbit(db, orbit.id)}
        return [
            _serialize_accessible_repository(
                repository_payload,
                connected_repository=connected_by_full_name.get(str(repository_payload.get("full_name") or "").strip()),
            )
            for repository_payload in repositories
            if str(repository_payload.get("full_name") or "").strip()
        ]

    @app.post("/api/orbits/{orbit_id}/repositories")
    def connect_orbit_repository(
        orbit_id: str,
        payload: OrbitRepositoryConnectRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        if not flag_enabled(settings, "ff_repo_installations_v1"):
            raise HTTPException(status_code=404, detail="Repository installations are not enabled.")
        orbit = _orbit_for_member(db, orbit_id, user)
        ensure_primary_repo_binding(db, orbit)
        permissions = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        _require_permission(
            permissions.can_bind_repo(),
            "You do not have permission to manage repository bindings in this orbit.",
        )
        existing = repositories_for_orbit(db, orbit.id)
        already_bound = any(repository.full_name == payload.repo_full_name for repository, _ in existing)
        if existing and not already_bound and not flag_enabled(settings, "ff_multi_repo_scope_v1"):
            raise HTTPException(status_code=400, detail="Multi-repo bindings are not enabled yet.")
        installation_context, repo_payload = repo_access.get_repository(db, user=user, repo_full_name=payload.repo_full_name)
        repository = upsert_repository_connection(db, installation=installation_context.installation, repo_payload=repo_payload)
        binding = bind_repository_to_orbit(
            db,
            orbit=orbit,
            repository=repository,
            added_by_user_id=user.id,
            make_primary=payload.make_primary,
        )
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="orbit.repository.bound",
            target_kind="repository",
            target_id=repository.id,
            metadata_json={"repo_full_name": repository.full_name, "make_primary": binding.is_primary},
        )
        db.commit()
        return _serialize_repository_connection(repository, binding)

    @app.post("/api/orbits/{orbit_id}/repositories/{repository_id}/primary")
    def mark_orbit_repository_primary(
        orbit_id: str,
        repository_id: str,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        if not flag_enabled(settings, "ff_repo_installations_v1"):
            raise HTTPException(status_code=404, detail="Repository installations are not enabled.")
        orbit = _orbit_for_member(db, orbit_id, user)
        ensure_primary_repo_binding(db, orbit)
        permissions = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        _require_permission(
            permissions.can_bind_repo(),
            "You do not have permission to manage repository bindings in this orbit.",
        )
        binding = db.scalar(
            select(OrbitRepositoryBinding).where(
                OrbitRepositoryBinding.orbit_id == orbit.id,
                OrbitRepositoryBinding.repository_connection_id == repository_id,
                OrbitRepositoryBinding.status == "active",
            )
        )
        if binding is None:
            raise HTTPException(status_code=404, detail="Repository binding not found")
        set_primary_repository_binding(db, orbit=orbit, repository_connection_id=repository_id)
        repository = db.get(RepositoryConnection, repository_id)
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="orbit.repository.primary_changed",
            target_kind="repository",
            target_id=repository_id,
            metadata_json={"repo_full_name": repository.full_name if repository else None},
        )
        db.commit()
        if repository is None:
            raise HTTPException(status_code=404, detail="Repository not found")
        refreshed_binding = db.scalar(
            select(OrbitRepositoryBinding).where(
                OrbitRepositoryBinding.orbit_id == orbit.id,
                OrbitRepositoryBinding.repository_connection_id == repository_id,
            )
        )
        return _serialize_repository_connection(repository, refreshed_binding)

    def _serialize_bootstrap_orbit_payload(db: Session, orbit: Orbit, *, user: User) -> OrbitPayload:
        navigation_state = navigation.get_state(user.id) or {"orbit_id": orbit.id, "section": "chat"}
        section = str(navigation_state.get("section") or "chat").strip().lower()
        repositories = [_serialize_repository_connection(repository, binding) for repository, binding in repositories_for_orbit(db, orbit.id)]
        permissions = serialize_permission_snapshot(permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id))
        channels = db.scalars(select(Channel).where(Channel.orbit_id == orbit.id).order_by(Channel.slug)).all()
        dms = db.scalars(select(DmThread).where(DmThread.orbit_id == orbit.id).order_by(DmThread.created_at)).all()

        prs: list[dict[str, Any]] = []
        issues: list[dict[str, Any]] = []
        native_issue_models = db.scalars(
            select(OrbitIssue)
            .where(OrbitIssue.orbit_id == orbit.id)
            .order_by(OrbitIssue.updated_at.desc(), OrbitIssue.sequence_no.desc())
        ).all()
        native_issue_context = _build_orbit_issue_context(db, native_issue_models)
        native_issues = [
            _serialize_orbit_issue(db, item, context=native_issue_context)
            for item in native_issue_models
        ]
        cycles = [
            _serialize_orbit_cycle(db, item)
            for item in db.scalars(
                select(OrbitCycle)
                .where(OrbitCycle.orbit_id == orbit.id)
                .order_by(OrbitCycle.starts_at.desc(), OrbitCycle.created_at.desc())
            ).all()
        ]
        codespaces: list[dict[str, Any]] = []
        demos: list[dict[str, Any]] = []
        artifacts: list[dict[str, Any]] = []

        if section == "prs":
            prs = [
                _serialize_pull_request(db, item)
                for item in db.scalars(
                    select(PullRequestSnapshot)
                    .where(PullRequestSnapshot.orbit_id == orbit.id)
                    .order_by(PullRequestSnapshot.updated_at.desc())
                ).all()
            ]
            issues = [
                _serialize_issue(db, item)
                for item in db.scalars(
                    select(IssueSnapshot)
                    .where(IssueSnapshot.orbit_id == orbit.id)
                    .order_by(IssueSnapshot.updated_at.desc())
                ).all()
            ]
        elif section == "codespaces":
            codespaces = [
                _serialize_codespace(db, item)
                for item in db.scalars(
                    select(Codespace)
                    .where(Codespace.orbit_id == orbit.id)
                    .order_by(Codespace.created_at.desc())
                ).all()
            ]
        elif section == "demos":
            demos = [
                _serialize_demo(db, item)
                for item in db.scalars(
                    select(Demo)
                    .where(Demo.orbit_id == orbit.id)
                    .order_by(Demo.created_at.desc())
                ).all()
            ]
            artifacts = [_serialize_artifact(db, item) for item in artifacts_for_orbit(db, orbit_id=orbit.id)[:16]]

        return OrbitPayload(
            orbit=_serialize_orbit(orbit),
            repositories=repositories,
            members=[],
            channels=[_serialize_channel(channel) for channel in channels],
            direct_messages=[_serialize_dm_thread(db, thread, viewer=user) for thread in dms],
            messages=[],
            human_loop_items=[],
            notifications=[],
            permissions=permissions,
            workflow=_workflow_hot_read(db, orbit),
            prs=prs,
            issues=issues,
            native_issues=native_issues,
            issue_labels=_serialize_issue_label_catalog(native_issue_context),
            cycles=cycles,
            codespaces=codespaces,
            demos=demos,
            artifacts=artifacts,
            navigation=navigation_state,
        )

    @app.get("/api/orbits/{orbit_id}", response_model=OrbitPayload)
    def get_orbit(
        orbit_id: str,
        bootstrap: bool = Query(default=False),
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> OrbitPayload:
        orbit = _orbit_for_member(db, orbit_id, user)
        ensure_primary_repo_binding(db, orbit)
        if bootstrap:
            return _serialize_bootstrap_orbit_payload(db, orbit, user=user)
        memberships = db.scalars(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit.id).order_by(OrbitMembership.created_at)).all()
        members = [
            _serialize_member_summary(member_user, membership, viewer=user)
            for membership in memberships
            if (member_user := db.get(User, membership.user_id)) is not None
        ]
        channels = db.scalars(select(Channel).where(Channel.orbit_id == orbit.id).order_by(Channel.slug)).all()
        dms = db.scalars(select(DmThread).where(DmThread.orbit_id == orbit.id).order_by(DmThread.created_at)).all()
        prs = db.scalars(select(PullRequestSnapshot).where(PullRequestSnapshot.orbit_id == orbit.id).order_by(PullRequestSnapshot.updated_at.desc())).all()
        issues = db.scalars(select(IssueSnapshot).where(IssueSnapshot.orbit_id == orbit.id).order_by(IssueSnapshot.updated_at.desc())).all()
        native_issues = db.scalars(select(OrbitIssue).where(OrbitIssue.orbit_id == orbit.id).order_by(OrbitIssue.updated_at.desc(), OrbitIssue.sequence_no.desc())).all()
        native_issue_context = _build_orbit_issue_context(db, native_issues)
        cycles = db.scalars(select(OrbitCycle).where(OrbitCycle.orbit_id == orbit.id).order_by(OrbitCycle.starts_at.desc(), OrbitCycle.created_at.desc())).all()
        codespaces = db.scalars(select(Codespace).where(Codespace.orbit_id == orbit.id).order_by(Codespace.created_at.desc())).all()
        demos = db.scalars(select(Demo).where(Demo.orbit_id == orbit.id).order_by(Demo.created_at.desc())).all()
        workflow = _workflow_hot_read(db, orbit)
        general = _orbit_channel(db, orbit.id)
        messages = list(
            reversed(
                db.scalars(
                    select(Message)
                    .where(Message.orbit_id == orbit.id, Message.channel_id == general.id)
                    .order_by(Message.created_at.desc())
                    .limit(ORBIT_HOT_READ_MESSAGE_LIMIT)
                ).all()
            )
        )
        last_general_message_id = messages[-1].id if messages else None
        mark_conversation_seen(
            db,
            user_id=user.id,
            orbit_id=orbit.id,
            channel_id=general.id,
            last_seen_message_id=last_general_message_id,
        )
        try:
            db.commit()
        except OperationalError as exc:
            db.rollback()
            logger.warning(
                "Orbit read-state update failed for orbit %s; serving orbit payload without committing read markers: %s",
                orbit.id,
                exc,
            )
        conversation_items = human_loop_items_for_conversation(db, orbit_id=orbit.id, channel_id=general.id)
        orbit_notifications = notifications_for_user(db, user_id=user.id, orbit_id=orbit.id)
        orbit_artifacts = artifacts_for_orbit(db, orbit_id=orbit.id)
        permissions = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        return OrbitPayload(
            orbit=_serialize_orbit(orbit),
            repositories=[_serialize_repository_connection(repository, binding) for repository, binding in repositories_for_orbit(db, orbit.id)],
            members=members,
            channels=[_serialize_channel(channel) for channel in channels],
            direct_messages=[_serialize_dm_thread(db, thread, viewer=user) for thread in dms],
            messages=[_serialize_message(message) for message in messages],
            human_loop_items=[_serialize_human_loop_item(item) for item in conversation_items],
            notifications=[_serialize_notification(item) for item in orbit_notifications[:12]],
            permissions=serialize_permission_snapshot(permissions),
            workflow=workflow,
            prs=[_serialize_pull_request(db, item) for item in prs],
            issues=[_serialize_issue(db, item) for item in issues],
            native_issues=[_serialize_orbit_issue(db, item, context=native_issue_context) for item in native_issues],
            issue_labels=_serialize_issue_label_catalog(native_issue_context),
            cycles=[_serialize_orbit_cycle(db, item) for item in cycles],
            codespaces=[_serialize_codespace(db, item) for item in codespaces],
            demos=[_serialize_demo(db, item) for item in demos],
            artifacts=[_serialize_artifact(db, item) for item in orbit_artifacts[:16]],
            navigation=navigation.get_state(user.id),
        )

    @app.post("/api/orbits/{orbit_id}/cycles")
    def create_orbit_cycle(
        orbit_id: str,
        payload: OrbitCycleCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permission_snapshot = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        if not role_at_least(permission_snapshot.orbit_role, ORBIT_ROLE_CONTRIBUTOR):
            raise HTTPException(status_code=403, detail="Only contributors and above can create cycles.")
        cycle = OrbitCycle(
            orbit_id=orbit.id,
            created_by_user_id=user.id,
            name=payload.name.strip(),
            goal=(payload.goal or "").strip() or None,
            status=str(payload.status or "active").strip().lower() or "active",
            starts_at=payload.starts_at,
            ends_at=payload.ends_at,
        )
        db.add(cycle)
        db.flush()
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="cycle.created",
            target_kind="cycle",
            target_id=cycle.id,
            metadata_json={"name": cycle.name, "status": cycle.status},
        )
        db.commit()
        return _serialize_orbit_cycle(db, cycle)

    @app.patch("/api/orbits/{orbit_id}/cycles/{cycle_id}")
    def update_orbit_cycle(
        orbit_id: str,
        cycle_id: str,
        payload: OrbitCycleUpdateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permission_snapshot = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        if not role_at_least(permission_snapshot.orbit_role, ORBIT_ROLE_CONTRIBUTOR):
            raise HTTPException(status_code=403, detail="Only contributors and above can update cycles.")
        cycle = db.get(OrbitCycle, cycle_id)
        if cycle is None or cycle.orbit_id != orbit.id:
            raise HTTPException(status_code=404, detail="Cycle not found")

        updates = payload.model_dump(exclude_unset=True)
        if "name" in updates:
            name = str(updates.get("name") or "").strip()
            if not name:
                raise HTTPException(status_code=400, detail="Cycle name is required")
            cycle.name = name
        if "goal" in updates:
            cycle.goal = str(updates.get("goal") or "").strip() or None
        if "status" in updates:
            cycle.status = str(updates.get("status") or "active").strip().lower() or "active"
        if "starts_at" in updates:
            cycle.starts_at = updates.get("starts_at")
        if "ends_at" in updates:
            cycle.ends_at = updates.get("ends_at")
        cycle.updated_at = utc_now()
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="cycle.updated",
            target_kind="cycle",
            target_id=cycle.id,
            metadata_json={"name": cycle.name, "status": cycle.status},
        )
        db.commit()
        return _serialize_orbit_cycle(db, cycle)

    @app.delete("/api/orbits/{orbit_id}/cycles/{cycle_id}")
    def delete_orbit_cycle(
        orbit_id: str,
        cycle_id: str,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permission_snapshot = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        if not role_at_least(permission_snapshot.orbit_role, ORBIT_ROLE_CONTRIBUTOR):
            raise HTTPException(status_code=403, detail="Only contributors and above can delete cycles.")
        cycle = db.get(OrbitCycle, cycle_id)
        if cycle is None or cycle.orbit_id != orbit.id:
            raise HTTPException(status_code=404, detail="Cycle not found")

        issue_count = 0
        for issue in db.scalars(select(OrbitIssue).where(OrbitIssue.orbit_id == orbit.id, OrbitIssue.cycle_id == cycle.id)).all():
            issue.cycle_id = None
            issue.updated_at = utc_now()
            issue_count += 1
        db.delete(cycle)
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="cycle.deleted",
            target_kind="cycle",
            target_id=cycle_id,
            metadata_json={"issue_count": issue_count},
        )
        db.commit()
        return {"ok": True, "id": cycle_id}

    @app.post("/api/orbits/{orbit_id}/native-issues")
    def create_native_orbit_issue(
        orbit_id: str,
        payload: OrbitIssueCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permission_snapshot = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        if not role_at_least(permission_snapshot.orbit_role, ORBIT_ROLE_CONTRIBUTOR):
            raise HTTPException(status_code=403, detail="Only contributors and above can create native issues.")
        cycle = None
        if payload.cycle_id:
            cycle = db.get(OrbitCycle, payload.cycle_id)
            if cycle is None or cycle.orbit_id != orbit.id:
                raise HTTPException(status_code=404, detail="Cycle not found")
        primary_repository = primary_repository_for_orbit(db, orbit)
        assignee_user_id = _resolve_issue_assignee_user_id(db, orbit, payload.assignee_user_id or user.id)
        issue = OrbitIssue(
            orbit_id=orbit.id,
            cycle_id=cycle.id if cycle else None,
            created_by_user_id=user.id,
            assignee_user_id=assignee_user_id,
            parent_issue_id=_resolve_issue_parent(db, orbit, payload.parent_issue_id),
            repository_connection_id=primary_repository.id if primary_repository else None,
            sequence_no=_next_orbit_issue_sequence(db, orbit.id),
            title=payload.title.strip(),
            detail=(payload.detail or "").strip() or None,
            status=_normalize_native_issue_status(payload.status),
            priority=_normalize_native_issue_priority(payload.priority),
            source_kind="manual",
        )
        db.add(issue)
        db.flush()
        _replace_issue_labels(db, issue, labels=payload.labels, user=user)
        _replace_issue_relations(db, issue, relation_kind="blocked_by", related_issue_ids=payload.blocked_by_issue_ids, orbit=orbit, user=user)
        _replace_issue_relations(db, issue, relation_kind="related", related_issue_ids=payload.related_issue_ids, orbit=orbit, user=user)
        _replace_issue_relations(db, issue, relation_kind="duplicate", related_issue_ids=payload.duplicate_issue_ids, orbit=orbit, user=user)
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="issue.created",
            target_kind="native_issue",
            target_id=issue.id,
            metadata_json={
                "sequence_no": issue.sequence_no,
                "status": issue.status,
                "cycle_id": issue.cycle_id,
                "assignee_user_id": issue.assignee_user_id,
                "parent_issue_id": issue.parent_issue_id,
                "labels": _normalize_issue_label_names(payload.labels),
            },
        )
        db.commit()
        return _serialize_orbit_issue(db, issue)

    @app.patch("/api/orbits/{orbit_id}/native-issues/{issue_id}")
    def update_native_orbit_issue(
        orbit_id: str,
        issue_id: str,
        payload: OrbitIssueUpdateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permission_snapshot = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        if not role_at_least(permission_snapshot.orbit_role, ORBIT_ROLE_CONTRIBUTOR):
            raise HTTPException(status_code=403, detail="Only contributors and above can update native issues.")
        issue = db.get(OrbitIssue, issue_id)
        if issue is None or issue.orbit_id != orbit.id:
            raise HTTPException(status_code=404, detail="Native issue not found")
        next_cycle = issue.cycle_id
        if payload.cycle_id is not None:
            if payload.cycle_id == "":
                next_cycle = None
            else:
                cycle = db.get(OrbitCycle, payload.cycle_id)
                if cycle is None or cycle.orbit_id != orbit.id:
                    raise HTTPException(status_code=404, detail="Cycle not found")
                next_cycle = cycle.id
        if payload.title is not None:
            issue.title = payload.title.strip() or issue.title
        if payload.detail is not None:
            issue.detail = payload.detail.strip() or None
        if payload.priority is not None:
            issue.priority = _normalize_native_issue_priority(payload.priority)
        if payload.status is not None:
            issue.status = _normalize_native_issue_status(payload.status)
        if "assignee_user_id" in payload.model_fields_set:
            issue.assignee_user_id = _resolve_issue_assignee_user_id(db, orbit, payload.assignee_user_id)
        if "parent_issue_id" in payload.model_fields_set:
            issue.parent_issue_id = _resolve_issue_parent(db, orbit, payload.parent_issue_id, issue=issue)
        issue.cycle_id = next_cycle
        if "labels" in payload.model_fields_set and payload.labels is not None:
            _replace_issue_labels(db, issue, labels=payload.labels, user=user)
        if "blocked_by_issue_ids" in payload.model_fields_set and payload.blocked_by_issue_ids is not None:
            _replace_issue_relations(db, issue, relation_kind="blocked_by", related_issue_ids=payload.blocked_by_issue_ids, orbit=orbit, user=user)
        if "related_issue_ids" in payload.model_fields_set and payload.related_issue_ids is not None:
            _replace_issue_relations(db, issue, relation_kind="related", related_issue_ids=payload.related_issue_ids, orbit=orbit, user=user)
        if "duplicate_issue_ids" in payload.model_fields_set and payload.duplicate_issue_ids is not None:
            _replace_issue_relations(db, issue, relation_kind="duplicate", related_issue_ids=payload.duplicate_issue_ids, orbit=orbit, user=user)
        issue.updated_at = utc_now()
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="issue.updated",
            target_kind="native_issue",
            target_id=issue.id,
            metadata_json={
                "status": issue.status,
                "cycle_id": issue.cycle_id,
                "priority": issue.priority,
                "assignee_user_id": issue.assignee_user_id,
                "parent_issue_id": issue.parent_issue_id,
                "labels": _normalize_issue_label_names(payload.labels or [] if "labels" in payload.model_fields_set else []),
            },
        )
        db.commit()
        return _serialize_orbit_issue(db, issue)

    @app.get("/api/orbits/{orbit_id}/search")
    def orbit_search(
        orbit_id: str,
        q: str = Query(default=""),
        limit: int = Query(default=16, ge=1, le=40),
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> list[dict[str, Any]]:
        if not flag_enabled(settings, "ff_search_command_v1"):
            raise HTTPException(status_code=404, detail="Orbit search is not enabled.")
        orbit = _orbit_for_member(db, orbit_id, user)
        ensure_primary_repo_binding(db, orbit)
        return _orbit_search(db, orbit, query=q, viewer=user, limit=limit)

    @app.get("/api/orbits/{orbit_id}/messages")
    def orbit_messages(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
        orbit = _orbit_for_member(db, orbit_id, user)
        general = _orbit_channel(db, orbit.id)
        messages = db.scalars(select(Message).where(Message.orbit_id == orbit.id, Message.channel_id == general.id).order_by(Message.created_at)).all()
        return [_serialize_message(message) for message in messages]

    @app.post("/api/orbits/{orbit_id}/channels")
    def create_channel(
        orbit_id: str,
        payload: ChannelCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        slug = _unique_channel_slug(db, orbit.id, payload.name, payload.slug)
        channel = Channel(
            orbit_id=orbit.id,
            slug=slug,
            name=payload.name.strip(),
            kind="channel",
        )
        db.add(channel)
        db.commit()
        return _serialize_channel(channel)

    @app.get("/api/orbits/{orbit_id}/channels/{channel_id}/messages")
    def orbit_channel_messages(
        orbit_id: str,
        channel_id: str,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        channel = _orbit_channel_by_id(db, orbit.id, channel_id)
        messages = db.scalars(
            select(Message).where(Message.orbit_id == orbit.id, Message.channel_id == channel.id).order_by(Message.created_at)
        ).all()
        mark_conversation_seen(
            db,
            user_id=user.id,
            orbit_id=orbit.id,
            channel_id=channel.id,
            last_seen_message_id=messages[-1].id if messages else None,
        )
        db.commit()
        return {
            "channel": _serialize_channel(channel),
            "messages": [_serialize_message(message) for message in messages],
            "human_loop_items": [
                _serialize_human_loop_item(item)
                for item in human_loop_items_for_conversation(db, orbit_id=orbit.id, channel_id=channel.id)
            ],
        }

    @app.post("/api/orbits/{orbit_id}/channels/{channel_id}/messages")
    def post_channel_message(
        orbit_id: str,
        channel_id: str,
        payload: MessageCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        channel = _orbit_channel_by_id(db, orbit.id, channel_id)
        user_message = Message(
            orbit_id=orbit.id,
            channel_id=channel.id,
            user_id=user.id,
            author_kind="user",
            author_name=user.display_name,
            body=payload.body,
        )
        db.add(user_message)
        db.flush()
        _record_context(
            orbit,
            source_kind="chat_message",
            source_id=user_message.id,
            event_type="chat.message.created",
            body=payload.body,
            payload_json={"author": user.display_name, "surface": "channel", "channel_id": channel.id},
            db=db,
        )
        create_message_notifications(
            db,
            orbit=orbit,
            author_user_id=user.id,
            author_name=user.display_name,
            message_id=user_message.id,
            body=payload.body,
            channel_id=channel.id,
            channel_name=channel.name,
        )
        _queue_message_for_matrix(db=db, orbit=orbit, actor_user=user, message=user_message, channel=channel)
        ergo_body, should_start_work = _ergo_reply_for(payload.body)
        reply = None
        work_item_payload = None
        permission_snapshot = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        primary_repo = primary_repository_for_orbit(db, orbit)
        repository_ids = [primary_repo.id] if primary_repo is not None else []
        if ergo_body:
            reply = Message(
                orbit_id=orbit.id,
                channel_id=channel.id,
                author_kind="agent",
                author_name="ERGO",
                body=ergo_body,
            )
            db.add(reply)
            db.flush()
            _queue_message_for_matrix(db=db, orbit=orbit, actor_user=user, message=reply, channel=channel)
        if should_start_work:
            if repository_ids and not permission_snapshot.can_trigger_run_for_repos(repository_ids):
                permission_reply = Message(
                    orbit_id=orbit.id,
                    channel_id=channel.id,
                    author_kind="agent",
                    author_name="ERGO",
                    body="I need repo-operate permission on the scoped repository before I can start implementation work here.",
                    metadata_json={"kind": "permission_notice", "repository_ids": repository_ids},
                )
                db.add(permission_reply)
                db.flush()
                _queue_message_for_matrix(db=db, orbit=orbit, actor_user=user, message=permission_reply, channel=channel)
                reply = permission_reply
            else:
                work_item_payload = _start_work_item(
                    db,
                    orbit,
                    user,
                    request_text=payload.body,
                    summary=ergo_body,
                    source_channel_id=channel.id,
                )
                record_audit_event(
                    db,
                    orbit_id=orbit.id,
                    actor_user_id=user.id,
                    action_type="workflow.triggered",
                    target_kind="work_item",
                    target_id=work_item_payload["id"],
                    metadata_json={"channel_id": channel.id, "repository_ids": repository_ids},
                )
        db.commit()
        return {
            "channel": _serialize_channel(channel),
            "message": _serialize_message(user_message),
            "ergo": _serialize_message(reply) if reply else None,
            "work_item": work_item_payload,
        }

    @app.post("/api/orbits/{orbit_id}/messages")
    def post_orbit_message(
        orbit_id: str,
        payload: MessageCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        general = _orbit_channel(db, orbit.id)
        return post_channel_message(orbit.id, general.id, payload, user, db)

    @app.post("/api/orbits/{orbit_id}/messages/{message_id}/retry-transport")
    def retry_message_transport(
        orbit_id: str,
        message_id: str,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        message = db.get(Message, message_id)
        if message is None or message.orbit_id != orbit.id:
            raise HTTPException(status_code=404, detail="Message not found")
        if message.user_id not in {None, user.id}:
            raise HTTPException(status_code=403, detail="Only the original author can retry this message transport.")
        link = matrix_message_link_for_message(db, message_id=message.id)
        if link is None:
            channel = db.get(Channel, message.channel_id) if message.channel_id else None
            thread = db.get(DmThread, message.dm_thread_id) if message.dm_thread_id else None
            _queue_message_for_matrix(db=db, orbit=orbit, actor_user=user, message=message, channel=channel, thread=thread)
        else:
            link.send_state = "retry_requested"
            link.last_error = None
            link.updated_at = utc_now()
            message.transport_state = "pending_remote"
            message.transport_error = None
        db.commit()
        return {"message": _serialize_message(message)}

    @app.post("/api/orbits/{orbit_id}/prs-issues/refresh")
    def refresh_prs_and_issues(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        repositories = repositories_for_orbit(db, orbit.id)
        if not repositories:
            return {"prs": 0, "issues": 0, "failed_repositories": []}
        db.query(PullRequestSnapshot).filter(PullRequestSnapshot.orbit_id == orbit.id).delete()
        db.query(IssueSnapshot).filter(IssueSnapshot.orbit_id == orbit.id).delete()
        pr_count = 0
        issue_count = 0
        failed_repositories: list[str] = []
        for repository, _binding in repositories:
            try:
                prs = repo_access.list_pull_requests(db, actor_user=user, repository=repository)
                issues = repo_access.list_issues(db, actor_user=user, repository=repository)
                repository.health_state = "healthy"
                repository.status = "active"
                repository.metadata_json = {
                    **(repository.metadata_json or {}),
                    "last_sync_at": utc_now().isoformat(),
                }
            except Exception as exc:
                repository.health_state = "degraded"
                repository.metadata_json = {
                    **(repository.metadata_json or {}),
                    "last_sync_error": str(exc),
                }
                failed_repositories.append(repository.full_name)
                continue
            for pr in prs:
                db.add(
                    PullRequestSnapshot(
                        orbit_id=orbit.id,
                        repository_connection_id=repository.id,
                        github_number=pr["number"],
                        title=pr["title"],
                        state=pr["state"],
                        priority="high" if pr.get("draft") else "medium",
                        url=pr["html_url"],
                        branch_name=pr.get("head", {}).get("ref"),
                        metadata_json={
                            "draft": pr.get("draft", False),
                            "merged_at": pr.get("merged_at"),
                            "review_decision": pr.get("review_decision"),
                            "mergeable_state": pr.get("mergeable_state"),
                            "blocked": pr.get("mergeable_state") == "blocked",
                            "repository_full_name": repository.full_name,
                            "repository_url": repository.url,
                        },
                    )
                )
                pr_count += 1
            for issue in issues:
                if "pull_request" in issue:
                    continue
                db.add(
                    IssueSnapshot(
                        orbit_id=orbit.id,
                        repository_connection_id=repository.id,
                        github_number=issue["number"],
                        title=issue["title"],
                        state=issue["state"],
                        priority="high" if "bug" in {label["name"] for label in issue.get("labels", [])} else "medium",
                        url=issue["html_url"],
                        metadata_json={
                            "labels": [label["name"] for label in issue.get("labels", [])],
                            "repository_full_name": repository.full_name,
                            "repository_url": repository.url,
                        },
                    )
                )
                issue_count += 1
        db.commit()
        return {"prs": pr_count, "issues": issue_count, "failed_repositories": failed_repositories}

    @app.get("/api/orbits/{orbit_id}/workflow")
    def orbit_workflow(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        try:
            workflow = _load_workflow_snapshot(db, orbit, timeout_seconds=1.25, sync_projection=True)
            db.commit()
        except OperationalError as exc:
            db.rollback()
            logger.warning(
                "Workflow projection refresh failed for orbit %s; serving workflow payload without refreshed projections: %s",
                orbit.id,
                exc,
            )
            workflow = _load_workflow_snapshot(db, orbit, timeout_seconds=1.25, sync_projection=False)
        return workflow

    @app.post("/api/orbits/{orbit_id}/workflow/human-requests/answer")
    def answer_workflow_human_request(
        orbit_id: str,
        payload: WorkflowHumanAnswerRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permissions = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        run_repository_ids = repository_ids_for_run(db, payload.workflow_run_id)
        _require_permission(
            permissions.can_trigger_run_for_repos(run_repository_ids or list(permissions.repo_grants)),
            "You do not have permission to answer workflow clarification requests for this run.",
        )
        human_loop_item = runtime_human_loop_item_for_request(
            db,
            orbit_id=orbit.id,
            workflow_run_id=payload.workflow_run_id,
            request_id=payload.request_id,
            request_kind="clarification",
        )
        existing_receipt = human_loop_submission_receipt(human_loop_item)
        if existing_receipt is not None:
            previous_answer = str(existing_receipt.get("response_text") or "").strip()
            next_answer = payload.answer_text.strip()
            if previous_answer == next_answer:
                return {**existing_receipt, "idempotent": True}
            raise HTTPException(status_code=409, detail="This clarification request has already been answered.")
        receipt = runtime_manager.answer_human_request(
            orbit,
            workflow_run_id=payload.workflow_run_id,
            request_id=payload.request_id,
            answer_text=payload.answer_text,
        )
        if human_loop_item is not None:
            record_human_loop_submission(
                db,
                orbit=orbit,
                item=human_loop_item,
                actor_user_id=user.id,
                answer_text=payload.answer_text.strip(),
            )
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="workflow.human_request.answered",
            target_kind="human_request",
            target_id=payload.request_id,
            metadata_json={"workflow_run_id": payload.workflow_run_id},
        )
        db.commit()
        try:
            workflow = _load_workflow_snapshot(db, orbit, timeout_seconds=1.25, sync_projection=True)
            db.commit()
        except OperationalError as exc:
            db.rollback()
            logger.warning(
                "Workflow clarification projection refresh failed for orbit %s after request %s: %s",
                orbit.id,
                payload.request_id,
                exc,
            )
        return receipt

    @app.post("/api/orbits/{orbit_id}/workflow/approval-requests/resolve")
    def resolve_workflow_approval(
        orbit_id: str,
        payload: WorkflowApprovalRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permissions = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        run_repository_ids = repository_ids_for_run(db, payload.workflow_run_id)
        _require_permission(
            permissions.can_resolve_approval_for_repos(run_repository_ids),
            "You do not have permission to resolve this approval request.",
        )
        approval_item = runtime_human_loop_item_for_request(
            db,
            orbit_id=orbit.id,
            workflow_run_id=payload.workflow_run_id,
            request_id=payload.request_id,
            request_kind="approval",
        )
        existing_receipt = human_loop_submission_receipt(approval_item)
        if existing_receipt is not None:
            previous_approved = bool(existing_receipt.get("approved"))
            if previous_approved == payload.approved:
                return {**existing_receipt, "idempotent": True}
            raise HTTPException(status_code=409, detail="This approval request has already been resolved.")
        receipt = runtime_manager.resolve_approval_request(
            orbit,
            workflow_run_id=payload.workflow_run_id,
            request_id=payload.request_id,
            approved=payload.approved,
        )
        if approval_item is not None:
            record_human_loop_submission(
                db,
                orbit=orbit,
                item=approval_item,
                actor_user_id=user.id,
                approved=payload.approved,
            )
        record_audit_event(
            db,
            orbit_id=orbit.id,
            actor_user_id=user.id,
            action_type="workflow.approval.resolved",
            target_kind="approval_request",
            target_id=payload.request_id,
            metadata_json={"workflow_run_id": payload.workflow_run_id, "approved": payload.approved},
        )
        db.commit()
        try:
            workflow = _load_workflow_snapshot(db, orbit, timeout_seconds=1.25, sync_projection=True)
            db.commit()
        except OperationalError as exc:
            db.rollback()
            logger.warning(
                "Workflow approval projection refresh failed for orbit %s after request %s: %s",
                orbit.id,
                payload.request_id,
                exc,
            )
        return receipt

    @app.get("/api/orbits/{orbit_id}/dms")
    def orbit_dms(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
        orbit = _orbit_for_member(db, orbit_id, user)
        threads = db.scalars(select(DmThread).where(DmThread.orbit_id == orbit.id).order_by(DmThread.created_at)).all()
        visible_threads = []
        for thread in threads:
            participant = db.scalar(select(DmParticipant).where(DmParticipant.thread_id == thread.id, DmParticipant.user_id == user.id))
            if participant is not None:
                visible_threads.append(_serialize_dm_thread(db, thread, viewer=user))
        return visible_threads

    @app.post("/api/orbits/{orbit_id}/dms")
    def create_dm_thread(
        orbit_id: str,
        payload: DmThreadCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        target_kind = (payload.target_kind or "member").strip().lower()
        target_login = (payload.target_login or payload.target_agent or "").strip()
        if target_kind == "agent" or target_login.upper() == "ERGO":
            thread = _ergo_dm_thread(db, orbit, user)
            db.commit()
            return _serialize_dm_thread(db, thread, viewer=user)

        target_user = None
        if payload.target_user_id:
            target_user = db.get(User, payload.target_user_id)
        elif target_login:
            target_user = db.scalar(select(User).where(User.github_login == target_login))
        if target_user is None:
            raise HTTPException(status_code=404, detail="DM participant not found")
        if target_user.id == user.id:
            raise HTTPException(status_code=400, detail="Cannot start a DM with yourself")
        target_membership = db.scalar(
            select(OrbitMembership).where(OrbitMembership.orbit_id == orbit.id, OrbitMembership.user_id == target_user.id)
        )
        if target_membership is None:
            raise HTTPException(status_code=404, detail="DM participant not found in orbit")
        candidate_threads = db.scalars(select(DmThread).where(DmThread.orbit_id == orbit.id).order_by(DmThread.created_at)).all()
        for thread in candidate_threads:
            if thread.title == "ERGO":
                continue
            participants = db.scalars(select(DmParticipant).where(DmParticipant.thread_id == thread.id)).all()
            participant_ids = {participant.user_id for participant in participants}
            if participant_ids == {user.id, target_user.id}:
                return _serialize_dm_thread(db, thread, viewer=user)

        thread = DmThread(orbit_id=orbit.id, title=target_user.display_name)
        db.add(thread)
        db.flush()
        db.add(DmParticipant(thread_id=thread.id, user_id=user.id))
        db.add(DmParticipant(thread_id=thread.id, user_id=target_user.id))
        db.commit()
        return _serialize_dm_thread(db, thread, viewer=user)

    @app.get("/api/orbits/{orbit_id}/dms/{thread_id}")
    def orbit_dm_messages(orbit_id: str, thread_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        thread = _orbit_dm_thread(db, orbit.id, thread_id)
        _ensure_dm_participant_access(db, thread, user)
        messages = db.scalars(
            select(Message).where(Message.orbit_id == orbit.id, Message.dm_thread_id == thread.id).order_by(Message.created_at)
        ).all()
        mark_conversation_seen(
            db,
            user_id=user.id,
            orbit_id=orbit.id,
            dm_thread_id=thread.id,
            last_seen_message_id=messages[-1].id if messages else None,
        )
        db.commit()
        return {
            "thread": _serialize_dm_thread(db, thread, viewer=user),
            "messages": [_serialize_message(message) for message in messages],
            "human_loop_items": [
                _serialize_human_loop_item(item)
                for item in human_loop_items_for_conversation(db, orbit_id=orbit.id, dm_thread_id=thread.id)
            ],
        }

    @app.post("/api/orbits/{orbit_id}/dms/{thread_id}/messages")
    def post_dm_message(
        orbit_id: str,
        thread_id: str,
        payload: DmMessageCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        thread = _orbit_dm_thread(db, orbit.id, thread_id)
        _ensure_dm_participant_access(db, thread, user)
        message = Message(
            orbit_id=orbit.id,
            dm_thread_id=thread.id,
            user_id=user.id,
            author_kind="user",
            author_name=user.display_name,
            body=payload.body,
        )
        db.add(message)
        db.flush()
        _record_context(
            orbit,
            source_kind="dm_message",
            source_id=message.id,
            event_type="dm.message.created",
            body=payload.body,
            payload_json={"author": user.display_name, "thread_id": thread.id},
            db=db,
        )
        create_message_notifications(
            db,
            orbit=orbit,
            author_user_id=user.id,
            author_name=user.display_name,
            message_id=message.id,
            body=payload.body,
            dm_thread_id=thread.id,
        )
        _queue_message_for_matrix(db=db, orbit=orbit, actor_user=user, message=message, thread=thread)
        ergo_body, should_start_work = (None, False)
        if thread.title == "ERGO":
            ergo_body, should_start_work = _ergo_reply_for(payload.body)
        reply = None
        work_item_payload = None
        if ergo_body:
            reply = Message(
                orbit_id=orbit.id,
                dm_thread_id=thread.id,
                author_kind="agent",
                author_name="ERGO",
                body=ergo_body,
            )
            db.add(reply)
            db.flush()
            _queue_message_for_matrix(db=db, orbit=orbit, actor_user=user, message=reply, thread=thread)
        if should_start_work:
            permission_snapshot = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
            primary_repo = primary_repository_for_orbit(db, orbit)
            repository_ids = [primary_repo.id] if primary_repo is not None else []
            if repository_ids and not permission_snapshot.can_trigger_run_for_repos(repository_ids):
                permission_reply = Message(
                    orbit_id=orbit.id,
                    dm_thread_id=thread.id,
                    author_kind="agent",
                    author_name="ERGO",
                    body="I need repo-operate permission on the scoped repository before I can start implementation work here.",
                    metadata_json={"kind": "permission_notice", "repository_ids": repository_ids},
                )
                db.add(permission_reply)
                db.flush()
                _queue_message_for_matrix(db=db, orbit=orbit, actor_user=user, message=permission_reply, thread=thread)
                reply = permission_reply
            else:
                work_item_payload = _start_work_item(
                    db,
                    orbit,
                    user,
                    request_text=payload.body,
                    summary=ergo_body,
                    source_dm_thread_id=thread.id,
                )
                record_audit_event(
                    db,
                    orbit_id=orbit.id,
                    actor_user_id=user.id,
                    action_type="workflow.triggered",
                    target_kind="work_item",
                    target_id=work_item_payload["id"],
                    metadata_json={"dm_thread_id": thread.id, "repository_ids": repository_ids},
                )
        db.commit()
        return {
            "message": _serialize_message(message),
            "ergo": _serialize_message(reply) if reply else None,
            "work_item": work_item_payload,
        }

    @app.get("/api/orbits/{orbit_id}/codespaces")
    def orbit_codespaces(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
        orbit = _orbit_for_member(db, orbit_id, user)
        items = db.scalars(select(Codespace).where(Codespace.orbit_id == orbit.id).order_by(Codespace.created_at.desc())).all()
        return [_serialize_codespace(db, item) for item in items]

    @app.post("/api/orbits/{orbit_id}/codespaces")
    def create_codespace(
        orbit_id: str,
        payload: CodespaceCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permissions = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        primary_repo = primary_repository_for_orbit(db, orbit)
        repository_ids = [primary_repo.id] if primary_repo is not None else []
        _require_permission(
            not repository_ids or permissions.can_trigger_run_for_repos(repository_ids),
            "You do not have permission to create a repo-bound workspace in this orbit.",
        )
        branch_name = payload.branch_name or f"codespace/{slugify(payload.name)}"
        if primary_repo is not None:
            repo_access.create_branch(
                db,
                actor_user=user,
                repository=primary_repo,
                branch_name=branch_name,
                base_branch=primary_repo.default_branch,
            )
        relative_path = f"orbits/{orbit.slug}/codespaces/{slugify(payload.name)}"
        workspace_path = runtime_manager.settings.runtime_root / relative_path
        clone_url = None
        if primary_repo is not None:
            clone_url = repo_access.clone_url(db, actor_user=user, repository=primary_repo)
        containers.ensure_workspace_clone(orbit=orbit, workspace_path=workspace_path, branch_name=branch_name, clone_url=clone_url)
        codespace = Codespace(
            orbit_id=orbit.id,
            created_by_user_id=user.id,
            repository_connection_id=primary_repo.id if primary_repo is not None else None,
            name=payload.name,
            branch_name=branch_name,
            workspace_path=relative_path,
        )
        db.add(codespace)
        db.flush()
        containers.start_codespace(db, orbit=orbit, codespace=codespace)
        db.commit()
        return _serialize_codespace(db, codespace)

    @app.get("/api/orbits/{orbit_id}/demos")
    def orbit_demos(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
        orbit = _orbit_for_member(db, orbit_id, user)
        items = db.scalars(select(Demo).where(Demo.orbit_id == orbit.id).order_by(Demo.created_at.desc())).all()
        return [_serialize_demo(db, item) for item in items]

    @app.post("/api/orbits/{orbit_id}/demos")
    def publish_demo(
        orbit_id: str,
        payload: DemoPublishRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        permissions = permission_snapshot_for_user(db, orbit_id=orbit.id, user_id=user.id)
        _require_permission(
            permissions.can_publish_artifact(),
            "You do not have permission to publish artifacts in this orbit.",
        )
        repository_connection_id = None
        if payload.work_item_id:
            linked_work_item = db.get(WorkItem, payload.work_item_id)
            repository_ids = repository_ids_for_work_item(db, linked_work_item) if linked_work_item is not None else []
            repository_connection_id = repository_ids[0] if repository_ids else None
        if repository_connection_id is None:
            selected_codespace = db.scalar(
                select(Codespace).where(
                    Codespace.orbit_id == orbit.id,
                    Codespace.workspace_path == payload.source_path,
                )
            )
            if selected_codespace is not None:
                repository_connection_id = selected_codespace.repository_connection_id
        if repository_connection_id is None:
            primary_repo = primary_repository_for_orbit(db, orbit)
            repository_connection_id = primary_repo.id if primary_repo is not None else None
        demo = Demo(
            orbit_id=orbit.id,
            work_item_id=payload.work_item_id,
            repository_connection_id=repository_connection_id,
            title=payload.title,
            source_path=payload.source_path,
        )
        db.add(demo)
        db.flush()
        containers.start_demo(db, demo=demo)
        linked_work_item = db.get(WorkItem, demo.work_item_id) if demo.work_item_id else None
        artifact = upsert_artifact(
            db,
            orbit_id=orbit.id,
            repository_connection_id=demo.repository_connection_id,
            work_item_id=demo.work_item_id,
            workflow_run_id=linked_work_item.workflow_run_id if linked_work_item is not None else None,
            source_kind="demo",
            source_id=demo.id,
            artifact_kind="demo",
            title=demo.title,
            summary="Published demo preview",
            status=demo.status,
            external_url=demo.url,
            metadata_json={"source_path": demo.source_path},
        )
        notify_artifact_generated(db, orbit=orbit, artifact=artifact, triggered_by_user_id=user.id)
        db.commit()
        return _serialize_demo(db, demo)

    return app
