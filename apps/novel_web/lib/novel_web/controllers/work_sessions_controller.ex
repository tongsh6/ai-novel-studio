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

    json(conn, %{
      sessions: Enum.map(WorkSessionService.search(work_id, query), &serialize_session/1)
    })
  end

  def show(conn, %{"work_id" => work_id, "id" => session_id}) do
    t0 = System.monotonic_time(:millisecond)

    case WorkSessionService.show(work_id, session_id) do
      {:ok, snapshot} ->
        LogEmit.emit(:work_session, :show, :done, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          session_id: session_id,
          read_only: snapshot.read_only,
          transcript_count: length(snapshot.transcript),
          pending_adoption_count: length(snapshot.pending_adoptions)
        })

        json(conn, serialize_session_snapshot(snapshot))

      {:error, reason} when reason in [:work_not_found, :session_not_found] ->
        LogEmit.emit(:work_session, :show, :error, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          session_id: session_id,
          reason_code: reason
        })

        conn
        |> put_status(:not_found)
        |> json(%{error: Atom.to_string(reason), work_id: work_id, session_id: session_id})
    end
  end

  def create(conn, %{"work_id" => work_id} = params) do
    t0 = System.monotonic_time(:millisecond)
    attrs = Map.take(params, ["title", "summary", "source_session_ref", "source_turn_ref"])

    case WorkSessionService.create(work_id, attrs) do
      {:ok, session} ->
        LogEmit.emit(:work_session, :create, :done, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          session_id: session.id,
          source_session_ref: session.source_session_ref,
          source_turn_ref: session.source_turn_ref
        })

        conn
        |> put_status(:created)
        |> json(%{session: serialize_session(session)})

      {:error, :work_not_found} ->
        LogEmit.emit(:work_session, :create, :error, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          reason_code: :work_not_found
        })

        conn
        |> put_status(:not_found)
        |> json(%{error: "work_not_found", work_id: work_id})

      {:error, %Ecto.Changeset{} = changeset} ->
        LogEmit.emit(:work_session, :create, :error, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          reason_code: :invalid_session,
          outcome_detail: inspect(changeset.errors)
        })

        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: changeset_errors(changeset)})
    end
  end

  def archive(conn, %{"work_id" => work_id, "id" => session_id}) do
    t0 = System.monotonic_time(:millisecond)

    case WorkSessionService.archive(work_id, session_id) do
      {:ok, session} ->
        LogEmit.emit(:work_session, :archive, :done, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          session_id: session.id,
          status: session.status
        })

        json(conn, %{session: serialize_session(session)})

      {:error, reason} when reason in [:work_not_found, :session_not_found] ->
        LogEmit.emit(:work_session, :archive, :error, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          session_id: session_id,
          reason_code: reason
        })

        conn
        |> put_status(:not_found)
        |> json(%{error: Atom.to_string(reason), work_id: work_id, session_id: session_id})

      {:error, :cannot_archive_active_session} ->
        LogEmit.emit(:work_session, :archive, :error, %{
          duration_ms: System.monotonic_time(:millisecond) - t0,
          work_id: work_id,
          session_id: session_id,
          reason_code: :cannot_archive_active_session
        })

        conn
        |> put_status(:unprocessable_entity)
        |> json(%{
          error: "cannot_archive_active_session",
          work_id: work_id,
          session_id: session_id
        })
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

  defp serialize_session_snapshot(snapshot) do
    %{
      work: serialize_work(snapshot.work),
      session: serialize_session(snapshot.session),
      read_only: snapshot.read_only,
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
