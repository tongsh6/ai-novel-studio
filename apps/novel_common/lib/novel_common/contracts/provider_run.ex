defmodule NovelCommon.Contracts.ProviderRun do
  @moduledoc """
  Pure contract for one provider execution.

  ProviderRun is the runtime fact that replaces ad-hoc complete-vs-stream
  branching at application boundaries. The only accepted execution mode is the
  unified event stream; compatibility callers may still consume the final
  output, but they must not define a second provider execution mode.
  """

  @type purpose ::
          :conversation
          | :planner
          | :writer
          | :evaluator
          | :revision
          | :tool
          | :narration
          | :other

  @type status ::
          :initialized
          | :running
          | :completed
          | :failed
          | :cancel_requested
          | :cancelled

  @type execution_mode :: :event_stream

  @type t :: %__MODULE__{
          provider_run_id: String.t(),
          provider_call_ref: String.t(),
          purpose: purpose(),
          execution_mode: execution_mode(),
          status: status(),
          provider_id: String.t() | nil,
          model: String.t() | nil,
          owner_refs: map(),
          metadata: map(),
          started_at: DateTime.t() | nil,
          completed_at: DateTime.t() | nil
        }

  @purposes [:conversation, :planner, :writer, :evaluator, :revision, :tool, :narration, :other]
  @statuses [:initialized, :running, :completed, :failed, :cancel_requested, :cancelled]
  @execution_modes [:event_stream]

  @enforce_keys [:provider_run_id, :provider_call_ref, :purpose, :execution_mode]
  defstruct [
    :provider_run_id,
    :provider_call_ref,
    :purpose,
    :execution_mode,
    provider_id: nil,
    model: nil,
    status: :initialized,
    owner_refs: %{},
    metadata: %{},
    started_at: nil,
    completed_at: nil
  ]

  @spec new(map() | keyword()) :: {:ok, t()} | {:error, [String.t()]}
  def new(attrs) do
    run = struct(__MODULE__, normalize(attrs))

    case validate(run) do
      [] -> {:ok, run}
      errors -> {:error, errors}
    end
  end

  @spec event_stream?(t()) :: boolean()
  def event_stream?(%__MODULE__{execution_mode: :event_stream}), do: true
  def event_stream?(_run), do: false

  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = run) do
    []
    |> require_present(:provider_run_id, run.provider_run_id)
    |> require_present(:provider_call_ref, run.provider_call_ref)
    |> validate_purpose(run.purpose)
    |> validate_status(run.status)
    |> validate_execution_mode(run.execution_mode)
  end

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:purpose, nil, &normalize_purpose/1)
    |> Map.update(:status, :initialized, &normalize_status/1)
    |> Map.update(:execution_mode, nil, &normalize_execution_mode/1)
    |> Map.update(:owner_refs, %{}, &normalize_map/1)
    |> Map.update(:metadata, %{}, &normalize_map/1)
  end

  defp atomize_known(attrs),
    do: for({key, value} <- attrs, into: %{}, do: {known_key(key), value})

  defp known_key(key) when is_atom(key), do: key
  defp known_key("provider_run_id"), do: :provider_run_id
  defp known_key("provider_call_ref"), do: :provider_call_ref
  defp known_key("purpose"), do: :purpose
  defp known_key("execution_mode"), do: :execution_mode
  defp known_key("provider_id"), do: :provider_id
  defp known_key("model"), do: :model
  defp known_key("status"), do: :status
  defp known_key("owner_refs"), do: :owner_refs
  defp known_key("metadata"), do: :metadata
  defp known_key("started_at"), do: :started_at
  defp known_key("completed_at"), do: :completed_at
  defp known_key(key), do: key

  defp normalize_purpose(value) when value in @purposes, do: value

  defp normalize_purpose(value) when is_binary(value),
    do: Enum.find(@purposes, &(Atom.to_string(&1) == value))

  defp normalize_purpose(_), do: nil

  defp normalize_status(value) when value in @statuses, do: value

  defp normalize_status(value) when is_binary(value),
    do: Enum.find(@statuses, &(Atom.to_string(&1) == value))

  defp normalize_status(_), do: nil

  defp normalize_execution_mode(value) when value in @execution_modes, do: value

  defp normalize_execution_mode(value) when is_binary(value),
    do: Enum.find(@execution_modes, &(Atom.to_string(&1) == value))

  defp normalize_execution_mode(_), do: nil

  defp normalize_map(value) when is_map(value), do: value
  defp normalize_map(_), do: %{}

  defp require_present(errors, _field, value) when is_binary(value) and value != "", do: errors
  defp require_present(errors, field, _value), do: ["#{field} is required" | errors]

  defp validate_purpose(errors, purpose) when purpose in @purposes, do: errors
  defp validate_purpose(errors, _purpose), do: ["purpose is invalid" | errors]

  defp validate_status(errors, status) when status in @statuses, do: errors
  defp validate_status(errors, _status), do: ["status is invalid" | errors]

  defp validate_execution_mode(errors, mode) when mode in @execution_modes, do: errors
  defp validate_execution_mode(errors, _mode), do: ["execution_mode is invalid" | errors]
end
