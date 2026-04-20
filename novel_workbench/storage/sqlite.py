"""SQLite bootstrap helpers."""

from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator


SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect_sqlite(db_path: str | Path) -> sqlite3.Connection:
    """Open a configured SQLite connection for the workbench."""

    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA synchronous = NORMAL")
    return conn


def initialize_database(conn: sqlite3.Connection) -> None:
    """Create the minimal V1 schema if it does not exist."""

    schema_sql = SCHEMA_PATH.read_text(encoding="utf-8")
    conn.executescript(schema_sql)
    conn.commit()


@contextmanager
def open_sqlite(db_path: str | Path, *, initialize: bool = True) -> Iterator[sqlite3.Connection]:
    """Yield a configured SQLite connection and close it afterwards."""

    conn = connect_sqlite(db_path)
    try:
        if initialize:
            initialize_database(conn)
        yield conn
    finally:
        conn.close()
