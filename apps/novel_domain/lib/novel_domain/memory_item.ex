defmodule NovelDomain.MemoryItem do
  @moduledoc """
  记忆项——可治理的创作事实。

  MemoryItem 是 Governed Memory 层的核心领域对象。它表示一条可独立治理的创作事实：
  可确认、可锁定、可修改权重、可设置有效期、可废弃或归档。

  字段定义冻结于 05-memory-retention-and-retrieval.md §8.1。
  """

  alias NovelDomain.NarrativePosition
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus

  @default_weight 0.5
  @default_confidence 0.5
  @default_source_confidence 0.5

  defstruct [
    :id,
    :work_id,
    :volume_id,
    :arc_id,
    :chapter_id,
    :content,
    :summary,
    :type,
    :scope,
    :status,
    :source_type,
    :source_id,
    :reference_count,
    :weight,
    :confidence,
    :source_confidence,
    :locked,
    :recallable,
    :common_sense,
    :valid_from,
    :valid_until,
    :expire_condition,
    :version,
    :tags,
    :last_referenced_at,
    :created_at,
    :updated_at
  ]

  @type t :: %__MODULE__{
          id: String.t(),
          work_id: String.t(),
          volume_id: String.t() | nil,
          arc_id: String.t() | nil,
          chapter_id: String.t() | nil,
          content: String.t(),
          summary: String.t() | nil,
          type: String.t(),
          scope: String.t(),
          status: String.t(),
          source_type: String.t(),
          source_id: String.t() | nil,
          reference_count: integer(),
          weight: float(),
          confidence: float(),
          source_confidence: float(),
          locked: boolean(),
          recallable: boolean(),
          common_sense: boolean(),
          valid_from: NarrativePosition.t() | nil,
          valid_until: NarrativePosition.t() | nil,
          expire_condition: String.t() | nil,
          version: integer(),
          tags: [String.t()] | nil,
          last_referenced_at: DateTime.t() | nil,
          created_at: DateTime.t(),
          updated_at: DateTime.t()
        }

  @doc """
  创建一个新的 MemoryItem，默认 status = DRAFT、weight = 0.5、version = 1。
  """
  @spec new(
          id :: String.t(),
          work_id :: String.t(),
          content :: String.t(),
          type :: String.t(),
          scope :: String.t(),
          source_type :: String.t()
        ) :: t()
  def new(id, work_id, content, type, scope, source_type)
      when is_binary(id) and is_binary(work_id) and is_binary(content) do
    now = DateTime.utc_now()

    %__MODULE__{
      id: id,
      work_id: work_id,
      content: content,
      type: type,
      scope: scope,
      source_type: source_type,
      status: MemoryStatus.draft(),
      reference_count: 0,
      weight: @default_weight,
      confidence: @default_confidence,
      source_confidence: @default_source_confidence,
      locked: false,
      recallable: true,
      common_sense: false,
      version: 1,
      created_at: now,
      updated_at: now
    }
  end

  @doc "将记忆标记为 CONFIRMED。"
  @spec confirm(t()) :: t()
  def confirm(%__MODULE__{} = item) do
    %__MODULE__{item | status: MemoryStatus.confirmed(), updated_at: next_updated_at(item)}
  end

  @doc "将记忆标记为 STABILIZED。"
  @spec stabilize(t()) :: t()
  def stabilize(%__MODULE__{} = item) do
    %__MODULE__{item | status: MemoryStatus.stabilized(), updated_at: next_updated_at(item)}
  end

  @doc "锁定记忆（代表作者意志），AI 不能自动修改。"
  @spec lock(t()) :: t()
  def lock(%__MODULE__{} = item) do
    %__MODULE__{item | locked: true, updated_at: next_updated_at(item)}
  end

  @doc "解锁记忆。"
  @spec unlock(t()) :: t()
  def unlock(%__MODULE__{} = item) do
    %__MODULE__{item | locked: false, updated_at: next_updated_at(item)}
  end

  @doc "将记忆标记为 DEPRECATED 并设为不可召回。"
  @spec deprecate(t()) :: t()
  def deprecate(%__MODULE__{} = item) do
    %__MODULE__{
      item
      | status: MemoryStatus.deprecated(),
        recallable: false,
        updated_at: next_updated_at(item)
    }
  end

  @doc "将记忆标记为 ARCHIVED 并设为不可召回。"
  @spec archive(t()) :: t()
  def archive(%__MODULE__{} = item) do
    %__MODULE__{
      item
      | status: MemoryStatus.archived(),
        recallable: false,
        updated_at: next_updated_at(item)
    }
  end

  @doc "更新权重。weight 范围 0.0-1.0。"
  @spec update_weight(t(), float()) :: t()
  def update_weight(%__MODULE__{} = item, weight) when is_float(weight) do
    %__MODULE__{item | weight: weight, updated_at: next_updated_at(item)}
  end

  @doc "更新置信度。confidence 范围 0.0-1.0。"
  @spec update_confidence(t(), float()) :: t()
  def update_confidence(%__MODULE__{} = item, confidence) when is_float(confidence) do
    %__MODULE__{item | confidence: confidence, updated_at: next_updated_at(item)}
  end

  @doc "更新生效区间。"
  @spec update_validity(
          t(),
          NarrativePosition.t() | nil,
          NarrativePosition.t() | nil,
          String.t() | nil
        ) :: t()
  def update_validity(%__MODULE__{} = item, valid_from, valid_until, expire_condition \\ nil) do
    %__MODULE__{
      item
      | valid_from: valid_from,
        valid_until: valid_until,
        expire_condition: expire_condition,
        updated_at: next_updated_at(item)
    }
  end

  @doc "更新召回开关。"
  @spec update_recallable(t(), boolean()) :: t()
  def update_recallable(%__MODULE__{} = item, recallable) when is_boolean(recallable) do
    %__MODULE__{item | recallable: recallable, updated_at: next_updated_at(item)}
  end

  @doc "更新摘要。"
  @spec update_summary(t(), String.t() | nil) :: t()
  def update_summary(%__MODULE__{} = item, summary) do
    %__MODULE__{item | summary: summary, updated_at: next_updated_at(item)}
  end

  @doc "判断是否为铁律级记忆（weight >= 0.9, CONFIRMED/STABILIZED, locked 或 AUTHOR_CONFIRMED）。"
  @spec iron_law?(t()) :: boolean()
  def iron_law?(%__MODULE__{} = item) do
    item.weight >= 0.9 and
      item.status in [MemoryStatus.confirmed(), MemoryStatus.stabilized()] and
      (item.locked or item.source_type == MemorySourceType.author_confirmed())
  end

  @doc "判断记忆是否可被 AI 自动修改。"
  @spec modifiable?(t()) :: boolean()
  def modifiable?(%__MODULE__{} = item), do: not item.locked

  @doc "增加引用计数。"
  @spec increment_reference(t()) :: t()
  def increment_reference(%__MODULE__{} = item) do
    now = next_updated_at(item)

    %__MODULE__{
      item
      | reference_count: item.reference_count + 1,
        last_referenced_at: now,
        updated_at: now
    }
  end

  defp next_updated_at(%__MODULE__{updated_at: updated_at}) do
    now = DateTime.utc_now()

    if DateTime.compare(now, updated_at) == :gt do
      now
    else
      DateTime.add(updated_at, 1, :microsecond)
    end
  end
end
