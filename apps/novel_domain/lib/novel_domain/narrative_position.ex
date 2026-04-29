defmodule NovelDomain.NarrativePosition do
  @moduledoc """
  叙述位置。定位记忆生效/失效的叙事时空位置。

  用于定义 MemoryItem 的 valid_from / valid_until 字段，表示某个记忆在叙事时间线中的有效区间。
  structure 冻结于 05-memory-retention-and-retrieval.md §8.2。
  """

  defstruct [
    :work_id,
    :volume_id,
    :arc_id,
    :chapter_id,
    :scene_index,
    :narrative_layer,
    :timeline_node_id
  ]

  @type t :: %__MODULE__{
          work_id: String.t(),
          volume_id: String.t() | nil,
          arc_id: String.t() | nil,
          chapter_id: String.t() | nil,
          scene_index: integer() | nil,
          narrative_layer: String.t() | nil,
          timeline_node_id: String.t() | nil
        }

  @doc """
  创建一个新的 NarrativePosition。
  """
  @spec new(String.t()) :: t()
  def new(work_id) when is_binary(work_id) do
    %__MODULE__{work_id: work_id}
  end
end
