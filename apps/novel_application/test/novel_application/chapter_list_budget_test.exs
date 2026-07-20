defmodule NovelApplication.ChapterListBudgetTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ChapterListBudget

  defp titles(n), do: Enum.map(1..n, fn i -> "第#{String.pad_leading("#{i}", 2, "0")}章：标题#{i}" end)

  test "≤12 章全列（小作品行为不变）" do
    {listed, omitted} = ChapterListBudget.project(titles(12), "随便说点什么")
    assert length(listed) == 12
    assert omitted == 0
  end

  test "超限投影：首章 + 最近 6 章 + 折叠说明" do
    {listed, omitted} = ChapterListBudget.project(titles(30), nil)
    assert hd(listed) == "第01章：标题1"
    assert List.last(listed) == "第30章：标题30"
    assert length(listed) == 7
    assert omitted == 23

    rendered = ChapterListBudget.render_lines(listed, omitted, 30)
    assert rendered =~ "共 30 章"
    assert rendered =~ "23 章从略"
  end

  test "作者点名章恒在列（target_chapter 精确复制契约依赖）" do
    {listed, _} = ChapterListBudget.project(titles(30), "把第03章重写一遍，并参考第 15 章的伏笔")
    assert Enum.any?(listed, &String.contains?(&1, "第03章"))
    assert Enum.any?(listed, &String.contains?(&1, "第15章"))
  end

  test "中文数字序号也可点名" do
    chapters = ["第一章：起点", "第二章：转折"] ++ titles(28)
    {listed, _} = ChapterListBudget.project(chapters, "回头看看第二章怎么写的")
    assert "第二章：转折" in listed
  end
end
