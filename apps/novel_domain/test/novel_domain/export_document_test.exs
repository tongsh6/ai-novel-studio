defmodule NovelDomain.ExportDocumentTest do
  use ExUnit.Case, async: true

  alias NovelDomain.ExportDocument

  @volumes [
    %{
      id: "vol-1",
      title: "第一卷",
      seq: 1,
      chapters: [
        %{id: "ch-1", title: "第01章：底层灵气账单", seq: 1, word_count: 600},
        %{id: "ch-2", title: "第02章：旧服务器里的残诀", seq: 2, word_count: 0}
      ]
    }
  ]

  @scenes %{
    "ch-1" => [
      %{title: "开篇", content: "夜色压在账单上。"},
      %{title: "转折", content: "他攥紧了最后一张符。"}
    ]
  }

  @meta %{exported_at: "2026-06-10T12:00:00Z", total_word_count: 600}

  test "renders header, ordered toc, prose and honest placeholder for unwritten chapter" do
    doc = ExportDocument.render("赛博修仙录", @volumes, @scenes, @meta)

    assert String.starts_with?(doc, "# 赛博修仙录\n")
    assert doc =~ "- 章节总数：2"
    assert doc =~ "- 全书有效字数：600"
    assert doc =~ "1. 第01章：底层灵气账单"
    assert doc =~ "2. 第02章：旧服务器里的残诀"
    # 目录与正文中章节顺序一致（第01章先于第02章）。
    assert chapter_order_correct?(doc, "## 第01章：底层灵气账单", "## 第02章：旧服务器里的残诀")
    # 已采纳正文按场景顺序进入正文段。
    assert chapter_order_correct?(doc, "夜色压在账单上。", "他攥紧了最后一张符。")
    # 无正文章诚实占位，不编造。
    assert doc =~ "> （本章暂无已采纳正文）"
  end

  test "renders volume heading and ends with single trailing newline" do
    doc = ExportDocument.render("书", @volumes, @scenes, @meta)
    assert doc =~ "# 第一卷"
    assert String.ends_with?(doc, "\n")
    refute String.ends_with?(doc, "\n\n")
  end

  test "filename sanitizes path-hostile characters and blank titles" do
    assert ExportDocument.filename("赛博修仙录") == "赛博修仙录"
    assert ExportDocument.filename("a/b\\c:d*e") == "a_b_c_d_e"
    assert ExportDocument.filename("   ") == "未命名作品"
  end

  defp chapter_order_correct?(doc, first, second) do
    {pos1, _} = :binary.match(doc, first)
    {pos2, _} = :binary.match(doc, second)
    pos1 < pos2
  end
end
