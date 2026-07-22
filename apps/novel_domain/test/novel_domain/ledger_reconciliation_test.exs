defmodule NovelDomain.LedgerReconciliationTest do
  @moduledoc """
  对账规则纯函数单测（VS-00F CP2a / ADR-0026，I-L4 确定性）。
  阈值语义以 M2 达标跑重放实测校准（详见模块 doc）。
  """
  use ExUnit.Case, async: true

  alias NovelDomain.LedgerReconciliation

  defp arc_entry(label, status, seen) do
    %{
      id: "le_#{label}",
      ledger: "arc",
      subject_label: label,
      status: status,
      payload: %{"last_seen_seq" => seen},
      source_refs: ["chapter_summary:x"]
    }
  end

  test "R1 弧光停滞：仅 STALLED 条目成偏离项，处置建议 revise_design" do
    findings =
      LedgerReconciliation.arc_stalled_findings([
        arc_entry("凌渊", "STALLED", 25),
        arc_entry("林浩", "ON_TRACK", 75),
        arc_entry("旧人", "RETIRED", 10)
      ])

    assert [%{rule: "arc_stalled", severity: "warn", proposed_disposition: "revise_design"} = f] =
             findings

    assert f.signal =~ "凌渊"
    assert f.source_refs != []
  end

  test "身份锚点自识别：早期高频 ∧ 全书低文档频率，模板词与人名被滤除" do
    # 「危机」每章都出现（模板词，doc_freq=1.0 被滤）；「灵气」只在早期高频；
    # 「凌渊」为人名显式排除。
    summaries =
      for seq <- 1..20 do
        early_only = if seq <= 5, do: String.duplicate("灵气账单灵气调频", 2), else: ""
        {seq, "危机升级#{early_only}凌渊凌渊凌渊"}
      end

    anchors = LedgerReconciliation.identity_anchors(summaries, ["凌渊"])

    assert "灵气" in anchors
    refute "危机" in anchors
    refute "凌渊" in anchors
  end

  test "R3 承诺偏移：末窗口锚点归零比例达阈值产 BROKEN 候选；未达不产" do
    promise = %{id: "le_genre", source_refs: ["work_profile:w"]}

    drift_summaries =
      for seq <- 1..30 do
        text = if seq <= 5, do: String.duplicate("灵气账单调频公司散修下线", 3), else: "星际议会能源风暴"
        {seq, text}
      end

    assert %{rule: "genre_promise_shift", severity: "critical", entry_ref: "le_genre"} =
             LedgerReconciliation.genre_promise_finding(promise, drift_summaries, [])

    steady_summaries =
      for seq <- 1..30,
          do:
            {seq,
             if(seq <= 5,
               do: String.duplicate("灵气账单调频公司散修下线", 3),
               else: "灵气账单调频公司散修下线一切如常"
             )}

    assert LedgerReconciliation.genre_promise_finding(promise, steady_summaries, []) == nil

    # 书太短（≤ 早期+末窗口）不判——避免开局即误报
    short = for seq <- 1..12, do: {seq, "灵气调频"}
    assert LedgerReconciliation.genre_promise_finding(promise, short, []) == nil
    assert LedgerReconciliation.genre_promise_finding(nil, drift_summaries, []) == nil
  end

  test "R4 前指：只报未来章，去重，非法输入安全" do
    text = "他想起第03章的旧账，那是第60章将要出现的裂痕前兆，第60章、第45章都写过。"
    assert LedgerReconciliation.future_chapter_refs(text, 53) == [60]
    assert LedgerReconciliation.future_chapter_refs(text, 3) == [60, 45]
    assert LedgerReconciliation.future_chapter_refs(nil, 3) == []
  end

  describe "R5 主角未物化（VS-00G 设计负债）" do
    test "已写达阈值且无 PROTAGONIST → warn finding（引导物化，source_refs 指缺位查询）" do
      f = LedgerReconciliation.protagonist_undermaterialized_finding([], 20, 10)
      assert f.rule == "protagonist_undermaterialized"
      assert f.ledger == "design_debt"
      assert f.severity == "warn"
      assert f.entry_ref == nil
      assert f.source_refs == ["chapters:1-20"]
      assert f.proposed_disposition == "revise_design"
      assert f.signal =~ "未登记任何主角"
    end

    test "roster 含 PROTAGONIST → 不产（主角已物化）" do
      roster = [%{name: "沈砚", narrative_role: "PROTAGONIST"}]
      assert LedgerReconciliation.protagonist_undermaterialized_finding(roster, 20, 10) == nil
    end

    test "字符串 key 的 narrative_role 也识别" do
      roster = [%{"name" => "沈砚", "narrative_role" => "PROTAGONIST"}]
      assert LedgerReconciliation.protagonist_undermaterialized_finding(roster, 20, 10) == nil
    end

    test "未达章数阈值 → 不催（还没写够，诚实不报）" do
      assert LedgerReconciliation.protagonist_undermaterialized_finding([], 5, 10) == nil
    end

    test "有角色但无一是 PROTAGONIST → 仍报（配角不算主角物化）" do
      roster = [%{name: "白露", narrative_role: "SUPPORTING"}, %{name: "沈砚"}]
      assert LedgerReconciliation.protagonist_undermaterialized_finding(roster, 20, 10) != nil
    end
  end
end
