defmodule NovelWeb.TraceReplayController do
  @moduledoc """
  Author-safe replay reports for persisted turn traces.
  """

  use Phoenix.Controller, formats: [:json]

  alias NovelApplication.TraceReplayService

  def show(conn, %{"work_id" => work_id, "session_id" => session_id, "turn_id" => turn_id}) do
    case TraceReplayService.fetch_turn_report(work_id, session_id, turn_id) do
      {:ok, report} ->
        json(conn, report)

      {:error, :work_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "work_not_found", work_id: work_id})

      {:error, :session_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "session_not_found", work_id: work_id, session_id: session_id})

      {:error, :trace_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{
          error: "trace_not_found",
          work_id: work_id,
          session_id: session_id,
          turn_id: turn_id
        })
    end
  end
end
