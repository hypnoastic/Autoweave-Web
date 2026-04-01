from __future__ import annotations

import re
from typing import Any

from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert as postgresql_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from autoweave_web.models.entities import (
    AuditEvent,
    Artifact,
    Codespace,
    ConversationState,
    Demo,
    DmParticipant,
    IntegrationInstallation,
    IssueSnapshot,
    NotificationPreference,
    Notification,
    Orbit,
    OrbitMembership,
    OrbitRepositoryBinding,
    RepoGrant,
    RepositoryConnection,
    RunRepoScope,
    RuntimeHumanLoopItem,
    RuntimeRunProjection,
    PullRequestSnapshot,
    User,
    WorkItem,
    WorkItemRepoScope,
)
from autoweave_web.db.session import generate_id, utc_now
from autoweave_web.services.policy import (
    ORBIT_ROLE_CONTRIBUTOR,
    REPO_GRANT_ADMIN,
    REPO_GRANT_VIEW,
    OrbitPermissionSnapshot,
    normalize_orbit_role,
)


_MENTION_PATTERN = re.compile(r"@([A-Za-z0-9][A-Za-z0-9_-]{0,38})")


def record_audit_event(
    db: Session,
    *,
    orbit_id: str | None,
    actor_user_id: str | None,
    action_type: str,
    target_kind: str,
    target_id: str | None,
    metadata_json: dict[str, Any] | None = None,
) -> AuditEvent:
    event = AuditEvent(
        orbit_id=orbit_id,
        actor_user_id=actor_user_id,
        action_type=action_type,
        target_kind=target_kind,
        target_id=target_id,
        metadata_json=metadata_json or {},
    )
    db.add(event)
    db.flush()
    return event


def ensure_installation_for_user(
    db: Session,
    user: User,
    *,
    touch: bool = True,
) -> IntegrationInstallation:
    installation_key = f"github:user_token_dev:{user.id}"
    installation = db.scalar(
        select(IntegrationInstallation).where(IntegrationInstallation.installation_key == installation_key)
    )
    if installation is None:
        installation = IntegrationInstallation(
            provider="github",
            installation_kind="user_token_dev",
            installation_key=installation_key,
            owner_user_id=user.id,
            display_name=f"{user.github_login} local GitHub access",
            metadata_json={"mode": "user_token_dev"},
        )
        db.add(installation)
        db.flush()
    elif touch:
        installation.updated_at = utc_now()
    return installation


def upsert_repository_connection(
    db: Session,
    *,
    installation: IntegrationInstallation | None,
    repo_payload: dict[str, Any],
    refresh_existing: bool = True,
) -> RepositoryConnection:
    full_name = str(repo_payload.get("full_name") or "").strip()
    if not full_name or "/" not in full_name:
        raise ValueError("Repository payload is missing a valid full_name.")
    owner_name = str(repo_payload.get("owner", {}).get("login") or repo_payload.get("owner_name") or "").strip()
    repo_name = str(repo_payload.get("name") or repo_payload.get("repo_name") or "").strip()
    if not owner_name or not repo_name:
        owner_name, _, repo_name = full_name.partition("/")
    repository = db.scalar(select(RepositoryConnection).where(RepositoryConnection.full_name == full_name))
    if repository is None:
        repository = RepositoryConnection(
            installation_id=installation.id if installation else None,
            external_repo_id=str(repo_payload.get("id") or "") or None,
            owner_name=owner_name,
            repo_name=repo_name,
            full_name=full_name,
            url=repo_payload.get("html_url") or repo_payload.get("url"),
            is_private=bool(repo_payload.get("private", True)),
            default_branch=str(repo_payload.get("default_branch") or "main"),
            metadata_json={"pushed_at": repo_payload.get("pushed_at")},
        )
        db.add(repository)
        db.flush()
    elif refresh_existing:
        repository.installation_id = installation.id if installation else repository.installation_id
        repository.external_repo_id = str(repo_payload.get("id") or repository.external_repo_id or "") or repository.external_repo_id
        repository.owner_name = owner_name or repository.owner_name
        repository.repo_name = repo_name or repository.repo_name
        repository.url = repo_payload.get("html_url") or repo_payload.get("url") or repository.url
        repository.is_private = bool(repo_payload.get("private", repository.is_private))
        repository.default_branch = str(repo_payload.get("default_branch") or repository.default_branch or "main")
        repository.status = "active"
        repository.health_state = "healthy"
        repository.metadata_json = {
            **(repository.metadata_json or {}),
            "pushed_at": repo_payload.get("pushed_at"),
        }
        repository.updated_at = utc_now()
    return repository


def _apply_default_repo_grants(db: Session, *, orbit_id: str, repository_connection_id: str) -> None:
    memberships = db.scalars(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit_id)).all()
    for membership in memberships:
        normalized_role = normalize_orbit_role(membership.role)
        if normalized_role == "owner":
            grant_level = REPO_GRANT_ADMIN
        elif normalized_role in {"manager", ORBIT_ROLE_CONTRIBUTOR, "member"}:
            grant_level = REPO_GRANT_VIEW
        else:
            continue
        ensure_repo_grant(
            db,
            orbit_id=orbit_id,
            repository_connection_id=repository_connection_id,
            user_id=membership.user_id,
            grant_level=grant_level,
        )


