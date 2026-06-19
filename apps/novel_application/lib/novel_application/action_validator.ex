defmodule NovelApplication.ActionValidator do
  @moduledoc """
  UI action 验证器。拒绝 stale、invented、disabled action。
  UI 只能提交 TurnResult 中给出的 AvailableAction。
  """

  alias NovelDomain.AuthorActionInput

  @doc """
  验证 AuthorActionInput 是否合法。返回 :ok 或 {:error, reason}。
  """
  @spec validate(AuthorActionInput.t(), map()) :: :ok | {:error, String.t()}
  def validate(%AuthorActionInput{} = input, source_turn_result \\ nil) do
    with :ok <- check_required(input),
         :ok <- check_not_stale(input, source_turn_result),
         :ok <- check_action_in_available(input, source_turn_result) do
      check_not_disabled(input, source_turn_result)
    end
  end

  defp check_required(input) do
    if input.action_id && input.action_type && input.source_turn_ref do
      :ok
    else
      {:error, "missing required fields: action_id, action_type, or source_turn_ref"}
    end
  end

  defp check_not_stale(_input, nil), do: {:error, "source_turn_result not available"}

  defp check_not_stale(input, source) do
    source_turn_id = source_field(source, :turn_id)

    if input.source_turn_ref == source_turn_id do
      :ok
    else
      {:error,
       "stale action: source_turn_ref #{input.source_turn_ref} != current #{source_turn_id}"}
    end
  end

  defp check_action_in_available(_input, nil),
    do: {:error, "no available actions to validate against"}

  defp check_action_in_available(input, source) do
    actions = source_field(source, :available_actions) || []

    match =
      Enum.find(
        actions,
        &(action_field(&1, :action_type) == input.action_type &&
            action_field(&1, :action_id) == input.action_id)
      )

    if match do
      check_scoped_refs(input, match)
    else
      {:error,
       "invented action: #{input.action_type}:#{input.action_id} not in available actions"}
    end
  end

  defp check_not_disabled(input, source) do
    actions = source_field(source, :available_actions) || []

    match =
      Enum.find(
        actions,
        &(action_field(&1, :action_type) == input.action_type &&
            action_field(&1, :action_id) == input.action_id)
      )

    if match && action_field(match, :enabled) == false do
      {:error,
       "disabled action: #{action_field(match, :disabled_reason) || "action is not available"}"}
    else
      :ok
    end
  end

  defp check_scoped_refs(input, action) do
    cond do
      ref_mismatch?(input.target_ref, action_field(action, :target_ref)) ->
        {:error, "action scope mismatch: target_ref does not match available action"}

      ref_mismatch?(input.behavior_ref, action_field(action, :behavior_ref)) ->
        {:error, "action scope mismatch: behavior_ref does not match available action"}

      ref_mismatch?(input.candidate_set_ref, action_field(action, :candidate_set_ref)) ->
        {:error, "action scope mismatch: candidate_set_ref does not match available action"}

      ref_mismatch?(input.candidate_ref, action_field(action, :candidate_ref)) ->
        {:error, "action scope mismatch: candidate_ref does not match available action"}

      ref_mismatch?(input.idempotency_key, action_field(action, :idempotency_key)) ->
        {:error, "action scope mismatch: idempotency_key does not match available action"}

      true ->
        :ok
    end
  end

  defp ref_mismatch?(actual, expected), do: normalize_ref(actual) != normalize_ref(expected)

  defp normalize_ref(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp normalize_ref(value), do: value

  defp action_field(action, key) do
    string_key = Atom.to_string(key)

    cond do
      Map.has_key?(action, key) -> Map.get(action, key)
      Map.has_key?(action, string_key) -> Map.get(action, string_key)
      true -> nil
    end
  end

  defp source_field(source, key) when is_map(source), do: action_field(source, key)
  defp source_field(_source, _key), do: nil
end
