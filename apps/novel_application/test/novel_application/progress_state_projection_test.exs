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

  # VS00F 刀④：prose 注入信息双段——有到期预期的伏笔按临近排序逐条、长线仅计数；
  # HIDDEN 的章计划信息=禁提前揭示清单（R4 泄露的事前预防）。
  test "prose 投影信息双段：伏笔按预期临近排序、长线仅计数、计划信息禁提前揭示" do
    info_entries = [
      %{
        ledger: "information",
        subject_ref: "foreshadow_m1",
        subject_label: "伏笔：矿区旧账",
        status: "HIDDEN",
        payload: %{"planned_reveal" => %{"kind" => "chapter", "seq" => 12}}
      },
      %{
        ledger: "information",
        subject_ref: "foreshadow_m2",
        subject_label: "伏笔：残诀后半卷",
        status: "HIDDEN",
        payload: %{"planned_reveal" => %{"kind" => "volume", "seq" => 2}}
      },
      %{
        ledger: "information",
        subject_ref: "foreshadow_m3",
        subject_label: "伏笔：身世之谜",
        status: "HIDDEN",
        payload: %{"planned_reveal" => %{"kind" => "whole_book"}}
      },
      %{
        ledger: "information",
        subject_ref: "foreshadow_m4",
        subject_label: "伏笔：已回收的旧线",
        status: "REVEALED",
        payload: %{}
      },
      %{
        ledger: "information",
        subject_ref: "plan_info_9",
        subject_label: "第9章信息释放",
        status: "HIDDEN",
        payload: %{"fact" => "公司正在抽取底层修士灵气", "planned_reveal_seq" => 9}
      }
    ]

    text = TurnExecutionService.prose_progress_text(info_entries)

    assert text =~ "未回收伏笔"
    assert text =~ "伏笔：残诀后半卷（预期第2卷内回收）"
    assert text =~ "伏笔：矿区旧账（预期第12章回收）"
    assert text =~ "另有 1 条长线伏笔未回收"
    refute text =~ "身世之谜（"
    refute text =~ "已回收的旧线"
    assert text =~ "后续章节计划信息（正文不得提前揭示）"
    assert text =~ "第9章前保密：公司正在抽取底层修士灵气"
    assert text =~ "不得在正文中引用本段的状态词、编号或章号"
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

  test "规划摘要含未回收伏笔计数与最近到期预期（VS00F 刀④）" do
    with_foreshadow =
      entries() ++
        [
          %{
            ledger: "information",
            subject_ref: "foreshadow_m1",
            subject_label: "伏笔：矿区旧账",
            status: "HIDDEN",
            payload: %{"planned_reveal" => %{"kind" => "chapter", "seq" => 12}}
          },
          %{
            ledger: "information",
            subject_ref: "foreshadow_m3",
            subject_label: "伏笔：身世之谜",
            status: "HIDDEN",
            payload: %{}
          }
        ]

    text = TurnExecutionService.planning_ledger_digest(with_foreshadow)
    assert text =~ "未回收伏笔 2 条，最近预期第12章回收"
  end
end
