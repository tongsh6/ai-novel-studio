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
end
