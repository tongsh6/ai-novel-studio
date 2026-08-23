defmodule NovelPersistence.ChapterMissionRepo do
  @moduledoc """
  本章使命的持久位（WR01b / VS-00E §16.8）：`chapters.plan_direction["chapter_mission"]`。

  零 migration：与 `scene_plans` 同款，既有 map 字段承载。状态机见
  `NovelFoundation.Enums.ChapterMissionStatus`；作废 = 删键。

  - `put_tentative/3`：推理步落暂定——作者版（CONFIRMED / AUTHOR_EDITED）在场时**不覆盖**
    （I-M6），旧暂定被新暂定覆盖。
  - `confirm/2`：TENTATIVE → CONFIRMED（就地，不产新行）。
  - `rewrite/3`：作者改写 → AUTHOR_EDITED（换 mission_id，依据归作者）。
  - `discard/2`：删键，让下次写作重新推导。

  使命是设计态（ADR-0020 I2 同级），本模块不碰 memory / ledger / 正文。
  """

  import Ecto.Query

  alias NovelDomain.ChapterMission
  alias NovelFoundation.Enums.ChapterMissionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter

  @key "chapter_mission"

  @type decision :: %{
          chapter_id: String.t(),
          chapter_seq: pos_integer() | nil,
          chapter_title: String.t(),
          mission: map() | nil,
          mission_status: String.t() | nil
        }

  @doc "按章 seq 落暂定。返回 `{:ok, :stored | :author_version_kept, mission_map}`。"
  @spec put_tentative(String.t(), pos_integer(), map()) ::
          {:ok, :stored | :author_version_kept, map()} | {:error, term()}
  def put_tentative(work_id, chapter_seq, mission_map)
      when is_integer(chapter_seq) and is_map(mission_map) do
    case chapter_by_seq(work_id, chapter_seq) do
      nil -> {:error, :chapter_not_found}
      %Chapter{} = chapter -> store_tentative(chapter, current_mission(chapter), mission_map)
    end
  end

  def put_tentative(_work_id, _chapter_seq, _mission_map), do: {:error, :invalid_arguments}

  # 作者版在场不覆盖（I-M6）；无使命或旧暂定 → 写新暂定。
  defp store_tentative(chapter, existing, mission_map) do
    if ChapterMission.author_version?(existing) do
      {:ok, :author_version_kept, existing}
    else
      write_tentative(chapter, mission_map)
    end
  end

  defp write_tentative(chapter, mission_map) do
    tentative =
      mission_map
      |> ChapterMission.from_map()
      |> ChapterMission.as_tentative()
      |> ChapterMission.persisted_map()
      |> Map.put("derived_at", now_iso())

    with {:ok, _chapter} <- write_mission(chapter, tentative) do
      {:ok, :stored, tentative}
    end
  end

  @spec get(String.t(), String.t()) :: {:ok, decision()} | {:error, :chapter_not_found}
  def get(work_id, chapter_id) do
    case chapter_by_id(work_id, chapter_id) do
      nil -> {:error, :chapter_not_found}
      chapter -> {:ok, to_decision(chapter)}
    end
  end

  @spec confirm(String.t(), String.t()) :: {:ok, decision()} | {:error, term()}
  def confirm(work_id, chapter_id) do
    with {:ok, chapter, mission} <- tentative_mission(work_id, chapter_id) do
      confirmed =
        mission
        |> Map.put("status", ChapterMissionStatus.confirmed())
        |> Map.put("source", "author")
        |> Map.put("decided_at", now_iso())

      with {:ok, updated} <- write_mission(chapter, confirmed), do: {:ok, to_decision(updated)}
    end
  end

  @spec rewrite(String.t(), String.t(), map()) :: {:ok, decision()} | {:error, term()}
  def rewrite(work_id, chapter_id, attrs) when is_map(attrs) do
    with %Chapter{} = chapter <-
           chapter_by_id(work_id, chapter_id) || {:error, :chapter_not_found},
         {:ok, mission} <- ChapterMission.from_author(attrs) do
      rewritten =
        mission
        |> ChapterMission.persisted_map()
        |> Map.put("decided_at", now_iso())

      with {:ok, updated} <- write_mission(chapter, rewritten), do: {:ok, to_decision(updated)}
    end
  end

  @spec discard(String.t(), String.t()) :: {:ok, decision()} | {:error, term()}
  def discard(work_id, chapter_id) do
    case chapter_by_id(work_id, chapter_id) do
      nil ->
        {:error, :chapter_not_found}

      %Chapter{} = chapter ->
        if is_nil(current_mission(chapter)),
          do: {:error, :mission_not_found},
          else: delete_mission(chapter)
    end
  end

  defp delete_mission(%Chapter{} = chapter) do
    plan_direction = chapter.plan_direction |> Map.delete(@key) |> empty_to_nil()

    with {:ok, updated} <-
           chapter |> Chapter.changeset(%{plan_direction: plan_direction}) |> Repo.update() do
      {:ok, to_decision(updated)}
    end
  end

  # ── helpers ─────────────────────────────────────────

  defp tentative_mission(work_id, chapter_id) do
    case chapter_by_id(work_id, chapter_id) do
      nil ->
        {:error, :chapter_not_found}

      %Chapter{} = chapter ->
        case current_mission(chapter) do
          nil -> {:error, :mission_not_found}
          %{"status" => status} = mission when status == "TENTATIVE" -> {:ok, chapter, mission}
          _other -> {:error, :mission_not_tentative}
        end
    end
  end

  defp write_mission(%Chapter{} = chapter, mission_map) do
    plan_direction = Map.put(chapter.plan_direction || %{}, @key, mission_map)
    chapter |> Chapter.changeset(%{plan_direction: plan_direction}) |> Repo.update()
  end

  defp current_mission(%Chapter{plan_direction: %{} = plan_direction}) do
    case Map.get(plan_direction, @key) do
      %{} = mission when map_size(mission) > 0 -> mission
      _ -> nil
    end
  end

  defp current_mission(_chapter), do: nil

  defp to_decision(%Chapter{} = chapter) do
    mission = current_mission(chapter)

    %{
      chapter_id: to_string(chapter.id),
      chapter_seq: chapter.seq,
      chapter_title: chapter.title,
      mission: mission,
      mission_status: mission && Map.get(mission, "status")
    }
  end

  defp chapter_by_seq(work_id, seq) do
    case Ecto.UUID.cast(to_string(work_id)) do
      {:ok, work_uuid} ->
        Chapter
        |> where([c], c.work_id == ^work_uuid and c.seq == ^seq)
        |> limit(1)
        |> Repo.one()

      :error ->
        nil
    end
  end

  defp chapter_by_id(work_id, chapter_id) do
    with {:ok, work_uuid} <- Ecto.UUID.cast(to_string(work_id)),
         {:ok, chapter_uuid} <- Ecto.UUID.cast(to_string(chapter_id)) do
      Chapter
      |> where([c], c.work_id == ^work_uuid and c.id == ^chapter_uuid)
      |> Repo.one()
    else
      :error -> nil
    end
  end

  defp empty_to_nil(map) when map_size(map) == 0, do: nil
  defp empty_to_nil(map), do: map

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()
end
