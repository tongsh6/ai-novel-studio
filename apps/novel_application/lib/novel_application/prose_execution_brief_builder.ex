defmodule NovelApplication.ProseExecutionBriefBuilder do
  @moduledoc """
  把 CreativeDecisionPacket 投影为场级执行简述 `ProseExecutionBrief`（VS-00E CP1）。

  CP1 为**确定性投影**：以章级方向（`ChapterPlanDirection` E18–E22）+ 读者效果
  （`ReaderEffectBrief`）为来源，展开为场级执行结构。无结构化章方向时**不伪造场级
  因果**，而是从计划摘要 / 作者输入降级生成最小 brief，并在 scene unit 上标记 degraded
  （由 `ProseExecutionBrief.new/1` 归一化），供 trace 标记降级来源。

  brief 是设计态、非作品事实（ADR-0020 I2）。后续 checkpoint 可把单场确定性投影
  升级为多场（含 LLM 展开），本模块是其唯一入口。
  """

  alias NovelDomain.ChapterMission
  alias NovelDomain.ChapterPlanDirection
  alias NovelDomain.ProseExecutionBrief

  @doc """
  返回 `{brief, meta}`：

  - `brief`：`ProseExecutionBrief.t()`
  - `meta`：`%{degraded: boolean, source: [String.t()]}`，degraded 表示无结构化章方向、
    走了降级投影；source 是 brief 的来源标记（供 trace）。
  """
  @spec build(map()) :: {ProseExecutionBrief.t(), %{degraded: boolean(), source: [String.t()]}}
  def build(packet) when is_map(packet) do
    direction = packet["chapter_direction"]
    reader_effect = packet["reader_effect_brief"]
    chapter = packet["chapter"] || %{}
    author_input = packet["author_input"] || ""
    source_turn_ref = packet["source_turn_ref"]

    {scene_units, degraded?, source} =
      scene_units(direction, chapter, author_input)

    {mission_context, mission_source} = mission_context(packet["chapter_mission"])

    source =
      source ++
        if(is_nil(reader_effect), do: [], else: ["reader_effect_brief"]) ++ mission_source

    brief =
      ProseExecutionBrief.new(%{
        brief_id: NovelFoundation.ID.unique("peb"),
        created_at: DateTime.utc_now() |> DateTime.to_iso8601(),
        anchor: %{
          "target_unit" => "chapter",
          "chapter_ref" => chapter_ref(chapter),
          "scene_ref" => nil,
          "source_turn_ref" => source_turn_ref
        },
        chapter_context:
          direction |> chapter_context(reader_effect) |> Map.merge(mission_context),
        scene_units: scene_units,
        source_refs: source
      })

    {brief, %{degraded: degraded?, source: source}}
  end

  # ── scene unit 投影 ────────────────────────────────

  # 规划落库的逐场计划（NEM04 刀③，VS-00E「多场展开」就此闭环）：每个场次
  # 一个单元，目标/议程/情绪直达 writer；场缺情绪时回退章级情绪定位。
  # B11C CP1：把规划里 VS-00E §1 已冻结的场级结构（因果脊/信息差/对白意图/感官锚点）
  # 确定性投影进 scene unit——只从规划字节投影，缺子槽不写键、不生成模型内容。
  defp scene_units(
         %ChapterPlanDirection{scene_plans: [_ | _] = plans} = direction,
         _chapter,
         _author_input
       ) do
    units =
      plans
      |> Enum.with_index(1)
      |> Enum.map(fn {plan, index} ->
        %{
          "unit_id" => "scene_#{index}",
          "scene_title" => plan["title"],
          "scene_mode" => "planned_scene",
          "target_change" =>
            case clean(plan["goal"]) do
              nil -> %{}
              goal -> %{"type" => "planned_scene", "description" => goal}
            end,
          "causal_spine" => causal_spine(plan),
          "character_agendas" => clean(plan["agendas"]),
          "information_delta" => information_delta(plan),
          "emotion_transition" =>
            drop_blank(%{"end" => clean(plan["emotion"]) || clean(direction.emotion)}),
          "dialogue_intent" => dialogue_intent(plan),
          "sensory_anchor" => sensory_anchor(plan["sensory"])
        }
        |> drop_empty_values()
      end)

    {units, false, ["chapter_plan_scene_plans"]}
  end

  # 有结构化章方向：确定性投影为一个场级单元（无逐场计划时的章级回退）。
  defp scene_units(%ChapterPlanDirection{} = direction, _chapter, _author_input) do
    target_change =
      case clean(direction.character_change) || clean(direction.plot_progress) do
        nil -> %{}
        desc -> %{"type" => "chapter_projection", "description" => desc}
      end

    unit =
      %{
        "unit_id" => "scene_1",
        "scene_mode" => "chapter_projection",
        "target_change" => target_change,
        "causal_spine" =>
          drop_blank(%{
            "turn" => direction.foreshadowing_action,
            "consequence" => direction.information_release
          }),
        "information_delta" => drop_blank(%{"reader_learns" => direction.information_release}),
        "emotion_transition" => drop_blank(%{"end" => direction.emotion})
      }
      |> drop_empty_values()

    {[unit], target_change == %{}, ["chapter_plan_direction"]}
  end

  # 无结构化章方向：从计划摘要 / 作者输入降级生成最小 brief，不伪造场级因果。
  defp scene_units(_direction, chapter, author_input) do
    desc = clean(Map.get(chapter, :summary) || Map.get(chapter, "summary")) || clean(author_input)

    target_change =
      if desc, do: %{"type" => "unspecified", "description" => desc}, else: %{}

    unit = %{
      "unit_id" => "scene_1",
      "scene_mode" => "degraded_from_plan",
      "target_change" => target_change
    }

    {[unit], true, ["plan_summary_or_author_input"]}
  end

  # ── 规划子槽 → VS-00E §1 场级结构（确定性投影，缺省不写键） ──

  # causal_spine 不带 goal：`目标` 已进 target_change，避免 prompt 重复（slice §3.3）。
  defp causal_spine(plan) do
    drop_blank(%{
      "opposition_or_dilemma" => clean(plan["opposition"]),
      "turn" => clean(plan["turn"]),
      "consequence" => clean(plan["consequence"])
    })
  end

  defp information_delta(plan) do
    drop_blank(%{
      "reader_learns" => clean(plan["reader_learns"]),
      "protagonist_learns" => clean(plan["protagonist_learns"]),
      "remains_hidden" => clean(plan["remains_hidden"])
    })
  end

  # 有潜台词 → subtext；只有表面话题 → direct。两者皆无 → 不写键（不伪造对白意图）。
  defp dialogue_intent(plan) do
    surface = clean(plan["surface_topic"])
    hidden = clean(plan["hidden_conflict"])

    case {surface, hidden} do
      {nil, nil} ->
        %{}

      {_surface, nil} ->
        %{"mode" => "direct", "surface_topic" => surface}

      {_surface, _hidden} ->
        drop_blank(%{
          "mode" => "subtext",
          "surface_topic" => surface,
          "hidden_conflict" => hidden
        })
    end
  end

  # 感官字符串按「、，,；;」切分为锚点数组；单值也成一项。空值不写键。
  defp sensory_anchor(text) when is_binary(text) do
    anchors =
      text
      |> String.split(~r/[、，,；;]/u)
      |> Enum.map(&String.trim/1)
      |> Enum.reject(&(&1 == ""))

    if anchors == [], do: nil, else: anchors
  end

  defp sensory_anchor(_text), do: nil

  defp chapter_context(direction, reader_effect) do
    %{
      "chapter_role" => direction_role(direction),
      "reader_effect_ref" => if(is_nil(reader_effect), do: nil, else: "reader_effect_brief")
    }
    |> drop_blank()
  end

  # WR01（VS-00E §16）：本章使命进 chapter_context。present → 带 statement/条目，
  # brief_source += "chapter_mission"；推理降级 → 只留痕 "chapter_mission_degraded"（不伪造
  # 使命，writer 按既有简报写）；缺席（未排步/一步预算）→ 不动。
  defp mission_context(mission) do
    case ChapterMission.from_map(mission) do
      nil ->
        {%{}, []}

      %ChapterMission{degraded: true, degraded_reason: reason} ->
        {drop_blank(%{"mission_degraded_reason" => reason}), ["chapter_mission_degraded"]}

      %ChapterMission{} = present ->
        if ChapterMission.present?(present) do
          {%{"mission" => present |> ChapterMission.to_map() |> Map.drop(["dropped"])},
           ["chapter_mission"]}
        else
          {%{}, []}
        end
    end
  end

  defp direction_role(%ChapterPlanDirection{chapter_role: role}), do: clean(role)
  defp direction_role(_), do: nil

  defp chapter_ref(chapter) do
    clean(Map.get(chapter, :id) || Map.get(chapter, "id")) ||
      clean(Map.get(chapter, :title) || Map.get(chapter, "title"))
  end

  # ── helpers ────────────────────────────────────────

  defp drop_blank(map) do
    map |> Enum.reject(fn {_k, v} -> blank?(v) end) |> Map.new()
  end

  defp drop_empty_values(map) do
    map
    |> Enum.reject(fn
      {_k, v} when is_map(v) -> map_size(v) == 0
      {_k, v} -> blank?(v)
    end)
    |> Map.new()
  end

  defp clean(value) when is_binary(value) do
    trimmed = String.trim(value)
    if trimmed == "", do: nil, else: trimmed
  end

  defp clean(_), do: nil

  defp blank?(nil), do: true
  defp blank?(""), do: true
  defp blank?(value) when is_binary(value), do: String.trim(value) == ""
  defp blank?(_), do: false
end
