defmodule NovelWeb.WorksController do
  @moduledoc """
  HTTP entry for VS-09 Work Management. Talks to `NovelApplication.WorkService`
  only — never reaches into `NovelPersistence` directly (per AGENTS.md
  umbrella boundary).
  """

  use Phoenix.Controller, formats: [:json]

  alias NovelApplication.WorkService

  @doc "GET /api/works — list all works newest-first."
  def index(conn, _params) do
    json(conn, %{works: Enum.map(WorkService.list(), &serialize/1)})
  end

  @doc "POST /api/works — create a new work seed (default tentative)."
  def create(conn, params) do
    attrs =
      Map.take(params, [
        "title",
        "genre",
        "core_selling_point",
        "target_reader",
        "tone_preference"
      ])

    case WorkService.create(attrs) do
      {:ok, work} ->
        conn
        |> put_status(:created)
        |> json(%{work: serialize(work)})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: changeset_errors(cs)})
    end
  end

  @doc "PATCH /api/works/:id — rename a work."
  def update(conn, %{"id" => id} = params) do
    attrs = Map.take(params, ["title", "revision"])

    case WorkService.rename(id, attrs) do
      {:ok, work} ->
        json(conn, %{work: serialize(work)})

      :not_found ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "work_not_found", id: id})

      {:error, :revision_conflict} ->
        conn
        |> put_status(:conflict)
        |> json(%{error: "revision_conflict", id: id})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: changeset_errors(cs)})
    end
  end

  @doc "POST /api/works/:id/discard — safely move a work out of the default list."
  def discard(conn, %{"id" => id} = params) do
    attrs = Map.take(params, ["revision"])

    case WorkService.discard(id, attrs) do
      {:ok, work} ->
        json(conn, %{work: serialize(work)})

      :not_found ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "work_not_found", id: id})

      {:error, :revision_conflict} ->
        conn
        |> put_status(:conflict)
        |> json(%{error: "revision_conflict", id: id})

      {:error, %Ecto.Changeset{} = cs} ->
        conn
        |> put_status(:unprocessable_entity)
        |> json(%{errors: changeset_errors(cs)})
    end
  end

  @doc "GET /api/works/:id — fetch a single work."
  def show(conn, %{"id" => id}) do
    case WorkService.get(id) do
      nil ->
        conn
        |> put_status(:not_found)
        |> json(%{error: "work_not_found", id: id})

      work ->
        json(conn, %{work: serialize(work)})
    end
  end

  defp serialize(work) do
    %{
      id: work.id,
      title: work.title,
      genre: work.genre,
      status: work.status,
      revision: work.revision,
      updated_at: work.updated_at && DateTime.to_iso8601(work.updated_at),
      inserted_at: work.inserted_at && DateTime.to_iso8601(work.inserted_at)
    }
  end

  defp changeset_errors(%Ecto.Changeset{} = cs) do
    Ecto.Changeset.traverse_errors(cs, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {k, v}, acc -> String.replace(acc, "%{#{k}}", to_string(v)) end)
    end)
  end
end
