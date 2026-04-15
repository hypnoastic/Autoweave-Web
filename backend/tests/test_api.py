from __future__ import annotations

import httpx
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session as OrmSession

import autoweave_web.api.app as app_module
from autoweave_web.api.app import create_app
from autoweave_web.core.settings import get_settings
from autoweave_web.db.session import Base, get_engine, reset_database_state
from autoweave_web.models.entities import (
    Artifact,
    AuthState,
    Channel,
    ConversationState,
    IntegrationInstallation,
    MatrixMessageLink,
    Message,
    Notification,
    OrbitRepositoryBinding,
    PullRequestSnapshot,
    RepoGrant,
    RepositoryConnection,
    RuntimeHumanLoopItem,
)
from autoweave_web.services.matrix import MatrixTransportError
from conftest import (
    FakeContainerOrchestrator,
    FakeGitHubGateway,
    FakeMatrixProvisioningService,
    FakeMatrixService,
    FakeNavigationStore,
    FakeRuntimeManager,
)


def _login(client):
    response = client.post("/api/auth/github-token", json={"token": "ghp_example_token_value"})
    assert response.status_code == 200
    payload = response.json()
    return payload["token"], payload["user"]


def _create_orbit(client, headers):
    response = client.post(
        "/api/orbits",
        json={
            "name": "Orbit Control",
            "description": "Coordinate ERGO and the repo workflow.",
            "logo": "OC",
            "private": True,
            "invite_emails": ["reviewer@example.com"],
        },
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()


def test_login_create_orbit_and_dashboard(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    assert orbit["repo_full_name"] == "octocat/orbit-control"

    dashboard = client.get("/api/dashboard", headers=headers)
    assert dashboard.status_code == 200
    payload = dashboard.json()
    assert payload["me"]["github_login"] == user["github_login"]
    assert payload["recent_orbits"][0]["id"] == orbit["id"]
    assert client.app.state.navigation.get_state(user["id"]) == {"orbit_id": orbit["id"], "section": "chat"}


def test_local_dev_session_bootstrap_creates_a_session_in_non_production_env(client):
    response = client.post(
        "/api/auth/dev-session",
        json={
            "github_login": "playwright_dev",
            "display_name": "Playwright Dev",
            "email": "playwright@example.com",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["token"]
    assert payload["user"]["github_login"] == "playwright_dev"
    assert payload["user"]["display_name"] == "Playwright Dev"


def test_local_dev_session_bootstrap_reuses_existing_hyphenated_user_login(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    _create_orbit(client, headers)

    response = client.post(
        "/api/auth/dev-session",
        json={
            "github_login": user["github_login"],
            "display_name": "Reused Dev Session",
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["token"]
    assert payload["user"]["id"] == user["id"]
    assert payload["user"]["github_login"] == user["github_login"]
    assert payload["user"]["display_name"] == "Reused Dev Session"


def test_local_dev_session_can_create_orbit_without_live_github_repo(client):
    response = client.post(
        "/api/auth/dev-session",
        json={
            "github_login": "playwright_dev",
            "display_name": "Playwright Dev",
            "email": "playwright@example.com",
        },
    )
    assert response.status_code == 200
    token = response.json()["token"]
    headers = {"Authorization": f"Bearer {token}"}

    orbit_response = client.post(
        "/api/orbits",
        json={
            "name": "Planning Validation",
            "description": "Local PM browser harness orbit.",
            "private": True,
        },
        headers=headers,
    )
    assert orbit_response.status_code == 200
    orbit = orbit_response.json()
    assert orbit["name"] == "Planning Validation"
    assert orbit["repo_full_name"] is None
    assert orbit["default_branch"] == "main"

    dashboard = client.get("/api/dashboard", headers=headers)
    assert dashboard.status_code == 200
    payload = dashboard.json()
    assert payload["recent_orbits"][0]["id"] == orbit["id"]


def test_orbit_native_issue_and_cycle_flow_are_available_in_orbit_payload(client):
    token, _user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    cycle_response = client.post(
        f"/api/orbits/{orbit['id']}/cycles",
        json={
            "name": "April stabilization",
            "goal": "Land the PM-first issue surface.",
        },
        headers=headers,
    )
    assert cycle_response.status_code == 200
    cycle = cycle_response.json()
    assert cycle["name"] == "April stabilization"
    assert cycle["issue_count"] == 0

    issue_response = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Create the review queue lane",
            "detail": "Track review work as a native orbit issue.",
            "priority": "high",
            "cycle_id": cycle["id"],
        },
        headers=headers,
    )
    assert issue_response.status_code == 200
    issue = issue_response.json()
    assert issue["number"] == 1
    assert issue["cycle_id"] == cycle["id"]
    assert issue["status"] == "triage"

    update_response = client.patch(
        f"/api/orbits/{orbit['id']}/native-issues/{issue['id']}",
        json={"status": "in_review"},
        headers=headers,
    )
    assert update_response.status_code == 200
    updated = update_response.json()
    assert updated["status"] == "in_review"

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    payload = orbit_payload.json()
    assert payload["cycles"][0]["id"] == cycle["id"]
    assert payload["cycles"][0]["issue_count"] == 1
    assert payload["native_issues"][0]["id"] == issue["id"]
    assert payload["native_issues"][0]["status"] == "in_review"

    my_work = client.get("/api/my-work", headers=headers)
    assert my_work.status_code == 200
    my_work_payload = my_work.json()
    assert any(item["id"] == issue["id"] for item in my_work_payload["active_issues"])
    assert any(item["id"] == issue["id"] for item in my_work_payload["review_queue"])


def test_native_issue_supports_labels_hierarchy_and_dependency_links(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    parent_response = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Rebuild the issue control plane",
            "detail": "The parent issue owns the full issue-model pass.",
            "priority": "high",
            "status": "planned",
            "labels": ["planning", "control-plane"],
        },
        headers=headers,
    )
    assert parent_response.status_code == 200
    parent_issue = parent_response.json()

    blocker_response = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Model dependency tracking",
            "detail": "This needs to land before the child issue can close.",
            "priority": "medium",
            "status": "in_progress",
            "labels": ["dependencies"],
        },
        headers=headers,
    )
    assert blocker_response.status_code == 200
    blocker_issue = blocker_response.json()

    child_response = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Surface hierarchy in the detail panel",
            "detail": "Show parent, sub-issues, and dependency links in one place.",
            "priority": "high",
            "status": "triage",
            "assignee_user_id": user["id"],
            "parent_issue_id": parent_issue["id"],
            "labels": ["planning", "ui"],
            "blocked_by_issue_ids": [blocker_issue["id"]],
            "related_issue_ids": [parent_issue["id"]],
        },
        headers=headers,
    )
    assert child_response.status_code == 200
    child_issue = child_response.json()

    assert child_issue["assignee_user_id"] == user["id"]
    assert child_issue["parent_issue"]["id"] == parent_issue["id"]
    assert {label["name"] for label in child_issue["labels"]} == {"planning", "ui"}
    assert child_issue["relations"]["blocked_by"][0]["id"] == blocker_issue["id"]
    assert child_issue["relations"]["related"][0]["id"] == parent_issue["id"]

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    payload = orbit_payload.json()
    labels = {label["slug"] for label in payload["issue_labels"]}
    assert {"planning", "control-plane", "dependencies", "ui"}.issubset(labels)

    hydrated_parent = next(item for item in payload["native_issues"] if item["id"] == parent_issue["id"])
    hydrated_child = next(item for item in payload["native_issues"] if item["id"] == child_issue["id"])
    assert hydrated_parent["sub_issues"][0]["id"] == child_issue["id"]
    assert hydrated_child["relation_counts"]["blocked_by"] == 1


