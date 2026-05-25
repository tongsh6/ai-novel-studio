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

  def candidate_actions(%DialogueFrame{} = frame, candidates) do
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

  @spec artifact_actions(TentativeArtifactSet.t() | nil) :: [map()]
  def artifact_actions(nil), do: []

  def artifact_actions(%TentativeArtifactSet{} = artifact_set) do
    [
      artifact_action(artifact_set, "accept", "artifact.accept"),
      artifact_action(artifact_set, "discard", "artifact.discard"),
      artifact_action(artifact_set, "edit_then_accept", "artifact.edit_then_accept")
    ]
  end

  defp artifact_action(%TentativeArtifactSet{} = artifact_set, action_type, label_key) do
    %{
      action_id: "#{action_type}:#{artifact_set.artifact_set_id}",
      action_type: action_type,
      label_key: label_key,
      source_turn_ref: artifact_set.source_turn_ref,
      target_ref: artifact_set.artifact_set_id,
      enabled: true,
      idempotency_key:
        "idem:#{artifact_set.source_turn_ref}:#{action_type}:#{artifact_set.artifact_set_id}",
      trace_ref: artifact_set.source_tool_result_ref
    }
  end
end
