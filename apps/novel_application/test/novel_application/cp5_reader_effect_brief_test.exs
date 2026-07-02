defmodule NovelApplication.CP5ReaderEffectBriefTest do
  @moduledoc """
  VS-00C CP5：ReaderEffectBrief 进入 prose_writing，输出自报告作为非权威质量线索。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-cp5"

  test "prose_writing prompt includes reader effect brief and self report stays out of adoption payload" do
    {turn_result, prompt} =
      run(%DialogueContext{
        workspace_id: @work,
        current_chapters: ["第01章：底层灵气账单", "第02章：旧服务器里的残诀"],
        structured_chapters: [
          %{
            title: "第01章：底层灵气账单",
            seq: 1,
            summary: "主角发现灵气账单异常。",
            has_prose: true
          },
          %{
            title: "第02章：旧服务器里的残诀",
            seq: 2,
            summary: "主角进入旧服务器。",
            has_prose: false,
            plan_direction: %{
              "plot_progress" => "主角进入旧服务器并发现残缺功法",
              "character_change" => "主角第一次主动冒险",
              "information_release" => "残诀来源指向公司旧实验",
              "foreshadowing_action" => "残诀尾页缺失",
              "emotion" => "紧张中带兴奋",
              "opening_hook" => "红色账单倒计时",
              "ending_hook" => "服务器里传来妹妹声音"
            }
          }
        ],
        assembly_policy: AssemblyPolicy.for_tier(:floor)
      })

    assert prompt =~ "## 读者效果目标（写前约束）"
    assert prompt =~ "ReaderEffectBrief"
    assert prompt =~ "目标情绪：紧张中带兴奋"
    assert prompt =~ "张力来源：主角进入旧服务器并发现残缺功法"
    assert prompt =~ "承诺/爽点：残诀来源指向公司旧实验"
    assert prompt =~ "悬念边界：服务器里传来妹妹声音"
    assert prompt =~ "章首钩子：红色账单倒计时"
    assert prompt =~ "风险约束："

    assert turn_result.tool_result.output.self_report.intended_reader_effect == "紧张中带兴奋"
    assert turn_result.tool_result.output.self_report.quality_action == :warn
    assert [%{quality_action: :warn}] = turn_result.tool_result.warnings

    assert [pending] = turn_result.adoption_state.pending
    refute Map.has_key?(pending.payload, :self_report)
  end

  defp run(context) do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!(%{
             items: [
               %{
                 item_id: "cp5-item",
                 title: "第02章：旧服务器里的残诀",
                 body: "正文",
                 rationale: nil
               }
             ],
             self_report: %{
               assumptions: ["按 ReaderEffectBrief 生成"],
               intended_reader_effect: "紧张中带兴奋",
               used_context_refs: ["target_structure", "reader_effect_brief"],
               risk_flags: ["章尾钩子强度需复核"]
             }
           })
       }}
    end

    {turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(),
        decision: allow_decision(),
        context: context,
        author_input: %{text: "写第二章首稿"},
        provider_execution: %Execution{result_fn: complete}
      })

    {turn_result, agent |> Agent.get(& &1) |> Enum.join("\n\n")}
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-cp5",
      turn_id: "turn-cp5",
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "写作"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "写第二章首稿"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan do
    %MicroPlan{
      plan_id: "plan-cp5",
      turn_id: "turn-cp5",
      frame_ref: "frame-cp5",
      plan_goal: %{summary: "写作"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-cp5",
          action_type: :capability_invocation,
          summary: "正文",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: "第02章：旧服务器里的残诀"
        }
      ]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "decision-cp5",
      turn_id: "turn-cp5",
      frame_ref: "frame-cp5",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end
end
