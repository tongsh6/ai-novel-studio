defmodule NovelApplication.TurnResultBuilder do
  @moduledoc """
  从 DialogueFrame 构建 v3 TurnResult。VS-01 扩展：应用 OrchestratorDecision 的 truthfulness 约束。
  """

  alias NovelDomain.CandidateDirection
  alias NovelDomain.DialogueFrame
  alias NovelDomain.OrchestratorDecision

  @doc """
  构建 TurnResult。decision 为 nil 时走 reply-only 路径。
  """
  @spec build(DialogueFrame.t(), map(), [CandidateDirection.t()], OrchestratorDecision.t() | nil) :: map()
  def build(%DialogueFrame{} = frame, trace_summary, candidates \\ [], decision \\ nil) do
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
      truthfulness: build_truthfulness(frame, decision)
    }

    result
    |> maybe_add_candidates(candidates)
    |> maybe_add_decision(decision)
  end

  defp build_truthfulness(_frame, nil) do
    %{
      tool_called: false,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false
    }
  end

  defp build_truthfulness(_frame, %OrchestratorDecision{} = decision) do
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

  defp format_candidates(candidates) do
    Enum.map(candidates, fn c ->
      %{
        direction_id: c.direction_id,
        title: c.title,
        pitch: c.pitch,
        tone_tags: c.tone_tags,
        adoption_status: c.adoption_status
      }
    end)
  end
end
