defmodule NovelDomain.ProjectionHint do
  @moduledoc """
  告诉 UI 哪些 read model 应该刷新。不是写入授权。
  """

  @type t :: %__MODULE__{
          projection_hint_id: String.t(),
          turn_id: String.t(),
          projection_ref: String.t(),
          reason: :adopted_state_changed | :candidate_superseded | :artifact_updated,
          source_state_trace_ref: String.t(),
          source_decision_ref: String.t(),
          priority: :high | :normal | :low,
          stale_strategy: :refresh | :show_stale_notice | :retry_later,
          trace_ref: String.t() | nil
        }

  @enforce_keys [
    :projection_hint_id,
    :turn_id,
    :projection_ref,
    :reason,
    :source_state_trace_ref,
    :source_decision_ref
  ]
  defstruct [
    :projection_hint_id,
    :turn_id,
    :projection_ref,
    :reason,
    :source_state_trace_ref,
    :source_decision_ref,
    priority: :normal,
    stale_strategy: :refresh,
    trace_ref: nil
  ]
end
