defmodule NovelAgent.Router.Result do
  @moduledoc """
  Router 输出结构（ADR-0010 §2 envelope）。

  对应 SlotSchema 的运行时实例化：schema_id / deferred_to_runtime 来自
  intent registry，extracted_slots / missing_required_slots 由 slot filling 产出。
  """

  defstruct [
    :intent_name,
    :schema_id,
    :extracted_slots,
    :missing_required_slots,
    :needs_clarification,
    :deferred_to_runtime,
    requires_confirmation: false,
    risk_class: "low"
  ]

  @type t :: %__MODULE__{
          intent_name: String.t() | :unknown,
          schema_id: String.t() | nil,
          extracted_slots: %{String.t() => String.t()},
          missing_required_slots: [String.t()],
          needs_clarification: boolean(),
          deferred_to_runtime: [String.t()],
          requires_confirmation: boolean(),
          risk_class: String.t()
        }
end
