defmodule NovelDomain.VolumeBlueprint do
  @moduledoc """
  卷级蓝图（VS-00J §2.1 / ADR-0028）：`volumes.blueprint` 的 domain 归一/渲染口径。

  卷级蓝图是**设计态** map（既有 map 列承载，零新业务列），键集合冻结为
  `08-novel-element-model.md` E14-E17 的最小结构化槽：

  | 键 | 要素 | 语义 |
  |---|---|---|
  | `goal_conflict` | E14 | 本卷要解决的核心冲突/任务 |
  | `arc_stage` | E14 | 本卷人物走到弧光哪一步 |
  | `map_boundary` | E14 | 本卷地图/副本/舞台边界 |
  | `subplots_start` | E15 | 本卷启动的支线 |
  | `subplots_advance` | E15 | 本卷推进的支线 |
  | `subplots_close` | E15 | 本卷收束的支线 |
  | `climaxes` | E16 | 小高潮/爽点位置（章标题引用，不写章号） |
  | `payoff_density` | E16 | 爽点密度/节奏说明 |
  | `buffers` | E16 | 缓冲章/过渡位置（章标题引用） |
  | `new_characters` | E17 | 本卷引入的新人物 |
  | `new_settings` | E17 | 本卷引入的新设定 |
  | `new_maps` | E17 | 本卷引入的新地图/副本 |

  另有采纳元数据键 `status`（`NovelFoundation.Enums.VolumeBlueprintStatus` 三态）与
  `source_ref`（`artifact:<artifact_id>`）；二者不属于设计内容。

  纪律：

  - 纯函数、无 I/O（domain 边界）；键白名单归一，不做自由 map 透传；
  - 空值丢弃、未知键丢弃、`title` 不在此层（卷标题是 `volumes.title`）；
  - `nil` / 空 map = 未立蓝图（诚实缺席，不写 `N/A`）；
  - 无设计槽时不伪造 `status/source_ref`（`empty?/1` 只看设计内容）。
  """

  alias NovelFoundation.Enums.VolumeBlueprintStatus

  # {atom key, string key, 中文标签}：顺序即 render_lines/1 的确定性渲染顺序。
  @design_slots [
    {:goal_conflict, "goal_conflict", "目标冲突"},
    {:arc_stage, "arc_stage", "弧光阶段"},
    {:map_boundary, "map_boundary", "地图边界"},
    {:subplots_start, "subplots_start", "支线启动"},
    {:subplots_advance, "subplots_advance", "支线推进"},
    {:subplots_close, "subplots_close", "支线收束"},
    {:climaxes, "climaxes", "高潮章"},
    {:payoff_density, "payoff_density", "爽点密度"},
    {:buffers, "buffers", "缓冲章"},
    {:new_characters, "new_characters", "新人物"},
    {:new_settings, "new_settings", "新设定"},
    {:new_maps, "new_maps", "新地图"}
  ]

  @meta_slots [{:status, "status"}, {:source_ref, "source_ref"}]

  # {atom key, string key} 对：设计槽 + 采纳元数据，供 new/1 的白名单遍历。
  @slot_pairs Enum.map(@design_slots ++ @meta_slots, fn
                {atom_key, string_key, _label} -> {atom_key, string_key}
                {atom_key, string_key} -> {atom_key, string_key}
              end)

  @label_to_key Map.new(@design_slots, fn {_atom, key, label} -> {label, key} end)

  @typedoc "归一后的卷级蓝图（string keys；空值/未知键已被丢弃）。"
  @type t :: %{optional(String.t()) => String.t()}

  @doc "蓝图白名单键（设计槽 + 采纳元数据），声明顺序。"
  @spec keys() :: [String.t()]
  def keys, do: Enum.map(@slot_pairs, fn {_atom, key} -> key end)

  @doc "设计槽键（E14-E17），不含 `status`/`source_ref`，声明顺序即渲染顺序。"
  @spec design_keys() :: [String.t()]
  def design_keys, do: Enum.map(@design_slots, fn {_atom, key, _label} -> key end)

  @doc """
  中文标签 → 规范化键（`ChapterPlanParser` 的卷蓝图行解析口径与本模块渲染同源）。

  未知标签返回 nil；解析器据此整槽丢弃（不发明键）。
  """
  @spec slot_key(String.t()) :: String.t() | nil
  def slot_key(label) when is_binary(label), do: Map.get(@label_to_key, normalize_label(label))
  def slot_key(_label), do: nil

  @doc """
  归一：原子/字符串键兼容、空值丢弃、未知键丢弃、`status` 经 enum 校验。

  无任何有效键 → nil（= 未立蓝图）。
  """
  @spec new(map() | keyword() | nil) :: t() | nil
  def new(nil), do: nil
  def new(attrs) when is_list(attrs), do: attrs |> Map.new() |> new()

  def new(attrs) when is_map(attrs) do
    @slot_pairs
    |> Enum.reduce(%{}, fn {atom_key, string_key}, acc ->
      attrs
      |> get_any([atom_key, string_key])
      |> clean()
      |> put_slot(acc, string_key)
    end)
    |> nil_if_empty()
  end

  def new(_attrs), do: nil

  @doc "从存储读取（`volumes.blueprint`）→ 归一蓝图；`nil`/空 map → nil。"
  @spec from_storage(map() | nil) :: t() | nil
  def from_storage(value), do: new(value)

  @doc "写存储前归一；无有效键 → nil（不写空 map 占位）。"
  @spec to_storage(map() | nil) :: t() | nil
  def to_storage(value), do: new(value)

  @doc """
  蓝图裁决状态；无 status 或非法值 → nil（作废=删键，无 DISCARDED 态）。
  """
  @spec status(t() | map() | nil) :: String.t() | nil
  def status(value) do
    case new(value) do
      %{"status" => status} -> status
      _ -> nil
    end
  end

  @doc """
  设置蓝图裁决状态；非法状态值不写入（返回归一后的原蓝图），`nil` 表示去掉状态。
  """
  @spec put_status(t() | map() | nil, String.t() | nil) :: t() | nil
  def put_status(value, nil) do
    case new(value) do
      nil -> nil
      blueprint -> blueprint |> Map.delete("status") |> nil_if_empty()
    end
  end

  def put_status(value, status) when is_binary(status) do
    case {new(value), VolumeBlueprintStatus.valid?(status)} do
      {nil, true} -> %{"status" => status}
      {nil, false} -> nil
      {blueprint, true} -> Map.put(blueprint, "status", status)
      {blueprint, false} -> blueprint
    end
  end

  def put_status(value, _status), do: new(value)

  @doc """
  合并两份蓝图，右侧覆盖左侧（空值不擦除左侧有效值）。

  采纳物化用它把设计槽与 `status`/`source_ref` 元数据合到一份。
  """
  @spec merge(t() | map() | nil, t() | map() | nil) :: t() | nil
  def merge(left, right) do
    (new(left) || %{})
    |> Map.merge(new(right) || %{})
    |> new()
  end

  @doc """
  设计内容是否为空：只看 E14-E17 设计槽，`status`/`source_ref` 是采纳元数据不算蓝图。

  无设计槽的卷蓝图块（只写了卷名/序号）视为未立蓝图——不写 provenance 占位。
  """
  @spec empty?(t() | map() | nil) :: boolean()
  def empty?(value) do
    case new(value) do
      nil -> true
      blueprint -> not Enum.any?(design_keys(), &Map.has_key?(blueprint, &1))
    end
  end

  @doc """
  确定性渲染 `「标签：值」` 行列表（供上下文/UI/测试）。

  只渲染 E14-E17 设计槽，按声明顺序；缺槽不渲染、不补占位。
  """
  @spec render_lines(t() | map() | nil) :: [String.t()]
  def render_lines(value) do
    case new(value) do
      nil -> []
      blueprint -> design_lines(blueprint)
    end
  end

  defp design_lines(blueprint),
    do: Enum.flat_map(@design_slots, &design_slot_line(&1, blueprint))

  @doc """
  卷蓝图 `design_ref` 形状（VS-00J §4 消费面 6）：`volume_blueprint:<volume_id>`；
  无卷 id → nil。

  本模块只冻结形状（供后续 R2/承诺账引用），**不接线**到五本账（B11A CP4 边界：
  只提供 helper，不新增静默写路径）。
  """
  @spec design_ref(String.t() | map() | nil) :: String.t() | nil
  def design_ref(volume_id) when is_binary(volume_id) do
    case String.trim(volume_id) do
      "" -> nil
      id -> "volume_blueprint:#{id}"
    end
  end

  def design_ref(%{} = volume) do
    case volume |> get_any([:id, "id"]) |> clean() do
      nil -> nil
      id -> "volume_blueprint:#{id}"
    end
  end

  def design_ref(_volume), do: nil

  @doc """
  代表性摘要行：把 E14-E17 设计槽归并为 5 组（目标冲突 / 弧光阶段 / 支线 /
  高潮与节奏 / 新要素），供「当前卷蓝图摘要」类上下文使用（bounded，不塞全部长文本）。

  缺组不渲染、不补占位；无设计槽 → `[]`。与 `render_lines/1` 同源（同一白名单/标签）。
  """
  @spec summary_lines(t() | map() | nil) :: [String.t()]
  def summary_lines(value) do
    case new(value) do
      nil ->
        []

      blueprint ->
        [
          summary_line(blueprint, "目标冲突", "goal_conflict"),
          summary_line(blueprint, "弧光阶段", "arc_stage"),
          summary_group_line(blueprint, "支线", [
            {"subplots_start", "启动"},
            {"subplots_advance", "推进"},
            {"subplots_close", "收束"}
          ]),
          summary_group_line(blueprint, "高潮与节奏", [
            {"climaxes", "高潮章"},
            {"payoff_density", "爽点密度"},
            {"buffers", "缓冲章"}
          ]),
          summary_group_line(blueprint, "新要素", [
            {"new_characters", "新人物"},
            {"new_settings", "新设定"},
            {"new_maps", "新地图"}
          ])
        ]
        |> Enum.reject(&is_nil/1)
    end
  end

  defp summary_line(blueprint, label, key) do
    case Map.get(blueprint, key) do
      nil -> nil
      text -> "#{label}：#{text}"
    end
  end

  defp summary_group_line(blueprint, label, pairs) do
    parts =
      Enum.flat_map(pairs, fn {key, item_label} ->
        case Map.get(blueprint, key) do
          nil -> []
          text -> ["#{item_label}：#{text}"]
        end
      end)

    if parts == [], do: nil, else: "#{label}（#{Enum.join(parts, "、")}）"
  end

  defp design_slot_line({_atom, key, label}, blueprint) do
    case Map.get(blueprint, key) do
      nil -> []
      text -> ["#{label}：#{text}"]
    end
  end

  defp put_slot(nil, acc, _key), do: acc

  defp put_slot(text, acc, "status") do
    if VolumeBlueprintStatus.valid?(text), do: Map.put(acc, "status", text), else: acc
  end

  defp put_slot(text, acc, key), do: Map.put(acc, key, text)

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

  defp nil_if_empty(map) when map == %{}, do: nil
  defp nil_if_empty(map), do: map

  defp normalize_label(label), do: label |> String.replace(~r/\s/u, "") |> String.trim()
end
