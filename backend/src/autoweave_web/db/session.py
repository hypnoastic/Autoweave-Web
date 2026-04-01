from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from functools import lru_cache
from typing import Generator
from uuid import uuid4

from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from autoweave_web.core.settings import Settings, get_settings


def utc_now() -> datetime:
    return datetime.now(tz=timezone.utc)


def generate_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


class Base(DeclarativeBase):
    pass


def _engine_kwargs(settings: Settings) -> dict:
    kwargs: dict = {"future": True}
    if settings.database_url.startswith("sqlite"):
        kwargs["connect_args"] = {"check_same_thread": False}
        if ":memory:" in settings.database_url:
            kwargs["poolclass"] = StaticPool
    elif settings.database_url.startswith("postgres"):
        # Hosted Postgres connections can go stale underneath long-lived app processes.
        # Pre-ping and recycling keep the web API from reusing dead SSL sessions.
        kwargs["pool_pre_ping"] = True
        kwargs["pool_recycle"] = 1800
    return kwargs


@lru_cache(maxsize=1)
def get_engine():
    settings = get_settings()
    return create_engine(settings.database_url, **_engine_kwargs(settings))


@lru_cache(maxsize=1)
def get_session_factory():
    return sessionmaker(bind=get_engine(), autoflush=False, autocommit=False, future=True)


def init_database() -> None:
    settings = get_settings()
    engine = get_engine()
    if settings.database_url.startswith("postgres"):
        with engine.begin() as connection:
            connection.execute(text("SELECT 1"))
    from autoweave_web.models import entities  # noqa: F401
    from autoweave_web.db.migrations import run_additive_migrations
    from autoweave_web.services.product_state import backfill_product_models

    Base.metadata.create_all(bind=engine)
    run_additive_migrations(engine)
    with db_session() as db:
        backfill_product_models(db)


def get_db() -> Generator[Session, None, None]:
    db = get_session_factory()()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def db_session() -> Generator[Session, None, None]:
    db = get_session_factory()()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


def reset_database_state() -> None:
    get_session_factory.cache_clear()
    get_engine.cache_clear()
    get_settings.cache_clear()
