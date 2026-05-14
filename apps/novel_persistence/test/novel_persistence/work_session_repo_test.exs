defmodule NovelPersistence.WorkSessionRepoTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Repo
  alias NovelPersistence.WorkRepo
  alias NovelPersistence.WorkSessionRepo

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkRepo.create(%{title: "灵源纪元"})
    %{work: work}
  end

  describe "ensure_active_for_work/1" do
    test "creates a default active session for a work", %{work: work} do
      assert {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

      assert session.work_id == work.id
      assert session.title == "默认会话"
      assert session.status == "ACTIVE"
      assert is_binary(session.id)
    end

    test "returns existing active session and updates last_opened_at", %{work: work} do
      assert {:ok, first} = WorkSessionRepo.ensure_active_for_work(work.id)
      Process.sleep(5)

      assert {:ok, second} = WorkSessionRepo.ensure_active_for_work(work.id)

      assert second.id == first.id
      assert DateTime.compare(second.last_opened_at, first.last_opened_at) in [:gt, :eq]
    end
  end

  describe "list_by_work/1" do
    test "lists only sessions from the requested work newest-first", %{work: work} do
      {:ok, other_work} = WorkRepo.create(%{title: "另一个作品"})
      {:ok, old} = WorkSessionRepo.create(%{work_id: work.id, title: "角色动机讨论"})
      Process.sleep(5)
      {:ok, new} = WorkSessionRepo.create(%{work_id: work.id, title: "第三章节奏"})
      {:ok, _other} = WorkSessionRepo.create(%{work_id: other_work.id, title: "不应出现"})

      assert WorkSessionRepo.list_by_work(work.id) |> Enum.map(& &1.id) == [new.id, old.id]
    end
  end

  describe "search/2" do
    test "searches title, summary, and transcript inside one work", %{work: work} do
      {:ok, session} =
        WorkSessionRepo.create(%{
          work_id: work.id,
          title: "第三章节奏",
          summary: "讨论妹妹林瑶的伏笔"
        })

      {:ok, other} = WorkSessionRepo.create(%{work_id: work.id, title: "角色动机"})

      {:ok, _} =
        MemoryLog.record(%{
          workspace_id: work.id,
          session_id: other.id,
          turn_id: "turn-1",
          role: "assistant",
          content: %{text: "这里提到妹妹林瑶的回收方式"}
        })

      results = WorkSessionRepo.search(work.id, "林瑶")

      assert Enum.map(results, & &1.id) |> Enum.sort() == Enum.sort([session.id, other.id])
    end
  end

  describe "transcript/1" do
    test "returns the full session transcript in insertion order", %{work: work} do
      {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})

      {:ok, _} =
        MemoryLog.record(%{
          workspace_id: work.id,
          session_id: session.id,
          turn_id: "turn-1",
          role: "user",
          content: %{text: "第一句"}
        })

      {:ok, _} =
        MemoryLog.record(%{
          workspace_id: work.id,
          session_id: session.id,
          turn_id: "turn-1",
          role: "assistant",
          content: %{text: "第二句"}
        })

      assert WorkSessionRepo.transcript(session.id) |> Enum.map(& &1.content["text"]) == ["第一句", "第二句"]
    end
  end
end
