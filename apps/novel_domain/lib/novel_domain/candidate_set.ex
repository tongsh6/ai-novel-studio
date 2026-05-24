defmodule NovelDomain.CandidateSet do
  @moduledoc """
  给作者选择的候选集合。不是 adopted state——选择不等于采纳。
  """

  @type candidate :: %{
          required(:candidate_id) => String.t(),
          required(:summary) => String.t(),
          required(:content_ref) => String.t(),
          required(:origin_ref) => String.t(),
          required(:risk_hint) => :low | :medium | :high,
          required(:adoption_target_ref) => String.t() | nil,
          optional(:canon_conflicts) => [map()],
          optional(:work_id) => String.t()
        }

  @type t :: %__MODULE__{
          candidate_set_id: String.t(),
          turn_id: String.t(),
          source_refs: [String.t()],
          candidate_type: :direction | :setting | :outline | :draft_fragment | :revision_option,
          candidates: [candidate()],
          stability: :tentative | :stale | :adopted | :conflicted,
          selection_policy_ref: String.t() | nil,
          adoption_policy_ref: String.t() | nil,
          trace_ref: String.t() | nil
        }

  @enforce_keys [:candidate_set_id, :turn_id, :candidate_type, :candidates]
  defstruct [
    :candidate_set_id,
    :turn_id,
    :candidate_type,
    :candidates,
    source_refs: [],
    stability: :tentative,
    selection_policy_ref: nil,
    adoption_policy_ref: nil,
    trace_ref: nil
  ]
end
