defmodule NovelDomain.NovelMilestoneTest do
  use ExUnit.Case, async: true

  alias NovelDomain.NovelMilestone

  describe "threshold/1" do
    test "P1 阈值冻结：单章 1000、总 100000" do
      assert NovelMilestone.threshold(:p1) ==
               %{stage: :p1, min_chapter_words: 1_000, total_target: 100_000}
    end

    test "P2/P3/P4 阈值冻结" do
      assert NovelMilestone.threshold(:p2).min_chapter_words == 2_000
      assert NovelMilestone.threshold(:p2).total_target == 500_000
      assert NovelMilestone.threshold(:p3).min_chapter_words == 3_000
      assert NovelMilestone.threshold(:p3).total_target == 1_000_000
      assert NovelMilestone.threshold(:p4).min_chapter_words == 5_000
      assert NovelMilestone.threshold(:p4).total_target == 5_000_000
    end

    test "未知阶段抛错" do
      assert_raise FunctionClauseError, fn -> NovelMilestone.threshold(:p9) end
    end
  end
end
