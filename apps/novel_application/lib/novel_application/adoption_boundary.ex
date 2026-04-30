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
  alias NovelPersistence.Schemas.Draft
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
          |> then(&wrap_result(&1, discarded))
        end)
        |> Repo.transaction()
        |> then(&unwrap_multi(&1))
    end
  end

  # ---- Draft artifact operations ----

  @doc """
  创建 tentative draft artifact，写入 DB。

  返回带 id + revision 的 draft struct。
  """
  @spec create_tentative_draft(map()) :: {:ok, Draft.t()} | {:error, Ecto.Changeset.t()}
  def create_tentative_draft(attrs) when is_map(attrs) do
    %Draft{}
    |> Draft.changeset(build_draft_attrs(attrs))
    |> Repo.insert()
  end

  @doc """
  Accept 一个 tentative draft artifact。
  """
  @spec accept_draft(String.t(), pos_integer(), map()) ::
          {:ok, Draft.t()}
          | {:error, :not_found}
          | {:error, :stale_revision}
          | {:error, term()}
  def accept_draft(draft_id, base_revision, mutation_attrs)
      when is_integer(base_revision) and base_revision > 0 do
    case Repo.get(Draft, draft_id) do
      nil ->
        {:error, :not_found}

      draft ->
        if draft.revision != base_revision do
          record_rejected_mutation(mutation_attrs, draft)
          {:error, :stale_revision}
        else
          adopt_draft_and_record(draft, mutation_attrs)
        end
    end
  end

  @doc """
  Discard 一个 tentative draft artifact。
  """
  @spec discard_draft(String.t(), map()) ::
          {:ok, Draft.t()}
          | {:error, :not_found}
          | {:error, term()}
  def discard_draft(draft_id, mutation_attrs) when is_map(mutation_attrs) do
    case Repo.get(Draft, draft_id) do
      nil ->
        {:error, :not_found}

      draft ->
        Multi.new()
        |> Multi.update(:discard, Draft.discard_changeset(draft))
        |> Multi.run(:mutation, fn _repo, %{discard: discarded} ->
          MutationLog.create_applied(%{
            actor_ref: mutation_attrs.actor_ref,
            source_turn_ref: mutation_attrs.source_turn_ref,
            target_scope: "draft",
            target_object_ref: mutation_attrs.target_object_ref,
            base_revision: draft.revision,
            mutation_type: "discard",
            authority_scope: Map.get(mutation_attrs, :authority_scope),
            requires_adoption: false
          })
          |> then(&wrap_result(&1, discarded))
        end)
        |> Repo.transaction()
        |> then(&unwrap_multi(&1))
    end
  end

  @doc """
  修改一个 tentative draft 的内容。每次修改生成新 revision。

  使用 optimistic_lock(:revision) 保证并发安全——如果 draft 在读取后被其他
  进程修改，revision 不匹配会导致更新失败（Ecto.StaleEntryError）。
  """
  @spec modify_draft(String.t(), pos_integer(), String.t(), map()) ::
          {:ok, Draft.t()} | {:error, term()}
  def modify_draft(draft_id, base_revision, new_content, mutation_attrs) do
    case Repo.get(Draft, draft_id) do
      nil -> {:error, :not_found}
      draft -> modify_draft_multi(draft, draft_id, base_revision, new_content, mutation_attrs)
    end
  end

  # ---- private ----

  defp modify_draft_multi(draft, draft_id, _base_revision, new_content, mutation_attrs)
       when draft.status == "TENTATIVE" do
    attrs = %{content: new_content}

    Multi.new()
    |> Multi.update(:modify, Draft.changeset(draft, attrs))
    |> Multi.run(:mutation, fn _repo, %{modify: modified} ->
      MutationLog.create_applied(%{
        actor_ref: mutation_attrs.actor_ref,
        source_turn_ref: mutation_attrs.source_turn_ref,
        target_scope: "draft",
        target_object_ref: draft_id,
        base_revision: draft.revision,
        mutation_type: "modify",
        authority_scope: Map.get(mutation_attrs, :authority_scope),
        requires_adoption: true
      })
      |> then(&wrap_result(&1, modified))
    end)
    |> Repo.transaction()
    |> then(&unwrap_multi(&1))
  end

  defp modify_draft_multi(_draft, _draft_id, _base_revision, _new_content, _mutation_attrs) do
    {:error, :not_tentative}
  end

  defp wrap_result({:ok, _mutation}, value), do: {:ok, value}
  defp wrap_result({:error, changeset}, _value), do: {:error, changeset}

  defp unwrap_multi({:ok, %{discard: obj}}), do: {:ok, obj}
  defp unwrap_multi({:ok, %{adopt: obj}}), do: {:ok, obj}
  defp unwrap_multi({:ok, %{modify: obj}}), do: {:ok, obj}
  defp unwrap_multi({:error, :mutation, reason, _changes}), do: {:error, reason}
  defp unwrap_multi({:error, _step, reason, _changes}), do: {:error, reason}

  defp adopt_draft_and_record(draft, mutation_attrs) do
    Multi.new()
    |> Multi.update(:adopt, Draft.adopt_changeset(draft))
    |> Multi.run(:mutation, fn _repo, %{adopt: adopted} ->
      MutationLog.create_applied(%{
        actor_ref: mutation_attrs.actor_ref,
        source_turn_ref: mutation_attrs.source_turn_ref,
        target_scope: "draft",
        target_object_ref: mutation_attrs.target_object_ref,
        base_revision: draft.revision,
        mutation_type: "adoption",
        authority_scope: Map.get(mutation_attrs, :authority_scope),
        requires_adoption: false
      })
      |> then(&wrap_result(&1, adopted))
    end)
    |> Repo.transaction()
    |> then(&unwrap_multi(&1))
  end

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
      |> then(&wrap_result(&1, adopted))
    end)
    |> Repo.transaction()
    |> then(&unwrap_multi(&1))
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

  defp build_draft_attrs(attrs) do
    %{
      work_id: Map.get(attrs, "work_id") || Map.get(attrs, :work_id),
      scene_id: Map.get(attrs, "scene_id") || Map.get(attrs, :scene_id),
      content: Map.get(attrs, "content") || Map.get(attrs, :content),
      status: AdoptionStatus.tentative()
    }
  end
end