def set_primary_repository_binding(
    db: Session,
    *,
    orbit: Orbit,
    repository_connection_id: str,
) -> OrbitRepositoryBinding:
    bindings = db.scalars(select(OrbitRepositoryBinding).where(OrbitRepositoryBinding.orbit_id == orbit.id)).all()
    target: OrbitRepositoryBinding | None = None
    for binding in bindings:
        is_primary = binding.repository_connection_id == repository_connection_id and binding.status == "active"
        binding.is_primary = is_primary
        binding.updated_at = utc_now()
        if is_primary:
            target = binding
    if target is None:
        raise ValueError("Primary repository binding could not be found.")
    repository = db.get(RepositoryConnection, repository_connection_id)
    if repository is not None:
        orbit.repo_owner = repository.owner_name
        orbit.repo_name = repository.repo_name
        orbit.repo_full_name = repository.full_name
        orbit.repo_url = repository.url
        orbit.repo_private = repository.is_private
        orbit.default_branch = repository.default_branch or orbit.default_branch
    return target


def bind_repository_to_orbit(
    db: Session,
    *,
    orbit: Orbit,
    repository: RepositoryConnection,
    added_by_user_id: str | None,
    make_primary: bool = False,
) -> OrbitRepositoryBinding:
    binding = db.scalar(
        select(OrbitRepositoryBinding).where(
            OrbitRepositoryBinding.orbit_id == orbit.id,
            OrbitRepositoryBinding.repository_connection_id == repository.id,
        )
    )
    if binding is None:
        binding = OrbitRepositoryBinding(
            orbit_id=orbit.id,
            repository_connection_id=repository.id,
            added_by_user_id=added_by_user_id,
            is_primary=False,
            status="active",
        )
        db.add(binding)
        db.flush()
    else:
        binding.status = "active"
        binding.added_by_user_id = added_by_user_id or binding.added_by_user_id
        binding.updated_at = utc_now()
    if make_primary or not any(bound_binding.is_primary for _, bound_binding in repositories_for_orbit(db, orbit.id)):
        set_primary_repository_binding(db, orbit=orbit, repository_connection_id=repository.id)
    _apply_default_repo_grants(db, orbit_id=orbit.id, repository_connection_id=repository.id)
    return binding


def ensure_primary_repo_binding(
    db: Session,
    orbit: Orbit,
    *,
    touch_installation: bool = False,
    refresh_repository: bool = False,
) -> tuple[RepositoryConnection, OrbitRepositoryBinding] | None:
    existing_primary = db.scalar(
        select(OrbitRepositoryBinding).where(
            OrbitRepositoryBinding.orbit_id == orbit.id,
            OrbitRepositoryBinding.is_primary.is_(True),
            OrbitRepositoryBinding.status == "active",
        )
    )
    if existing_primary is not None:
        repository = db.get(RepositoryConnection, existing_primary.repository_connection_id)
        if repository is not None:
            return repository, existing_primary
    if not orbit.repo_full_name:
        return None
    owner_name, _, repo_name = orbit.repo_full_name.partition("/")
    if not owner_name or not repo_name:
        return None
    installation = None
    owner_user = db.get(User, orbit.created_by_user_id)
    if owner_user is not None:
        installation = ensure_installation_for_user(db, owner_user, touch=touch_installation)
    repository = upsert_repository_connection(
        db,
        installation=installation,
        repo_payload={
            "owner_name": owner_name,
            "repo_name": repo_name,
            "full_name": orbit.repo_full_name,
            "html_url": orbit.repo_url,
            "private": orbit.repo_private,
            "default_branch": orbit.default_branch,
        },
        refresh_existing=refresh_repository,
    )
    binding = bind_repository_to_orbit(
        db,
        orbit=orbit,
        repository=repository,
        added_by_user_id=orbit.created_by_user_id,
        make_primary=True,
    )
    return repository, binding


def ensure_repo_grant(
    db: Session,
    *,
    orbit_id: str,
    repository_connection_id: str,
    user_id: str,
    grant_level: str,
) -> RepoGrant:
    grant = db.scalar(
        select(RepoGrant).where(
            RepoGrant.orbit_id == orbit_id,
            RepoGrant.repository_connection_id == repository_connection_id,
            RepoGrant.user_id == user_id,
        )
    )
    if grant is None:
        grant = RepoGrant(
            orbit_id=orbit_id,
            repository_connection_id=repository_connection_id,
            user_id=user_id,
            grant_level=grant_level,
        )
        db.add(grant)
        db.flush()
    else:
        grant.grant_level = grant_level
    return grant


def _first_repository_id_for_work_item(db: Session, work_item: WorkItem | None) -> str | None:
    if work_item is None:
        return None
    repository_ids = repository_ids_for_work_item(db, work_item)
    return repository_ids[0] if repository_ids else None


def ensure_notification_preference(db: Session, *, user_id: str) -> NotificationPreference:
    preference = db.scalar(select(NotificationPreference).where(NotificationPreference.user_id == user_id))
    if preference is None:
        preference = NotificationPreference(user_id=user_id)
        db.add(preference)
        db.flush()
    return preference


