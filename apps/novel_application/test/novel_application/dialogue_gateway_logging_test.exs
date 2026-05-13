defmodule NovelApplication.DialogueGatewayLoggingTest do
  use ExUnit.Case, async: false

  alias NovelApplication.DialogueGateway

  @frame_json """
  {
    "frame_type": "casual_reply",
    "dialogue_goal_summary": "用户请求规划创作任务",
    "needs_tool": false,
    "no_tool_reason": "user_requested_discussion",
    "execution_readiness": "not_applicable",
    "assistant_message": "我们先把任务拆小，避免一次改动过大。",
    "candidate_directions": [],
    "context_used": false,
    "uncertainty": []
  }
  """

  @plan_json """
  {
    "plan_goal_summary": "拆解一个需要降级处理的多步创作请求",
    "risk_hint": "low",
    "proposed_actions": [
      {
        "action_id": "act-1",
        "action_type": "capability_invocation",
        "summary": "整理世界观方向",
        "target_ref": "world_building",
        "write_intent": "none",
        "risk_hint": "low"
      },
      {
        "action_id": "act-2",
        "action_type": "capability_invocation",
        "summary": "整理角色方向",
        "target_ref": "character_design",
        "write_intent": "none",
        "risk_hint": "low"
      }
    ],
    "required_capabilities": ["world_building", "character_design"],
    "fallback_message": "这个请求包含多个步骤，我们先确认优先方向。"
  }
  """

  @key_events [
    "dialogue_gateway.handle_input.start",
    "context.assemble.done",
    "planner.form_frame.done",
    "orchestrator.decide.done",
    "dialogue_gateway.handle_input.done"
  ]

  setup do
    old_enabled = Application.get_env(:novel_common, :log_jsonl_enabled)
    old_dir = Application.get_env(:novel_common, :log_jsonl_dir)
    log_dir = Path.join(System.tmp_dir!(), "novel-vs10-log-#{System.unique_integer([:positive])}")

    Application.put_env(:novel_common, :log_jsonl_enabled, true)
    Application.put_env(:novel_common, :log_jsonl_dir, log_dir)

    on_exit(fn ->
      restore_env(:log_jsonl_enabled, old_enabled)
      restore_env(:log_jsonl_dir, old_dir)
      File.rm_rf(log_dir)
    end)

    {:ok, log_dir: log_dir}
  end

  test "key dialogue turn events include required schema fields and turn correlation", %{
    log_dir: log_dir
  } do
    workspace_id = "ws-log-#{System.unique_integer([:positive, :monotonic])}"
    work_id = "work-log-#{System.unique_integer([:positive, :monotonic])}"
    turn_id = "turn-log-#{System.unique_integer([:positive, :monotonic])}"

    assert {:ok, turn_result, _trace, _candidates, _context} =
             DialogueGateway.handle_input(
               %{
                 text: "帮我规划一下世界观和主角方向。",
                 workspace_id: workspace_id,
                 work_id: work_id,
                 turn_id: turn_id,
                 generate_micro_plan: true
               },
               nil,
               complete_fn()
             )

    assert turn_result.turn_id == turn_id

    records = eventually_read_records(log_dir)

    for event <- @key_events do
      record = Enum.find(records, &(&1["event"] == event)) || flunk("missing #{event}")

      assert record["workspace_id"] == workspace_id
      assert record["work_id"] == work_id
      assert record["turn_id"] == turn_result.turn_id
      assert record["outcome"] in ["start", "ok", "error", "skipped", "degraded"]
      assert is_integer(record["duration_ms"])
    end
  end

  defp complete_fn do
    fn prompt ->
      if String.contains?(prompt, "\"proposed_actions\"") do
        {:ok, %{content: @plan_json}}
      else
        {:ok, %{content: @frame_json}}
      end
    end
  end

  defp eventually_read_records(log_dir, attempts \\ 40)

  defp eventually_read_records(log_dir, 0) do
    path = jsonl_path(log_dir)

    records =
      if File.exists?(path) do
        read_records(path)
      else
        []
      end

    flunk(
      "timed out waiting for VS-10 JSONL events; got #{inspect(Enum.map(records, & &1["event"]))}"
    )
  end

  defp eventually_read_records(log_dir, attempts) do
    records = read_records_if_present(log_dir)

    if key_events_present?(records) do
      records
    else
      Process.sleep(25)
      eventually_read_records(log_dir, attempts - 1)
    end
  end

  defp read_records_if_present(log_dir) do
    path = jsonl_path(log_dir)

    if File.exists?(path) do
      read_records(path)
    else
      []
    end
  end

  defp key_events_present?(records) do
    Enum.all?(@key_events, fn event -> Enum.any?(records, &(&1["event"] == event)) end)
  end

  defp read_records(path) do
    path
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.map(&Jason.decode!/1)
  end

  defp jsonl_path(log_dir), do: Path.join(log_dir, "#{Date.utc_today()}.jsonl")

  defp restore_env(key, nil), do: Application.delete_env(:novel_common, key)
  defp restore_env(key, value), do: Application.put_env(:novel_common, key, value)
end
