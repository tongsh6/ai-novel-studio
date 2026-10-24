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

  test "合法 chapter_ref（当前作品已有章）透传 :ok；新章无 ref 允许" do
    items = [
      %{item_id: "a", title: "第2章：外门名册上的空白", body: "方向", chapter_ref: @valid_ref},
      %{item_id: "b", title: "第4章：新章", body: "方向"}
    ]

    assert :ok = PlotOutlineChapterRef.validate_work_scope(items, @structured)
  end

  test "跨作品 ref 被可解释拒绝（不静默丢 ref）" do
    items = [
      %{
        item_id: "a",
        title: "第2章：x",
        body: "方向",
        chapter_ref: "chapter:33333333-3333-3333-3333-333333333333"
      }
    ]

    assert {:error, {:cross_work_chapter_ref, "chapter:33333333-3333-3333-3333-333333333333"}} =
             PlotOutlineChapterRef.validate_work_scope(items, @structured)

    tool_result = %NovelCommon.Contracts.ToolResult{
      tool_result_id: "tr",
      tool_request_ref: "tq",
      tool_name: "plot_outline",
      status: :succeeded,
      output: %{items: items},
      artifact_refs: ["a"]
    }

    failed =
      PlotOutlineChapterRef.failed_result(
        tool_result,
        {:cross_work_chapter_ref, "chapter:33333333-3333-3333-3333-333333333333"}
      )

    assert failed.status == :failed
    assert failed.output.error_code == "cross_work_chapter_ref"
    assert failed.output.message =~ "不属于当前作品"
    assert failed.artifact_refs == []
  end

  test "非法形状/重复绑定拒绝；空章节索引时跳过范围校验（不猜）" do
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

    # 无章节索引不可校验 → :ok（诚实降级，不误杀合法 ref）
    assert :ok =
             PlotOutlineChapterRef.validate_work_scope(
               [%{item_id: "a", title: "t", body: "b", chapter_ref: @valid_ref}],
               []
             )
  end
end
