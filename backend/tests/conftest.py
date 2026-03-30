from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("REDIS_URL", "redis://localhost:6379/15")
os.environ.setdefault("BACKEND_BASE_URL", "http://localhost:8000")
os.environ.setdefault("FRONTEND_BASE_URL", "http://localhost:3000")
os.environ.setdefault("GITHUB_CLIENT_ID", "github-client")
os.environ.setdefault("GITHUB_CLIENT_SECRET", "github-secret")
os.environ.setdefault("RUNTIME_EXECUTION_MODE", "inline")
os.environ.setdefault("RUNTIME_ROOT", "/tmp/autoweave-web-tests/runtime")
os.environ.setdefault("RUNTIME_CONTROL_PLANE", "/tmp/autoweave-web-tests/runtime/control-plane")
os.environ.setdefault("RUNTIME_VOLUME_MOUNT_PATH", "/tmp/autoweave-web-tests")

from autoweave_web.api.app import create_app
from autoweave_web.core.settings import get_settings
from autoweave_web.db.session import Base, get_engine, reset_database_state


class FakeGitHubGateway:
    def __init__(self) -> None:
        self.created_repositories: list[dict[str, Any]] = []
        self.created_branches: list[dict[str, Any]] = []
        self.created_prs: list[dict[str, Any]] = []
        self.collaborators: list[dict[str, Any]] = []

    def get_authenticated_user(self, token: str) -> dict[str, Any]:
        if token.endswith("_second"):
            return {
                "id": 202,
                "login": "teammate",
                "name": "Team Mate",
                "avatar_url": "https://example.com/teammate.png",
            }
        return {
            "id": 101,
            "login": "octocat",
            "name": "Octo Cat",
            "avatar_url": "https://example.com/avatar.png",
        }

    def get_primary_email(self, token: str) -> str | None:
        if token.endswith("_second"):
            return "teammate@example.com"
        return "octo@example.com"

    def create_repository(self, token: str, *, name: str, description: str, private: bool) -> dict[str, Any]:
        payload = {
            "name": name,
            "description": description,
            "private": private,
            "owner": {"login": "octocat"},
            "full_name": f"octocat/{name}",
            "html_url": f"https://github.com/octocat/{name}",
            "default_branch": "main",
        }
        self.created_repositories.append(payload)
        return payload

    def list_pull_requests(self, token: str, repo_full_name: str) -> list[dict[str, Any]]:
        return [
            {
                "number": 11,
                "title": "ERGO: orbit workflow board",
                "state": "open",
                "draft": True,
                "html_url": f"https://github.com/{repo_full_name}/pull/11",
                "head": {"ref": "ergo/orbit-workflow-board"},
            }
        ]

    def list_issues(self, token: str, repo_full_name: str) -> list[dict[str, Any]]:
        return [
            {
                "number": 7,
                "title": "Tighten workflow review handoff",
                "state": "open",
                "html_url": f"https://github.com/{repo_full_name}/issues/7",
                "labels": [{"name": "bug"}],
            }
        ]

    def create_branch(self, token: str, repo_full_name: str, *, branch_name: str, base_branch: str) -> None:
        self.created_branches.append({"repo_full_name": repo_full_name, "branch_name": branch_name, "base_branch": base_branch})

    def create_draft_pull_request(
        self,
        token: str,
        repo_full_name: str,
        *,
        title: str,
        head: str,
        base: str,
        body: str,
    ) -> dict[str, Any]:
        payload = {
            "title": title,
            "head": head,
            "base": base,
            "body": body,
            "html_url": f"https://github.com/{repo_full_name}/pull/99",
        }
        self.created_prs.append(payload)
        return payload

    def add_collaborator(self, token: str, repo_full_name: str, github_login: str) -> None:
        self.collaborators.append({"repo_full_name": repo_full_name, "github_login": github_login})


