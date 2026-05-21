defmodule NovelWeb.WorkSessionsControllerTest do
  use NovelWeb.ConnCase, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Repo
  alias NovelPersistence.WorkSessionRepo

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "灵源纪元"})
    %{work: work}
  end

  test "GET /api/works/:work_id/sessions/resume returns active session snapshot", %{
    conn: conn,
    work: work
  } do
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

    {:ok, _} =
      MemoryLog.record(%{
        workspace_id: work.id,
        session_id: session.id,
        turn_id: "turn-1",
        role: "user",
        content: %{text: "第一句"}
      })

    conn = get(conn, "/api/works/#{work.id}/sessions/resume")
    body = json_response(conn, 200)

    assert body["work"]["id"] == work.id
    assert body["active_session"]["id"] == session.id
    assert [%{"text" => "第一句"}] = body["transcript"]
  end

  test "GET /api/works/:work_id/sessions searches sessions", %{conn: conn, work: work} do
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "第三章节奏"})

    {:ok, _} =
      MemoryLog.record(%{
        workspace_id: work.id,
        session_id: session.id,
        turn_id: "turn-1",
        role: "assistant",
        content: %{text: "妹妹林瑶的伏笔"}
      })

    conn = get(conn, "/api/works/#{work.id}/sessions", %{"query" => "林瑶"})
    body = json_response(conn, 200)

    assert [%{"id" => id}] = body["sessions"]
    assert id == session.id
  end

  test "GET /api/works/:work_id/sessions/resume hides archived sessions by default", %{
    conn: conn,
    work: work
  } do
    {:ok, active} = WorkSessionRepo.ensure_active_for_work(work.id)

    {:ok, _archived} =
      WorkSessionRepo.create(%{work_id: work.id, title: "旧会话", status: "ARCHIVED"})

    conn = get(conn, "/api/works/#{work.id}/sessions/resume")
    body = json_response(conn, 200)

    assert [%{"id" => id}] = body["sessions"]
    assert id == active.id
  end

  test "GET /api/works/:work_id/sessions can search archived sessions", %{conn: conn, work: work} do
    {:ok, session} =
      WorkSessionRepo.create(%{
        work_id: work.id,
        title: "归档会话",
        summary: "妹妹林瑶",
        status: "ARCHIVED"
      })

    conn = get(conn, "/api/works/#{work.id}/sessions", %{"query" => "林瑶"})
    body = json_response(conn, 200)

    assert [%{"id" => id, "status" => "ARCHIVED"}] = body["sessions"]
    assert id == session.id
  end

  test "GET /api/works/:work_id/sessions without query hides archived sessions", %{
    conn: conn,
    work: work
  } do
    {:ok, active} = WorkSessionRepo.ensure_active_for_work(work.id)

    {:ok, _archived} =
      WorkSessionRepo.create(%{work_id: work.id, title: "旧会话", status: "ARCHIVED"})

    conn = get(conn, "/api/works/#{work.id}/sessions")
    body = json_response(conn, 200)

    assert [%{"id" => id}] = body["sessions"]
    assert id == active.id
  end

  test "GET /api/works/:work_id/sessions/:id returns read-only history transcript", %{
    conn: conn,
    work: work
  } do
    {:ok, session} =
      WorkSessionRepo.create(%{work_id: work.id, title: "第三章节奏", status: "EXITED"})

    {:ok, _} =
      MemoryLog.record(%{
        workspace_id: work.id,
        session_id: session.id,
        turn_id: "turn-1",
        role: "assistant",
        content: %{
          text: "妹妹林瑶的伏笔",
          turn_result: %{
            turn_id: "turn-1",
            adoption_state: %{
              pending: [
                %{
                  artifact_id: "artifact-1",
                  artifact_type: "plot_direction",
                  requires_adoption: true,
                  payload: %{}
                }
              ],
              resolved: []
            }
          }
        }
      })

    conn = get(conn, "/api/works/#{work.id}/sessions/#{session.id}")
    body = json_response(conn, 200)

    assert body["session"]["id"] == session.id
    assert body["read_only"] == true
    assert [%{"text" => "妹妹林瑶的伏笔"}] = body["transcript"]
    assert body["pending_adoptions"] == []
  end

  test "GET /api/works/:work_id/sessions/:id rejects cross-work session ids", %{
    conn: conn,
    work: work
  } do
    {:ok, other_work} = WorkService.create(%{title: "另一部作品"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: other_work.id, title: "其他会话"})

    conn = get(conn, "/api/works/#{work.id}/sessions/#{session.id}")

    assert %{"error" => "session_not_found"} = json_response(conn, 404)
  end

  test "POST /api/works/:work_id/sessions creates a session", %{conn: conn, work: work} do
    {:ok, source_session} = WorkSessionRepo.create(%{work_id: work.id, title: "旧会话"})

    conn =
      post(conn, "/api/works/#{work.id}/sessions", %{
        "title" => "角色动机讨论",
        "source_session_ref" => source_session.id,
        "source_turn_ref" => "turn-history-1"
      })

    body = json_response(conn, 201)

    assert body["session"]["work_id"] == work.id
    assert body["session"]["title"] == "角色动机讨论"
    assert body["session"]["status"] == "ACTIVE"
    assert body["session"]["source_session_ref"] == source_session.id
    assert body["session"]["source_turn_ref"] == "turn-history-1"
  end

  test "POST /api/works/:work_id/sessions/:id/archive archives an exited session", %{
    conn: conn,
    work: work
  } do
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "旧会话", status: "EXITED"})

    conn = post(conn, "/api/works/#{work.id}/sessions/#{session.id}/archive")
    body = json_response(conn, 200)

    assert body["session"]["id"] == session.id
    assert body["session"]["status"] == "ARCHIVED"
  end

  test "POST /api/works/:work_id/sessions/:id/archive rejects active session", %{
    conn: conn,
    work: work
  } do
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

    conn = post(conn, "/api/works/#{work.id}/sessions/#{session.id}/archive")

    assert %{"error" => "cannot_archive_active_session"} = json_response(conn, 422)
  end
end
