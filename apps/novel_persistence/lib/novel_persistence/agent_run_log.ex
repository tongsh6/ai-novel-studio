defmodule NovelPersistence.AgentRunLog do
  @moduledoc """
  Minimal persisted AgentRun log for CP3 bounded runtime evidence.

  The hot runtime remains supervised OTP state. These records provide durable
  audit/query evidence for runs, steps, and author-safe events.
  """

  import Ecto.Query, only: [from: 2]

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{AgentEventRecord, AgentRunRecord, AgentRunStepRecord}

  @spec upsert_run(map()) :: {:ok, AgentRunRecord.t()} | {:error, Ecto.Changeset.t()}
  def upsert_run(%{id: id} = attrs) when is_binary(id) do
    case Repo.get(AgentRunRecord, id) do
      nil ->
        %AgentRunRecord{}
        |> AgentRunRecord.changeset(attrs)
        |> Repo.insert()

      %AgentRunRecord{} = record ->
        record
        |> AgentRunRecord.changeset(attrs)
        |> Repo.update()
    end
  end

  @spec insert_step(map()) :: {:ok, AgentRunStepRecord.t()} | {:error, Ecto.Changeset.t()}
  def insert_step(%{id: id} = attrs) when is_binary(id) do
    case Repo.get(AgentRunStepRecord, id) do
      nil ->
        %AgentRunStepRecord{}
        |> AgentRunStepRecord.changeset(attrs)
        |> Repo.insert()

      %AgentRunStepRecord{} = record ->
        record
        |> AgentRunStepRecord.changeset(attrs)
        |> Repo.update()
    end
  end

  @spec insert_event(map()) :: {:ok, AgentEventRecord.t()} | {:error, Ecto.Changeset.t()}
  def insert_event(attrs) when is_map(attrs) do
    %AgentEventRecord{}
    |> AgentEventRecord.changeset(attrs)
    |> Repo.insert()
  end

  @spec insert_events([map()]) :: :ok | {:error, term()}
  def insert_events(attrs_list) when is_list(attrs_list) do
    Repo.transaction(fn ->
      Enum.each(attrs_list, fn attrs ->
        %AgentEventRecord{}
        |> AgentEventRecord.changeset(attrs)
        |> Repo.insert(on_conflict: :nothing)
      end)
    end)
    |> case do
      {:ok, _value} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  @spec get_run(String.t()) :: AgentRunRecord.t() | nil
  def get_run(run_id) when is_binary(run_id), do: Repo.get(AgentRunRecord, run_id)

  @spec list_steps(String.t()) :: [AgentRunStepRecord.t()]
  def list_steps(run_id) when is_binary(run_id) do
    from(s in AgentRunStepRecord,
      where: s.run_id == ^run_id,
      order_by: [asc: s.sequence]
    )
    |> Repo.all()
  end

  @spec list_events(String.t()) :: [AgentEventRecord.t()]
  def list_events(run_id) when is_binary(run_id) do
    from(e in AgentEventRecord,
      where: e.run_id == ^run_id,
      order_by: [asc: e.sequence]
    )
    |> Repo.all()
  end

  @spec list_author_events(String.t()) :: [AgentEventRecord.t()]
  def list_author_events(run_id) when is_binary(run_id) do
    from(e in AgentEventRecord,
      where: e.run_id == ^run_id and e.visibility == "author",
      order_by: [asc: e.sequence]
    )
    |> Repo.all()
  end

  @spec list_author_events_by_run_ids([String.t()]) :: %{String.t() => [AgentEventRecord.t()]}
  def list_author_events_by_run_ids(run_ids) when is_list(run_ids) do
    case normalize_ids(run_ids) do
      [] ->
        %{}

      ids ->
        from(e in AgentEventRecord,
          where: e.run_id in ^ids and e.visibility == "author",
          order_by: [asc: e.run_id, asc: e.sequence]
        )
        |> Repo.all()
        |> Enum.group_by(& &1.run_id)
    end
  end

  @spec list_by_parent_turn(String.t(), String.t(), String.t()) :: [AgentRunRecord.t()]
  def list_by_parent_turn(work_id, session_id, parent_turn_ref)
      when is_binary(work_id) and is_binary(session_id) and is_binary(parent_turn_ref) do
    from(r in AgentRunRecord,
      where:
        r.work_id == ^work_id and r.session_id == ^session_id and
          r.parent_turn_ref == ^parent_turn_ref,
      order_by: [asc: r.inserted_at]
    )
    |> Repo.all()
  end

  @spec list_by_parent_turns(String.t(), String.t(), [String.t()]) :: [AgentRunRecord.t()]
  def list_by_parent_turns(work_id, session_id, parent_turn_refs)
      when is_binary(work_id) and is_binary(session_id) and is_list(parent_turn_refs) do
    case normalize_ids(parent_turn_refs) do
      [] ->
        []

      refs ->
        from(r in AgentRunRecord,
          where:
            r.work_id == ^work_id and r.session_id == ^session_id and
              r.parent_turn_ref in ^refs,
          order_by: [asc: r.parent_turn_ref, asc: r.inserted_at]
        )
        |> Repo.all()
    end
  end

  @spec list_active_durable(String.t(), String.t()) :: [AgentRunRecord.t()]
  def list_active_durable(work_id, session_id)
      when is_binary(work_id) and is_binary(session_id) do
    from(r in AgentRunRecord,
      where:
        r.work_id == ^work_id and r.session_id == ^session_id and r.run_mode == "durable" and
          r.status not in ["completed", "cancelled", "failed"],
      order_by: [desc: r.updated_at]
    )
    |> Repo.all()
  end

  @spec list_active_durable_by_work(String.t()) :: [AgentRunRecord.t()]
  def list_active_durable_by_work(work_id) when is_binary(work_id) do
    from(r in AgentRunRecord,
      where:
        r.work_id == ^work_id and r.run_mode == "durable" and
          r.status not in ["completed", "cancelled", "failed"],
      order_by: [desc: r.updated_at]
    )
    |> Repo.all()
  end

  @spec list_active_bounded(String.t(), String.t()) :: [AgentRunRecord.t()]
  def list_active_bounded(work_id, session_id)
      when is_binary(work_id) and is_binary(session_id) do
    from(r in AgentRunRecord,
      where:
        r.work_id == ^work_id and r.session_id == ^session_id and r.run_mode == "bounded" and
          r.status not in ["completed", "cancelled", "failed"],
      order_by: [desc: r.updated_at]
    )
    |> Repo.all()
  end

  defp normalize_ids(ids) do
    ids
    |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
    |> Enum.uniq()
  end
end
