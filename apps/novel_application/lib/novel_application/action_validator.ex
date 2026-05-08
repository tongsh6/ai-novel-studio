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
    if input.source_turn_ref == source[:turn_id] do
      :ok
    else
      {:error, "stale action: source_turn_ref #{input.source_turn_ref} != current #{source[:turn_id]}"}
    end
  end

  defp check_action_in_available(_input, nil), do: {:error, "no available actions to validate against"}
  defp check_action_in_available(input, source) do
    actions = source[:available_actions] || []
    match = Enum.find(actions, &(&1[:action_type] == input.action_type && &1[:action_id] == input.action_id))
    if match do
      :ok
    else
      {:error, "invented action: #{input.action_type}:#{input.action_id} not in available actions"}
    end
  end

  defp check_not_disabled(input, source) do
    actions = source[:available_actions] || []
    match = Enum.find(actions, &(&1[:action_type] == input.action_type && &1[:action_id] == input.action_id))
    if match && match[:enabled] == false do
      {:error, "disabled action: #{match[:disabled_reason] || "action is not available"}"}
    else
      :ok
    end
  end
end
