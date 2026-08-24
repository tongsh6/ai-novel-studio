defmodule NovelPersistence.PlanningMissionRepo do
  @moduledoc """
  规划使命的持久位（WR01c / VS-00E §16.10）：`works.planning_direction["planning_mission"]`。

  与 `ChapterMissionRepo` 同构（WR01b 暂定模板照抄到 work 级）：

  - `put_tentative/2`：规划推理步落暂定——作者版（CONFIRMED / AUTHOR_EDITED）在场时
    **不覆盖**（I-M6），旧暂定被新暂定覆盖。
  - `confirm/1`：TENTATIVE → CONFIRMED（就地）。
  - `rewrite/2`：作者改写 → AUTHOR_EDITED（换 mission_id，依据归作者）。
  - `discard/1`：删键，让下轮规划重新推导。
  - `get_mission/1`：flow 作者版直取入口（0 调用路径）。

  使命是设计态，本模块不碰 memory / ledger / 章结构。
  """

  import Ecto.Query

  alias NovelDomain.ChapterMission
  alias NovelFoundation.Enums.ChapterMissionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Work

  @key "planning_mission"

  @type decision :: %{
          work_id: String.t(),
          mission: map() | nil,
          mission_status: String.t() | nil
        }

  @doc "读当前规划使命 map（无则 nil）；flow 作者版直取用。"
  @spec get_mission(String.t()) :: map() | nil
  def get_mission(work_id) do
    case work_by_id(work_id) do
      nil -> nil
      %Work{} = work -> current_mission(work)
    end
  end

  @doc "落暂定。返回 `{:ok, :stored | :author_version_kept, mission_map}`。"
  @spec put_tentative(String.t(), map()) ::
          {:ok, :stored | :author_version_kept, map()} | {:error, term()}
  def put_tentative(work_id, mission_map) when is_map(mission_map) do
    case work_by_id(work_id) do
      nil -> {:error, :work_not_found}
      %Work{} = work -> store_tentative(work, current_mission(work), mission_map)
    end
  end

  def put_tentative(_work_id, _mission_map), do: {:error, :invalid_arguments}

  @spec get(String.t()) :: {:ok, decision()} | {:error, :work_not_found}
  def get(work_id) do
    case work_by_id(work_id) do
      nil -> {:error, :work_not_found}
      work -> {:ok, to_decision(work)}
    end
  end

  @spec confirm(String.t()) :: {:ok, decision()} | {:error, term()}
  def confirm(work_id) do
    with {:ok, work, mission} <- tentative_mission(work_id) do
      confirmed =
        mission
        |> Map.put("status", ChapterMissionStatus.confirmed())
        |> Map.put("source", "author")
        |> Map.put("decided_at", now_iso())

      with {:ok, updated} <- write_mission(work, confirmed), do: {:ok, to_decision(updated)}
    end
  end

  @spec rewrite(String.t(), map()) :: {:ok, decision()} | {:error, term()}
  def rewrite(work_id, attrs) when is_map(attrs) do
    with %Work{} = work <- work_by_id(work_id) || {:error, :work_not_found},
         {:ok, mission} <- ChapterMission.from_author(attrs) do
      rewritten =
        mission
        |> ChapterMission.persisted_map()
        |> Map.put("decided_at", now_iso())

      with {:ok, updated} <- write_mission(work, rewritten), do: {:ok, to_decision(updated)}
    end
  end

  @spec discard(String.t()) :: {:ok, decision()} | {:error, term()}
  def discard(work_id) do
    case work_by_id(work_id) do
      nil ->
        {:error, :work_not_found}

      %Work{} = work ->
        if is_nil(current_mission(work)),
          do: {:error, :mission_not_found},
          else: delete_mission(work)
    end
  end

  # ── helpers ─────────────────────────────────────────

  # 作者版在场不覆盖（I-M6）；无使命或旧暂定 → 写新暂定。
  defp store_tentative(work, existing, mission_map) do
    if ChapterMission.author_version?(existing) do
      {:ok, :author_version_kept, existing}
    else
      write_tentative(work, mission_map)
    end
  end

  defp write_tentative(work, mission_map) do
    tentative =
      mission_map
      |> ChapterMission.from_map()
      |> ChapterMission.as_tentative()
      |> ChapterMission.persisted_map()
      |> Map.put("derived_at", now_iso())

    with {:ok, _work} <- write_mission(work, tentative) do
      {:ok, :stored, tentative}
    end
  end

  defp delete_mission(%Work{} = work) do
    planning_direction = (work.planning_direction || %{}) |> Map.delete(@key) |> empty_to_nil()

    with {:ok, updated} <-
           work |> Work.changeset(%{planning_direction: planning_direction}) |> Repo.update() do
      {:ok, to_decision(updated)}
    end
  end

  defp tentative_mission(work_id) do
    case work_by_id(work_id) do
      nil ->
        {:error, :work_not_found}

      %Work{} = work ->
        case current_mission(work) do
          nil -> {:error, :mission_not_found}
          %{"status" => "TENTATIVE"} = mission -> {:ok, work, mission}
          _other -> {:error, :mission_not_tentative}
        end
    end
  end

  defp write_mission(%Work{} = work, mission_map) do
    planning_direction = Map.put(work.planning_direction || %{}, @key, mission_map)
    work |> Work.changeset(%{planning_direction: planning_direction}) |> Repo.update()
  end

  defp current_mission(%Work{planning_direction: %{} = planning_direction}) do
    case Map.get(planning_direction, @key) do
      %{} = mission when map_size(mission) > 0 -> mission
      _ -> nil
    end
  end

  defp current_mission(_work), do: nil

  defp to_decision(%Work{} = work) do
    mission = current_mission(work)

    %{
      work_id: to_string(work.id),
      mission: mission,
      mission_status: mission && Map.get(mission, "status")
    }
  end

  defp work_by_id(work_id) do
    case Ecto.UUID.cast(to_string(work_id)) do
      {:ok, uuid} -> Work |> where([w], w.id == ^uuid) |> Repo.one()
      :error -> nil
    end
  end

  defp empty_to_nil(map) when map_size(map) == 0, do: nil
  defp empty_to_nil(map), do: map

  defp now_iso, do: DateTime.utc_now() |> DateTime.to_iso8601()
end
