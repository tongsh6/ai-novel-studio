defmodule NovelApplication.ProgressStateProjectionTest do
  @moduledoc """
  账面投影渲染单测（VS-00F CP1/CP4a / ADR-0026）：prose=弧光+反泄漏约束；
  plot_outline=五账规划摘要+延续性要求。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.TurnExecutionService

  defp entries do
    [
      %{ledger: "arc", subject_label: "凌渊", status: "STALLED", payload: %{"last_seen_seq" => 25}},
      %{ledger: "arc", subject_label: "林浩", status: "ON_TRACK", payload: %{"last_seen_seq" => 75}},
      %{ledger: "conflict", subject_ref: "main", subject_label: "主线", status: "ACTIVE",
        payload: %{"last_advanced_seq" => 74}},
      %{ledger: "promise", subject_ref: "genre", subject_label: "类型承诺：赛博修仙", status: "OPEN",
        payload: %{}},
      %{ledger: "emotion_curve", subject_label: "第5章·情绪", status: "DEVIATED", payload: %{"seq" => 5}},
      %{ledger: "emotion_curve", subject_label: "第6章·情绪", status: "MATCHED", payload: %{"seq" => 6}}
    ]
  end

  test "prose 投影：只取弧光、STALLED 优先、带反泄漏约束" do
    text = TurnExecutionService.prose_progress_text(entries())

    assert text =~ "凌渊"
    assert text =~ "已多章未出场"
    refute text =~ "主线"
    assert text =~ "不得在正文中引用本段的状态词、编号或章号"
    assert TurnExecutionService.prose_progress_text([]) == ""
  end

  test "plot_outline 规划摘要：五账聚合 + 延续性要求" do
    text = TurnExecutionService.planning_ledger_digest(entries())

    assert text =~ "弧光停滞待处理：凌渊"
    assert text =~ "弧光推进中：林浩"
    assert text =~ "主线：ACTIVE，最近推进第74章"
    assert text =~ "类型承诺：赛博修仙：OPEN"
    assert text =~ "情绪曲线：符合1/偏差1/无设计0"
    assert text =~ "不引入取代现有主角团的新主导角色"
    assert TurnExecutionService.planning_ledger_digest([]) == ""
  end
end
