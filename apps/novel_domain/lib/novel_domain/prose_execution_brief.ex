defmodule NovelDomain.ProseExecutionBrief do
  @moduledoc """
  正文场级执行简述（VS-00E ProseExecutionBriefV1）。

  把章级方向（`ChapterPlanDirection` → `ReaderEffectBrief`）展开为逐场可执行的
  因果 + 情绪 + 信息 + 对话意图结构，告诉正文 writer 每一场要发生什么改变、由谁的
  目标和阻力驱动、读者与主角各自得知什么、情绪如何迁移。

  **设计态值对象，不是作品事实**：进入 trace 与 provider message（`to_prompt_section/1`），
  但绝不写入作品事实库。契约见 `docs/design/contracts/VS-00E-prose-execution-quality-contract-pack.md`，
  边界见 ADR-0020。纯 struct + 纯函数，无 I/O。
  """

  @brief_version "prose_execution_v1"

  @type t :: %__MODULE__{
          brief_id: String.t(),
          brief_version: String.t(),
          anchor: map(),
          chapter_context: map(),
          scene_units: [map()],
          source_refs: [String.t()],
          created_at: String.t() | nil
        }

  defstruct brief_id: nil,
            brief_version: @brief_version,
            anchor: %{},
            chapter_context: %{},
            scene_units: [],
            source_refs: [],
            created_at: nil

  # scene_title（可选，NEM04 刀③）：规划态场次名（「对账」「夜巡」），随计划落库的
  # scene_plans 进入逐场单元；unit_id 仍是稳定引用，标题只服务 writer 可读性。
  @scene_unit_keys ~w(unit_id scene_title scene_mode target_change causal_spine
                      character_agendas information_delta emotion_transition dialogue_intent
                      sensory_anchor degraded degraded_reason)a

  # trace 摘要（B11C CP1 §3.6）：只报实际出现的场级结构字段名，规范顺序、不含正文与
  # 内部 id。供真实页面验收与线上排障读取（非验收钩子）。
  @coverage_fields ~w(target_change causal_spine character_agendas information_delta
                      emotion_transition dialogue_intent sensory_anchor)

  @doc """
  从 map 构造并清洗。string / atom 键皆可。

  - `brief_version` 缺省为 `#{@brief_version}`。
  - 每个 scene unit 经 `normalize_scene_unit/2` 清洗与降级：缺核心字段 `target_change`
    时不丢弃，而是标记 `degraded: true` + `degraded_reason`，并补一个 `deliberate_pause`
    占位 target_change（缓冲场语义），让链路继续而不伪造场级因果。
  - `brief_id` / `created_at` 由调用方（application builder）提供；缺省保持 nil。
  """
  @spec new(map() | nil) :: t() | nil
  def new(nil), do: nil

  def new(attrs) when is_map(attrs) do
    scene_units =
      attrs
      |> get_any([:scene_units, "scene_units"])
      |> List.wrap()
      |> Enum.with_index(1)
      |> Enum.map(fn {unit, index} -> normalize_scene_unit(unit, index) end)

    %__MODULE__{
      brief_id: clean(get_any(attrs, [:brief_id, "brief_id"])),
      brief_version: clean(get_any(attrs, [:brief_version, "brief_version"])) || @brief_version,
      anchor: to_string_keyed_map(get_any(attrs, [:anchor, "anchor"])),
      chapter_context: to_string_keyed_map(get_any(attrs, [:chapter_context, "chapter_context"])),
      scene_units: scene_units,
      source_refs: clean_list(get_any(attrs, [:source_refs, "source_refs"])),
      created_at: clean(get_any(attrs, [:created_at, "created_at"]))
    }
  end

  @doc "序列化为 plain map（trace / 持久化用）。"
  @spec to_map(t() | nil) :: map() | nil
  def to_map(nil), do: nil

  def to_map(%__MODULE__{} = brief) do
    %{
      "brief_id" => brief.brief_id,
      "brief_version" => brief.brief_version,
      "anchor" => brief.anchor,
      "chapter_context" => brief.chapter_context,
      "scene_units" => brief.scene_units,
      "source_refs" => brief.source_refs,
      "created_at" => brief.created_at
    }
  end

  @doc "稳定引用：`brief:<brief_id>`，无 id 时回 nil。供 trace summary 使用。"
  @spec ref(t() | nil) :: String.t() | nil
  def ref(%__MODULE__{brief_id: id}) when is_binary(id) and id != "", do: "brief:#{id}"
  def ref(_), do: nil

  @doc """
  trace 摘要用：逐场单元里**实际出现的场级结构字段名**（`target_change` / `causal_spine` /
  `character_agendas` / `information_delta` / `emotion_transition` / `dialogue_intent` /
  `sensory_anchor`），规范顺序去重。缺省字段不出现（不伪造覆盖），不暴露正文与内部 id。
  """
  @spec field_coverage(t() | nil) :: [String.t()]
  def field_coverage(nil), do: []

  def field_coverage(%__MODULE__{scene_units: scene_units}) do
    Enum.filter(@coverage_fields, fn field ->
      Enum.any?(scene_units, &present_field?(&1, field))
    end)
  end

  defp present_field?(%{} = unit, field) do
    case Map.fetch(unit, field) do
      {:ok, nil} -> false
      {:ok, ""} -> false
      {:ok, []} -> false
      {:ok, %{} = value} -> map_size(value) > 0
      {:ok, _value} -> true
      :error -> false
    end
  end

  defp present_field?(_unit, _field), do: false

  @doc """
  渲染为 provider message 可见的结构化文本段（中文，可追踪）。

  这是进入正文 writer prompt 的形态——逐场列出 target_change / 因果脊 / 人物议程 /
  信息变化 / 情绪迁移 / 对话意图。不输出 brief_id 等内部 id。缺场景返回 ""。
  """
  @spec to_prompt_section(t() | nil) :: String.t()
  def to_prompt_section(nil), do: ""

  def to_prompt_section(%__MODULE__{scene_units: []}), do: ""

  def to_prompt_section(%__MODULE__{} = brief) do
    header = "## 场级执行简述（写前执行结构，按场推进）"
    chapter_line = chapter_context_line(brief.chapter_context)
    mission_block = mission_block(brief.chapter_context)
    scenes = Enum.map_join(brief.scene_units, "\n", &scene_unit_lines/1)

    [header, chapter_line, mission_block, scenes]
    |> Enum.reject(&blank?/1)
    |> Enum.join("\n")
  end

  # ── scene unit 清洗与降级 ──────────────────────────

  defp normalize_scene_unit(unit, index) when is_map(unit) do
    base =
      unit
      |> to_string_keyed_map()
      |> Map.take(Enum.map(@scene_unit_keys, &Atom.to_string/1))

    unit_id = clean(base["unit_id"]) || "scene_#{index}"
    target_change = to_string_keyed_map(base["target_change"])

    {target_change, degraded?, reason} = ensure_target_change(target_change)

    base
    |> Map.put("unit_id", unit_id)
    |> Map.put("target_change", target_change)
    |> maybe_mark_degraded(degraded?, reason)
  end

  defp normalize_scene_unit(_unit, index) do
    {target_change, _, reason} = ensure_target_change(%{})

    %{
      "unit_id" => "scene_#{index}",
      "target_change" => target_change,
      "degraded" => true,
      "degraded_reason" => reason
    }
  end

  # target_change 是核心字段：缺失时不伪造场级因果，降级为 deliberate_pause 缓冲场并标记。
  defp ensure_target_change(%{} = tc) do
    type = clean(tc["type"])
    description = clean(tc["description"])

    cond do
      is_binary(type) and is_binary(description) ->
        {%{"type" => type, "description" => description}, false, nil}

      is_binary(description) ->
        {%{"type" => "unspecified", "description" => description}, false, nil}

      true ->
        {%{"type" => "deliberate_pause", "description" => "未给出场级目标变化，按缓冲场处理"}, true,
         "missing_target_change"}
    end
  end

  defp maybe_mark_degraded(unit, false, _reason), do: unit

  defp maybe_mark_degraded(unit, true, reason) do
    unit |> Map.put("degraded", true) |> Map.put("degraded_reason", reason)
  end

  # ── prompt 渲染 ────────────────────────────────────

  defp chapter_context_line(ctx) when is_map(ctx) and map_size(ctx) > 0 do
    parts =
      [
        kv("章节定位", ctx["chapter_role"]),
        kv("节奏", ctx["pacing_mode"])
      ]
      |> Enum.reject(&is_nil/1)

    if parts == [], do: nil, else: "本章：" <> Enum.join(parts, "，")
  end

  defp chapter_context_line(_ctx), do: nil

  # WR01：写前推理产出的本章使命随简报进入 writer prompt（设计态，决策点邻近；
  # VS-00E §16）。降级/缺席时整块不出现，不伪造使命。
  defp mission_block(ctx) when is_map(ctx) do
    case NovelDomain.ChapterMission.to_prompt_lines(ctx["mission"]) do
      [] -> nil
      lines -> Enum.join(lines, "\n")
    end
  end

  defp mission_block(_ctx), do: nil

  defp scene_unit_lines(unit) do
    tc = unit["target_change"] || %{}
    title = clean(unit["scene_title"])

    lines =
      [
        "- #{unit["unit_id"]}（#{unit["scene_mode"] || "未标注"}）#{if title, do: "场：#{title}", else: ""}",
        sub("目标变化", "#{tc["type"]}：#{tc["description"]}"),
        causal_line(unit["causal_spine"]),
        agendas_line(unit["character_agendas"]),
        info_line(unit["information_delta"]),
        emotion_line(unit["emotion_transition"]),
        dialogue_line(unit["dialogue_intent"]),
        sensory_line(unit["sensory_anchor"])
      ]
      |> Enum.reject(&is_nil/1)

    Enum.join(lines, "\n")
  end

  defp causal_line(%{} = c) when map_size(c) > 0 do
    sub(
      "因果",
      [
        c["goal"] && "目标：#{c["goal"]}",
        c["opposition_or_dilemma"] && "阻力：#{c["opposition_or_dilemma"]}",
        c["turn"] && "转折：#{c["turn"]}",
        c["consequence"] && "后果：#{c["consequence"]}"
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.join("；")
    )
  end

  defp causal_line(_), do: nil

  defp agendas_line(list) when is_list(list) and list != [] do
    text =
      Enum.map_join(list, "，", fn a ->
        a = to_string_keyed_map(a)
        "#{a["character_ref"]}（要：#{a["wants"]}；藏：#{a["hides"]}）"
      end)

    sub("人物议程", text)
  end

  # 规划落库的议程是自由文本（「沈洛要证据、摊主要脱身」）——原样进 prompt，
  # 不过度解析成结构（NEM04 刀③）。
  defp agendas_line(text) when is_binary(text), do: sub("人物议程", text)

  defp agendas_line(_), do: nil

  defp info_line(%{} = i) when map_size(i) > 0 do
    sub(
      "信息变化",
      [
        i["reader_learns"] && "读者得知：#{i["reader_learns"]}",
        i["protagonist_learns"] && "主角得知：#{i["protagonist_learns"]}",
        i["remains_hidden"] && "仍隐藏：#{i["remains_hidden"]}"
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.join("；")
    )
  end

  defp info_line(_), do: nil

  defp emotion_line(%{} = e) when map_size(e) > 0 do
    pressures = e["pressures"] |> List.wrap() |> Enum.reject(&blank?/1) |> Enum.join("、")

    sub(
      "情绪迁移",
      [
        e["start"] && "起：#{e["start"]}",
        pressures != "" && "压力：#{pressures}",
        e["turn"] && "转：#{e["turn"]}",
        e["end"] && "终：#{e["end"]}",
        e["residue"] && "余波：#{e["residue"]}"
      ]
      |> Enum.reject(&(&1 in [nil, false]))
      |> Enum.join("；")
    )
  end

  defp emotion_line(_), do: nil

  # B11C CP1：subtext 只渲染存在的字段（缺字段不拼空洞句式）；direct 模式只渲染
  # 表面话题（潜台词仅按场景类型条件启用，VS-00E §1）。
  defp dialogue_line(%{"mode" => "subtext"} = d) do
    case dialogue_parts(d) do
      [] -> nil
      parts -> sub("对话意图", "潜台词：" <> Enum.join(parts, "，"))
    end
  end

  defp dialogue_line(%{"mode" => "direct"} = d) do
    case clean(d["surface_topic"]) do
      nil -> nil
      surface -> sub("对话意图", "表面谈#{surface}")
    end
  end

  defp dialogue_line(_), do: nil

  defp dialogue_parts(d) do
    surface = clean(d["surface_topic"])
    hidden = clean(d["hidden_conflict"])

    [surface && "表面谈#{surface}", hidden && "暗里争#{hidden}"]
    |> Enum.reject(&is_nil/1)
  end

  # 感官锚点（B11C CP1）：契约形状是数组；数组缺失/为空时整行不出现，不伪造。
  defp sensory_line(anchors) when is_list(anchors) do
    text = anchors |> Enum.map(&clean/1) |> Enum.reject(&is_nil/1) |> Enum.join("、")
    sub("感官锚点", text)
  end

  defp sensory_line(text) when is_binary(text), do: sub("感官锚点", clean(text))
  defp sensory_line(_), do: nil

  defp sub(label, value) when is_binary(value) and value != "", do: "  · #{label}：#{value}"
  defp sub(_label, _value), do: nil

  defp kv(_label, nil), do: nil
  defp kv(label, value) when is_binary(value), do: "#{label}=#{value}"
  defp kv(_label, _value), do: nil

  # ── helpers ────────────────────────────────────────

  defp get_any(map, keys), do: Enum.find_value(keys, fn k -> Map.get(map, k) end)

  defp to_string_keyed_map(map) when is_map(map) do
    Map.new(map, fn {k, v} -> {to_string(k), v} end)
  end

  defp to_string_keyed_map(_), do: %{}

  defp clean(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp clean(_), do: nil

  defp clean_list(list) when is_list(list) do
    list |> Enum.map(&clean/1) |> Enum.reject(&is_nil/1)
  end

  defp clean_list(_), do: []

  defp blank?(nil), do: true
  defp blank?(""), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_), do: false
end
