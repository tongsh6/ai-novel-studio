defmodule NovelPersistence.CharacterMergeRepo do
  @moduledoc """
  角色身份归并事务（AU12）：把 source 行并入 target 行。

  单事务完成四件事，任何一步失败整体回滚：

  1. target 行按 `NovelDomain.CharacterIdentity.merge_plan/3` 更新主名与别名集合；
  2. source 行置 `SUPERSEDED`（保审计痕；档案读端口只认 accepted 族，自动隐藏）；
  3. 弧光账归一（`absorb_arc_plan/3`）：吸收 / 改挂 / 改标签，保证
     `(work_id, ledger, subject_ref)` 唯一性且 arc 条目全部指向存活行；
  4. 归并本身零正文/记忆/章摘要写入——章摘要与正文按人名文本引用，
     由别名匹配接住历史称呼。
  """

  import Ecto.Query

  alias Ecto.Multi
  alias NovelDomain.CharacterIdentity
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.LedgerEntry

  @doc """
  执行归并。`keep_name`："target"（默认）或 "source"（改名情形：换主名）。

  返回 `{:ok, %{target: %Character{}, superseded_ref: id}}` 或
  `{:error, reason}`（:character_not_found / :cannot_merge_self /
  :cross_work_merge_forbidden / :target_not_mergeable / :source_not_mergeable）。
  """
  @spec merge(String.t(), String.t(), String.t(), String.t()) ::
          {:ok, %{target: Character.t(), superseded_ref: String.t()}} | {:error, term()}
  def merge(work_id, source_ref, target_ref, keep_name \\ "target") do
    with {:ok, work_uuid} <- cast_uuid(work_id),
         {:ok, source} <- fetch_character(work_uuid, source_ref),
         {:ok, target} <- fetch_character(work_uuid, target_ref),
         {:ok, plan} <- CharacterIdentity.merge_plan(as_map(target), as_map(source), keep_name) do
      run_merge(work_id, source, target, plan)
    end
  end

  defp run_merge(work_id, source, target, plan) do
    Multi.new()
    |> Multi.update(:target, Character.changeset(target, %{name: plan.name, aliases: plan.aliases}))
    |> Multi.update(
      :source,
      Character.changeset(source, %{status: AdoptionStatus.superseded(), provisional_active: false})
    )
    |> Multi.run(:arc, fn repo, %{target: merged_target} ->
      reconcile_arc(repo, work_id, source.id, merged_target)
    end)
    |> Repo.transaction()
    |> case do
      {:ok, %{target: merged_target}} ->
        {:ok, %{target: merged_target, superseded_ref: to_string(source.id)}}

      {:error, _step, reason, _changes} ->
        {:error, reason}
    end
  end

  defp reconcile_arc(repo, work_id, source_id, merged_target) do
    target_entry = arc_entry(repo, work_id, merged_target.id)
    source_entry = arc_entry(repo, work_id, source_id)

    merged_ref = %{id: merged_target.id, name: merged_target.name}

    case CharacterIdentity.absorb_arc_plan(
           entry_map(target_entry),
           entry_map(source_entry),
           merged_ref
         ) do
      :noop ->
        {:ok, :noop}

      {:relabel, attrs} ->
        target_entry |> LedgerEntry.changeset(attrs) |> repo.update()

      {:repoint, attrs} ->
        source_entry |> LedgerEntry.changeset(attrs) |> repo.update()

      {:absorb, %{target_attrs: attrs}} ->
        with {:ok, updated} <- target_entry |> LedgerEntry.changeset(attrs) |> repo.update(),
             {:ok, _deleted} <- repo.delete(source_entry) do
          {:ok, updated}
        end
    end
  end

  defp arc_entry(repo, work_id, character_id) do
    repo.one(
      from(e in LedgerEntry,
        where:
          e.work_id == ^work_id and e.ledger == "arc" and
            e.subject_ref == ^to_string(character_id)
      )
    )
  end

  defp entry_map(nil), do: nil
  defp entry_map(%LedgerEntry{} = entry), do: Map.from_struct(entry)

  defp fetch_character(work_uuid, character_ref) do
    with {:ok, uuid} <- cast_uuid(character_ref),
         %Character{} = character <-
           Repo.one(from(c in Character, where: c.work_id == ^work_uuid and c.id == ^uuid)) do
      {:ok, character}
    else
      _ -> {:error, :character_not_found}
    end
  end

  defp as_map(%Character{} = character), do: Map.from_struct(character)

  defp cast_uuid(value) do
    case Ecto.UUID.cast(to_string(value)) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, :character_not_found}
    end
  end
end