def test_saved_views_can_be_created_over_native_issue_filters(client):
    token, _user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    cycle_response = client.post(
        f"/api/orbits/{orbit['id']}/cycles",
        json={
            "name": "April stabilization",
            "goal": "Land the PM shell cleanup.",
        },
        headers=headers,
    )
    assert cycle_response.status_code == 200
    cycle = cycle_response.json()

    first_issue = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Model the issue board",
            "detail": "Keep planning inside the orbit shell.",
            "priority": "high",
            "status": "in_progress",
            "cycle_id": cycle["id"],
        },
        headers=headers,
    )
    assert first_issue.status_code == 200

    second_issue = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Tighten cycle filters",
            "detail": "Keep ad hoc planning out of chat.",
            "priority": "low",
            "status": "planned",
        },
        headers=headers,
    )
    assert second_issue.status_code == 200

    created = client.post(
        "/api/views",
        json={
            "name": "High priority cycle work",
            "description": "Keep urgent cycle work visible.",
            "orbit_id": orbit["id"],
            "statuses": ["in_progress"],
            "priorities": ["high"],
            "assignee_scope": "me",
            "cycle_scope": "with_cycle",
        },
        headers=headers,
    )
    assert created.status_code == 200
    created_payload = created.json()
    custom_view = next(item for item in created_payload["views"] if item["kind"] == "custom")
    assert custom_view["label"] == "High priority cycle work"
    assert custom_view["count"] == 1
    assert custom_view["preview"][0]["title"] == "PM-1 · Model the issue board"
    assert "Orbit Control" in custom_view["filter_summary"]

    listed = client.get("/api/views", headers=headers)
    assert listed.status_code == 200
    listed_payload = listed.json()
    assert any(item["label"] == "Assigned to me" for item in listed_payload["views"])
    assert any(item["label"] == "High priority cycle work" for item in listed_payload["views"])


def test_saved_views_can_be_pinned_updated_and_deleted(client):
    token, _user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    created = client.post(
        "/api/views",
        json={
            "name": "Risk watch",
            "description": "Track blocked work.",
            "orbit_id": orbit["id"],
            "relation_scope": "blocked",
        },
        headers=headers,
    )
    assert created.status_code == 200
    custom_view = next(item for item in created.json()["views"] if item["kind"] == "custom")

    updated = client.patch(
        f"/api/views/{custom_view['id']}",
        json={
            "name": "Pinned risk watch",
            "description": "Track blocked work that must move first.",
            "pinned": True,
            "stale_only": True,
        },
        headers=headers,
    )
    assert updated.status_code == 200
    updated_view = next(item for item in updated.json()["views"] if item["id"] == custom_view["id"])
    assert updated_view["label"] == "Pinned risk watch"
    assert updated_view["pinned"] is True
    assert updated_view["pin_rank"] > 0
    assert updated_view["filters"]["stale_only"] is True

    deleted = client.delete(f"/api/views/{custom_view['id']}", headers=headers)
    assert deleted.status_code == 200
    assert all(item["id"] != custom_view["id"] for item in deleted.json()["views"])


def test_planning_cycles_surface_uses_real_cycles_and_supports_updates(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    cycle_response = client.post(
        f"/api/orbits/{orbit['id']}/cycles",
        json={
            "name": "April stabilization",
            "goal": "Land the PM shell cleanup.",
            "starts_at": "2026-04-14T00:00:00Z",
            "ends_at": "2026-04-25T00:00:00Z",
        },
        headers=headers,
    )
    assert cycle_response.status_code == 200
    cycle = cycle_response.json()

    blocker_response = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Land the dependency parser",
            "detail": "This has to move first.",
            "priority": "high",
            "status": "in_progress",
        },
        headers=headers,
    )
    assert blocker_response.status_code == 200
    blocker_issue = blocker_response.json()

    blocked_response = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Ship the cycle controls",
            "detail": "Blocked while the parser is landing.",
            "priority": "high",
            "status": "planned",
            "assignee_user_id": user["id"],
            "cycle_id": cycle["id"],
            "blocked_by_issue_ids": [blocker_issue["id"]],
        },
        headers=headers,
    )
    assert blocked_response.status_code == 200

    review_response = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Review cycle ownership",
            "detail": "Waiting for review follow-up.",
            "priority": "medium",
            "status": "in_review",
            "assignee_user_id": user["id"],
            "cycle_id": cycle["id"],
        },
        headers=headers,
    )
    assert review_response.status_code == 200

    cycles_payload = client.get("/api/cycles", headers=headers)
    assert cycles_payload.status_code == 200
    cycle_entry = next(item for item in cycles_payload.json()["cycles"] if item["id"] == cycle["id"])
    assert cycle_entry["label"] == "April stabilization"
    assert cycle_entry["metrics"]["count"] == 2
    assert cycle_entry["metrics"]["review"] == 1
    assert cycle_entry["metrics"]["blocked"] == 1

    updated = client.patch(
        f"/api/orbits/{orbit['id']}/cycles/{cycle['id']}",
        json={"name": "April release control", "status": "planned"},
        headers=headers,
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "April release control"
    assert updated.json()["status"] == "planned"

    deleted = client.delete(f"/api/orbits/{orbit['id']}/cycles/{cycle['id']}", headers=headers)
    assert deleted.status_code == 200

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    issue = next(item for item in orbit_payload.json()["native_issues"] if item["title"] == "Ship the cycle controls")
    assert issue["cycle_id"] is None


def test_inbox_payload_prioritizes_native_issue_triage_buckets(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    blocker_response = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Land dependency tracking",
            "detail": "This must close before the implementation issue can move.",
            "priority": "high",
            "status": "in_progress",
        },
        headers=headers,
    )
    assert blocker_response.status_code == 200
    blocker_issue = blocker_response.json()

    blocked_response = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Ship inbox quick actions",
            "detail": "Blocked until the dependency issue lands.",
            "priority": "high",
            "status": "planned",
            "assignee_user_id": user["id"],
            "blocked_by_issue_ids": [blocker_issue["id"]],
        },
        headers=headers,
    )
    assert blocked_response.status_code == 200

    review_response = client.post(
        f"/api/orbits/{orbit['id']}/native-issues",
        json={
            "title": "Review the triage surface",
            "detail": "Waiting for review follow-up.",
            "priority": "medium",
            "status": "in_review",
            "assignee_user_id": user["id"],
        },
        headers=headers,
    )
    assert review_response.status_code == 200
    review_issue = review_response.json()

    inbox = client.get("/api/inbox", headers=headers)
    assert inbox.status_code == 200
    payload = inbox.json()
    assert payload["summary"]["review_requests"] == 1
    assert payload["summary"]["blocked_work"] == 1

    blocked_item = next(item for item in payload["items"] if item.get("bucket") == "blocked")
    review_item = next(item for item in payload["items"] if item.get("bucket") == "review")

    assert blocked_item["reason_label"] == "Blocked"
    assert review_item["reason_label"] == "Review request"
    assert review_item["navigation"]["detail_kind"] == "native_issue"
    assert review_item["navigation"]["detail_id"] == review_issue["id"]


