defmodule NovelApplication.ChapterListBudgetTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ChapterListBudget

  defp entries(n) do
    Enum.map(1..n, fn i ->
      %{
        id: Ecto.UUID.generate(),
        seq: i,
        title: "第#{String.pad_leading("#{i}", 2, "0")}章：标题#{i}",
        has_prose: rem(i, 2) == 0
      }
    end)
  end

  test "≤12 章保留完整结构身份与原顺序" do
    chapters = entries(12)
    assert ChapterListBudget.project_entries(chapters, "随便说点什么") == {chapters, 0}
  end

  test "超限投影保留首章、最近6章与准确遗漏计数" do
    chapters = entries(30)
    {listed, omitted} = ChapterListBudget.project_entries(chapters)

    assert listed == Enum.take(chapters, 1) ++ Enum.take(chapters, -6)
    assert omitted == 23
  end

  test "作者点名章保留真实身份，不从显示标题重新构造条目" do
    chapters = entries(30)

    {listed, omitted} =
      ChapterListBudget.project_entries(chapters, "把第03章重写一遍，并参考第 15 章的伏笔")

    assert Enum.at(chapters, 2) in listed
    assert Enum.at(chapters, 14) in listed
    assert length(listed) + omitted == length(chapters)
  end

  test "同名同序条目按真实id分别保留，不合并为首个显示身份" do
    chapters = entries(30)
    first = %{Enum.at(chapters, 2) | title: "第03章：同名章"}
    second = %{Enum.at(chapters, 3) | title: first.title, seq: first.seq}
    chapters = chapters |> List.replace_at(2, first) |> List.replace_at(3, second)

    {listed, omitted} = ChapterListBudget.project_entries(chapters, "重新核对第03章")

    assert first.id != second.id

    assert Enum.filter(listed, &(&1.title == first.title and &1.seq == first.seq)) == [
             first,
             second
           ]

    assert listed == Enum.take(chapters, 1) ++ [first, second] ++ Enum.take(chapters, -6)
    assert omitted == 21
  end

  test "中文数字序号也可点名" do
    chapters =
      entries(30)
      |> List.update_at(0, &%{&1 | title: "第一章：起点"})
      |> List.update_at(1, &%{&1 | title: "第二章：转折"})

    {listed, _} = ChapterListBudget.project_entries(chapters, "回头看看第二章怎么写的")
    assert Enum.at(chapters, 1) in listed
  end
end
