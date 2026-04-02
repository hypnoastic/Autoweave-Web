from __future__ import annotations

import logging
import secrets
import smtplib
from datetime import timedelta
from email.message import EmailMessage
from typing import Any

import httpx
from fastapi import Depends, FastAPI, Header, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from autoweave_web.core.settings import Settings, get_settings
from autoweave_web.db.session import get_db, init_database, utc_now
from autoweave_web.models.entities import (
    Artifact,
    Channel,
    Codespace,
    Demo,
    DmParticipant,
    DmThread,
    IssueSnapshot,
    Message,
    NavigationState,
    Notification,
    Orbit,
    OrbitInvite,
    OrbitMembership,
    OrbitRepositoryBinding,
    RepoGrant,
    PullRequestSnapshot,
    RepositoryConnection,
    RuntimeHumanLoopItem,
    RuntimeRunProjection,
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
    GitHubTokenLoginRequest,
    InviteRequest,
    MessageCreateRequest,
    NavigationStateRequest,
    OrbitCreateRequest,
    OrbitMemberRoleUpdateRequest,
    OrbitRepositoryConnectRequest,
    OrbitPayload,
    SessionPayload,
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
from autoweave_web.services.policy import (
    ORBIT_ROLE_CONTRIBUTOR,
    ORBIT_ROLE_MANAGER,
    ORBIT_ROLE_OWNER,
    ORBIT_ROLE_VIEWER,
    normalize_orbit_role,
)
from autoweave_web.services.runtime import RuntimeManager, slugify

logger = logging.getLogger(__name__)
ORBIT_HOT_READ_MESSAGE_LIMIT = 120


def create_app(
    *,
    settings: Settings | None = None,
    github: GitHubGateway | None = None,
    runtime_manager: RuntimeManager | None = None,
    navigation: NavigationStore | None = None,
    containers: ContainerOrchestrator | None = None,
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

    app.state.settings = settings
    app.state.github = github
    app.state.repo_access = repo_access
    app.state.runtime_manager = runtime_manager
    app.state.navigation = navigation
    app.state.containers = containers

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
            "created_at": message.created_at.isoformat(),
        }

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
            **_repository_identity(db, item.repository_connection_id, item.metadata_json),
        }

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

    @app.get("/api/auth/github/callback")
    def github_callback(code: str | None = Query(default=None), state: str | None = Query(default=None)) -> RedirectResponse:
        target = f"{settings.github_oauth_callback_url}?code={code or ''}"
        if state:
            target = f"{target}&state={state}"
        return RedirectResponse(target, status_code=307)

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
        token = secrets.token_urlsafe(24)
        session = SessionToken(
            user_id=user.id,
            token=token,
            expires_at=utc_now() + timedelta(seconds=settings.session_ttl_seconds),
        )
        db.add(session)
        db.commit()
        return SessionPayload(token=token, user=_serialize_user(user))

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

    @app.get("/api/navigation")
    def get_navigation(user: User = Depends(current_user)) -> dict[str, Any]:
        return navigation.get_state(user.id) or {"orbit_id": None, "section": "dashboard"}

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
            repo_owner=repo["owner"]["login"],
            repo_name=repo["name"],
            repo_full_name=repo["full_name"],
            repo_url=repo["html_url"],
            repo_private=bool(repo["private"]),
            default_branch=repo.get("default_branch") or "main",
            created_by_user_id=user.id,
        )
        db.add(orbit)
        db.flush()
        db.add(OrbitMembership(orbit_id=orbit.id, user_id=user.id, role="owner", introduced=True))
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
            codespaces=[_serialize_codespace(db, item) for item in codespaces],
            demos=[_serialize_demo(db, item) for item in demos],
            artifacts=[_serialize_artifact(db, item) for item in orbit_artifacts[:16]],
            navigation=navigation.get_state(user.id),
        )

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
