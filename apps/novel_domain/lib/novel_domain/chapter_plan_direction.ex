defmodule NovelDomain.ChapterPlanDirection do
  @moduledoc """
  章计划的写前方向对象，对齐 `08-novel-element-model.md` E18-E22。

  它是 `chapters.summary` 的伴生结构：summary 仍是作者可读的计划摘要，
  direction 承载可验证、可投影到写章上下文的结构化方向。
  """

  @fields [
    :chapter_role,
    :plot_progress,
    :character_change,
    :information_release,
    :foreshadowing_action,
    :emotion,
    :opening_hook,
    :ending_hook,
    :word_count_and_scenes
  ]

  @typedoc "场级计划最小三槽（NEM04 刀③）：title 必填，goal/agendas/emotion 可缺省。"
  @type scene_plan :: %{required(String.t()) => String.t()}

  @type t :: %__MODULE__{
          chapter_role: String.t() | nil,
          plot_progress: String.t() | nil,
          character_change: String.t() | nil,
          information_release: String.t() | nil,
          foreshadowing_action: String.t() | nil,
          emotion: String.t() | nil,
          opening_hook: String.t() | nil,
          ending_hook: String.t() | nil,
          word_count_and_scenes: String.t() | nil,
          scene_plans: [scene_plan()],
          chapter_mission: map() | nil
        }

  # scene_plans（NEM04 刀③）：逐场最小三槽，有序即场次 seq。设计态数据，与九字段
  # 同居 plan_direction（慎重新增实体：既有 map 字段承载，零新列）；`word_count_and_scenes`
  # 保留人读摘要口径不动。无场次标注时列表为空、存储键不存在——一切现状不变。
  # chapter_mission（WR01b）：写前推理的本章使命落章计划（string-keyed map，形状见
  # `NovelDomain.ChapterMission`）。与 scene_plans 同款：既有 map 字段承载，零新列；
  # 缺席时键不存在。它是裁决态设计对象，不参与 E18-E22 的 prompt_lines/summary。
  defstruct @fields ++ [scene_plans: [], chapter_mission: nil]

  @spec fields() :: [atom()]
  def fields, do: @fields

  @spec new(map() | keyword() | nil) :: t() | nil
  def new(nil), do: nil

  def new(attrs) when is_list(attrs), do: attrs |> Map.new() |> new()

  def new(attrs) when is_map(attrs) do
    values =
      @fields
      |> Enum.map(fn field ->
        {field, attrs |> get_any([field, Atom.to_string(field)]) |> clean()}
      end)
      |> Enum.into(%{})

    scene_plans =
      attrs |> get_any([:scene_plans, "scene_plans"]) |> normalize_scene_plans()

    chapter_mission =
      attrs |> get_any([:chapter_mission, "chapter_mission"]) |> normalize_chapter_mission()

    if scene_plans == [] and is_nil(chapter_mission) and
         Enum.all?(values, fn {_field, value} -> blank?(value) end) do
      nil
    else
      struct(
        __MODULE__,
        values |> Map.put(:scene_plans, scene_plans) |> Map.put(:chapter_mission, chapter_mission)
      )
    end
  end

  def new(_attrs), do: nil

  @spec from_storage(map() | t() | nil) :: t() | nil
  def from_storage(%__MODULE__{} = direction), do: new(Map.from_struct(direction))
  def from_storage(value), do: new(value)

  @spec to_storage(t() | map() | nil) :: map() | nil
  def to_storage(nil), do: nil

  def to_storage(%__MODULE__{} = direction) do
    direction
    |> Map.from_struct()
    |> Map.drop([:scene_plans, :chapter_mission])
    |> Enum.reduce(%{}, fn {field, value}, acc ->
      if blank?(value), do: acc, else: Map.put(acc, Atom.to_string(field), value)
    end)
    |> put_scene_plans(direction.scene_plans)
    |> put_chapter_mission(direction.chapter_mission)
    |> empty_to_nil()
  end

  def to_storage(value) when is_map(value), do: value |> from_storage() |> to_storage()
  def to_storage(_value), do: nil

  @spec empty?(t() | map() | nil) :: boolean()
  def empty?(value), do: is_nil(from_storage(value))

  @doc """
  设计态（E18-E22 + 场次）是否为空——忽略 `chapter_mission`。章结构物化「只补缺失方向」
  的判定用它：只落了使命的章，大纲采纳时仍应补进九字段（WR01b）。
  """
  @spec design_empty?(t() | map() | nil) :: boolean()
  def design_empty?(value) do
    case from_storage(value) do
      nil -> true
      direction -> empty?(%{direction | chapter_mission: nil})
    end
  end

  @doc "把 `existing` 里的使命带进新方向（大纲重物化不得丢作者裁决过的使命）。"
  @spec carry_mission(map() | nil, t() | map() | nil) :: map() | nil
  def carry_mission(storage, existing) do
    case from_storage(existing) do
      %__MODULE__{chapter_mission: %{} = mission} ->
        (storage || %{}) |> Map.put("chapter_mission", mission)

      _ ->
        storage
    end
  end

  @spec summary(t() | map() | nil) :: String.t()
  def summary(value) do
    case from_storage(value) do
      nil ->
        ""

      direction ->
        [
          direction.plot_progress,
          direction.character_change,
          direction.information_release,
          direction.foreshadowing_action
        ]
        |> Enum.reject(&blank?/1)
        |> Enum.join("；")
    end
  end

  @spec prompt_lines(t() | map() | nil) :: [String.t()]
  def prompt_lines(value) do
    case from_storage(value) do
      nil ->
        []

      direction ->
        [
          line("章功能定位", direction.chapter_role),
          four_tuple_line(direction),
          line("情绪定位", direction.emotion),
          line("章首拉力", direction.opening_hook),
          line("章尾断章", direction.ending_hook),
          line("字数与场次", direction.word_count_and_scenes)
        ]
        |> Enum.reject(&blank?/1)
    end
  end

  defp four_tuple_line(direction) do
    parts =
      [
        pair("情节推进", direction.plot_progress),
        pair("人物变化", direction.character_change),
        pair("信息释放", direction.information_release),
        pair("伏笔动作", direction.foreshadowing_action)
      ]
      |> Enum.reject(&blank?/1)

    if parts == [], do: "", else: "- 目标四件套：" <> Enum.join(parts, "；")
  end

  defp line(_label, value) when value in [nil, ""], do: ""
  defp line(label, value), do: "- #{label}：#{value}"

  defp pair(_label, value) when value in [nil, ""], do: ""
  defp pair(label, value), do: "#{label}=#{value}"

  defp put_scene_plans(map, []), do: map
  defp put_scene_plans(map, plans), do: Map.put(map, "scene_plans", plans)

  defp put_chapter_mission(map, nil), do: map
  defp put_chapter_mission(map, mission), do: Map.put(map, "chapter_mission", mission)

  defp normalize_chapter_mission(%{} = mission) when map_size(mission) > 0 do
    mission
    |> Enum.map(fn {key, value} -> {to_string(key), value} end)
    |> Map.new()
  end

  defp normalize_chapter_mission(_), do: nil

  defp normalize_scene_plans(list) when is_list(list) do
    list |> Enum.map(&normalize_scene_plan/1) |> Enum.reject(&is_nil/1)
  end

  defp normalize_scene_plans(_), do: []

  defp normalize_scene_plan(plan) when is_map(plan) do
    title = plan |> get_any([:title, "title"]) |> clean()

    if is_nil(title) do
      nil
    else
      %{"title" => title}
      |> put_scene_slot(:goal, "goal", plan)
      |> put_scene_slot(:agendas, "agendas", plan)
      |> put_scene_slot(:emotion, "emotion", plan)
    end
  end

  defp normalize_scene_plan(_plan), do: nil

  defp put_scene_slot(map, atom_key, string_key, plan) do
    case plan |> get_any([atom_key, string_key]) |> clean() do
      nil -> map
      value -> Map.put(map, string_key, value)
    end
  end

  defp get_any(map, keys) do
    Enum.find_value(keys, fn key ->
      if Map.has_key?(map, key), do: Map.get(map, key)
    end)
  end

  defp clean(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp clean(_value), do: nil

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""

  defp empty_to_nil(map) when map == %{}, do: nil
  defp empty_to_nil(map), do: map
end
