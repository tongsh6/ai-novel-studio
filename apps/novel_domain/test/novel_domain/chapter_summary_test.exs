defmodule NovelDomain.ChapterSummaryTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ChapterSummary

  defp tentative(attrs \\ %{}) do
    ChapterSummary.new(Map.merge(%{work_id: "w", chapter_id: "c", summary_text: "正文摘要"}, attrs))
  end

  describe "new/1" do
    test "新建即 TENTATIVE" do
      summary = tentative()
      assert summary.status == "TENTATIVE"
      assert summary.work_id == "w"
      assert summary.chapter_id == "c"
      refute ChapterSummary.canon?(summary)
    end

    test "缺必填字段抛 KeyError" do
      assert_raise KeyError, fn ->
        ChapterSummary.new(%{work_id: "w", chapter_id: "c"})
      end
    end
  end

  describe "状态机（复用 AdoptionStatus 矩阵）" do
    test "TENTATIVE → ACCEPTED" do
      assert {:ok, accepted} = ChapterSummary.accept(tentative())
      assert accepted.status == "ACCEPTED"
      assert ChapterSummary.canon?(accepted)
    end

    test "ACCEPTED → SUPERSEDED" do
      {:ok, accepted} = ChapterSummary.accept(tentative())
      assert {:ok, superseded} = ChapterSummary.supersede(accepted)
      assert superseded.status == "SUPERSEDED"
      refute ChapterSummary.canon?(superseded)
    end

    test "非法转换返回 error（TENTATIVE 不可直接 supersede）" do
      assert {:error, {:illegal_transition, "TENTATIVE", "SUPERSEDED"}} =
               ChapterSummary.supersede(tentative())
    end
  end

  describe "四栏结构" do
    test "render_sections 含全部四栏标签且 four_column? 为真" do
      text =
        ChapterSummary.render_sections(%{
          plot: "情节推进内容",
          characters: "人物变化内容",
          foreshadowing: "伏笔动作内容",
          mood: "情绪基调内容"
        })

      assert ChapterSummary.four_column?(text)

      for label <- ["情节推进", "人物状态与弧光", "伏笔动作", "情绪基调"] do
        assert text =~ label
      end

      assert text =~ "情节推进内容"
    end

    test "缺栏以（无）占位但仍四栏齐全" do
      text = ChapterSummary.render_sections(%{plot: "只有情节"})
      assert ChapterSummary.four_column?(text)
      assert text =~ "（无）"
    end

    test "four_column? 对普通文本/非字符串为假" do
      refute ChapterSummary.four_column?("一段没有四栏标签的普通文本")
      refute ChapterSummary.four_column?(nil)
    end
  end
end
