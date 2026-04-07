from __future__ import annotations

from functools import lru_cache
import json
import os
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", ".env.local"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "AutoWeave Web"
    environment: str = "development"
    backend_base_url: str = "http://localhost:8000"
    frontend_base_url: str = "http://localhost:3000"
    secret_key: str = "autoweave-web-local-secret"
    session_ttl_seconds: int = 60 * 60 * 24 * 14
    navigation_ttl_seconds: int = 60 * 60 * 24 * 30

    database_url: str = "postgresql+psycopg://postgres:postgres@postgres:5432/autoweave_web"
    redis_url: str = "redis://redis:6379/1"

    github_client_id: str = ""
    github_client_secret: str = ""
    github_oauth_scopes: str = "read:user,user:email,repo"
    github_api_base_url: str = "https://api.github.com"
    github_oauth_authorize_url: str = "https://github.com/login/oauth/authorize"
    github_oauth_access_url: str = "https://github.com/login/oauth/access_token"

    mail_from: str = "hello@autoweave.local"
    smtp_host: str = "mailpit"
    smtp_port: int = 1025

    runtime_root: Path = Field(default=Path("/srv/autoweave/runtime"))
    runtime_control_plane: Path = Field(default=Path("/srv/autoweave/runtime/control-plane"))
    runtime_volume_mount_path: Path = Field(default=Path("/srv/autoweave"))
    runtime_postgres_url: str = ""
    runtime_postgres_schema: str = "autoweave_runtime"
    runtime_redis_url: str = "redis://redis:6379/0"
    runtime_neo4j_url: str = ""
    runtime_neo4j_username: str = ""
    runtime_neo4j_password: str = ""
    runtime_artifact_store_url: str = "file://./var/artifacts"
    runtime_openhands_base_url: str = "http://openhands-agent-server:8000"
    runtime_openhands_api_key: str = ""
    runtime_vertex_project: str = ""
    runtime_vertex_location: str = "global"
    runtime_vertex_service_account_file: str = "./config/secrets/vertex_service_account.json"
    runtime_execution_mode: str = "queue"
    runtime_volume_name: str = "autoweave_web_runtime"

    codespace_image: str = "codercom/code-server:latest"
    demo_image: str = "python:3.12-slim"

    default_repo_private: bool = True
    feature_flags: str = (
        "ff_repo_installations_v1,ff_multi_repo_scope_v1,ff_human_loop_cards_v1,ff_inbox_v2,"
        "ff_artifact_center_v1,ff_search_command_v1"
    )

    matrix_homeserver_public_url: str = "http://localhost:8008"
    matrix_homeserver_internal_url: str = "http://synapse:8008"
    matrix_server_name: str = "autoweave.local"
    matrix_registration_shared_secret: str = ""
    matrix_password_salt: str = "autoweave-matrix-local"
    matrix_sync_timeout_ms: int = 15000
    matrix_sync_enabled: bool = False
    matrix_bridge_localpart: str = "autoweave-bridge"

    @property
    def github_oauth_callback_url(self) -> str:
        return f"{self.frontend_base_url}/auth/callback"

    @property
    def runtime_postgres_dsn(self) -> str:
        raw_value = (
            self.runtime_postgres_url.strip()
            or os.environ.get("POSTGRES_URL", "").strip()
            or self.database_url
        )
        if raw_value.startswith("postgresql+"):
            dialect, remainder = raw_value.split("://", 1)
            return f"{dialect.split('+', 1)[0]}://{remainder}"
        return raw_value

    @property
    def resolved_runtime_neo4j_url(self) -> str:
        return self.runtime_neo4j_url.strip() or os.environ.get("NEO4J_URL", "").strip()

    @property
    def resolved_runtime_neo4j_username(self) -> str:
        return self.runtime_neo4j_username.strip() or os.environ.get("NEO4J_USERNAME", "").strip()

    @property
    def resolved_runtime_neo4j_password(self) -> str:
        return self.runtime_neo4j_password.strip() or os.environ.get("NEO4J_PASSWORD", "").strip()

    @property
    def resolved_runtime_vertex_project(self) -> str:
        configured = self.runtime_vertex_project.strip()
        if configured and configured != "autoweave-web-local":
            return configured
        credentials_path = Path(self.runtime_vertex_service_account_file).expanduser()
        if not credentials_path.exists():
            return configured
        try:
            payload = json.loads(credentials_path.read_text(encoding="utf-8"))
        except (OSError, ValueError, TypeError):
            return configured
        project_id = str(payload.get("project_id") or "").strip()
        return project_id or configured

    def runtime_environ(self) -> dict[str, str]:
        return {
            "VERTEXAI_PROJECT": self.resolved_runtime_vertex_project,
            "VERTEXAI_LOCATION": self.runtime_vertex_location,
            "VERTEXAI_SERVICE_ACCOUNT_FILE": self.runtime_vertex_service_account_file,
            "GOOGLE_APPLICATION_CREDENTIALS": self.runtime_vertex_service_account_file,
            "POSTGRES_URL": self.runtime_postgres_dsn,
            "REDIS_URL": self.runtime_redis_url,
            "NEO4J_URL": self.resolved_runtime_neo4j_url,
            "NEO4J_USERNAME": self.resolved_runtime_neo4j_username,
            "NEO4J_PASSWORD": self.resolved_runtime_neo4j_password,
            "ARTIFACT_STORE_URL": self.runtime_artifact_store_url,
            "OPENHANDS_AGENT_SERVER_BASE_URL": self.runtime_openhands_base_url,
            "OPENHANDS_AGENT_SERVER_API_KEY": self.runtime_openhands_api_key,
            "AUTOWEAVE_CANONICAL_BACKEND": "postgres" if self.runtime_postgres_dsn.startswith("postgres") else "sqlite",
            "AUTOWEAVE_GRAPH_BACKEND": "neo4j" if self.resolved_runtime_neo4j_url else "sqlite",
            "AUTOWEAVE_POSTGRES_SCHEMA": self.runtime_postgres_schema,
        }

    @property
    def enabled_feature_flags(self) -> set[str]:
        raw_values = self.feature_flags.replace(";", ",").replace(" ", ",")
        return {value.strip() for value in raw_values.split(",") if value.strip()}

    def feature_enabled(self, flag_name: str) -> bool:
        return flag_name in self.enabled_feature_flags

    @property
    def matrix_bridge_user_id(self) -> str:
        return f"@{self.matrix_bridge_localpart}:{self.matrix_server_name}"

    @property
    def is_sqlite(self) -> bool:
        return self.database_url.startswith("sqlite")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
