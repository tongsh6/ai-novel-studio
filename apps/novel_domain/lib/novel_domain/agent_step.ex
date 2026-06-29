defmodule NovelDomain.AgentStep do
  @moduledoc """
  Single executable step inside an AgentRun.

  The step stores refs to the MicroPlan, OrchestratorDecision, ToolRequest and
  ToolResult that proved the step. It does not embed a multi-action plan.
  """

  @type status :: :proposed | :running | :completed | :failed | :cancelled | :skipped

  @type t :: %__MODULE__{
          step_id: String.t(),
          run_ref: String.t(),
          sequence: pos_integer(),
          status: status(),
          goal: String.t(),
          micro_plan_ref: String.t() | nil,
          decision_ref: String.t() | nil,
          tool_request_ref: String.t() | nil,
          tool_result_ref: String.t() | nil,
          observation_refs: [String.t()],
          state_snapshot_ref: String.t() | nil,
          attempt: pos_integer(),
          idempotency_key: String.t(),
          started_at: String.t() | nil,
          completed_at: String.t() | nil,
          failure_ref: String.t() | nil
        }

  @enforce_keys [:step_id, :run_ref, :sequence, :goal, :idempotency_key]
  defstruct [
    :step_id,
    :run_ref,
    :sequence,
    :goal,
    :micro_plan_ref,
    :decision_ref,
    :tool_request_ref,
    :tool_result_ref,
    :state_snapshot_ref,
    :started_at,
    :completed_at,
    :failure_ref,
    status: :proposed,
    observation_refs: [],
    attempt: 1,
    idempotency_key: nil
  ]

  @spec new(map() | keyword()) :: {:ok, t()} | {:error, [String.t()]}
  def new(attrs) do
    step = struct(__MODULE__, normalize(attrs))

    case validate(step) do
      [] -> {:ok, step}
      errors -> {:error, errors}
    end
  end

  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = step) do
    []
    |> require_present(:step_id, step.step_id)
    |> require_present(:run_ref, step.run_ref)
    |> require_present(:goal, step.goal)
    |> require_present(:idempotency_key, step.idempotency_key)
    |> require_positive(:sequence, step.sequence)
    |> require_positive(:attempt, step.attempt)
    |> validate_status(step.status)
  end

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:status, :proposed, &normalize_status/1)
    |> Map.update(:observation_refs, [], &normalize_refs/1)
    |> Map.update(:attempt, 1, &positive_int/1)
  end

  defp atomize_known(attrs),
    do: for({key, value} <- attrs, into: %{}, do: {known_key(key), value})

  defp known_key(key) when is_atom(key), do: key
  defp known_key("step_id"), do: :step_id
  defp known_key("run_ref"), do: :run_ref
  defp known_key("sequence"), do: :sequence
  defp known_key("status"), do: :status
  defp known_key("goal"), do: :goal
  defp known_key("micro_plan_ref"), do: :micro_plan_ref
  defp known_key("decision_ref"), do: :decision_ref
  defp known_key("tool_request_ref"), do: :tool_request_ref
  defp known_key("tool_result_ref"), do: :tool_result_ref
  defp known_key("observation_refs"), do: :observation_refs
  defp known_key("state_snapshot_ref"), do: :state_snapshot_ref
  defp known_key("attempt"), do: :attempt
  defp known_key("idempotency_key"), do: :idempotency_key
  defp known_key("started_at"), do: :started_at
  defp known_key("completed_at"), do: :completed_at
  defp known_key("failure_ref"), do: :failure_ref
  defp known_key(key), do: key

  defp normalize_status(value)
       when value in [:proposed, :running, :completed, :failed, :cancelled, :skipped], do: value

  defp normalize_status("running"), do: :running
  defp normalize_status("completed"), do: :completed
  defp normalize_status("failed"), do: :failed
  defp normalize_status("cancelled"), do: :cancelled
  defp normalize_status("skipped"), do: :skipped
  defp normalize_status(_), do: :proposed

  defp normalize_refs(refs) when is_list(refs),
    do: refs |> Enum.map(&to_string/1) |> Enum.reject(&(&1 == ""))

  defp normalize_refs(_), do: []

  defp positive_int(value) when is_integer(value) and value > 0, do: value
  defp positive_int(_), do: 1

  defp require_present(errors, _field, value) when is_binary(value) and value != "", do: errors
  defp require_present(errors, field, _value), do: ["#{field} is required" | errors]

  defp require_positive(errors, _field, value) when is_integer(value) and value > 0, do: errors
  defp require_positive(errors, field, _value), do: ["#{field} must be positive" | errors]

  defp validate_status(errors, status)
       when status in [:proposed, :running, :completed, :failed, :cancelled, :skipped],
       do: errors

  defp validate_status(errors, _status), do: ["status is invalid" | errors]
end