def conversation_state_for_user(
    db: Session,
    *,
    user_id: str,
    orbit_id: str,
    channel_id: str | None = None,
    dm_thread_id: str | None = None,
    create: bool = False,
) -> ConversationState | None:
    state = db.scalar(
        select(ConversationState).where(
            ConversationState.user_id == user_id,
            ConversationState.orbit_id == orbit_id,
            ConversationState.channel_id == channel_id,
            ConversationState.dm_thread_id == dm_thread_id,
        )
    )
    if state is None and create:
        state = ConversationState(
            user_id=user_id,
            orbit_id=orbit_id,
            channel_id=channel_id,
            dm_thread_id=dm_thread_id,
            notification_mode="all_activity" if dm_thread_id else "mentions_only",
        )
        db.add(state)
        db.flush()
    return state


def _trim_notification_detail(text: str, *, limit: int = 220) -> str:
    collapsed = " ".join(text.split())
    if len(collapsed) <= limit:
        return collapsed
    return f"{collapsed[: limit - 1].rstrip()}…"


def upsert_notification(
    db: Session,
    *,
    user_id: str,
    orbit_id: str | None,
    kind: str,
    title: str,
    detail: str,
    source_kind: str,
    source_id: str,
    channel_id: str | None = None,
    dm_thread_id: str | None = None,
    metadata_json: dict[str, Any] | None = None,
    unread: bool = True,
) -> Notification:
    notification = db.scalar(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.source_kind == source_kind,
            Notification.source_id == source_id,
        )
    )
    if notification is None:
        notification = Notification(
            user_id=user_id,
            orbit_id=orbit_id,
            channel_id=channel_id,
            dm_thread_id=dm_thread_id,
            kind=kind,
            title=title,
            detail=detail,
            status="unread" if unread else "read",
            source_kind=source_kind,
            source_id=source_id,
            metadata_json=metadata_json or {},
            read_at=None if unread else utc_now(),
        )
        db.add(notification)
        db.flush()
        return notification
    notification.orbit_id = orbit_id
    notification.channel_id = channel_id
    notification.dm_thread_id = dm_thread_id
    notification.kind = kind
    notification.title = title
    notification.detail = detail
    notification.metadata_json = metadata_json or {}
    notification.status = "unread" if unread else "read"
    notification.read_at = None if unread else utc_now()
    return notification


def mark_conversation_seen(
    db: Session,
    *,
    user_id: str,
    orbit_id: str,
    channel_id: str | None = None,
    dm_thread_id: str | None = None,
    last_seen_message_id: str | None = None,
) -> None:
    state = conversation_state_for_user(
        db,
        user_id=user_id,
        orbit_id=orbit_id,
        channel_id=channel_id,
        dm_thread_id=dm_thread_id,
        create=True,
    )
    if state is not None:
        state.last_read_at = utc_now()
        state.last_seen_message_id = last_seen_message_id or state.last_seen_message_id
        state.updated_at = utc_now()
    notifications = db.scalars(
        select(Notification).where(
            Notification.user_id == user_id,
            Notification.orbit_id == orbit_id,
            Notification.channel_id == channel_id,
            Notification.dm_thread_id == dm_thread_id,
            Notification.status == "unread",
        )
    ).all()
    read_at = utc_now()
    for notification in notifications:
        notification.status = "read"
        notification.read_at = read_at


def create_message_notifications(
    db: Session,
    *,
    orbit: Orbit,
    author_user_id: str | None,
    author_name: str,
    message_id: str,
    body: str,
    channel_id: str | None = None,
    channel_name: str | None = None,
    dm_thread_id: str | None = None,
) -> None:
    if dm_thread_id:
        participants = db.scalars(select(DmParticipant).where(DmParticipant.thread_id == dm_thread_id)).all()
        for participant in participants:
            if participant.user_id == author_user_id:
                continue
            state = conversation_state_for_user(
                db,
                user_id=participant.user_id,
                orbit_id=orbit.id,
                dm_thread_id=dm_thread_id,
                create=True,
            )
            if state is not None and state.notification_mode == "mute":
                continue
            upsert_notification(
                db,
                user_id=participant.user_id,
                orbit_id=orbit.id,
                dm_thread_id=dm_thread_id,
                kind="dm",
                title=f"New DM from {author_name}",
                detail=_trim_notification_detail(body),
                source_kind="dm_message",
                source_id=message_id,
                metadata_json={"author_name": author_name},
            )
        return

    handles = {match.group(1).lower() for match in _MENTION_PATTERN.finditer(body)}
    memberships = db.scalars(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit.id)).all()
    users = {membership.user_id: db.get(User, membership.user_id) for membership in memberships}
    for membership in memberships:
        if membership.user_id == author_user_id:
            continue
        state = conversation_state_for_user(
            db,
            user_id=membership.user_id,
            orbit_id=orbit.id,
            channel_id=channel_id,
            create=True,
        )
        if state is not None and state.notification_mode == "mute":
            continue
        target_user = users.get(membership.user_id)
        if target_user is None:
            continue
        target_login = str(target_user.github_login or "").lower()
        mentioned = bool(target_login) and target_login in handles
        notify_all = state is not None and state.notification_mode == "all_activity"
        if not mentioned and not notify_all:
            continue
        kind = "mention" if mentioned else "channel_activity"
        title = f"Mention in #{channel_name}" if mentioned and channel_name else f"Activity in #{channel_name or 'channel'}"
        upsert_notification(
            db,
            user_id=membership.user_id,
            orbit_id=orbit.id,
            channel_id=channel_id,
            kind=kind,
            title=title,
            detail=_trim_notification_detail(body),
            source_kind=kind,
            source_id=message_id,
            metadata_json={"author_name": author_name},
        )


