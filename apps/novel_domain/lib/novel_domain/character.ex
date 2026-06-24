defmodule NovelDomain.Character do
  @moduledoc """
  人物——小说的跨层复用资产对象。

  Character 是资产对象组的第一批落地对象。代表小说中的角色/人物。
  字段定义冻结于 21-novel-object-model.md §6.1。
  """

  alias NovelDomain.Types
  alias NovelFoundation.Enums.NarrativeRole

  defstruct [
    :id,
    :work_ref,
    :name,
    :aliases,
    :role,
    :narrative_role,
    :summary,
    :status,
    :created_at,
    :updated_at
  ]

  @type t :: %__MODULE__{
          id: Types.id(),
          work_ref: Types.id(),
          name: String.t(),
          aliases: [String.t()],
          role: String.t() | nil,
          narrative_role: NarrativeRole.t() | nil,
          summary: String.t() | nil,
          status: Types.work_status(),
          created_at: DateTime.t(),
          updated_at: DateTime.t()
        }

  @doc "创建一个新的 Character，默认为 :draft 状态。"
  @spec new(String.t(), String.t(), String.t()) :: t()
  def new(id, work_ref, name)
      when is_binary(id) and is_binary(work_ref) and is_binary(name) do
    now = DateTime.utc_now()

    %__MODULE__{
      id: id,
      work_ref: work_ref,
      name: name,
      aliases: [],
      status: :draft,
      created_at: now,
      updated_at: now
    }
  end

  @doc "更新人物名称。"
  @spec update_name(t(), String.t()) :: t()
  def update_name(%__MODULE__{} = character, name) when is_binary(name) do
    %__MODULE__{character | name: name, updated_at: next_updated_at(character)}
  end

  @doc "设置别名列表。"
  @spec update_aliases(t(), [String.t()]) :: t()
  def update_aliases(%__MODULE__{} = character, aliases) when is_list(aliases) do
    %__MODULE__{character | aliases: aliases, updated_at: next_updated_at(character)}
  end

  @doc "更新角色定位（自由文本，承载具体身份/职能描述）。"
  @spec update_role(t(), String.t() | nil) :: t()
  def update_role(%__MODULE__{} = character, role) do
    %__MODULE__{character | role: role, updated_at: next_updated_at(character)}
  end

  @doc """
  更新叙事角色分类（主角/反派/配角/次要/群像 POV）。

  叙事角色是 Character 的结构化分类（叙事功能层），不是自由文本 role。
  传入 nil 表示尚未标注叙事角色；非法值会 raise，保证主角是可校验事实。
  """
  @spec update_narrative_role(t(), NarrativeRole.t() | nil) :: t()
  def update_narrative_role(%__MODULE__{} = character, nil) do
    %__MODULE__{character | narrative_role: nil, updated_at: next_updated_at(character)}
  end

  def update_narrative_role(%__MODULE__{} = character, narrative_role) do
    unless NarrativeRole.valid?(narrative_role) do
      raise ArgumentError, "invalid narrative_role: #{inspect(narrative_role)}"
    end

    %__MODULE__{
      character
      | narrative_role: narrative_role,
        updated_at: next_updated_at(character)
    }
  end

  @doc "该角色是否被标记为主角（叙事角色 = PROTAGONIST）。无标记不默认为主角。"
  @spec protagonist?(t() | NarrativeRole.t() | nil) :: boolean()
  def protagonist?(%__MODULE__{narrative_role: narrative_role}), do: protagonist?(narrative_role)
  def protagonist?(narrative_role), do: narrative_role == NarrativeRole.protagonist()

  @doc "更新人物摘要。"
  @spec update_summary(t(), String.t() | nil) :: t()
  def update_summary(%__MODULE__{} = character, summary) do
    %__MODULE__{character | summary: summary, updated_at: next_updated_at(character)}
  end

  @doc "变更人物状态。"
  @spec update_status(t(), Types.work_status()) :: t()
  def update_status(%__MODULE__{} = character, status) do
    %__MODULE__{character | status: status, updated_at: next_updated_at(character)}
  end

  defp next_updated_at(%__MODULE__{updated_at: updated_at}) do
    now = DateTime.utc_now()

    if DateTime.compare(now, updated_at) == :gt,
      do: now,
      else: DateTime.add(updated_at, 1, :microsecond)
  end
end
