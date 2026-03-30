from __future__ import annotations

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
from sqlalchemy.orm import Session

from autoweave_web.core.settings import Settings, get_settings
from autoweave_web.db.session import get_db, init_database, utc_now
from autoweave_web.models.entities import (
    Channel,
    Codespace,
    Demo,
    DmParticipant,
    DmThread,
    IssueSnapshot,
    Message,
    NavigationState,
    Orbit,
    OrbitInvite,
    OrbitMembership,
    PullRequestSnapshot,
    SessionToken,
    User,
    WorkItem,
)
from autoweave_web.schemas.api import (
    CodespaceCreateRequest,
    DashboardPayload,
    DemoPublishRequest,
    DmMessageCreateRequest,
    GitHubTokenLoginRequest,
    InviteRequest,
    MessageCreateRequest,
    NavigationStateRequest,
    OrbitCreateRequest,
    OrbitPayload,
    SessionPayload,
    WorkflowApprovalRequest,
    WorkflowHumanAnswerRequest,
)
from autoweave_web.services.containers import ContainerOrchestrator
from autoweave_web.services.context import ingest_product_event
from autoweave_web.services.github import GitHubGateway
from autoweave_web.services.navigation import NavigationStore
from autoweave_web.services.runtime import RuntimeManager, slugify


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
    runtime_manager = runtime_manager or RuntimeManager(settings)
    navigation = navigation or NavigationStore(settings.redis_url, ttl_seconds=settings.navigation_ttl_seconds)
    containers = containers or ContainerOrchestrator(settings)

    app.state.settings = settings
    app.state.github = github
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

    def _serialize_message(message: Message) -> dict[str, Any]:
        return {
            "id": message.id,
            "author_kind": message.author_kind,
            "author_name": message.author_name,
            "body": message.body,
            "metadata": message.metadata_json,
            "created_at": message.created_at.isoformat(),
        }

    def _serialize_codespace(item: Codespace) -> dict[str, Any]:
        return {
            "id": item.id,
            "name": item.name,
            "branch_name": item.branch_name,
            "workspace_path": item.workspace_path,
            "status": item.status,
            "editor_url": item.editor_url,
        }

    def _serialize_demo(item: Demo) -> dict[str, Any]:
        return {
            "id": item.id,
            "title": item.title,
            "source_path": item.source_path,
            "status": item.status,
            "url": item.url,
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

    def _orbit_dm_thread(db: Session, orbit_id: str, thread_id: str) -> DmThread:
        thread = db.scalar(select(DmThread).where(DmThread.id == thread_id, DmThread.orbit_id == orbit_id))
        if thread is None:
            raise HTTPException(status_code=404, detail="DM thread not found")
        return thread

    def _unique_orbit_slug(db: Session, name: str) -> str:
        base_slug = slugify(name)
        candidate = base_slug
        suffix = 2
        while db.scalar(select(Orbit).where(Orbit.slug == candidate)) is not None:
            candidate = f"{base_slug}-{suffix}"
            suffix += 1
        return candidate

    def _ensure_default_orbit_records(db: Session, orbit: Orbit, user: User) -> None:
        general = db.scalar(select(Channel).where(Channel.orbit_id == orbit.id, Channel.slug == "general"))
        if general is None:
            general = Channel(orbit_id=orbit.id, slug="general", name="general")
            db.add(general)
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
            detail_markers = ("app", "dashboard", "api", "workflow", "landing", "frontend", "backend", "orbit", "issue", "screen")
            if not any(marker in lowered for marker in detail_markers):
                return "What should I build exactly inside this orbit?", False
            return "working on it", True
        return None, False

    def _start_work_item(db: Session, orbit: Orbit, user: User, *, request_text: str, summary: str | None) -> dict[str, Any]:
        branch_name = f"ergo/{slugify(request_text)[:40]}"
        draft_pr_url = None
        if orbit.repo_full_name:
            github.create_branch(user.access_token, orbit.repo_full_name, branch_name=branch_name, base_branch=orbit.default_branch)
            pr = github.create_draft_pull_request(
                user.access_token,
                orbit.repo_full_name,
                title=f"ERGO: {request_text[:72]}",
                head=branch_name,
                base=orbit.default_branch,
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
            summary=summary,
        )
        db.add(work_item)
        db.flush()
        workflow_result = runtime_manager.queue_workflow(orbit, request_text=request_text)
        work_item.workflow_run_id = workflow_result.get("workflow_run_id") or workflow_result.get("celery_task_id")
        work_item.updated_at = utc_now()
        return {
            "id": work_item.id,
            "status": work_item.status,
            "branch_name": work_item.branch_name,
            "draft_pr_url": work_item.draft_pr_url,
            "workflow_ref": work_item.workflow_run_id,
        }

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

    @app.get("/api/dashboard", response_model=DashboardPayload)
    def dashboard(user: User = Depends(current_user), db: Session = Depends(get_db)) -> DashboardPayload:
        orbit_ids = [membership.orbit_id for membership in db.scalars(select(OrbitMembership).where(OrbitMembership.user_id == user.id)).all()]
        orbits = db.scalars(select(Orbit).where(Orbit.id.in_(orbit_ids)).order_by(Orbit.created_at.desc())).all() if orbit_ids else []
        for orbit in orbits[:5]:
            workflow_snapshot = runtime_manager.monitoring_snapshot(orbit)
            _sync_work_items_from_snapshot(db, orbit, workflow_snapshot)
        db.commit()
        work_items = db.scalars(select(WorkItem).where(WorkItem.orbit_id.in_(orbit_ids)).order_by(WorkItem.updated_at.desc())).all() if orbit_ids else []
        codespaces = db.scalars(select(Codespace).where(Codespace.orbit_id.in_(orbit_ids)).order_by(Codespace.created_at.desc())).all() if orbit_ids else []
        demos = db.scalars(select(Demo).where(Demo.orbit_id.in_(orbit_ids)).order_by(Demo.created_at.desc())).all() if orbit_ids else []
        navigation_state = navigation.get_state(user.id) or {}
        notifications: list[dict[str, str]] = []
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
            codespaces=[_serialize_codespace(item) for item in codespaces[:6]],
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
        repo = github.create_repository(
            user.access_token,
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
        invite = OrbitInvite(orbit_id=orbit.id, invited_by_user_id=user.id, email=payload.email, token=secrets.token_urlsafe(18))
        db.add(invite)
        db.commit()
        _send_invite_email(invite, orbit)
        return {"id": invite.id, "email": invite.email, "token": invite.token, "status": invite.status}

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
            db.add(OrbitMembership(orbit_id=orbit.id, user_id=user.id, role="member", introduced=True))
        invite.status = "accepted"
        invite.accepted_at = utc_now()
        if orbit.repo_full_name:
            github.add_collaborator(user.access_token, orbit.repo_full_name, user.github_login)
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
        db.commit()
        return {"ok": True, "orbit_id": orbit.id}

    @app.get("/api/orbits/{orbit_id}", response_model=OrbitPayload)
    def get_orbit(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> OrbitPayload:
        orbit = _orbit_for_member(db, orbit_id, user)
        members = [
            {"user_id": membership.user_id, "role": membership.role}
            for membership in db.scalars(select(OrbitMembership).where(OrbitMembership.orbit_id == orbit.id)).all()
        ]
        channels = db.scalars(select(Channel).where(Channel.orbit_id == orbit.id).order_by(Channel.slug)).all()
        dms = db.scalars(select(DmThread).where(DmThread.orbit_id == orbit.id).order_by(DmThread.created_at)).all()
        general = _orbit_channel(db, orbit.id)
        messages = db.scalars(select(Message).where(Message.orbit_id == orbit.id, Message.channel_id == general.id).order_by(Message.created_at)).all()
        prs = db.scalars(select(PullRequestSnapshot).where(PullRequestSnapshot.orbit_id == orbit.id).order_by(PullRequestSnapshot.updated_at.desc())).all()
        issues = db.scalars(select(IssueSnapshot).where(IssueSnapshot.orbit_id == orbit.id).order_by(IssueSnapshot.updated_at.desc())).all()
        codespaces = db.scalars(select(Codespace).where(Codespace.orbit_id == orbit.id).order_by(Codespace.created_at.desc())).all()
        demos = db.scalars(select(Demo).where(Demo.orbit_id == orbit.id).order_by(Demo.created_at.desc())).all()
        workflow = runtime_manager.monitoring_snapshot(orbit)
        _sync_work_items_from_snapshot(db, orbit, workflow)
        db.commit()
        return OrbitPayload(
            orbit=_serialize_orbit(orbit),
            members=members,
            channels=[{"id": channel.id, "slug": channel.slug, "name": channel.name} for channel in channels],
            direct_messages=[{"id": thread.id, "title": thread.title} for thread in dms],
            messages=[_serialize_message(message) for message in messages],
            workflow=workflow,
            prs=[
                {"id": item.id, "number": item.github_number, "title": item.title, "state": item.state, "url": item.url, "priority": item.priority}
                for item in prs
            ],
            issues=[
                {"id": item.id, "number": item.github_number, "title": item.title, "state": item.state, "url": item.url, "priority": item.priority}
                for item in issues
            ],
            codespaces=[_serialize_codespace(item) for item in codespaces],
            demos=[_serialize_demo(item) for item in demos],
            navigation=navigation.get_state(user.id),
        )

    @app.get("/api/orbits/{orbit_id}/messages")
    def orbit_messages(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
        orbit = _orbit_for_member(db, orbit_id, user)
        general = _orbit_channel(db, orbit.id)
        messages = db.scalars(select(Message).where(Message.orbit_id == orbit.id, Message.channel_id == general.id).order_by(Message.created_at)).all()
        return [_serialize_message(message) for message in messages]

    @app.post("/api/orbits/{orbit_id}/messages")
    def post_orbit_message(
        orbit_id: str,
        payload: MessageCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        general = _orbit_channel(db, orbit.id)
        user_message = Message(
            orbit_id=orbit.id,
            channel_id=general.id,
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
            payload_json={"author": user.display_name, "surface": "channel"},
            db=db,
        )
        ergo_body, should_start_work = _ergo_reply_for(payload.body)
        reply = None
        if ergo_body:
            reply = Message(
                orbit_id=orbit.id,
                channel_id=general.id,
                author_kind="agent",
                author_name="ERGO",
                body=ergo_body,
            )
            db.add(reply)
        work_item_payload = None
        if should_start_work:
            work_item_payload = _start_work_item(db, orbit, user, request_text=payload.body, summary=ergo_body)
        db.commit()
        return {
            "message": _serialize_message(user_message),
            "ergo": _serialize_message(reply) if reply else None,
            "work_item": work_item_payload,
        }

    @app.post("/api/orbits/{orbit_id}/prs-issues/refresh")
    def refresh_prs_and_issues(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        if not orbit.repo_full_name:
            return {"prs": [], "issues": []}
        prs = github.list_pull_requests(user.access_token, orbit.repo_full_name)
        issues = github.list_issues(user.access_token, orbit.repo_full_name)
        db.query(PullRequestSnapshot).filter(PullRequestSnapshot.orbit_id == orbit.id).delete()
        db.query(IssueSnapshot).filter(IssueSnapshot.orbit_id == orbit.id).delete()
        for pr in prs:
            db.add(
                PullRequestSnapshot(
                    orbit_id=orbit.id,
                    github_number=pr["number"],
                    title=pr["title"],
                    state=pr["state"],
                    priority="high" if pr.get("draft") else "medium",
                    url=pr["html_url"],
                    branch_name=pr.get("head", {}).get("ref"),
                    metadata_json={"draft": pr.get("draft", False)},
                )
            )
        for issue in issues:
            if "pull_request" in issue:
                continue
            db.add(
                IssueSnapshot(
                    orbit_id=orbit.id,
                    github_number=issue["number"],
                    title=issue["title"],
                    state=issue["state"],
                    priority="high" if "bug" in {label["name"] for label in issue.get("labels", [])} else "medium",
                    url=issue["html_url"],
                    metadata_json={"labels": [label["name"] for label in issue.get("labels", [])]},
                )
            )
        db.commit()
        return {"prs": len(prs), "issues": len([item for item in issues if "pull_request" not in item])}

    @app.get("/api/orbits/{orbit_id}/workflow")
    def orbit_workflow(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        workflow = runtime_manager.monitoring_snapshot(orbit)
        _sync_work_items_from_snapshot(db, orbit, workflow)
        db.commit()
        return workflow

    @app.post("/api/orbits/{orbit_id}/workflow/human-requests/answer")
    def answer_workflow_human_request(
        orbit_id: str,
        payload: WorkflowHumanAnswerRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        receipt = runtime_manager.answer_human_request(
            orbit,
            workflow_run_id=payload.workflow_run_id,
            request_id=payload.request_id,
            answer_text=payload.answer_text,
        )
        general = _orbit_channel(db, orbit.id)
        db.add(
            Message(
                orbit_id=orbit.id,
                channel_id=general.id,
                author_kind="system",
                author_name="system",
                body=f"{user.display_name} answered an ERGO clarification request.",
                metadata_json={"workflow_run_id": payload.workflow_run_id, "request_id": payload.request_id},
            )
        )
        db.commit()
        return receipt

    @app.post("/api/orbits/{orbit_id}/workflow/approval-requests/resolve")
    def resolve_workflow_approval(
        orbit_id: str,
        payload: WorkflowApprovalRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        receipt = runtime_manager.resolve_approval_request(
            orbit,
            workflow_run_id=payload.workflow_run_id,
            request_id=payload.request_id,
            approved=payload.approved,
        )
        general = _orbit_channel(db, orbit.id)
        db.add(
            Message(
                orbit_id=orbit.id,
                channel_id=general.id,
                author_kind="system",
                author_name="system",
                body=f"{user.display_name} {'approved' if payload.approved else 'rejected'} an ERGO release signoff.",
                metadata_json={"workflow_run_id": payload.workflow_run_id, "request_id": payload.request_id},
            )
        )
        db.commit()
        return receipt

    @app.get("/api/orbits/{orbit_id}/dms")
    def orbit_dms(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
        orbit = _orbit_for_member(db, orbit_id, user)
        threads = db.scalars(select(DmThread).where(DmThread.orbit_id == orbit.id).order_by(DmThread.created_at)).all()
        return [{"id": thread.id, "title": thread.title} for thread in threads]

    @app.get("/api/orbits/{orbit_id}/dms/{thread_id}")
    def orbit_dm_messages(orbit_id: str, thread_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        thread = _orbit_dm_thread(db, orbit.id, thread_id)
        messages = db.scalars(
            select(Message).where(Message.orbit_id == orbit.id, Message.dm_thread_id == thread.id).order_by(Message.created_at)
        ).all()
        return {
            "thread": {"id": thread.id, "title": thread.title},
            "messages": [_serialize_message(message) for message in messages],
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
            work_item_payload = _start_work_item(db, orbit, user, request_text=payload.body, summary=ergo_body)
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
        return [_serialize_codespace(item) for item in items]

    @app.post("/api/orbits/{orbit_id}/codespaces")
    def create_codespace(
        orbit_id: str,
        payload: CodespaceCreateRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        branch_name = payload.branch_name or f"codespace/{slugify(payload.name)}"
        if orbit.repo_full_name:
            github.create_branch(user.access_token, orbit.repo_full_name, branch_name=branch_name, base_branch=orbit.default_branch)
        relative_path = f"orbits/{orbit.slug}/codespaces/{slugify(payload.name)}"
        workspace_path = runtime_manager.settings.runtime_root / relative_path
        clone_url = None
        if orbit.repo_full_name:
            clone_url = f"https://x-access-token:{user.access_token}@github.com/{orbit.repo_full_name}.git"
        containers.ensure_workspace_clone(orbit=orbit, workspace_path=workspace_path, branch_name=branch_name, clone_url=clone_url)
        codespace = Codespace(
            orbit_id=orbit.id,
            created_by_user_id=user.id,
            name=payload.name,
            branch_name=branch_name,
            workspace_path=relative_path,
        )
        db.add(codespace)
        db.flush()
        containers.start_codespace(db, orbit=orbit, codespace=codespace)
        db.commit()
        return _serialize_codespace(codespace)

    @app.get("/api/orbits/{orbit_id}/demos")
    def orbit_demos(orbit_id: str, user: User = Depends(current_user), db: Session = Depends(get_db)) -> list[dict[str, Any]]:
        orbit = _orbit_for_member(db, orbit_id, user)
        items = db.scalars(select(Demo).where(Demo.orbit_id == orbit.id).order_by(Demo.created_at.desc())).all()
        return [_serialize_demo(item) for item in items]

    @app.post("/api/orbits/{orbit_id}/demos")
    def publish_demo(
        orbit_id: str,
        payload: DemoPublishRequest,
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> dict[str, Any]:
        orbit = _orbit_for_member(db, orbit_id, user)
        demo = Demo(
            orbit_id=orbit.id,
            work_item_id=payload.work_item_id,
            title=payload.title,
            source_path=payload.source_path,
        )
        db.add(demo)
        db.flush()
        containers.start_demo(db, demo=demo)
        db.commit()
        return _serialize_demo(demo)

    return app
