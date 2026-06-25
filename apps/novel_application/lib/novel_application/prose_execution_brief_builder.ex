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

    source = source ++ if(is_nil(reader_effect), do: [], else: ["reader_effect_brief"])

    brief =
      ProseExecutionBrief.new(%{
        brief_id: "peb_#{System.unique_integer([:positive, :monotonic])}",
        created_at: DateTime.utc_now() |> DateTime.to_iso8601(),
        anchor: %{
          "target_unit" => "chapter",
          "chapter_ref" => chapter_ref(chapter),
          "scene_ref" => nil,
          "source_turn_ref" => source_turn_ref
        },
        chapter_context: chapter_context(direction, reader_effect),
        scene_units: scene_units,
        source_refs: source
      })

    {brief, %{degraded: degraded?, source: source}}
  end

  # ── scene unit 投影 ────────────────────────────────

  # 有结构化章方向：确定性投影为一个场级单元（CP1 单场；多场展开属后续）。
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
        "information_delta" =>
          drop_blank(%{"reader_learns" => direction.information_release}),
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

  defp chapter_context(direction, reader_effect) do
    %{
      "chapter_role" => direction_role(direction),
      "reader_effect_ref" => if(is_nil(reader_effect), do: nil, else: "reader_effect_brief")
    }
    |> drop_blank()
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
