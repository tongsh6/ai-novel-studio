defmodule NovelDomain.Chapter do
  @moduledoc """
  章——Volume 下的二级结构单元。

  Chapter 包含多个 Scene。字段定义冻结于 21-novel-object-model.md §5.3。
  """

  alias NovelDomain.Types

  defstruct [
    :id,
    :volume_ref,
    :work_ref,
    :title,
    :seq,
    :status,
    :created_at,
    :updated_at
  ]

  @type t :: %__MODULE__{
          id: Types.id(),
          volume_ref: Types.id(),
          work_ref: Types.id(),
          title: String.t(),
          seq: pos_integer(),
          status: Types.volume_status(),
          created_at: DateTime.t(),
          updated_at: DateTime.t()
        }

  @doc "创建一个新的 Chapter，默认为 :planned 状态。"
  @spec new(String.t(), String.t(), String.t(), String.t(), pos_integer()) :: t()
  def new(id, work_ref, volume_ref, title, seq)
      when is_binary(id) and is_binary(work_ref) and is_binary(volume_ref) and
             is_binary(title) and is_integer(seq) and seq > 0 do
    now = DateTime.utc_now()

    %__MODULE__{
      id: id,
      work_ref: work_ref,
      volume_ref: volume_ref,
      title: title,
      seq: seq,
      status: :planned,
      created_at: now,
      updated_at: now
    }
  end

  @doc "变更 Chapter 状态。"
  @spec update_status(t(), Types.volume_status()) :: t()
  def update_status(%__MODULE__{} = chapter, status) do
    %__MODULE__{chapter | status: status, updated_at: next_updated_at(chapter)}
  end

  @doc "更新标题。"
  @spec update_title(t(), String.t()) :: t()
  def update_title(%__MODULE__{} = chapter, title) when is_binary(title) do
    %__MODULE__{chapter | title: title, updated_at: next_updated_at(chapter)}
  end

  @doc "更新序号。"
  @spec update_seq(t(), pos_integer()) :: t()
  def update_seq(%__MODULE__{} = chapter, seq) when is_integer(seq) and seq > 0 do
    %__MODULE__{chapter | seq: seq, updated_at: next_updated_at(chapter)}
  end

  defp next_updated_at(%__MODULE__{updated_at: updated_at}) do
    now = DateTime.utc_now()

    if DateTime.compare(now, updated_at) == :gt,
      do: now,
      else: DateTime.add(updated_at, 1, :microsecond)
  end
end