def upsert_artifact(
    db: Session,
    *,
    orbit_id: str,
    repository_connection_id: str | None,
    work_item_id: str | None,
    workflow_run_id: str | None,
    source_kind: str,
    source_id: str,
    artifact_kind: str,
    title: str,
    summary: str | None,
    status: str,
    external_url: str | None,
    metadata_json: dict[str, Any] | None = None,
) -> Artifact:
    artifact = db.scalar(
        select(Artifact).where(
            Artifact.orbit_id == orbit_id,
            Artifact.source_kind == source_kind,
            Artifact.source_id == source_id,
        )
    )
    if artifact is None:
        artifact = Artifact(
            orbit_id=orbit_id,
            repository_connection_id=repository_connection_id,
            work_item_id=work_item_id,
            workflow_run_id=workflow_run_id,
            source_kind=source_kind,
            source_id=source_id,
            artifact_kind=artifact_kind,
            title=title,
            summary=summary,
            status=status,
            external_url=external_url,
            metadata_json=metadata_json or {},
        )
        db.add(artifact)
        db.flush()
        return artifact
    artifact.repository_connection_id = repository_connection_id
    artifact.work_item_id = work_item_id
    artifact.workflow_run_id = workflow_run_id
    artifact.artifact_kind = artifact_kind
    artifact.title = title
    artifact.summary = summary
    artifact.status = status
    artifact.external_url = external_url
    artifact.metadata_json = metadata_json or {}
    artifact.updated_at = utc_now()
    return artifact


def notify_artifact_generated(
    db: Session,
    *,
    orbit: Orbit,
    artifact: Artifact,
    triggered_by_user_id: str | None,
) -> None:
    recipient_ids: set[str] = set()
    if artifact.work_item_id:
        work_item = db.get(WorkItem, artifact.work_item_id)
        if work_item is not None:
            recipient_ids.add(work_item.requested_by_user_id)
    if triggered_by_user_id:
        recipient_ids.add(triggered_by_user_id)
    if not recipient_ids:
        recipient_ids.add(orbit.created_by_user_id)
    repo_ids = [artifact.repository_connection_id] if artifact.repository_connection_id else []
    for recipient_id in recipient_ids:
        upsert_notification(
            db,
            user_id=recipient_id,
            orbit_id=orbit.id,
            kind="artifact",
            title=artifact.title,
            detail=artifact.summary or "A new artifact is ready to review.",
            source_kind="artifact",
            source_id=artifact.id,
            metadata_json={
                "artifact_kind": artifact.artifact_kind,
                "artifact_id": artifact.id,
                "repository_ids": repo_ids,
                "workflow_run_id": artifact.workflow_run_id,
            },
        )


def artifacts_for_orbit(db: Session, *, orbit_id: str) -> list[Artifact]:
    return db.scalars(select(Artifact).where(Artifact.orbit_id == orbit_id).order_by(Artifact.updated_at.desc(), Artifact.created_at.desc())).all()


def notify_run_status_transition(
    db: Session,
    *,
    orbit: Orbit,
    work_item: WorkItem | None,
    workflow_run_id: str,
    previous_status: str | None,
    next_status: str,
    summary: str | None,
    repository_ids: list[str],
    channel_id: str | None,
    dm_thread_id: str | None,
) -> None:
    normalized_next = str(next_status or "").lower()
    normalized_previous = str(previous_status or "").lower()
    if normalized_next not in {"completed", "failed"} or normalized_previous == normalized_next:
        return
    recipient_ids: set[str] = set()
    if work_item is not None:
        recipient_ids.add(work_item.requested_by_user_id)
    if not recipient_ids:
        recipient_ids.add(orbit.created_by_user_id)
    kind = "run_failed" if normalized_next == "failed" else "run_completed"
    title = "ERGO run failed" if normalized_next == "failed" else "ERGO run completed"
    detail = summary or ("A run needs attention." if normalized_next == "failed" else "A run finished successfully.")
    for recipient_id in recipient_ids:
        upsert_notification(
            db,
            user_id=recipient_id,
            orbit_id=orbit.id,
            channel_id=channel_id,
            dm_thread_id=dm_thread_id,
            kind=kind,
            title=title,
            detail=detail,
            source_kind="workflow_run_status",
            source_id=f"{workflow_run_id}:{normalized_next}",
            metadata_json={"workflow_run_id": workflow_run_id, "repository_ids": repository_ids},
        )


