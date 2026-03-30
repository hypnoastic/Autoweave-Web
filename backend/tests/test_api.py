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
