defmodule NovelCommon.Contracts.AuthoringTask do
  @moduledoc """
  B27 CP3：专业调用的共同任务语义（纯 DTO）。

  application 负责把真实业务事实（原话、对象/范围/版本、材料与省略、操作效果、
  上一轮结果、可用操作）组装成本结构；agent 消费本结构渲染角色专属输出契约，
  **不重新解释作者目标、权限或事实地位**（B27 §3.1）。

  本契约是既有 `CreativeRequest` / `QualityEvaluationRequest` 的 additive 部分：
  两个请求可携带 `task`，旧调用不带 `task` 时行为不变；迁移完成后所有专业调用
  必须携带，规则文本真源为 `NovelCommon.AuthoringSemantics`。
  """

  @kinds [
    :first_draft,
    :continuation,
    :rewrite,
    :revision,
    :character_design,
    :character_evolution,
    :outline,
    :world_building,
    :chapter_mission,
    :quality_evaluation,
    :chapter_summary,
    :fact_inventory,
    :ledger_reconcile,
    :provider_progress,
    :result_narration
  ]

  # 作者驱动的任务：必须有 author_goal/author_words 的真实来源，不能由应用虚构。
  @author_driven_kinds [
    :first_draft,
    :continuation,
    :rewrite,
    :revision,
    :character_design,
    :character_evolution,
    :outline,
    :world_building
  ]

  # 需要明确目标对象/范围/基线身份的任务（修订/重写类）。
  @scoped_kinds [:revision, :rewrite]

  # 允许的「来源非作者原话」但仍有真实作者动作/确认依据的来源类型。
  @action_source_kinds [:author_action, :quality_finding, :quality_gate_revision]

  @coverage_values [:single, :chapter, :multi, :none]

  @operation_effects [
    :create_candidate,
    :revise_candidate,
    :format_only,
    :evaluate,
    :extract_facts,
    :reconcile,
    :narrate,
    :design_object
  ]

  @type kind :: atom()
  @type coverage :: :single | :chapter | :multi | :none

  @type scope :: %{
          optional(:object_kind) => atom() | String.t(),
          optional(:refs) => [String.t()],
          optional(:coverage) => coverage(),
          optional(:base_ref) => String.t() | nil,
          optional(:base_hash) => String.t() | nil,
          optional(:target_chapter_ref) => String.t() | nil
        }

  @type material :: %{
          optional(:kind) => atom() | String.t(),
          optional(:ref) => String.t(),
          optional(:version) => integer() | String.t() | nil,
          optional(:complete?) => boolean(),
          optional(:omission_note) => String.t() | nil
        }

  @type output_contract :: %{
          optional(:kind) => atom() | String.t(),
          optional(:schema_ref) => String.t() | nil,
          optional(:artifact_type) => atom() | String.t() | nil,
          optional(:required_keys) => [String.t()],
          optional(:allow_companions) => boolean()
        }

  @type prior_result :: %{
          optional(:run_ref) => String.t() | nil,
          optional(:turn_ref) => String.t() | nil,
          optional(:status) => atom() | String.t() | nil,
          optional(:pending_refs) => [String.t()],
          optional(:summary) => String.t() | nil
        }

  @type t :: %__MODULE__{
          kind: kind(),
          author_goal: String.t() | nil,
          author_words: String.t() | nil,
          scope: scope(),
          materials: [material()],
          preserve: [String.t()],
          operation_effect: atom() | String.t(),
          prior_result: prior_result() | nil,
          source: %{optional(:kind) => atom(), optional(:ref) => String.t()} | nil,
          output_contract: output_contract(),
          source_refs: [String.t()],
          semantic_version: String.t()
        }

  @enforce_keys [:kind, :operation_effect, :output_contract]
  defstruct [
    :kind,
    :author_goal,
    :author_words,
    :operation_effect,
    :prior_result,
    :source,
    scope: %{refs: [], coverage: :none, base_ref: nil, base_hash: nil, target_chapter_ref: nil},
    materials: [],
    preserve: [],
    output_contract: %{kind: :json, required_keys: [], allow_companions: false},
    source_refs: [],
    semantic_version: "b27-semantics-v1"
  ]

  @doc "全部合法任务类型（单一真源）。"
  def kinds, do: @kinds

  @doc "coverage 合法值。"
  def coverage_values, do: @coverage_values

  @doc "合法操作效果。"
  def operation_effects, do: @operation_effects

  @doc "作者驱动任务：必须保留作者原话/目标来源。"
  def author_driven_kinds, do: @author_driven_kinds

  def author_driven?(kind), do: kind in @author_driven_kinds

  @doc "需要明确对象/范围/基线身份的修订/重写类任务。"
  def scoped_kinds, do: @scoped_kinds

  @doc "可按已验证作者动作/质量修订动作作为来源的任务来源类型。"
  def action_source_kinds, do: @action_source_kinds

  @doc """
  JSON-safe 序列化（用于 ToolRequest.input / trace）；语义字段保持原样，便于
  `from_map/1` 无损恢复并由 AuthoringSemantics.validate/1 校验。
  """
  def to_map(%__MODULE__{} = task) do
    %{
      "kind" => task.kind,
      "author_goal" => task.author_goal,
      "author_words" => task.author_words,
      "source" => map_or_nil(task.source),
      "scope" => map_or_empty(task.scope),
      "materials" => Enum.map(List.wrap(task.materials), &map_or_empty/1),
      "preserve" => List.wrap(task.preserve),
      "operation_effect" => task.operation_effect,
      "prior_result" => map_or_nil(task.prior_result),
      "output_contract" => map_or_empty(task.output_contract),
      "source_refs" => List.wrap(task.source_refs),
      "semantic_version" => task.semantic_version
    }
  end

  @doc "从 JSON-safe map 恢复（atom/string 键均可）；未知/缺失字段保持安全默认，校验归 semantics。"
  def from_map(map) when is_map(map) do
    %__MODULE__{
      kind: atom_field(map, :kind),
      author_goal: optional_string(fetch(map, :author_goal)),
      author_words: optional_string(fetch(map, :author_words)),
      source: map_or_nil(fetch(map, :source)),
      scope: map_or_empty(fetch(map, :scope)),
      materials: map_list(fetch(map, :materials)),
      preserve: string_list(fetch(map, :preserve)),
      operation_effect: atom_field(map, :operation_effect),
      prior_result: map_or_nil(fetch(map, :prior_result)),
      output_contract: map_or_empty(fetch(map, :output_contract)),
      source_refs: string_list(fetch(map, :source_refs)),
      semantic_version: optional_string(fetch(map, :semantic_version)) || "b27-semantics-v1"
    }
  end

  def from_map(_other), do: nil

  defp fetch(map, key), do: Map.get(map, key, Map.get(map, Atom.to_string(key)))

  defp atom_field(map, key) do
    case fetch(map, key) do
      value when is_atom(value) -> value
      value when is_binary(value) -> String.to_existing_atom(value)
      _ -> nil
    end
  rescue
    ArgumentError -> nil
  end

  defp optional_string(value) when is_binary(value), do: value
  defp optional_string(_value), do: nil

  defp map_or_nil(value) when is_map(value), do: value
  defp map_or_nil(_value), do: nil

  defp map_or_empty(value) when is_map(value), do: value
  defp map_or_empty(_value), do: %{}

  defp map_list(value) when is_list(value), do: Enum.filter(value, &is_map/1)
  defp map_list(_value), do: []

  defp string_list(value) when is_list(value), do: Enum.filter(value, &is_binary/1)
  defp string_list(_value), do: []

end
