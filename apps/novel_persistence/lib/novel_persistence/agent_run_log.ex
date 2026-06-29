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
end
