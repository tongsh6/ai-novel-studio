defmodule NovelApplication.TurnResultBuilder do
  @moduledoc """
  从 DialogueFrame 构建 v3 TurnResult。VS-02 扩展：包含工具调用结果。
  """

  alias NovelDomain.CandidateDirection
  alias NovelDomain.DialogueFrame
  alias NovelDomain.OrchestratorDecision
  alias NovelDomain.ToolResult

  @spec build(
    DialogueFrame.t(), map(), [CandidateDirection.t()], OrchestratorDecision.t() | nil, ToolResult.t() | nil
  ) :: map()
  def build(%DialogueFrame{} = frame, trace_summary, candidates \\ [], decision \\ nil, tool_result \\ nil) do
    result = %{
      schema_version: "3.0-draft",
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      assistant_message: %{text: frame.author_visible_draft.message},
      frame_summary: %{
        frame_type: frame.frame_type,
        dialogue_goal: frame.dialogue_goal.summary
      },
      trace_summary: trace_summary,
      phase: "completed",
      status: "done",
      available_actions: [],
      truthfulness: build_truthfulness(frame, decision, tool_result)
    }

    result
    |> maybe_add_candidates(candidates)
    |> maybe_add_decision(decision)
    |> maybe_add_tool_result(tool_result)
  end

  defp build_truthfulness(_frame, nil, nil) do
    %{
      tool_called: false,
      tool_dispatched: false,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false
    }
  end

  defp build_truthfulness(_frame, nil, %ToolResult{} = tr) do
    %{
      tool_called: true,
      tool_dispatched: true,
      tool_status: tr.status,
      tool_name: tr.tool_name,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false
    }
  end

  defp build_truthfulness(_frame, %OrchestratorDecision{} = decision, nil) do
    blocked = OrchestratorDecision.blocks_execution?(decision)

    %{
      tool_called: false,
      tool_dispatched: false,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false,
      execution_blocked: blocked,
      decision_type: decision.decision_type,
      first_blocking_gate: decision.first_blocking_gate,
      reason_codes: decision.reason_codes
    }
  end

  defp build_truthfulness(_frame, %OrchestratorDecision{} = decision, %ToolResult{} = tr) do
    %{
      tool_called: true,
      tool_dispatched: true,
      tool_status: tr.status,
      tool_name: tr.tool_name,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false,
      decision_type: decision.decision_type,
      first_blocking_gate: decision.first_blocking_gate,
      reason_codes: decision.reason_codes
    }
  end

  defp maybe_add_candidates(result, []), do: result
  defp maybe_add_candidates(result, candidates) do
    Map.put(result, :candidate_directions, format_candidates(candidates))
  end

  defp maybe_add_decision(result, nil), do: result
  defp maybe_add_decision(result, decision) do
    Map.put(result, :orchestrator_decision, %{
      decision_id: decision.decision_id,
      decision_type: decision.decision_type,
      decision_status: decision.decision_status,
      first_blocking_gate: decision.first_blocking_gate,
      required_author_action: decision.required_author_action
    })
  end

  defp maybe_add_tool_result(result, nil), do: result
  defp maybe_add_tool_result(result, %ToolResult{} = tr) do
    Map.put(result, :tool_result, %{
      tool_result_id: tr.tool_result_id,
      tool_name: tr.tool_name,
      status: tr.status,
      output: tr.output,
      errors: tr.errors,
      state_delta: tr.state_delta
    })
  end

  defp format_candidates(candidates) do
    Enum.map(candidates, fn c ->
      %{direction_id: c.direction_id, title: c.title, pitch: c.pitch,
        tone_tags: c.tone_tags, adoption_status: c.adoption_status}
    end)
  end
end
