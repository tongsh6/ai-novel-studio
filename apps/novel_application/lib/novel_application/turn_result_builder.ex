defmodule NovelApplication.TurnResultBuilder do
  @moduledoc """
  从 DialogueFrame 构建 v3 TurnResult。覆盖 reply_only、exploration、tool、artifact、behavior 全场景。
  """

  alias NovelDomain.BehaviorState
  alias NovelDomain.CandidateDirection
  alias NovelDomain.DialogueFrame
  alias NovelDomain.OrchestratorDecision
  alias NovelDomain.TentativeArtifactSet
  alias NovelDomain.ToolResult

  @spec build(
          DialogueFrame.t(),
          map(),
          [CandidateDirection.t()],
          OrchestratorDecision.t() | nil,
          ToolResult.t() | nil,
          TentativeArtifactSet.t() | nil,
          BehaviorState.t() | nil
        ) :: map()
  def build(
        %DialogueFrame{} = frame,
        trace_summary,
        candidates \\ [],
        decision \\ nil,
        tool_result \\ nil,
        artifact_set \\ nil,
        behavior \\ nil
      ) do
    result = %{
      schema_version: "3.0-draft",
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      assistant_message: %{text: frame.author_visible_draft.message},
      ui_cards: [],
      frame_summary: %{
        frame_type: frame.frame_type,
        dialogue_goal: frame.dialogue_goal.summary
      },
      trace_summary: trace_summary,
      phase: build_phase(behavior),
      status: build_status(behavior, decision),
      available_actions: build_available_actions(behavior),
      truthfulness: build_truthfulness(frame, decision, tool_result)
    }

    result
    |> maybe_add_candidates(candidates)
    |> maybe_add_decision(decision)
    |> maybe_add_tool_result(tool_result)
    |> maybe_add_artifacts(artifact_set)
    |> maybe_add_behavior(behavior)
  end

  # ── phase / status ────────────────────────────

  defp build_phase(nil), do: "completed"
  defp build_phase(%BehaviorState{lifecycle_status: :open}), do: "awaiting_author"
  defp build_phase(%BehaviorState{lifecycle_status: :awaiting_author}), do: "awaiting_author"
  defp build_phase(%BehaviorState{lifecycle_status: :resolving}), do: "completed"
  defp build_phase(%BehaviorState{lifecycle_status: :resolved}), do: "completed"
  defp build_phase(%BehaviorState{lifecycle_status: :cancelled}), do: "cancelled"
  defp build_phase(%BehaviorState{lifecycle_status: :failed}), do: "failed"
  defp build_phase(_), do: "completed"

  defp build_status(nil, _decision), do: "conversational"

  defp build_status(%BehaviorState{behavior_type: :clarification, lifecycle_status: s}, _)
       when s in [:open, :awaiting_author], do: "needs_clarification"

  defp build_status(%BehaviorState{behavior_type: :confirmation, lifecycle_status: s}, _)
       when s in [:open, :awaiting_author], do: "needs_confirmation"

  defp build_status(%BehaviorState{lifecycle_status: :cancelled}, _), do: "cancelled"
  defp build_status(_, _), do: "conversational"

  # ── available actions ─────────────────────────

  defp build_available_actions(nil), do: []

  defp build_available_actions(%BehaviorState{} = b) do
    b.available_actions
  end

  # ── truthfulness ──────────────────────────────

  defp build_truthfulness(_frame, nil, nil) do
    %{
      tool_called: false,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false
    }
  end

  defp build_truthfulness(_frame, nil, %ToolResult{} = tr) do
    %{
      tool_called: true,
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
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened:
        blocked and decision.decision_type in [:require_clarification, :require_confirmation],
      execution_blocked: blocked,
      decision_type: decision.decision_type,
      first_blocking_gate: decision.first_blocking_gate,
      reason_codes: decision.reason_codes
    }
  end

  defp build_truthfulness(_frame, %OrchestratorDecision{} = d, %ToolResult{} = tr) do
    %{
      tool_called: true,
      tool_status: tr.status,
      tool_name: tr.tool_name,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false,
      decision_type: d.decision_type,
      first_blocking_gate: d.first_blocking_gate,
      reason_codes: d.reason_codes
    }
  end

  # ── optional sections ─────────────────────────

  defp maybe_add_candidates(r, []), do: r
  defp maybe_add_candidates(r, c), do: Map.put(r, :candidate_directions, format_candidates(c))

  defp maybe_add_decision(r, nil), do: r

  defp maybe_add_decision(r, d) do
    Map.put(r, :orchestrator_decision, %{
      decision_id: d.decision_id,
      decision_type: d.decision_type,
      decision_status: d.decision_status,
      first_blocking_gate: d.first_blocking_gate,
      required_author_action: d.required_author_action
    })
  end

  defp maybe_add_tool_result(r, nil), do: r

  defp maybe_add_tool_result(r, tr) do
    Map.put(r, :tool_result, %{
      tool_result_id: tr.tool_result_id,
      tool_name: tr.tool_name,
      status: tr.status,
      output: tr.output,
      errors: tr.errors,
      state_delta: tr.state_delta
    })
  end

  defp maybe_add_artifacts(r, nil), do: r

  defp maybe_add_artifacts(r, as) do
    adoption_state = %{
      pending: [
        %{
          artifact_id: as.artifact_set_id,
          artifact_type: as.artifact_type,
          requires_adoption: true,
          payload: %{items: as.items},
          adoption_status: as.adoption_status,
          source_tool_result_ref: as.source_tool_result_ref
        }
      ],
      resolved: []
    }

    adoption_card = %{
      card_type: "adoption_card",
      priority: "high",
      visibility: "always",
      title: "待确认的新设定",
      body: "AI 生成了新的创作设定，请审核是否采纳。",
      artifact_refs: [as.artifact_set_id],
      actions: [
        %{
          action_id: "a_accept",
          action_type: "accept",
          label: "采纳",
          target_ref: as.artifact_set_id,
          enabled: true,
          style_hint: "primary"
        },
        %{
          action_id: "a_discard",
          action_type: "discard",
          label: "放弃",
          target_ref: as.artifact_set_id,
          enabled: true,
          style_hint: "secondary"
        },
        %{
          action_id: "a_edit",
          action_type: "edit_then_accept",
          label: "修改",
          target_ref: as.artifact_set_id,
          enabled: true,
          style_hint: "secondary"
        }
      ]
    }

    r
    |> Map.put(:adoption_state, adoption_state)
    |> Map.update(:ui_cards, [adoption_card], fn cards -> cards ++ [adoption_card] end)
  end

  defp maybe_add_behavior(r, nil), do: r

  defp maybe_add_behavior(r, b) do
    Map.put(r, :behavior_state, %{
      behavior_id: b.behavior_id,
      behavior_type: b.behavior_type,
      lifecycle_status: b.lifecycle_status,
      required_next_action: b.required_next_action,
      prompt_contract: b.prompt_contract,
      available_actions: b.available_actions
    })
  end

  @doc "从 creative ToolResult 构建 TentativeArtifactSet。"
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
