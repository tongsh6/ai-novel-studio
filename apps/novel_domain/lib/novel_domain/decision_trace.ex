defmodule NovelDomain.DecisionTrace do
  @moduledoc """
  v3 决策追溯。覆盖 reply_only、exploration、tool_dispatched、downgrade、confirmation 等全部决策类型。

  字段规格见 docs/design/contracts/VS-00-reply-only-contract-pack.md §3。
  """

  @type t :: %__MODULE__{
          trace_id: String.t(),
          turn_id: String.t(),
          frame_ref: String.t(),
          decision_type: atom(),
          no_tool_reason: String.t(),
          no_behavior_reason: String.t(),
          no_write_reason: String.t(),
          turn_result_ref: String.t(),
          replay_policy: %{use_recorded_frame: boolean(), recall_provider: boolean()},
          redaction_level: :author_safe | :developer,
          event_order: [atom()]
        }

  defstruct [
    :trace_id,
    :turn_id,
    :frame_ref,
    :decision_type,
    :no_tool_reason,
    :no_behavior_reason,
    :no_write_reason,
    :turn_result_ref,
    :replay_policy,
    :redaction_level,
    event_order: []
  ]
end
