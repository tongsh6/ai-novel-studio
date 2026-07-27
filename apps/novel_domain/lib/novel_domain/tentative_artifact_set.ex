defmodule NovelDomain.TentativeArtifactSet do
  @moduledoc """
  AI 生成的待采纳创作材料集合。默认 tentative，不自动成为作品事实。

  规格见 docs/design/contracts/VS-02A-tentative-creative-artifact-contract-pack.md §2。
  """

  @type artifact_type ::
          :character_seed
          | :character_evolution_seed
          | :plot_direction
          | :outline_draft
          | :scene_draft
          | :prose_fragment
          | :world_setting
          | :foreshadowing_seed
          | :world_rule_seed
          | :style_rule_seed
          | :constraint_seed
          | :work_skeleton_suggestion

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

  # VS-00E CP3：修订候选 provenance（不是采纳决策）。当这批草稿是“针对质量发现重写某个
  # tentative 草稿”而生成时记录：被修订的原草稿、修订原因、所针对的质量发现引用。原草稿保留、
  # 修订草稿同样是 tentative、不自动采纳（ADR-0020）。非修订路径全部为 nil/[]。
  @type t :: %__MODULE__{
          artifact_set_id: String.t(),
          artifact_type: artifact_type(),
          items: [artifact_item()],
          source_turn_ref: String.t(),
          source_tool_result_ref: String.t(),
          context_refs: [String.t()],
          authoring_intent: authoring_intent(),
          target_chapter: String.t() | nil,
          revision_base: String.t() | nil,
          revision_reason: String.t() | nil,
          quality_finding_refs: [String.t()],
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
    revision_base: nil,
    revision_reason: nil,
    quality_finding_refs: [],
    adoption_status: :tentative
  ]

  @doc "Whether this artifact set is still tentative (not adopted)."
  @spec tentative?(t()) :: boolean()
  def tentative?(%__MODULE__{adoption_status: :tentative}), do: true
  def tentative?(_), do: false

  @doc "Whether this artifact set was generated as a quality-finding revision of an earlier draft."
  @spec revision?(t()) :: boolean()
  def revision?(%__MODULE__{revision_base: base}) when is_binary(base) and base != "", do: true
  def revision?(_), do: false

  @typedoc """
  可独立采纳的单元：把候选集分解成作者能逐项授权的最小采纳目标。
  `artifact_id` 是该单元在 pending / available_action / 采纳中的稳定标识。
  """
  @type adoptable_unit :: %{
          artifact_id: String.t(),
          item_id: String.t() | nil,
          items: [artifact_item()]
        }

  @doc """
  把候选集分解为可独立采纳的单元（AU-09 角色候选逐项采纳）。

  当候选集是“逐候选独立”类型（如 `character_seed`）且含多个候选条目时，每个条目成为
  一个独立可采纳单元，拥有自己的 `artifact_id`（`<set_id>::<item_id>`）；作者据此对每个
  角色候选单独授权，采纳一个只写入对应 Character，其它候选保持未采纳。

  其它类型（如 `outline_draft` 的多章属于同一份大纲）或单条候选集整体作为一个单元，
  保持既有 set 级采纳语义不变。
  """
  @spec adoptable_units(t()) :: [adoptable_unit()]
  def adoptable_units(%__MODULE__{} = set) do
    if per_candidate_type?(set.artifact_type) and length(set.items) > 1 do
      Enum.map(set.items, fn item ->
        item_id = item_field(item, :item_id)
        %{artifact_id: "#{set.artifact_set_id}::#{item_id}", item_id: item_id, items: [item]}
      end)
    else
      [%{artifact_id: set.artifact_set_id, item_id: nil, items: set.items}]
    end
  end

  # 逐候选独立采纳的类型：每个 item 是一个独立的作品资产候选。
  # VS-00G CP4a（收编 user-journeys H13"伏笔/规则逐项采纳扩展"）：设定盘点提案集
  # 含多类 seed，每类都逐项独立采纳（采纳一个只落一个 canon）。outline_draft 等
  # "同一产物多 item"仍整体采纳，不在此列。
  # VS-00G CP4d：work_skeleton_suggestion 每 item = 一个缺位规划字段的建议
  # （target_length/planned_volumes/serial_form），采纳一项只回写一个立项字段。
  @per_candidate_types ~w(character_seed world_rule_seed foreshadowing_seed style_rule_seed constraint_seed work_skeleton_suggestion)a

  defp per_candidate_type?(type) when is_atom(type), do: type in @per_candidate_types
  defp per_candidate_type?(type) when is_binary(type), do: String.to_existing_atom(type) in @per_candidate_types
  defp per_candidate_type?(_type), do: false

  defp item_field(item, key) when is_map(item),
    do: Map.get(item, key) || Map.get(item, Atom.to_string(key))

  defp item_field(_item, _key), do: nil
end
