defmodule NovelApplication.VS00ECP2ProseQualityTest do
  @moduledoc """
  VS-00E CP2：正文生成后独立质量评估，findings + 策略进入 TurnResult，不改 artifact。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-vs00e-cp2"
  # 行结构过度均匀的坏正文（命中确定性 validator.prose_pattern_repetition）
  @bad_prose "他走进房间，看了看四周，坐了下来。他拿起书本，翻了翻几页，放了下来。他望向窗外，看了看天色，叹了口气。他端起茶杯，喝了一小口，搁了回去。"

  test "bad prose produces quality_review with findings; artifact body unchanged (finding not a story fact)" do
    {turn_result, _prompt} = run()

    review = turn_result.quality_review
    assert is_map(review)
    assert review.review_status == "completed"
    assert review.policy_action == "proceed_with_warning"
    assert review.status == "warnings"
    assert review.findings != []

    refs = Enum.map(review.findings, & &1["validator"])
    assert "validator.prose_pattern_repetition" in refs

    # finding 不是作品事实：待采纳产物正文仍是模型原文，未被质量评估改写
    pending = hd(turn_result.adoption_state.pending)
    body = pending.payload.items |> hd() |> Map.get(:body)
    assert body == @bad_prose
  end

  defp run do
    complete = fn _prompt ->
      {:ok,
       %{
         content:
           Jason.encode!(%{
             items: [%{item_id: "cp2-item", title: "第01章", body: @bad_prose, rationale: nil}],
             self_report: %{assumptions: [], intended_reader_effect: nil, used_context_refs: [], risk_flags: []}
           })
       }}
    end

    {turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(),
        decision: allow_decision(),
        context: context(),
        author_input: %{text: "写第一章正文首稿"},
        complete_fn: complete
      })

    {turn_result, nil}
  end

  defp context do
    %DialogueContext{
      workspace_id: @work,
      current_chapters: ["第01章：开端"],
      structured_chapters: [%{title: "第01章：开端", seq: 1, summary: "主角登场。", has_prose: false}],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
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
      author_visible_draft: %{message: "写第一章正文首稿"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan do
    %MicroPlan{
      plan_id: "plan-cp2",
      turn_id: "turn-cp2",
      frame_ref: "frame-cp2",
      plan_goal: %{summary: "写作"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-cp2",
          action_type: :capability_invocation,
          summary: "正文",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: "第01章：开端"
        }
      ]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "decision-cp2",
      turn_id: "turn-cp2",
      frame_ref: "frame-cp2",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end
end
