defmodule NovelWeb.MemoriesController do
  @moduledoc """
  HTTP entry for AU-09 governed memory management.

  The controller only calls `NovelApplication.MemoryManagementService`; it does
  not know about persistence schemas or Repo.
  """

  use Phoenix.Controller, formats: [:json]

  alias NovelApplication.MemoryManagementService

  def index(conn, %{"work_id" => work_id} = params) do
    case MemoryManagementService.list(work_id, Map.delete(params, "work_id")) do
      {:ok, %{items: items, count: count}} ->
        json(conn, %{ok: true, data: items, count: count})

      {:error, reason} ->
        error(conn, reason)
    end
  end

  def create(conn, %{"work_id" => work_id} = params) do
    case MemoryManagementService.create(work_id, Map.delete(params, "work_id")) do
      {:ok, item} ->
        conn
        |> put_status(:created)
        |> json(%{ok: true, data: item})

      {:error, reason} ->
        error(conn, reason)
    end
  end

  def show(conn, %{"work_id" => work_id, "id" => id}) do
    case MemoryManagementService.get(work_id, id) do
      {:ok, item} -> json(conn, %{ok: true, data: item})
      {:error, reason} -> error(conn, reason)
    end
  end

  def confirm(conn, %{"work_id" => work_id, "id" => id}) do
    action_result(conn, MemoryManagementService.confirm(work_id, id))
  end

  def lock(conn, %{"work_id" => work_id, "id" => id}) do
    action_result(conn, MemoryManagementService.lock(work_id, id))
  end

  def unlock(conn, %{"work_id" => work_id, "id" => id}) do
    action_result(conn, MemoryManagementService.unlock(work_id, id))
  end

  def deprecate(conn, %{"work_id" => work_id, "id" => id}) do
    action_result(conn, MemoryManagementService.deprecate(work_id, id))
  end

  def archive(conn, %{"work_id" => work_id, "id" => id}) do
    action_result(conn, MemoryManagementService.archive(work_id, id))
  end

  def update_weight(conn, %{"work_id" => work_id, "id" => id, "weight" => weight}) do
    action_result(conn, MemoryManagementService.update_weight(work_id, id, weight))
  end

  def update_validity(conn, %{"work_id" => work_id, "id" => id} = params) do
    attrs = Map.take(params, ["valid_from", "valid_until", "expire_condition"])
    action_result(conn, MemoryManagementService.update_validity(work_id, id, attrs))
  end

  def recall(conn, %{"work_id" => work_id} = params) do
    case MemoryManagementService.recall(work_id, params) do
      {:ok, result} -> json(conn, %{ok: true, data: result})
      {:error, reason} -> error(conn, reason)
    end
  end

  def references(conn, %{"work_id" => work_id, "id" => id}) do
    case MemoryManagementService.references(work_id, id) do
      {:ok, records} -> json(conn, %{ok: true, data: records, count: length(records)})
      {:error, reason} -> error(conn, reason)
    end
  end

  defp action_result(conn, {:ok, item}), do: json(conn, %{ok: true, data: item})
  defp action_result(conn, {:error, reason}), do: error(conn, reason)

  defp error(conn, :work_not_found) do
    conn
    |> put_status(:not_found)
    |> json(%{ok: false, error: "work_not_found"})
  end

  defp error(conn, :not_found) do
    conn
    |> put_status(:not_found)
    |> json(%{ok: false, error: "memory_not_found"})
  end

  defp error(conn, %Ecto.Changeset{} = changeset) do
    conn
    |> put_status(:unprocessable_entity)
    |> json(%{ok: false, error: "validation_failed", errors: changeset_errors(changeset)})
  end

  defp changeset_errors(%Ecto.Changeset{} = changeset) do
    Ecto.Changeset.traverse_errors(changeset, fn {msg, opts} ->
      Enum.reduce(opts, msg, fn {key, value}, acc ->
        String.replace(acc, "%{#{key}}", to_string(value))
      end)
    end)
  end
end
