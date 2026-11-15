defmodule NovelApplication.AU03ContextStatusTest do
  use ExUnit.Case, async: true

  alias NovelApplication.{ContextAssembler, DialoguePlanningService}
  alias NovelDomain.DialogueContext

  @author_text "第03章正文里有没有提到旧账？只按当前作品事实回答。"

  defp scope(context), do: DialoguePlanningService.judgment_scope(context, @author_text)

  defp context(attrs \\ %{}) do
    struct(
      DialogueContext,
      Map.merge(
        %{
          work_id: "work-au03",
          source_status: %{
            work: :ok,
            chapters: :empty,
            conversation: :empty,
            memory: :empty,
            behavior: :empty,
            interaction: :empty
          }
        },
        attrs
      )
    )
  end

  test "fetcher raise / 非 ok 明确 unavailable，不虚构空作品或零章" do
    for fetch <- [
          fn _work, _text, _session -> raise "db failure" end,
          fn _work, _text, _session -> {:error, :unavailable} end
        ] do
      value = ContextAssembler.assemble_for_input("work-au03", @author_text, fetch)
      assert value.source_status.work == :unavailable
      assert value.source_status.chapters == :unavailable
      projected = scope(value)
      assert projected.facts == %{}
      assert projected.coverage.chapters == %{status: "unavailable"}
      refute Map.has_key?(projected.context, :interaction_state)
    end
  end

  test "单一 DTO 保留已知作品，章节失败不生成空索引" do
    fetch = fn work_id, text, session ->
      assert work_id == "work-au03"
      assert text == @author_text
      assert session == "session-au03"

      {:ok,
       context(%{
         current_work_snapshot: %{title: "灯楼夜雨", revision: 4},
         source_status: %{work: :ok, chapters: :unavailable}
       })}
    end

    value =
      ContextAssembler.assemble_for_input("work-au03", @author_text, fetch,
        session_id: "session-au03"
      )

    projected = scope(value)
    assert projected.facts.work.title == "灯楼夜雨"
    assert projected.facts.work.ref == "work:work-au03"
    assert projected.facts.work.version == 4
    refute Map.has_key?(projected.facts, :chapters)
    assert projected.coverage.chapters == %{status: "unavailable"}
  end

  test "成功空集合可以给零章，缺失来源状态只能 not_read" do
    empty = scope(context(%{current_work_snapshot: %{title: "真实空作品"}}))
    assert empty.facts.chapters == []
    assert empty.coverage.chapters.total == 0
    assert empty.coverage.chapters.status == "complete"

    unknown = scope(%DialogueContext{work_id: "work-au03"})
    assert unknown.facts == %{}
    assert unknown.coverage.chapters == %{status: "not_read"}
    refute Map.has_key?(unknown.context, :interaction_state)
  end

  test "已读索引不表示已读正文，缺 prose 状态不伪装已写或计划中" do
    projected =
      scope(
        context(%{
          structured_chapters: [%{id: "chapter-a", title: "第03章", seq: 3}],
          source_status: %{work: :unknown, chapters: :ok}
        })
      )

    assert [%{ref: "chapter:chapter-a", title: "第03章"} = chapter] = projected.facts.chapters
    refute Map.has_key?(chapter, :has_prose)
    assert projected.coverage.chapters.written_count == 0
    assert projected.coverage.chapters.planned_count == 0
    assert projected.coverage.chapters.unknown_prose_count == 1
    assert projected.coverage.chapter_prose.status == "not_read"
  end

  test "部分读取没有未知的总数；实际预算与 draft ref 截断显式留下遗漏" do
    partial =
      scope(
        context(%{
          structured_chapters: [%{id: "chapter-a", title: "第03章", seq: 3}],
          source_status: %{chapters: :partial}
        })
      )

    assert partial.coverage.chapters == %{status: "partial", returned: 1}

    entries =
      for n <- 1..15 do
        %{
          id: "chapter-#{n}",
          title: "第#{String.pad_leading(Integer.to_string(n), 2, "0")}章",
          seq: n,
          has_prose: true,
          accepted_draft_count: 6,
          current_draft_refs: ["draft:#{n}-1"]
        }
      end

    budgeted = scope(context(%{structured_chapters: entries, source_status: %{chapters: :ok}}))
    assert budgeted.coverage.chapters.total == 15
    assert budgeted.coverage.chapters.status == "partial"
    assert budgeted.coverage.chapters.returned < 15
    assert Enum.any?(budgeted.facts.chapters, &(&1.ref == "chapter:chapter-3"))
    assert Enum.any?(budgeted.omissions, &(&1.reason == "budget_limited"))
    assert Enum.any?(budgeted.omissions, &(&1.reason == "draft_refs_truncated" and &1.total == 6))
  end

  test "跨作品章节不能混入 Scope，作者原字节不被事实构造改变" do
    value =
      context(%{
        structured_chapters: [%{id: "chapter-a", work_id: "other", title: "第03章"}],
        source_status: %{chapters: :ok}
      })

    assert_raise ArgumentError, "invalid_chapter_source", fn -> scope(value) end

    text = "  重新核对\n第03章，保留 Ω。\t"
    projected = DialoguePlanningService.judgment_scope(context(), text)
    refute Map.has_key?(projected, :author_text)
    refute Map.has_key?(projected.facts, :author_text)
  end

  test "专业文本消费者也把缺省状态视为未知，只在明确 empty 时说明空作品" do
    unknown = %DialogueContext{work_id: "work-au03"}
    assert DialogueContext.to_prompt_text(unknown) =~ "未取得/未知"
    refute DialogueContext.to_prompt_text(unknown) =~ "无——这是新对话"
    explicit_empty = context(%{source_status: %{work: :empty}})
    assert DialogueContext.to_prompt_text(explicit_empty) =~ "无——这是新对话"
  end

  test "trace 来源摘要只报告实际来源状态" do
    summary =
      DialogueContext.source_status_summary(
        context(%{
          source_status: %{work: :unavailable, chapters: :ok, conversation: :unknown}
        })
      )

    assert summary.unavailable_sources == ["work"]
    assert summary.unknown_sources == ["conversation"]
    assert summary.sources["chapters"] == "ok"
  end
end
