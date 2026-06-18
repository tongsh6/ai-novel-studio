defmodule NovelWeb.MemoriesControllerTest do
  use NovelWeb.ConnCase, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{MemoryManagementService, WorkService}
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "记忆 API 作品"})
    %{work: work}
  end

  test "POST and GET /api/works/:work_id/memories use the memoryApi response shape", %{
    conn: conn,
    work: work
  } do
    conn =
      post(conn, "/api/works/#{work.id}/memories", %{
        "content" => "林瑶失踪与灵源矿区有关",
        "summary" => "林瑶矿区线索",
        "type" => MemoryType.foreshadowing(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    body = json_response(conn, 201)
    assert body["ok"] == true
    assert body["data"]["work_id"] == work.id
    assert body["data"]["status"] == MemoryStatus.draft()
    memory_id = body["data"]["id"]

    conn = get(build_conn(), "/api/works/#{work.id}/memories", %{"keyword" => "灵源"})
    body = json_response(conn, 200)

    assert body["ok"] == true
    assert body["count"] == 1
    assert [%{"id" => ^memory_id}] = body["data"]
  end

  test "lifecycle endpoints confirm, lock, and deprecate through application guard", %{
    conn: conn,
    work: work
  } do
    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "灵源矿区不能公开进入",
        "type" => MemoryType.world_rule(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    conn = post(conn, "/api/works/#{work.id}/memories/#{memory.id}/confirm")
    assert json_response(conn, 200)["data"]["status"] == MemoryStatus.confirmed()

    conn = post(build_conn(), "/api/works/#{work.id}/memories/#{memory.id}/lock")
    assert json_response(conn, 200)["data"]["locked"] == true

    conn = post(build_conn(), "/api/works/#{work.id}/memories/#{memory.id}/deprecate")
    body = json_response(conn, 422)
    assert body["ok"] == false
    assert body["error"] == "validation_failed"
    assert %{"status" => [_ | _]} = body["errors"]

    conn = post(build_conn(), "/api/works/#{work.id}/memories/#{memory.id}/unlock")
    assert json_response(conn, 200)["data"]["locked"] == false

    conn = post(build_conn(), "/api/works/#{work.id}/memories/#{memory.id}/deprecate")
    body = json_response(conn, 200)
    assert body["data"]["status"] == MemoryStatus.deprecated()
    assert body["data"]["locked"] == false
    assert body["data"]["recallable"] == false
  end

  test "memory routes never leak records across work ids", %{conn: conn, work: work} do
    {:ok, other_work} = WorkService.create(%{title: "其他作品"})

    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "只属于当前作品",
        "type" => MemoryType.world_rule(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    conn = get(conn, "/api/works/#{other_work.id}/memories/#{memory.id}")
    body = json_response(conn, 404)

    assert body["ok"] == false
    assert body["error"] == "memory_not_found"
  end

  test "recall and references endpoints return JSON-safe DTOs", %{conn: conn, work: work} do
    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "林烬会因为林瑶去灵源矿区",
        "summary" => "林瑶和灵源矿区有关",
        "type" => MemoryType.plot_fact(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    {:ok, confirmed} = MemoryManagementService.confirm(work.id, memory.id)

    {:ok, _reference} =
      MemoryReferenceLog.write(%{
        memory_id: confirmed.id,
        work_id: work.id,
        reference_scene: "recall",
        reference_reason: "作者询问矿区动机"
      })

    conn =
      post(conn, "/api/works/#{work.id}/memories/recall", %{
        "query" => "林烬为什么要去灵源矿区？"
      })

    body = json_response(conn, 200)
    assert body["ok"] == true
    assert body["data"]["candidate_count"] == 1
    assert body["data"]["text"] =~ "灵源矿区"

    conn = get(build_conn(), "/api/works/#{work.id}/memories/#{memory.id}/references")
    body = json_response(conn, 200)
    assert Enum.any?(body["data"], &(&1["reference_reason"] == "作者询问矿区动机"))
  end

  test "missing work returns frontend-compatible error shape", %{conn: conn} do
    missing_work_id = Ecto.UUID.generate()

    conn = get(conn, "/api/works/#{missing_work_id}/memories")
    body = json_response(conn, 404)

    assert body == %{"ok" => false, "error" => "work_not_found"}
  end
end
