defmodule NovelApplication.PlanningMissionDecisionService do
  @moduledoc """
  规划使命的作者裁决用例层（WR01c / ADR-0024 S9）：确认 / 改写 / 作废。

  比照 `ChapterMissionDecisionService`（WR01b 模板照抄到 work 级）：web 的用例边界，
  直连 `PlanningMissionRepo`；裁决只改 `works.planning_direction["planning_mission"]`
  （设计态），不碰作品事实。
  """

  alias NovelPersistence.PlanningMissionRepo

  @type decision :: PlanningMissionRepo.decision()

  @spec confirm(String.t()) :: {:ok, decision()} | {:error, term()}
  def confirm(work_id) when is_binary(work_id), do: PlanningMissionRepo.confirm(work_id)

  @spec rewrite(String.t(), map()) :: {:ok, decision()} | {:error, term()}
  def rewrite(work_id, attrs) when is_binary(work_id) and is_map(attrs),
    do: PlanningMissionRepo.rewrite(work_id, normalize_rewrite(attrs))

  @spec discard(String.t()) :: {:ok, decision()} | {:error, term()}
  def discard(work_id) when is_binary(work_id), do: PlanningMissionRepo.discard(work_id)

  # channel payload 形状宽容：条目可为字符串列表或 %{text} 列表；空行丢弃。
  defp normalize_rewrite(attrs) do
    %{
      statement: field(attrs, :statement),
      must_advance: attrs |> field(:must_advance) |> normalize_lines(),
      must_avoid: attrs |> field(:must_avoid) |> normalize_lines()
    }
  end

  defp normalize_lines(lines) when is_list(lines) do
    lines
    |> Enum.map(fn
      %{} = item -> field(item, :text)
      text -> text
    end)
    |> Enum.map(&(&1 |> to_string() |> String.trim()))
    |> Enum.reject(&(&1 == ""))
    |> Enum.map(&%{"text" => &1})
  end

  defp normalize_lines(text) when is_binary(text),
    do: text |> String.split(~r/\r?\n/) |> normalize_lines()

  defp normalize_lines(_), do: []

  defp field(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp field(_map, _key), do: nil
end
