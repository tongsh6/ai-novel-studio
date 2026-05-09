defmodule NovelApplication.DialogueGatewayRealLoopTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.DialogueGateway
  alias NovelPersistence.Repo
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
end
