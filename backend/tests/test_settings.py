from autoweave_web.core.settings import Settings
from autoweave_web.db.session import _engine_kwargs


def test_runtime_postgres_dsn_strips_sqlalchemy_driver_prefix() -> None:
    settings = Settings(
        database_url="postgresql+psycopg://postgres:postgres@postgres:5432/autoweave_web",
        redis_url="redis://localhost:6379/0",
    )

    assert settings.runtime_postgres_dsn == "postgresql://postgres:postgres@postgres:5432/autoweave_web"
    assert settings.runtime_environ()["POSTGRES_URL"] == "postgresql://postgres:postgres@postgres:5432/autoweave_web"


def test_runtime_postgres_dsn_prefers_explicit_runtime_url() -> None:
    settings = Settings(
        database_url="postgresql+psycopg://postgres:postgres@postgres:5432/autoweave_web",
        runtime_postgres_url="postgresql://runtime:secret@db:5432/autoweave_runtime",
        redis_url="redis://localhost:6379/0",
    )

    assert settings.runtime_postgres_dsn == "postgresql://runtime:secret@db:5432/autoweave_runtime"


def test_runtime_environ_derives_vertex_project_from_credentials(tmp_path) -> None:
    credentials = tmp_path / "vertex_service_account.json"
    credentials.write_text(
        '{"type":"service_account","project_id":"ergon-488918"}',
        encoding="utf-8",
    )
    settings = Settings(
        database_url="postgresql+psycopg://postgres:postgres@postgres:5432/autoweave_web",
        redis_url="redis://localhost:6379/0",
        runtime_vertex_project="",
        runtime_vertex_service_account_file=str(credentials),
    )

    assert settings.resolved_runtime_vertex_project == "ergon-488918"
    assert settings.runtime_environ()["VERTEXAI_PROJECT"] == "ergon-488918"


def test_runtime_postgres_dsn_falls_back_to_hosted_library_env(monkeypatch) -> None:
    monkeypatch.setenv("POSTGRES_URL", "postgresql://runtime:secret@neon-host/autoweave_runtime")
    settings = Settings(
        database_url="postgresql+psycopg://postgres:postgres@postgres:5432/autoweave_web",
        redis_url="redis://localhost:6379/1",
        runtime_postgres_url="",
    )

    assert settings.runtime_postgres_dsn == "postgresql://runtime:secret@neon-host/autoweave_runtime"
    assert settings.runtime_environ()["POSTGRES_URL"] == "postgresql://runtime:secret@neon-host/autoweave_runtime"


def test_runtime_environ_uses_hosted_graph_env_when_runtime_values_blank(monkeypatch) -> None:
    monkeypatch.setenv("NEO4J_URL", "neo4j+s://example.databases.neo4j.io")
    monkeypatch.setenv("NEO4J_USERNAME", "neo4j")
    monkeypatch.setenv("NEO4J_PASSWORD", "secret")
    settings = Settings(
        database_url="postgresql+psycopg://postgres:postgres@postgres:5432/autoweave_web",
        redis_url="redis://localhost:6379/1",
        runtime_neo4j_url="",
        runtime_neo4j_username="",
        runtime_neo4j_password="",
    )

    assert settings.runtime_environ()["NEO4J_URL"] == "neo4j+s://example.databases.neo4j.io"
    assert settings.runtime_environ()["NEO4J_USERNAME"] == "neo4j"
    assert settings.runtime_environ()["NEO4J_PASSWORD"] == "secret"
    assert settings.runtime_environ()["AUTOWEAVE_GRAPH_BACKEND"] == "neo4j"


def test_product_and_runtime_redis_use_separate_defaults(monkeypatch) -> None:
    monkeypatch.delenv("REDIS_URL", raising=False)
    monkeypatch.delenv("RUNTIME_REDIS_URL", raising=False)
    settings = Settings(
        database_url="postgresql+psycopg://postgres:postgres@postgres:5432/autoweave_web",
    )

    assert settings.redis_url == "redis://redis:6379/1"
    assert settings.runtime_environ()["REDIS_URL"] == "redis://redis:6379/0"


def test_postgres_engine_uses_pre_ping_and_recycle() -> None:
    settings = Settings(
        database_url="postgresql+psycopg://postgres:postgres@postgres:5432/autoweave_web",
        redis_url="redis://localhost:6379/1",
    )

    kwargs = _engine_kwargs(settings)

    assert kwargs["pool_pre_ping"] is True
    assert kwargs["pool_recycle"] == 1800
