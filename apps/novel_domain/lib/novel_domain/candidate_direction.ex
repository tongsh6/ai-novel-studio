defmodule NovelDomain.CandidateDirection do
  @moduledoc """
  创作探索中的候选方向。是讨论材料，不是系统事实。

  字段规格见 docs/design/contracts/VS-00A-creative-exploration-contract-pack.md §3。
  """

  @type t :: %__MODULE__{
          direction_id: String.t(),
          title: String.t(),
          pitch: String.t(),
          tone_tags: [String.t()],
          source_frame_ref: String.t(),
          risk_hint: :low | :medium | :high,
          adoption_status: :not_adopted
        }

  @enforce_keys [:direction_id, :title, :pitch, :source_frame_ref]
  defstruct [
    :direction_id,
    :title,
    :pitch,
    :source_frame_ref,
    tone_tags: [],
    risk_hint: :low,
    adoption_status: :not_adopted
  ]
end
