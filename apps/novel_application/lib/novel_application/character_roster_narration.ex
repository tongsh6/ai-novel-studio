defmodule NovelApplication.CharacterRosterNarration do
  @moduledoc """
  主角感知的角色花名册叙述（AU-09 角色类型/主角语义）。

  只读 `character_roster` 工具的助手回复不再机械返回"已有 N 个已确认角色"，而是先
  回答主角是谁 / 有没有主角，再列出阵容：

  - 无任何已确认角色 → 诚实说还没有角色也没有主角，给出"设计主角"入口。
  - 有角色但无人标记主角 → 诚实报缺口，不把第一个角色默认当主角。
  - 有 1 位主角 → 直接回答主角姓名。
  - 有多位主角（群像）→ 列出全部主角。

  纯函数，只读，不写作品事实。叙事角色判定复用 `NovelDomain.Character.protagonist?/1`，
  保证"主角"是结构化可校验事实而非自由文本猜测。
  """

  alias NovelDomain.Character

  @spec message([map()]) :: String.t()
  def message([]) do
    "当前作品还没有已确认角色，也还没有确定主角。可以先从设计主角开始，采纳后才会写入作品事实。"
  end

  def message(characters) when is_list(characters) do
    count = length(characters)
    names = Enum.map_join(characters, "、", &roster_label/1)
    protagonists = Enum.filter(characters, &protagonist?/1)

    "#{protagonist_line(protagonists)}共有 #{count} 个已确认角色：#{names}。这次只是读取角色档案，没有写入作品事实。"
  end

  defp protagonist_line([]) do
    "目前还没有谁被标记为主角。如果要确定主角，可以继续设计主角，或把某个已有角色指定为主角。"
  end

  defp protagonist_line([one]) do
    "当前作品的主角是 #{display_name(one)}。"
  end

  defp protagonist_line(many) do
    "当前作品有 #{length(many)} 位主角（群像）：" <>
      Enum.map_join(many, "、", &display_name/1) <> "。"
  end

  @doc "该花名册条目是否被标记为主角（叙事角色 = PROTAGONIST）。无标记不默认为主角。"
  @spec protagonist?(map()) :: boolean()
  def protagonist?(character) when is_map(character),
    do: Character.protagonist?(narrative_role_value(character))

  def protagonist?(_character), do: false

  defp narrative_role_value(character),
    do: Map.get(character, :narrative_role) || Map.get(character, "narrative_role")

  defp display_name(character),
    do: Map.get(character, :name) || Map.get(character, "name") || "未命名角色"

  # 花名册条目标签：优先显示结构化叙事角色（主角/反派/...），无标记时回退自由文本 role。
  defp roster_label(character) do
    name = display_name(character)
    label = role_label(narrative_role_value(character)) || free_text_role(character)

    if label, do: "#{name}（#{label}）", else: name
  end

  defp free_text_role(character) do
    case Map.get(character, :role) || Map.get(character, "role") do
      role when is_binary(role) and role != "" -> role
      _ -> nil
    end
  end

  @doc "叙事角色枚举值 → 中文展示标签。"
  @spec role_label(String.t() | nil) :: String.t() | nil
  def role_label("PROTAGONIST"), do: "主角"
  def role_label("ANTAGONIST"), do: "反派"
  def role_label("SUPPORTING"), do: "配角"
  def role_label("MINOR"), do: "次要角色"
  def role_label("ENSEMBLE_POV"), do: "群像视角"
  def role_label(_), do: nil
end
