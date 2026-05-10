defmodule NovelDomain.AdoptionDecision do
  @moduledoc """
  采纳评估结果。candidate_selected ≠ candidate_adopted。
  """

  @type decision_type ::
          :adopt_tentative
          | :require_confirmation
          | :reject
          | :downgrade_to_dialogue
          | :fail_with_recovery

  @type t :: %__MODULE__{
          adoption_decision_id: String.t(),
          turn_id: String.t(),
          source_action_ref: String.t(),
          candidate_ref: String.t(),
          target_ref: String.t() | nil,
          decision_type: decision_type(),
          adopted_state_ref: String.t() | nil,
          state_trace_ref: String.t() | nil,
          reason_codes: [String.t()],
          projection_hints: [map()],
          decision_trace_ref: String.t() | nil
        }

  @enforce_keys [
    :adoption_decision_id,
    :turn_id,
    :source_action_ref,
    :candidate_ref,
    :decision_type
  ]
  defstruct [
    :adoption_decision_id,
    :turn_id,
    :source_action_ref,
    :candidate_ref,
    :decision_type,
    target_ref: nil,
    adopted_state_ref: nil,
    state_trace_ref: nil,
    reason_codes: [],
    projection_hints: [],
    decision_trace_ref: nil
  ]

  @doc "Whether the candidate was actually adopted."
  @spec adopted?(t()) :: boolean()
  def adopted?(%__MODULE__{decision_type: :adopt_tentative}), do: true
  def adopted?(_), do: false
end