def backfill_product_models(db: Session) -> None:
    orbits = db.scalars(select(Orbit).order_by(Orbit.created_at)).all()
    for orbit in orbits:
        binding = ensure_primary_repo_binding(db, orbit)
        repository = binding[0] if binding is not None else None
        work_items = db.scalars(select(WorkItem).where(WorkItem.orbit_id == orbit.id)).all()
        work_items_by_id = {item.id: item for item in work_items}
        for work_item in work_items:
            if repository is not None:
                ensure_work_item_repo_scope(db, work_item=work_item, repository_connection_id=repository.id)
            if repository is not None and work_item.workflow_run_id:
                ensure_run_repo_scope(
                    db,
                    orbit_id=orbit.id,
                    workflow_run_id=work_item.workflow_run_id,
                    repository_connection_id=repository.id,
                )
            if work_item.draft_pr_url:
                artifact_repository_id = _first_repository_id_for_work_item(db, work_item)
                upsert_artifact(
                    db,
                    orbit_id=orbit.id,
                    repository_connection_id=artifact_repository_id,
                    work_item_id=work_item.id,
                    workflow_run_id=work_item.workflow_run_id,
                    source_kind="work_item",
                    source_id=work_item.id,
                    artifact_kind="draft_pr",
                    title=f"Draft PR · {work_item.title}",
                    summary=work_item.summary or "Draft pull request prepared for ERGO work.",
                    status="ready",
                    external_url=work_item.draft_pr_url,
                    metadata_json={"branch_name": work_item.branch_name},
                )
        memberships = db.scalars(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit.id)).all()
        for membership in memberships:
            ensure_notification_preference(db, user_id=membership.user_id)
            normalized_role = normalize_orbit_role(membership.role)
            if repository is not None and normalized_role == "owner":
                ensure_repo_grant(
                    db,
                    orbit_id=orbit.id,
                    repository_connection_id=repository.id,
                    user_id=membership.user_id,
                    grant_level=REPO_GRANT_ADMIN,
                )
            elif repository is not None and normalized_role == "manager":
                ensure_repo_grant(
                    db,
                    orbit_id=orbit.id,
                    repository_connection_id=repository.id,
                    user_id=membership.user_id,
                    grant_level=REPO_GRANT_VIEW,
                )
            elif repository is not None and normalized_role in {ORBIT_ROLE_CONTRIBUTOR, "member"}:
                ensure_repo_grant(
                    db,
                    orbit_id=orbit.id,
                    repository_connection_id=repository.id,
                    user_id=membership.user_id,
                    grant_level=REPO_GRANT_VIEW,
                )
        if repository is not None:
            prs = db.scalars(select(PullRequestSnapshot).where(PullRequestSnapshot.orbit_id == orbit.id)).all()
            for item in prs:
                item.repository_connection_id = item.repository_connection_id or repository.id
            issues = db.scalars(select(IssueSnapshot).where(IssueSnapshot.orbit_id == orbit.id)).all()
            for item in issues:
                item.repository_connection_id = item.repository_connection_id or repository.id
            codespaces = db.scalars(select(Codespace).where(Codespace.orbit_id == orbit.id)).all()
            for item in codespaces:
                item.repository_connection_id = item.repository_connection_id or repository.id
            demos = db.scalars(select(Demo).where(Demo.orbit_id == orbit.id)).all()
            for demo in demos:
                demo.repository_connection_id = demo.repository_connection_id or repository.id
                linked_work_item = work_items_by_id.get(demo.work_item_id) if demo.work_item_id else None
                upsert_artifact(
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
    db.flush()


def repositories_for_orbit(db: Session, orbit_id: str) -> list[tuple[RepositoryConnection, OrbitRepositoryBinding]]:
    bindings = db.scalars(
        select(OrbitRepositoryBinding)
        .where(OrbitRepositoryBinding.orbit_id == orbit_id, OrbitRepositoryBinding.status == "active")
        .order_by(OrbitRepositoryBinding.is_primary.desc(), OrbitRepositoryBinding.created_at)
    ).all()
    repositories: list[tuple[RepositoryConnection, OrbitRepositoryBinding]] = []
    for binding in bindings:
        repository = db.get(RepositoryConnection, binding.repository_connection_id)
        if repository is not None:
            repositories.append((repository, binding))
    return repositories


def primary_repository_for_orbit(db: Session, orbit: Orbit) -> RepositoryConnection | None:
    binding = db.scalar(
        select(OrbitRepositoryBinding).where(
            OrbitRepositoryBinding.orbit_id == orbit.id,
            OrbitRepositoryBinding.is_primary.is_(True),
            OrbitRepositoryBinding.status == "active",
        )
    )
    if binding is None:
        bound = ensure_primary_repo_binding(db, orbit)
        if bound is None:
            return None
        return bound[0]
    return db.get(RepositoryConnection, binding.repository_connection_id)


def ensure_work_item_repo_scope(db: Session, *, work_item: WorkItem, repository_connection_id: str) -> WorkItemRepoScope:
    scope = db.scalar(
        select(WorkItemRepoScope).where(
            WorkItemRepoScope.work_item_id == work_item.id,
            WorkItemRepoScope.repository_connection_id == repository_connection_id,
        )
    )
    if scope is None:
        scope = WorkItemRepoScope(work_item_id=work_item.id, repository_connection_id=repository_connection_id)
        db.add(scope)
        db.flush()
    return scope


def ensure_run_repo_scope(
    db: Session,
    *,
    orbit_id: str,
    workflow_run_id: str,
    repository_connection_id: str,
) -> RunRepoScope:
    scope = db.scalar(
        select(RunRepoScope).where(
            RunRepoScope.workflow_run_id == workflow_run_id,
            RunRepoScope.repository_connection_id == repository_connection_id,
        )
    )
    if scope is None:
        scope = RunRepoScope(
            orbit_id=orbit_id,
            workflow_run_id=workflow_run_id,
            repository_connection_id=repository_connection_id,
        )
        db.add(scope)
        db.flush()
    return scope


def repository_ids_for_work_item(db: Session, work_item: WorkItem) -> list[str]:
    scopes = db.scalars(
        select(WorkItemRepoScope).where(WorkItemRepoScope.work_item_id == work_item.id).order_by(WorkItemRepoScope.created_at)
    ).all()
    return [scope.repository_connection_id for scope in scopes]


def repository_ids_for_run(db: Session, workflow_run_id: str) -> list[str]:
    scopes = db.scalars(
        select(RunRepoScope).where(RunRepoScope.workflow_run_id == workflow_run_id).order_by(RunRepoScope.created_at)
    ).all()
    return [scope.repository_connection_id for scope in scopes]


def permission_snapshot_for_user(db: Session, *, orbit_id: str, user_id: str) -> OrbitPermissionSnapshot:
    membership = db.scalar(
        select(OrbitMembership).where(OrbitMembership.orbit_id == orbit_id, OrbitMembership.user_id == user_id)
    )
    orbit_role = normalize_orbit_role(membership.role if membership else "viewer")
    grants = db.scalars(
        select(RepoGrant).where(RepoGrant.orbit_id == orbit_id, RepoGrant.user_id == user_id)
    ).all()
    return OrbitPermissionSnapshot(
        orbit_role=orbit_role,
        repo_grants={grant.repository_connection_id: grant.grant_level for grant in grants},
    )


def _upsert_row(
    db: Session,
    *,
    table,
    values: dict[str, Any],
    index_columns: list[str],
    update_columns: list[str],
) -> None:
    dialect_name = db.bind.dialect.name if db.bind is not None else ""
    if dialect_name == "postgresql":
        insert_stmt = postgresql_insert(table).values(**values)
    elif dialect_name == "sqlite":
        insert_stmt = sqlite_insert(table).values(**values)
    else:
        raise RuntimeError(f"Unsupported SQL dialect for upsert: {dialect_name or 'unknown'}")
    db.execute(
        insert_stmt.on_conflict_do_update(
            index_elements=index_columns,
            set_={column: getattr(insert_stmt.excluded, column) for column in update_columns},
        )
    )


def _upsert_runtime_run_projection(
    db: Session,
    *,
    orbit_id: str,
    workflow_run_id: str,
    values: dict[str, Any],
) -> RuntimeRunProjection:
    timestamp = utc_now()
    row_values = {
        "id": values.get("id") or generate_id("runview"),
        "orbit_id": orbit_id,
        "workflow_run_id": workflow_run_id,
        "created_at": values.get("created_at") or timestamp,
        "updated_at": timestamp,
        **{key: value for key, value in values.items() if key not in {"id", "orbit_id", "workflow_run_id", "created_at", "updated_at"}},
    }
    _upsert_row(
        db,
        table=RuntimeRunProjection.__table__,
        values=row_values,
        index_columns=["orbit_id", "workflow_run_id"],
        update_columns=[
            "work_item_id",
            "source_channel_id",
            "source_dm_thread_id",
            "title",
            "status",
            "operator_status",
            "execution_status",
            "summary",
            "snapshot_json",
            "updated_at",
        ],
    )
    return db.scalar(
        select(RuntimeRunProjection).where(
            RuntimeRunProjection.orbit_id == orbit_id,
            RuntimeRunProjection.workflow_run_id == workflow_run_id,
        )
    )


def sync_runtime_projection(db: Session, *, orbit: Orbit, workflow_snapshot: dict[str, Any]) -> None:
    runs = workflow_snapshot.get("runs")
    if not isinstance(runs, list):
        return
    run_ids_seen: set[str] = set()
    open_request_ids: set[str] = set()

    work_items = db.scalars(select(WorkItem).where(WorkItem.orbit_id == orbit.id)).all()
    work_items_by_run = {item.workflow_run_id: item for item in work_items if item.workflow_run_id}

    for run in runs:
        if not isinstance(run, dict):
            continue
        workflow_run_id = str(run.get("id") or "").strip()
        if not workflow_run_id:
            continue
        run_ids_seen.add(workflow_run_id)
        work_item = work_items_by_run.get(workflow_run_id)
        existing_projection = db.scalar(
            select(RuntimeRunProjection).where(
                RuntimeRunProjection.orbit_id == orbit.id,
                RuntimeRunProjection.workflow_run_id == workflow_run_id,
            )
        )
        previous_status = existing_projection.status if existing_projection is not None else None
        projection = _upsert_runtime_run_projection(
            db,
            orbit_id=orbit.id,
            workflow_run_id=workflow_run_id,
            values={
                "work_item_id": work_item.id if work_item else None,
                "source_channel_id": work_item.source_channel_id if work_item else None,
                "source_dm_thread_id": work_item.source_dm_thread_id if work_item else None,
                "title": str(run.get("title") or workflow_run_id),
                "status": str(run.get("status") or "created"),
                "operator_status": str(run.get("operator_status") or ""),
                "execution_status": str(run.get("execution_status") or ""),
                "summary": str(run.get("operator_summary") or run.get("execution_summary") or ""),
                "snapshot_json": run,
            },
        )
        if projection is None:
            continue

        repository_ids = repository_ids_for_work_item(db, work_item) if work_item else []
        for repository_id in repository_ids:
            ensure_run_repo_scope(
                db,
                orbit_id=orbit.id,
                workflow_run_id=workflow_run_id,
                repository_connection_id=repository_id,
            )
        notify_run_status_transition(
            db,
            orbit=orbit,
            work_item=work_item,
            workflow_run_id=workflow_run_id,
            previous_status=previous_status,
            next_status=str(run.get("status") or "created"),
            summary=str(run.get("operator_summary") or run.get("execution_summary") or ""),
            repository_ids=repository_ids,
            channel_id=projection.source_channel_id,
            dm_thread_id=projection.source_dm_thread_id,
        )

        for item in _upsert_human_loop_items(
            db,
            orbit=orbit,
            run_payload=run,
            projection=projection,
            work_item=work_item,
            repository_ids=repository_ids,
        ):
            if item.status in {"open", "requested"}:
                open_request_ids.add(item.request_id)

    stale_items = db.scalars(
        select(RuntimeHumanLoopItem).where(
            RuntimeHumanLoopItem.orbit_id == orbit.id,
        )
    ).all()
    for stale_item in stale_items:
        if stale_item.request_id in open_request_ids:
            continue
        if stale_item.status not in {"answered", "approved", "rejected", "cancelled"}:
            stale_item.status = "resolved"
            stale_item.resolved_at = stale_item.resolved_at or stale_item.updated_at


def _upsert_human_loop_items(
    db: Session,
    *,
    orbit: Orbit,
    run_payload: dict[str, Any],
    projection: RuntimeRunProjection,
    work_item: WorkItem | None,
    repository_ids: list[str],
) -> list[RuntimeHumanLoopItem]:
    items: list[RuntimeHumanLoopItem] = []
    request_groups = (
        ("clarification", run_payload.get("human_requests", [])),
        ("approval", run_payload.get("approval_requests", [])),
    )
    for request_kind, requests in request_groups:
        if not isinstance(requests, list):
            continue
        for request in requests:
            if not isinstance(request, dict):
                continue
            request_id = str(request.get("id") or "").strip()
            if not request_id:
                continue
            detail = str(request.get("question") or request.get("reason") or "").strip()
            status = str(request.get("status") or "open").strip().lower() or "open"
            item = db.scalar(
                select(RuntimeHumanLoopItem).where(
                    RuntimeHumanLoopItem.orbit_id == orbit.id,
                    RuntimeHumanLoopItem.request_id == request_id,
                )
            )
            title = "Clarification needed" if request_kind == "clarification" else "Approval required"
            if item is None:
                item = RuntimeHumanLoopItem(
                    orbit_id=orbit.id,
                    workflow_run_id=projection.workflow_run_id,
                    work_item_id=work_item.id if work_item else None,
                    request_kind=request_kind,
                    request_id=request_id,
                    task_id=str(request.get("task_id") or "") or None,
                    task_key=str(request.get("task_key") or "") or None,
                    source_channel_id=projection.source_channel_id,
                    source_dm_thread_id=projection.source_dm_thread_id,
                    status=status,
                    title=title,
                    detail=detail,
                    response_text=str(request.get("answer_text") or "") or None,
                    metadata_json={
                        "workflow_run_id": projection.workflow_run_id,
                        "repository_ids": repository_ids,
                    },
                )
                db.add(item)
                db.flush()
            else:
                item.workflow_run_id = projection.workflow_run_id
                item.work_item_id = work_item.id if work_item else item.work_item_id
                item.task_id = str(request.get("task_id") or "") or item.task_id
                item.task_key = str(request.get("task_key") or "") or item.task_key
                item.source_channel_id = projection.source_channel_id
                item.source_dm_thread_id = projection.source_dm_thread_id
                item.status = status
                item.title = title
                item.detail = detail
                item.response_text = str(request.get("answer_text") or "") or item.response_text
                item.metadata_json = {
                    **(item.metadata_json or {}),
                    "workflow_run_id": projection.workflow_run_id,
                    "repository_ids": repository_ids,
                }
            if status in {"answered", "approved", "rejected", "cancelled", "resolved"}:
                item.resolved_at = item.resolved_at or item.updated_at
            _sync_notifications_for_human_loop_item(
                db,
                orbit=orbit,
                item=item,
                repository_ids=repository_ids,
            )
            items.append(item)
    return items


def _sync_notifications_for_human_loop_item(
    db: Session,
    *,
    orbit: Orbit,
    item: RuntimeHumanLoopItem,
    repository_ids: list[str],
) -> None:
    recipients: set[str] = set()
    if item.work_item_id:
        work_item = db.get(WorkItem, item.work_item_id)
        if work_item is not None:
            recipients.add(work_item.requested_by_user_id)
    memberships = db.scalars(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit.id)).all()
    for membership in memberships:
        normalized_role = normalize_orbit_role(membership.role)
        if item.request_kind == "approval":
            if normalized_role in {"owner", "manager"}:
                recipients.add(membership.user_id)
        elif normalized_role in {"owner", "manager", ORBIT_ROLE_CONTRIBUTOR}:
            recipients.add(membership.user_id)

    for recipient_id in recipients:
        notification = db.scalar(
            select(Notification).where(
                Notification.user_id == recipient_id,
                Notification.source_kind == item.request_kind,
                Notification.source_id == item.request_id,
            )
        )
        title = item.title
        detail = item.detail
        if notification is None:
            notification = Notification(
                user_id=recipient_id,
                orbit_id=orbit.id,
                channel_id=item.source_channel_id,
                dm_thread_id=item.source_dm_thread_id,
                kind=item.request_kind,
                title=title,
                detail=detail,
                status="unread" if item.status in {"open", "requested"} else "read",
                source_kind=item.request_kind,
                source_id=item.request_id,
                metadata_json={"repository_ids": repository_ids, "workflow_run_id": item.workflow_run_id},
            )
            db.add(notification)
            db.flush()
        else:
            notification.channel_id = item.source_channel_id
            notification.dm_thread_id = item.source_dm_thread_id
            notification.kind = item.request_kind
            notification.title = title
            notification.detail = detail
            notification.metadata_json = {"repository_ids": repository_ids, "workflow_run_id": item.workflow_run_id}
            if item.status in {"open", "requested"}:
                notification.status = "unread"
                notification.read_at = None
            else:
                notification.status = "read"
                notification.read_at = notification.read_at or utc_now()


