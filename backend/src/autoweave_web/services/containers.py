from __future__ import annotations

import subprocess
from pathlib import Path

import docker
from docker.errors import DockerException, NotFound
from sqlalchemy.orm import Session

from autoweave_web.core.settings import Settings
from autoweave_web.models.entities import Codespace, Demo, Orbit


def _slug(value: str) -> str:
    return "".join(char.lower() if char.isalnum() else "-" for char in value).strip("-") or "workspace"


class ContainerOrchestrator:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        try:
            self.client = docker.from_env()
        except DockerException:
            self.client = None

    def _runtime_subpath(self, relative_path: str) -> str:
        try:
            runtime_relative = self.settings.runtime_root.relative_to(self.settings.runtime_volume_mount_path)
        except ValueError:
            runtime_relative = Path(self.settings.runtime_root.name)
        cleaned = relative_path.strip("/")
        suffix = f"/{cleaned}" if cleaned else ""
        return f"/workspace-root/{runtime_relative.as_posix()}{suffix}"

    def _replace_existing_container(self, container_name: str) -> None:
        if self.client is None:
            return
        try:
            existing = self.client.containers.get(container_name)
        except NotFound:
            return
        existing.remove(force=True)

    def ensure_workspace_clone(
        self,
        *,
        orbit: Orbit,
        workspace_path: Path,
        branch_name: str,
        clone_url: str | None,
    ) -> None:
        workspace_path.mkdir(parents=True, exist_ok=True)
        if (workspace_path / ".git").exists():
            subprocess.run(["git", "-C", str(workspace_path), "checkout", branch_name], check=False)
            subprocess.run(["git", "-C", str(workspace_path), "pull", "--ff-only"], check=False)
            return
        if clone_url:
            subprocess.run(["git", "clone", clone_url, str(workspace_path)], check=False)
            subprocess.run(["git", "-C", str(workspace_path), "checkout", branch_name], check=False)
            return
        subprocess.run(["git", "init", str(workspace_path)], check=False)
        (workspace_path / "README.md").write_text(f"# {orbit.name}\n", encoding="utf-8")
        subprocess.run(["git", "-C", str(workspace_path), "checkout", "-b", branch_name], check=False)

    def start_codespace(self, db: Session, *, orbit: Orbit, codespace: Codespace) -> Codespace:
        if self.client is None:
            codespace.status = "offline"
            return codespace
        container_name = f"autoweave-codespace-{codespace.id}"
        relative_workspace = codespace.workspace_path
        self._replace_existing_container(container_name)
        container = self.client.containers.run(
            self.settings.codespace_image,
            detach=True,
            name=container_name,
            ports={"8080/tcp": None},
            volumes={
                self.settings.runtime_volume_name: {
                    "bind": "/workspace-root",
                    "mode": "rw",
                }
            },
            command=["--bind-addr", "0.0.0.0:8080", "--auth", "none", self._runtime_subpath(relative_workspace)],
        )
        container.reload()
        port = container.attrs["NetworkSettings"]["Ports"]["8080/tcp"][0]["HostPort"]
        codespace.container_name = container_name
        codespace.editor_url = f"http://localhost:{port}"
        codespace.status = "running"
        db.add(codespace)
        return codespace

    def start_demo(self, db: Session, *, demo: Demo) -> Demo:
        if self.client is None:
            demo.status = "offline"
            return demo
        container_name = f"autoweave-demo-{demo.id}"
        self._replace_existing_container(container_name)
        container = self.client.containers.run(
            self.settings.demo_image,
            detach=True,
            name=container_name,
            ports={"8000/tcp": None},
            volumes={
                self.settings.runtime_volume_name: {
                    "bind": "/workspace-root",
                    "mode": "ro",
                }
            },
            command=[
                "sh",
                "-lc",
                f"cd {self._runtime_subpath(demo.source_path)} && python -m http.server 8000",
            ],
        )
        container.reload()
        port = container.attrs["NetworkSettings"]["Ports"]["8000/tcp"][0]["HostPort"]
        demo.container_name = container_name
        demo.url = f"http://localhost:{port}"
        demo.status = "running"
        db.add(demo)
        return demo
