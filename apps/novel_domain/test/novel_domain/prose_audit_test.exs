defmodule NovelDomain.ProseAuditTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ProseAudit

  describe "chapter_status/2" do
    test "0 字为空章" do
      assert ProseAudit.chapter_status(0, 1_000) == :empty
    end

    test "负数（异常输入）归为空章" do
      assert ProseAudit.chapter_status(-5, 1_000) == :empty
    end

    test "不足下限为短章" do
      assert ProseAudit.chapter_status(1, 1_000) == :short
      assert ProseAudit.chapter_status(999, 1_000) == :short
    end

    test "达到下限为达标" do
      assert ProseAudit.chapter_status(1_000, 1_000) == :ok
      assert ProseAudit.chapter_status(1_500, 1_000) == :ok
    end
  end

  describe "summarize/2" do
    test "空作品不达标" do
      audit = ProseAudit.summarize([], :p1)
      assert audit.chapter_count == 0
      assert audit.total_word_count == 0
      assert audit.meets_threshold == false
    end

    test "携带阶段阈值" do
      audit = ProseAudit.summarize([1_200], :p1)
      assert audit.stage == :p1
      assert audit.min_chapter_words == 1_000
      assert audit.total_target == 100_000
    end

    test "分类计数正确" do
      audit = ProseAudit.summarize([0, 500, 1_000, 2_000], :p1)
      assert audit.chapter_count == 4
      assert audit.empty_chapter_count == 1
      assert audit.short_chapter_count == 1
      assert audit.ok_chapter_count == 2
      assert audit.total_word_count == 3_500
    end

    test "每章达标但总字数不足 → 不达标" do
      audit = ProseAudit.summarize([1_000, 2_000], :p1)
      assert audit.empty_chapter_count == 0
      assert audit.short_chapter_count == 0
      assert audit.meets_threshold == false
    end

    test "存在短章 → 即使总字数够也不达标" do
      audit = ProseAudit.summarize([100_000, 500], :p1)
      assert audit.total_word_count == 100_500
      assert audit.short_chapter_count == 1
      assert audit.meets_threshold == false
    end

    test "每章达标且总字数达标 → 达标" do
      # 100 章各 1000 字 = 100000
      audit = ProseAudit.summarize(List.duplicate(1_000, 100), :p1)
      assert audit.chapter_count == 100
      assert audit.ok_chapter_count == 100
      assert audit.total_word_count == 100_000
      assert audit.meets_threshold == true
    end
  end

  describe "duplicate_analysis/1（P1 checkpoint B）" do
    test "跨章重复段落计数按章去重；同章重复不膨胀" do
      result =
        ProseAudit.duplicate_analysis([
          %{id: "c1", seq: 1, content: "雨夜开城门。\n\n他走进巷子。\n\n雨夜开城门。"},
          %{id: "c2", seq: 2, content: "雨夜开城门。\n\n另一段完全不同的话。"},
          %{id: "c3", seq: 3, content: "只有这一段。"}
        ])

      assert result.duplicate_paragraph_count == 1
      assert [%{chapter_ids: ["c1", "c2"]}] = result.duplicate_paragraph_chapter_pairs
      assert result.duplicate_chapter_count == 0
    end

    test "重复章按全文归一化 hash；空白差异不改变判等" do
      result =
        ProseAudit.duplicate_analysis([
          %{id: "c1", seq: 1, content: "第一段。\n\n第二段。"},
          %{id: "c2", seq: 2, content: "  第一段。 \n\n 第二段。 "},
          %{id: "c3", seq: 3, content: "不同内容。"}
        ])

      assert result.duplicate_chapter_count == 1
      assert [%{chapter_ids: ["c1", "c2"]}] = result.duplicate_chapter_pairs
    end

    test "空内容/纯标点不参与重复段落" do
      result =
        ProseAudit.duplicate_analysis([
          %{id: "c1", seq: 1, content: "……\n\n"},
          %{id: "c2", seq: 2, content: "。。。"}
        ])

      assert result.duplicate_paragraph_count == 0
      assert result.duplicate_chapter_count == 0
    end
  end

  describe "missing_analysis/2（P1 checkpoint C）" do
    test "计划与已采纳 seq 的差集和比率" do
      result = ProseAudit.missing_analysis([1, 2, 3, 4], [1, 3])
      assert result.planned_chapter_count == 4
      assert result.missing_chapter_count == 2
      assert result.missing_chapter_rate == 0.5
      assert result.missing_chapter_seqs == [2, 4]
      assert result.missing_not_applicable == false
    end

    test "无计划时明确 N/A，不伪造 0% 达标" do
      result = ProseAudit.missing_analysis([], [])
      assert result.planned_chapter_count == 0
      assert result.missing_chapter_count == 0
      assert result.missing_chapter_rate == 0.0
      assert result.missing_not_applicable == true
    end

    test "忽略非法输入并去重" do
      result = ProseAudit.missing_analysis([1, 1, "x", 2], [1, 2, 2])
      assert result.planned_chapter_count == 2
      assert result.missing_chapter_count == 0
      assert result.missing_chapter_rate == 0.0
    end
  end
end
