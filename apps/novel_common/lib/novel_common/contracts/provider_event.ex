defmodule NovelCommon.Contracts.ProviderEvent do
  @moduledoc """
  Pure provider execution event contract.

  ProviderEvent is lower-level than AgentEvent. Application code may project it
  into author-safe AgentRun activity, but raw prompts, private reasoning, and
  secrets must never be carried in author-visible provider events. The only
  generated-text delta allowed at this level is an explicit author-facing
  narrative field such as `author_narrative_delta` for `:author_reasoning`;
  generic raw `content` / `text_delta` / `raw_output` keys remain forbidden.
  """

  @type event_type ::
          :started
          | :progress
          | :chunk
          | :final_output
          | :usage_recorded
          | :error
          | :cancel_requested
          | :cancelled

  @type visibility :: :author | :developer | :internal

  @type t :: %__MODULE__{
          event_id: String.t(),
          provider_run_ref: String.t(),
          sequence: pos_integer(),
          event_type: event_type(),
          visibility: visibility(),
          summary: String.t(),
          payload: map(),
          refs: [String.t()],
          emitted_at: DateTime.t() | nil
        }

  @event_types [
    :started,
    :progress,
    :chunk,
    :final_output,
    :usage_recorded,
    :error,
    :cancel_requested,
    :cancelled
  ]

  @unsafe_payload_keys ~w[
    api_key
    assistant_message
    chain_of_thought
    content
    frame_json
    messages
    output_text
    provider_response
    raw_messages
    raw_output
    raw_prompt
    secret
    system_prompt
    text_delta
  ]

  @enforce_keys [:event_id, :provider_run_ref, :sequence, :event_type, :summary]
  defstruct [
    :event_id,
    :provider_run_ref,
    :sequence,
    :event_type,
    :summary,
    visibility: :author,
    payload: %{},
    refs: [],
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

  @spec author_safe?(t()) :: boolean()
  def author_safe?(%__MODULE__{visibility: :author, payload: payload}) do
    not unsafe_payload?(payload)
  end

  def author_safe?(%__MODULE__{}), do: true

  @spec terminal?(t()) :: boolean()
  def terminal?(%__MODULE__{event_type: type}) when type in [:final_output, :error, :cancelled],
    do: true

  def terminal?(_event), do: false

  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = event) do
    []
    |> require_present(:event_id, event.event_id)
    |> require_present(:provider_run_ref, event.provider_run_ref)
    |> require_present(:summary, event.summary)
    |> require_positive(:sequence, event.sequence)
    |> validate_event_type(event.event_type)
    |> validate_visibility(event.visibility)
    |> validate_author_payload(event)
  end

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:event_type, nil, &normalize_event_type/1)
    |> Map.update(:visibility, :author, &normalize_visibility/1)
    |> Map.update(:payload, %{}, &normalize_payload/1)
    |> Map.update(:refs, [], &normalize_strings/1)
  end

  defp atomize_known(attrs),
    do: for({key, value} <- attrs, into: %{}, do: {known_key(key), value})

  defp known_key(key) when is_atom(key), do: key
  defp known_key("event_id"), do: :event_id
  defp known_key("provider_run_ref"), do: :provider_run_ref
  defp known_key("sequence"), do: :sequence
  defp known_key("event_type"), do: :event_type
  defp known_key("visibility"), do: :visibility
  defp known_key("summary"), do: :summary
  defp known_key("payload"), do: :payload
  defp known_key("refs"), do: :refs
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

  defp normalize_payload(payload) when is_map(payload), do: payload
  defp normalize_payload(_), do: %{}

  defp normalize_strings(values) when is_list(values) do
    values |> Enum.map(&to_string/1) |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))
  end

  defp normalize_strings(_), do: []

  defp require_present(errors, _field, value) when is_binary(value) and value != "", do: errors
  defp require_present(errors, field, _value), do: ["#{field} is required" | errors]

  defp require_positive(errors, _field, value) when is_integer(value) and value > 0, do: errors
  defp require_positive(errors, field, _value), do: ["#{field} must be positive" | errors]

  defp validate_event_type(errors, type) when type in @event_types, do: errors
  defp validate_event_type(errors, _type), do: ["event_type is invalid" | errors]

  defp validate_visibility(errors, visibility)
       when visibility in [:author, :developer, :internal], do: errors

  defp validate_visibility(errors, _visibility), do: ["visibility is invalid" | errors]

  defp validate_author_payload(errors, %__MODULE__{visibility: :author} = event) do
    if author_safe?(event), do: errors, else: ["payload is not author-safe" | errors]
  end

  defp validate_author_payload(errors, _event), do: errors

  defp unsafe_payload?(payload) when is_map(payload) do
    Enum.any?(payload, fn {key, value} ->
      unsafe_key?(key) or unsafe_payload?(value)
    end)
  end

  defp unsafe_payload?(values) when is_list(values), do: Enum.any?(values, &unsafe_payload?/1)
  defp unsafe_payload?(_value), do: false

  defp unsafe_key?(key) when is_atom(key), do: unsafe_key?(Atom.to_string(key))

  defp unsafe_key?(key) when is_binary(key) do
    normalized = key |> String.downcase() |> String.replace("-", "_")
    normalized in @unsafe_payload_keys
  end

  defp unsafe_key?(_key), do: false
end
