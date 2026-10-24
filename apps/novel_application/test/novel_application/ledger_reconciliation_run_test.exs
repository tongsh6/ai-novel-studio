defmodule NovelApplication.LedgerReconciliationRunTest do
  @moduledoc """
  CP4c-2（VS-00F 契约 §3.2）：`ledger_reconciliation_v1` 全书审读 AgentRun。

  readonly 纪律 + 恰一次机械审读物化（reconcile_fn 注入）；规则判定不经模型
  （模型只起草计划）；turn 文案为 app 侧事实口径且引导到「脉络」页。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService

  test "全书审读 run：机械物化恰一次，完成 turn 引导到脉络页，不产生待采纳 artifact" do
    parent = self()
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    reconcile_fn = fn work_id ->
      Agent.update(counter, &(&1 + 1))
      send(parent, {:reconciled, work_id})

      # B27 CP3c/D2 port 契约：机械审读结果必须携带规则覆盖（scan 真源）。
      {:ok, %{id: "report-1", finding_count: 3},
       %{
         rules_evaluated: [:arc_stalled, :genre_promise],
         rules_skipped: [
           %{rule: :volume_plan_mismatch, status: :skipped, reason: :volumes_port_missing}
         ],
         scope: %{work_id: work_id, entries: 0, summaries: 0, roster: 0}
       }}
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
        nil
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
    # 规则覆盖随回执显式（skipped 不静默）。
    assert text =~ "1 项规则因数据缺失/读端口缺席未执行"

    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, %{run: run}} = AgentRunService.state(run_id)
    assert run.status == :completed

    # 机械审读恰一次；规则判定不经模型；B27 CP3c/D2 起固定单步维护 run 用机械计划：
    # 计划起草与机械审读均为 0 provider 调用。
    assert Agent.get(counter, & &1) == 1
    assert run.consumed_budget.provider_calls == 0
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
        nil
      )

    assert {:ok, _run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :turn_result_ready, turn_event}, 1_000
    turn_result = turn_event.payload.turn_result
    text = turn_result.assistant_message.text
    assert text =~ "全书审读未完成"
    refute text =~ "审读报告已就绪"

    # B27 CP3c / C3：scan error 不得 completed+goal_satisfied；run 可结束但 TurnResult
    # phase/status 如实失败，tool_result 不伪造成功。
    assert turn_result.phase == "failed"
    assert turn_result.status == "failed_recoverable"
    assert turn_result.tool_result.status in [:failed, "failed"]
  end
end
