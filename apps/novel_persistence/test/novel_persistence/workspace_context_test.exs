defmodule NovelPersistence.WorkspaceContextTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelFoundation.Enums.MemoryClass
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.RetentionTier
  alias NovelFoundation.Enums.SourceType
  alias NovelFoundation.ID
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.WorkspaceContext

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  describe "context_fetcher/0" do
    test "returns recent interactions as conversation summary" do
      ws_id = "ws-context-#{System.unique_integer([:positive, :monotonic])}"

      record_interaction(ws_id, "turn-1", "user", "我想写赛博修仙")
      record_interaction(ws_id, "turn-1", "assistant", "可以从灵气代码化切入")

      fetcher = WorkspaceContext.context_fetcher()

      assert {:ok, nil, summary, nil, nil} = fetcher.(ws_id)
      assert String.contains?(summary, "user: 我想写赛博修仙")
      assert String.contains?(summary, "assistant: 可以从灵气代码化切入")
    end

    test "returns nil conversation summary when workspace has no interactions" do
      fetcher = WorkspaceContext.context_fetcher()

      assert {:ok, nil, nil, nil, nil} = fetcher.("ws-empty-context")
    end

    test "returns relevant confirmed memory summary and records references" do
      work_id = ID.uuid()
      memory = insert_memory!(work_id, "林瑶失踪与灵源矿区有关", MemoryStatus.confirmed(), true)
      _draft = insert_memory!(work_id, "矿区里有一条未确认龙线", MemoryStatus.draft(), true)
      _irrelevant = insert_memory!(work_id, "主角喜欢雨夜独行", MemoryStatus.confirmed(), true)

      fetcher = WorkspaceContext.context_fetcher_with_query()

      assert {:ok, nil, nil, summary, nil} = fetcher.(work_id, "林烬为什么要去灵源矿区？")
      assert summary =~ "林瑶失踪与灵源矿区有关"
      refute summary =~ "未确认龙线"
      refute summary =~ "雨夜独行"

      logs = MemoryReferenceLog.by_scene(work_id, "dialogue_context")
      assert length(logs) == 1
      assert hd(logs).memory_id == memory.id
      assert hd(logs).reference_reason =~ "灵源矿区"

      reloaded = Repo.get!(MemoryItem, memory.id)
      assert reloaded.reference_count == memory.reference_count + 1
      assert reloaded.last_referenced_at != nil
    end
  end

  describe "interaction_recorder/0" do
    test "persists multiple entries for later context assembly" do
      ws_id = "ws-recorder-#{System.unique_integer([:positive, :monotonic])}"
      recorder = WorkspaceContext.interaction_recorder()

      assert :ok =
               recorder.(ws_id, [
                 interaction_attrs("turn-r", "user", "第一轮"),
                 interaction_attrs("turn-r", "assistant", "收到第一轮")
               ])

      fetcher = WorkspaceContext.context_fetcher()
      assert {:ok, nil, summary, nil, nil} = fetcher.(ws_id)
      assert String.contains?(summary, "user: 第一轮")
      assert String.contains?(summary, "assistant: 收到第一轮")
    end
  end

  defp record_interaction(ws_id, turn_id, role, text) do
    attrs =
      ws_id
      |> interaction_attrs(turn_id, role, text)
      |> Map.put(:workspace_id, ws_id)

    assert {:ok, _interaction} = MemoryLog.record(attrs)
  end

  defp interaction_attrs(turn_id, role, text) do
    %{
      turn_id: turn_id,
      role: role,
      content: %{text: text},
      memory_class: MemoryClass.episodic(),
      retention_tier: RetentionTier.hot(),
      source_type: SourceType.turn(),
      source_ref: turn_id,
      scope_ref: nil,
      freshness_score: 1.0,
      importance_score: 0.5,
      replayable: true,
      retrievable: true
    }
  end

  defp interaction_attrs(ws_id, turn_id, role, text) do
    turn_id
    |> interaction_attrs(role, text)
    |> Map.put(:scope_ref, ws_id)
  end

  defp insert_memory!(work_id, content, status, recallable) do
    %MemoryItem{}
    |> MemoryItem.changeset(%{
      id: ID.uuid(),
      work_id: work_id,
      content: content,
      summary: content,
      type: MemoryType.plot_fact(),
      scope: MemoryScope.work(),
      status: status,
      source_type: MemorySourceType.author_confirmed(),
      recallable: recallable
    })
    |> Repo.insert!()
  end
end
