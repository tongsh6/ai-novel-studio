defmodule NovelDomain.AgentObservation do
  @moduledoc """
  Compressed sourced observation produced by an AgentStep.

  Observations can inform later planning, but they are not automatically story
  facts and must retain evidence refs.
  """

  @type observation_type ::
          :character_roster | :tool_fact | :artifact_created | :quality_review | :custom

  @type t :: %__MODULE__{
          observation_id: String.t(),
          run_ref: String.t(),
          step_ref: String.t(),
          observation_type: observation_type(),
          source_ref: String.t(),
          summary: String.t(),
          structured_payload: map(),
          evidence_refs: [String.t()],
          confidence: float()
        }

  @enforce_keys [:observation_id, :run_ref, :step_ref, :observation_type, :source_ref, :summary]
  defstruct [
    :observation_id,
    :run_ref,
    :step_ref,
    :observation_type,
    :source_ref,
    :summary,
    structured_payload: %{},
    evidence_refs: [],
    confidence: 1.0
  ]

  @spec new(map() | keyword()) :: {:ok, t()} | {:error, [String.t()]}
  def new(attrs) do
    observation = struct(__MODULE__, normalize(attrs))

    case validate(observation) do
      [] -> {:ok, observation}
      errors -> {:error, errors}
    end
  end

  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = observation) do
    []
    |> require_present(:observation_id, observation.observation_id)
    |> require_present(:run_ref, observation.run_ref)
    |> require_present(:step_ref, observation.step_ref)
    |> require_present(:source_ref, observation.source_ref)
    |> require_present(:summary, observation.summary)
    |> validate_type(observation.observation_type)
    |> validate_confidence(observation.confidence)
    |> validate_evidence(observation.evidence_refs)
  end

  @spec author_safe_summary(t()) :: map()
  def author_safe_summary(%__MODULE__{} = observation) do
    %{
      observation_id: observation.observation_id,
      observation_type: observation.observation_type,
      summary: observation.summary,
      evidence_refs: observation.evidence_refs,
      confidence: observation.confidence
    }
  end

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:observation_type, :custom, &normalize_type/1)
    |> Map.update(:structured_payload, %{}, &normalize_payload/1)
    |> Map.update(:evidence_refs, [], &normalize_refs/1)
    |> Map.update(:confidence, 1.0, &normalize_confidence/1)
  end

  defp atomize_known(attrs),
    do: for({key, value} <- attrs, into: %{}, do: {known_key(key), value})

  defp known_key(key) when is_atom(key), do: key
  defp known_key("observation_id"), do: :observation_id
  defp known_key("run_ref"), do: :run_ref
  defp known_key("step_ref"), do: :step_ref
  defp known_key("observation_type"), do: :observation_type
  defp known_key("source_ref"), do: :source_ref
  defp known_key("summary"), do: :summary
  defp known_key("structured_payload"), do: :structured_payload
  defp known_key("evidence_refs"), do: :evidence_refs
  defp known_key("confidence"), do: :confidence
  defp known_key(key), do: key

  defp normalize_type(value)
       when value in [:character_roster, :tool_fact, :artifact_created, :quality_review, :custom],
       do: value

  defp normalize_type("character_roster"), do: :character_roster
  defp normalize_type("tool_fact"), do: :tool_fact
  defp normalize_type("artifact_created"), do: :artifact_created
  defp normalize_type("quality_review"), do: :quality_review
  defp normalize_type(_), do: :custom

  defp normalize_payload(payload) when is_map(payload), do: payload
  defp normalize_payload(_), do: %{}

  defp normalize_refs(refs) when is_list(refs),
    do: refs |> Enum.map(&to_string/1) |> Enum.reject(&(&1 == ""))

  defp normalize_refs(_), do: []

  defp normalize_confidence(value) when is_float(value) and value >= 0.0 and value <= 1.0,
    do: value

  defp normalize_confidence(value) when is_integer(value) and value >= 0 and value <= 1,
    do: value * 1.0

  defp normalize_confidence(_), do: 1.0

  defp require_present(errors, _field, value) when is_binary(value) and value != "", do: errors
  defp require_present(errors, field, _value), do: ["#{field} is required" | errors]

  defp validate_type(errors, type)
       when type in [:character_roster, :tool_fact, :artifact_created, :quality_review, :custom],
       do: errors

  defp validate_type(errors, _type), do: ["observation_type is invalid" | errors]

  defp validate_confidence(errors, value) when is_float(value) and value >= 0.0 and value <= 1.0,
    do: errors

  defp validate_confidence(errors, _value), do: ["confidence must be between 0 and 1" | errors]

  defp validate_evidence(errors, [_ | _]), do: errors
  defp validate_evidence(errors, _), do: ["evidence_refs must not be empty" | errors]
end
