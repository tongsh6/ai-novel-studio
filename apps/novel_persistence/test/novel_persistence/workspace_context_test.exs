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
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Work
  alias NovelPersistence.WorkRepo
  alias NovelPersistence.WorkSessionRepo
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

      assert {:ok, nil, summary, nil, nil, [], []} = fetcher.(ws_id)
      assert String.contains?(summary, "user: 我想写赛博修仙")
      assert String.contains?(summary, "assistant: 可以从灵气代码化切入")
    end

    test "returns nil conversation summary when workspace has no interactions" do
      fetcher = WorkspaceContext.context_fetcher()

      assert {:ok, nil, nil, nil, nil, [], []} = fetcher.("ws-empty-context")
    end

    test "returns accepted chapter titles so Planner can resolve continuation target" do
      {:ok, work} = WorkRepo.create(%{title: "续写章节上下文"})

      {:ok, _} =
        AdoptionRepository.persist(%{
          actor_ref: "author",
          work_id: work.id,
          source_turn_ref: "turn-prose",
          artifact_id: "as-prose-1",
          artifact_type: :prose_fragment,
          base_revision: 1,
          content: "林澈摸黑钻进矿道，灵气账单在视网膜上闪着红光。",
          summary: "第01章：底层灵气账单"
        })

      fetcher = WorkspaceContext.context_fetcher()

      assert {:ok, _snapshot, _summary, _mem, _behavior, ["第01章：底层灵气账单"],
              [
                %{
                  title: "第01章：底层灵气账单",
                  seq: 1,
                  summary: "",
                  has_prose: true
                }
              ]} = fetcher.(work.id)
    end

    test "returns relevant confirmed memory summary and records references" do
      work_id = ID.uuid()
      memory = insert_memory!(work_id, "林瑶失踪与灵源矿区有关", MemoryStatus.confirmed(), true)
      _draft = insert_memory!(work_id, "矿区里有一条未确认龙线", MemoryStatus.draft(), true)
      _irrelevant = insert_memory!(work_id, "主角喜欢雨夜独行", MemoryStatus.confirmed(), true)

      fetcher = WorkspaceContext.context_fetcher_with_query()

      assert {:ok, nil, nil, summary, nil, [], []} =
               fetcher.(work_id, "林烬为什么要去灵源矿区？", nil)

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

    test "query fetcher scopes conversation summary to the active session" do
      {:ok, work} = WorkRepo.create(%{title: "会话上下文隔离"})
      {:ok, active_session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})
      {:ok, other_session} = WorkSessionRepo.create(%{work_id: work.id, title: "其他会话"})

      record_interaction(work.id, active_session.id, "turn-a", "user", "第一会话主角叫林烬")
      record_interaction(work.id, other_session.id, "turn-b", "user", "另一个会话主角叫周燃")

      fetcher = WorkspaceContext.context_fetcher_with_query()

      assert {:ok, _snapshot, summary, nil, nil, [], []} =
               fetcher.(work.id, "他叫什么？", active_session.id)

      assert String.contains?(summary, "user: 第一会话主角叫林烬")
      refute String.contains?(summary, "周燃")
    end

    test "current work snapshot uses latest Work facts while transcript stays scoped to active session" do
      {:ok, work} =
        WorkRepo.create(%{
          title: "灵源纪元",
          genre: "东方奇幻",
          core_selling_point: "林澈追查灵源矿区真相",
          target_reader: "喜欢悬疑成长线的读者",
          tone_preference: "克制、悬疑"
        })

      {:ok, active_session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})
      {:ok, history_session} = WorkSessionRepo.create(%{work_id: work.id, title: "历史会话"})

      work
      |> Work.changeset(%{
        core_selling_point: "林澈为寻找妹妹林瑶追查灵源矿区真相",
        tone_preference: "克制、悬疑、带希望感"
      })
      |> Repo.update!()

      record_interaction(work.id, active_session.id, "turn-active", "user", "当前设定：主角现在叫林澈")
      record_interaction(work.id, history_session.id, "turn-history", "user", "旧讨论：主角当时叫林烬")

      fetcher = WorkspaceContext.context_fetcher_with_query()

      assert {:ok, snapshot, summary, nil, nil, [], []} =
               fetcher.(work.id, "主角现在的核心动机是什么？", active_session.id)

      assert snapshot.title == "灵源纪元"
      assert snapshot.genre == "东方奇幻"
      assert snapshot.core_selling_point == "林澈为寻找妹妹林瑶追查灵源矿区真相"
      assert snapshot.target_reader == "喜欢悬疑成长线的读者"
      assert snapshot.tone_preference == "克制、悬疑、带希望感"
      assert snapshot.revision >= 2

      assert summary =~ "主角现在叫林澈"
      refute summary =~ "主角当时叫林烬"
    end

    test "query fetcher excludes archived session transcript from ordinary context" do
      {:ok, work} = WorkRepo.create(%{title: "归档上下文过滤"})
      {:ok, active_session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})

      {:ok, archived_session} =
        WorkSessionRepo.create(%{work_id: work.id, title: "旧会话", status: "ARCHIVED"})

      record_interaction(work.id, active_session.id, "turn-a", "user", "当前会话主角叫林澈")
      record_interaction(work.id, archived_session.id, "turn-b", "user", "归档旧设定主角叫林烬")

      fetcher = WorkspaceContext.context_fetcher_with_query()

      assert {:ok, _snapshot, active_summary, nil, nil, [], []} =
               fetcher.(work.id, "主角叫什么？", active_session.id)

      assert active_summary =~ "林澈"
      refute active_summary =~ "林烬"

      assert {:ok, _snapshot, archived_summary, nil, nil, [], []} =
               fetcher.(work.id, "主角叫什么？", archived_session.id)

      assert archived_summary == nil
    end

    test "workspace fallback context excludes archived session transcript" do
      {:ok, work} = WorkRepo.create(%{title: "默认上下文过滤"})
      {:ok, active_session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})

      {:ok, archived_session} =
        WorkSessionRepo.create(%{work_id: work.id, title: "旧会话", status: "ARCHIVED"})

      record_interaction(work.id, active_session.id, "turn-a", "user", "当前会话事实")
      record_interaction(work.id, archived_session.id, "turn-b", "user", "归档会话事实")

      fetcher = WorkspaceContext.context_fetcher()

      assert {:ok, _snapshot, summary, nil, nil, [], []} = fetcher.(work.id)
      assert summary =~ "当前会话事实"
      refute summary =~ "归档会话事实"
    end

    test "query fetcher returns the latest active session interactions in chronological order" do
      {:ok, work} = WorkRepo.create(%{title: "长会话上下文"})
      {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "长会话"})

      Enum.each(1..12, fn index ->
        record_interaction(work.id, session.id, "turn-#{index}", "user", "第#{index}轮设定")
      end)

      fetcher = WorkspaceContext.context_fetcher_with_query()

      assert {:ok, _snapshot, summary, nil, nil, [], []} =
               fetcher.(work.id, "继续最新设定", session.id)

      assert String.contains?(summary, "会话早期摘要")
      assert String.contains?(summary, "作者提到「第1轮设定」")
      assert String.contains?(summary, "作者提到「第2轮设定」")
      refute String.contains?(summary, "user: 第1轮设定")
      refute String.contains?(summary, "user: 第2轮设定")
      assert String.contains?(summary, "第3轮设定")
      assert String.contains?(summary, "第12轮设定")
      assert String.split(summary, "\n") |> Enum.at(1) == "user: 第3轮设定"
      assert String.split(summary, "\n") |> List.last() == "user: 第12轮设定"

      reloaded = WorkSessionRepo.get_by_work(work.id, session.id)
      assert reloaded.summary =~ "会话早期摘要"
      assert reloaded.summary =~ "第1轮设定"
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
      assert {:ok, nil, summary, nil, nil, [], []} = fetcher.(ws_id)
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

  defp record_interaction(ws_id, session_id, turn_id, role, text) do
    attrs =
      ws_id
      |> interaction_attrs(turn_id, role, text)
      |> Map.put(:workspace_id, ws_id)
      |> Map.put(:session_id, session_id)

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
