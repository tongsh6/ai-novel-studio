defmodule NovelDomain.AgentNextStepDecision do
  @moduledoc """
  Pure next-step decision proposed inside an AgentRun loop.

  This value is not an execution approval. `:execute_step` only means the
  planner proposes a single next capability; the application layer must still
  materialize a MicroPlan and pass it through ExecutionOrchestrator.
  """

  @type decision_type :: :execute_step | :goal_satisfied | :await_author | :no_progress
  @type write_intent :: :none | :tentative
  @type risk_hint :: :low | :medium | :high
  @type authoring_intent :: :none | :continuation | :rewrite
  @type evaluation_of_last :: %{
          advanced: boolean(),
          plan_holds: boolean(),
          new_constraint: String.t() | nil
        }

  @type plan_revision :: %{
          plan_version: pos_integer() | nil,
          revision_reason: String.t() | nil
        }

  @type t :: %__MODULE__{
          decision_id: String.t(),
          run_ref: String.t(),
          sequence: pos_integer(),
          decision_type: decision_type(),
          summary: String.t(),
          target_tool_ref: String.t() | nil,
          write_intent: write_intent(),
          risk_hint: risk_hint(),
          authoring_intent: authoring_intent() | nil,
          target_chapter: String.t() | nil,
          requested_chapter_raw: String.t() | nil,
          target_word_count: pos_integer() | nil,
          exploration_query: String.t() | nil,
          reason_codes: [String.t()],
          observation_refs: [String.t()],
          evaluation_of_last: evaluation_of_last(),
          plan_revision: plan_revision() | nil,
          narrative_source: map(),
          confidence: float()
        }

  @enforce_keys [:decision_id, :run_ref, :sequence, :decision_type, :summary]
  defstruct [
    :decision_id,
    :run_ref,
    :sequence,
    :decision_type,
    :summary,
    :target_tool_ref,
    :authoring_intent,
    :target_chapter,
    :requested_chapter_raw,
    :target_word_count,
    :exploration_query,
    write_intent: :none,
    risk_hint: :low,
    reason_codes: [],
    observation_refs: [],
    evaluation_of_last: %{advanced: false, plan_holds: true, new_constraint: nil},
    plan_revision: nil,
    narrative_source: %{},
    confidence: 1.0
  ]

  @decision_types [:execute_step, :goal_satisfied, :await_author, :no_progress]
  @write_intents [:none, :tentative]
  @risk_hints [:low, :medium, :high]
  @authoring_intents [:none, :continuation, :rewrite]

  @spec new(map() | keyword()) :: {:ok, t()} | {:error, [String.t()]}
  def new(attrs) do
    decision = struct(__MODULE__, normalize(attrs))

    case validate(decision) do
      [] -> {:ok, decision}
      errors -> {:error, errors}
    end
  end

  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = decision) do
    []
    |> require_present(:decision_id, decision.decision_id)
    |> require_present(:run_ref, decision.run_ref)
    |> require_present(:summary, decision.summary)
    |> require_positive(:sequence, decision.sequence)
    |> validate_decision_type(decision.decision_type)
    |> validate_execution_target(decision)
    |> validate_write_intent(decision.write_intent)
    |> validate_risk_hint(decision.risk_hint)
    |> validate_authoring_intent(decision.authoring_intent)
    |> validate_confidence(decision.confidence)
  end

  @spec author_safe_summary(t()) :: map()
  def author_safe_summary(%__MODULE__{} = decision) do
    %{
      decision_id: decision.decision_id,
      decision_type: decision.decision_type,
      summary: decision.summary,
      target_tool_ref: decision.target_tool_ref,
      write_intent: decision.write_intent,
      risk_hint: decision.risk_hint,
      authoring_intent: decision.authoring_intent,
      target_chapter: decision.target_chapter,
      requested_chapter_raw: decision.requested_chapter_raw,
      target_word_count: decision.target_word_count,
      exploration_query: decision.exploration_query,
      reason_codes: decision.reason_codes,
      observation_refs: decision.observation_refs,
      evaluation_of_last: decision.evaluation_of_last,
      plan_revision: decision.plan_revision,
      narrative_source: decision.narrative_source,
      confidence: decision.confidence
    }
  end

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:decision_type, nil, &normalize_decision_type/1)
    |> Map.update(:write_intent, :none, &normalize_write_intent/1)
    |> Map.update(:risk_hint, :low, &normalize_risk_hint/1)
    |> Map.update(:reason_codes, [], &normalize_strings/1)
    |> Map.update(:observation_refs, [], &normalize_strings/1)
    |> Map.update(:evaluation_of_last, %{}, &normalize_evaluation/1)
    |> Map.update(:plan_revision, nil, &normalize_plan_revision/1)
    |> Map.update(:narrative_source, %{}, &normalize_map/1)
    |> Map.update(:confidence, 1.0, &normalize_confidence/1)
    |> Map.update(:target_tool_ref, nil, &normalize_optional_string/1)
    |> Map.update(:authoring_intent, nil, &normalize_authoring_intent/1)
    |> Map.update(:target_chapter, nil, &normalize_optional_string/1)
    |> Map.update(:requested_chapter_raw, nil, &normalize_optional_string/1)
    |> Map.update(:target_word_count, nil, &positive_int/1)
    |> Map.update(:exploration_query, nil, &nonblank_string/1)
  end

  defp atomize_known(attrs),
    do: for({key, value} <- attrs, into: %{}, do: {known_key(key), value})

  defp known_key(key) when is_atom(key), do: key
  defp known_key("decision_id"), do: :decision_id
  defp known_key("run_ref"), do: :run_ref
  defp known_key("sequence"), do: :sequence
  defp known_key("decision_type"), do: :decision_type
  defp known_key("summary"), do: :summary
  defp known_key("target_tool_ref"), do: :target_tool_ref
  defp known_key("write_intent"), do: :write_intent
  defp known_key("risk_hint"), do: :risk_hint
  defp known_key("authoring_intent"), do: :authoring_intent
  defp known_key("target_chapter"), do: :target_chapter
  defp known_key("requested_chapter_raw"), do: :requested_chapter_raw
  defp known_key("target_word_count"), do: :target_word_count
  defp known_key("exploration_query"), do: :exploration_query
  defp known_key("reason_codes"), do: :reason_codes
  defp known_key("observation_refs"), do: :observation_refs
  defp known_key("evaluation_of_last"), do: :evaluation_of_last
  defp known_key("plan_revision"), do: :plan_revision
  defp known_key("narrative_source"), do: :narrative_source
  defp known_key("confidence"), do: :confidence
  defp known_key(key), do: key

  defp normalize_decision_type(value) when value in @decision_types, do: value
  defp normalize_decision_type("execute_step"), do: :execute_step
  defp normalize_decision_type("goal_satisfied"), do: :goal_satisfied
  defp normalize_decision_type("await_author"), do: :await_author
  defp normalize_decision_type("no_progress"), do: :no_progress
  defp normalize_decision_type(_), do: nil

  defp normalize_write_intent(value) when value in @write_intents, do: value
  defp normalize_write_intent("tentative"), do: :tentative
  defp normalize_write_intent(_), do: :none

  defp normalize_risk_hint(value) when value in @risk_hints, do: value
  defp normalize_risk_hint("medium"), do: :medium
  defp normalize_risk_hint("high"), do: :high
  defp normalize_risk_hint(_), do: :low

  defp normalize_authoring_intent(value) when value in @authoring_intents, do: value
  defp normalize_authoring_intent("none"), do: :none
  defp normalize_authoring_intent("continuation"), do: :continuation
  defp normalize_authoring_intent("rewrite"), do: :rewrite
  defp normalize_authoring_intent(_), do: nil

  defp normalize_strings(values) when is_list(values) do
    values
    |> Enum.map(&to_string/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp normalize_strings(_), do: []

  defp normalize_evaluation(value) when is_map(value) do
    %{
      advanced: boolean_value(value, :advanced, false),
      plan_holds: boolean_value(value, :plan_holds, true),
      new_constraint: normalize_optional_string(map_value(value, :new_constraint))
    }
  end

  defp normalize_evaluation(_value),
    do: %{advanced: false, plan_holds: true, new_constraint: nil}

  defp normalize_plan_revision(nil), do: nil

  defp normalize_plan_revision(value) when is_map(value) do
    %{
      plan_version: positive_int(map_value(value, :plan_version)),
      revision_reason: normalize_optional_string(map_value(value, :revision_reason))
    }
  end

  defp normalize_plan_revision(_value), do: nil

  defp normalize_map(value) when is_map(value), do: value
  defp normalize_map(_), do: %{}

  defp normalize_optional_string(nil), do: nil

  defp normalize_optional_string(value) do
    value
    |> to_string()
    |> String.trim()
    |> case do
      "" -> nil
      text -> text
    end
  end

  defp normalize_confidence(value) when is_float(value) and value >= 0.0 and value <= 1.0,
    do: value

  defp normalize_confidence(value) when is_integer(value) and value >= 0 and value <= 1,
    do: value * 1.0

  defp normalize_confidence(_), do: 1.0

  defp boolean_value(map, key, default) do
    case map_value(map, key) do
      value when is_boolean(value) -> value
      "true" -> true
      "false" -> false
      _ -> default
    end
  end

  defp positive_int(value) when is_integer(value) and value > 0, do: value
  defp positive_int(_value), do: nil

  defp nonblank_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp nonblank_string(_value), do: nil

  defp map_value(map, key) when is_map(map) do
    cond do
      Map.has_key?(map, key) -> Map.get(map, key)
      Map.has_key?(map, Atom.to_string(key)) -> Map.get(map, Atom.to_string(key))
      true -> nil
    end
  end

  defp require_present(errors, _field, value) when is_binary(value) and value != "", do: errors
  defp require_present(errors, field, _value), do: ["#{field} is required" | errors]

  defp require_positive(errors, _field, value) when is_integer(value) and value > 0,
    do: errors

  defp require_positive(errors, field, _value), do: ["#{field} must be positive" | errors]

  defp validate_decision_type(errors, type) when type in @decision_types, do: errors
  defp validate_decision_type(errors, _type), do: ["decision_type is invalid" | errors]

  defp validate_execution_target(errors, %__MODULE__{
         decision_type: :execute_step,
         target_tool_ref: tool
       })
       when is_binary(tool) and tool != "",
       do: errors

  defp validate_execution_target(errors, %__MODULE__{decision_type: :execute_step}),
    do: ["target_tool_ref is required for execute_step" | errors]

  defp validate_execution_target(errors, %__MODULE__{}), do: errors

  defp validate_write_intent(errors, intent) when intent in @write_intents, do: errors
  defp validate_write_intent(errors, _intent), do: ["write_intent is invalid" | errors]

  defp validate_risk_hint(errors, risk) when risk in @risk_hints, do: errors
  defp validate_risk_hint(errors, _risk), do: ["risk_hint is invalid" | errors]

  defp validate_authoring_intent(errors, intent) when is_nil(intent) or intent in @authoring_intents,
    do: errors

  defp validate_authoring_intent(errors, _intent), do: ["authoring_intent is invalid" | errors]

  defp validate_confidence(errors, value) when is_float(value) and value >= 0.0 and value <= 1.0,
    do: errors

  defp validate_confidence(errors, _value), do: ["confidence must be between 0 and 1" | errors]
end
