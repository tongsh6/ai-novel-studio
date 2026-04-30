defmodule NovelApplication.AdoptionBoundary do
  @moduledoc """
  Adoption Boundary — tentative → production write。

  Phase 1：两步写入模型（create_tentative → accept），显式 base_revision 检查，
  mutation 记录（07-consistency-and-concurrency §4.4 / §7.1 / §8.1）。

  ## 流程
  1. `create_tentative/1` — 插入 tentative work，返回带 revision 的 work struct
  2. `accept/3` — 加载 work，比对 base_revision，采纳并记录 mutation

  ## ADR refs
  - ADR-0002 §5 — adoption 7 态映射
  - 07-consistency-and-concurrency §4.4 — 更新必须先检查再提交
  - 07-consistency-and-concurrency §7.1 — mutation 显式对象
  - 07-consistency-and-concurrency §8.1 — adoption 必须检查 base revision
  """

  alias Ecto.Multi
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MutationStatus
  alias NovelPersistence.MutationLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Work

  @doc """
  创建 tentative work artifact，写入 DB。

  返回带 id + revision 的 work struct，供后续 accept/2 使用。
  """
  @spec create_tentative(map()) :: {:ok, Work.t()} | {:error, Ecto.Changeset.t()}
  def create_tentative(artifact_payload) when is_map(artifact_payload) do
    %Work{}
    |> Work.changeset(build_attrs(artifact_payload))
    |> Repo.insert()
  end

  @doc """
  Accept 一个 tentative work artifact。

  一致性路径（§4.4）：
  1. load work by id
  2. compare work.revision with base_revision
  3. if match: adopt + record mutation as APPLIED
  4. if mismatch: return {:error, :stale_revision}

  mutation_attrs 至少需要：
  - actor_ref, source_turn_ref, target_scope, target_object_ref (required)
  - source_task_ref, authority_scope (optional)
  """
  @spec accept(String.t(), pos_integer(), map()) ::
          {:ok, Work.t()}
          | {:error, :not_found}
          | {:error, :stale_revision}
          | {:error, term()}
  def accept(work_id, base_revision, mutation_attrs) when is_integer(base_revision) and base_revision > 0 do
    case Repo.get(Work, work_id) do
      nil ->
        {:error, :not_found}

      work ->
        if work.revision != base_revision do
          # Base revision mismatch — someone else changed this object
          record_rejected_mutation(mutation_attrs, work)
          {:error, :stale_revision}
        else
          adopt_and_record(work, mutation_attrs)
        end
    end
  end

  @doc """
  Discard 一个 tentative artifact。

  将 work 状态设为 DISCARDED，记录 CANCELLED mutation。
  """
  @spec discard(String.t(), map()) ::
          {:ok, Work.t()}
          | {:error, :not_found}
          | {:error, term()}
  def discard(work_id, mutation_attrs) when is_map(mutation_attrs) do
    case Repo.get(Work, work_id) do
      nil ->
        {:error, :not_found}

      work ->
        Multi.new()
        |> Multi.update(:discard, Work.discard_changeset(work))
        |> Multi.run(:mutation, fn _repo, %{discard: discarded} ->
          MutationLog.create_applied(%{
            actor_ref: mutation_attrs.actor_ref,
            source_turn_ref: mutation_attrs.source_turn_ref,
            source_task_ref: Map.get(mutation_attrs, :source_task_ref),
            target_scope: mutation_attrs.target_scope,
            target_object_ref: mutation_attrs.target_object_ref,
            base_revision: work.revision,
            mutation_type: "discard",
            authority_scope: Map.get(mutation_attrs, :authority_scope),
            requires_adoption: false
          })
          |> case do
            {:ok, _mutation} -> {:ok, discarded}
            {:error, changeset} -> {:error, changeset}
          end
        end)
        |> Repo.transaction()
        |> case do
          {:ok, %{discard: work}} -> {:ok, work}
          {:error, :mutation, reason, _changes} -> {:error, reason}
          {:error, _step, reason, _changes} -> {:error, reason}
        end
    end
  end

  # ---- private ----

  defp adopt_and_record(work, mutation_attrs) do
    Multi.new()
    |> Multi.update(:adopt, Work.adopt_changeset(work))
    |> Multi.run(:mutation, fn _repo, %{adopt: adopted} ->
      MutationLog.create_applied(%{
        actor_ref: mutation_attrs.actor_ref,
        source_turn_ref: mutation_attrs.source_turn_ref,
        source_task_ref: Map.get(mutation_attrs, :source_task_ref),
        target_scope: mutation_attrs.target_scope,
        target_object_ref: mutation_attrs.target_object_ref,
        base_revision: work.revision,
        mutation_type: "adoption",
        authority_scope: Map.get(mutation_attrs, :authority_scope),
        requires_adoption: false
      })
      |> case do
        {:ok, _mutation} -> {:ok, adopted}
        {:error, changeset} -> {:error, changeset}
      end
    end)
    |> Repo.transaction()
    |> case do
      {:ok, %{adopt: work}} -> {:ok, work}
      {:error, :mutation, reason, _changes} -> {:error, reason}
      {:error, _step, reason, _changes} -> {:error, reason}
    end
  end

  defp record_rejected_mutation(mutation_attrs, work) do
    MutationLog.create(%{
      actor_ref: mutation_attrs.actor_ref,
      source_turn_ref: mutation_attrs.source_turn_ref,
      source_task_ref: Map.get(mutation_attrs, :source_task_ref),
      target_scope: mutation_attrs.target_scope,
      target_object_ref: mutation_attrs.target_object_ref,
      base_revision: Map.get(mutation_attrs, :base_revision) || work.revision,
      mutation_type: "adoption",
      status: MutationStatus.blocked(),
      authority_scope: Map.get(mutation_attrs, :authority_scope),
      requires_adoption: true
    })
    # Best-effort log; failure to record mutation should not mask the real error
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
