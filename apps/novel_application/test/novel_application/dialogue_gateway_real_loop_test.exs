defmodule NovelApplication.DialogueGatewayRealLoopTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.DialogueGateway
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.ID
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.WorkRepo
  alias NovelPersistence.WorkSessionRepo
  alias NovelPersistence.WorkspaceContext

  @frame_json """
  {
    "frame_type": "casual_reply",
    "dialogue_goal_summary": "用户发来消息",
    "needs_tool": false,
    "no_tool_reason": "no_tool_needed",
    "execution_readiness": "not_applicable",
    "assistant_message": "收到你的消息。",
    "candidate_directions": [],
    "context_used": false,
    "uncertainty": []
  }
  """

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  describe "real persistence loop" do
    test "records one turn and injects it into the next turn prompt" do
      ws_id = "ws-real-loop-#{System.unique_integer([:positive, :monotonic])}"
      fetcher = WorkspaceContext.context_fetcher()
      recorder = WorkspaceContext.interaction_recorder()
      complete_fn = capturing_complete_fn()

      assert {:ok, _turn_result, _trace, _candidates, _context} =
               DialogueGateway.handle_input(
                 %{text: "第一轮要记住：主角叫林烬。", workspace_id: ws_id},
                 fetcher,
                 complete_fn,
                 nil,
                 recorder
               )

      assert {:ok, _turn_result, _trace, _candidates, second_context} =
               DialogueGateway.handle_input(
                 %{text: "第二轮：他现在叫什么？", workspace_id: ws_id},
                 fetcher,
                 complete_fn,
                 nil,
                 recorder
               )

      [first_messages, second_messages] = captured_prompts(complete_fn)

      refute history_text(first_messages) =~ "第一轮要记住"
      assert String.contains?(second_context.conversation_summary, "user: 第一轮要记住：主角叫林烬。")
      assert String.contains?(second_context.conversation_summary, "assistant: 收到你的消息。")
      assert Enum.map(second_messages, & &1.role) == ["system", "user", "assistant", "user"]
      assert history_text(second_messages) =~ "第一轮要记住：主角叫林烬。"
      assert List.last(second_messages).content == "第二轮：他现在叫什么？"
      refute system_text(second_messages) =~ "user: 第一轮要记住"
    end

    test "records session_id and assistant turn_result for resume hydration" do
      {:ok, work} = WorkRepo.create(%{title: "会话作品"})
      {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})
      recorder = WorkspaceContext.interaction_recorder()

      assert {:ok, turn_result, _trace, _candidates, _context} =
               DialogueGateway.handle_input(
                 %{text: "第一轮", workspace_id: work.id, session_id: session.id},
                 nil,
                 capturing_complete_fn(),
                 nil,
                 recorder
               )

      transcript = MemoryLog.transcript(session.id)

      assert Enum.map(transcript, & &1.role) == ["user", "assistant"]
      assert Enum.all?(transcript, &(&1.session_id == session.id))

      assistant = Enum.find(transcript, &(&1.role == "assistant"))
      assert get_in(assistant.content, ["turn_result", "turn_id"]) == turn_result.turn_id
    end

    test "injects only active session transcript into the next prompt" do
      {:ok, work} = WorkRepo.create(%{title: "会话上下文作品"})
      {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})
      {:ok, other_session} = WorkSessionRepo.create(%{work_id: work.id, title: "其他会话"})

      seed_interaction(work.id, other_session.id, "turn-other", "user", "另一个会话主角叫周燃")

      fetcher = WorkspaceContext.context_fetcher_with_query()
      recorder = WorkspaceContext.interaction_recorder()
      complete_fn = capturing_complete_fn()

      assert {:ok, _turn_result, _trace, _candidates, _context} =
               DialogueGateway.handle_input(
                 %{text: "第一轮要记住：主角叫林烬。", workspace_id: work.id, session_id: session.id},
                 fetcher,
                 complete_fn,
                 nil,
                 recorder
               )

      assert {:ok, _turn_result, _trace, _candidates, second_context} =
               DialogueGateway.handle_input(
                 %{text: "第二轮：他现在叫什么？", workspace_id: work.id, session_id: session.id},
                 fetcher,
                 complete_fn,
                 nil,
                 recorder
               )

      [_first_messages, second_messages] = captured_prompts(complete_fn)

      assert second_context.conversation_summary =~ "user: 第一轮要记住：主角叫林烬。"
      assert second_context.conversation_summary =~ "assistant: 收到你的消息。"
      refute second_context.conversation_summary =~ "周燃"
      assert history_text(second_messages) =~ "林烬"
      refute history_text(second_messages) =~ "周燃"
      refute system_text(second_messages) =~ "## 最近对话"
    end

    test "planner prompt separates latest work snapshot from active session transcript" do
      {:ok, work} =
        WorkRepo.create(%{
          title: "灵源纪元",
          genre: "东方奇幻",
          core_selling_point: "林澈为寻找妹妹林瑶追查灵源矿区真相",
          target_reader: "喜欢悬疑成长线的读者",
          tone_preference: "克制、悬疑、带希望感"
        })

      {:ok, active_session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})
      {:ok, history_session} = WorkSessionRepo.create(%{work_id: work.id, title: "历史会话"})

      seed_interaction(work.id, active_session.id, "turn-active", "user", "当前会话确认：主角现在叫林澈")
      seed_interaction(work.id, history_session.id, "turn-history", "user", "历史会话旧设定：主角当时叫林烬")

      fetcher = WorkspaceContext.context_fetcher_with_query()
      complete_fn = capturing_complete_fn()

      assert {:ok, turn_result, _trace, _candidates, context} =
               DialogueGateway.handle_input(
                 %{text: "主角现在的核心动机是什么？", workspace_id: work.id, session_id: active_session.id},
                 fetcher,
                 complete_fn,
                 nil,
                 nil
               )

      [messages] = captured_prompts(complete_fn)
      system = system_text(messages)
      history = history_text(messages)

      assert context.current_work_snapshot.title == "灵源纪元"
      assert context.current_work_snapshot.core_selling_point == "林澈为寻找妹妹林瑶追查灵源矿区真相"
      assert context.conversation_summary =~ "主角现在叫林澈"
      refute context.conversation_summary =~ "主角当时叫林烬"

      assert system =~ "## 当前作品上下文"
      assert system =~ "灵源纪元"
      assert system =~ "林澈为寻找妹妹林瑶追查灵源矿区真相"
      assert history =~ "主角现在叫林澈"
      refute history =~ "主角当时叫林烬"
      assert List.last(messages).content == "主角现在的核心动机是什么？"

      source_types = Enum.map(turn_result.trace_summary.context_refs, & &1.source_type)
      assert :current_work in source_types
      assert :session_transcript in source_types
      refute :conversation in source_types
    end

    test "injects latest active session transcript into planner prompt for long sessions" do
      {:ok, work} = WorkRepo.create(%{title: "长会话上下文作品"})
      {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前长会话"})

      Enum.each(1..12, fn index ->
        seed_interaction(work.id, session.id, "turn-long-#{index}", "user", "第#{index}轮设定")
      end)

      fetcher = WorkspaceContext.context_fetcher_with_query()
      complete_fn = capturing_complete_fn()

      assert {:ok, _turn_result, _trace, _candidates, context} =
               DialogueGateway.handle_input(
                 %{text: "继续最新设定", workspace_id: work.id, session_id: session.id},
                 fetcher,
                 complete_fn,
                 nil,
                 nil
               )

      [messages] = captured_prompts(complete_fn)
      history_messages = historical_messages(messages)

      assert context.conversation_summary =~ "会话早期摘要"
      assert context.conversation_summary =~ "作者提到「第1轮设定」"
      refute context.conversation_summary =~ "user: 第1轮设定"
      assert context.conversation_summary =~ "第12轮设定"
      assert system_text(messages) =~ "## 会话摘要"
      assert system_text(messages) =~ "会话早期摘要"
      refute Enum.any?(history_messages, &String.contains?(&1.content, "会话早期摘要"))
      assert hd(history_messages).role == "user"
      assert hd(history_messages).content == "第3轮设定"
      assert history_text(messages) =~ "第12轮设定"
      assert List.last(messages).content == "继续最新设定"
    end

    test "injects recalled confirmed memory into the planner prompt and trace context" do
      {:ok, work} = WorkRepo.create(%{title: "记忆召回作品"})
      memory = insert_memory!(work.id, "林瑶失踪与灵源矿区有关")

      fetcher = WorkspaceContext.context_fetcher_with_query()
      complete_fn = capturing_complete_fn()

      assert {:ok, turn_result, _trace, _candidates, context} =
               DialogueGateway.handle_input(
                 %{text: "林烬为什么要去灵源矿区？", workspace_id: work.id},
                 fetcher,
                 complete_fn,
                 nil,
                 nil
               )

      [messages] = captured_prompts(complete_fn)

      assert context.memory_summary =~ "林瑶失踪与灵源矿区有关"
      assert String.contains?(system_text(messages), "## 相关记忆")
      assert String.contains?(system_text(messages), "林瑶失踪与灵源矿区有关")
      memory_ref = Enum.find(turn_result.trace_summary.context_refs, &(&1.source_type == :memory))
      assert memory_ref.summary =~ "林瑶失踪与灵源矿区有关"
      refute memory_ref.summary =~ "PLOT_FACT"
      refute memory_ref.summary =~ "["

      [log] = MemoryReferenceLog.by_scene(work.id, "dialogue_context")
      assert log.memory_id == memory.id
      assert log.reference_reason =~ "灵源矿区"
    end
  end

  defp capturing_complete_fn do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    fn
      :captured_prompts ->
        Agent.get(agent, &Enum.reverse/1)

      prompt ->
        Agent.update(agent, &[prompt | &1])
        {:ok, %{content: @frame_json}}
    end
  end

  defp captured_prompts(complete_fn), do: complete_fn.(:captured_prompts)

  defp system_text(messages) do
    messages
    |> Enum.find(&(&1.role == "system"))
    |> Map.fetch!(:content)
  end

  defp history_text(messages) do
    messages
    |> Enum.reject(&(&1.role == "system"))
    |> Enum.drop(-1)
    |> Enum.map_join("\n", & &1.content)
  end

  defp historical_messages(messages) do
    messages
    |> Enum.reject(&(&1.role == "system"))
    |> Enum.drop(-1)
  end

  defp insert_memory!(work_id, content) do
    %MemoryItem{}
    |> MemoryItem.changeset(%{
      id: ID.uuid(),
      work_id: work_id,
      content: content,
      summary: content,
      type: MemoryType.plot_fact(),
      scope: MemoryScope.work(),
      status: MemoryStatus.confirmed(),
      source_type: MemorySourceType.author_confirmed(),
      recallable: true
    })
    |> Repo.insert!()
  end

  defp seed_interaction(work_id, session_id, turn_id, role, text) do
    assert {:ok, _interaction} =
             MemoryLog.record(%{
               workspace_id: work_id,
               session_id: session_id,
               turn_id: turn_id,
               role: role,
               content: %{text: text},
               source_ref: turn_id
             })
  end
end
