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

  describe "R6 全书骨架缺位（VS-00G 设计负债）" do
    test "已写达阈值且无 target_length → warn finding（引导补立项）" do
      f = LedgerReconciliation.skeleton_missing_finding(nil, 30, 20)
      assert f.rule == "skeleton_missing"
      assert f.ledger == "design_debt"
      assert f.proposed_disposition == "revise_design"
      assert f.signal =~ "未设定目标体量"
      assert "work_profile:target_length" in f.source_refs
    end

    test "target_length 已设 → 不产（骨架已立）" do
      assert LedgerReconciliation.skeleton_missing_finding(140_000, 30, 20) == nil
    end

    test "未达章数阈值 → 不催（起步期不催立项）" do
      assert LedgerReconciliation.skeleton_missing_finding(nil, 5, 20) == nil
    end

    test "target_length=0 视为未立" do
      assert LedgerReconciliation.skeleton_missing_finding(0, 30, 20) != nil
    end
  end

  describe "R7 提前收官（VS-00G，M3 收官循环检测层）" do
    defp chapter(seq, title, role \\ nil), do: %{seq: seq, title: title, chapter_role: role}

    test "进度低于阈值且近窗含终局标题 → warn finding（引导调整规划）" do
      f =
        LedgerReconciliation.premature_finale_finding(
          12.5,
          [chapter(11, "第11章：频段反击"), chapter(12, "第12章：大结局")],
          70
        )

      assert f.rule == "premature_finale"
      assert f.ledger == "design_debt"
      assert f.proposed_disposition == "revise_design"
      assert f.signal =~ "13%"
      assert f.signal =~ "第 12 章"
      assert "chapter_plan:12" in f.source_refs
    end

    test "章功能定位含收官同样命中（不只看标题）" do
      f =
        LedgerReconciliation.premature_finale_finding(
          30,
          [chapter(20, "第20章：平静", "收官铺垫")],
          70
        )

      assert f != nil
      assert f.signal =~ "第 20 章"
    end

    test "进度已达阈值 → 不产（接近目标可收束）" do
      assert LedgerReconciliation.premature_finale_finding(
               85,
               [chapter(90, "第90章：大结局")],
               70
             ) == nil
    end

    test "近窗无终局信号 → 不产" do
      assert LedgerReconciliation.premature_finale_finding(
               10,
               [chapter(11, "第11章：反击"), chapter(12, "第12章：追查")],
               70
             ) == nil
    end
  end

  describe "R8 暂定设定超龄未决（VS-00G §2.3 防护③）" do
    test "激活后推进达阈值仍未裁决 → warn 催办（指向暂定设定区）" do
      f =
        LedgerReconciliation.assumption_overdue_finding(
          %{id: "char-1", name: "沈砚", narrative_role: "PROTAGONIST"},
          10,
          10
        )

      assert f.rule == "assumption_overdue"
      assert f.ledger == "design_debt"
      assert f.proposed_disposition == "revise_design"
      assert f.signal =~ "主角：沈砚"
      assert f.signal =~ "10 章仍未裁决"
      assert f.source_refs == ["assumption:char-1"]
    end

    test "未达阈值 → 不催（假定仍在正常寿命内）" do
      assert LedgerReconciliation.assumption_overdue_finding(
               %{id: "char-1", name: "沈砚", narrative_role: "PROTAGONIST"},
               9,
               10
             ) == nil
    end

    test "非主角假定按角色措辞" do
      f =
        LedgerReconciliation.assumption_overdue_finding(
          %{id: "char-2", name: "云栖", narrative_role: "SUPPORTING"},
          12,
          10
        )

      assert f.signal =~ "角色：云栖"
    end
  end

  # VS00F 刀④：预期归伏笔自己——R9 仅对「有预期且已超期」开火；whole_book/无预期
  # 永不催办，只在进度达阈值时进收官清单。
  describe "R9 伏笔超期与收官清单" do
    defp foreshadow_entry(overrides) do
      Map.merge(
        %{
          id: "le-f1",
          ledger: "information",
          status: "HIDDEN",
          subject_ref: "foreshadow_m1",
          subject_label: "伏笔：矿区旧账",
          design_ref: "memory_item:m1",
          payload: %{},
          source_refs: ["memory_item:m1"]
        },
        overrides
      )
    end

    test "chapter 型超期开火；volume 型超卷开火；未到期/whole_book/无预期不产" do
      entries = [
        foreshadow_entry(%{
          id: "le-ch",
          subject_ref: "foreshadow_ch",
          payload: %{"planned_reveal" => %{"kind" => "chapter", "seq" => 5}}
        }),
        foreshadow_entry(%{
          id: "le-vol",
          subject_ref: "foreshadow_vol",
          subject_label: "伏笔：残诀后半卷",
          payload: %{"planned_reveal" => %{"kind" => "volume", "seq" => 1}}
        }),
        foreshadow_entry(%{
          id: "le-future",
          subject_ref: "foreshadow_future",
          payload: %{"planned_reveal" => %{"kind" => "chapter", "seq" => 30}}
        }),
        foreshadow_entry(%{
          id: "le-book",
          subject_ref: "foreshadow_book",
          payload: %{"planned_reveal" => %{"kind" => "whole_book"}}
        }),
        foreshadow_entry(%{id: "le-none", subject_ref: "foreshadow_none"}),
        foreshadow_entry(%{
          id: "le-revealed",
          subject_ref: "foreshadow_done",
          status: "REVEALED",
          payload: %{"planned_reveal" => %{"kind" => "chapter", "seq" => 3}}
        })
      ]

      findings =
        LedgerReconciliation.foreshadowing_overdue_findings(entries, %{
          chapter_seq: 8,
          volume_seq: 2
        })

      assert length(findings) == 2
      assert Enum.all?(findings, &(&1.rule == "foreshadowing_overdue"))

      chapter_finding = Enum.find(findings, &(&1.entry_ref == "le-ch"))
      assert chapter_finding.signal =~ "预期第 5 章回收"
      assert chapter_finding.signal =~ "第 8 章仍未回收"
      assert "memory_item:m1" in chapter_finding.source_refs
      assert chapter_finding.proposed_disposition == "revise_prose"

      assert Enum.find(findings, &(&1.entry_ref == "le-vol")).signal =~ "预期第 1 卷内回收"
    end

    test "收官清单：进度达阈值列出长线/未定预期伏笔；未达或无未收不产" do
      entries = [
        foreshadow_entry(%{
          id: "le-book",
          subject_ref: "foreshadow_book",
          subject_label: "伏笔：身世之谜",
          payload: %{"planned_reveal" => %{"kind" => "whole_book"}}
        }),
        foreshadow_entry(%{id: "le-none", subject_ref: "foreshadow_none"}),
        foreshadow_entry(%{
          id: "le-dated",
          subject_ref: "foreshadow_dated",
          payload: %{"planned_reveal" => %{"kind" => "chapter", "seq" => 90}}
        })
      ]

      finding = LedgerReconciliation.unresolved_foreshadowing_endgame_finding(entries, 82.5, 70)

      assert finding.rule == "unresolved_foreshadowing_at_endgame"
      assert finding.signal =~ "仍有 2 条长线伏笔未回收"
      assert finding.signal =~ "身世之谜"
      refute finding.signal =~ "foreshadow_dated"
      assert finding.proposed_disposition == "revise_design"

      assert LedgerReconciliation.unresolved_foreshadowing_endgame_finding(entries, 40, 70) == nil
      assert LedgerReconciliation.unresolved_foreshadowing_endgame_finding([], 90, 70) == nil
    end
  end
end
