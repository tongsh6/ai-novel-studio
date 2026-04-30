defmodule NovelAgent.IntentRegistry.SlotSchema do
  @moduledoc """
  ADR-0010 §2 slot schema envelope。

  每个已注册 intent 持有一份 SlotSchema，描述其 slot 的最小字段集
  与运行时延迟补齐项。
  """

  alias NovelFoundation.Enums.Defaultability
  alias NovelFoundation.Enums.Inferability
  alias NovelFoundation.Enums.Requiredness
  alias NovelFoundation.Enums.ScopeDependency
  alias NovelFoundation.Enums.SlotType

  @type slot_entry :: %{
          slot_name: String.t(),
          slot_type: SlotType.t(),
          description: String.t() | nil,
          requiredness: Requiredness.t(),
          inferability: Inferability.t(),
          defaultability: Defaultability.t(),
          allowed_values_ref: String.t() | nil,
          validation_rules_ref: String.t() | nil,
          scope_dependency: ScopeDependency.t() | nil
        }

  @enforce_keys [
    :schema_id,
    :intent_name,
    :schema_version,
    :slots,
    :deferred_to_runtime
  ]
  defstruct [
    :schema_id,
    :intent_name,
    :schema_version,
    :slots,
    :deferred_to_runtime
  ]

  @type t :: %__MODULE__{
          schema_id: String.t(),
          intent_name: String.t(),
          schema_version: pos_integer(),
          slots: [slot_entry()],
          deferred_to_runtime: [String.t()]
        }

  @doc "返回 schema 中所有 required_to_execute + not_inferable + no_default 的 slot name。"
  @spec blocking_slots(t()) :: [String.t()]
  def blocking_slots(%__MODULE__{} = schema) do
    schema.slots
    |> Enum.filter(fn s ->
      s.requiredness == Requiredness.required_to_execute() and
        s.inferability == Inferability.not_inferable() and
          s.defaultability == Defaultability.no_default()
    end)
    |> Enum.map(& &1.slot_name)
  end
end

