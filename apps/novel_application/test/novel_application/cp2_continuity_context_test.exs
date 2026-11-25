defmodule NovelApplication.CP2ContinuityContextTest do
  @moduledoc """
  VS-00C CP2.2：上下文消费（关 G3/G5）。

  - L5（G3）：续写超预算长章时，摘要作为独立派生参考，未证前缀不标替代。
    正文与摘要各自保持真实来源与范围。
  - L3a（G5）：prose_writing 轮注入目标章之前最近 N 章摘要，作为实现态连续性窗口。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-cp2"
  @titles ["第一章", "第二章", "第三章", "第四章", "第五章"]

  defp id(title) do
    index = Enum.find_index(@titles, &(&1 == title)) + 1
    "00000000-0000-4000-8000-" <> String.pad_leading(Integer.to_string(index), 12, "0")
  end

  defp ref(title), do: "chapter:#{id(title)}"

  defp summary(title, text, scope \\ "chapter") do
    %{
      ref: "chapter_summary:#{id(title)}",
      chapter_ref: ref(title),
      chapter_title: title,
      summary_text: text,
      source_type: "derived_summary",
      adoption_status: "ACCEPTED",
      material_scope: scope,
      revision_base: "draft:base:1",
      content_source_ref: "turn-source"
    }
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-cp2",
      turn_id: "turn-cp2",
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "写作"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "好的"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan(action_overrides) do
    action =
      Map.merge(
        %{
          action_id: "act-cp2",
          action_type: :capability_invocation,
          summary: "正文",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: :continuation,
          requested_chapter_raw: "第一章",
          target_chapter: "第一章"
        },
        action_overrides
      )

    %MicroPlan{
      plan_id: "plan-cp2",
      turn_id: "turn-cp2",
      frame_ref: "frame-cp2",
      plan_goal: %{summary: "写作"},
      risk_hint: :low,
      proposed_actions: [action]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "d-allow",
      turn_id: "turn-cp2",
      frame_ref: "frame-cp2",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end

  defp run(opts) do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    complete = fn prompt ->
      call_index =
        Agent.get_and_update(agent, fn calls -> {length(calls) + 1, [prompt | calls]} end)

      {:ok,
       %{
         provider_call_ref: "pcall-continuity-context-#{call_index}",
         provider_run_ref: "prun-continuity-context-#{call_index}",
         content:
           Jason.encode!([
             %{"item_id" => "i1", "title" => "稿", "body" => "续", "rationale" => nil}
           ])
       }}
    end

    chapters = opts[:chapters] || ["第一章"]
    entries = opts[:entries] || Enum.map(chapters, &%{id: id(&1), title: &1})

    base = %{
      frame: frame(),
      plan: plan(opts[:action] || %{}),
      decision: allow_decision(),
      context: %DialogueContext{
        work_id: @work,
        current_chapters: chapters,
        assembly_policy: opts[:assembly_policy] || AssemblyPolicy.for_tier(:floor)
      },
      author_input: %{text: "写正文"},
      provider_execution: %Execution{result_fn: complete},
      chapter_index_reader: fn _ -> entries end
    }

    input =
      base
      |> maybe_put(:chapter_prose_reader, opts[:prose_reader])
      |> maybe_put(:chapter_summary_reader, opts[:summary_reader])

    {turn_result, _trace, _transcript} = TurnExecutionService.execute(input)

    prompts =
      agent
      |> Agent.get(& &1)
      |> Enum.map_join("\n\n", &NovelApplication.TestAgenticLoopFixtures.prompt_text/1)

    {turn_result, prompts}
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp reader_for(prose_by_ref) do
    fn _work, chapter -> Map.get(prose_by_ref, chapter, "") end
  end

  defp summary_reader(by_ref_map, previous_list) do
    %{
      by_ref: fn _work, chapter_ref -> Map.get(by_ref_map, chapter_ref) end,
      previous: fn _work, _target, n -> Enum.take(previous_list, n) end
    }
  end

  describe "L5（G3）正文裁剪与本章派生摘要分离" do
    for scope <- ["chapter", "fragment", "unknown"] do
      test "超预算续写时保留 #{scope} 来源，未证前缀不冒充摘要替代" do
        long = String.duplicate("甲", 3000)
        source = summary("第一章", "第一章发生了A和B，主角受伤", unquote(scope))

        {turn_result, prompts} =
          run(
            prose_reader: reader_for(%{ref("第一章") => long}),
            summary_reader: summary_reader(%{ref("第一章") => source}, [])
          )

        assert prompts =~ "本章更早的正文已省略，以下是最近的部分"
        assert prompts =~ "## 本章摘要（派生参考"
        assert prompts =~ source.summary_text
        assert prompts =~ source.ref
        assert prompts =~ source.material_scope
        assert prompts =~ "不能证明覆盖省略正文"
        refute prompts =~ "更早正文摘要："
        notes = turn_result.trace_summary[:omission_notes]
        refute hd(notes) =~ "替代"
      end
    end

    test "无本章摘要时如实说明省略" do
      long = String.duplicate("甲", 3000)

      {turn_result, prompts} =
        run(
          prose_reader: reader_for(%{ref("第一章") => long}),
          summary_reader: summary_reader(%{}, [])
        )

      assert prompts =~ "本章更早的正文已省略，以下是最近的部分"
      refute prompts =~ "## 本章摘要"
      refute hd(turn_result.trace_summary[:omission_notes]) =~ "替代"
    end
  end

  describe "L3a（G5）注入目标章之前最近 N 章摘要" do
    test "写第二章时 prompt 含前文各章摘要（第一章）" do
      {_turn_result, prompts} =
        run(
          chapters: ["第一章", "第二章"],
          action: %{authoring_intent: nil, requested_chapter_raw: nil, target_chapter: "第二章"},
          summary_reader: summary_reader(%{}, [summary("第一章", "第一章梗概XYZ")])
        )

      assert prompts =~ "## 前文各章摘要"
      assert prompts =~ "第一章梗概XYZ"
    end

    test "排除本章（避免与 L5 重复）" do
      {_turn_result, prompts} =
        run(
          chapters: ["第一章", "第二章"],
          action: %{authoring_intent: nil, requested_chapter_raw: nil, target_chapter: "第二章"},
          summary_reader:
            summary_reader(%{}, [
              summary("第二章", "二章梗概_当前章"),
              summary("第一章", "一章梗概_前章")
            ])
        )

      assert prompts =~ "一章梗概_前章"
      refute prompts =~ "二章梗概_当前章"
    end

    test "摘要窗口来自 AssemblyPolicy.summary_window，而不是本地常量" do
      {:ok, seen_window} = Agent.start_link(fn -> [] end)

      previous = [
        summary("第一章", "一章梗概"),
        summary("第二章", "二章梗概"),
        summary("第三章", "三章梗概"),
        summary("第四章", "四章梗概")
      ]

      reader = %{
        by_ref: fn _work, _ref -> nil end,
        previous: fn _work, _target, n ->
          Agent.update(seen_window, &[n | &1])
          Enum.take(previous, n)
        end
      }

      policy = %AssemblyPolicy{AssemblyPolicy.for_tier(:floor) | summary_window: 3}

      {_turn_result, prompts} =
        run(
          chapters: ["第一章", "第二章", "第三章", "第四章", "第五章"],
          action: %{authoring_intent: nil, requested_chapter_raw: nil, target_chapter: "第五章"},
          assembly_policy: policy,
          summary_reader: reader
        )

      assert Agent.get(seen_window, & &1) == [3]
      assert prompts =~ "三章梗概"
      refute prompts =~ "四章梗概"
    end

    test "同名章的前序摘要按 ref 排除目标而非标题" do
      preceding = %{summary("第一章", "同名的前一章摘要") | chapter_title: "同名"}
      target = %{summary("第二章", "当前目标章摘要不应进入前序") | chapter_title: "同名"}
      target_ref = ref("第二章")

      {_turn_result, prompts} =
        run(
          chapters: ["同名", "同名"],
          entries: [%{id: id("第一章"), title: "同名"}, %{id: id("第二章"), title: "同名"}],
          action: %{
            authoring_intent: nil,
            requested_chapter_raw: nil,
            target_chapter: "同名",
            target_chapter_ref: target_ref
          },
          summary_reader: summary_reader(%{}, [preceding, target])
        )

      assert prompts =~ preceding.summary_text
      refute prompts =~ target.summary_text
    end

    test "未注入摘要 reader 时无前文各章摘要段（行为不变）" do
      {_turn_result, prompts} =
        run(
          chapters: ["第一章", "第二章"],
          action: %{authoring_intent: nil, requested_chapter_raw: nil, target_chapter: "第二章"}
        )

      refute prompts =~ "前文各章摘要"
    end
  end
end
