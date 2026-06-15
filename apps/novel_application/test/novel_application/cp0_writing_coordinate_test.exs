defmodule NovelApplication.CP0WritingCoordinateTest do
  @moduledoc """
  VS-00C CP0：WritingCoordinate + MissingPolicyResult 接入执行链。

  核心不变量：
  - hard missing（作者显式命名的目标章不存在）→ 不调用 provider，产出可解释 TurnResult。
  - 目标章存在 / 未命名续写 → 正常调用 provider（无回归）。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.TurnExecutionService
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-cp0",
      turn_id: "turn-cp0",
      workspace_id: "work-cp0",
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "重写本章"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "好的"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan(intent, chapter) do
    action =
      %{
        action_id: "act-cp0",
        action_type: :capability_invocation,
        summary: "正文",
        target_ref: "prose_writing",
        write_intent: :tentative,
        risk_hint: :low,
        authoring_intent: intent
      }
      |> then(fn a -> if chapter, do: Map.put(a, :target_chapter, chapter), else: a end)

    %MicroPlan{
      plan_id: "plan-cp0",
      turn_id: "turn-cp0",
      frame_ref: "frame-cp0",
      plan_goal: %{summary: "正文"},
      risk_hint: :low,
      proposed_actions: [action]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "d-allow",
      turn_id: "turn-cp0",
      frame_ref: "frame-cp0",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end

  defp context(chapters),
    do: %DialogueContext{workspace_id: "work-cp0", current_chapters: chapters}

  defp raising_complete_fn do
    fn _prompt -> flunk("provider 不应被调用：hard missing 必须短路") end
  end

  defp recording_complete_fn(agent) do
    fn prompt ->
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "i1", "title" => "稿", "body" => "正文", "rationale" => nil}
           ])
       }}
    end
  end

  describe "hard missing → 不调 provider" do
    test "重写显式命名的不存在章：provider 未被调用 + 可解释回复 + 无 artifact" do
      {turn_result, _trace} =
        TurnExecutionService.execute(%{
          frame: frame(),
          plan: plan(:rewrite, "第99章"),
          decision: allow_decision(),
          context: context(["第一章", "第二章"]),
          author_input: %{text: "重写第99章"},
          complete_fn: raising_complete_fn()
        })

      assert turn_result.assistant_message.text =~ "没有找到"
      assert turn_result.assistant_message.text =~ "第99章"
      refute Map.has_key?(turn_result, :adoption_state)
      refute Map.has_key?(turn_result, :tool_result)
      assert turn_result.truthfulness.tool_called == false
    end

    test "续写显式命名的不存在章：同样短路" do
      {turn_result, _trace} =
        TurnExecutionService.execute(%{
          frame: frame(),
          plan: plan(:continuation, "番外"),
          decision: allow_decision(),
          context: context(["第一章"]),
          author_input: %{text: "续写番外"},
          complete_fn: raising_complete_fn()
        })

      assert turn_result.assistant_message.text =~ "没有找到"
    end
  end

  describe "非缺失 → 正常调 provider（无回归）" do
    test "重写存在的章：provider 被调用并产出 artifact" do
      {:ok, agent} = Agent.start_link(fn -> [] end)
      reader = fn _w, "第一章" -> "第一章已有正文" end

      {turn_result, _trace} =
        TurnExecutionService.execute(%{
          frame: frame(),
          plan: plan(:rewrite, "第一章"),
          decision: allow_decision(),
          context: context(["第一章", "第二章"]),
          author_input: %{text: "重写第一章"},
          complete_fn: recording_complete_fn(agent),
          chapter_prose_reader: reader
        })

      assert length(Agent.get(agent, & &1)) == 1
      assert Map.has_key?(turn_result, :adoption_state)
    end

    test "未命名目标章的续写（接着往下写）：不阻断、正常调用" do
      {:ok, agent} = Agent.start_link(fn -> [] end)
      reader = fn _w, "第二章" -> "第二章已有正文" end

      {_turn_result, _trace} =
        TurnExecutionService.execute(%{
          frame: frame(),
          plan: plan(:continuation, nil),
          decision: allow_decision(),
          context: context(["第一章", "第二章"]),
          author_input: %{text: "接着往下写"},
          complete_fn: recording_complete_fn(agent),
          chapter_prose_reader: reader
        })

      assert length(Agent.get(agent, & &1)) == 1
    end

    test "无 context（确认派发路径）：不评估缺失、不误阻断" do
      {:ok, agent} = Agent.start_link(fn -> [] end)

      {_turn_result, _trace} =
        TurnExecutionService.execute(%{
          frame: frame(),
          plan: plan(:rewrite, "第99章"),
          decision: allow_decision(),
          context: nil,
          author_input: %{text: "确认执行"},
          source_turn_ref: "turn-source",
          complete_fn: recording_complete_fn(agent)
        })

      assert length(Agent.get(agent, & &1)) == 1
    end
  end
end
