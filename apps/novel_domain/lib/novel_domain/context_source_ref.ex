defmodule NovelDomain.ContextSourceRef do
  @moduledoc """
  上下文片段的来源引用。每个进入 Planner 的上下文片段必须绑定来源。

  规格见 docs/design/contracts/VS-00B-dialogue-context-grounding-contract-pack.md §3。

  `:continuity`（VS-00C CP2.2 / contract §7、ADR 候选#2）：连续性层来源——章摘要等写后压缩
  对象进入创作上下文时归此类，让 why 面板能区分「作品背景」(`:current_work`) 与「前章摘要」。
  """

  @type source_type ::
          :current_work | :conversation | :memory | :behavior | :policy | :continuity

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
