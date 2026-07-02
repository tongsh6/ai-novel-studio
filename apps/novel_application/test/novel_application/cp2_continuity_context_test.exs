defmodule NovelApplication.CP2ContinuityContextTest do
  @moduledoc """
  VS-00C CP2.2：上下文消费（关 G3/G5）。

  - L5（G3）：续写超预算长章时，被裁掉的更早正文以本章摘要替代（excerpt 含摘要，
    OmissionNote.replacement=chapter_summary:章）；无摘要才回落 CP1 行为（replacement=nil）。
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
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "i1", "title" => "稿", "body" => "续", "rationale" => nil}
           ])
       }}
    end

    base = %{
      frame: frame(),
      plan: plan(opts[:action] || %{}),
      decision: allow_decision(),
      context: %DialogueContext{
        workspace_id: @work,
        current_chapters: opts[:chapters] || ["第一章"],
        assembly_policy: opts[:assembly_policy] || AssemblyPolicy.for_tier(:floor)
      },
      author_input: %{text: "写正文"},
      provider_execution: %Execution{result_fn: complete}
    }

    input =
      base
      |> maybe_put(:chapter_prose_reader, opts[:prose_reader])
      |> maybe_put(:chapter_summary_reader, opts[:summary_reader])

    {turn_result, _trace} = TurnExecutionService.execute(input)
    prompts = agent |> Agent.get(& &1) |> Enum.join("\n\n")
    {turn_result, prompts}
  end

  defp maybe_put(map, _key, nil), do: map
  defp maybe_put(map, key, value), do: Map.put(map, key, value)

  defp reader_for(prose_by_chapter) do
    fn _work, chapter -> Map.get(prose_by_chapter, chapter, "") end
  end

  defp summary_reader(by_title_map, previous_list) do
    %{
      by_title: fn _work, title -> Map.get(by_title_map, title) end,
      previous: fn _work, _target, n -> Enum.take(previous_list, n) end
    }
  end

  describe "L5（G3）被裁前文以本章摘要兜底" do
    test "超预算续写时 excerpt 含本章摘要且 OmissionNote.replacement=chapter_summary:章" do
      long = String.duplicate("甲", 3000)

      {turn_result, prompts} =
        run(
          prose_reader: reader_for(%{"第一章" => long}),
          summary_reader: summary_reader(%{"第一章" => "第一章发生了A和B，主角受伤"}, [])
        )

      assert prompts =~ "更早正文摘要：第一章发生了A和B，主角受伤"
      notes = turn_result.trace_summary[:omission_notes]
      assert hd(notes) =~ "以 chapter_summary:第一章 替代"
    end

    test "无本章摘要时回落 CP1 行为（replacement=nil，无摘要替代）" do
      long = String.duplicate("甲", 3000)

      {turn_result, prompts} =
        run(
          prose_reader: reader_for(%{"第一章" => long}),
          summary_reader: summary_reader(%{}, [])
        )

      assert prompts =~ "本章更早的正文已省略，以下是最近的部分"
      refute prompts =~ "更早正文摘要"
      refute hd(turn_result.trace_summary[:omission_notes]) =~ "替代"
    end
  end

  describe "L3a（G5）注入目标章之前最近 N 章摘要" do
    test "写第二章时 prompt 含前文各章摘要（第一章）" do
      {_turn_result, prompts} =
        run(
          chapters: ["第一章", "第二章"],
          action: %{authoring_intent: nil, requested_chapter_raw: nil, target_chapter: "第二章"},
          summary_reader: summary_reader(%{}, [%{chapter_title: "第一章", summary_text: "第一章梗概XYZ"}])
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
              %{chapter_title: "第二章", summary_text: "二章梗概_当前章"},
              %{chapter_title: "第一章", summary_text: "一章梗概_前章"}
            ])
        )

      assert prompts =~ "一章梗概_前章"
      refute prompts =~ "二章梗概_当前章"
    end

    test "摘要窗口来自 AssemblyPolicy.summary_window，而不是本地常量" do
      {:ok, seen_window} = Agent.start_link(fn -> [] end)

      previous = [
        %{chapter_title: "第一章", summary_text: "一章梗概"},
        %{chapter_title: "第二章", summary_text: "二章梗概"},
        %{chapter_title: "第三章", summary_text: "三章梗概"},
        %{chapter_title: "第四章", summary_text: "四章梗概"}
      ]

      reader = %{
        by_title: fn _work, _title -> nil end,
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
