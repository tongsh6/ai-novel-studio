defmodule NovelDomain.TentativeArtifactSet do
  @moduledoc """
  AI 生成的待采纳创作材料集合。默认 tentative，不自动成为作品事实。

  规格见 docs/design/contracts/VS-02A-tentative-creative-artifact-contract-pack.md §2。
  """

  @type artifact_type ::
          :character_seed
          | :plot_direction
          | :outline_draft
          | :scene_draft
          | :prose_fragment
          | :world_setting
          | :foreshadowing_seed
          | :world_rule_seed
          | :style_rule_seed
          | :constraint_seed

  @type artifact_item :: %{
          required(:item_id) => String.t(),
          required(:title) => String.t(),
          required(:body) => String.t(),
          required(:rationale) => String.t() | nil,
          optional(:provider_call_ref) => String.t() | nil
        }

  # 生成意图 provenance（不是采纳决策）：这批草稿是作为续写还是重写某章生成的，
  # 以及归属哪一章。采纳层据此映射 append/overwrite + 归章；nil 表示非章节续写/重写。
  @type authoring_intent :: :continuation | :rewrite | nil

  @type t :: %__MODULE__{
          artifact_set_id: String.t(),
          artifact_type: artifact_type(),
          items: [artifact_item()],
          source_turn_ref: String.t(),
          source_tool_result_ref: String.t(),
          context_refs: [String.t()],
          authoring_intent: authoring_intent(),
          target_chapter: String.t() | nil,
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
    authoring_intent: nil,
    target_chapter: nil,
    adoption_status: :tentative
  ]

  @doc "Whether this artifact set is still tentative (not adopted)."
  @spec tentative?(t()) :: boolean()
  def tentative?(%__MODULE__{adoption_status: :tentative}), do: true
  def tentative?(_), do: false
end
