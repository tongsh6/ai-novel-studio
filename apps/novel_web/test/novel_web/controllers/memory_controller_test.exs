defmodule NovelWeb.MemoryControllerTest do
  use NovelWeb.ConnCase, async: false

  alias NovelApplication.MemoryService
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.ID

  setup do
    Ecto.Adapters.SQL.Sandbox.checkout(NovelPersistence.Repo)
    work_id = ID.uuid()
    {:ok, work_id: work_id}
  end

  @opts [memory_controller: NovelWeb.MemoryController]

  describe "POST /api/works/:work_id/memories" do
    test "creates a memory", %{conn: conn, work_id: wid} do
      conn = post(conn, "/api/works/#{wid}/memories", %{
        content: "主角叫张三",
        type: MemoryType.character_profile(),
        scope: MemoryScope.work(),
        source_type: MemorySourceType.author_created()
      })

      assert conn.status == 200
      assert %{"ok" => true, "data" => data} = json_response(conn, 200)
      assert data["content"] == "主角叫张三"
      assert data["status"] == "DRAFT"
      assert data["id"] != nil
    end

    test "returns error for missing required fields", %{conn: conn, work_id: wid} do
      conn = post(conn, "/api/works/#{wid}/memories", %{
        content: "test"
      })

      assert %{"ok" => false, "error" => _} = json_response(conn, 200)
    end
  end

  describe "GET /api/works/:work_id/memories" do
    test "lists memories", %{conn: conn, work_id: wid} do
      # Create some memories first
      create_memory(wid, "记忆1", MemoryType.world_rule())
      create_memory(wid, "记忆2", MemoryType.character_profile())

      conn = get(conn, "/api/works/#{wid}/memories")

      assert conn.status == 200
      assert %{"ok" => true, "data" => data, "count" => 2} = json_response(conn, 200)
      assert length(data) == 2
    end

    test "filters by type", %{conn: conn, work_id: wid} do
      create_memory(wid, "记忆1", MemoryType.world_rule())
      create_memory(wid, "记忆2", MemoryType.character_profile())

      conn = get(conn, "/api/works/#{wid}/memories?type=WORLD_RULE")

      assert %{"data" => data, "count" => 1} = json_response(conn, 200)
      assert hd(data)["type"] == "WORLD_RULE"
    end
  end

  describe "GET /api/works/:work_id/memories/:memory_id" do
    test "returns memory detail", %{conn: conn, work_id: wid} do
      {:ok, item} = create_memory(wid, "详情测试", MemoryType.plot_fact())

      conn = get(conn, "/api/works/#{wid}/memories/#{item.id}")

      assert %{"ok" => true, "data" => data} = json_response(conn, 200)
      assert data["content"] == "详情测试"
    end

    test "returns not_found", %{conn: conn, work_id: wid} do
      fake_id = ID.uuid()
      conn = get(conn, "/api/works/#{wid}/memories/#{fake_id}")
      assert %{"ok" => false, "error" => "not_found"} = json_response(conn, 200)
    end
  end

  describe "POST confirm/lock/unlock/deprecate/archive" do
    test "confirm transitions to CONFIRMED", %{conn: conn, work_id: wid} do
      {:ok, item} = create_memory(wid, "待确认", MemoryType.world_rule())

      conn = post(conn, "/api/works/#{wid}/memories/#{item.id}/confirm")

      assert %{"ok" => true, "data" => data} = json_response(conn, 200)
      assert data["status"] == "CONFIRMED"
    end

    test "lock sets locked to true", %{conn: conn, work_id: wid} do
      {:ok, item} = create_memory(wid, "锁定测试", MemoryType.world_rule())

      conn = post(conn, "/api/works/#{wid}/memories/#{item.id}/lock")

      assert %{"ok" => true, "data" => data} = json_response(conn, 200)
      assert data["locked"] == true
    end

    test "unlock sets locked to false", %{conn: conn, work_id: wid} do
      {:ok, item} = create_memory(wid, "解锁测试", MemoryType.world_rule())
      MemoryService.lock(item.id)

      conn = post(conn, "/api/works/#{wid}/memories/#{item.id}/unlock")

      assert %{"ok" => true, "data" => data} = json_response(conn, 200)
      assert data["locked"] == false
    end

    test "deprecate marks deprecated", %{conn: conn, work_id: wid} do
      {:ok, item} = create_memory(wid, "废弃测试", MemoryType.world_rule())

      conn = post(conn, "/api/works/#{wid}/memories/#{item.id}/deprecate")

      assert %{"ok" => true, "data" => data} = json_response(conn, 200)
      assert data["status"] == "DEPRECATED"
      assert data["recallable"] == false
    end

    test "archive marks archived", %{conn: conn, work_id: wid} do
      {:ok, item} = create_memory(wid, "归档测试", MemoryType.world_rule())

      conn = post(conn, "/api/works/#{wid}/memories/#{item.id}/archive")

      assert %{"ok" => true, "data" => data} = json_response(conn, 200)
      assert data["status"] == "ARCHIVED"
    end

    test "locked operation returns error", %{conn: conn, work_id: wid} do
      {:ok, item} = create_memory(wid, "locked", MemoryType.world_rule())
      MemoryService.lock(item.id)

      conn = post(conn, "/api/works/#{wid}/memories/#{item.id}/deprecate")

      assert %{"ok" => false, "error" => "locked"} = json_response(conn, 200)
    end
  end

  describe "PATCH weight/validity" do
    test "updates weight", %{conn: conn, work_id: wid} do
      {:ok, item} = create_memory(wid, "权重测试", MemoryType.world_rule())

      conn = patch(conn, "/api/works/#{wid}/memories/#{item.id}/weight", %{weight: 0.9})

      assert %{"ok" => true, "data" => data} = json_response(conn, 200)
      assert data["weight"] == 0.9
    end

    test "updates validity", %{conn: conn, work_id: wid} do
      {:ok, item} = create_memory(wid, "有效期测试", MemoryType.world_rule())

      conn = patch(conn, "/api/works/#{wid}/memories/#{item.id}/validity", %{
        valid_from: %{"work_id" => wid, "scene_index" => 1},
        valid_until: %{"work_id" => wid, "scene_index" => 5},
        expire_condition: "测试条件"
      })

      assert %{"ok" => true, "data" => data} = json_response(conn, 200)
      assert data["expire_condition"] == "测试条件"
    end
  end

  describe "POST /api/works/:work_id/memories/recall" do
    test "returns recall context", %{conn: conn, work_id: wid} do
      create_memory(wid, "世界没有魔法", MemoryType.world_rule())
      create_memory(wid, "主角叫艾琳", MemoryType.character_profile())

      conn = post(conn, "/api/works/#{wid}/memories/recall", %{
        query: "续写 艾琳",
        token_budget: 1000
      })

      assert %{"ok" => true, "data" => data} = json_response(conn, 200)
      assert is_binary(data["text"])
      assert is_integer(data["iron_law_count"])
      assert is_integer(data["candidate_count"])
    end
  end

  describe "GET /api/works/:work_id/memories/:memory_id/references" do
    test "returns reference logs", %{conn: conn, work_id: wid} do
      {:ok, item} = create_memory(wid, "引用测试", MemoryType.world_rule())

      # Write a reference log
      NovelPersistence.MemoryReferenceLog.write(%{
        memory_id: item.id,
        work_id: wid,
        reference_scene: "testing"
      })

      conn = get(conn, "/api/works/#{wid}/memories/#{item.id}/references")

      assert %{"ok" => true, "data" => data, "count" => 1} = json_response(conn, 200)
      assert hd(data)["reference_scene"] == "testing"
    end
  end

  defp create_memory(work_id, content, type \\ MemoryType.character_profile()) do
    MemoryService.create(%{
      work_id: work_id,
      content: content,
      type: type,
      scope: MemoryScope.work(),
      source_type: MemorySourceType.author_created()
    })
  end
end
