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

  test "GET /api/works/:work_id/sessions/resume returns active session snapshot", %{conn: conn, work: work} do
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

  test "POST /api/works/:work_id/sessions creates a session", %{conn: conn, work: work} do
    conn = post(conn, "/api/works/#{work.id}/sessions", %{"title" => "角色动机讨论"})
    body = json_response(conn, 201)

    assert body["session"]["work_id"] == work.id
    assert body["session"]["title"] == "角色动机讨论"
    assert body["session"]["status"] == "ACTIVE"
  end
end
