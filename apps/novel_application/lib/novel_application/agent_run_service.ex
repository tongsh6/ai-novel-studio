defmodule NovelApplication.AgentRunService do
  @moduledoc """
  Public application entrypoint for bounded AgentRun runtime.
  """

  alias NovelApplication.AgentRunServer
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentRun
  alias NovelPersistence.{AgentRunLog, LongRunTaskLog}

  @checkpoint_version 2

  @type step_fun :: AgentRunServer.step_fun()
  @type next_step_planner :: AgentRunServer.next_step_planner()

  @spec start_bounded(map(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def start_bounded(attrs, opts \\ []) when is_map(attrs) do
    attrs =
      attrs
      |> Map.put(:run_mode, :bounded)
      |> Map.put_new(:status, :running)
      |> Map.put_new(:phase, :executing)

    with {:ok, next_step_planner} <- next_step_planner(opts),
         {:ok, run} <- AgentRun.new(attrs),
         {:ok, _pid} <-
           DynamicSupervisor.start_child(
             NovelApplication.AgentRunSupervisor,
             {AgentRunServer,
              [
                run: run,
                next_step_planner: next_step_planner,
                event_sink: Keyword.get(opts, :event_sink)
              ]}
           ) do
      {:ok, run.run_id}
    end
  end

  @spec start_durable(map(), keyword()) :: {:ok, String.t()} | {:error, term()}
  def start_durable(attrs, opts \\ []) when is_map(attrs) do
    attrs =
      attrs
      |> atomize_known()
      |> put_durable_fact_scope()

    with {:ok, task} <- LongRunTaskLog.create(long_run_task_attrs(attrs)),
         attrs <-
           attrs
           |> Map.put(:run_mode, :durable)
           |> Map.put(:long_run_task_ref, task.id)
           |> Map.put_new(:status, :running)
           |> Map.put_new(:phase, :executing),
         {:ok, next_step_planner} <- next_step_planner(opts),
         {:ok, run} <- AgentRun.new(attrs),
         {:ok, _pid} <-
           DynamicSupervisor.start_child(
             NovelApplication.AgentRunSupervisor,
             {AgentRunServer,
              [
                run: run,
                next_step_planner: next_step_planner,
                event_sink: Keyword.get(opts, :event_sink)
              ]}
           ) do
      {:ok, run.run_id}
    else
      {:error, reason} -> {:error, reason}
    end
  end

  @spec recover_durable(String.t(), String.t(), keyword()) :: {:ok, [map()]}
  def recover_durable(work_id, session_id, opts \\ [])
      when is_binary(work_id) and is_binary(session_id) do
    recover_opts =
      opts
      |> Map.new()
      |> Map.put(:requested_work_id, work_id)
      |> Map.put(:requested_session_id, session_id)

    recovered =
      work_id
      |> active_durable_records(session_id)
      |> Enum.map(&recover_record(&1, recover_opts))
      |> Enum.reject(&is_nil/1)

    {:ok, recovered}
  end

  defp active_durable_records(work_id, session_id) do
    case AgentRunLog.list_active_durable(work_id, session_id) do
      [] -> AgentRunLog.list_active_durable_by_work(work_id)
      records -> records
    end
  end

  @spec attach_event_sink(String.t(), function() | nil) :: :ok | {:error, :not_found}
  def attach_event_sink(run_id, event_sink) when is_binary(run_id) do
    case lookup(run_id) do
      {:ok, pid} ->
        AgentRunServer.attach_event_sink(pid, event_sink)
        :ok

      error ->
        error
    end
  end

  @spec pause(String.t()) :: :ok | {:error, :not_found}
  def pause(run_id), do: command(run_id, :pause)

  @spec resume(String.t()) :: :ok | {:error, :not_found}
  def resume(run_id), do: command(run_id, :resume)

  @spec cancel(String.t()) :: :ok | {:error, :not_found}
  def cancel(run_id), do: command(run_id, :cancel)

  @spec steer(String.t(), String.t()) :: :ok | {:error, :not_found}
  def steer(run_id, text) when is_binary(text), do: command(run_id, {:steer, text})

  @doc """
  作者已在采纳边界处理了本 run 的某个候选（accept 采纳）——通知 run 观察该作者
  决定（M0 缺陷修复 2026-07-19：单候选改进循环以作者采纳为收束信号，不再对已被
  作者拿走的候选继续改进/产未请求的第二候选）。非 pending 引用为无害 no-op。
  """
  @spec notify_artifact_resolved(String.t(), String.t()) :: :ok | {:error, :not_found}
  def notify_artifact_resolved(run_id, artifact_ref) when is_binary(artifact_ref),
    do: command(run_id, {:artifact_resolved, artifact_ref})

  @spec state(String.t(), timeout()) :: {:ok, map()} | {:error, term()}
  def state(run_id, timeout \\ 5_000) do
    case lookup(run_id) do
      {:ok, pid} ->
        {:ok, AgentRunServer.state(pid, timeout)}

      error ->
        error
    end
  catch
    :exit, {:timeout, _call} -> {:error, :state_timeout}
    :exit, reason -> {:error, {:state_call_exit, reason}}
  end

  defp command(run_id, command) do
    case lookup(run_id) do
      {:ok, pid} ->
        AgentRunServer.command(pid, command)
        :ok

      error ->
        error
    end
  end

  defp next_step_planner(opts) do
    case Keyword.get(opts, :next_step_planner) do
      planner when is_function(planner, 3) -> {:ok, planner}
      _ -> {:error, :next_step_planner_required}
    end
  end

  defp lookup(run_id) when is_binary(run_id) do
    case Registry.lookup(NovelApplication.AgentRunRegistry, run_id) do
      [{pid, _}] -> {:ok, pid}
      [] -> {:error, :not_found}
    end
  end

  defp long_run_task_attrs(attrs) do
    run_id = required(attrs, :run_id)

    %{
      workspace_id: required(attrs, :work_id),
      task_type: "agent_run",
      status: "READY",
      phase: "PLANNED",
      goal: get_in_goal(attrs, :text) || required(attrs, :run_id),
      scope_ref: required(attrs, :work_id),
      created_by: "agent_run",
      parent_turn_ref: required(attrs, :parent_turn_ref),
      plan_ref: value(attrs, :plan_ref),
      checkpoint_policy_ref: "agent_run_step_checkpoint_v1",
      estimated_budget: value(attrs, :budget) || %{},
      consumed_budget: value(attrs, :consumed_budget) || %{},
      authority_scope: inspect(value(attrs, :authority_scope) || %{}),
      current_unit_ref: nil,
      completed_unit_refs: [],
      pending_artifact_refs: [],
      checkpoint_data: %{
        "agent_run" =>
          Map.merge(
            %{
              "run_id" => run_id,
              "status" => "created",
              "phase" => "planning",
              "goal_version" => get_in_goal(attrs, :version) || 1,
              "completed_step_refs" => [],
              "checkpoint_version" => @checkpoint_version
            },
            durable_fact_checkpoint_data(attrs)
          ),
        "progress" => 0,
        "step" => "AgentRun 已登记为 durable 长任务"
      }
    }
  end

  defp recover_record(record, opts) do
    with {:ok, run} <- run_from_record(record),
         %{} = task <- LongRunTaskLog.get(run.long_run_task_ref) do
      recover_live_or_checkpoint(record, run, task, opts)
    else
      _ -> nil
    end
  end

  defp recover_live_or_checkpoint(record, run, task, opts) do
    case live_state(run.run_id, opts) do
      {:ok, state} ->
        recover_live_state(record, state, task, opts)

      {:error, :not_found} ->
        recover_checkpoint_state(record, run, task, opts)
    end
  end

  defp recover_live_state(record, %{run: run} = state, task, opts) do
    stale_reason = stale_recovery_reason(record, task, Map.put(opts, :runtime_live?, true))

    {run, task, stale?} =
      if is_binary(stale_reason) do
        {run, task} = mark_stale_recovery(run, task, stale_reason)
        {run, task, true}
      else
        {run, task, false}
      end

    event = recovery_event(run, task, stale?: stale?, runtime_live?: true)

    state
    |> Map.put(:run, run)
    |> Map.put(:recovered?, true)
    |> Map.put(:runtime_live?, true)
    |> Map.put(:long_run_task, task)
    |> Map.put(:recovery_event, event)
  end

  defp recover_checkpoint_state(record, run, task, opts) do
    stale_reason = stale_recovery_reason(record, task, Map.put(opts, :runtime_live?, false))
    {run, task} = maybe_mark_checkpoint_recovery_stale(run, task, stale_reason)
    event = recovery_event(run, task, stale?: is_binary(stale_reason), runtime_live?: false)

    %{
      run: run,
      remaining_steps: 0,
      current_task?: false,
      recovered?: true,
      runtime_live?: false,
      long_run_task: task,
      recovery_event: event
    }
  end

  defp run_from_record(record) do
    AgentRun.new(%{
      run_id: record.id,
      run_mode: record.run_mode,
      workspace_id: record.workspace_id,
      work_id: record.work_id,
      session_id: record.session_id,
      parent_turn_ref: record.parent_turn_ref,
      origin_frame_ref: record.origin_frame_ref,
      profile_ref: record.profile_ref,
      goal: record.goal,
      status: record.status,
      phase: record.phase,
      plan: record.plan,
      plan_ref: record.plan_ref,
      plan_version: record.plan_version,
      current_step_ref: record.current_step_ref,
      completed_step_refs: record.completed_step_refs || [],
      authority_scope: record.authority_scope || %{},
      policy: record.run_policy || %{},
      budget: record.budget || %{},
      consumed_budget: record.consumed_budget || %{},
      interrupt_state: record.interrupt_state || %{},
      pending_artifact_refs: record.pending_artifact_refs || [],
      active_behavior_ref: record.active_behavior_ref,
      long_run_task_ref: record.long_run_task_ref,
      failure_ref: record.failure_ref
    })
  end

  defp stale_recovery_reason(record, task, opts) do
    forced = Map.get(opts, :force_stale, false)
    runtime_live? = Map.get(opts, :runtime_live?, false)
    ref_reason = stale_ref_mismatch_reason(record, opts)
    checkpoint_reason = stale_checkpoint_version_reason(task)
    fact_reason = stale_fact_revision_reason(task, opts)
    version_reason = stale_version_mismatch_reason(record, task, opts)

    cond do
      forced ->
        "forced_stale_recovery"

      is_binary(ref_reason) ->
        ref_reason

      is_binary(checkpoint_reason) ->
        checkpoint_reason

      is_binary(fact_reason) ->
        fact_reason

      is_binary(version_reason) ->
        version_reason

      not runtime_live? ->
        "durable_runtime_not_live"

      true ->
        nil
    end
  end

  defp stale_ref_mismatch_reason(record, opts) do
    cond do
      ref_mismatch?(Map.get(opts, :requested_work_id), record.work_id) ->
        "work_ref_mismatch"

      ref_mismatch?(Map.get(opts, :requested_session_id), record.session_id) ->
        "session_ref_mismatch"

      true ->
        nil
    end
  end

  defp stale_checkpoint_version_reason(task) do
    task_run = task.checkpoint_data && task.checkpoint_data["agent_run"]

    case task_run && task_run["checkpoint_version"] do
      @checkpoint_version -> nil
      nil -> "checkpoint_version_missing"
      _other -> "checkpoint_version_mismatch"
    end
  end

  defp stale_fact_revision_reason(task, opts) do
    task_run = (task.checkpoint_data && task.checkpoint_data["agent_run"]) || %{}

    cond do
      version_mismatch?(Map.get(opts, :work_revision), Map.get(task_run, "work_revision")) ->
        "work_revision_mismatch"

      version_mismatch?(Map.get(opts, :target_revision), Map.get(task_run, "target_revision")) ->
        "target_revision_mismatch"

      target_ref_missing?(Map.get(task_run, "target_revision_ref"), opts) ->
        "target_ref_missing"

      true ->
        nil
    end
  end

  defp stale_version_mismatch_reason(record, task, opts) do
    record_goal_version = record_goal_version(record)
    task_run = task.checkpoint_data && task.checkpoint_data["agent_run"]

    cond do
      version_mismatch?(Map.get(opts, :goal_version), record_goal_version) ->
        "goal_version_mismatch"

      version_mismatch?(task_run && task_run["goal_version"], record_goal_version) ->
        "checkpoint_goal_version_mismatch"

      true ->
        nil
    end
  end

  defp maybe_mark_checkpoint_recovery_stale(run, task, stale_reason) when is_binary(stale_reason),
    do: mark_stale_recovery(run, task, stale_reason)

  defp maybe_mark_checkpoint_recovery_stale(run, task, _stale_reason), do: {run, task}

  defp mark_stale_recovery(run, task, failure_ref) do
    run = %{run | status: :awaiting_author, phase: :stopped}

    {:ok, _record} =
      AgentRunLog.upsert_run(%{
        id: run.run_id,
        workspace_id: run.workspace_id,
        work_id: run.work_id,
        session_id: run.session_id,
        parent_turn_ref: run.parent_turn_ref,
        origin_frame_ref: run.origin_frame_ref,
        run_mode: Atom.to_string(run.run_mode),
        profile_ref: run.profile_ref,
        status: Atom.to_string(run.status),
        phase: Atom.to_string(run.phase),
        goal: run.goal,
        goal_version: run.goal.version,
        plan: run.plan,
        plan_ref: run.plan_ref,
        plan_version: run.plan_version,
        run_policy: stringify(run.policy),
        authority_scope: stringify(run.authority_scope),
        budget: stringify(run.budget),
        consumed_budget: stringify(run.consumed_budget),
        current_step_ref: run.current_step_ref,
        completed_step_refs: run.completed_step_refs,
        pending_artifact_refs: run.pending_artifact_refs,
        active_behavior_ref: run.active_behavior_ref,
        interrupt_state: stringify(run.interrupt_state),
        long_run_task_ref: run.long_run_task_ref,
        failure_ref: failure_ref
      })

    {:ok, task} =
      LongRunTaskLog.update(task, %{
        status: "PAUSED",
        phase: "CHECKPOINT",
        checkpoint_data:
          Map.merge(task.checkpoint_data || %{}, %{
            "stale_resume" => true,
            "stale_reason" => failure_ref,
            "step" => stale_step_text(failure_ref),
            "agent_run" =>
              Map.merge((task.checkpoint_data || %{})["agent_run"] || %{}, %{
                "status" => "awaiting_author",
                "phase" => "stopped",
                "stale_resume" => true,
                "stale_reason" => failure_ref
              })
          })
      })

    {run, task}
  end

  defp recovery_event(run, task, opts) do
    sequence = AgentRunLog.list_events(run.run_id) |> length() |> Kernel.+(1)

    {:ok, event} =
      AgentEvent.new(%{
        event_id: "evt_#{run.run_id}_recovered_#{sequence}",
        run_ref: run.run_id,
        step_ref: run.current_step_ref,
        sequence: sequence,
        event_type: :run_resumed,
        visibility: :author,
        summary: recovery_summary(task),
        reason_codes: recovery_reason_codes(task, opts),
        refs: [run.long_run_task_ref],
        payload: %{
          long_run_task_ref: run.long_run_task_ref,
          runtime_live: Keyword.get(opts, :runtime_live?, false),
          checkpoint_data: task.checkpoint_data || %{}
        },
        emitted_at: DateTime.utc_now()
      })

    _ = AgentRunLog.insert_event(event_attrs(event))
    event
  end

  defp live_state(run_id, opts) do
    with {:ok, pid} <- lookup(run_id) do
      event_sink = Map.get(opts, :event_sink)

      if is_function(event_sink, 1) do
        AgentRunServer.attach_event_sink(pid, event_sink)
      end

      {:ok, AgentRunServer.state(pid)}
    end
  end

  defp recovery_summary(%{checkpoint_data: %{"stale_resume" => true}}),
    do: "已恢复 AgentRun 检查点，但状态已过期，等待作者确认。"

  defp recovery_summary(_task), do: "已恢复 AgentRun 检查点。"

  defp recovery_reason_codes(
         %{checkpoint_data: %{"stale_resume" => true, "stale_reason" => reason}},
         opts
       ) do
    ["durable_recovered", "stale_resume", runtime_reason(opts), nonblank(reason)]
    |> Enum.reject(&is_nil/1)
  end

  defp recovery_reason_codes(_task, opts) do
    ["durable_recovered", runtime_reason(opts)]
    |> Enum.reject(&is_nil/1)
  end

  defp runtime_reason(opts) do
    if Keyword.get(opts, :runtime_live?, false), do: "runtime_live", else: "runtime_not_live"
  end

  defp stale_step_text("durable_runtime_not_live"),
    do: "后端运行进程已不存在，已从检查点恢复并等待作者确认"

  defp stale_step_text("goal_version_mismatch"),
    do: "恢复目标版本已变化，等待作者确认"

  defp stale_step_text("checkpoint_goal_version_mismatch"),
    do: "检查点目标版本与运行记录不一致，等待作者确认"

  defp stale_step_text("checkpoint_version_missing"),
    do: "恢复检查点缺少版本信息，等待作者确认"

  defp stale_step_text("checkpoint_version_mismatch"),
    do: "恢复检查点版本与当前运行语义不一致，等待作者确认"

  defp stale_step_text("work_revision_mismatch"),
    do: "恢复时作品事实版本已变化，等待作者确认"

  defp stale_step_text("target_revision_mismatch"),
    do: "恢复目标版本已变化，等待作者确认"

  defp stale_step_text("target_ref_missing"),
    do: "恢复目标已不存在，等待作者确认"

  defp stale_step_text("forced_stale_recovery"),
    do: "恢复状态需要作者重新确认"

  defp stale_step_text("work_ref_mismatch"),
    do: "恢复目标作品与运行记录不一致，等待作者确认"

  defp stale_step_text("session_ref_mismatch"),
    do: "恢复目标会话与运行记录不一致，等待作者确认"

  defp stale_step_text(_reason), do: "恢复状态已过期，等待作者确认"

  defp record_goal_version(%{goal_version: version}) when is_integer(version), do: version

  defp record_goal_version(%{goal: %{"version" => version}}) when is_integer(version),
    do: version

  defp record_goal_version(%{goal: %{version: version}}) when is_integer(version), do: version
  defp record_goal_version(_record), do: nil

  defp version_mismatch?(expected, actual) do
    case {integer_value(expected), integer_value(actual)} do
      {expected_int, actual_int} when is_integer(expected_int) and is_integer(actual_int) ->
        expected_int != actual_int

      _other ->
        false
    end
  end

  defp target_ref_missing?(target_ref, opts) do
    target_ref = nonblank(target_ref)

    cond do
      is_nil(target_ref) ->
        false

      Map.has_key?(opts, :target_ref_exists?) ->
        Map.get(opts, :target_ref_exists?) == false

      is_list(Map.get(opts, :available_target_refs)) ->
        target_ref not in Map.get(opts, :available_target_refs)

      true ->
        false
    end
  end

  defp integer_value(value) when is_integer(value), do: value

  defp integer_value(value) when is_binary(value) do
    case Integer.parse(value) do
      {parsed, ""} -> parsed
      _other -> nil
    end
  end

  defp integer_value(_value), do: nil

  defp ref_mismatch?(expected, actual)
       when is_binary(expected) and expected != "" and is_binary(actual) and actual != "",
       do: expected != actual

  defp ref_mismatch?(_expected, _actual), do: false

  defp nonblank(value) when is_binary(value) do
    if String.trim(value) == "", do: nil, else: value
  end

  defp nonblank(_value), do: nil

  defp event_attrs(%AgentEvent{} = event) do
    %{
      id: event.event_id,
      run_id: event.run_ref,
      step_id: event.step_ref,
      sequence: event.sequence,
      event_type: Atom.to_string(event.event_type),
      visibility: Atom.to_string(event.visibility),
      summary: event.summary,
      reason_codes: event.reason_codes,
      refs: event.refs,
      payload: stringify(event.payload)
    }
  end

  defp atomize_known(attrs) do
    for {key, value} <- attrs, into: %{} do
      {known_key(key), value}
    end
  end

  defp known_key(key) when is_atom(key), do: key
  defp known_key("run_id"), do: :run_id
  defp known_key("workspace_id"), do: :workspace_id
  defp known_key("work_id"), do: :work_id
  defp known_key("session_id"), do: :session_id
  defp known_key("parent_turn_ref"), do: :parent_turn_ref
  defp known_key("origin_frame_ref"), do: :origin_frame_ref
  defp known_key("profile_ref"), do: :profile_ref
  defp known_key("goal"), do: :goal
  defp known_key("plan"), do: :plan
  defp known_key("plan_ref"), do: :plan_ref
  defp known_key("budget"), do: :budget
  defp known_key("consumed_budget"), do: :consumed_budget
  defp known_key("authority_scope"), do: :authority_scope
  defp known_key("policy"), do: :policy
  defp known_key("work_revision"), do: :work_revision
  defp known_key("target_revision_ref"), do: :target_revision_ref
  defp known_key("target_revision"), do: :target_revision
  defp known_key(key), do: key

  defp value(map, key), do: Map.get(map, key) || Map.get(map, Atom.to_string(key))
  defp required(map, key), do: value(map, key) || raise(ArgumentError, "#{key} is required")

  defp get_in_goal(attrs, key) do
    case value(attrs, :goal) do
      goal when is_map(goal) -> value(goal, key)
      goal when is_binary(goal) and key == :text -> goal
      _ -> nil
    end
  end

  defp put_durable_fact_scope(attrs) do
    scope = value(attrs, :authority_scope) || %{}

    scope =
      [:work_revision, :target_revision_ref, :target_revision]
      |> Enum.reduce(scope, fn key, acc ->
        case nonblank_value(value(attrs, key) || value(acc, key)) do
          nil -> acc
          fact_value -> Map.put(acc, key, fact_value)
        end
      end)

    Map.put(attrs, :authority_scope, scope)
  end

  defp durable_fact_checkpoint_data(attrs) do
    scope = value(attrs, :authority_scope) || %{}

    %{}
    |> maybe_put_fact(
      "work_revision",
      value(attrs, :work_revision) || value(scope, :work_revision)
    )
    |> maybe_put_fact(
      "target_revision_ref",
      value(attrs, :target_revision_ref) || value(scope, :target_revision_ref)
    )
    |> maybe_put_fact(
      "target_revision",
      value(attrs, :target_revision) || value(scope, :target_revision)
    )
  end

  defp maybe_put_fact(map, key, value) do
    case nonblank_value(value) do
      nil -> map
      fact_value -> Map.put(map, key, fact_value)
    end
  end

  defp nonblank_value(value) when is_binary(value) do
    value = String.trim(value)
    if value == "", do: nil, else: value
  end

  defp nonblank_value(nil), do: nil
  defp nonblank_value(value), do: value

  defp stringify(%_struct{} = struct) do
    struct
    |> Map.from_struct()
    |> stringify()
  end

  defp stringify(value) when is_map(value) do
    Map.new(value, fn {key, item} -> {to_string(key), stringify(item)} end)
  end

  defp stringify(value) when is_list(value), do: Enum.map(value, &stringify/1)
  defp stringify(value) when is_atom(value), do: Atom.to_string(value)
  defp stringify(value), do: value
end
