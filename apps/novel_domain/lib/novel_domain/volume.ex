defmodule NovelDomain.Volume do
  @moduledoc """
  卷——小说的顶层结构单元。

  Volume 是 Work 的直接子节点，包含多个 Chapter。
  字段定义冻结于 21-novel-object-model.md §5.2。
  """

  alias NovelDomain.Types

  defstruct [
    :id,
    :work_ref,
    :title,
    :seq,
    :status,
    :created_at,
    :updated_at
  ]

  @type t :: %__MODULE__{
          id: Types.id(),
          work_ref: Types.id(),
          title: String.t(),
          seq: pos_integer(),
          status: Types.volume_status(),
          created_at: DateTime.t(),
          updated_at: DateTime.t()
        }

  @doc "创建一个新的 Volume，默认为 :planned 状态。"
  @spec new(String.t(), String.t(), String.t(), pos_integer()) :: t()
  def new(id, work_ref, title, seq)
      when is_binary(id) and is_binary(work_ref) and is_binary(title) and is_integer(seq) and
             seq > 0 do
    now = DateTime.utc_now()

    %__MODULE__{
      id: id,
      work_ref: work_ref,
      title: title,
      seq: seq,
      status: :planned,
      created_at: now,
      updated_at: now
    }
  end

  @doc "变更 Volume 状态。"
  @spec update_status(t(), Types.volume_status()) :: t()
  def update_status(%__MODULE__{} = volume, status) do
    %__MODULE__{volume | status: status, updated_at: next_updated_at(volume)}
  end

  @doc "更新标题。"
  @spec update_title(t(), String.t()) :: t()
  def update_title(%__MODULE__{} = volume, title) when is_binary(title) do
    %__MODULE__{volume | title: title, updated_at: next_updated_at(volume)}
  end

  @doc "更新序号。"
  @spec update_seq(t(), pos_integer()) :: t()
  def update_seq(%__MODULE__{} = volume, seq) when is_integer(seq) and seq > 0 do
    %__MODULE__{volume | seq: seq, updated_at: next_updated_at(volume)}
  end

  defp next_updated_at(%__MODULE__{updated_at: updated_at}) do
    now = DateTime.utc_now()

    if DateTime.compare(now, updated_at) == :gt,
      do: now,
      else: DateTime.add(updated_at, 1, :microsecond)
  end
end