def human_loop_items_for_conversation(
    db: Session,
    *,
    orbit_id: str,
    channel_id: str | None = None,
    dm_thread_id: str | None = None,
) -> list[RuntimeHumanLoopItem]:
    statement = select(RuntimeHumanLoopItem).where(RuntimeHumanLoopItem.orbit_id == orbit_id)
    if channel_id is not None:
        statement = statement.where(RuntimeHumanLoopItem.source_channel_id == channel_id)
    if dm_thread_id is not None:
        statement = statement.where(RuntimeHumanLoopItem.source_dm_thread_id == dm_thread_id)
    return db.scalars(statement.order_by(RuntimeHumanLoopItem.created_at, RuntimeHumanLoopItem.id)).all()


def notifications_for_user(db: Session, *, user_id: str, orbit_id: str | None = None) -> list[Notification]:
    statement = select(Notification).where(Notification.user_id == user_id).order_by(Notification.created_at.desc())
    if orbit_id is not None:
        statement = statement.where(Notification.orbit_id == orbit_id)
    notifications = db.scalars(statement).all()
    notifications.sort(key=lambda item: (item.status != "unread", -(item.created_at.timestamp() if item.created_at else 0)))
    return notifications


def runtime_human_loop_item_for_request(
    db: Session,
    *,
    orbit_id: str,
    workflow_run_id: str,
    request_id: str,
    request_kind: str,
) -> RuntimeHumanLoopItem | None:
    return db.scalar(
        select(RuntimeHumanLoopItem).where(
            RuntimeHumanLoopItem.orbit_id == orbit_id,
            RuntimeHumanLoopItem.workflow_run_id == workflow_run_id,
            RuntimeHumanLoopItem.request_id == request_id,
            RuntimeHumanLoopItem.request_kind == request_kind,
        )
    )


