from __future__ import annotations

import importlib.metadata
import json
from pathlib import Path
import shutil
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

    def monitoring_snapshot(self, orbit: Orbit, *, limit: int = 8) -> dict[str, Any]:
        service = MonitoringService(root=self.orbit_root(orbit), environ=self.runtime_environ())
        return service.snapshot(limit=limit, wait_for_refresh=True)

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
