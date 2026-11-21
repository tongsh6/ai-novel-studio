defmodule NovelApplication.B30PlotOutlineChapterRefTest do
  use ExUnit.Case, async: true

  alias NovelApplication.PlotOutlineChapterRef

  @valid_ref "chapter:11111111-1111-1111-1111-111111111111"

  @structured [
    %{
      id: "11111111-1111-1111-1111-111111111111",
      seq: 2,
      title: "第11章：外门名册上的空白"
    },
    %{id: "22222222-2222-2222-2222-222222222222", seq: 3, title: "第12章：旧钱与旧名"}
  ]

  test "合法 chapter_ref 必须来自当前作品索引，新章无 ref 允许" do
    items = [
      %{item_id: "a", title: "第2章：外门名册上的空白", body: "方向", chapter_ref: @valid_ref},
      %{item_id: "b", title: "第4章：新章", body: "方向"}
    ]

    assert :ok = PlotOutlineChapterRef.validate_work_scope(items, @structured)
  end

  test "不在当前作品索引中的 ref 可解释拒绝，不静默丢失或退回标题匹配" do
    items = [
      %{
        item_id: "a",
        title: "第11章：外门名册上的空白",
        body: "方向",
        chapter_ref: "chapter:33333333-3333-3333-3333-333333333333"
      }
    ]

    assert {:error, {:cross_work_chapter_ref, "chapter:33333333-3333-3333-3333-333333333333"}} =
             PlotOutlineChapterRef.validate_work_scope(items, @structured)
  end

  test "非法形状与重复绑定拒绝" do
    assert {:error, {:invalid_chapter_ref, "chapter:nope"}} =
             PlotOutlineChapterRef.validate_work_scope(
               [%{item_id: "a", title: "t", body: "b", chapter_ref: "chapter:nope"}],
               @structured
             )

    assert {:error, {:duplicate_chapter_ref, @valid_ref}} =
             PlotOutlineChapterRef.validate_work_scope(
               [
                 %{item_id: "a", title: "t", body: "b", chapter_ref: @valid_ref},
                 %{item_id: "b", title: "t2", body: "b2", chapter_ref: @valid_ref}
               ],
               @structured
             )
  end

  test "可信空索引不能授权模型自报的已有章" do
    assert {:error, {:cross_work_chapter_ref, @valid_ref}} =
             PlotOutlineChapterRef.validate_work_scope(
               [%{item_id: "a", title: "第2章", body: "方向", chapter_ref: @valid_ref}],
               []
             )
  end

  test "索引不可用与空索引区分，已有章引用必须可核验" do
    assert {:error, {:chapter_index_unavailable, @valid_ref}} =
             PlotOutlineChapterRef.validate_work_scope(
               [%{item_id: "a", title: "第2章", body: "方向", chapter_ref: @valid_ref}],
               nil
             )
  end

  test "没有已有章引用的新大纲不依赖索引可用性" do
    items = [%{item_id: "new", title: "新章", body: "方向"}]

    assert :ok = PlotOutlineChapterRef.validate_work_scope(items, [])
    assert :ok = PlotOutlineChapterRef.validate_work_scope(items, nil)
  end
end
