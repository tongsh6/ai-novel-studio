defmodule NovelCommon.Contracts.AgentEvent do
  @moduledoc """
  Author-safe event emitted by AgentRun runtime.

  AgentEvent is a process/activity stream item. It is not a TurnResult and must
  not expose raw prompts, chain-of-thought, secrets, or unredacted tool payloads.
  """

  @type event_type ::
          :run_started
          | :goal_understood
          | :judgment_decided
          | :plan_drafted
          | :plan_revised
          | :plan_adjusted
          | :exploration_observed
          | :evaluation_made
          | :mission_derived
          | :gate_decided
          | :tool_started
          | :tool_completed
          | :artifact_created
          | :artifact_superseded
          | :artifact_resolved
          | :turn_result_ready
          | :quality_review_started
          | :quality_finding_created
          | :provider_progress
          | :interrupt_requested
          | :run_pausing
          | :run_paused
          | :awaiting_author
          | :checkpoint_created
          | :run_resumed
          | :run_completed
          | :run_cancelled
          | :run_failed

  @type visibility :: :author | :developer | :internal

  @type t :: %__MODULE__{
          event_id: String.t(),
          run_ref: String.t(),
          step_ref: String.t() | nil,
          sequence: pos_integer(),
          event_type: event_type(),
          visibility: visibility(),
          summary: String.t(),
          reason_codes: [String.t()],
          refs: [String.t()],
          payload: map(),
          emitted_at: DateTime.t() | nil
        }

  @event_types [
    :run_started,
    :goal_understood,
    :judgment_decided,
    :plan_drafted,
    :plan_revised,
    :plan_adjusted,
    :exploration_observed,
    :evaluation_made,
    # WR01 写前推理：本章使命叙事事件（author_narrative source-bound，VS-00E §16）
    :mission_derived,
    :gate_decided,
    :tool_started,
    :tool_completed,
    :artifact_created,
    :artifact_superseded,
    :artifact_resolved,
    :turn_result_ready,
    :quality_review_started,
    :quality_finding_created,
    :provider_progress,
    :interrupt_requested,
    :run_pausing,
    :run_paused,
    :awaiting_author,
    :checkpoint_created,
    :run_resumed,
    :run_completed,
    :run_cancelled,
    :run_failed
  ]

  @enforce_keys [:event_id, :run_ref, :sequence, :event_type, :summary]
  defstruct [
    :event_id,
    :run_ref,
    :step_ref,
    :sequence,
    :event_type,
    :summary,
    visibility: :author,
    reason_codes: [],
    refs: [],
    payload: %{},
    emitted_at: nil
  ]

  @spec new(map() | keyword()) :: {:ok, t()} | {:error, [String.t()]}
  def new(attrs) do
    event = struct(__MODULE__, normalize(attrs))

    case validate(event) do
      [] -> {:ok, event}
      errors -> {:error, errors}
    end
  end

  @spec author_visible?(t()) :: boolean()
  def author_visible?(%__MODULE__{visibility: :author}), do: true
  def author_visible?(_event), do: false

  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = event) do
    []
    |> require_present(:event_id, event.event_id)
    |> require_present(:run_ref, event.run_ref)
    |> require_present(:summary, event.summary)
    |> require_positive(:sequence, event.sequence)
    |> validate_event_type(event.event_type)
    |> validate_visibility(event.visibility)
  end

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:event_type, nil, &normalize_event_type/1)
    |> Map.update(:visibility, :author, &normalize_visibility/1)
    |> Map.update(:reason_codes, [], &normalize_strings/1)
    |> Map.update(:refs, [], &normalize_strings/1)
    |> Map.update(:payload, %{}, &normalize_payload/1)
  end

  defp atomize_known(attrs),
    do: for({key, value} <- attrs, into: %{}, do: {known_key(key), value})

  defp known_key(key) when is_atom(key), do: key
  defp known_key("event_id"), do: :event_id
  defp known_key("run_ref"), do: :run_ref
  defp known_key("step_ref"), do: :step_ref
  defp known_key("sequence"), do: :sequence
  defp known_key("event_type"), do: :event_type
  defp known_key("visibility"), do: :visibility
  defp known_key("summary"), do: :summary
  defp known_key("reason_codes"), do: :reason_codes
  defp known_key("refs"), do: :refs
  defp known_key("payload"), do: :payload
  defp known_key("emitted_at"), do: :emitted_at
  defp known_key(key), do: key

  defp normalize_event_type(value) when value in @event_types, do: value

  defp normalize_event_type(value) when is_binary(value),
    do: Enum.find(@event_types, &(Atom.to_string(&1) == value))

  defp normalize_event_type(_), do: nil

  defp normalize_visibility(value) when value in [:author, :developer, :internal], do: value
  defp normalize_visibility("developer"), do: :developer
  defp normalize_visibility("internal"), do: :internal
  defp normalize_visibility(_), do: :author

  defp normalize_strings(values) when is_list(values) do
    values |> Enum.map(&to_string/1) |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))
  end

  defp normalize_strings(_), do: []

  defp normalize_payload(payload) when is_map(payload), do: payload
  defp normalize_payload(_), do: %{}

  defp require_present(errors, _field, value) when is_binary(value) and value != "", do: errors
  defp require_present(errors, field, _value), do: ["#{field} is required" | errors]

  defp require_positive(errors, _field, value) when is_integer(value) and value > 0, do: errors
  defp require_positive(errors, field, _value), do: ["#{field} must be positive" | errors]

  defp validate_event_type(errors, type) when type in @event_types, do: errors
  defp validate_event_type(errors, _type), do: ["event_type is invalid" | errors]

  defp validate_visibility(errors, visibility)
       when visibility in [:author, :developer, :internal], do: errors

  defp validate_visibility(errors, _visibility), do: ["visibility is invalid" | errors]
end
