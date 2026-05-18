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
      assert Enum.any?(turn_result.trace_summary.context_refs, &(&1.source_type == :memory))

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
end
