defmodule NovelApplication.AgentRunPersistence do
  @moduledoc """
  AgentRun snapshot 的唯一投影与写入请求边界。

  `AgentRunServer` 只负责状态机、received/staged 转换和提交后发布；本模块把已经
  决定纳入一次提交的 run/step/event/私有 checkpoint/durable task 事实投影为同一份
  snapshot，并通过 `commit/1` 交给 `AgentRunLog` 的唯一事务入口。

  - 普通结果与问题交付：保存本次全部非 stream 事件。
  - 普通状态快照：沿用旧策略，只在 run 进入可持久终态时保存事件。
  - 显式压缩：只提交 run 与 checkpoint，不使用 best-effort 语义。
  - 作者问题答复：只提交本次新增事件。

  本模块不执行 Provider、不持有流程状态、不复制 canonical；私有历史仍只经
  `AuthoringCheckpoint` 编解码。
  """

  alias NovelApplication.AuthoringCheckpoint
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.{AgentObservation, AgentRun, AgentStep}
  alias NovelFoundation.Enums.{Status, TaskPhase}
  alias NovelPersistence.AgentRunLog

  @checkpoint_version 3

  @type mode ::
          :delivery
          | :status_snapshot
          | :compaction
          | :question_delivery
          | :question_answer

  @type snapshot :: %{
          run_record: map(),
          steps: [map()],
          events: [map()],
          checkpoint: map() | nil
        }

  @doc "run/task checkpoint 版本决策的唯一所属点。"
  @spec checkpoint_version() :: pos_integer()
  def checkpoint_version, do: @checkpoint_version

  @doc """
  构建一次提交所需的全部 snapshot 事实。

  `state` 是 `AgentRunServer` 的实际状态 struct，但本模块只按 map 读取
  `:stage_state`、`:events` 与 `:event_sequence`，不依赖该 struct 的定义，
  避免投影层反向依赖状态机。
  """
  @spec snapshot(AgentRun.t(), map(), mode(), keyword()) :: {:ok, snapshot()} | {:error, term()}
  def snapshot(%AgentRun{} = run, state, mode, opts \\ []) when is_map(state) do
    with {:ok, checkpoint} <- private_checkpoint(run, state) do
      {:ok,
       %{
         run_record: run_attrs(run, checkpoint),
         steps: Keyword.get(opts, :steps, []),
         events: snapshot_events(mode, run, state, opts),
         checkpoint: task_checkpoint(run, state, checkpoint, mode)
       }}
    end
  end

  @doc "把 snapshot 交给 AgentRunLog 的唯一事务写入入口。"
  @spec commit(snapshot()) :: {:ok, struct()} | {:error, term()}
  def commit(%{run_record: run_record, steps: steps, events: events, checkpoint: checkpoint}) do
    AgentRunLog.commit_snapshot(run_record,
      steps: steps,
      events: events,
      checkpoint: checkpoint
    )
  end

  # ── event 请求语义 ───────────────────────────────────────────────────────

  defp snapshot_events(:delivery, _run, state, _opts), do: delivery_event_attrs(state.events)

  defp snapshot_events(:question_delivery, _run, state, _opts),
    do: delivery_event_attrs(state.events)

  defp snapshot_events(:status_snapshot, run, state, _opts) do
    if persist_events_snapshot?(run), do: delivery_event_attrs(state.events), else: []
  end

  defp snapshot_events(:compaction, _run, _state, _opts), do: []

  defp snapshot_events(:question_answer, _run, state, opts) do
    before = Keyword.fetch!(opts, :before)
    state.events |> Enum.drop(length(before.events)) |> delivery_event_attrs()
  end

  defp delivery_event_attrs(events) when is_list(events) do
    events
    |> Enum.reject(&(&1.event_type == :provider_progress))
    |> Enum.map(&event_attrs/1)
  end

  defp delivery_event_attrs(_events), do: []

  defp persist_events_snapshot?(%AgentRun{status: status}),
    do: status in [:completed, :cancelled, :failed, :awaiting_author, :paused]

  defp persist_events_snapshot?(_run), do: false

  # ── checkpoint 请求语义 ─────────────────────────────────────────────────

  defp task_checkpoint(run, state, checkpoint, mode)
       when mode in [:question_delivery, :question_answer] do
    question_checkpoint(run, state, checkpoint)
  end

  defp task_checkpoint(run, state, checkpoint, _mode),
    do: snapshot_checkpoint(run, state, checkpoint)

  defp question_checkpoint(
         %AgentRun{run_mode: :durable, long_run_task_ref: ref} = run,
         state,
         checkpoint
       )
       when is_binary(ref) do
    task_checkpoint_attrs(ref, run, state, checkpoint)
  end

  defp question_checkpoint(_run, _state, _checkpoint), do: nil

  defp snapshot_checkpoint(
         %AgentRun{run_mode: :durable, long_run_task_ref: task_ref} = run,
         state,
         checkpoint
       )
       when is_binary(task_ref) and task_ref != "" do
    task_checkpoint_attrs(task_ref, run, state, checkpoint)
  end

  defp snapshot_checkpoint(_run, _state, _checkpoint), do: nil

  defp task_checkpoint_attrs(task_ref, run, state, checkpoint) do
    %{task_ref: task_ref, attrs: long_run_task_update_attrs(run, state, checkpoint)}
  end

  # ── 私有历史 ─────────────────────────────────────────────────────────────

  defp private_checkpoint(run, state) do
    case Map.get(Map.get(state, :stage_state) || %{}, :judgment_transcript) do
      nil ->
        {:ok, nil}

      transcript ->
        AuthoringCheckpoint.encode_for_write(run, transcript)
    end
  end

  # ── durable task 投影 ───────────────────────────────────────────────────

  defp long_run_task_update_attrs(%AgentRun{} = run, state, checkpoint) do
    {status, phase} = long_run_status_phase(run.status)

    %{
      status: status,
      phase: phase,
      current_unit_ref: run.current_step_ref,
      completed_unit_refs: run.completed_step_refs,
      pending_artifact_refs: run.pending_artifact_refs,
      consumed_budget: json_safe(run.consumed_budget),
      checkpoint_data: long_run_checkpoint_data(run, state, checkpoint),
      completed_at: long_run_completed_at(run.status)
    }
  end

  defp long_run_status_phase(:completed), do: {Status.done(), TaskPhase.completed()}
  defp long_run_status_phase(:cancelled), do: {Status.cancelled(), TaskPhase.cancelled()}
  defp long_run_status_phase(:failed), do: {Status.error(), TaskPhase.failed()}

  defp long_run_status_phase(status) when status in [:paused, :awaiting_author],
    do: {Status.paused(), TaskPhase.checkpoint()}

  defp long_run_status_phase(_status), do: {Status.running(), TaskPhase.running()}

  defp long_run_completed_at(status) when status in [:completed, :cancelled, :failed],
    do: DateTime.utc_now()

  defp long_run_completed_at(_status), do: nil

  defp long_run_checkpoint_data(%AgentRun{} = run, state, checkpoint) do
    agent_run =
      Map.merge(
        %{
          "run_id" => run.run_id,
          "run_mode" => atom_string(run.run_mode),
          "status" => atom_string(run.status),
          "phase" => atom_string(run.phase),
          "profile_ref" => run.profile_ref,
          "goal_version" => run.goal.version,
          "current_step_ref" => run.current_step_ref,
          "completed_step_refs" => run.completed_step_refs,
          "pending_artifact_refs" => run.pending_artifact_refs,
          "consumed_budget" => json_safe(run.consumed_budget),
          "event_sequence" => state.event_sequence,
          "checkpoint_version" => @checkpoint_version
        },
        durable_fact_checkpoint_data(run.authority_scope)
      )
      |> maybe_put_transcript_ref(run, checkpoint)

    %{
      "agent_run" => agent_run,
      "progress" => long_run_progress(run),
      "step" => long_run_step_label(run)
    }
  end

  # durable checkpoint 只引用同一事务内保存的 run 私有历史，不再内嵌 canonical。
  defp maybe_put_transcript_ref(agent_run, _run, nil), do: agent_run

  defp maybe_put_transcript_ref(agent_run, run, _checkpoint) do
    Map.put(agent_run, "authoring_transcript_ref", AuthoringCheckpoint.ref(run.run_id))
  end

  defp long_run_progress(%AgentRun{status: :completed}), do: 100
  defp long_run_progress(%AgentRun{status: status}) when status in [:cancelled, :failed], do: 100

  defp long_run_progress(%AgentRun{budget: %{max_steps: max}, consumed_budget: %{steps: steps}})
       when is_integer(max) and max > 0 do
    min(95, round(steps * 100 / max))
  end

  defp long_run_progress(_run), do: 50

  defp long_run_step_label(%AgentRun{status: :completed}), do: "AgentRun 已完成"
  defp long_run_step_label(%AgentRun{status: :cancelled}), do: "AgentRun 已取消"
  defp long_run_step_label(%AgentRun{status: :failed}), do: "AgentRun 执行失败"
  defp long_run_step_label(%AgentRun{current_step_ref: ref}) when is_binary(ref), do: ref
  defp long_run_step_label(_run), do: "AgentRun 检查点"

  # ── run/step/event 投影 ────────────────────────────────────────────────

  defp run_attrs(%AgentRun{} = run, authoring_transcript) do
    goal = json_safe(run.goal || %{})

    run_attrs = %{
      id: run.run_id,
      workspace_id: run.workspace_id,
      work_id: run.work_id,
      session_id: run.session_id,
      parent_turn_ref: run.parent_turn_ref,
      origin_frame_ref: run.origin_frame_ref,
      run_mode: atom_string(run.run_mode),
      profile_ref: run.profile_ref,
      trigger: json_safe(run.trigger),
      status: atom_string(run.status),
      phase: atom_string(run.phase),
      goal: goal,
      goal_version: Map.get(goal, "version", 1),
      plan: json_safe(run.plan),
      plan_ref: run.plan_ref,
      plan_version: run.plan_version,
      run_policy: json_safe(run.policy),
      authority_scope: json_safe(run.authority_scope),
      budget: json_safe(run.budget),
      consumed_budget: json_safe(run.consumed_budget),
      current_step_ref: run.current_step_ref,
      completed_step_refs: run.completed_step_refs,
      pending_artifact_refs: run.pending_artifact_refs,
      active_behavior_ref: run.active_behavior_ref,
      interrupt_state: json_safe(run.interrupt_state),
      long_run_task_ref: run.long_run_task_ref,
      failure_ref: run.failure_ref,
      completed_at: terminal_completed_at(run.status)
    }

    if is_nil(authoring_transcript) do
      run_attrs
    else
      Map.put(run_attrs, :authoring_transcript, authoring_transcript)
    end
  end

  @doc "投影单个执行步骤及其观察摘要。"

  def step_attrs(%AgentStep{} = step, observations) do
    observation_refs =
      observations
      |> Enum.filter(&match?(%AgentObservation{}, &1))
      |> Enum.map(& &1.observation_id)
      |> Kernel.++(step.observation_refs)
      |> Enum.uniq()

    %{
      id: step.step_id,
      run_id: step.run_ref,
      sequence: step.sequence,
      status: atom_string(step.status),
      goal: step.goal,
      micro_plan_ref: step.micro_plan_ref,
      decision_ref: step.decision_ref,
      tool_request_ref: step.tool_request_ref,
      tool_result_ref: step.tool_result_ref,
      observation_refs: observation_refs,
      observation: observation_summary(observations),
      state_snapshot_ref: step.state_snapshot_ref,
      attempt: step.attempt,
      idempotency_key: step.idempotency_key,
      failure_ref: step.failure_ref,
      started_at: parse_datetime(step.started_at),
      completed_at: parse_datetime(step.completed_at) || DateTime.utc_now()
    }
  end

  defp event_attrs(%AgentEvent{} = event) do
    %{
      id: event.event_id,
      run_id: event.run_ref,
      step_id: event.step_ref,
      sequence: event.sequence,
      event_type: atom_string(event.event_type),
      visibility: atom_string(event.visibility),
      summary: event.summary,
      reason_codes: event.reason_codes,
      refs: event.refs,
      payload: event.payload |> Map.drop([:turn_result, "turn_result"]) |> json_safe()
    }
  end

  defp observation_summary(observations) when is_list(observations) do
    author_safe =
      observations
      |> Enum.filter(&match?(%AgentObservation{}, &1))
      |> Enum.map(&AgentObservation.author_safe_summary/1)

    %{
      "count" => length(author_safe),
      "items" => json_safe(author_safe),
      "summaries" => Enum.map(author_safe, &Map.fetch!(&1, :summary))
    }
  end

  defp terminal_completed_at(status) when status in [:completed, :cancelled, :failed],
    do: DateTime.utc_now()

  defp terminal_completed_at(_status), do: nil

  defp parse_datetime(nil), do: nil
  defp parse_datetime(%DateTime{} = datetime), do: datetime

  defp parse_datetime(value) when is_binary(value) do
    case DateTime.from_iso8601(value) do
      {:ok, datetime, _offset} -> datetime
      _error -> nil
    end
  end

  defp parse_datetime(_value), do: nil

  @doc "把投影值规范为与持久 JSON 列一致的纯 JSON 数据。"
  def json_safe(nil), do: nil
  def json_safe(value) when is_boolean(value), do: value
  def json_safe(%DateTime{} = value), do: DateTime.to_iso8601(value)

  def json_safe(%_struct{} = struct) do
    struct
    |> Map.from_struct()
    |> json_safe()
  end

  def json_safe(%{} = map) do
    for {key, value} <- map, into: %{} do
      {to_string(key), json_safe(value)}
    end
  end

  def json_safe(values) when is_list(values), do: Enum.map(values, &json_safe/1)
  def json_safe(value) when is_atom(value), do: Atom.to_string(value)
  def json_safe(value), do: value

  @doc "投影层统一的原子/字符串归一化。"
  def atom_string(value) when is_atom(value), do: Atom.to_string(value)
  def atom_string(value), do: to_string(value)

  defp durable_fact_checkpoint_data(authority_scope) do
    %{}
    |> maybe_put_fact("work_revision", scope_value(authority_scope, :work_revision))
    |> maybe_put_fact("target_revision_ref", scope_value(authority_scope, :target_revision_ref))
    |> maybe_put_fact("target_revision", scope_value(authority_scope, :target_revision))
  end

  defp maybe_put_fact(map, key, value) do
    case nonblank_value(value) do
      nil -> map
      fact_value -> Map.put(map, key, fact_value)
    end
  end

  defp scope_value(scope, key) when is_map(scope),
    do: Map.get(scope, key) || Map.get(scope, Atom.to_string(key))

  defp scope_value(_scope, _key), do: nil

  defp nonblank_value(value) when is_binary(value) do
    value = String.trim(value)
    if value == "", do: nil, else: value
  end

  defp nonblank_value(nil), do: nil
  defp nonblank_value(value), do: value
end
