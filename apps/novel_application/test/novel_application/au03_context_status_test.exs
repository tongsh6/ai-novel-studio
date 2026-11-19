defmodule NovelApplication.AU03ContextStatusTest do
  use ExUnit.Case, async: true

  alias NovelApplication.{ContextAssembler, DialoguePlanningService}
  alias NovelDomain.DialogueContext

  @author_text "第03章正文里有没有提到旧账？只按当前作品事实回答。"

  defp scope(context), do: DialoguePlanningService.judgment_scope(context)

  defp context(attrs) do
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

  test "R05 同次阅读审计供应结构章数、正文章数与有效字数" do
    projected =
      scope(
        context(%{
          current_work_snapshot: %{title: "作品", revision: 7},
          structured_chapters: [
            %{
              id: "c1",
              work_id: "work-au03",
              title: "计划",
              has_prose: false,
              summary: "不应默认供应的摘要"
            },
            %{id: "c2", work_id: "work-au03", title: "正文", has_prose: true},
            %{id: "c3", work_id: "work-au03", title: "仅候选章", has_prose: false}
          ],
          reading_audit: %{
            work_id: "work-au03",
            audit: %{chapter_count: 3, empty_chapter_count: 2, total_word_count: 13}
          },
          source_status: %{work: :ok, chapters: :ok}
        })
      )

    assert projected.facts.work.chapter_statistics == %{
             structure_chapter_count: 3,
             written_chapter_count: 1,
             empty_chapter_count: 2,
             total_word_count: 13
           }

    refute Map.has_key?(projected.facts.work, :chapter_counts)
    assert projected.coverage.chapter_statistics == %{status: "complete"}
    assert projected.coverage.chapters == %{status: "not_read"}
    assert projected.coverage.chapter_prose == %{status: "not_read"}
    refute Jason.encode!(projected) =~ "不应默认供应的摘要"
    refute Map.has_key?(projected.facts, :chapters)
  end

  test "R05 无真实审计时不从空数组、未知正文或坏身份推定总量" do
    chapter = %{id: "c1", work_id: "work-au03", title: "第一章", has_prose: true}

    for chapters <- [
          [],
          [chapter],
          [Map.put(chapter, :has_prose, nil)],
          [chapter, chapter],
          [Map.put(chapter, :work_id, "other")],
          [Map.delete(chapter, :work_id)]
        ] do
      projected =
        scope(
          context(%{
            current_work_snapshot: %{title: "作品"},
            structured_chapters: chapters,
            source_status: %{work: :ok, chapters: :ok}
          })
        )

      refute Map.has_key?(projected.facts.work, :chapter_statistics)
      refute Map.has_key?(projected.facts.work, :chapter_counts)
      assert projected.coverage.chapter_statistics == %{status: "not_read"}
    end
  end

  test "R05 未读失败或不完整来源不供应零，真实空审计才供应零" do
    audit = %{
      work_id: "work-au03",
      audit: %{chapter_count: 0, empty_chapter_count: 0, total_word_count: 0}
    }

    for {status, expected} <- [
          {:unknown, "not_read"},
          {:unavailable, "unavailable"},
          {:partial, "partial"},
          {:stale, "stale"}
        ] do
      projected =
        scope(
          context(%{
            current_work_snapshot: %{title: "作品"},
            reading_audit: audit,
            source_status: %{work: :ok, chapters: status}
          })
        )

      refute Map.has_key?(projected.facts.work, :chapter_statistics)
      assert projected.coverage.chapter_statistics == %{status: expected}
    end

    empty =
      scope(context(%{current_work_snapshot: %{title: "空作品"}, reading_audit: audit}))

    assert empty.facts.work.chapter_statistics == %{
             structure_chapter_count: 0,
             written_chapter_count: 0,
             empty_chapter_count: 0,
             total_word_count: 0
           }

    assert empty.coverage.chapter_statistics == %{status: "complete"}
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
      assert projected.coverage.chapters == %{status: "not_read"}
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
    assert projected.coverage.chapters == %{status: "not_read"}
  end

  test "内部读取空集合不冒充模型已读，未供应目录不生成零章结论" do
    value = context(%{current_work_snapshot: %{title: "真实空作品"}})
    assert DialogueContext.source_status_summary(value).sources["chapters"] == "empty"
    empty = scope(value)
    refute Map.has_key?(empty.facts, :chapters)
    assert empty.coverage.chapters == %{status: "not_read"}

    unknown = scope(%DialogueContext{work_id: "work-au03"})
    assert unknown.facts == %{}
    assert unknown.coverage.chapters == %{status: "not_read"}
    refute Map.has_key?(unknown.context, :interaction_state)
  end

  test "内部索引不默认供给模型，缺 prose 状态也不派生已写或计划中" do
    projected =
      scope(
        context(%{
          structured_chapters: [%{id: "chapter-a", title: "第03章", seq: 3}],
          source_status: %{work: :unknown, chapters: :ok}
        })
      )

    refute Map.has_key?(projected.facts, :chapters)
    assert projected.coverage.chapters == %{status: "not_read"}
    assert projected.coverage.chapter_prose == %{status: "not_read"}
  end

  test "默认判断不对未供应的章目录二次截断，也不推断总数或完整性" do
    partial =
      scope(
        context(%{
          structured_chapters: [%{id: "chapter-a", title: "第03章", seq: 3}],
          source_status: %{chapters: :partial}
        })
      )

    assert partial.coverage.chapters == %{status: "not_read"}
    refute Map.has_key?(partial.facts, :chapters)

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
    assert budgeted.coverage.chapters == %{status: "not_read"}
    refute Map.has_key?(budgeted.facts, :chapters)

    refute Enum.any?(
             budgeted.omissions,
             &(&1.reason in ["budget_limited", "draft_refs_truncated"])
           )
  end

  test "跨作品章节不能混入 Scope，作者原字节不被事实构造改变" do
    value =
      context(%{
        structured_chapters: [%{id: "chapter-a", work_id: "other", title: "第03章"}],
        source_status: %{chapters: :ok}
      })

    projected = scope(value)
    refute Map.has_key?(projected.facts, :chapters)
    refute Jason.encode!(projected) =~ "chapter-a"

    text = "  重新核对\n第03章，保留 Ω。\t"

    {:ok, run} =
      NovelDomain.AgentRun.new(%{
        run_id: "run-au03-bytes",
        work_id: "work-au03",
        workspace_id: "workspace-au03",
        session_id: "session-au03",
        parent_turn_ref: "turn-au03",
        origin_frame_ref: "frame-au03",
        profile_ref: "judgment_loop_v1",
        authority_scope: %{production_write: false, allowed_tools: ["judgment"]},
        goal: %{text: text, version: 1}
      })

    request =
      %{text: text}
      |> DialoguePlanningService.judgment_protocol_input_for_test(run, value, [])
      |> NovelApplication.JudgmentProtocol.request_for_production()

    assert [%{blocks: [%{type: "text", text: ^text}]}] =
             Enum.filter(request.messages, &(&1.role == "user"))

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