defmodule NovelAgent.IntentRegistry do
  @moduledoc """
  Intent Registry — 注册所有 intent 及其 slot schema（ADR-0010 §2）。

  Phase 0 Week 4：硬编码 CREATE_WORK_SEED。
  Phase 1：slot schema 升级为 ADR-0010 完整 envelope（9 字段 slot entry + 5 字段 schema）。
  """

  alias NovelAgent.IntentRegistry.SlotSchema
  alias NovelFoundation.Enums.Defaultability
  alias NovelFoundation.Enums.Inferability
  alias NovelFoundation.Enums.Requiredness
  alias NovelFoundation.Enums.ScopeDependency
  alias NovelFoundation.Enums.SlotType

  @type intent_name :: String.t()

  @default_deferred [
    "capability_mapping",
    "prompt",
    "ui_layout",
    "approval_policy_id"
  ]

  @intents %{
    "intent.CREATE_WORK_SEED" => %SlotSchema{
      schema_id: "slot_schema.CREATE_WORK_SEED.v1",
      intent_name: "intent.CREATE_WORK_SEED",
      schema_version: 1,
      deferred_to_runtime: @default_deferred,
      slots: [
        %{
          slot_name: "genre",
          slot_type: SlotType.enum_or_text(),
          description: "作品类型或类型组合",
          requiredness: Requiredness.required_to_execute(),
          inferability: Inferability.not_inferable(),
          defaultability: Defaultability.no_default(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.work()
        },
        %{
          slot_name: "core_selling_point",
          slot_type: SlotType.text(),
          description: "核心卖点或独特定位",
          requiredness: Requiredness.required_to_execute(),
          inferability: Inferability.not_inferable(),
          defaultability: Defaultability.no_default(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.work()
        },
        %{
          slot_name: "target_reader",
          slot_type: SlotType.text(),
          description: "目标读者群体",
          requiredness: Requiredness.required_to_execute(),
          inferability: Inferability.not_inferable(),
          defaultability: Defaultability.no_default(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.work()
        },
        %{
          slot_name: "tone_preference",
          slot_type: SlotType.enum_or_text(),
          description: "行文风格或语气偏好",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.inferable_with_high_confidence(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.style()
        },
        %{
          slot_name: "reference_works",
          slot_type: SlotType.object_ref_list(),
          description: "参考作品列表",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.inferable_with_high_confidence(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.style()
        }
      ]
    },
    "intent.DRAFT_SCENE" => %SlotSchema{
      schema_id: "slot_schema.DRAFT_SCENE.v1",
      intent_name: "intent.DRAFT_SCENE",
      schema_version: 1,
      deferred_to_runtime: @default_deferred,
      slots: [
        %{
          slot_name: "scene_ref",
          slot_type: SlotType.object_ref(),
          description: "目标场景引用",
          requiredness: Requiredness.required_to_execute(),
          inferability: Inferability.inferable_with_high_confidence(),
          defaultability: Defaultability.no_default(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.scene()
        },
        %{
          slot_name: "scene_boundary",
          slot_type: SlotType.range_ref(),
          description: "场景边界或剧情范围",
          requiredness: Requiredness.required_to_execute(),
          inferability: Inferability.not_inferable(),
          defaultability: Defaultability.no_default(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.scene()
        },
        %{
          slot_name: "target_word_count",
          slot_type: SlotType.integer(),
          description: "目标字数",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.not_inferable(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.scene()
        },
        %{
          slot_name: "style_ref",
          slot_type: SlotType.object_ref(),
          description: "风格样本引用",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.inferable_with_high_confidence(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.style()
        }
      ]
    },
    "intent.DRAFT_CHAPTER" => %SlotSchema{
      schema_id: "slot_schema.DRAFT_CHAPTER.v1",
      intent_name: "intent.DRAFT_CHAPTER",
      schema_version: 1,
      deferred_to_runtime: @default_deferred,
      slots: [
        %{
          slot_name: "chapter_ref",
          slot_type: SlotType.object_ref(),
          description: "目标章节引用",
          requiredness: Requiredness.required_to_execute(),
          inferability: Inferability.inferable_with_high_confidence(),
          defaultability: Defaultability.no_default(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.chapter()
        },
        %{
          slot_name: "scene_refs",
          slot_type: SlotType.object_ref_list(),
          description: "关联场景引用列表",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.inferable_with_high_confidence(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.scene()
        },
        %{
          slot_name: "target_word_count",
          slot_type: SlotType.integer(),
          description: "目标字数",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.not_inferable(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.chapter()
        },
        %{
          slot_name: "style_ref",
          slot_type: SlotType.object_ref(),
          description: "风格样本引用",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.inferable_with_high_confidence(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.style()
        }
      ]
    },
    "intent.REVISE_DRAFT" => %SlotSchema{
      schema_id: "slot_schema.REVISE_DRAFT.v1",
      intent_name: "intent.REVISE_DRAFT",
      schema_version: 1,
      deferred_to_runtime: @default_deferred,
      slots: [
        %{
          slot_name: "draft_ref",
          slot_type: SlotType.object_ref(),
          description: "待修改草稿引用",
          requiredness: Requiredness.required_to_execute(),
          inferability: Inferability.inferable_with_high_confidence(),
          defaultability: Defaultability.no_default(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.draft()
        },
        %{
          slot_name: "revision_direction",
          slot_type: SlotType.text(),
          description: "修改方向或要求",
          requiredness: Requiredness.required_to_execute(),
          inferability: Inferability.not_inferable(),
          defaultability: Defaultability.no_default(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.draft()
        },
        %{
          slot_name: "revision_scope",
          slot_type: SlotType.range_ref(),
          description: "修改范围",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.inferable_with_high_confidence(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.draft()
        },
        %{
          slot_name: "preserve_constraints",
          slot_type: SlotType.object_ref_list(),
          description: "修改中不可破坏的约束引用列表",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.inferable_with_high_confidence(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.draft()
        }
      ]
    },
    "intent.CONTINUE_DRAFTING" => %SlotSchema{
      schema_id: "slot_schema.CONTINUE_DRAFTING.v1",
      intent_name: "intent.CONTINUE_DRAFTING",
      schema_version: 1,
      deferred_to_runtime: @default_deferred,
      slots: [
        %{
          slot_name: "continuation_range",
          slot_type: SlotType.range_ref(),
          description: "续写范围（当前断点之后的范围）",
          requiredness: Requiredness.required_to_execute(),
          inferability: Inferability.not_inferable(),
          defaultability: Defaultability.no_default(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.runtime()
        },
        %{
          slot_name: "checkpoint_interval",
          slot_type: SlotType.integer(),
          description: "checkpoint 间隔（字数或场景数）",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.not_inferable(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.runtime()
        },
        %{
          slot_name: "target_word_count",
          slot_type: SlotType.integer(),
          description: "目标字数",
          requiredness: Requiredness.optional_preference(),
          inferability: Inferability.not_inferable(),
          defaultability: Defaultability.defaultable(),
          allowed_values_ref: nil,
          validation_rules_ref: nil,
          scope_dependency: ScopeDependency.runtime()
        }
      ]
    }
  }

  @doc "返回所有已注册 intent 的名称列表。"
  @spec list() :: [intent_name()]
  def list, do: Map.keys(@intents)

  @doc "获取 intent 的 slot schema。未注册返回 nil。"
  @spec get(intent_name()) :: SlotSchema.t() | nil
  def get(name) when is_binary(name) do
    Map.get(@intents, name)
  end

  @atom_to_intent %{
    create_work_seed: "intent.CREATE_WORK_SEED",
    draft_scene: "intent.DRAFT_SCENE",
    draft_chapter: "intent.DRAFT_CHAPTER",
    revise_draft: "intent.REVISE_DRAFT",
    continue_drafting: "intent.CONTINUE_DRAFTING"
  }

  @spec get(atom()) :: SlotSchema.t() | nil
  def get(name) when is_atom(name) do
    case Map.get(@atom_to_intent, name) do
      nil -> nil
      intent_name -> Map.get(@intents, intent_name)
    end
  end

  @intent_meta %{
    "intent.CREATE_WORK_SEED" => %{risk_class: "MEDIUM", requires_confirmation: false},
    "intent.DRAFT_SCENE" => %{risk_class: "MEDIUM", requires_confirmation: false},
    "intent.DRAFT_CHAPTER" => %{risk_class: "HIGH", requires_confirmation: true},
    "intent.REVISE_DRAFT" => %{risk_class: "MEDIUM", requires_confirmation: false},
    "intent.CONTINUE_DRAFTING" => %{risk_class: "HIGH", requires_confirmation: true}
  }

  @doc "返回 intent 的风险等级和确认需求元数据（ADR-0008 §3）。"
  @spec meta(intent_name() | atom()) :: %{risk_class: String.t(), requires_confirmation: boolean()} | nil
  def meta(intent_name) when is_binary(intent_name) do
    Map.get(@intent_meta, intent_name)
  end

  def meta(name) when is_atom(name) do
    case Map.get(@atom_to_intent, name) do
      nil -> nil
      intent_name -> Map.get(@intent_meta, intent_name)
    end
  end

  @doc "构建 LLM intent 分类用的 prompt。列出所有已注册 intent 及其描述。"
  @spec classification_prompt() :: String.t()
  def classification_prompt do
    intents = Map.keys(@intents)

    intent_lines =
      Enum.map(intents, fn name ->
        schema = Map.get(@intents, name)
        required = schema.slots |> Enum.filter(&(&1.requiredness == Requiredness.required_to_execute())) |> Enum.map(& &1.slot_name)
        "  - intent: #{name}\n    required: #{Enum.join(required, ", ")}"
      end)

    """
    你是一个小说创作的 intent 分类器。根据用户消息，判断其意图属于以下哪个 intent。
    只输出 intent 名称（如 "intent.DRAFT_SCENE"），不要输出任何其他内容。
    如果用户的意图不匹配任何已知 intent，输出 "unknown"。

    已知 intent：
    #{Enum.join(intent_lines, "\n")}
    """
  end

  @doc """
  构建 LLM slot 抽取用的 prompt。列出给定 intent schema 的所有 slot 及其描述，
  要求 LLM 从用户消息中抽取 slot 值并返回 JSON。
  """
  @spec slot_extraction_prompt(String.t()) :: String.t() | nil
  def slot_extraction_prompt(intent_name) when is_binary(intent_name) do
    case Map.get(@intents, intent_name) do
      nil -> nil

      schema ->
        slot_lines =
          Enum.map(schema.slots, fn s ->
            req = if s.requiredness == Requiredness.required_to_execute(), do: "required", else: "optional"
            "  - #{s.slot_name} (#{s.slot_type}, #{req}): #{s.description}"
          end)

        """
        从用户消息中提取以下 slot 的值。返回一个 JSON 对象，key 为 slot_name，value 为提取到的值。
        如果某个 slot 在用户消息中没有被提及，不要在 JSON 中包含它。
        只输出 JSON，不要输出任何其他内容。

        Slots：
        #{Enum.join(slot_lines, "\n")}
        """
    end
  end
end