class FakeNavigationStore:
    def __init__(self) -> None:
        self.state: dict[str, dict[str, Any]] = {}

    def get_state(self, user_id: str) -> dict[str, Any] | None:
        return self.state.get(user_id)

    def set_state(self, user_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        self.state[user_id] = payload
        return payload


class FakeContainerOrchestrator:
    def __init__(self) -> None:
        self.workspace_paths: list[str] = []

    def ensure_workspace_clone(self, *, orbit, workspace_path: Path, branch_name: str, clone_url: str | None) -> None:
        workspace_path.mkdir(parents=True, exist_ok=True)
        self.workspace_paths.append(str(workspace_path))

    def start_codespace(self, db, *, orbit, codespace):
        codespace.container_name = f"codespace-{codespace.id}"
        codespace.editor_url = f"http://localhost:9000/{codespace.id}"
        codespace.status = "running"
        db.add(codespace)
        return codespace

    def start_demo(self, db, *, demo):
        demo.container_name = f"demo-{demo.id}"
        demo.url = f"http://localhost:9100/{demo.id}"
        demo.status = "running"
        db.add(demo)
        return demo


class FakeRuntimeManager:
    def __init__(self, settings) -> None:
        self.settings = settings
        self.queued: list[dict[str, Any]] = []
        self.memory_entries: list[dict[str, Any]] = []
        self.answers: list[dict[str, Any]] = []
        self.approvals: list[dict[str, Any]] = []
        self.snapshots: dict[str, dict[str, Any]] = {}

    def orbit_root(self, orbit) -> Path:
        return Path("/tmp/autoweave-web-tests") / orbit.slug

    def package_report(self) -> dict[str, Any]:
        return {
            "version": "0.1.0",
            "module_path": "/venv/lib/python3.12/site-packages/autoweave/__init__.py",
            "installed_package": True,
            "source_tree_bypassed": True,
        }

    def monitoring_snapshot(self, orbit, *, limit: int = 8, timeout_seconds: float = 1.5) -> dict[str, Any]:
        return self.snapshots.get(
            orbit.id,
            {
                "status": "ok",
                "selected_run_id": None,
                "selected_run": None,
                "runs": [],
            },
        )

    def queue_workflow(self, orbit, *, request_text: str) -> dict[str, Any]:
        run_id = f"run_{len(self.queued) + 1}"
        self.queued.append({"orbit_id": orbit.id, "request_text": request_text, "run_id": run_id})
        selected_run = {
            "id": run_id,
            "title": request_text,
            "status": "running",
            "operator_status": "active",
            "operator_summary": "ERGO is executing the workflow.",
            "execution_status": "active",
            "execution_summary": "1 active worker",
            "tasks": [
                {
                    "id": "task_manager",
                    "task_key": "manager_plan",
                    "title": "Manager plan",
                    "assigned_role": "manager",
                    "state": "completed",
                    "description": "Plan the work",
                },
                {
                    "id": "task_frontend",
                    "task_key": "frontend_ui",
                    "title": "Frontend UI",
                    "assigned_role": "frontend",
                    "state": "in_progress",
                    "description": "Build the interface",
                    "worker_summary": "Drafting the orbit interface",
                },
            ],
            "events": [
                {
                    "id": "evt_1",
                    "event_type": "attempt.dispatched",
                    "source": "runtime",
                    "message": "Frontend task dispatched",
                    "sequence_no": 1,
                }
            ],
            "human_requests": [],
            "approval_requests": [],
        }
        self.snapshots[orbit.id] = {
            "status": "ok",
            "selected_run_id": run_id,
            "selected_run": selected_run,
            "runs": [selected_run],
        }
        return {"mode": "queue", "workflow_run_id": run_id}

    def project_context_memory(self, orbit, *, content: str, metadata_json: dict[str, Any]) -> None:
        self.memory_entries.append({"orbit_id": orbit.id, "content": content, "metadata_json": metadata_json})

    def answer_human_request(self, orbit, *, workflow_run_id: str, request_id: str, answer_text: str, max_steps: int = 8) -> dict[str, Any]:
        self.answers.append(
            {
                "orbit_id": orbit.id,
                "workflow_run_id": workflow_run_id,
                "request_id": request_id,
                "answer_text": answer_text,
            }
        )
        return {"workflow_run_id": workflow_run_id, "request_id": request_id, "answer_text": answer_text}

    def resolve_approval_request(self, orbit, *, workflow_run_id: str, request_id: str, approved: bool, max_steps: int = 8) -> dict[str, Any]:
        self.approvals.append(
            {
                "orbit_id": orbit.id,
                "workflow_run_id": workflow_run_id,
                "request_id": request_id,
                "approved": approved,
            }
        )
        return {"workflow_run_id": workflow_run_id, "request_id": request_id, "approved": approved}


@pytest.fixture()
def client():
    reset_database_state()
    settings = get_settings()
    engine = get_engine()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    github = FakeGitHubGateway()
    runtime = FakeRuntimeManager(settings)
    navigation = FakeNavigationStore()
    containers = FakeContainerOrchestrator()
    app = create_app(
        settings=settings,
        github=github,
        runtime_manager=runtime,
        navigation=navigation,
        containers=containers,
    )
    with TestClient(app) as test_client:
        yield test_client

    Base.metadata.drop_all(bind=engine)
