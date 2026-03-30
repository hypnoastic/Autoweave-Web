from __future__ import annotations

import copy
import importlib.metadata
import json
from pathlib import Path
import shutil
from time import monotonic, sleep
from typing import Any

from autoweave import bootstrap_project, build_local_runtime
from autoweave.celery_queue import CeleryWorkflowDispatcher
from autoweave.models import MemoryEntryRecord, MemoryLayer
from autoweave.monitoring import MonitoringService

from autoweave_web.core.settings import Settings
from autoweave_web.models.entities import Orbit


def slugify(value: str) -> str:
    cleaned = "".join(char.lower() if char.isalnum() else "-" for char in value)
    return cleaned.strip("-") or "orbit"


class RuntimeManager:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self._monitoring_services: dict[str, MonitoringService] = {}
        self._snapshot_cache: dict[str, dict[str, Any]] = {}
        self._bootstrap_control_plane()

    def _bootstrap_control_plane(self) -> None:
        self.settings.runtime_control_plane.mkdir(parents=True, exist_ok=True)
        bootstrap_project(self.settings.runtime_control_plane)
        self._seed_runtime_credentials(self.settings.runtime_control_plane)

    def _configured_runtime_credentials(self) -> Path:
        configured = Path(self.settings.runtime_vertex_service_account_file).expanduser()
        if configured.is_absolute():
            return configured
        return (Path.cwd() / configured).resolve()

    @staticmethod
    def _is_valid_google_credentials(path: Path) -> bool:
        if not path.exists() or not path.is_file():
            return False
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return False
        return str(payload.get("type", "")).strip() in {
            "authorized_user",
            "service_account",
            "external_account",
            "external_account_authorized_user",
            "impersonated_service_account",
            "gdch_service_account",
        }

    def _seed_runtime_credentials(self, root: Path) -> None:
        credentials_path = root / "config" / "secrets" / "vertex_service_account.json"
        credentials_path.parent.mkdir(parents=True, exist_ok=True)
        configured = self._configured_runtime_credentials()
        if configured.resolve() == credentials_path.resolve():
            return
        if not self._is_valid_google_credentials(configured):
            return
        if self._is_valid_google_credentials(credentials_path):
            return
        shutil.copy2(configured, credentials_path)

    def orbit_root(self, orbit: Orbit) -> Path:
        root = self.settings.runtime_root / "orbits" / orbit.slug
        root.mkdir(parents=True, exist_ok=True)
        bootstrap_project(root)
        self._seed_runtime_credentials(root)
        return root

    def runtime_environ(self) -> dict[str, str]:
        return self.settings.runtime_environ()

    @staticmethod
    def _orbit_cache_key(orbit: Orbit) -> str:
        return str(getattr(orbit, "id", "") or orbit.slug)

    def _monitoring_service(self, orbit: Orbit) -> MonitoringService:
        cache_key = self._orbit_cache_key(orbit)
        service = self._monitoring_services.get(cache_key)
        if service is None:
            service = MonitoringService(root=self.orbit_root(orbit), environ=self.runtime_environ())
            self._monitoring_services[cache_key] = service
        return service

    @staticmethod
    def _snapshot_is_ready(payload: dict[str, Any]) -> bool:
        return payload.get("status") != "loading"

    def _fallback_snapshot(
        self,
        orbit: Orbit,
        *,
        message: str,
        base_payload: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        cache_key = self._orbit_cache_key(orbit)
        cached = self._snapshot_cache.get(cache_key)
        if cached is not None:
            payload = copy.deepcopy(cached)
        elif base_payload is not None:
            payload = copy.deepcopy(base_payload)
        else:
            payload = {
                "status": "degraded",
                "load_error": None,
                "project_root": str(self.settings.runtime_root / "orbits" / orbit.slug),
                "runs": [],
                "selected_run_id": None,
                "selected_run": None,
                "jobs": [],
                "agents": [],
                "workflow_blueprint": {"name": None, "version": None, "entrypoint": None, "roles": [], "templates": []},
            }
        payload["status"] = "degraded"
        previous_error = str(payload.get("load_error") or "").strip()
        payload["load_error"] = message if not previous_error else f"{previous_error}\n{message}"
        payload["stale"] = cached is not None
        return payload

    def package_report(self) -> dict[str, Any]:
        import autoweave

        module_path = Path(autoweave.__file__).resolve()
        library_root = Path(__file__).resolve().parents[5] / "Autoweave Library"
        return {
            "version": importlib.metadata.version("autoweave"),
            "module_path": str(module_path),
            "installed_package": "site-packages" in str(module_path) or "dist-packages" in str(module_path),
            "source_tree_bypassed": library_root.resolve() not in module_path.parents,
        }

    def monitoring_snapshot(self, orbit: Orbit, *, limit: int = 8, timeout_seconds: float = 1.5) -> dict[str, Any]:
        cache_key = self._orbit_cache_key(orbit)
        service = self._monitoring_service(orbit)
        try:
            payload = service.snapshot(limit=limit, wait_for_refresh=False, include_jobs=False)
        except Exception as exc:
            self._monitoring_services.pop(cache_key, None)
            return self._fallback_snapshot(orbit, message=f"Workflow state unavailable: {exc}")
        if self._snapshot_is_ready(payload):
            self._snapshot_cache[cache_key] = copy.deepcopy(payload)
            return payload
        deadline = monotonic() + max(timeout_seconds, 0.1)
        while monotonic() < deadline:
            sleep(0.1)
            try:
                payload = service.snapshot(limit=limit, wait_for_refresh=False, include_jobs=False)
            except Exception as exc:
                self._monitoring_services.pop(cache_key, None)
                return self._fallback_snapshot(orbit, message=f"Workflow state unavailable: {exc}")
            if self._snapshot_is_ready(payload):
                self._snapshot_cache[cache_key] = copy.deepcopy(payload)
                return payload
        # Keep the monitoring service alive on timeout so the in-flight refresh can
        # finish and populate cache for the next poll instead of restarting from scratch.
        return self._fallback_snapshot(
            orbit,
            base_payload=payload,
            message="Workflow state refresh timed out; showing the last known runtime state.",
        )

    def queue_workflow(self, orbit: Orbit, *, request_text: str) -> dict[str, Any]:
        root = self.orbit_root(orbit)
        environ = self.runtime_environ()
        if self.settings.runtime_execution_mode == "inline":
            with build_local_runtime(root=root, environ=environ) as runtime:
                report = runtime.run_workflow(request=request_text, dispatch=True, max_steps=8)
            return {"mode": "inline", "workflow_run_id": report.workflow_run_id, "summary_lines": report.summary_lines()}

        dispatcher = CeleryWorkflowDispatcher(
            root=root,
            environ=environ,
        )
        receipt = dispatcher.enqueue_new_workflow(
            request=request_text,
            dispatch=True,
            max_steps=8,
        )
        payload = receipt.to_payload()
        payload["mode"] = "queue"
        return payload

    def answer_human_request(
        self,
        orbit: Orbit,
        *,
        workflow_run_id: str,
        request_id: str,
        answer_text: str,
        max_steps: int = 8,
    ) -> dict[str, Any]:
        service = MonitoringService(root=self.orbit_root(orbit), environ=self.runtime_environ())
        return service.answer_human_request(
            workflow_run_id=workflow_run_id,
            request_id=request_id,
            answer_text=answer_text,
            dispatch=True,
            max_steps=max_steps,
        )

    def resolve_approval_request(
        self,
        orbit: Orbit,
        *,
        workflow_run_id: str,
        request_id: str,
        approved: bool,
        max_steps: int = 8,
    ) -> dict[str, Any]:
        service = MonitoringService(root=self.orbit_root(orbit), environ=self.runtime_environ())
        return service.resolve_approval_request(
            workflow_run_id=workflow_run_id,
            request_id=request_id,
            approved=approved,
            dispatch=True,
            max_steps=max_steps,
        )

    def project_context_memory(self, orbit: Orbit, *, content: str, metadata_json: dict[str, Any]) -> None:
        root = self.orbit_root(orbit)
        with build_local_runtime(root=root, environ=self.runtime_environ()) as runtime:
            repository = runtime.storage.workflow_repository
            entry = MemoryEntryRecord(
                project_id=orbit.id,
                scope_type="project",
                scope_id=orbit.id,
                memory_layer=MemoryLayer.SEMANTIC,
                content=content,
                metadata_json=metadata_json,
            )
            if hasattr(repository, "save_memory_entry"):
                repository.save_memory_entry(entry)
            runtime.storage.memory_store.write(entry)
