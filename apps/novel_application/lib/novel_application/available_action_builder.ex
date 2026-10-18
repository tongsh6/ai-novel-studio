defmodule NovelApplication.AvailableActionBuilder do
  @moduledoc """
  Builds TurnResult available_actions separately from semantic UI cards.
  """

  alias NovelDomain.BehaviorState
  alias NovelDomain.CandidateDirection
  alias NovelDomain.DialogueFrame
  alias NovelDomain.TentativeArtifactSet

  @spec build(keyword()) :: [map()]
  def build(opts) do
    []
    |> Kernel.++(behavior_actions(opts[:behavior]))
    |> Kernel.++(candidate_actions(opts[:frame], opts[:candidates] || []))
    |> Kernel.++(artifact_actions(opts[:artifact_set]))
  end

  @spec behavior_actions(BehaviorState.t() | nil) :: [map()]
  def behavior_actions(nil), do: []
  def behavior_actions(%BehaviorState{} = behavior), do: behavior.available_actions

  @spec candidate_actions(DialogueFrame.t() | nil, [CandidateDirection.t()]) :: [map()]
  def candidate_actions(nil, _candidates), do: []
  def candidate_actions(_frame, []), do: []

  def candidate_actions(%DialogueFrame{frame_type: :creative_exploration} = frame, candidates) do
    candidate_set_ref = "candidate_set:#{frame.turn_id}"

    Enum.map(candidates, fn candidate ->
      %{
        action_id: "choose_candidate:#{candidate.direction_id}",
        action_type: "choose_candidate",
        label_key: "candidate.select",
        source_turn_ref: frame.turn_id,
        candidate_set_ref: candidate_set_ref,
        candidate_ref: candidate.direction_id,
        target_ref: candidate.direction_id,
        enabled: true,
        idempotency_key: "idem:#{frame.turn_id}:choose_candidate:#{candidate.direction_id}",
        trace_ref: "decision_trace:#{frame.turn_id}"
      }
    end)
  end

  def candidate_actions(_frame, _candidates), do: []

  @doc "方向动作只接受用途明确的创作方向，不由旧卡片文案推断业务类型。"
  @spec creative_candidate?(map(), String.t() | nil) :: boolean()
  def creative_candidate?(result, candidate_ref) do
    frame_type = result |> field(:frame_summary) |> field(:frame_type)

    frame_type in [:creative_exploration, "creative_exploration"] and
      Enum.any?(field(result, :candidate_directions) || [], fn candidate ->
        field(candidate, :direction_id) == candidate_ref and
          field(candidate, :kind) in [:creative_direction, "creative_direction"]
      end)
  end

  @doc "读取历史结果时撤销用途不明确的方向动作，保留原讨论内容与其它动作。"
  @spec revalidate_candidate_actions(map() | nil) :: map() | nil
  def revalidate_candidate_actions(nil), do: nil

  def revalidate_candidate_actions(result) do
    key =
      if Map.has_key?(result, :available_actions),
        do: :available_actions,
        else: "available_actions"

    if Map.has_key?(result, key) do
      Map.update!(result, key, fn actions ->
        Enum.reject(actions || [], &invalid_candidate_action?(&1, result))
      end)
    else
      result
    end
  end

  defp invalid_candidate_action?(action, result) do
    field(action, :action_type) == "choose_candidate" and
      not creative_candidate?(result, field(action, :candidate_ref))
  end

  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))
  defp field(_, _), do: nil

  @spec artifact_actions(TentativeArtifactSet.t() | nil) :: [map()]
  def artifact_actions(nil), do: []

  def artifact_actions(%TentativeArtifactSet{} = artifact_set) do
    # AU-09：逐候选独立采纳——多候选 character_seed 拆成每条候选各自的
    # accept/discard/edit，target_ref 指向该候选单元的稳定 artifact_id，作者逐项授权。
    artifact_set
    |> TentativeArtifactSet.adoptable_units()
    |> Enum.flat_map(fn unit ->
      [
        artifact_action(artifact_set, unit, "accept", "artifact.accept"),
        artifact_action(artifact_set, unit, "discard", "artifact.discard"),
        artifact_action(artifact_set, unit, "edit_then_accept", "artifact.edit_then_accept")
      ]
    end)
  end

  defp artifact_action(%TentativeArtifactSet{} = artifact_set, unit, action_type, label_key) do
    %{
      action_id: "#{action_type}:#{unit.artifact_id}",
      action_type: action_type,
      label_key: label_key,
      source_turn_ref: artifact_set.source_turn_ref,
      target_ref: unit.artifact_id,
      enabled: true,
      idempotency_key: "idem:#{artifact_set.source_turn_ref}:#{action_type}:#{unit.artifact_id}",
      trace_ref: artifact_set.source_tool_result_ref
    }
  end
end
