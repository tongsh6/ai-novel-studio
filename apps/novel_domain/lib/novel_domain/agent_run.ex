defmodule NovelDomain.AgentRun do
  @moduledoc """
  Pure AgentRun state for a bounded or durable agent execution.

  AgentRun is not a turn and does not authorize tool execution by itself. Each
  step still needs a MicroPlan and ExecutionOrchestrator decision.
  """

  alias NovelDomain.AgentRunPolicy

  @type run_mode :: :bounded | :durable
  @type status ::
          :created
          | :running
          | :pausing
          | :cancelling
          | :paused
          | :awaiting_author
          | :completed
          | :cancelled
          | :failed
  @type phase :: :planning | :executing | :finalizing | :stopped
  @type interrupt_status :: :none | :pause_requested | :cancel_requested | :steer_requested

  @type goal :: %{text: String.t(), version: pos_integer()}
  @type trigger :: %{
          required(:kind) => String.t(),
          optional(:receipt_id) => String.t(),
          optional(:action_id) => String.t(),
          optional(:action_type) => String.t(),
          optional(:source_turn_ref) => String.t(),
          optional(:source_surface_ref) => String.t(),
          optional(:target_artifact_ref) => String.t(),
          optional(:quality_finding_refs) => [String.t()]
        }
  @type budget :: %{
          max_steps: pos_integer(),
          max_tool_calls: non_neg_integer(),
          max_provider_calls: non_neg_integer(),
          max_replans: non_neg_integer(),
          max_pending_artifacts: non_neg_integer()
        }
  @type consumed_budget :: %{
          steps: non_neg_integer(),
          tool_calls: non_neg_integer(),
          provider_calls: non_neg_integer(),
          replans: non_neg_integer()
        }

  @type t :: %__MODULE__{
          run_id: String.t(),
          run_mode: run_mode(),
          workspace_id: String.t(),
          work_id: String.t(),
          session_id: String.t(),
          parent_turn_ref: String.t(),
          origin_frame_ref: String.t(),
          profile_ref: String.t(),
          trigger: trigger() | nil,
          goal: goal(),
          status: status(),
          phase: phase(),
          plan: map() | nil,
          plan_ref: String.t() | nil,
          plan_version: pos_integer(),
          current_step_ref: String.t() | nil,
          completed_step_refs: [String.t()],
          authority_scope: map(),
          policy: AgentRunPolicy.t(),
          budget: budget(),
          consumed_budget: consumed_budget(),
          interrupt_state: %{status: interrupt_status(), requested_at: String.t() | nil},
          pending_artifact_refs: [String.t()],
          active_behavior_ref: String.t() | nil,
          long_run_task_ref: String.t() | nil,
          failure_ref: String.t() | nil
        }

  @required ~w(run_id workspace_id work_id session_id parent_turn_ref origin_frame_ref profile_ref)a

  defstruct [
    :run_id,
    :workspace_id,
    :work_id,
    :session_id,
    :parent_turn_ref,
    :origin_frame_ref,
    :profile_ref,
    :trigger,
    :plan,
    :plan_ref,
    :current_step_ref,
    :active_behavior_ref,
    :long_run_task_ref,
    :failure_ref,
    run_mode: :bounded,
    goal: %{text: "", version: 1},
    status: :created,
    phase: :planning,
    plan_version: 1,
    completed_step_refs: [],
    authority_scope: %{production_write: false, allowed_tools: []},
    policy: nil,
    budget: %{
      max_steps: 5,
      max_tool_calls: 4,
      max_provider_calls: 3,
      max_replans: 1,
      max_pending_artifacts: 3
    },
    consumed_budget: %{steps: 0, tool_calls: 0, provider_calls: 0, replans: 0},
    interrupt_state: %{status: :none, requested_at: nil},
    pending_artifact_refs: []
  ]

  @spec new(map() | keyword()) :: {:ok, t()} | {:error, [String.t()]}
  def new(attrs) do
    attrs = normalize(attrs)

    with {:ok, policy} <- policy(attrs) do
      run = struct(__MODULE__, Map.put(attrs, :policy, policy))

      case validate(run) do
        [] -> {:ok, run}
        errors -> {:error, errors}
      end
    end
  end

  @spec validate(t()) :: [String.t()]
  def validate(%__MODULE__{} = run) do
    []
    |> validate_required(run)
    |> validate_goal(run.goal)
    |> validate_mode(run.run_mode)
    |> validate_status(run.status)
    |> validate_phase(run.phase)
    |> validate_bounded_long_run(run)
  end

  @spec budget_exhausted?(t()) :: boolean()
  def budget_exhausted?(%__MODULE__{} = run) do
    run.consumed_budget.steps >= run.budget.max_steps or
      run.consumed_budget.tool_calls >= run.budget.max_tool_calls or
      run.consumed_budget.provider_calls >= run.budget.max_provider_calls or
      run.consumed_budget.replans > run.budget.max_replans
  end

  @spec pending_artifact_budget_reached?(t()) :: boolean()
  def pending_artifact_budget_reached?(%__MODULE__{budget: budget} = run) do
    limit = value(budget, :max_pending_artifacts)

    is_integer(limit) and limit >= 0 and length(run.pending_artifact_refs) >= limit
  end

  @doc """
  判断②改进闭环（ADR-0025 CP3b）：中间稿被改进稿替代——refs 从待采纳集合移除
  （不再计入 pending 预算、不再作为候选呈现；trace 留痕由事件承担）。
  """
  @spec supersede_pending_artifacts(t(), [String.t()]) :: t()
  def supersede_pending_artifacts(%__MODULE__{} = run, refs) when is_list(refs) do
    %{run | pending_artifact_refs: Enum.reject(run.pending_artifact_refs, &(&1 in refs))}
  end

  @spec interrupt_requested?(t()) :: boolean()
  def interrupt_requested?(%__MODULE__{interrupt_state: %{status: :none}}), do: false
  def interrupt_requested?(%__MODULE__{}), do: true

  defp normalize(attrs) when is_list(attrs), do: attrs |> Map.new() |> normalize()

  defp normalize(attrs) when is_map(attrs) do
    attrs
    |> atomize_known()
    |> Map.update(:run_mode, :bounded, &normalize_mode/1)
    |> Map.update(:status, :created, &normalize_status/1)
    |> Map.update(:phase, :planning, &normalize_phase/1)
    |> Map.update(:goal, %{text: "", version: 1}, &normalize_goal/1)
    |> Map.update(:trigger, nil, &normalize_trigger/1)
    |> Map.update(:completed_step_refs, [], &normalize_refs/1)
    |> Map.update(:pending_artifact_refs, [], &normalize_refs/1)
    |> Map.update(
      :authority_scope,
      %{production_write: false, allowed_tools: []},
      &normalize_authority/1
    )
    |> Map.update(
      :budget,
      %{
        max_steps: 5,
        max_tool_calls: 4,
        max_provider_calls: 3,
        max_replans: 1,
        max_pending_artifacts: 3
      },
      &normalize_budget/1
    )
    |> Map.update(
      :consumed_budget,
      %{steps: 0, tool_calls: 0, provider_calls: 0, replans: 0},
      &normalize_consumed/1
    )
    |> Map.update(:interrupt_state, %{status: :none, requested_at: nil}, &normalize_interrupt/1)
  end

  defp policy(%{policy: %AgentRunPolicy{} = policy}), do: {:ok, policy}
  defp policy(%{policy: policy}), do: AgentRunPolicy.new(policy)

  defp policy(%{authority_scope: %{allowed_tools: tools}} = attrs),
    do: AgentRunPolicy.new(policy_attrs(tools, attrs))

  defp policy(attrs), do: AgentRunPolicy.new(policy_attrs([], attrs))

  defp policy_attrs(tools, attrs) do
    budget = value(attrs, :budget) || %{}

    [
      allowed_tool_refs: tools,
      max_pending_artifacts: non_negative_int(value(budget, :max_pending_artifacts), 3)
    ]
  end

  defp atomize_known(attrs) do
    for {key, value} <- attrs, into: %{} do
      {known_key(key), value}
    end
  end

  defp known_key(key) when is_atom(key), do: key
  defp known_key("run_id"), do: :run_id
  defp known_key("run_mode"), do: :run_mode
  defp known_key("workspace_id"), do: :workspace_id
  defp known_key("work_id"), do: :work_id
  defp known_key("session_id"), do: :session_id
  defp known_key("parent_turn_ref"), do: :parent_turn_ref
  defp known_key("origin_frame_ref"), do: :origin_frame_ref
  defp known_key("profile_ref"), do: :profile_ref
  defp known_key("trigger"), do: :trigger
  defp known_key("plan"), do: :plan
  defp known_key("goal"), do: :goal
  defp known_key("status"), do: :status
  defp known_key("phase"), do: :phase
  defp known_key("plan_ref"), do: :plan_ref
  defp known_key("plan_version"), do: :plan_version
  defp known_key("current_step_ref"), do: :current_step_ref
  defp known_key("completed_step_refs"), do: :completed_step_refs
  defp known_key("authority_scope"), do: :authority_scope
  defp known_key("policy"), do: :policy
  defp known_key("budget"), do: :budget
  defp known_key("consumed_budget"), do: :consumed_budget
  defp known_key("interrupt_state"), do: :interrupt_state
  defp known_key("pending_artifact_refs"), do: :pending_artifact_refs
  defp known_key("active_behavior_ref"), do: :active_behavior_ref
  defp known_key("long_run_task_ref"), do: :long_run_task_ref
  defp known_key("failure_ref"), do: :failure_ref
  defp known_key(key), do: key

  defp normalize_mode(value) when value in [:bounded, :durable], do: value
  defp normalize_mode("durable"), do: :durable
  defp normalize_mode(_), do: :bounded

  defp normalize_status(value)
       when value in [
              :created,
              :running,
              :pausing,
              :cancelling,
              :paused,
              :awaiting_author,
              :completed,
              :cancelled,
              :failed
            ],
       do: value

  defp normalize_status("running"), do: :running
  defp normalize_status("pausing"), do: :pausing
  defp normalize_status("cancelling"), do: :cancelling
  defp normalize_status("paused"), do: :paused
  defp normalize_status("awaiting_author"), do: :awaiting_author
  defp normalize_status("completed"), do: :completed
  defp normalize_status("cancelled"), do: :cancelled
  defp normalize_status("failed"), do: :failed
  defp normalize_status(_), do: :created

  defp normalize_phase(value) when value in [:planning, :executing, :finalizing, :stopped],
    do: value

  defp normalize_phase("executing"), do: :executing
  defp normalize_phase("finalizing"), do: :finalizing
  defp normalize_phase("stopped"), do: :stopped
  defp normalize_phase(_), do: :planning

  defp normalize_goal(goal) when is_map(goal) do
    %{text: text(goal), version: positive_int(value(goal, :version), 1)}
  end

  defp normalize_goal(text) when is_binary(text), do: %{text: String.trim(text), version: 1}
  defp normalize_goal(_), do: %{text: "", version: 1}

  defp normalize_trigger(trigger) when is_map(trigger) do
    %{
      kind: normalized_optional_text(value(trigger, :kind)),
      receipt_id: normalized_optional_text(value(trigger, :receipt_id)),
      action_id: normalized_optional_text(value(trigger, :action_id)),
      action_type: normalized_optional_text(value(trigger, :action_type)),
      source_turn_ref: normalized_optional_text(value(trigger, :source_turn_ref)),
      source_surface_ref: normalized_optional_text(value(trigger, :source_surface_ref)),
      target_artifact_ref: normalized_optional_text(value(trigger, :target_artifact_ref)),
      quality_finding_refs:
        trigger |> value(:quality_finding_refs) |> normalize_refs() |> Enum.uniq()
    }
    |> Enum.reject(fn {_key, value} -> value in [nil, []] end)
    |> Map.new()
    |> case do
      %{kind: _kind} = normalized -> normalized
      _other -> nil
    end
  end

  defp normalize_trigger(_trigger), do: nil

  defp normalize_refs(refs) when is_list(refs),
    do: refs |> Enum.map(&to_string/1) |> Enum.reject(&(&1 == ""))

  defp normalize_refs(_), do: []

  defp normalize_authority(scope) when is_map(scope) do
    authority = %{
      production_write: value(scope, :production_write) == true,
      allowed_tools: normalize_refs(value(scope, :allowed_tools))
    }

    case normalize_profile_selection(value(scope, :profile_selection)) do
      nil -> authority
      selection -> Map.put(authority, :profile_selection, selection)
    end
    |> maybe_put_authority_fact(:work_revision, value(scope, :work_revision))
    |> maybe_put_authority_fact(:target_revision_ref, value(scope, :target_revision_ref))
    |> maybe_put_authority_fact(:target_revision, value(scope, :target_revision))
  end

  defp normalize_authority(_), do: %{production_write: false, allowed_tools: []}

  defp maybe_put_authority_fact(authority, key, value) do
    case nonblank_authority_fact(value) do
      nil -> authority
      fact_value -> Map.put(authority, key, fact_value)
    end
  end

  defp nonblank_authority_fact(value) when is_binary(value) do
    value = String.trim(value)
    if value == "", do: nil, else: value
  end

  defp nonblank_authority_fact(nil), do: nil
  defp nonblank_authority_fact(value), do: value

  defp normalize_profile_selection(selection) when is_map(selection) do
    %{
      profile_ref: selection |> value(:profile_ref) |> to_string() |> String.trim(),
      source: selection |> value(:source) |> to_string() |> String.trim(),
      reason_codes: normalize_refs(value(selection, :reason_codes)),
      matched_terms: normalize_refs(value(selection, :matched_terms))
    }
    |> Enum.reject(fn {_key, value} -> value in ["", []] end)
    |> Map.new()
    |> case do
      empty when map_size(empty) == 0 -> nil
      normalized -> normalized
    end
  end

  defp normalize_profile_selection(_selection), do: nil

  defp normalize_budget(budget) when is_map(budget) do
    %{
      max_steps: positive_int(value(budget, :max_steps), 5),
      max_tool_calls: non_negative_int(value(budget, :max_tool_calls), 4),
      max_provider_calls: non_negative_int(value(budget, :max_provider_calls), 3),
      max_replans: non_negative_int(value(budget, :max_replans), 1),
      max_pending_artifacts: non_negative_int(value(budget, :max_pending_artifacts), 3)
    }
  end

  defp normalize_budget(_),
    do: %{
      max_steps: 5,
      max_tool_calls: 4,
      max_provider_calls: 3,
      max_replans: 1,
      max_pending_artifacts: 3
    }

  defp normalize_consumed(consumed) when is_map(consumed) do
    %{
      steps: non_negative_int(value(consumed, :steps), 0),
      tool_calls: non_negative_int(value(consumed, :tool_calls), 0),
      provider_calls: non_negative_int(value(consumed, :provider_calls), 0),
      replans: non_negative_int(value(consumed, :replans), 0)
    }
  end

  defp normalize_consumed(_), do: %{steps: 0, tool_calls: 0, provider_calls: 0, replans: 0}

  defp normalize_interrupt(state) when is_map(state) do
    %{
      status: normalize_interrupt_status(value(state, :status)),
      requested_at: value(state, :requested_at)
    }
  end

  defp normalize_interrupt(_), do: %{status: :none, requested_at: nil}

  defp normalize_interrupt_status(status)
       when status in [:none, :pause_requested, :cancel_requested, :steer_requested], do: status

  defp normalize_interrupt_status("pause_requested"), do: :pause_requested
  defp normalize_interrupt_status("cancel_requested"), do: :cancel_requested
  defp normalize_interrupt_status("steer_requested"), do: :steer_requested
  defp normalize_interrupt_status(_), do: :none

  defp validate_required(errors, run) do
    Enum.reduce(@required, errors, fn key, acc ->
      if present?(Map.get(run, key)), do: acc, else: ["#{key} is required" | acc]
    end)
  end

  defp validate_goal(errors, %{text: text, version: version})
       when is_binary(text) and text != "" and is_integer(version) and version > 0,
       do: errors

  defp validate_goal(errors, _goal), do: ["goal.text and goal.version are required" | errors]

  defp validate_mode(errors, mode) when mode in [:bounded, :durable], do: errors
  defp validate_mode(errors, _mode), do: ["run_mode is invalid" | errors]

  defp validate_status(errors, status)
       when status in [
              :created,
              :running,
              :pausing,
              :cancelling,
              :paused,
              :awaiting_author,
              :completed,
              :cancelled,
              :failed
            ],
       do: errors

  defp validate_status(errors, _status), do: ["status is invalid" | errors]

  defp validate_phase(errors, phase) when phase in [:planning, :executing, :finalizing, :stopped],
    do: errors

  defp validate_phase(errors, _phase), do: ["phase is invalid" | errors]

  defp validate_bounded_long_run(errors, %{run_mode: :bounded, long_run_task_ref: ref})
       when is_binary(ref) and ref != "",
       do: ["bounded run must not require LongRunTask" | errors]

  defp validate_bounded_long_run(errors, %{run_mode: :durable, long_run_task_ref: ref})
       when is_binary(ref) and ref != "",
       do: errors

  defp validate_bounded_long_run(errors, %{run_mode: :durable}),
    do: ["durable run must link LongRunTask" | errors]

  defp validate_bounded_long_run(errors, _run), do: errors

  defp value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
  defp text(map), do: value(map, :text) |> to_string() |> String.trim()
  defp present?(value), do: is_binary(value) and String.trim(value) != ""

  defp normalized_optional_text(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      text -> text
    end
  end

  defp normalized_optional_text(nil), do: nil
  defp normalized_optional_text(value) when is_atom(value), do: Atom.to_string(value)
  defp normalized_optional_text(_value), do: nil

  defp positive_int(value, _fallback) when is_integer(value) and value > 0, do: value
  defp positive_int(_value, fallback), do: fallback

  defp non_negative_int(value, _fallback) when is_integer(value) and value >= 0, do: value
  defp non_negative_int(_value, fallback), do: fallback
end
