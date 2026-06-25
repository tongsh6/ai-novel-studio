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

  @scene_unit_keys ~w(unit_id scene_mode target_change causal_spine character_agendas
                      information_delta emotion_transition dialogue_intent sensory_anchor
                      degraded degraded_reason)a

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
    scenes = brief.scene_units |> Enum.map(&scene_unit_lines/1) |> Enum.join("\n")

    [header, chapter_line, scenes]
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
        {%{"type" => "deliberate_pause", "description" => "未给出场级目标变化，按缓冲场处理"},
         true, "missing_target_change"}
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

  defp scene_unit_lines(unit) do
    tc = unit["target_change"] || %{}

    lines =
      [
        "- #{unit["unit_id"]}（#{unit["scene_mode"] || "未标注"}）",
        sub("目标变化", "#{tc["type"]}：#{tc["description"]}"),
        causal_line(unit["causal_spine"]),
        agendas_line(unit["character_agendas"]),
        info_line(unit["information_delta"]),
        emotion_line(unit["emotion_transition"]),
        dialogue_line(unit["dialogue_intent"])
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
      list
      |> Enum.map(fn a ->
        a = to_string_keyed_map(a)
        "#{a["character_ref"]}（要：#{a["wants"]}；藏：#{a["hides"]}）"
      end)
      |> Enum.join("，")

    sub("人物议程", text)
  end

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

  defp dialogue_line(%{"mode" => "subtext"} = d) do
    sub("对话意图", "潜台词：表面谈#{d["surface_topic"]}，暗里争#{d["hidden_conflict"]}")
  end

  defp dialogue_line(_), do: nil

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
