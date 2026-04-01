from __future__ import annotations

import httpx
from fastapi.testclient import TestClient

from autoweave_web.api.app import create_app
from autoweave_web.core.settings import get_settings
from autoweave_web.db.session import Base, get_engine, reset_database_state
from conftest import FakeContainerOrchestrator, FakeGitHubGateway, FakeNavigationStore, FakeRuntimeManager


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
    assert teammate["role"] == "member"

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

    first_load = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert first_load.status_code == 200
    second_load = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert second_load.status_code == 200
    general = next(item for item in second_load.json()["channels"] if item["slug"] == "general")

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
    assert refresh.json() == {"prs": 1, "issues": 1}

    orbit_payload = client.get(f"/api/orbits/{orbit['id']}", headers=headers)
    assert orbit_payload.status_code == 200
    payload = orbit_payload.json()

    assert payload["prs"][0]["operational_status"] == "queued"
    assert payload["issues"][0]["operational_status"] == "queued"


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
