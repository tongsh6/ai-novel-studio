defmodule NovelDomain.TentativeArtifactSet do
  @moduledoc """
  AI 生成的待采纳创作材料集合。默认 tentative，不自动成为作品事实。

  规格见 docs/design-v3/contracts/VS-02A-tentative-creative-artifact-contract-pack.md §2。
  """

  @type artifact_type :: :character_seed | :plot_direction | :outline_draft |
                         :scene_draft | :prose_fragment

  @type artifact_item :: %{
    item_id: String.t(),
    title: String.t(),
    body: String.t(),
    rationale: String.t() | nil
  }

  @type t :: %__MODULE__{
    artifact_set_id: String.t(),
    artifact_type: artifact_type(),
    items: [artifact_item()],
    source_turn_ref: String.t(),
    source_tool_result_ref: String.t(),
    context_refs: [String.t()],
    adoption_status: :tentative
  }

  @enforce_keys [:artifact_set_id, :artifact_type, :source_turn_ref, :source_tool_result_ref]
  defstruct [
    :artifact_set_id,
    :artifact_type,
    :source_turn_ref,
    :source_tool_result_ref,
    items: [],
    context_refs: [],
    adoption_status: :tentative
  ]

  @doc "Whether this artifact set is still tentative (not adopted)."
  @spec tentative?(t()) :: boolean()
  def tentative?(%__MODULE__{adoption_status: :tentative}), do: true
  def tentative?(_), do: false
end
