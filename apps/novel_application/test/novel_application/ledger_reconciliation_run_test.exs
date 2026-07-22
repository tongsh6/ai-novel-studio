defmodule NovelApplication.LedgerReconciliationRunTest do
  @moduledoc """
  CP4c-2（VS-00F 契约 §3.2）：`ledger_reconciliation_v1` 全书审读 AgentRun。

  readonly 纪律 + 恰一次机械审读物化（reconcile_fn 注入）；规则判定不经模型
  （模型只起草计划）；turn 文案为 app 侧事实口径且引导到「脉络」页。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.TestAgenticLoopFixtures

  defp plan_draft do
    TestAgenticLoopFixtures.plan_tool_call_result(
      "机械执行一次全书审读并物化审读报告。",
      [
        TestAgenticLoopFixtures.plan_step(
          "ledger_reconcile_run",
          "ledger_reconcile",
          "机械执行全书审读并物化审读报告",
          success_criteria: ["ledger_reconcile_observation_exists"]
        ),
        TestAgenticLoopFixtures.plan_step(
          "ledger_reconcile_finalize",
          "ledger_reconcile",
          "汇总审读结论并声明未改动设定或正文",
          success_criteria: ["ledger_reconcile_turn_result_emitted", "production_write_false"]
        )
      ],
      reason_codes: ["agent_plan_drafted", "ledger_reconcile_plan_drafted"]
    )
  end

  defp planner_provider do
    %Execution{
      result_fn: fn _prompt -> {:ok, plan_draft()} end
    }
  end

  test "全书审读 run：机械物化恰一次，完成 turn 引导到脉络页，不产生待采纳 artifact" do
    parent = self()
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    reconcile_fn = fn work_id ->
      Agent.update(counter, &(&1 + 1))
      send(parent, {:reconciled, work_id})
      {:ok, %{id: "report-1", finding_count: 3}}
    end

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :ledger_reconciliation,
        %{
          text: "对全书做一次审读",
          workspace_id: "ws-ledger-review",
          work_id: "work-ledger-review",
          session_id: "session-ledger-review",
          turn_id: "turn-ledger-review",
          reconcile_fn: reconcile_fn
        },
        nil,
        planner_provider()
      )

    assert spec.run_attrs.profile_ref == "ledger_reconciliation_v1"
    assert is_function(spec.next_step_planner, 3)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}, 500
    assert_receive {:reconciled, "work-ledger-review"}, 500

    assert_receive {:agent_event, :turn_result_ready, turn_event}, 1_000
    text = turn_event.payload.turn_result.assistant_message.text
    assert text =~ "全书审读完成"
    assert text =~ "3 处偏离"
    assert text =~ "脉络"
    assert text =~ "未改动任何设定或正文"

    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :completed
    # 机械审读恰一次；规则判定不经模型（provider 调用仅计划起草两段式 ×2，ADR-0023）
    assert Agent.get(counter, & &1) == 1
    assert run.consumed_budget.provider_calls == 2
    assert run.pending_artifact_refs == []
  end

  test "审读失败时诚实失败文案，不伪造报告" do
    parent = self()

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :ledger_reconciliation,
        %{
          text: "对全书做一次审读",
          workspace_id: "ws-ledger-review-2",
          work_id: "work-ledger-review-2",
          session_id: "session-ledger-review-2",
          turn_id: "turn-ledger-review-2",
          reconcile_fn: fn _work_id -> {:error, :db_down} end
        },
        nil,
        planner_provider()
      )

    assert {:ok, _run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :turn_result_ready, turn_event}, 1_000
    text = turn_event.payload.turn_result.assistant_message.text
    assert text =~ "全书审读未完成"
    refute text =~ "审读报告已就绪"
  end
end
