defmodule NovelWeb.WorksControllerTest do
  use NovelWeb.ConnCase, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    Repo.delete_all(NovelPersistence.Schemas.WorkSession)
    Repo.delete_all(NovelPersistence.Schemas.Work)
    :ok
  end

  test "POST /api/works creates a work and trims the title", %{conn: conn} do
    conn = post(conn, "/api/works", %{"title" => "  灵源纪元  ", "genre" => "玄幻"})
    body = json_response(conn, 201)

    assert body["work"]["title"] == "灵源纪元"
    assert body["work"]["genre"] == "玄幻"
    assert is_integer(body["work"]["revision"])
  end

  test "PATCH /api/works/:id renames a work without changing identity", %{conn: conn} do
    {:ok, work} = WorkService.create(%{title: "未命名作品"})

    conn =
      patch(conn, "/api/works/#{work.id}", %{
        "title" => "灵源纪元",
        "revision" => work.revision
      })

    body = json_response(conn, 200)

    assert body["work"]["id"] == work.id
    assert body["work"]["title"] == "灵源纪元"
    assert body["work"]["revision"] == work.revision + 1
  end

  test "PATCH /api/works/:id reports validation, not found, and revision conflict", %{conn: conn} do
    {:ok, work} = WorkService.create(%{title: "未命名作品"})

    conn = patch(conn, "/api/works/#{work.id}", %{"title" => "   ", "revision" => work.revision})
    assert %{"errors" => %{"title" => [_ | _]}} = json_response(conn, 422)

    conn = patch(build_conn(), "/api/works/#{Ecto.UUID.generate()}", %{"title" => "不存在"})
    assert %{"error" => "work_not_found"} = json_response(conn, 404)

    conn =
      patch(build_conn(), "/api/works/#{work.id}", %{
        "title" => "冲突",
        "revision" => work.revision - 1
      })

    assert %{"error" => "revision_conflict"} = json_response(conn, 409)
  end

  test "POST /api/works/:id/discard safely moves a work out of the default list", %{conn: conn} do
    {:ok, work} = WorkService.create(%{title: "误建作品"})

    conn = post(conn, "/api/works/#{work.id}/discard", %{"revision" => work.revision})
    body = json_response(conn, 200)

    assert body["work"]["id"] == work.id
    assert body["work"]["status"] == "DISCARDED"

    conn = get(build_conn(), "/api/works")
    assert json_response(conn, 200)["works"] == []

    conn = get(build_conn(), "/api/works/#{work.id}")
    assert json_response(conn, 200)["work"]["status"] == "DISCARDED"
  end

  test "POST /api/works/:id/discard reports not found and revision conflict", %{conn: conn} do
    conn = post(conn, "/api/works/#{Ecto.UUID.generate()}/discard")
    assert %{"error" => "work_not_found"} = json_response(conn, 404)

    {:ok, work} = WorkService.create(%{title: "误建作品"})

    conn = post(build_conn(), "/api/works/#{work.id}/discard", %{"revision" => work.revision - 1})
    assert %{"error" => "revision_conflict"} = json_response(conn, 409)
  end
end