def test_inbox_payload_exposes_action_context_for_approvals_and_mentions(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    with OrmSession(get_engine()) as db:
        db.add(
            Notification(
                user_id=user["id"],
                orbit_id=orbit["id"],
                kind="approval",
                title="Release signoff",
                detail="A human approval is required before the workflow can continue.",
                status="unread",
                source_kind="approval",
                source_id="approval_1",
                metadata_json={"workflow_run_id": "run_1"},
            )
        )
        db.add(
            Notification(
                user_id=user["id"],
                orbit_id=orbit["id"],
                kind="mention",
                title="Mentioned in release review",
                detail="You were mentioned in a release thread.",
                status="unread",
                source_kind="message",
                source_id="msg_1",
                metadata_json={"repository_full_name": "octocat/orbit-control"},
            )
        )
        db.commit()

    inbox = client.get("/api/inbox", headers=headers)
    assert inbox.status_code == 200
    payload = inbox.json()

    approval_item = next(item for item in payload["items"] if item["kind"] == "approval")
    mention_item = next(item for item in payload["items"] if item["kind"] == "mention")

    assert approval_item["action_context"]["workflow_run_id"] == "run_1"
    assert approval_item["action_context"]["request_id"] == "approval_1"
    assert approval_item["action_context"]["request_kind"] == "approval"
    assert mention_item["action_context"]["notification_id"]


def test_inbox_payload_surfaces_workflow_actions_for_human_loops_and_failed_runs(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    with OrmSession(get_engine()) as db:
        db.add(
            RuntimeHumanLoopItem(
                orbit_id=orbit["id"],
                workflow_run_id="run_clarify_1",
                work_item_id=None,
                request_kind="clarification",
                request_id="clarify_1",
                task_id="task_scope",
                task_key="scope_definition",
                status="open",
                title="Clarification needed",
                detail="Which workflow fields should ship in the first pass?",
            )
        )
        db.add(
            Notification(
                user_id=user["id"],
                orbit_id=orbit["id"],
                kind="run_failed",
                title="ERGO run failed",
                detail="The rollout planning run failed after schema reconciliation.",
                status="unread",
                source_kind="workflow_run",
                source_id="run_failed_1",
                metadata_json={"workflow_run_id": "run_failed_1"},
            )
        )
        db.commit()

    inbox = client.get("/api/inbox", headers=headers)
    assert inbox.status_code == 200
    payload = inbox.json()

    clarification_item = next(
        item for item in payload["items"] if (item.get("action_context") or {}).get("request_id") == "clarify_1"
    )
    failed_run_item = next(
        item for item in payload["items"] if (item.get("action_context") or {}).get("request_kind") == "run_failed"
    )

    assert [action["label"] for action in clarification_item["detail"]["next_actions"]] == ["Open workflow", "Open chat"]
    assert [action["label"] for action in failed_run_item["detail"]["next_actions"]] == ["Open workflow", "Open chat"]


def test_notifications_can_be_marked_read_directly(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    with OrmSession(get_engine()) as db:
        notification = Notification(
            user_id=user["id"],
            orbit_id=orbit["id"],
            kind="mention",
            title="Mentioned in release review",
            detail="You were mentioned in a release thread.",
            status="unread",
            source_kind="message",
            source_id="msg_1",
            metadata_json={"repository_full_name": "octocat/orbit-control"},
        )
        db.add(notification)
        db.commit()
        notification_id = notification.id

    mark_read = client.post(f"/api/notifications/{notification_id}/read", headers=headers)
    assert mark_read.status_code == 200
    assert mark_read.json()["status"] == "read"

    with OrmSession(get_engine()) as db:
        persisted = db.get(Notification, notification_id)
        assert persisted is not None
        assert persisted.status == "read"
        assert persisted.read_at is not None


def test_health_endpoint_allows_local_frontend_origin(client):
    response = client.options(
        "/api/health",
        headers={
            "Origin": "http://127.0.0.1:3000",
            "Access-Control-Request-Method": "GET",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://127.0.0.1:3000"


def test_github_token_login_returns_401_for_invalid_github_token():
    class InvalidTokenGitHubGateway(FakeGitHubGateway):
        def get_authenticated_user(self, token: str) -> dict:
            request = httpx.Request("GET", "https://api.github.com/user")
            response = httpx.Response(401, request=request)
            raise httpx.HTTPStatusError("invalid token", request=request, response=response)

    reset_database_state()
    settings = get_settings()
    engine = get_engine()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    app = create_app(
        settings=settings,
        github=InvalidTokenGitHubGateway(),
        runtime_manager=FakeRuntimeManager(settings),
        navigation=FakeNavigationStore(),
        containers=FakeContainerOrchestrator(),
    )
    with TestClient(app) as client:
        response = client.post("/api/auth/github-token", json={"token": "ghp_invalid"})

    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid GitHub token"}

    Base.metadata.drop_all(bind=engine)


def test_github_app_status_and_claim_flow_create_installation_and_enable_installation_repos(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}

    status_response = client.get("/api/auth/github-app", headers=headers)
    assert status_response.status_code == 200
    status_payload = status_response.json()
    assert status_payload["configured"] is True
    assert "ergon-ai-dev/installations/new?state=" in status_payload["install_url"]
    assert status_payload["active_installation"] is None

    state = status_payload["install_url"].split("state=", 1)[1]
    with OrmSession(get_engine()) as db:
        auth_state = db.scalar(select(AuthState).where(AuthState.state == state))
        assert auth_state is not None
        assert auth_state.user_id == user["id"]

    claim_response = client.post(
        "/api/auth/github-app/installations/claim",
        json={"installation_id": 2995185, "state": state, "setup_action": "install"},
        headers=headers,
    )
    assert claim_response.status_code == 200
    claim_payload = claim_response.json()
    assert claim_payload["ok"] is True
    assert claim_payload["installation"]["installation_id"] == 2995185
    assert claim_payload["installation"]["account_login"] == "collabx2315-ops"

    with OrmSession(get_engine()) as db:
        installation = db.scalar(
            select(IntegrationInstallation).where(
                IntegrationInstallation.installation_key == "github:app_installation:2995185"
            )
        )
        assert installation is not None
        assert installation.installation_kind == "github_app_installation"
        assert installation.owner_user_id == user["id"]

    orbit = _create_orbit(client, headers)
    available = client.get(f"/api/orbits/{orbit['id']}/available-repositories", headers=headers)
    assert available.status_code == 200
    repositories = available.json()
    assert repositories[0]["full_name"] == "collabx2315-ops/installed-platform"


def test_ergo_channel_message_starts_work_and_projects_context(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    response = client.post(
        f"/api/orbits/{orbit['id']}/messages",
        json={"body": "@ERGO build the orbit workflow dashboard and review board"},
        headers=headers,
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["ergo"]["body"] == "working on it"
    assert payload["work_item"]["branch_name"].startswith("ergo/")
    assert client.app.state.runtime_manager.queued[0]["request_text"].startswith("@ERGO build")
    assert client.app.state.runtime_manager.memory_entries[0]["metadata_json"]["source_kind"] == "chat_message"

    workflow = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert workflow.status_code == 200
    assert workflow.json()["selected_run"]["title"].startswith("@ERGO build")


def test_theme_preferences_channel_scoped_messages_and_member_dm_flow(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    preferences = client.get("/api/preferences", headers=headers)
    assert preferences.status_code == 200
    assert preferences.json() == {"theme_preference": "system"}

    updated = client.put("/api/preferences", json={"theme_preference": "dark"}, headers=headers)
    assert updated.status_code == 200
    assert updated.json() == {"theme_preference": "dark"}

    channel_response = client.post(
        f"/api/orbits/{orbit['id']}/channels",
        json={"name": "Product Design"},
        headers=headers,
    )
    assert channel_response.status_code == 200
    channel = channel_response.json()
    assert channel["slug"] == "product-design"

    channel_message = client.post(
        f"/api/orbits/{orbit['id']}/channels/{channel['id']}/messages",
        json={"body": "Need tighter spacing in the workflow lane."},
        headers=headers,
    )
    assert channel_message.status_code == 200
    assert channel_message.json()["message"]["channel_id"] == channel["id"]
    assert channel_message.json()["ergo"] is None

    scoped_messages = client.get(
        f"/api/orbits/{orbit['id']}/channels/{channel['id']}/messages",
        headers=headers,
    )
    assert scoped_messages.status_code == 200
    scoped_payload = scoped_messages.json()
    assert scoped_payload["channel"]["id"] == channel["id"]
    assert len(scoped_payload["messages"]) == 1
    assert scoped_payload["messages"][0]["body"] == "Need tighter spacing in the workflow lane."

    workflow_sync = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert workflow_sync.status_code == 200

    workflow_sync = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert workflow_sync.status_code == 200

    workflow_sync = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert workflow_sync.status_code == 200

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    member = orbit_payload.json()["members"][0]
    assert member["login"] == user["github_login"]
    assert member["display_name"] == user["display_name"]
    assert "avatar_url" in member

    member_dm = client.post(
        f"/api/orbits/{orbit['id']}/dms",
        json={"target_login": user["github_login"]},
        headers=headers,
    )
    assert member_dm.status_code == 400
    assert member_dm.json()["detail"] == "Cannot start a DM with yourself"

    ergo_dm = client.post(
        f"/api/orbits/{orbit['id']}/dms",
        json={"target_login": "ERGO"},
        headers=headers,
    )
    assert ergo_dm.status_code == 200
    ergo_payload = ergo_dm.json()
    assert ergo_payload["kind"] == "agent"
    assert ergo_payload["participant"]["login"] == "ERGO"


def test_dm_thread_creation_works_with_member_login_and_orbit_payloads_are_rich(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    second_login = client.post("/api/auth/github-token", json={"token": "ghp_example_token_value_second"})
    assert second_login.status_code == 200
    second_payload = second_login.json()
    second_headers = {"Authorization": f"Bearer {second_payload['token']}"}

    invite = client.post(
        f"/api/orbits/{orbit['id']}/invites",
        json={"email": "teammate@example.com"},
        headers=headers,
    )
    assert invite.status_code == 200

    accept = client.post(f"/api/invites/{invite.json()['token']}/accept", headers=second_headers)
    assert accept.status_code == 200

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    members = orbit_payload.json()["members"]
    teammate = next(member for member in members if member["login"] == "teammate")
    assert teammate["role"] == "contributor"

    dm_response = client.post(
        f"/api/orbits/{orbit['id']}/dms",
        json={"target_user_id": second_payload["user"]["id"]},
        headers=headers,
    )
    assert dm_response.status_code == 200
    dm_payload = dm_response.json()
    assert dm_payload["kind"] == "member"
    assert dm_payload["participant"]["user_id"] == second_payload["user"]["id"]
    assert dm_payload["participant"]["display_name"] == second_payload["user"]["display_name"]

    dm_list = client.get(f"/api/orbits/{orbit['id']}/dms", headers=headers)
    assert dm_list.status_code == 200
    assert any(thread["id"] == dm_payload["id"] for thread in dm_list.json())


def test_dm_workflow_actions_codespaces_and_demos(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers).json()
    ergo_thread_id = orbit_payload["direct_messages"][0]["id"]

    dm_response = client.post(
        f"/api/orbits/{orbit['id']}/dms/{ergo_thread_id}/messages",
        json={"body": "@ERGO hello"},
        headers=headers,
    )
    assert dm_response.status_code == 200
    assert dm_response.json()["ergo"]["body"] == "hello"

    answer_response = client.post(
        f"/api/orbits/{orbit['id']}/workflow/human-requests/answer",
        json={"workflow_run_id": "run_1", "request_id": "human_1", "answer_text": "Ship the workflow board first."},
        headers=headers,
    )
    assert answer_response.status_code == 200
    assert client.app.state.runtime_manager.answers[0]["request_id"] == "human_1"

    approval_response = client.post(
        f"/api/orbits/{orbit['id']}/workflow/approval-requests/resolve",
        json={"workflow_run_id": "run_1", "request_id": "approval_1", "approved": True},
        headers=headers,
    )
    assert approval_response.status_code == 200
    assert client.app.state.runtime_manager.approvals[0]["approved"] is True

    codespace_response = client.post(
        f"/api/orbits/{orbit['id']}/codespaces",
        json={"name": "Orbit Review Space"},
        headers=headers,
    )
    assert codespace_response.status_code == 200
    codespace_payload = codespace_response.json()
    assert codespace_payload["status"] == "running"
    assert codespace_payload["editor_url"].startswith("http://localhost:9000/")

    demo_response = client.post(
        f"/api/orbits/{orbit['id']}/demos",
        json={"title": "Orbit demo", "source_path": codespace_payload["workspace_path"]},
        headers=headers,
    )
    assert demo_response.status_code == 200
    assert demo_response.json()["url"].startswith("http://localhost:9100/")


def test_matrix_flagged_channel_send_queues_transport_and_bootstrap(client):
    reset_database_state()
    settings = get_settings()
    original_flags = settings.feature_flags
    settings.feature_flags = (
        f"{settings.feature_flags},ff_matrix_chat_backend_v1,ff_matrix_room_provisioning_v1,ff_matrix_sync_ingest_v1"
    )
    engine = get_engine()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    github = FakeGitHubGateway()
    runtime = FakeRuntimeManager(settings)
    navigation = FakeNavigationStore()
    containers = FakeContainerOrchestrator()
    matrix_service = FakeMatrixService()
    matrix_provisioning = FakeMatrixProvisioningService()
    app = create_app(
        settings=settings,
        github=github,
        runtime_manager=runtime,
        navigation=navigation,
        containers=containers,
        matrix_service=matrix_service,
        matrix_provisioning=matrix_provisioning,
    )

    with TestClient(app) as matrix_client:
        token, _ = _login(matrix_client)
        headers = {"Authorization": f"Bearer {token}"}
        orbit = _create_orbit(matrix_client, headers)
        orbit_payload = matrix_client.get(f"/api/orbits/{orbit['id']}", headers=headers)
        assert orbit_payload.status_code == 200
        general_channel_id = orbit_payload.json()["channels"][0]["id"]

        send_response = matrix_client.post(
            f"/api/orbits/{orbit['id']}/channels/{general_channel_id}/messages",
            json={"body": "Matrix-backed hello"},
            headers=headers,
        )
        assert send_response.status_code == 200
        sent_message = send_response.json()["message"]
        assert sent_message["transport_state"] == "pending_remote"

        with OrmSession(engine) as db:
            saved_message = db.get(Message, sent_message["id"])
            assert saved_message is not None
            assert saved_message.transport_state == "pending_remote"
            link = db.scalar(select(MatrixMessageLink).where(MatrixMessageLink.message_id == saved_message.id))
            assert link is not None
            assert link.send_state == "queued"

        bootstrap = matrix_client.get(
            f"/api/chat/sync/bootstrap?orbit_id={orbit['id']}",
            headers=headers,
        )
        assert bootstrap.status_code == 200
        bootstrap_payload = bootstrap.json()
        assert bootstrap_payload["enabled"] is True
        assert bootstrap_payload["provider"] == "matrix"
        assert bootstrap_payload["room_bindings"][0]["channel_id"] == general_channel_id

        retry = matrix_client.post(
            f"/api/orbits/{orbit['id']}/messages/{sent_message['id']}/retry-transport",
            headers=headers,
        )
        assert retry.status_code == 200
        assert retry.json()["message"]["transport_state"] == "pending_remote"

    Base.metadata.drop_all(bind=engine)
    settings.feature_flags = original_flags


def test_matrix_bootstrap_gracefully_disables_when_transport_is_unavailable(client):
    reset_database_state()
    settings = get_settings()
    original_flags = settings.feature_flags
    settings.feature_flags = (
        f"{settings.feature_flags},ff_matrix_chat_backend_v1,ff_matrix_room_provisioning_v1,ff_matrix_sync_ingest_v1"
    )
    engine = get_engine()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    class FailingMatrixProvisioningService(FakeMatrixProvisioningService):
        def bootstrap_payload_for_orbit(self, db, *, orbit, user):
            raise MatrixTransportError("Matrix transport unavailable: connection failed")

    github = FakeGitHubGateway()
    runtime = FakeRuntimeManager(settings)
    navigation = FakeNavigationStore()
    containers = FakeContainerOrchestrator()
    matrix_service = FakeMatrixService()
    matrix_provisioning = FailingMatrixProvisioningService()
    app = create_app(
        settings=settings,
        github=github,
        runtime_manager=runtime,
        navigation=navigation,
        containers=containers,
        matrix_service=matrix_service,
        matrix_provisioning=matrix_provisioning,
    )

    with TestClient(app) as matrix_client:
        token, _ = _login(matrix_client)
        headers = {"Authorization": f"Bearer {token}"}
        orbit = _create_orbit(matrix_client, headers)

        bootstrap = matrix_client.get(
            f"/api/chat/sync/bootstrap?orbit_id={orbit['id']}",
            headers=headers,
        )
        assert bootstrap.status_code == 200
        assert bootstrap.json() == {
            "provider": "product",
            "enabled": False,
            "room_bindings": [],
            "reason": "matrix_unavailable",
        }

    Base.metadata.drop_all(bind=engine)
    settings.feature_flags = original_flags


def test_workflow_prompts_are_projected_once_and_routed_to_origin_conversation(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    channel_response = client.post(
        f"/api/orbits/{orbit['id']}/channels",
        json={"name": "build-room"},
        headers=headers,
    )
    assert channel_response.status_code == 200
    channel = channel_response.json()

    work_response = client.post(
        f"/api/orbits/{orbit['id']}/channels/{channel['id']}/messages",
        json={"body": "@ERGO build the workflow shell and route clarifications in chat"},
        headers=headers,
    )
    assert work_response.status_code == 200
    work_payload = work_response.json()
    workflow_run_id = work_payload["work_item"]["workflow_ref"]

    client.app.state.runtime_manager.snapshots[orbit["id"]] = {
        "status": "ok",
        "selected_run_id": workflow_run_id,
        "selected_run": {
            "id": workflow_run_id,
            "title": "Build workflow shell",
            "status": "running",
            "operator_status": "waiting_for_human",
            "operator_summary": "Needs clarification",
            "execution_status": "active",
            "execution_summary": "manager waiting",
            "tasks": [],
            "events": [],
            "human_requests": [
                {
                    "id": "human_1",
                    "task_id": "task_1",
                    "status": "open",
                    "question": "Which section should ship first?",
                }
            ],
            "approval_requests": [
                {
                    "id": "approval_1",
                    "task_id": "task_1",
                    "status": "requested",
                    "reason": "Approve release to main branch",
                }
            ],
        },
        "runs": [
            {
                "id": workflow_run_id,
                "title": "Build workflow shell",
                "status": "running",
                "operator_status": "waiting_for_human",
                "operator_summary": "Needs clarification",
                "execution_status": "active",
                "execution_summary": "manager waiting",
                "tasks": [],
                "events": [],
                "human_requests": [
                    {
                        "id": "human_1",
                        "task_id": "task_1",
                        "status": "open",
                        "question": "Which section should ship first?",
                    }
                ],
                "approval_requests": [
                    {
                        "id": "approval_1",
                        "task_id": "task_1",
                        "status": "requested",
                        "reason": "Approve release to main branch",
                    }
                ],
            }
        ],
    }

    workflow_sync = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert workflow_sync.status_code == 200
    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    general = next(item for item in orbit_payload.json()["channels"] if item["slug"] == "general")

    origin_channel = client.get(
        f"/api/orbits/{orbit['id']}/channels/{channel['id']}/messages",
        headers=headers,
    ).json()
    origin_items = origin_channel["human_loop_items"]
    assert len([item for item in origin_items if item["request_id"] == "human_1"]) == 1
    assert len([item for item in origin_items if item["request_id"] == "approval_1"]) == 1

    general_channel = client.get(
        f"/api/orbits/{orbit['id']}/channels/{general['id']}/messages",
        headers=headers,
    ).json()
    assert general_channel["human_loop_items"] == []
    before_count = len(origin_channel["messages"])

    answer_response = client.post(
        f"/api/orbits/{orbit['id']}/workflow/human-requests/answer",
        json={"workflow_run_id": workflow_run_id, "request_id": "human_1", "answer_text": "Ship chat first."},
        headers=headers,
    )
    assert answer_response.status_code == 200
    approval_response = client.post(
        f"/api/orbits/{orbit['id']}/workflow/approval-requests/resolve",
        json={"workflow_run_id": workflow_run_id, "request_id": "approval_1", "approved": True},
        headers=headers,
    )
    assert approval_response.status_code == 200

    routed_messages = client.get(
        f"/api/orbits/{orbit['id']}/channels/{channel['id']}/messages",
        headers=headers,
    ).json()
    assert len(routed_messages["messages"]) == before_count
    assert len([item for item in routed_messages["human_loop_items"] if item["request_id"] == "human_1"]) == 1
    assert len([item for item in routed_messages["human_loop_items"] if item["request_id"] == "approval_1"]) == 1


def test_refresh_prs_and_issues_returns_operational_statuses(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    refresh = client.post(f"/api/orbits/{orbit['id']}/prs-issues/refresh", headers=headers)
    assert refresh.status_code == 200
    assert refresh.json() == {"prs": 1, "issues": 1, "failed_repositories": []}

    workflow_sync = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert workflow_sync.status_code == 200

    workflow_sync = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert workflow_sync.status_code == 200

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    payload = orbit_payload.json()

    assert payload["prs"][0]["operational_status"] == "queued"
    assert payload["issues"][0]["operational_status"] == "queued"
    assert payload["prs"][0]["repository_full_name"] == "octocat/orbit-control"
    assert payload["issues"][0]["repository_full_name"] == "octocat/orbit-control"


def test_refresh_prs_and_issues_syncs_all_bound_repositories(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    connect = client.post(
        f"/api/orbits/{orbit['id']}/repositories",
        json={"repo_full_name": "octocat/platform-ops", "make_primary": False},
        headers=headers,
    )
    assert connect.status_code == 200

    refresh = client.post(f"/api/orbits/{orbit['id']}/prs-issues/refresh", headers=headers)
    assert refresh.status_code == 200
    assert refresh.json()["prs"] == 2
    assert refresh.json()["issues"] == 2
    assert refresh.json()["failed_repositories"] == []

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    payload = orbit_payload.json()
    assert {item["repository_full_name"] for item in payload["prs"]} == {"octocat/orbit-control", "octocat/platform-ops"}
    assert {item["repository_full_name"] for item in payload["issues"]} == {"octocat/orbit-control", "octocat/platform-ops"}


def test_orbit_payload_includes_repository_bindings_and_permissions(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert payload.status_code == 200
    orbit_payload = payload.json()

    assert orbit_payload["repositories"][0]["full_name"] == "octocat/orbit-control"
    assert orbit_payload["repositories"][0]["is_primary"] is True
    assert orbit_payload["permissions"]["orbit_role"] == "owner"
    assert orbit_payload["permissions"]["can_manage_integrations"] is True


def test_bootstrap_orbit_payload_hydrates_shell_before_full_orbit_data(client):
    token, user = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    codespace = client.post(
        f"/api/orbits/{orbit['id']}/codespaces",
        json={"name": "Orbit Review Space"},
        headers=headers,
    )
    assert codespace.status_code == 200

    client.app.state.navigation.set_state(user["id"], {"orbit_id": orbit["id"], "section": "codespaces"})

    payload = client.get(f"/api/orbits/{orbit['id']}?bootstrap=1", headers=headers)
    assert payload.status_code == 200
    orbit_payload = payload.json()

    assert orbit_payload["orbit"]["id"] == orbit["id"]
    assert orbit_payload["channels"][0]["slug"] == "general"
    assert orbit_payload["direct_messages"][0]["participant"]["login"] == "ERGO"
    assert orbit_payload["repositories"][0]["full_name"] == "octocat/orbit-control"
    assert orbit_payload["permissions"]["orbit_role"] == "owner"
    assert orbit_payload["navigation"] == {"orbit_id": orbit["id"], "section": "codespaces"}
    assert orbit_payload["workflow"]["status"] in {"ok", "degraded"}

    assert orbit_payload["codespaces"][0]["name"] == "Orbit Review Space"
    assert orbit_payload["messages"] == []
    assert orbit_payload["human_loop_items"] == []
    assert orbit_payload["notifications"] == []
    assert orbit_payload["members"] == []
    assert orbit_payload["prs"] == []
    assert orbit_payload["issues"] == []
    assert orbit_payload["demos"] == []
    assert orbit_payload["artifacts"] == []


def test_owner_can_list_and_connect_additional_repositories(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    available = client.get(f"/api/orbits/{orbit['id']}/available-repositories", headers=headers)
    assert available.status_code == 200
    available_payload = available.json()
    assert any(item["full_name"] == "octocat/platform-ops" and item["already_connected"] is False for item in available_payload)

    connect = client.post(
        f"/api/orbits/{orbit['id']}/repositories",
        json={"repo_full_name": "octocat/platform-ops", "make_primary": False},
        headers=headers,
    )
    assert connect.status_code == 200
    assert connect.json()["full_name"] == "octocat/platform-ops"
    assert connect.json()["is_primary"] is False

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    payload = orbit_payload.json()
    assert payload["orbit"]["repo_full_name"] == "octocat/orbit-control"
    assert {repository["full_name"] for repository in payload["repositories"]} == {"octocat/orbit-control", "octocat/platform-ops"}


def test_setting_primary_repository_updates_legacy_orbit_fields(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    connect = client.post(
        f"/api/orbits/{orbit['id']}/repositories",
        json={"repo_full_name": "octocat/platform-ops"},
        headers=headers,
    )
    assert connect.status_code == 200
    repository_id = connect.json()["id"]

    primary = client.post(f"/api/orbits/{orbit['id']}/repositories/{repository_id}/primary", headers=headers)
    assert primary.status_code == 200
    assert primary.json()["is_primary"] is True

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    payload = orbit_payload.json()
    assert payload["orbit"]["repo_full_name"] == "octocat/platform-ops"
    primary_repo = next(repository for repository in payload["repositories"] if repository["id"] == repository_id)
    original_repo = next(repository for repository in payload["repositories"] if repository["full_name"] == "octocat/orbit-control")
    assert primary_repo["is_primary"] is True
    assert original_repo["is_primary"] is False


def test_non_owner_cannot_connect_additional_repositories(client):
    owner_token, _ = _login(client)
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    orbit = _create_orbit(client, owner_headers)

    second_login = client.post("/api/auth/github-token", json={"token": "ghp_example_token_value_second"})
    assert second_login.status_code == 200
    teammate_headers = {"Authorization": f"Bearer {second_login.json()['token']}"}

    invite = client.post(
        f"/api/orbits/{orbit['id']}/invites",
        json={"email": "teammate@example.com"},
        headers=owner_headers,
    )
    assert invite.status_code == 200
    accept = client.post(f"/api/invites/{invite.json()['token']}/accept", headers=teammate_headers)
    assert accept.status_code == 200

    response = client.post(
        f"/api/orbits/{orbit['id']}/repositories",
        json={"repo_full_name": "octocat/platform-ops"},
        headers=teammate_headers,
    )
    assert response.status_code == 403
    assert "repository bindings" in response.json()["detail"]


def test_member_cannot_trigger_repo_affecting_work_without_repo_operate_permission(client):
    owner_token, _ = _login(client)
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    orbit = _create_orbit(client, owner_headers)

    second_login = client.post("/api/auth/github-token", json={"token": "ghp_example_token_value_second"})
    assert second_login.status_code == 200
    teammate_payload = second_login.json()
    teammate_headers = {"Authorization": f"Bearer {teammate_payload['token']}"}

    invite = client.post(
        f"/api/orbits/{orbit['id']}/invites",
        json={"email": "teammate@example.com"},
        headers=owner_headers,
    )
    assert invite.status_code == 200
    accept = client.post(f"/api/invites/{invite.json()['token']}/accept", headers=teammate_headers)
    assert accept.status_code == 200

    response = client.post(
        f"/api/orbits/{orbit['id']}/messages",
        json={"body": "@ERGO build the workflow dashboard for this repo"},
        headers=teammate_headers,
    )
    assert response.status_code == 200
    payload = response.json()

    assert payload["work_item"] is None
    assert "repo-operate permission" in payload["ergo"]["body"]
    assert client.app.state.runtime_manager.queued == []


def test_mentions_and_dm_messages_create_contextual_notifications(client):
    owner_token, _ = _login(client)
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    orbit = _create_orbit(client, owner_headers)

    second_login = client.post("/api/auth/github-token", json={"token": "ghp_example_token_value_second"})
    assert second_login.status_code == 200
    teammate_headers = {"Authorization": f"Bearer {second_login.json()['token']}"}

    invite = client.post(
        f"/api/orbits/{orbit['id']}/invites",
        json={"email": "teammate@example.com"},
        headers=owner_headers,
    )
    assert invite.status_code == 200
    accept = client.post(f"/api/invites/{invite.json()['token']}/accept", headers=teammate_headers)
    assert accept.status_code == 200

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=owner_headers).json()
    general = next(channel for channel in orbit_payload["channels"] if channel["slug"] == "general")

    mention = client.post(
        f"/api/orbits/{orbit['id']}/channels/{general['id']}/messages",
        json={"body": "@teammate please review the workflow board"},
        headers=owner_headers,
    )
    assert mention.status_code == 200

    teammate_orbit = client.get(f"/api/orbits/{orbit['id']}", headers=teammate_headers).json()
    mention_notification = next(item for item in teammate_orbit["notifications"] if item["kind"] == "mention")
    assert mention_notification["channel_id"] == general["id"]
    assert mention_notification["status"] == "read"

    channel_view = client.get(
        f"/api/orbits/{orbit['id']}/channels/{general['id']}/messages",
        headers=teammate_headers,
    )
    assert channel_view.status_code == 200
    teammate_after_read = client.get(f"/api/orbits/{orbit['id']}", headers=teammate_headers).json()
    mention_notification_after = next(item for item in teammate_after_read["notifications"] if item["kind"] == "mention")
    assert mention_notification_after["status"] == "read"

    dm_thread = client.post(
        f"/api/orbits/{orbit['id']}/dms",
        json={"target_user_id": second_login.json()["user"]["id"]},
        headers=owner_headers,
    )
    assert dm_thread.status_code == 200
    thread_id = dm_thread.json()["id"]

    dm_message = client.post(
        f"/api/orbits/{orbit['id']}/dms/{thread_id}/messages",
        json={"body": "Need your repo review today."},
        headers=owner_headers,
    )
    assert dm_message.status_code == 200

    teammate_dm_orbit = client.get(f"/api/orbits/{orbit['id']}", headers=teammate_headers).json()
    dm_notification = next(item for item in teammate_dm_orbit["notifications"] if item["kind"] == "dm")
    assert dm_notification["dm_thread_id"] == thread_id
    assert dm_notification["status"] == "unread"

    teammate_dm_view = client.get(
        f"/api/orbits/{orbit['id']}/dms/{thread_id}",
        headers=teammate_headers,
    )
    assert teammate_dm_view.status_code == 200
    teammate_after_dm_read = client.get(f"/api/orbits/{orbit['id']}", headers=teammate_headers).json()
    dm_notification_after = next(item for item in teammate_after_dm_read["notifications"] if item["kind"] == "dm")
    assert dm_notification_after["status"] == "read"


def test_inbox_endpoint_aggregates_briefing_scopes_recent_chat_and_review_items(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    repository_id = orbit_payload.json()["repositories"][0]["id"]

    ergo_thread = client.post(
        f"/api/orbits/{orbit['id']}/dms",
        json={"target_kind": "agent", "target_login": "ERGO"},
        headers=headers,
    )
    assert ergo_thread.status_code == 200

    dm_message = client.post(
        f"/api/orbits/{orbit['id']}/dms/{ergo_thread.json()['id']}/messages",
        json={"body": "Summarize the latest release state."},
        headers=headers,
    )
    assert dm_message.status_code == 200

    with OrmSession(get_engine()) as db:
        db.add(
            PullRequestSnapshot(
                orbit_id=orbit["id"],
                repository_connection_id=repository_id,
                github_number=42,
                title="Release review",
                state="open",
                priority="high",
                url="https://github.com/octocat/orbit-control/pull/42",
                branch_name="release/v1",
                metadata_json={"review_decision": "changes_requested"},
            )
        )
        db.add(
            Artifact(
                orbit_id=orbit["id"],
                repository_connection_id=repository_id,
                workflow_run_id="run_release",
                source_kind="workflow_run_status",
                source_id="run_release",
                artifact_kind="report",
                title="Release notes draft",
                summary="A concise release source artifact for Inbox.",
                status="ready",
                external_url="https://example.com/release-notes",
                metadata_json={"repository_full_name": "octocat/orbit-control"},
            )
        )
        db.commit()

    inbox = client.get("/api/inbox", headers=headers)
    assert inbox.status_code == 200
    payload = inbox.json()

    assert payload["briefing"]["id"] == "briefing-ergo"
    assert payload["active_scope"]["orbit_id"] == orbit["id"]
    assert payload["summary"]["review_queue"] == 1
    assert any(item["kind"] == "pr" and item["title"] == "Release review" for item in payload["items"])
    assert any(item["kind"] == "source" and item["title"] == "Release notes draft" for item in payload["items"])
    assert any(
        entry["body"] == "Summarize the latest release state."
        for entry in payload["briefing"]["detail"]["conversation_excerpt"]
    )


def test_orbit_payload_includes_repo_aware_artifacts_and_codespaces(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    send = client.post(
        f"/api/orbits/{orbit['id']}/messages",
        json={"body": "@ERGO build the repo-aware artifact center"},
        headers=headers,
    )
    assert send.status_code == 200
    work_item = send.json()["work_item"]

    codespace = client.post(
        f"/api/orbits/{orbit['id']}/codespaces",
        json={"name": "Artifact workspace"},
        headers=headers,
    )
    assert codespace.status_code == 200

    demo = client.post(
        f"/api/orbits/{orbit['id']}/demos",
        json={"title": "Artifact demo", "source_path": codespace.json()["workspace_path"], "work_item_id": work_item["id"]},
        headers=headers,
    )
    assert demo.status_code == 200

    payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers).json()
    assert payload["codespaces"][0]["repository_full_name"] == "octocat/orbit-control"
    assert payload["demos"][0]["repository_full_name"] == "octocat/orbit-control"
    artifact_kinds = {item["artifact_kind"] for item in payload["artifacts"]}
    assert {"draft_pr", "demo"} <= artifact_kinds
    demo_artifact = next(item for item in payload["artifacts"] if item["artifact_kind"] == "demo")
    assert demo_artifact["repository_full_name"] == "octocat/orbit-control"
    artifact_notification = next(item for item in payload["notifications"] if item["kind"] == "artifact")
    assert artifact_notification["source_kind"] == "artifact"
    assert artifact_notification["metadata"]["artifact_kind"] == "demo"


def test_human_loop_items_project_into_conversation_and_resolution_does_not_write_plain_system_messages(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    send = client.post(
        f"/api/orbits/{orbit['id']}/messages",
        json={"body": "@ERGO build the review workflow for this orbit"},
        headers=headers,
    )
    assert send.status_code == 200
    work_item = send.json()["work_item"]

    client.app.state.runtime_manager.snapshots[orbit["id"]] = {
        "status": "ok",
        "selected_run_id": work_item["workflow_ref"],
        "selected_run": {
            "id": work_item["workflow_ref"],
            "title": "@ERGO build the review workflow for this orbit",
            "status": "running",
            "operator_status": "waiting_for_human",
            "operator_summary": "ERGO needs clarification",
            "execution_status": "waiting_for_human",
            "execution_summary": "Waiting for answer",
            "tasks": [
                {
                    "id": "task_manager",
                    "task_key": "manager_plan",
                    "title": "Manager plan",
                    "assigned_role": "manager",
                    "state": "waiting_for_human",
                    "description": "Clarify what should ship first",
                }
            ],
            "events": [],
            "human_requests": [
                {
                    "id": "human_1",
                    "task_id": "task_manager",
                    "task_key": "manager_plan",
                    "status": "open",
                    "question": "What exact flow should ERGO ship first?",
                }
            ],
            "approval_requests": [],
        },
        "runs": [
            {
                "id": work_item["workflow_ref"],
                "title": "@ERGO build the review workflow for this orbit",
                "status": "running",
                "operator_status": "waiting_for_human",
                "operator_summary": "ERGO needs clarification",
                "execution_status": "waiting_for_human",
                "execution_summary": "Waiting for answer",
                "tasks": [
                    {
                        "id": "task_manager",
                        "task_key": "manager_plan",
                        "title": "Manager plan",
                        "assigned_role": "manager",
                        "state": "waiting_for_human",
                        "description": "Clarify what should ship first",
                    }
                ],
                "events": [],
                "human_requests": [
                    {
                        "id": "human_1",
                        "task_id": "task_manager",
                        "task_key": "manager_plan",
                        "status": "open",
                        "question": "What exact flow should ERGO ship first?",
                    }
                ],
                "approval_requests": [],
            }
        ],
    }

    workflow_sync = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert workflow_sync.status_code == 200

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    payload = orbit_payload.json()
    assert payload["human_loop_items"][0]["request_kind"] == "clarification"
    assert payload["human_loop_items"][0]["detail"] == "What exact flow should ERGO ship first?"

    general = payload["channels"][0]
    before_messages = client.get(
        f"/api/orbits/{orbit['id']}/channels/{general['id']}/messages",
        headers=headers,
    ).json()
    before_count = len(before_messages["messages"])

    answer = client.post(
        f"/api/orbits/{orbit['id']}/workflow/human-requests/answer",
        json={"workflow_run_id": work_item["workflow_ref"], "request_id": "human_1", "answer_text": "Ship approvals first."},
        headers=headers,
    )
    assert answer.status_code == 200

    after_messages = client.get(
        f"/api/orbits/{orbit['id']}/channels/{general['id']}/messages",
        headers=headers,
    ).json()
    assert len(after_messages["messages"]) == before_count
    assert after_messages["human_loop_items"][0]["request_kind"] == "clarification"


def test_workflow_endpoint_falls_back_to_saved_projection_when_runtime_snapshot_is_empty(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    send = client.post(
        f"/api/orbits/{orbit['id']}/messages",
        json={"body": "@ERGO build the orbit workflow dashboard and review board"},
        headers=headers,
    )
    assert send.status_code == 200
    work_item = send.json()["work_item"]

    first_workflow = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert first_workflow.status_code == 200
    assert first_workflow.json()["selected_run"]["id"] == work_item["workflow_ref"]

    client.app.state.runtime_manager.snapshots[orbit["id"]] = {
        "status": "degraded",
        "load_error": "Workflow state refresh timed out; showing the last known runtime state.",
        "runs": [],
        "selected_run_id": None,
        "selected_run": None,
    }

    second_workflow = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert second_workflow.status_code == 200
    payload = second_workflow.json()
    assert payload["status"] == "degraded"
    assert payload["selected_run"]["id"] == work_item["workflow_ref"]
    assert payload["runs"][0]["id"] == work_item["workflow_ref"]


def test_orbit_payload_hot_read_is_projection_first_and_uses_work_item_fallback(client, monkeypatch):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    send = client.post(
        f"/api/orbits/{orbit['id']}/messages",
        json={"body": "@ERGO build the orbit workflow dashboard and review board"},
        headers=headers,
    )
    assert send.status_code == 200
    work_item = send.json()["work_item"]

    runtime_called = False
    projection_called = False

    def failing_monitoring_snapshot(*args, **kwargs):
        nonlocal runtime_called
        runtime_called = True
        raise AssertionError("Hot orbit reads should not call the runtime snapshot path.")

    def failing_sync_runtime_projection(*args, **kwargs):
        nonlocal projection_called
        projection_called = True
        raise OperationalError("INSERT INTO product_runtime_runs ...", {}, Exception("ssl eof"))

    monkeypatch.setattr(client.app.state.runtime_manager, "monitoring_snapshot", failing_monitoring_snapshot)
    monkeypatch.setattr(app_module, "sync_runtime_projection", failing_sync_runtime_projection)

    payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert payload.status_code == 200
    orbit_payload = payload.json()
    assert orbit_payload["orbit"]["id"] == orbit["id"]
    assert orbit_payload["channels"][0]["slug"] == "general"
    assert orbit_payload["workflow"]["selected_run"]["id"] == work_item["workflow_ref"]
    assert runtime_called is False
    assert projection_called is False


def test_answer_workflow_human_request_is_idempotent(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    send = client.post(
        f"/api/orbits/{orbit['id']}/messages",
        json={"body": "@ERGO build the review workflow for this orbit"},
        headers=headers,
    )
    assert send.status_code == 200
    work_item = send.json()["work_item"]

    client.app.state.runtime_manager.snapshots[orbit["id"]] = {
        "status": "ok",
        "selected_run_id": work_item["workflow_ref"],
        "selected_run": {
            "id": work_item["workflow_ref"],
            "title": "@ERGO build the review workflow for this orbit",
            "status": "running",
            "operator_status": "waiting_for_human",
            "execution_status": "waiting_for_human",
            "operator_summary": "Clarification needed",
            "execution_summary": "Waiting for answer",
            "tasks": [],
            "events": [],
            "human_requests": [{"id": "human_1", "status": "open", "question": "What should ship first?"}],
            "approval_requests": [],
        },
        "runs": [
            {
                "id": work_item["workflow_ref"],
                "title": "@ERGO build the review workflow for this orbit",
                "status": "running",
                "operator_status": "waiting_for_human",
                "execution_status": "waiting_for_human",
                "operator_summary": "Clarification needed",
                "execution_summary": "Waiting for answer",
                "tasks": [],
                "events": [],
                "human_requests": [{"id": "human_1", "status": "open", "question": "What should ship first?"}],
                "approval_requests": [],
            }
        ],
    }

    workflow_sync = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert workflow_sync.status_code == 200

    first_answer = client.post(
        f"/api/orbits/{orbit['id']}/workflow/human-requests/answer",
        json={"workflow_run_id": work_item["workflow_ref"], "request_id": "human_1", "answer_text": "Ship approvals first."},
        headers=headers,
    )
    assert first_answer.status_code == 200
    assert len(client.app.state.runtime_manager.answers) == 1

    second_answer = client.post(
        f"/api/orbits/{orbit['id']}/workflow/human-requests/answer",
        json={"workflow_run_id": work_item["workflow_ref"], "request_id": "human_1", "answer_text": "Ship approvals first."},
        headers=headers,
    )
    assert second_answer.status_code == 200
    assert second_answer.json()["idempotent"] is True
    assert len(client.app.state.runtime_manager.answers) == 1

    conflicting_answer = client.post(
        f"/api/orbits/{orbit['id']}/workflow/human-requests/answer",
        json={"workflow_run_id": work_item["workflow_ref"], "request_id": "human_1", "answer_text": "Ship chat first."},
        headers=headers,
    )
    assert conflicting_answer.status_code == 409


def test_resolve_workflow_approval_is_idempotent(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    send = client.post(
        f"/api/orbits/{orbit['id']}/messages",
        json={"body": "@ERGO build the release workflow for this orbit"},
        headers=headers,
    )
    assert send.status_code == 200
    work_item = send.json()["work_item"]

    client.app.state.runtime_manager.snapshots[orbit["id"]] = {
        "status": "ok",
        "selected_run_id": work_item["workflow_ref"],
        "selected_run": {
            "id": work_item["workflow_ref"],
            "title": "@ERGO build the release workflow for this orbit",
            "status": "running",
            "operator_status": "waiting_for_approval",
            "execution_status": "waiting_for_approval",
            "operator_summary": "Approval required",
            "execution_summary": "Waiting for release signoff",
            "tasks": [],
            "events": [],
            "human_requests": [],
            "approval_requests": [{"id": "approval_1", "status": "requested", "reason": "Release signoff"}],
        },
        "runs": [
            {
                "id": work_item["workflow_ref"],
                "title": "@ERGO build the release workflow for this orbit",
                "status": "running",
                "operator_status": "waiting_for_approval",
                "execution_status": "waiting_for_approval",
                "operator_summary": "Approval required",
                "execution_summary": "Waiting for release signoff",
                "tasks": [],
                "events": [],
                "human_requests": [],
                "approval_requests": [{"id": "approval_1", "status": "requested", "reason": "Release signoff"}],
            }
        ],
    }

    workflow_sync = client.get(f"/api/orbits/{orbit['id']}/workflow", headers=headers)
    assert workflow_sync.status_code == 200

    first_resolution = client.post(
        f"/api/orbits/{orbit['id']}/workflow/approval-requests/resolve",
        json={"workflow_run_id": work_item["workflow_ref"], "request_id": "approval_1", "approved": True},
        headers=headers,
    )
    assert first_resolution.status_code == 200
    assert len(client.app.state.runtime_manager.approvals) == 1

    second_resolution = client.post(
        f"/api/orbits/{orbit['id']}/workflow/approval-requests/resolve",
        json={"workflow_run_id": work_item["workflow_ref"], "request_id": "approval_1", "approved": True},
        headers=headers,
    )
    assert second_resolution.status_code == 200
    assert second_resolution.json()["idempotent"] is True
    assert len(client.app.state.runtime_manager.approvals) == 1

    conflicting_resolution = client.post(
        f"/api/orbits/{orbit['id']}/workflow/approval-requests/resolve",
        json={"workflow_run_id": work_item["workflow_ref"], "request_id": "approval_1", "approved": False},
        headers=headers,
    )
    assert conflicting_resolution.status_code == 409


def test_owner_can_change_member_roles(client):
    owner_token, _ = _login(client)
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    orbit = _create_orbit(client, owner_headers)

    second_login = client.post("/api/auth/github-token", json={"token": "ghp_example_token_value_second"})
    assert second_login.status_code == 200
    teammate_headers = {"Authorization": f"Bearer {second_login.json()['token']}"}

    invite = client.post(
        f"/api/orbits/{orbit['id']}/invites",
        json={"email": "teammate@example.com"},
        headers=owner_headers,
    )
    assert invite.status_code == 200
    accept = client.post(f"/api/invites/{invite.json()['token']}/accept", headers=teammate_headers)
    assert accept.status_code == 200

    teammate_id = second_login.json()["user"]["id"]
    promote = client.put(
        f"/api/orbits/{orbit['id']}/members/{teammate_id}/role",
        json={"role": "manager"},
        headers=owner_headers,
    )
    assert promote.status_code == 200
    assert promote.json()["role"] == "manager"

    demote = client.put(
        f"/api/orbits/{orbit['id']}/members/{teammate_id}/role",
        json={"role": "viewer"},
        headers=owner_headers,
    )
    assert demote.status_code == 200
    assert demote.json()["role"] == "viewer"

    teammate_orbit = client.get(f"/api/orbits/{orbit['id']}", headers=teammate_headers)
    assert teammate_orbit.status_code == 200
    assert teammate_orbit.json()["permissions"]["orbit_role"] == "viewer"
    assert teammate_orbit.json()["permissions"]["repo_grants"] == {}


def test_orbit_search_endpoint_is_flag_gated_and_returns_artifacts(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    codespace = client.post(
        f"/api/orbits/{orbit['id']}/codespaces",
        json={"name": "Search workspace"},
        headers=headers,
    )
    assert codespace.status_code == 200
    demo = client.post(
        f"/api/orbits/{orbit['id']}/demos",
        json={"title": "Release notes demo", "source_path": codespace.json()["workspace_path"]},
        headers=headers,
    )
    assert demo.status_code == 200

    search = client.get(f"/api/orbits/{orbit['id']}/search?q=release%20notes", headers=headers)
    assert search.status_code == 200
    payload = search.json()
    assert any(item["kind"] == "artifact" and item["label"] == "Release notes demo" for item in payload)

    client.app.state.settings.feature_flags = "ff_repo_installations_v1"
    disabled = client.get(f"/api/orbits/{orbit['id']}/search?q=release", headers=headers)
    assert disabled.status_code == 404


def test_multi_repo_binding_requires_feature_flag_for_secondary_repo(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    client.app.state.settings.feature_flags = "ff_repo_installations_v1"
    response = client.post(
        f"/api/orbits/{orbit['id']}/repositories",
        json={"repo_full_name": "octocat/platform-ops", "make_primary": False},
        headers=headers,
    )
    assert response.status_code == 400
    assert "Multi-repo bindings are not enabled" in response.json()["detail"]


def test_available_repository_listing_is_feature_flagged(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)

    client.app.state.settings.feature_flags = ""
    disabled = client.get(f"/api/orbits/{orbit['id']}/available-repositories", headers=headers)
    assert disabled.status_code == 404

    client.app.state.settings.feature_flags = "ff_repo_installations_v1"
    enabled = client.get(f"/api/orbits/{orbit['id']}/available-repositories", headers=headers)
    assert enabled.status_code == 200
    assert any(item["full_name"] == "octocat/platform-ops" for item in enabled.json())


def test_get_orbit_backfills_primary_repository_binding_from_legacy_orbit_fields(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)
    engine = get_engine()

    with OrmSession(engine) as db:
        db.query(RepoGrant).filter(RepoGrant.orbit_id == orbit["id"]).delete()
        db.query(OrbitRepositoryBinding).filter(OrbitRepositoryBinding.orbit_id == orbit["id"]).delete()
        db.query(RepositoryConnection).delete()
        db.commit()

    response = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert response.status_code == 200
    payload = response.json()
    assert payload["orbit"]["repo_full_name"] == "octocat/orbit-control"
    assert payload["repositories"][0]["full_name"] == "octocat/orbit-control"

    with OrmSession(engine) as db:
        rebuilt_binding = db.scalar(
            select(OrbitRepositoryBinding).where(
                OrbitRepositoryBinding.orbit_id == orbit["id"],
                OrbitRepositoryBinding.is_primary.is_(True),
            )
        )
        assert rebuilt_binding is not None
        rebuilt_repository = db.get(RepositoryConnection, rebuilt_binding.repository_connection_id)
        assert rebuilt_repository is not None
        assert rebuilt_repository.full_name == "octocat/orbit-control"


def test_get_orbit_marks_general_conversation_seen(client):
    token, _ = _login(client)
    headers = {"Authorization": f"Bearer {token}"}
    orbit = _create_orbit(client, headers)
    engine = get_engine()

    post_message = client.post(
        f"/api/orbits/{orbit['id']}/messages",
        json={"body": "General channel should count as seen on orbit load."},
        headers=headers,
    )
    assert post_message.status_code == 200
    last_message_id = post_message.json()["message"]["id"]

    orbit_response = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_response.status_code == 200

    with OrmSession(engine) as db:
        general = db.scalar(select(Channel).where(Channel.orbit_id == orbit["id"], Channel.slug == "general"))
        assert general is not None
        state = db.scalar(
            select(ConversationState).where(
                ConversationState.orbit_id == orbit["id"],
                ConversationState.user_id == orbit_response.json()["members"][0]["user_id"],
                ConversationState.channel_id == general.id,
            )
        )
        assert state is not None
        assert state.last_seen_message_id == last_message_id


def test_contributor_cannot_publish_demo_but_manager_can(client):
    owner_token, _ = _login(client)
    owner_headers = {"Authorization": f"Bearer {owner_token}"}
    orbit = _create_orbit(client, owner_headers)

    second_login = client.post("/api/auth/github-token", json={"token": "ghp_example_token_value_second"})
    assert second_login.status_code == 200
    teammate_id = second_login.json()["user"]["id"]
    teammate_headers = {"Authorization": f"Bearer {second_login.json()['token']}"}

    invite = client.post(
        f"/api/orbits/{orbit['id']}/invites",
        json={"email": "teammate@example.com"},
        headers=owner_headers,
    )
    assert invite.status_code == 200
    accept = client.post(f"/api/invites/{invite.json()['token']}/accept", headers=teammate_headers)
    assert accept.status_code == 200

    denied = client.post(
        f"/api/orbits/{orbit['id']}/demos",
        json={"title": "Teammate demo", "source_path": "orbits/orbit-control/codespaces/demo"},
        headers=teammate_headers,
    )
    assert denied.status_code == 403

    promote = client.put(
        f"/api/orbits/{orbit['id']}/members/{teammate_id}/role",
        json={"role": "manager"},
        headers=owner_headers,
    )
    assert promote.status_code == 200

    allowed = client.post(
        f"/api/orbits/{orbit['id']}/demos",
        json={"title": "Teammate demo", "source_path": "orbits/orbit-control/codespaces/demo"},
        headers=teammate_headers,
    )
    assert allowed.status_code == 200
