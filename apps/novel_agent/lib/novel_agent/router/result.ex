defmodule NovelAgent.Router.Result do
  @moduledoc false

  defstruct [
    :intent_name,
    :extracted_slots,
    :missing_required_slots,
    :needs_clarification
  ]

  @type t :: %__MODULE__{
          intent_name: atom(),
          extracted_slots: %{atom() => String.t()},
          missing_required_slots: [atom()],
          needs_clarification: boolean()
        }
end
