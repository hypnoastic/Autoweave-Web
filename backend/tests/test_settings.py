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
