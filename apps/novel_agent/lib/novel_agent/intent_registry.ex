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
    create_work_seed: "intent.CREATE_WORK_SEED"
  }

  @spec get(atom()) :: SlotSchema.t() | nil
  def get(name) when is_atom(name) do
    case Map.get(@atom_to_intent, name) do
      nil -> nil
      intent_name -> Map.get(@intents, intent_name)
    end
  end
end
