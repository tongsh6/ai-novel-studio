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

  @typedoc """
  场级计划（NEM04 刀③ + B11C CP1）：title 必填；goal/agendas/emotion 与
  VS-00E §1 场级结构子槽（opposition/turn/consequence/reader_learns/protagonist_learns/
  remains_hidden/surface_topic/hidden_conflict/sensory）可缺省。
  """
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

  @typedoc """
  章功能定位的归一类别（B27 CP3c / D7）：`chapter_role` 是模型产出的自由文本
  （prompt 允许「推进章 / 铺垫章 / 高潮章 / 过渡章 / 转折章之一或自然语言等价描述」），
  ledger/reconcile 等机械规则不能直接按精确中文字面量匹配，必须先经本函数归一。
  """
  @type role_kind :: :advancing | :setup | :climax | :transition | :turning | :other | :unknown

  # 顺序敏感：先匹配更具体的词，避免被其他词误命中。
  @role_kind_markers [
    {:climax, "高潮"},
    {:turning, "转折"},
    {:advancing, "推进"},
    {:setup, "铺垫"},
    {:transition, "过渡"}
  ]

  @doc """
  把章功能定位自由文本归一为类别。

  仅做确定性词面归一（不做语义猜测）：未知文本归 `:other`，缺失归 `:unknown`；
  消费方按类别判断，展示仍使用原文。
  """
  @spec role_kind(t() | map() | nil | String.t()) :: role_kind()
  def role_kind(%__MODULE__{chapter_role: role}), do: role_kind(role)
  def role_kind(value) when is_map(value), do: value |> from_storage() |> role_kind()

  def role_kind(role) when is_binary(role) do
    role = String.trim(role)

    if role == "",
      do: :unknown,
      else: Enum.find_value(@role_kind_markers, :other, &marker_kind(role, &1))
  end

  def role_kind(nil), do: :unknown
  def role_kind(_value), do: :unknown

  defp marker_kind(role, {kind, marker}) do
    if String.contains?(role, marker), do: kind, else: nil
  end

  @doc """
  该章功能定位是否推进主线冲突账（推进/高潮/转折三类）。

  与 `NovelApplication.LedgerMaintenance` 的消费口径一致；归类由本模块单一真源。
  """
  @spec conflict_progress?(t() | map() | nil | String.t()) :: boolean()
  def conflict_progress?(value), do: role_kind(value) in [:advancing, :climax, :turning]

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

  # B11C CP1：逐场计划子槽的渲染词表（探索面 `chapter_read` 与写前推理
  # `ChapterMissionInputs` 共用，避免两处各写一份标签）。
  @scene_slot_labels [
    {"目标", "goal"},
    {"议程", "agendas"},
    {"情绪", "emotion"},
    {"阻力", "opposition"},
    {"转折", "turn"},
    {"后果", "consequence"},
    {"读者得知", "reader_learns"},
    {"主角得知", "protagonist_learns"},
    {"仍隐藏", "remains_hidden"},
    {"对白表面", "surface_topic"},
    {"潜台词", "hidden_conflict"},
    {"感官", "sensory"}
  ]

  @doc """
  逐场计划渲染为有序 `标签：值` 列表（缺槽不出现，不补占位）。

  只做展示口径归一，不改变 `scene_plans` 的存储结构（B11C CP1 探索面同步律）。
  """
  @spec scene_slot_lines(map() | nil) :: [String.t()]
  def scene_slot_lines(plan) when is_map(plan) do
    Enum.flat_map(@scene_slot_labels, fn {label, key} ->
      case clean(plan[key]) do
        nil -> []
        value -> ["#{label}：#{value}"]
      end
    end)
  end

  def scene_slot_lines(_plan), do: []

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

  # B11C CP1：白名单扩到 VS-00E §1 场级结构全集（title + 3 既有 + 8 新增）；
  # 空值丢弃、title 必填。无新子槽的旧计划归一结果与 NEM04 逐字节等价。
  @scene_plan_slots [
    {:goal, "goal"},
    {:agendas, "agendas"},
    {:emotion, "emotion"},
    {:opposition, "opposition"},
    {:turn, "turn"},
    {:consequence, "consequence"},
    {:reader_learns, "reader_learns"},
    {:protagonist_learns, "protagonist_learns"},
    {:remains_hidden, "remains_hidden"},
    {:surface_topic, "surface_topic"},
    {:hidden_conflict, "hidden_conflict"},
    {:sensory, "sensory"}
  ]

  defp normalize_scene_plan(plan) when is_map(plan) do
    title = plan |> get_any([:title, "title"]) |> clean()

    if is_nil(title) do
      nil
    else
      Enum.reduce(@scene_plan_slots, %{"title" => title}, fn {atom_key, string_key}, acc ->
        put_scene_slot(acc, atom_key, string_key, plan)
      end)
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
