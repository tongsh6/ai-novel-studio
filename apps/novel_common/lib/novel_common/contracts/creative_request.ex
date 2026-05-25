defmodule NovelCommon.Contracts.CreativeRequest do
  @moduledoc """
  Provider-facing creative generation request.

  This envelope carries creative brief and context only. It does not carry UI
  card text, adoption semantics, or authoritative artifact type chosen by the
  planner.
  """

  @type t :: %__MODULE__{
          request_id: String.t(),
          tool_name: String.t(),
          artifact_type: atom(),
          creative_brief: String.t(),
          context_text: String.t(),
          source_turn_ref: String.t(),
          provider_hints: map()
        }

  @enforce_keys [:request_id, :tool_name, :artifact_type, :creative_brief, :source_turn_ref]
  defstruct [
    :request_id,
    :tool_name,
    :artifact_type,
    :creative_brief,
    :source_turn_ref,
    context_text: "",
    provider_hints: %{}
  ]
end