def record_human_loop_submission(
    db: Session,
    *,
    orbit: Orbit,
    item: RuntimeHumanLoopItem,
    actor_user_id: str | None,
    answer_text: str | None = None,
    approved: bool | None = None,
) -> dict[str, Any]:
    submitted_at = utc_now()
    metadata = dict(item.metadata_json or {})
    if item.request_kind == "clarification":
        next_status = "answered"
        item.response_text = answer_text
        receipt = {
            "request_kind": item.request_kind,
            "workflow_run_id": item.workflow_run_id,
            "request_id": item.request_id,
            "status": next_status,
            "response_text": answer_text,
            "approved": None,
            "actor_user_id": actor_user_id,
            "submitted_at": submitted_at.isoformat(),
        }
    else:
        next_status = "approved" if approved else "rejected"
        receipt = {
            "request_kind": item.request_kind,
            "workflow_run_id": item.workflow_run_id,
            "request_id": item.request_id,
            "status": next_status,
            "response_text": None,
            "approved": approved,
            "actor_user_id": actor_user_id,
            "submitted_at": submitted_at.isoformat(),
        }
    metadata["submission_receipt"] = receipt
    item.status = next_status
    item.resolved_at = submitted_at
    item.updated_at = submitted_at
    item.metadata_json = metadata
    _sync_notifications_for_human_loop_item(
        db,
        orbit=orbit,
        item=item,
        repository_ids=[str(value) for value in metadata.get("repository_ids", []) if str(value).strip()],
    )
    return receipt


def human_loop_submission_receipt(item: RuntimeHumanLoopItem | None) -> dict[str, Any] | None:
    if item is None:
        return None
    metadata = item.metadata_json or {}
    receipt = metadata.get("submission_receipt")
    return receipt if isinstance(receipt, dict) else None


def serialize_permission_snapshot(snapshot: OrbitPermissionSnapshot) -> dict[str, Any]:
    return {
        "orbit_role": snapshot.orbit_role,
        "repo_grants": snapshot.repo_grants,
        "can_manage_members": snapshot.can_manage_members(),
        "can_manage_roles": snapshot.can_manage_roles(),
        "can_manage_settings": snapshot.can_manage_settings(),
        "can_manage_integrations": snapshot.can_manage_integrations(),
        "can_bind_repo": snapshot.can_bind_repo(),
        "can_publish_artifact": snapshot.can_publish_artifact(),
    }


def clear_notifications_for_sources(db: Session, *, orbit_id: str, source_kind: str, source_ids: set[str]) -> None:
    if not source_ids:
        return
    db.execute(
        delete(Notification).where(
            Notification.orbit_id == orbit_id,
            Notification.source_kind == source_kind,
            Notification.source_id.in_(source_ids),
        )
    )
