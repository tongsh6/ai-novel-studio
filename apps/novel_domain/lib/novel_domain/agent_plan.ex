defmodule NovelDomain.AgentPlan do
  @moduledoc """
  Milestone plan for an AgentRun.

  AgentPlan describes ordered milestones and stop conditions. It is not a
  MicroPlan and must not be converted into a batch of ToolRequests.
  """

  @type milestone :: %{
          milestone_id: String.t(),
          summary: String.t(),
          success_criteria: [String.t()]
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
          milestones: [milestone()],
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
    milestones: [],
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
    |> validate_milestones(plan.milestones)
    |> validate_stop_conditions(plan.stop_conditions)
  end

  @spec milestone_ids(t()) :: [String.t()]
  def milestone_ids(%__MODULE__{milestones: milestones}) do
    Enum.map(milestones, & &1.milestone_id)
  end

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:milestones, [], &normalize_milestones/1)
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
  defp known_key("milestones"), do: :milestones
  defp known_key("stop_conditions"), do: :stop_conditions
  defp known_key(key), do: key

  defp normalize_milestones(items) when is_list(items),
    do: Enum.map(items, &normalize_milestone/1)

  defp normalize_milestones(_), do: []

  defp normalize_milestone(item) when is_map(item) do
    %{
      milestone_id: value(item, :milestone_id) |> to_string(),
      summary: value(item, :summary) |> to_string(),
      success_criteria: normalize_strings(value(item, :success_criteria))
    }
  end

  defp normalize_milestone(_), do: %{milestone_id: "", summary: "", success_criteria: []}

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

  defp validate_milestones(errors, [_ | _] = milestones) do
    if Enum.all?(milestones, &(present?(&1.milestone_id) and present?(&1.summary))) do
      errors
    else
      ["milestones require milestone_id and summary" | errors]
    end
  end

  defp validate_milestones(errors, _), do: ["milestones must not be empty" | errors]

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
