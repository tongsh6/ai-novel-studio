#!/usr/bin/env python3
"""Run the local HTTP API for the dialogue-based novel workbench."""

from __future__ import annotations

import os
from pathlib import Path

from novel_workbench.http_api import create_server


ROOT = Path(__file__).resolve().parent
DEFAULT_DB_PATH = ROOT / "data" / "workbench.sqlite3"
DEFAULT_STATIC_DIR = ROOT / "web"


def main() -> None:
    host = os.getenv("HOST", "127.0.0.1").strip() or "127.0.0.1"
    port = int(os.getenv("PORT", "8000"))
    db_path = Path(os.getenv("NOVEL_WORKBENCH_DB", str(DEFAULT_DB_PATH))).expanduser()
    static_dir = Path(os.getenv("NOVEL_WORKBENCH_STATIC_DIR", str(DEFAULT_STATIC_DIR))).expanduser()

    server = create_server(host=host, port=port, db_path=db_path, static_dir=static_dir)
    print(f"Novel Workbench API listening on http://{host}:{port}")
    print(f"SQLite DB: {db_path}")
    print(f"Static dir: {static_dir}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
