defmodule NovelDomain.AgentRunPolicy do
  @moduledoc """
  Pure policy value for bounded AgentRun execution.

  It carries limits and tool allow-lists only. Runtime enforcement belongs to
  novel_application; this module only normalizes and checks deterministic values.
  """

  @type t :: %__MODULE__{
          max_steps: pos_integer(),
          max_tool_calls: non_neg_integer(),
          max_provider_calls: non_neg_integer(),
          max_replans: non_neg_integer(),
          max_retries_per_step: non_neg_integer(),
          max_elapsed_ms: pos_integer(),
          max_pending_artifacts: non_neg_integer(),
          no_progress_threshold: pos_integer(),
          allowed_tool_refs: [String.t()],
          allow_bounded_read_batch: boolean(),
          durable_promotion_policy: :disabled | :confirm_required
        }

  defstruct max_steps: 5,
            max_tool_calls: 4,
            max_provider_calls: 3,
            max_replans: 1,
            max_retries_per_step: 1,
            max_elapsed_ms: 120_000,
            max_pending_artifacts: 3,
            no_progress_threshold: 1,
            allowed_tool_refs: [],
            allow_bounded_read_batch: false,
            durable_promotion_policy: :disabled

  @spec new(map() | keyword()) :: {:ok, t()} | {:error, [String.t()]}
  def new(attrs \\ %{}) do
    policy = struct(__MODULE__, normalize(attrs))

    case validate(policy) do
      [] -> {:ok, policy}
      errors -> {:error, errors}
    end
  end

  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = policy) do
    []
    |> require_positive(:max_steps, policy.max_steps)
    |> require_non_negative(:max_tool_calls, policy.max_tool_calls)
    |> require_non_negative(:max_provider_calls, policy.max_provider_calls)
    |> require_non_negative(:max_replans, policy.max_replans)
    |> require_non_negative(:max_retries_per_step, policy.max_retries_per_step)
    |> require_positive(:max_elapsed_ms, policy.max_elapsed_ms)
    |> require_non_negative(:max_pending_artifacts, policy.max_pending_artifacts)
    |> require_positive(:no_progress_threshold, policy.no_progress_threshold)
    |> validate_tools(policy.allowed_tool_refs)
  end

  @spec tool_allowed?(t(), String.t()) :: boolean()
  def tool_allowed?(%__MODULE__{allowed_tool_refs: tools}, tool) when is_binary(tool) do
    tool in tools
  end

  def tool_allowed?(_policy, _tool), do: false

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:allowed_tool_refs, [], &normalize_tools/1)
    |> Map.update(:durable_promotion_policy, :disabled, &normalize_durable_policy/1)
  end

  defp atomize_known(attrs) do
    for {key, value} <- attrs, into: %{} do
      {known_key(key), value}
    end
  end

  defp known_key(key) when is_atom(key), do: key
  defp known_key("max_steps"), do: :max_steps
  defp known_key("max_tool_calls"), do: :max_tool_calls
  defp known_key("max_provider_calls"), do: :max_provider_calls
  defp known_key("max_replans"), do: :max_replans
  defp known_key("max_retries_per_step"), do: :max_retries_per_step
  defp known_key("max_elapsed_ms"), do: :max_elapsed_ms
  defp known_key("max_pending_artifacts"), do: :max_pending_artifacts
  defp known_key("no_progress_threshold"), do: :no_progress_threshold
  defp known_key("allowed_tool_refs"), do: :allowed_tool_refs
  defp known_key("allow_bounded_read_batch"), do: :allow_bounded_read_batch
  defp known_key("durable_promotion_policy"), do: :durable_promotion_policy
  defp known_key(key), do: key

  defp normalize_tools(tools) when is_list(tools) do
    tools
    |> Enum.map(&to_string/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.uniq()
  end

  defp normalize_tools(_tools), do: []

  defp normalize_durable_policy(value) when value in [:disabled, :confirm_required], do: value
  defp normalize_durable_policy("confirm_required"), do: :confirm_required
  defp normalize_durable_policy(_), do: :disabled

  defp require_positive(errors, _field, value) when is_integer(value) and value > 0,
    do: errors

  defp require_positive(errors, field, _value), do: ["#{field} must be positive" | errors]

  defp require_non_negative(errors, _field, value) when is_integer(value) and value >= 0,
    do: errors

  defp require_non_negative(errors, field, _value),
    do: ["#{field} must be non-negative" | errors]

  defp validate_tools(errors, [_ | _]), do: errors
  defp validate_tools(errors, _tools), do: ["allowed_tool_refs must not be empty" | errors]
end
