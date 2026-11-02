defmodule NovelApplication.ActionIdempotencyLedger do
  @moduledoc """
  Pure ledger helpers for author action idempotency.

  The owning process keeps the ledger state. This module only defines the
  stable key and record/update semantics so Channel code does not invent them.
  """

  alias NovelDomain.AuthorActionInput

  @type scope :: %{
          optional(:work_id) => String.t() | nil,
          optional(:session_id) => String.t() | nil
        }
  @type entry :: %{
          action_id: String.t() | nil,
          action_type: String.t() | nil,
          source_turn_ref: String.t() | nil,
          idempotency_key: String.t(),
          payload_digest: String.t() | nil,
          result: map()
        }
  @type t :: %{optional(tuple()) => entry()}

  @doc """
  Returns a previously recorded action result when the input is a duplicate.

  Actions without an idempotency key are intentionally not deduplicated here:
  without a client/server key, action identity can be ambiguous across turns.
  """
  @spec lookup(t() | nil, AuthorActionInput.t(), scope()) ::
          {:duplicate, entry()} | {:conflict, entry()} | :miss
  def lookup(ledger, %AuthorActionInput{} = input, scope \\ %{}) do
    with {:ok, key} <- ledger_key(input, scope),
         entry when is_map(entry) <- Map.get(ledger || %{}, key) do
      # B43 CP1：同 key 同 payload 才回放；异 payload 必须明确拒绝，不能当 duplicate。
      digest = payload_digest(input)

      case entry.payload_digest do
        nil -> {:duplicate, entry}
        ^digest -> {:duplicate, entry}
        _other -> {:conflict, entry}
      end
    else
      _ -> :miss
    end
  end

  @doc "作者动作 payload 的确定性摘要（用于同 key 异 payload 判定）。"
  @spec payload_digest(AuthorActionInput.t()) :: String.t()
  def payload_digest(%AuthorActionInput{payload: payload}) when is_map(payload) do
    payload
    |> normalize_digest_value()
    |> :erlang.term_to_binary([:deterministic])
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end

  @doc """
  完整作者动作语义摘要（version 2）：payload、target、behavior、candidate 等。

  `input_id` 是每次重传重新分配的投递身份，必须排除，否则同一次动作永远无法
  回放。key 已包含 work/session/source/action/type/client key，这里只补 key 之外
  会影响动作语义的字段。
  """
  @spec action_semantic_digest(AuthorActionInput.t()) :: String.t()
  def action_semantic_digest(%AuthorActionInput{} = input) do
    %{
      "payload" => normalize_digest_value(input.payload || %{}),
      "target_ref" => normalize_ref(input.target_ref),
      "behavior_ref" => normalize_ref(input.behavior_ref),
      "candidate_set_ref" => normalize_ref(input.candidate_set_ref),
      "candidate_ref" => normalize_ref(input.candidate_ref)
    }
    |> :erlang.term_to_binary([:deterministic])
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end

  @action_semantic_version 2

  @doc "动作语义版本；新受理记录与旧 payload-only 摘要明确分开。"
  @spec action_semantic_version() :: 2
  def action_semantic_version, do: @action_semantic_version

  @doc """
  解析 receipt 的受理版本。

  - `:legacy`：字段完全缺失，只能按旧 payload-only 历史边界回放；
  - `{:supported, version}`：字段存在且是当前支持版本；
  - `{:unsupported, version}`：字段存在但不是当前支持版本（含 nil/非法值），
    调用方必须失败闭合，不能降级成 legacy 继续接受。
  """
  @spec admission_version(map()) :: :legacy | {:supported, pos_integer()} | {:unsupported, term()}
  def admission_version(result) when is_map(result) do
    cond do
      Map.has_key?(result, :admission_version) ->
        classify_admission_version(Map.get(result, :admission_version))

      Map.has_key?(result, "admission_version") ->
        classify_admission_version(Map.get(result, "admission_version"))

      true ->
        :legacy
    end
  end

  defp classify_admission_version(version)
       when version == @action_semantic_version,
       do: {:supported, version}

  defp classify_admission_version(version), do: {:unsupported, version}

  defp normalize_ref(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_ref(value), do: value

  defp normalize_digest_value(value) when is_map(value) do
    value
    |> Enum.map(fn {key, val} -> {to_string(key), normalize_digest_value(val)} end)
    |> Enum.sort_by(&elem(&1, 0))
  end

  defp normalize_digest_value(value) when is_list(value),
    do: Enum.map(value, &normalize_digest_value/1)

  defp normalize_digest_value(value), do: value

  @doc """
  Records a successful action result for later duplicate suppression.
  """
  @spec record(t() | nil, AuthorActionInput.t(), scope(), map()) :: t()
  def record(ledger, %AuthorActionInput{} = input, scope \\ %{}, result) when is_map(result) do
    case ledger_key(input, scope) do
      {:ok, key} ->
        Map.put(ledger || %{}, key, %{
          action_id: input.action_id,
          action_type: input.action_type,
          source_turn_ref: input.source_turn_ref,
          idempotency_key: input.idempotency_key,
          payload_digest: payload_digest(input),
          result: result
        })

      :skip ->
        ledger || %{}
    end
  end

  @doc "Builds persistence-friendly key attributes for an idempotent action."
  @spec key_attrs(AuthorActionInput.t(), scope()) :: {:ok, map()} | :skip
  def key_attrs(%AuthorActionInput{idempotency_key: key}, _scope) when key in [nil, ""],
    do: :skip

  def key_attrs(%AuthorActionInput{} = input, scope) do
    {:ok,
     %{
       work_id: scope[:work_id],
       session_id: scope[:session_id],
       source_turn_ref: input.source_turn_ref,
       action_id: input.action_id,
       action_type: input.action_type,
       idempotency_key: input.idempotency_key
     }}
  end

  defp ledger_key(%AuthorActionInput{} = input, scope) do
    case key_attrs(input, scope) do
      {:ok, attrs} ->
        {:ok,
         {
           attrs.work_id,
           attrs.session_id,
           attrs.source_turn_ref,
           attrs.action_id,
           attrs.action_type,
           attrs.idempotency_key
         }}

      :skip ->
        :skip
    end
  end
end
