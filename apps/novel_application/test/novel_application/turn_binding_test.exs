defmodule NovelApplication.AgentRunFlows.TurnBindingTest do
  # B15（2026-08-26）：AgentRun step 的 turn_id 构造与 Logger metadata 绑定必须同点，
  # 否则 toolbox.execute.* 等经 LogEmit 落盘的事件拿不到 turn_id（证据链断，
  # p1-chapter-expansion / p1-chapter-overwrite-confirm 两场景 behavior 门哑火）。
  use ExUnit.Case, async: false

  alias NovelApplication.AgentRunFlows.TurnBinding

  defp run do
    %{
      parent_turn_ref: "turn_b15",
      workspace_id: "ws-b15",
      work_id: "work-b15",
      session_id: "sess-b15"
    }
  end

  setup do
    previous = Logger.metadata()
    on_exit(fn -> NovelCommon.LogContext.restore(previous) end)
    Logger.reset_metadata([])
    :ok
  end

  test "bind 构造 turn_id 并写进当前进程 Logger metadata" do
    assert TurnBinding.bind(run(), 5) == "turn_b15:agent:5"

    meta = Logger.metadata()
    assert meta[:turn_id] == "turn_b15:agent:5"
    assert meta[:work_id] == "work-b15"
    assert meta[:workspace_id] == "ws-b15"
    assert meta[:session_id] == "sess-b15"
  end

  # LogEmit 从 Logger.metadata 取 turn_id 的契约由 log_context_test 覆盖；这里守的是
  # B15 的真正回归面：**产品各 flow 的 frame 构造点必须经 TurnBinding.bind**，
  # 否则工具执行进程没有 turn_id、toolbox.execute.* 事件再次变成空关联。
  test "所有 agent_run_flows 的 frame turn_id 都经 TurnBinding.bind 构造" do
    flow_dir = Path.join([__DIR__, "..", "..", "lib", "novel_application", "agent_run_flows"])

    offenders =
      flow_dir
      |> Path.join("*.ex")
      |> Path.wildcard()
      |> Enum.filter(fn file ->
        File.read!(file) =~ ~r/turn_id:\s*"#\{run\.parent_turn_ref\}:agent:/
      end)
      |> Enum.map(&Path.basename/1)

    assert offenders == [],
           "这些 flow 仍在裸拼 frame turn_id（会丢 Logger metadata 绑定，B15 回归）：#{inspect(offenders)}"
  end

  test "具名步（ledger_reconcile 等维护步形态）同样构造并绑定" do
    assert TurnBinding.bind(run(), "ledger_reconcile") == "turn_b15:agent:ledger_reconcile"
    assert Logger.metadata()[:turn_id] == "turn_b15:agent:ledger_reconcile"
  end

  test "turn_id/2 纯构造不触碰 metadata" do
    Logger.metadata(turn_id: "untouched")
    assert TurnBinding.turn_id(run(), 3) == "turn_b15:agent:3"
    assert Logger.metadata()[:turn_id] == "untouched"
  end
end
