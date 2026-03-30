import json
from pathlib import Path

from autoweave_web.core.settings import Settings
from autoweave_web.services.runtime import RuntimeManager


def test_queue_workflow_uses_dispatcher_and_returns_workflow_run_id(monkeypatch, tmp_path: Path) -> None:
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        redis_url="redis://localhost:6379/0",
        runtime_root=tmp_path / "runtime",
        runtime_control_plane=tmp_path / "runtime" / "control-plane",
        runtime_execution_mode="queue",
    )

    captured: dict[str, object] = {}

    class FakeReceipt:
        def to_payload(self) -> dict[str, object]:
            return {
                "workflow_run_id": "run_123",
                "celery_task_id": "celery_456",
                "status": "queued",
                "summary_lines": ["workflow_run_id=run_123"],
            }

    class FakeDispatcher:
        def __init__(self, *, root, environ):
            captured["root"] = root
            captured["environ"] = environ

        def enqueue_new_workflow(self, *, request, dispatch, max_steps):
            captured["request"] = request
            captured["dispatch"] = dispatch
            captured["max_steps"] = max_steps
            return FakeReceipt()

    monkeypatch.setattr("autoweave_web.services.runtime.CeleryWorkflowDispatcher", FakeDispatcher)

    manager = RuntimeManager(settings)
    orbit = type("Orbit", (), {"slug": "orbit-one"})()

    payload = manager.queue_workflow(orbit, request_text="@ERGO build the orbit workflow board")

    assert payload["mode"] == "queue"
    assert payload["workflow_run_id"] == "run_123"
    assert payload["celery_task_id"] == "celery_456"
    assert captured["request"] == "@ERGO build the orbit workflow board"
    assert captured["dispatch"] is True
    assert captured["max_steps"] == 8


def test_monitoring_snapshot_waits_for_fresh_runtime_state(monkeypatch, tmp_path: Path) -> None:
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        redis_url="redis://localhost:6379/0",
        runtime_root=tmp_path / "runtime",
        runtime_control_plane=tmp_path / "runtime" / "control-plane",
        runtime_execution_mode="queue",
    )

    captured: dict[str, object] = {}

    class FakeService:
        def __init__(self, *, root, environ):
            captured["root"] = root
            captured["environ"] = environ

        def snapshot(self, *, limit: int, wait_for_refresh: bool = False, include_jobs: bool = True):
            captured["limit"] = limit
            captured.setdefault("wait_for_refresh", []).append(wait_for_refresh)
            captured.setdefault("include_jobs", []).append(include_jobs)
            return {"status": "ok", "runs": [{"id": "run_123"}], "selected_run_id": "run_123"}

    monkeypatch.setattr("autoweave_web.services.runtime.MonitoringService", FakeService)

    manager = RuntimeManager(settings)
    orbit = type("Orbit", (), {"slug": "orbit-one"})()

    payload = manager.monitoring_snapshot(orbit, limit=3)

    assert payload["selected_run_id"] == "run_123"
    assert captured["limit"] == 3
    assert captured["wait_for_refresh"] == [False]
    assert captured["include_jobs"] == [False]


def test_monitoring_snapshot_falls_back_to_cached_state_when_refresh_hangs(monkeypatch, tmp_path: Path) -> None:
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        redis_url="redis://localhost:6379/0",
        runtime_root=tmp_path / "runtime",
        runtime_control_plane=tmp_path / "runtime" / "control-plane",
        runtime_execution_mode="queue",
    )

    calls = {"count": 0}

    class HangingService:
        def __init__(self, *, root, environ):
            pass

        def snapshot(self, *, limit: int, wait_for_refresh: bool = False, include_jobs: bool = True):
            calls["count"] += 1
            return {
                "status": "loading",
                "load_error": "Loading live workflow state…",
                "runs": [],
                "selected_run_id": None,
                "selected_run": None,
            }

    monkeypatch.setattr("autoweave_web.services.runtime.MonitoringService", HangingService)

    manager = RuntimeManager(settings)
    orbit = type("Orbit", (), {"id": "orbit_123", "slug": "orbit-one"})()
    manager._snapshot_cache["orbit_123"] = {
        "status": "ok",
        "load_error": None,
        "runs": [{"id": "run_cached"}],
        "selected_run_id": "run_cached",
        "selected_run": {"id": "run_cached"},
    }

    payload = manager.monitoring_snapshot(orbit, limit=3, timeout_seconds=0.2)

    assert payload["selected_run_id"] == "run_cached"
    assert payload["status"] == "degraded"
    assert payload["stale"] is True
    assert "timed out" in payload["load_error"]
    assert calls["count"] >= 2


def test_monitoring_snapshot_keeps_service_alive_after_timeout(monkeypatch, tmp_path: Path) -> None:
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        redis_url="redis://localhost:6379/0",
        runtime_root=tmp_path / "runtime",
        runtime_control_plane=tmp_path / "runtime" / "control-plane",
        runtime_execution_mode="queue",
    )

    instances: list["EventuallyReadyService"] = []

    class EventuallyReadyService:
        def __init__(self, *, root, environ):
            self.calls = 0
            instances.append(self)

        def snapshot(self, *, limit: int, wait_for_refresh: bool = False, include_jobs: bool = True):
            self.calls += 1
            if self.calls < 4:
                return {
                    "status": "loading",
                    "load_error": "Loading live workflow state…",
                    "runs": [],
                    "selected_run_id": None,
                    "selected_run": None,
                }
            return {
                "status": "ok",
                "load_error": None,
                "runs": [{"id": "run_live"}],
                "selected_run_id": "run_live",
                "selected_run": {"id": "run_live"},
            }

    monkeypatch.setattr("autoweave_web.services.runtime.MonitoringService", EventuallyReadyService)

    manager = RuntimeManager(settings)
    orbit = type("Orbit", (), {"id": "orbit_123", "slug": "orbit-one"})()

    first = manager.monitoring_snapshot(orbit, timeout_seconds=0.05)
    assert first["status"] == "degraded"
    assert first["selected_run_id"] is None

    second = manager.monitoring_snapshot(orbit, timeout_seconds=0.5)
    assert second["selected_run_id"] == "run_live"
    assert len(instances) == 1


def test_orbit_root_seeds_valid_runtime_credentials(tmp_path: Path) -> None:
    source_credentials = tmp_path / "seed-credentials.json"
    source_credentials.write_text(
        json.dumps(
            {
                "type": "service_account",
                "project_id": "autoweave-test",
                "private_key_id": "demo",
                "private_key": "-----BEGIN PRIVATE KEY-----\\ndemo\\n-----END PRIVATE KEY-----\\n",
                "client_email": "demo@example.com",
                "client_id": "123",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/demo",
            }
        ),
        encoding="utf-8",
    )
    settings = Settings(
        database_url="sqlite+pysqlite:///:memory:",
        redis_url="redis://localhost:6379/0",
        runtime_root=tmp_path / "runtime",
        runtime_control_plane=tmp_path / "runtime" / "control-plane",
        runtime_execution_mode="queue",
        runtime_vertex_service_account_file=str(source_credentials),
    )

    manager = RuntimeManager(settings)
    orbit = type("Orbit", (), {"slug": "orbit-one"})()

    orbit_root = manager.orbit_root(orbit)
    seeded = orbit_root / "config" / "secrets" / "vertex_service_account.json"

    assert seeded.exists()
    assert json.loads(seeded.read_text(encoding="utf-8"))["type"] == "service_account"
