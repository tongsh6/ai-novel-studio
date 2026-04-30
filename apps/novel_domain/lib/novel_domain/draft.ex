defmodule NovelDomain.Draft do
  @moduledoc """
  草稿——Scene 下的正文创作单元。

  Draft 是 AI 生成文本的载体。每个 Draft 必须归属到一个 Scene。
  status 使用 adoption 3 态：:tentative | :accepted | :discarded。

  字段定义冻结于 21-novel-object-model.md §5.4。
  """

  alias NovelDomain.Types

  @type draft_status :: :tentative | :accepted | :discarded

  defstruct [
    :id,
    :scene_ref,
    :work_ref,
    :content,
    :status,
    :revision,
    :created_at,
    :updated_at
  ]

  @type t :: %__MODULE__{
          id: Types.id(),
          scene_ref: Types.id(),
          work_ref: Types.id(),
          content: String.t(),
          status: draft_status(),
          revision: pos_integer(),
          created_at: DateTime.t(),
          updated_at: DateTime.t()
        }

  @doc """
  创建一个新的 Draft，默认为 :tentative 状态。

  scene_ref 不能为空——每个草稿必须归属到一个 scene（21-novel-object-model.md §5.4）。
  """
  @spec new(String.t(), String.t(), String.t(), String.t()) :: t()
  def new(id, work_ref, scene_ref, content)
      when is_binary(id) and is_binary(work_ref) and is_binary(scene_ref) and
             is_binary(content) do
    now = DateTime.utc_now()
    %__MODULE__{
      id: id, work_ref: work_ref, scene_ref: scene_ref, content: content,
      status: :tentative, revision: 1, created_at: now, updated_at: now
    }
  end

  @doc "采纳草稿，状态从 tentative → accepted。"
  @spec accept(t()) :: t()
  def accept(%__MODULE__{status: :tentative} = draft) do
    %__MODULE__{draft | status: :accepted, updated_at: next_updated_at(draft)}
  end

  def accept(%__MODULE__{} = draft), do: draft

  @doc "放弃草稿，状态从 tentative → discarded。"
  @spec discard(t()) :: t()
  def discard(%__MODULE__{status: :tentative} = draft) do
    %__MODULE__{draft | status: :discarded, updated_at: next_updated_at(draft)}
  end

  def discard(%__MODULE__{} = draft), do: draft

  @doc "更新正文内容，递增 revision。"
  @spec update_content(t(), String.t()) :: t()
  def update_content(%__MODULE__{} = draft, content) when is_binary(content) do
    %__MODULE__{draft | content: content, revision: draft.revision + 1, updated_at: next_updated_at(draft)}
  end

  defp next_updated_at(%__MODULE__{updated_at: updated_at}) do
    now = DateTime.utc_now()
    if DateTime.compare(now, updated_at) == :gt, do: now, else: DateTime.add(updated_at, 1, :microsecond)
  end
end
