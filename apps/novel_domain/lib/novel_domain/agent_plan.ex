defmodule NovelDomain.AgentPlan do
  @moduledoc """
  Author-visible plan for an AgentRun.

  AgentPlan describes ordered PlanSteps and stop conditions. It is not a
  MicroPlan, and PlanStep is not a runtime AgentStep or tool call.
  """

  @type step_kind :: :explore | :act
  @type step_status :: :pending | :active | :done | :skipped
  @type write_intent :: :none | :tentative
  @type risk_hint :: :low | :medium | :high
  @type authoring_intent :: :none | :continuation | :rewrite

  @type plan_step :: %{
          step_id: String.t(),
          kind: step_kind(),
          status: step_status(),
          description: String.t(),
          success_criteria: [String.t()],
          depends_on: [String.t()],
          target_tool_ref: String.t() | nil,
          write_intent: write_intent(),
          risk_hint: risk_hint(),
          authoring_intent: authoring_intent() | nil,
          target_chapter: String.t() | nil,
          requested_chapter_raw: String.t() | nil
        }

  @type stop_condition ::
          :author_interrupt
          | :confirmation_required
          | :budget_exhausted
          | :no_progress
          | :goal_satisfied

  @type t :: %__MODULE__{
          plan_id: String.t(),
          run_ref: String.t(),
          version: pos_integer(),
          goal_version: pos_integer(),
          steps: [plan_step()],
          stop_conditions: [stop_condition()]
        }

  @default_stop_conditions [
    :author_interrupt,
    :confirmation_required,
    :budget_exhausted,
    :no_progress,
    :goal_satisfied
  ]

  @enforce_keys [:plan_id, :run_ref]
  defstruct [
    :plan_id,
    :run_ref,
    version: 1,
    goal_version: 1,
    steps: [],
    stop_conditions: @default_stop_conditions
  ]

  @spec new(map() | keyword()) :: {:ok, t()} | {:error, [String.t()]}
  def new(attrs) do
    plan = struct(__MODULE__, normalize(attrs))

    case validate(plan) do
      [] -> {:ok, plan}
      errors -> {:error, errors}
    end
  end

  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = plan) do
    []
    |> require_present(:plan_id, plan.plan_id)
    |> require_present(:run_ref, plan.run_ref)
    |> require_positive(:version, plan.version)
    |> require_positive(:goal_version, plan.goal_version)
    |> validate_steps(plan.steps)
    |> validate_stop_conditions(plan.stop_conditions)
  end

  @spec step_ids(t()) :: [String.t()]
  def step_ids(%__MODULE__{steps: steps}) do
    Enum.map(steps, & &1.step_id)
  end

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:steps, [], &normalize_steps/1)
    |> Map.update(:stop_conditions, @default_stop_conditions, &normalize_stop_conditions/1)
  end

  defp atomize_known(attrs) do
    for {key, value} <- attrs, into: %{}, do: {known_key(key), value}
  end

  defp known_key(key) when is_atom(key), do: key
  defp known_key("plan_id"), do: :plan_id
  defp known_key("run_ref"), do: :run_ref
  defp known_key("version"), do: :version
  defp known_key("goal_version"), do: :goal_version
  defp known_key("steps"), do: :steps
  defp known_key("stop_conditions"), do: :stop_conditions
  defp known_key(key), do: key

  defp normalize_steps(items) when is_list(items),
    do: Enum.map(items, &normalize_step/1)

  defp normalize_steps(_), do: []

  defp normalize_step(item) when is_map(item) do
    %{
      step_id: value(item, :step_id) |> to_string(),
      kind: normalize_step_kind(value(item, :kind)),
      status: normalize_step_status(value(item, :status)),
      description: value(item, :description) |> to_string(),
      success_criteria: normalize_strings(value(item, :success_criteria)),
      depends_on: normalize_strings(value(item, :depends_on)),
      target_tool_ref: normalize_optional_string(value(item, :target_tool_ref)),
      write_intent: normalize_write_intent(value(item, :write_intent)),
      risk_hint: normalize_risk_hint(value(item, :risk_hint)),
      authoring_intent: normalize_authoring_intent(value(item, :authoring_intent)),
      target_chapter: normalize_optional_string(value(item, :target_chapter)),
      requested_chapter_raw: normalize_optional_string(value(item, :requested_chapter_raw))
    }
  end

  defp normalize_step(_),
    do: %{
      step_id: "",
      kind: :explore,
      status: :pending,
      description: "",
      success_criteria: [],
      depends_on: [],
      target_tool_ref: nil,
      write_intent: :none,
      risk_hint: :low,
      authoring_intent: nil,
      target_chapter: nil,
      requested_chapter_raw: nil
    }

  defp normalize_step_kind(value) when value in [:explore, :act], do: value
  defp normalize_step_kind("act"), do: :act
  defp normalize_step_kind(_), do: :explore

  defp normalize_step_status(value) when value in [:pending, :active, :done, :skipped], do: value
  defp normalize_step_status("active"), do: :active
  defp normalize_step_status("done"), do: :done
  defp normalize_step_status("skipped"), do: :skipped
  defp normalize_step_status(_), do: :pending

  defp normalize_write_intent(value) when value in [:none, :tentative], do: value
  defp normalize_write_intent("tentative"), do: :tentative
  defp normalize_write_intent(_), do: :none

  defp normalize_risk_hint(value) when value in [:low, :medium, :high], do: value
  defp normalize_risk_hint("medium"), do: :medium
  defp normalize_risk_hint("high"), do: :high
  defp normalize_risk_hint(_), do: :low

  defp normalize_authoring_intent(value) when value in [:none, :continuation, :rewrite], do: value
  defp normalize_authoring_intent("none"), do: :none
  defp normalize_authoring_intent("continuation"), do: :continuation
  defp normalize_authoring_intent("rewrite"), do: :rewrite
  defp normalize_authoring_intent(_), do: nil

  defp normalize_stop_conditions(items) when is_list(items),
    do: Enum.map(items, &normalize_stop_condition/1)

  defp normalize_stop_conditions(_), do: @default_stop_conditions

  defp normalize_stop_condition(value) when value in @default_stop_conditions, do: value
  defp normalize_stop_condition("confirmation_required"), do: :confirmation_required
  defp normalize_stop_condition("budget_exhausted"), do: :budget_exhausted
  defp normalize_stop_condition("no_progress"), do: :no_progress
  defp normalize_stop_condition("goal_satisfied"), do: :goal_satisfied
  defp normalize_stop_condition(_), do: :author_interrupt

  defp normalize_strings(items) when is_list(items) do
    items |> Enum.map(&to_string/1) |> Enum.map(&String.trim/1) |> Enum.reject(&(&1 == ""))
  end

  defp normalize_strings(_), do: []

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

  defp validate_steps(errors, [_ | _] = steps) do
    if Enum.all?(steps, &(present?(&1.step_id) and present?(&1.description))) do
      errors
    else
      ["steps require step_id and description" | errors]
    end
  end

  defp validate_steps(errors, _), do: ["steps must not be empty" | errors]

  defp validate_stop_conditions(errors, [_ | _] = conditions) do
    if Enum.all?(conditions, &(&1 in @default_stop_conditions)) do
      errors
    else
      ["stop_conditions contain invalid values" | errors]
    end
  end

  defp validate_stop_conditions(errors, _), do: ["stop_conditions must not be empty" | errors]

  defp require_present(errors, _field, value) when is_binary(value) and value != "", do: errors
  defp require_present(errors, field, _value), do: ["#{field} is required" | errors]

  defp require_positive(errors, _field, value) when is_integer(value) and value > 0, do: errors
  defp require_positive(errors, field, _value), do: ["#{field} must be positive" | errors]

  defp value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
  defp present?(value), do: is_binary(value) and String.trim(value) != ""
end
