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
from novel_workbench.orchestrator import AgentOrchestrator


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
                
                # Handle /api/chat (work-less chat)
                if parts == ["api", "chat"] and method == "POST":
                    return self._handle_chat()

                # /api/interactions (workless orchestrator turn)
                if parts == ["api", "interactions"] and method == "POST":
                    return self._handle_create_workless_interaction()

                # All other routes must start with /api/works
                if parts[:2] != ["api", "works"]:
                    return self._send_error(HTTPStatus.NOT_FOUND, "route not found")
                
                # /api/works
                if len(parts) == 2 and method == "GET":
                    return self._handle_list_works()
                if len(parts) == 2 and method == "POST":
                    return self._handle_create_work()
                
                # /api/works/{id}
                if len(parts) == 3 and method == "GET":
                    return self._handle_get_work(parts[2])
                
                # /api/works/{id}/chat
                if len(parts) == 4 and parts[3] == "chat" and method == "POST":
                    return self._handle_chat(parts[2])

                # /api/works/{id}/route
                if len(parts) == 4 and parts[3] == "route" and method == "POST":
                    return self._handle_route(parts[2])

                # /api/works/{id}/execute
                if len(parts) == 4 and parts[3] == "execute" and method == "POST":
                    return self._handle_execute(parts[2])

                # /api/works/{id}/interactions
                if len(parts) == 4 and parts[3] == "interactions" and method == "GET":
                    return self._handle_list_interactions(parts[2])
                if len(parts) == 4 and parts[3] == "interactions" and method == "POST":
                    return self._handle_create_interaction(parts[2])

                # /api/works/{id}/workbench
                if len(parts) == 4 and parts[3] == "workbench" and method == "GET":
                    return self._handle_workbench(parts[2])
                
                # /api/works/{id}/reading
                if len(parts) == 4 and parts[3] == "reading" and method == "GET":
                    return self._handle_reading(parts[2])
                
                # /api/works/{id}/characters/refine
                if (
                    len(parts) == 5
                    and parts[3] == "characters"
                    and parts[4] == "refine"
                    and method == "POST"
                ):
                    return self._handle_refine_character(parts[2])

                # /api/works/{id}/chapters/{id}
                if len(parts) == 5 and parts[3] == "chapters" and method == "GET":
                    return self._handle_get_chapter(parts[2], parts[4])
                if (
                    len(parts) == 5
                    and parts[3] == "chapters"
                    and parts[4] == "select"
                    and method == "POST"
                ):
                    return self._handle_select_chapter(parts[2])
                if (
                    len(parts) == 5
                    and parts[3] == "chapters"
                    and parts[4] == "ensure"
                    and method == "POST"
                ):
                    return self._handle_ensure_chapter(parts[2])
                
                # /api/works/{id}/chapters/{id}/...
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

        def _handle_chat(self, work_id: str | None = None) -> None:
            payload = self._read_json_body()
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json(
                    service.chat_intent(
                        work_id=work_id,
                        text=str(payload.get("text", "")).strip(),
                    )
                )

        def _handle_route(self, work_id: str) -> None:
            payload = self._read_json_body()
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json(
                    service._route_user_request(
                        work_id=work_id,
                        text=str(payload.get("text", "")).strip(),
                        persist=True,
                    )
                )

        def _handle_execute(self, work_id: str) -> None:
            payload = self._read_json_body()
            route_result = payload.get("routeResult")
            if not isinstance(route_result, dict):
                raise ValueError("routeResult is required and must be an object")
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json(
                    service.execute_router_result(
                        work_id=work_id,
                        route_result=route_result,
                        interaction_id=str(payload.get("interactionId", "")).strip() or None,
                        user_input=str(payload.get("text", "")).strip(),
                        persist=True,
                    )
                )

        def _handle_list_interactions(self, work_id: str) -> None:
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                orchestrator = AgentOrchestrator(service)
                self._send_json({"items": orchestrator.list_turns(work_id=work_id)})

        def _handle_create_workless_interaction(self) -> None:
            payload = self._read_json_body()
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                orchestrator = AgentOrchestrator(service)
                self._send_json(
                    orchestrator.orchestrate_workless_turn(
                        user_message=str(
                            payload.get("user_message", payload.get("text", ""))
                        ).strip(),
                        client_context=payload.get("client_context")
                        if isinstance(payload.get("client_context"), dict)
                        else None,
                    ),
                    status=HTTPStatus.CREATED,
                )

        def _handle_create_interaction(self, work_id: str) -> None:
            payload = self._read_json_body()
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                orchestrator = AgentOrchestrator(service)
                self._send_json(
                    orchestrator.orchestrate_turn(
                        work_id=work_id,
                        user_message=str(
                            payload.get("user_message", payload.get("text", ""))
                        ).strip(),
                        clarification_target_interaction_id=str(
                            payload.get("clarification_target_interaction_id", "")
                        ).strip()
                        or None,
                        client_context=payload.get("client_context")
                        if isinstance(payload.get("client_context"), dict)
                        else None,
                    ),
                    status=HTTPStatus.CREATED,
                )

        def _handle_get_work(self, work_id: str) -> None:
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json({"work": service.get_work(work_id)})

        def _handle_refine_character(self, work_id: str) -> None:
            payload = self._read_json_body()
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                self._send_json(
                    service.refine_character(
                        work_id=work_id,
                        name=str(payload.get("name", "")).strip(),
                        identity=str(payload.get("identity", "")).strip(),
                        role_type=str(payload.get("roleType", "PROTAGONIST")).strip(),
                        core_desire=str(payload.get("coreDesire", "")).strip(),
                    )
                )

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

        def _handle_select_chapter(self, work_id: str) -> None:
            payload = self._read_json_body()
            chapter_id = str(payload.get("chapterId", "")).strip()
            if not chapter_id:
                raise ValueError("chapterId is required")
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                snapshot = service.set_active_chapter(work_id=work_id, chapter_id=chapter_id)
                self._send_json({"workbench": snapshot, "selectedChapterId": chapter_id})

        def _handle_ensure_chapter(self, work_id: str) -> None:
            payload = self._read_json_body()
            order_no = int(payload.get("orderNo", 0) or 0)
            if order_no <= 0:
                raise ValueError("orderNo must be a positive integer")
            with open_sqlite(db_path) as conn:
                service = WorkbenchService(conn)
                chapter = service.ensure_chapter(work_id=work_id, order_no=order_no, activate=True)
                snapshot = service.open_workbench(work_id)
                self._send_json({"workbench": snapshot, "selectedChapterId": chapter["id"]})

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
