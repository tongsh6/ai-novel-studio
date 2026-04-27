defmodule NovelApplication.AdoptionBoundary do
  @moduledoc """
  Adoption Boundary — tentative → production write。

  Phase 0 Week 4：Ecto.Multi 实现 accept 路径。
  Phase 1 扩展 edit_then_accept / branch / discard。
  """

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Work

  @doc """
  Accept 一个 tentative work artifact，写入 DB 并标记为 accepted。

  返回 `{:ok, work}` 或 `{:error, reason}`。
  """
  @spec accept(map()) :: {:ok, Work.t()} | {:error, term()}
  def accept(artifact_payload) when is_map(artifact_payload) do
    %Work{}
    |> Work.changeset(%{
      title: Map.get(artifact_payload, "title") || Map.get(artifact_payload, :title),
      genre: Map.get(artifact_payload, "genre") || Map.get(artifact_payload, :genre),
      core_selling_point:
        Map.get(artifact_payload, "core_selling_point") ||
          Map.get(artifact_payload, :core_selling_point),
      target_reader:
        Map.get(artifact_payload, "target_reader") || Map.get(artifact_payload, :target_reader),
      tone_preference:
        Map.get(artifact_payload, "tone_preference") ||
          Map.get(artifact_payload, :tone_preference),
      status: "tentative"
    })
    |> Repo.insert()
    |> case do
      {:ok, work} ->
        work
        |> Work.adopt_changeset()
        |> Repo.update()

      error ->
        error
    end
  end
end
