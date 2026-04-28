defmodule NovelApplication.AdoptionBoundary do
  @moduledoc """
  Adoption Boundary — tentative → production write。

  Phase 1：用 `Ecto.Multi` 把 insert + adopt 包成单一事务。任何步骤失败都会
  回滚，避免留下孤儿 tentative 行；乐观锁冲突时返回 `{:error, :stale_revision}`。

  ## ADR refs
  - ADR-0002 §5 — adoption 7 态映射；TENTATIVE / ACCEPTED 全 UPPER_SNAKE_CASE
  - 07-consistency-and-concurrency §4.4 / §8.1 — adoption 必须先比对 base_revision
    （目前接口只接受 payload，base_revision 比对将随 mutation contract 一起补）
  """

  alias Ecto.Multi
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Work

  @doc """
  Accept 一个 tentative work artifact，写入 DB 并标记为 accepted。

  实现：`Ecto.Multi` 串联 insert + adopt update。失败时整体回滚。

  返回：
  - `{:ok, work}` — 已 accepted 的 work struct
  - `{:error, :stale_revision}` — 乐观锁冲突
  - `{:error, %Ecto.Changeset{}}` — 校验失败（来自 `:create` 步骤）
  - `{:error, {step, reason}}` — 其他事务步骤失败
  """
  @spec accept(map()) ::
          {:ok, Work.t()}
          | {:error, :stale_revision}
          | {:error, Ecto.Changeset.t()}
          | {:error, {atom(), term()}}
  def accept(artifact_payload) when is_map(artifact_payload) do
    Multi.new()
    |> Multi.insert(:create, Work.changeset(%Work{}, build_attrs(artifact_payload)))
    |> Multi.run(:adopt, fn _repo, %{create: work} ->
      work
      |> Work.adopt_changeset()
      |> Repo.update(stale_error_field: :revision)
    end)
    |> Repo.transaction()
    |> case do
      {:ok, %{adopt: work}} ->
        {:ok, work}

      {:error, :adopt, %Ecto.Changeset{errors: errors}, _changes} ->
        if Keyword.has_key?(errors, :revision),
          do: {:error, :stale_revision},
          else: {:error, errors}

      {:error, :create, %Ecto.Changeset{} = changeset, _changes} ->
        {:error, changeset}

      {:error, step, reason, _changes} ->
        {:error, {step, reason}}
    end
  end

  defp build_attrs(payload) do
    %{
      title: Map.get(payload, "title") || Map.get(payload, :title),
      genre: Map.get(payload, "genre") || Map.get(payload, :genre),
      core_selling_point:
        Map.get(payload, "core_selling_point") || Map.get(payload, :core_selling_point),
      target_reader: Map.get(payload, "target_reader") || Map.get(payload, :target_reader),
      tone_preference: Map.get(payload, "tone_preference") || Map.get(payload, :tone_preference),
      status: AdoptionStatus.tentative()
    }
  end
end
