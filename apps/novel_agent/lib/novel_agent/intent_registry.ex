defmodule NovelAgent.IntentRegistry.SlotSchema do
  @moduledoc false

  defstruct required: [], optional: []

  @type slot_def :: %{name: atom(), type: :text | :enum_or_text}

  @type t :: %__MODULE__{
          required: [slot_def()],
          optional: [slot_def()]
        }
end

defmodule NovelAgent.IntentRegistry do
  @moduledoc """
  Intent Registry — 注册所有 intent 及其 slot schema。

  Phase 0 Week 4：硬编码 CREATE_WORK_SEED。
  Phase 1 改为动态注册（domain intents 从 novel_application 注入）。
  """

  alias NovelAgent.IntentRegistry.SlotSchema

  @type intent_name :: atom()

  @intents %{
    create_work_seed: %SlotSchema{
      required: [
        %{name: :genre, type: :enum_or_text},
        %{name: :core_selling_point, type: :text},
        %{name: :target_reader, type: :text}
      ],
      optional: [
        %{name: :tone_preference, type: :text},
        %{name: :reference_works, type: :text}
      ]
    }
  }

  @doc "返回所有已注册 intent 的名称列表。"
  @spec list() :: [intent_name()]
  def list, do: Map.keys(@intents)

  @doc "获取 intent 的 slot schema。未注册返回 nil。"
  @spec get(intent_name()) :: SlotSchema.t() | nil
  def get(name) do
    Map.get(@intents, name)
  end
end
