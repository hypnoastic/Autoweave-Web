from __future__ import annotations

from sqlalchemy import inspect, text
from sqlalchemy.engine import Engine


_ADDITIVE_COLUMNS: tuple[tuple[str, tuple[tuple[str, str], ...]], ...] = (
    (
        "product_work_items",
        (
            ("source_channel_id", "VARCHAR(64)"),
            ("source_dm_thread_id", "VARCHAR(64)"),
            ("repo_scope_mode", "VARCHAR(64) DEFAULT 'legacy_primary'"),
        ),
    ),
)


def run_additive_migrations(engine: Engine) -> None:
    inspector = inspect(engine)
    existing_tables = set(inspector.get_table_names())
    with engine.begin() as connection:
        for table_name, columns in _ADDITIVE_COLUMNS:
            if table_name not in existing_tables:
                continue
            existing_columns = {column["name"] for column in inspector.get_columns(table_name)}
            for column_name, column_sql in columns:
                if column_name in existing_columns:
                    continue
                connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_sql}"))
