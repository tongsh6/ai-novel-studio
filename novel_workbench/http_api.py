"""Zero-dependency local HTTP API for the dialogue-based novel workbench."""

from __future__ import annotations

import json
import mimetypes
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from novel_workbench import WorkbenchService, open_sqlite


def make_handler(db_path: Path, static_dir: Path):
    class WorkbenchRequestHandler(BaseHTTPRequestHandler):
        server_version = "NovelWorkbenchHTTP/0.1"

        def do_GET(self) -> None:  # noqa: N802
            self._dispatch("GET")

        def do_POST(self) -> None:  # noqa: N802
            self._dispatch("POST")

        def do_OPTIONS(self) -> None:  # noqa: N802
            self.send_response(HTTPStatus.NO_CONTENT)
            self._write_cors_headers()
            self.end_headers()

        def log_message(self, format: str, *args: Any) -> None:
            return

        def _dispatch(self, method: str) -> None:
            parsed = urlparse(self.path)
            parts = [part for part in parsed.path.split("/") if part]
            try:
                if method == "GET" and parsed.path in {"/", "/index.html"}:
                    return self._serve_static_file(static_dir / "index.html")
                if method == "GET" and parsed.path.startswith("/web/"):
                    relative_path = parsed.path.removeprefix("/web/")
                    return self._serve_static_file(static_dir / relative_path)
                if parsed.path == "/api/health" and method == "GET":
                    return self._send_json(
                        {
                            "status": "ok",
                            "service": "dialogue-based-novel-workbench",
                            "dbPath": str(db_path),
                        }
                    )
                if parts[:2] != ["api", "works"]:
                    return self._send_error(HTTPStatus.NOT_FOUND, "route not found")
                if len(parts) == 2 and method == "GET":
                    return self._handle_list_works()
                if len(parts) == 2 and method == "POST":
                    return self._handle_create_work()
                if len(parts) == 3 and method == "GET":
                    return self._handle_get_work(parts[2])
                if len(parts) == 4 and parts[3] == "workbench" and method == "GET":
                    return self._handle_workbench(parts[2])
                if len(parts) == 4 and parts[3] == "reading" and method == "GET":
                    return self._handle_reading(parts[2])
                if len(parts) == 5 and parts[3] == "chapters" and method == "GET":
                    return self._handle_get_chapter(parts[2], parts[4])
                if (
                    len(parts) == 6
                    and parts[3] == "chapters"
                    and parts[5] == "generate-outline"
                    and method == "POST"
                ):
                    return self._handle_generate_outline(parts[2], parts[4])
                if (
                    len(parts) == 6
                    and parts[3] == "chapters"
                    and parts[5] == "generate-draft"
                    and method == "POST"
                ):
                    return self._handle_generate_draft(parts[2], parts[4])
                if (
                    len(parts) == 6
                    and parts[3] == "chapters"
                    and parts[5] == "revise-draft"
                    and method == "POST"
                ):
                    return self._handle_revise_draft(parts[2], parts[4])
                return self._send_error(HTTPStatus.NOT_FOUND, "route not found")
            except KeyError as exc:
                return self._send_error(HTTPStatus.NOT_FOUND, str(exc))
            except ValueError as exc:
                return self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            except Exception as exc:  # pragma: no cover - defensive fallback
                return self._send_error(HTTPStatus.INTERNAL_SERVER_ERROR, str(exc))

        def _handle_list_works(self) -> None:
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json({"works": service.list_works()})

        def _handle_create_work(self) -> None:
            payload = self._read_json_body()
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                snapshot = service.create_work_seed(
                    title=str(payload.get("title", "")).strip(),
                    one_line_pitch=str(payload.get("oneLinePitch", "")).strip(),
                    genre=str(payload.get("genre", "")).strip(),
                    target_platform=str(payload.get("targetPlatform", "起点中文网")).strip(),
                    target_audience=str(payload.get("targetAudience", "网文读者")).strip(),
                )
                self._send_json(snapshot, status=HTTPStatus.CREATED)

        def _handle_get_work(self, work_id: str) -> None:
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json({"work": service.get_work(work_id)})

        def _handle_workbench(self, work_id: str) -> None:
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json(service.open_workbench(work_id))

        def _handle_reading(self, work_id: str) -> None:
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json(service.enter_read_mode(work_id=work_id))

        def _handle_get_chapter(self, work_id: str, chapter_id: str) -> None:
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json(service.get_chapter(work_id=work_id, chapter_id=chapter_id))

        def _handle_generate_outline(self, work_id: str, chapter_id: str) -> None:
            payload = self._read_json_body(optional=True)
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json(
                    service.generate_chapter_outline(
                        work_id=work_id,
                        chapter_id=chapter_id,
                        instruction_text=str(payload.get("instructionText", "")).strip(),
                        rewrite_mode=str(payload.get("rewriteMode", "default")).strip() or "default",
                    )
                )

        def _handle_generate_draft(self, work_id: str, chapter_id: str) -> None:
            payload = self._read_json_body(optional=True)
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json(
                    service.draft_chapter(
                        work_id=work_id,
                        chapter_id=chapter_id,
                        created_by=str(payload.get("createdBy", "system_stub")).strip()
                        or "system_stub",
                        instruction_text=str(payload.get("instructionText", "")).strip(),
                        rewrite_mode=str(payload.get("rewriteMode", "default")).strip() or "default",
                    )
                )

        def _handle_revise_draft(self, work_id: str, chapter_id: str) -> None:
            payload = self._read_json_body(optional=True)
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json(
                    service.revise_draft(
                        work_id=work_id,
                        chapter_id=chapter_id,
                        created_by=str(payload.get("createdBy", "system_stub")).strip()
                        or "system_stub",
                        instruction_text=str(payload.get("instructionText", "")).strip(),
                        revise_mode=str(payload.get("reviseMode", "revise_direct")).strip()
                        or "revise_direct",
                    )
                )

        def _read_json_body(self, *, optional: bool = False) -> dict[str, Any]:
            content_length = int(self.headers.get("Content-Length", "0") or "0")
            if content_length <= 0:
                if optional:
                    return {}
                raise ValueError("request body is required")
            raw = self.rfile.read(content_length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError as exc:
                raise ValueError(f"invalid json body: {exc.msg}") from exc
            if not isinstance(payload, dict):
                raise ValueError("json body must be an object")
            return payload

        def _send_json(self, payload: Any, *, status: HTTPStatus = HTTPStatus.OK) -> None:
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self._write_cors_headers()
            self.end_headers()
            self.wfile.write(body)

        def _send_error(self, status: HTTPStatus, message: str) -> None:
            self._send_json({"error": message}, status=status)

        def _write_cors_headers(self) -> None:
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type")

        def _serve_static_file(self, file_path: Path) -> None:
            try:
                resolved_path = file_path.resolve(strict=True)
                static_root = static_dir.resolve(strict=True)
            except FileNotFoundError:
                return self._send_error(HTTPStatus.NOT_FOUND, "static file not found")
            if static_root not in resolved_path.parents and resolved_path != static_root:
                return self._send_error(HTTPStatus.FORBIDDEN, "invalid static path")
            content_type = mimetypes.guess_type(str(resolved_path))[0] or "application/octet-stream"
            body = resolved_path.read_bytes()
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    return WorkbenchRequestHandler


def create_server(
    *,
    host: str,
    port: int,
    db_path: str | Path,
    static_dir: str | Path,
) -> ThreadingHTTPServer:
    """Create a local HTTP server bound to the given SQLite database."""

    path = Path(db_path)
    handler = make_handler(path, Path(static_dir))
    return ThreadingHTTPServer((host, port), handler)
