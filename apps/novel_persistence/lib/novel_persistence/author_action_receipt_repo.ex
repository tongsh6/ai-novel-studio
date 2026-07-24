defmodule NovelPersistence.AuthorActionReceiptRepo do
  @moduledoc """
  Repository for author action idempotency receipts.
  """

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.AuthorActionReceipt

  @key_fields [
    :work_id,
    :session_id,
    :source_turn_ref,
    :action_id,
    :action_type,
    :idempotency_key
  ]

  @spec get(map()) :: AuthorActionReceipt.t() | nil
  def get(attrs) when is_map(attrs) do
    attrs
    |> normalize_key_attrs()
    |> then(&Repo.get_by(AuthorActionReceipt, &1))
  end

  @spec record(map(), map()) :: {:ok, AuthorActionReceipt.t()} | {:error, Ecto.Changeset.t()}
  def record(key_attrs, result) when is_map(key_attrs) and is_map(result) do
    attrs =
      key_attrs
      |> normalize_key_attrs()
      |> Map.put(:status, to_string(result[:status] || result["status"] || "accepted"))
      |> Map.put(:result, stringify_result(result))

    %AuthorActionReceipt{}
    |> AuthorActionReceipt.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, receipt} ->
        {:ok, receipt}

      {:error, changeset} ->
        if duplicate_receipt?(changeset) do
          {:ok, get(key_attrs)}
        else
          {:error, changeset}
        end
    end
  end

  @spec entry_from_record(AuthorActionReceipt.t()) :: map()
  def entry_from_record(%AuthorActionReceipt{} = receipt) do
    %{
      action_id: receipt.action_id,
      action_type: receipt.action_type,
      source_turn_ref: receipt.source_turn_ref,
      idempotency_key: receipt.idempotency_key,
      result: atomize_result(receipt.result || %{})
    }
  end

  defp normalize_key_attrs(attrs) do
    attrs
    |> Map.take(@key_fields)
    |> Map.update(:session_id, "__none__", &(&1 || "__none__"))
  end

  defp duplicate_receipt?(changeset) do
    Enum.any?(changeset.errors, fn
      {:work_id, {_message, opts}} ->
        opts[:constraint] == :unique

      {_field, {_message, opts}} ->
        opts[:constraint_name] == "author_action_receipts_idempotency_key_index"
    end)
  end

  defp stringify_result(result) do
    Map.new(result, fn
      {key, value} when is_atom(key) -> {Atom.to_string(key), value}
      {key, value} -> {key, value}
    end)
  end

  defp atomize_result(result) do
    Map.new(result, fn
      {"action_id", value} -> {:action_id, value}
      {"action_type", value} -> {:action_type, value}
      {"status", value} -> {:status, value}
      {"idempotency_key", value} -> {:idempotency_key, value}
      {"duplicate", value} -> {:duplicate, value}
      {"receipt_id", value} -> {:receipt_id, value}
      {"run_id", value} -> {:run_id, value}
      {"run_mode", value} -> {:run_mode, value}
      {"long_run_task_ref", value} -> {:long_run_task_ref, value}
      {"turn_id", value} -> {:turn_id, value}
      {"source_turn_ref", value} -> {:source_turn_ref, value}
      {"source_surface_ref", value} -> {:source_surface_ref, value}
      {"target_artifact_ref", value} -> {:target_artifact_ref, value}
      {"profile_ref", value} -> {:profile_ref, value}
      {"goal", value} -> {:goal, value}
      {"trigger", value} -> {:trigger, value}
      {key, value} -> {key, value}
    end)
  end
end
