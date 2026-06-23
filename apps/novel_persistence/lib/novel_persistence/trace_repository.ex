defmodule NovelPersistence.TraceRepository do
  @moduledoc """
  Persistence operations for DecisionTrace records.

  Callers in novel_web pass function references into novel_application,
  preserving the umbrella dependency direction.
  """

  import Ecto.Query, only: [from: 2]

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.DecisionTraceRecord

  @doc "Insert a DecisionTrace record. Returns {:ok, record} or {:error, changeset}."
  @spec insert(map()) :: {:ok, struct()} | {:error, Ecto.Changeset.t()}
  def insert(attrs) when is_map(attrs) do
    %DecisionTraceRecord{}
    |> DecisionTraceRecord.changeset(attrs)
    |> Repo.insert()
  end

  @doc "List traces for a workspace, newest first."
  @spec list_by_workspace(String.t(), pos_integer()) :: [struct()]
  def list_by_workspace(workspace_id, limit \\ 50) do
    from(t in DecisionTraceRecord,
      where: t.workspace_id == ^workspace_id,
      order_by: [desc: t.inserted_at],
      limit: ^limit
    )
    |> Repo.all()
  end

  @doc "Get a trace by its trace_id."
  @spec get_by_trace_id(String.t()) :: struct() | nil
  def get_by_trace_id(trace_id) do
    Repo.get_by(DecisionTraceRecord, trace_id: trace_id)
  end

  @doc "List traces for a specific turn."
  @spec list_by_turn(String.t()) :: [struct()]
  def list_by_turn(turn_id) do
    from(t in DecisionTraceRecord, where: t.turn_id == ^turn_id)
    |> Repo.all()
  end

  @doc "List traces for a specific work/session/turn scope, newest first."
  @spec list_by_scope(String.t(), String.t(), String.t()) :: [struct()]
  def list_by_scope(workspace_id, session_id, turn_id)
      when is_binary(workspace_id) and is_binary(session_id) and is_binary(turn_id) do
    from(t in DecisionTraceRecord,
      where:
        t.workspace_id == ^workspace_id and t.session_id == ^session_id and
          t.turn_id == ^turn_id,
      order_by: [desc: t.inserted_at]
    )
    |> Repo.all()
  end

  @doc """
  Build a persister callback suitable for injection into DialogueGateway.

  Returns a function `(attrs -> :ok | {:error, term})` that can be passed
  as the trace_persister callback.
  """
  @spec persister_callback() :: function()
  def persister_callback do
    fn attrs ->
      case insert(attrs) do
        {:ok, _record} -> :ok
        {:error, changeset} -> {:error, changeset}
      end
    end
  end
end
