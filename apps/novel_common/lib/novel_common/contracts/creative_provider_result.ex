defmodule NovelCommon.Contracts.CreativeProviderResult do
  @moduledoc """
  Structured provider result for creative tools.

  Provider results contain creative items and provider metadata only. UI cards
  and available actions are assembled later by application-level projection.
  """

  @type item :: %{
          required(:item_id) => String.t(),
          required(:title) => String.t(),
          required(:body) => String.t(),
          required(:rationale) => String.t() | nil,
          optional(:provider_call_ref) => String.t() | nil
        }

  @type companion_artifact :: %{
          required(:artifact_type) => atom(),
          required(:item_id) => String.t(),
          required(:title) => String.t(),
          required(:body) => String.t(),
          required(:rationale) => String.t() | nil,
          optional(:provider_call_ref) => String.t() | nil
        }

  @type t :: %__MODULE__{
          status: :ok | :error,
          items: [item()],
          companion_artifacts: [companion_artifact()],
          self_report: map() | nil,
          provider_call_ref: String.t() | nil,
          errors: [map()],
          raw_usage: map()
        }

  defstruct status: :ok,
            items: [],
            companion_artifacts: [],
            self_report: nil,
            provider_call_ref: nil,
            errors: [],
            raw_usage: %{}
end
