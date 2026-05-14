defmodule NovelWeb.WorkSessionsController do
  @moduledoc """
  作品内会话 HTTP 入口。只调用 `NovelApplication.WorkSessionService`。
  """

  use Phoenix.Controller, formats: [:json]

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelApplication.WorkSessionService

  def resume(conn, %{"work_id" => work_id}) do
    t0 = System.monotonic_time(:millisecond)

    case WorkSessionService.resume(work_id) do
      {:ok, snapshot} ->
        LogEmit.emit(:work_session, :resume, :done, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          session_id: snapshot.active_session.id,
          transcript_count: length(snapshot.transcript),
          pending_adoption_count: length(snapshot.pending_adoptions)
        })

        json(conn, serialize_snapshot(snapshot))

      {:error, :work_not_found} ->
        LogEmit.emit(:work_session, :resume, :error, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          reason_code: :work_not_found
        })

        conn
        |> put_status(:not_found)
        |> json(%{error: "work_not_found", work_id: work_id})

      {:error, reason} ->
        LogEmit.emit(:work_session, :resume, :error, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          reason_code: :resume_failed,
          outcome_detail: inspect(reason)
        })

        conn
        |> put_status(:unprocessable_entity)
        |> json(%{error: inspect(reason)})
    end
  end

  def index(conn, %{"work_id" => work_id} = params) do
    query = Map.get(params, "query", "")
    json(conn, %{sessions: Enum.map(WorkSessionService.search(work_id, query), &serialize_session/1)})
  end

  def create(conn, %{"work_id" => work_id} = params) do
    attrs = Map.take(params, ["title", "summary", "source_session_ref", "source_turn_ref"])

    case WorkSessionService.create(work_id, attrs) do
      {:ok, session} ->
        conn
        |> put_status(:created)
        |> json(%{session: serialize_session(session)})

      {:error, %Ecto.Changeset{} = changeset} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: changeset_errors(changeset)})
    end
  end

  defp serialize_snapshot(snapshot) do
    %{
      work: serialize_work(snapshot.work),
      active_session: serialize_session(snapshot.active_session),
      sessions: Enum.map(snapshot.sessions, &serialize_session/1),
      transcript: Enum.map(snapshot.transcript, &serialize_interaction/1),
      pending_adoptions: snapshot.pending_adoptions,
      resolved_adoptions: snapshot.resolved_adoptions,
      resume_trace_refs: snapshot.resume_trace_refs
    }
  end

  defp serialize_work(work) do
    %{
      id: work.id,
      title: work.title,
      genre: work.genre,
      status: work.status,
      updated_at: iso(work.updated_at),
      inserted_at: iso(work.inserted_at)
    }
  end

  defp serialize_session(session) do
    %{
      id: session.id,
      work_id: session.work_id,
      title: session.title,
      summary: session.summary,
      status: session.status,
      source_session_ref: session.source_session_ref,
      source_turn_ref: session.source_turn_ref,
      last_opened_at: iso(session.last_opened_at),
      updated_at: iso(session.updated_at),
      inserted_at: iso(session.inserted_at)
    }
  end

  defp serialize_interaction(interaction) do
    %{
      id: interaction.id,
      session_id: interaction.session_id,
      turn_id: interaction.turn_id,
      role: interaction.role,
      text: interaction.text,
      turn_result: interaction.turn_result,
      inserted_at: iso(interaction.inserted_at)
    }
  end

  defp iso(%DateTime{} = datetime), do: DateTime.to_iso8601(datetime)
  defp iso(nil), do: nil

  defp changeset_errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
