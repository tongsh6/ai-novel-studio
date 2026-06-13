defmodule NovelDomain.ContextSourceRef do
  @moduledoc """
  上下文片段的来源引用。每个进入 Planner 的上下文片段必须绑定来源。

  规格见 docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md §3。
  """

  @type source_type :: :current_work | :conversation | :memory | :behavior | :policy

  @type t :: %__MODULE__{
          context_ref: String.t(),
          source_type: source_type(),
          source_id: String.t() | nil,
          summary: String.t(),
          redaction_level: :author_safe | :developer
        }

  @enforce_keys [:context_ref, :source_type, :summary]
  defstruct [
    :context_ref,
    :source_type,
    :summary,
    source_id: nil,
    redaction_level: :author_safe
  ]
end
