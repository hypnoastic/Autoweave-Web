from autoweave_web.core.settings import Settings


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
