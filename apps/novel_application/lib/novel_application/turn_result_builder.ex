defmodule NovelApplication.TurnResultBuilder do
  @moduledoc """
  从 DialogueFrame 构建 v3 TurnResult。VS-02 扩展：包含工具调用结果。
  """

  alias NovelDomain.CandidateDirection
  alias NovelDomain.DialogueFrame
  alias NovelDomain.OrchestratorDecision
  alias NovelDomain.TentativeArtifactSet
  alias NovelDomain.ToolResult

  @spec build(
    DialogueFrame.t(), map(), [CandidateDirection.t()],
    OrchestratorDecision.t() | nil, ToolResult.t() | nil, TentativeArtifactSet.t() | nil
  ) :: map()
  def build(%DialogueFrame{} = frame, trace_summary, candidates \\ [],
            decision \\ nil, tool_result \\ nil, artifact_set \\ nil) do
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
    |> maybe_add_artifacts(artifact_set)
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

  defp maybe_add_artifacts(result, nil), do: result
  defp maybe_add_artifacts(result, %TentativeArtifactSet{} = artifact_set) do
    Map.put(result, :tentative_artifacts, %{
      artifact_set_id: artifact_set.artifact_set_id,
      artifact_type: artifact_set.artifact_type,
      items: artifact_set.items,
      adoption_status: artifact_set.adoption_status,
      source_tool_result_ref: artifact_set.source_tool_result_ref
    })
  end

  @doc "从 creative ToolResult 构建 TentativeArtifactSet。"
  @spec build_artifact_set(ToolResult.t(), String.t()) :: TentativeArtifactSet.t()
  def build_artifact_set(%ToolResult{} = tool_result, turn_ref) do
    artifact_type = to_artifact_type(tool_result.output[:artifact_type])
    items = tool_result.output[:items] || []

    %TentativeArtifactSet{
      artifact_set_id: "as_#{System.unique_integer([:positive, :monotonic])}",
      artifact_type: artifact_type,
      items: items,
      source_turn_ref: turn_ref,
      source_tool_result_ref: tool_result.tool_result_id,
      adoption_status: :tentative
    }
  end

  defp to_artifact_type("character_seed"), do: :character_seed
  defp to_artifact_type("plot_direction"), do: :plot_direction
  defp to_artifact_type("outline_draft"), do: :outline_draft
  defp to_artifact_type("scene_draft"), do: :scene_draft
  defp to_artifact_type("prose_fragment"), do: :prose_fragment
  defp to_artifact_type(_), do: :prose_fragment

  defp format_candidates(candidates) do
    Enum.map(candidates, fn c ->
      %{direction_id: c.direction_id, title: c.title, pitch: c.pitch,
        tone_tags: c.tone_tags, adoption_status: c.adoption_status}
    end)
  end
end
