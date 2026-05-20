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

      [first_prompt, second_prompt] = captured_prompts(complete_fn)

      refute String.contains?(first_prompt, "## 最近对话")
      assert String.contains?(second_context.conversation_summary, "user: 第一轮要记住：主角叫林烬。")
      assert String.contains?(second_context.conversation_summary, "assistant: 收到你的消息。")
      assert String.contains?(second_prompt, "## 最近对话")
      assert String.contains?(second_prompt, "user: 第一轮要记住：主角叫林烬。")
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

      [_first_prompt, second_prompt] = captured_prompts(complete_fn)

      assert second_context.conversation_summary =~ "user: 第一轮要记住：主角叫林烬。"
      assert second_context.conversation_summary =~ "assistant: 收到你的消息。"
      refute second_context.conversation_summary =~ "周燃"
      assert second_prompt =~ "## 最近对话"
      assert second_prompt =~ "林烬"
      refute second_prompt =~ "周燃"
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

      [prompt] = captured_prompts(complete_fn)

      refute context.conversation_summary =~ "第1轮设定"
      refute context.conversation_summary =~ "第2轮设定"
      assert context.conversation_summary =~ "第12轮设定"
      refute prompt =~ "第1轮设定"
      assert prompt =~ "## 最近对话"
      assert prompt =~ "第12轮设定"
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

      [prompt] = captured_prompts(complete_fn)

      assert context.memory_summary =~ "林瑶失踪与灵源矿区有关"
      assert String.contains?(prompt, "## 相关记忆")
      assert String.contains?(prompt, "林瑶失踪与灵源矿区有关")
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
