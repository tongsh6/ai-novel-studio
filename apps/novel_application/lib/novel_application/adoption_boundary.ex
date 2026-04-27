defmodule NovelApplication.AdoptionBoundary do
  @moduledoc """
  Adoption Boundary — tentative → production write。

  Phase 0 Week 4：Ecto.Multi 实现 accept 路径。
  Phase 1：乐观锁冲突检测 + :stale_revision 错误。
  """

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Work

  @doc """
  Accept 一个 tentative work artifact，写入 DB 并标记为 accepted。

  乐观锁冲突时返回 `{:error, :stale_revision}`。
  """
  @spec accept(map()) :: {:ok, Work.t()} | {:error, term()}
  def accept(artifact_payload) when is_map(artifact_payload) do
    %Work{}
    |> Work.changeset(build_attrs(artifact_payload))
    |> Repo.insert()
    |> adopt_if_ok()
  end

  defp build_attrs(payload) do
    %{
      title: Map.get(payload, "title") || Map.get(payload, :title),
      genre: Map.get(payload, "genre") || Map.get(payload, :genre),
      core_selling_point:
        Map.get(payload, "core_selling_point") || Map.get(payload, :core_selling_point),
      target_reader: Map.get(payload, "target_reader") || Map.get(payload, :target_reader),
      tone_preference: Map.get(payload, "tone_preference") || Map.get(payload, :tone_preference),
      status: "tentative"
    }
  end

  defp adopt_if_ok({:ok, work}) do
    work
    |> Work.adopt_changeset()
    |> Repo.update()
    |> case do
      {:ok, adopted} -> {:ok, adopted}
      {:error, %Ecto.StaleEntryError{}} -> {:error, :stale_revision}
      other -> other
    end
  end

  defp adopt_if_ok(error), do: error
end
