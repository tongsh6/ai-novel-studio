defmodule NovelPersistence.AuthorActionReceiptRepo do
  @moduledoc """
  Repository for author action idempotency receipts.
  """

  alias NovelPersistence.Repo
  import Ecto.Query

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

  @doc """
  原子受理的严格插入：唯一冲突不返回既有 receipt，而是明确 `:duplicate`。

  调用方必须自行区分同语义回放与异语义冲突；该接口不更新既有行，也不把
  异 payload 吞成成功。普通作者动作仍沿用 `record/2` 的兼容语义。
  """
  @spec insert_strict(map(), map()) ::
          {:ok, AuthorActionReceipt.t()}
          | {:error, :duplicate | :behavior_consumed | Ecto.Changeset.t()}
  def insert_strict(key_attrs, result) when is_map(key_attrs) and is_map(result) do
    attrs =
      key_attrs
      |> normalize_key_attrs()
      |> put_receipt_id(key_attrs)
      |> put_behavior_ref(key_attrs)
      |> Map.put(:status, to_string(result[:status] || result["status"] || "accepted"))
      |> Map.put(:result, stringify_result(result))

    %AuthorActionReceipt{}
    |> AuthorActionReceipt.changeset(attrs)
    |> Repo.insert()
    |> case do
      {:ok, receipt} ->
        {:ok, receipt}

      {:error, changeset} ->
        classify_insert_error(changeset)
    end
  end

  defp classify_insert_error(changeset) do
    cond do
      behavior_consumed?(changeset) -> {:error, :behavior_consumed}
      duplicate_receipt?(changeset) -> {:error, :duplicate}
      true -> {:error, changeset}
    end
  end

  defp put_behavior_ref(attrs, key_attrs) do
    case Map.get(key_attrs, :behavior_ref) || Map.get(key_attrs, "behavior_ref") do
      nil -> attrs
      behavior_ref -> Map.put(attrs, :behavior_ref, behavior_ref)
    end
  end

  defp put_receipt_id(attrs, key_attrs) do
    case Map.get(key_attrs, :id) || Map.get(key_attrs, "id") do
      nil -> attrs
      id -> Map.put(attrs, :id, id)
    end
  end

  @doc "按 work+session+behavior 读取唯一消费该行为的 receipt。"
  @spec get_by_behavior(String.t(), String.t() | nil, String.t()) ::
          AuthorActionReceipt.t() | nil
  def get_by_behavior(work_id, session_id, behavior_ref)
      when is_binary(work_id) and is_binary(behavior_ref) do
    AuthorActionReceipt
    |> where(
      [r],
      r.work_id == ^work_id and r.session_id == ^(session_id || "__none__") and
        r.behavior_ref == ^behavior_ref
    )
    |> Repo.one()
  end

  @doc "B58 CP3：按 work+session+source_turn 读取批准记录（why/replay 的 author-safe 来源）。"
  @spec list_by_source_turn(String.t(), String.t(), String.t()) :: [AuthorActionReceipt.t()]
  def list_by_source_turn(work_id, session_id, source_turn_ref)
      when is_binary(work_id) and is_binary(source_turn_ref) do
    AuthorActionReceipt
    |> where([r], r.work_id == ^work_id and r.source_turn_ref == ^source_turn_ref)
    |> maybe_filter_session(session_id)
    |> order_by([r], asc: r.inserted_at, asc: r.id)
    |> Repo.all()
  end

  defp maybe_filter_session(query, session_id) when is_binary(session_id),
    do: where(query, [r], r.session_id == ^session_id)

  defp maybe_filter_session(query, _session_id), do: query

  @spec entry_from_record(AuthorActionReceipt.t()) :: map()
  def entry_from_record(%AuthorActionReceipt{} = receipt) do
    %{
      action_id: receipt.action_id,
      action_type: receipt.action_type,
      source_turn_ref: receipt.source_turn_ref,
      idempotency_key: receipt.idempotency_key,
      behavior_ref: receipt.behavior_ref,
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

  defp behavior_consumed?(changeset) do
    Enum.any?(changeset.errors, fn
      {:behavior_ref, {_message, opts}} ->
        opts[:constraint_name] == "author_action_receipts_behavior_ref_index"

      {_field, {_message, opts}} ->
        opts[:constraint_name] == "author_action_receipts_behavior_ref_index"
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
      {"behavior_ref", value} -> {:behavior_ref, value}
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
