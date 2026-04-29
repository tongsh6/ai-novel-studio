defmodule NovelDomain.Work do
  @moduledoc """
  小说作品根对象。

  Work 是 domain 层的顶层聚合根，所有其他领域对象都直接或间接归属于某个 Work。
  """

  alias NovelDomain.Types

  defstruct [
    :id,
    :title,
    :status,
    :created_at,
    :updated_at
  ]

  @type t :: %__MODULE__{
          id: Types.id(),
          title: String.t(),
          status: Types.work_status(),
          created_at: DateTime.t(),
          updated_at: DateTime.t()
        }

  @doc """
  创建一个新的 Work，默认为 :draft 状态。
  """
  @spec new(String.t(), String.t()) :: t()
  def new(id, title) when is_binary(id) and is_binary(title) do
    now = DateTime.utc_now()
    %__MODULE__{id: id, title: title, status: :draft, created_at: now, updated_at: now}
  end

  @doc """
  变更 Work 状态。
  """
  @spec update_status(t(), Types.work_status()) :: t()
  def update_status(%__MODULE__{} = work, status) do
    %__MODULE__{work | status: status, updated_at: next_updated_at(work)}
  end

  @doc """
  更新标题。
  """
  @spec update_title(t(), String.t()) :: t()
  def update_title(%__MODULE__{} = work, title) when is_binary(title) do
    %__MODULE__{work | title: title, updated_at: next_updated_at(work)}
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
