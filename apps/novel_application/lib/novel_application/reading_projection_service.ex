defmodule NovelApplication.ReadingProjectionService do
  @moduledoc """
  Application boundary for AU-08 Reading Mode projections.

  Web callers consume DTOs from this module instead of reading persistence
  schemas directly.
  """

  alias NovelApplication.ChapterDisplay
  alias NovelDomain.ChapterPlanDirection
  alias NovelDomain.VolumeBlueprint
  alias NovelFoundation.Enums.ChapterMissionStatus
  alias NovelPersistence.ChapterSummaryRepo
  alias NovelPersistence.ReadingProjectionRepo

  @chapter_mission_confirmed ChapterMissionStatus.confirmed()
  @chapter_mission_author_edited ChapterMissionStatus.author_edited()

  @type toc :: %{
          work_id: String.t(),
          total_word_count: non_neg_integer(),
          audit: map(),
          volumes: [map()],
          # 阅读投影实际附带卷方向线索（repo 返回；web 直接透传消费）。
          planning_direction: map() | nil
        }
  @type chapter_content :: %{
          id: String.t(),
          title: String.t(),
          word_count: non_neg_integer(),
          scenes: [map()]
        }

  @spec toc(String.t()) :: toc()
  def toc(work_id) when is_binary(work_id) do
    ReadingProjectionRepo.toc(work_id)
  end

  @doc "按本作品目录中的真实章节 ref 读取设计态及当前已采纳章摘要。"
  @spec chapter_design(String.t(), String.t()) :: {:ok, map()} | {:error, :chapter_not_found}
  def chapter_design(work_id, chapter_ref) do
    target =
      work_id
      |> toc()
      |> Map.fetch!(:volumes)
      |> Enum.find_value(fn volume ->
        case Enum.find(volume.chapters, &("chapter:#{&1.id}" == chapter_ref)) do
          nil -> nil
          chapter -> {volume, chapter}
        end
      end)

    case target do
      nil ->
        {:error, :chapter_not_found}

      {volume, chapter} ->
        accepted = ChapterSummaryRepo.current_accepted(work_id, chapter.id)
        summary = if accepted, do: Map.take(accepted, [:id, :status, :source_ref, :summary_text])
        {:ok, %{chapter: chapter, volume: volume, accepted_summary: summary}}
    end
  end

  # 设计态（E18-E22 结构化计划；ADR-0025 CP5b 探索补面 A）：无结构化计划时
  # 回退 chapters.summary（大纲采纳的单行方向），两者皆无则诚实说明。
  # B11A CP4（VS-00J §4 消费面 4 / 08 §8 探索面同步律）：所属卷与当前卷蓝图摘要
  # 同批可读；卷无设计态蓝图时整段不渲染（I-VOL-4：与今天逐字节一致）。
  @spec chapter_plan_preview(map(), map() | nil) :: String.t()
  def chapter_plan_preview(chapter, volume) do
    plan = ChapterPlanDirection.from_storage(Map.get(chapter, :plan_direction))

    rendered =
      case plan do
        nil ->
          case Map.get(chapter, :summary) do
            summary when is_binary(summary) and summary != "" -> summary
            _ -> "（本章尚无设计计划）"
          end

        direction ->
          [
            {"功能定位", direction.chapter_role},
            {"情节推进", direction.plot_progress},
            {"人物变化", direction.character_change},
            {"信息释放", direction.information_release},
            {"伏笔动作", direction.foreshadowing_action},
            {"情绪定位", direction.emotion},
            {"章首拉力", direction.opening_hook},
            {"章尾断章", direction.ending_hook},
            {"篇幅与场次", direction.word_count_and_scenes},
            {"场次计划", scene_plans_text(direction.scene_plans)},
            {"本章使命", chapter_mission_text(direction.chapter_mission)}
          ]
          |> Enum.reject(fn {_label, value} -> value in [nil, ""] end)
          |> Enum.map_join("；", fn {label, value} -> "#{label}：#{value}" end)
      end

    append_volume_text(rendered, volume)
  end

  defp append_volume_text(rendered, volume) do
    case volume_blueprint_text(volume) do
      "" -> rendered
      text -> rendered <> "；" <> text
    end
  end

  defp volume_blueprint_text(nil), do: ""

  defp volume_blueprint_text(volume) do
    blueprint = volume |> Map.get(:blueprint) |> VolumeBlueprint.to_storage()

    if VolumeBlueprint.empty?(blueprint) do
      ""
    else
      summary = blueprint |> VolumeBlueprint.summary_lines() |> Enum.join("；")

      [
        volume_title_text(Map.get(volume, :title)),
        if(summary == "", do: nil, else: "当前卷蓝图：#{summary}")
      ]
      |> Enum.reject(&is_nil/1)
      |> Enum.join("；")
    end
  end

  defp volume_title_text(title) when is_binary(title) do
    case String.trim(title) do
      "" -> nil
      trimmed -> "所属卷：#{trimmed}"
    end
  end

  defp volume_title_text(_title), do: nil

  # 场次计划（NEM04 刀③，探索面同步律）：规划落库的逐场三槽在判断循环内可读。
  # B11C CP1：VS-00E §1 场级结构子槽（因果/信息差/对白/感官）同批可读；缺子槽不渲染。
  defp scene_plans_text([]), do: nil

  defp scene_plans_text(plans) when is_list(plans) do
    Enum.map_join(plans, " / ", fn plan ->
      slots = plan |> ChapterPlanDirection.scene_slot_lines() |> Enum.join("；")

      if slots == "", do: plan["title"], else: "#{plan["title"]}（#{slots}）"
    end)
  end

  # 本章使命（WR01b，探索面同步律）：落章计划的使命与裁决状态在判断循环内可读。
  defp chapter_mission_text(nil), do: nil

  defp chapter_mission_text(mission) do
    case NovelDomain.ChapterMission.from_map(mission) do
      %NovelDomain.ChapterMission{statement: statement} = m when is_binary(statement) ->
        items =
          Enum.map(m.must_advance, &"必须推进：#{&1["text"]}") ++
            Enum.map(m.must_avoid, &"不得：#{&1["text"]}")

        status = mission_status_label(m.status)
        Enum.join(["#{statement}（#{status}）" | items], "；")

      _ ->
        nil
    end
  end

  defp mission_status_label(@chapter_mission_confirmed), do: "作者已确认"
  defp mission_status_label(@chapter_mission_author_edited), do: "作者改写"
  defp mission_status_label(_), do: "暂定"

  @doc """
  AU08 工作台/阅读页可见 TOC：只把各章 `title` 投影为当前章序可读标题。

  复用 ChapterDisplay 的当前 seq 与历史前缀规则，区分同名章、更正陈旧旧章号；
  不改写 `toc/1` 的原始 title（内部读取/导出仍用原文）。`as_N` 占位标题
  （trim、大小写不敏感）按无业务标题处理，由 ChapterDisplay 生成「第N章」，
  避免直接渲染 `get_toc` 的面板继续暴露占位标识。
  """
  @spec toc_for_display(String.t()) :: toc()
  def toc_for_display(work_id) when is_binary(work_id) do
    data = toc(work_id)

    %{data | volumes: Enum.map(data.volumes, &display_volume/1)}
  end

  defp display_volume(volume) do
    %{volume | chapters: Enum.map(volume.chapters, &display_chapter/1)}
  end

  defp display_chapter(chapter) do
    display_source =
      if as_placeholder_title?(Map.get(chapter, :title)) do
        Map.put(chapter, :title, "")
      else
        chapter
      end

    Map.put(display_source, :title, ChapterDisplay.display_title(display_source))
  end

  # 与前端 readingProjection 既有占位守卫同口径并先 trim；只识别 as_N，
  # 其余标题不受影响，由 ChapterDisplay 按当前 seq 生成可见章号。
  defp as_placeholder_title?(title) when is_binary(title),
    do: Regex.match?(~r/^as_\d+$/i, String.trim(title))

  defp as_placeholder_title?(_title), do: false

  @doc """
  工作台头部当前写作坐标（B13b §4.1 #11 / VS-00J §4 消费面 / ADR-0028 UI 影响）。

  优先级（作者裁决 Q11-A）：
  1. 最近的 TurnResult 写作坐标 `writing_coordinate.volume_ref`（与 app JSONL
     `turn_execution.writing_coordinate.done` 同源），按 `produced_at` 取最新非空；
     再用 get_toc 卷节点解析该卷标题。
  2. 无坐标（如规划态）→ 回退 TOC：最后一个有章的卷（事实写作位置）；全部空卷时取最后一卷。
  3. 无卷 → nil（工作台显示「全书」，不出现假「未定卷」）。

   返回 author-safe 结构：卷 id/标题/命中章标题/来源；不泄漏内部 trace。
  """
  @spec current_writing_coordinate(String.t(), [map()]) :: map() | nil
  def current_writing_coordinate(work_id, turn_results)
      when is_binary(work_id) and is_list(turn_results) do
    volumes = work_id |> toc() |> Map.get(:volumes, [])

    case latest_writing_coordinate(turn_results) do
      %{volume_ref: volume_ref, matched_chapter: matched_chapter} when is_binary(volume_ref) ->
        case Enum.find(volumes, &(map_field(&1, :id) == volume_ref)) do
          nil ->
            toc_fallback_coordinate(volumes)

          volume ->
            %{
              volume_ref: volume_ref,
              volume_title: map_field(volume, :title),
              chapter_title: matched_chapter,
              source: "writing_coordinate"
            }
        end

      _ ->
        toc_fallback_coordinate(volumes)
    end
  end

  def current_writing_coordinate(_work_id, _turn_results), do: nil

  defp latest_writing_coordinate(turn_results) do
    turn_results
    |> Enum.map(&{coordinate_of(&1), produced_at_of(&1)})
    |> Enum.filter(fn {coordinate, _produced_at} ->
      is_map(coordinate) and is_binary(map_field(coordinate, :volume_ref))
    end)
    |> Enum.max_by(fn {_coordinate, produced_at} -> produced_at || "" end, fn -> nil end)
    |> case do
      nil -> nil
      {coordinate, _produced_at} -> normalize_coordinate(coordinate)
    end
  end

  defp coordinate_of(turn_result) when is_map(turn_result) do
    map_field(turn_result, :writing_coordinate)
  end

  defp coordinate_of(_turn_result), do: nil

  defp normalize_coordinate(coordinate) do
    %{
      volume_ref: map_field(coordinate, :volume_ref),
      matched_chapter: map_field(coordinate, :matched_chapter)
    }
  end

  defp produced_at_of(turn_result) when is_map(turn_result),
    do: map_field(turn_result, :produced_at)

  defp produced_at_of(_turn_result), do: nil

  # TOC 卷节点按 seq 排序；回退取「最后一个有章的卷」= 事实写作位置；全空卷取最后一卷。
  defp toc_fallback_coordinate([]), do: nil

  defp toc_fallback_coordinate(volumes) do
    fallback =
      volumes
      |> Enum.reverse()
      |> Enum.find(&(List.wrap(map_field(&1, :chapters)) != [])) ||
        List.last(volumes)

    %{
      volume_ref: map_field(fallback, :id),
      volume_title: map_field(fallback, :title),
      chapter_title: nil,
      source: "toc_fallback"
    }
  end

  defp map_field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp map_field(_value, _key), do: nil

  @spec chapter_content(String.t(), String.t()) :: {:ok, chapter_content()} | {:error, :not_found}
  def chapter_content(chapter_id, work_id)
      when is_binary(chapter_id) and is_binary(work_id) do
    ReadingProjectionRepo.chapter_content(chapter_id, work_id)
  end
end
