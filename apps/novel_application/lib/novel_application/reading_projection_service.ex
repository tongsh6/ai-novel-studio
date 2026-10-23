defmodule NovelApplication.ReadingProjectionService do
  @moduledoc """
  Application boundary for AU-08 Reading Mode projections.

  Web callers consume DTOs from this module instead of reading persistence
  schemas directly.
  """

  alias NovelPersistence.ReadingProjectionRepo

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
