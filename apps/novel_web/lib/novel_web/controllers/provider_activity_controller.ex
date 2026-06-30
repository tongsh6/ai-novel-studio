defmodule NovelWeb.ProviderActivityController do
  @moduledoc """
  Author-safe ProviderRun activity API.
  """

  use Phoenix.Controller, formats: [:json]

  alias NovelApplication.ProviderActivityService

  def show(conn, %{"work_id" => work_id, "session_id" => session_id, "turn_id" => turn_id}) do
    case ProviderActivityService.fetch_turn_activity(work_id, session_id, turn_id) do
      {:ok, activity} ->
        json(conn, activity)

      {:error, :work_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "work_not_found", work_id: work_id})

      {:error, :session_not_found} ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "session_not_found", work_id: work_id, session_id: session_id})
    end
  end
end
