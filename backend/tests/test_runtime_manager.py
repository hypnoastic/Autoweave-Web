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

        def snapshot(self, *, limit: int, wait_for_refresh: bool = False):
            captured["limit"] = limit
            captured["wait_for_refresh"] = wait_for_refresh
            return {"status": "ok", "runs": [{"id": "run_123"}], "selected_run_id": "run_123"}

    monkeypatch.setattr("autoweave_web.services.runtime.MonitoringService", FakeService)

    manager = RuntimeManager(settings)
    orbit = type("Orbit", (), {"slug": "orbit-one"})()

    payload = manager.monitoring_snapshot(orbit, limit=3)

    assert payload["selected_run_id"] == "run_123"
    assert captured["limit"] == 3
    assert captured["wait_for_refresh"] is True
