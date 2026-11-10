defmodule NovelPersistence.AgentRunLog do
  @moduledoc """
  Minimal persisted AgentRun log for CP3 bounded runtime evidence.

  The hot runtime remains supervised OTP state. These records provide durable
  audit/query evidence for runs, steps, and author-safe events.
  """

  import Ecto.Query, only: [from: 2]

  alias NovelPersistence.{AuthoringSessionLog, LongRunTaskLog, Repo}

  alias NovelPersistence.Schemas.{
    AgentEventRecord,
    AgentRunRecord,
    AgentRunStepRecord,
    LongRunTask
  }

  @spec upsert_run(map()) :: {:ok, AgentRunRecord.t()} | {:error, Ecto.Changeset.t()}
  def upsert_run(%{id: id} = attrs) when is_binary(id) do
    case Repo.get(AgentRunRecord, id) do
      nil ->
        %AgentRunRecord{}
        |> AgentRunRecord.changeset(attrs)
        |> Repo.insert()

      %AgentRunRecord{} = record ->
        record
        |> AgentRunRecord.changeset(attrs)
        |> Repo.update()
    end
  end

  @spec insert_step(map()) :: {:ok, AgentRunStepRecord.t()} | {:error, Ecto.Changeset.t()}
  def insert_step(%{id: id} = attrs) when is_binary(id) do
    case Repo.get(AgentRunStepRecord, id) do
      nil ->
        %AgentRunStepRecord{}
        |> AgentRunStepRecord.changeset(attrs)
        |> Repo.insert()

      %AgentRunStepRecord{} = record ->
        record
        |> AgentRunStepRecord.changeset(attrs)
        |> Repo.update()
    end
  end

  @spec insert_event(map()) :: {:ok, AgentEventRecord.t()} | {:error, Ecto.Changeset.t()}
  def insert_event(attrs) when is_map(attrs) do
    %AgentEventRecord{}
    |> AgentEventRecord.changeset(attrs)
    |> Repo.insert()
  end

  @doc """
  运行结果提交的统一事务边界。

  callback 返回 `{:ok, value}` 时提交，返回 `{:error, reason}` 时由本函数回滚。
  应用层在这个边界内编排 InteractionLifecycle 与 `commit_snapshot/2`，不直接使用
  Repo，也不把模型/工具执行或作者等待放进事务。

  事务以 `mode: :immediate` 开启（SQLite 单写者）：同一会话的并发 run 在事务开始
  即取得写锁并串行化，避免 deferred 事务在写锁升级时因快照过期失败。嵌套调用由
  最外层事务模式决定（Ecto 嵌套事务是 savepoint）。
  """
  @spec transaction((-> {:ok, term()} | {:error, term()})) ::
          {:ok, term()} | {:error, term()}
  def transaction(fun) when is_function(fun, 0) do
    Repo.transaction(
      fn ->
        case fun.() do
          {:ok, value} -> value
          {:error, reason} -> Repo.rollback(reason)
          other -> Repo.rollback({:invalid_transaction_result, other})
        end
      end,
      mode: :immediate
    )
  rescue
    error -> {:error, error}
  catch
    :exit, reason -> {:error, reason}
  end

  @doc """
  同一事务提交 run、会话 canonical 执行段、可选 step/事件与 durable checkpoint。

  `authoring_segment`（段头 + 消息，由 application 写入边界完成 JSON 归一化）
  在同一事务内追加到会话存储。可选的 `authoring_validator/2`
  由 application 提供（非持久二元函数），在 immediate 事务取得写锁后、任何该
  snapshot 变更前，针对实际将写入的 run_record + segment 执行完整会话语义校验；
  并发写者在准备 snapshot 时看到的历史可能已过期，不能作为最终放行依据。
  未提供验证函数时保持纯存储职责（低层调用方自行保证语义）。

  失败（含会话前缀/身份/版本拒绝、会话语义拒绝、run/step/event 身份错绑、
  task 缺失、task 绑定不符、段引用错绑、SQL 拒绝、事件 changeset 错误）都回滚
  整个事务，调用方不得在失败后推进内存 canonical 或广播作者结果。

  事务以 `mode: :immediate` 开启（SQLite 单写者）：同一会话的并发 run 追加因此
  串行化，`(session_id, sequence)` / `(run_id, run_sequence)` 唯一索引保证顺序
  无空洞、无重复。嵌套在调用方事务内时由调用方事务模式决定。
  """
  @spec commit_snapshot(map(), keyword()) :: {:ok, AgentRunRecord.t()} | {:error, term()}
  def commit_snapshot(run_record, opts) when is_map(run_record) and is_list(opts) do
    steps = Keyword.get(opts, :steps, [])
    events = Keyword.get(opts, :events, [])
    checkpoint = Keyword.get(opts, :checkpoint)
    authoring_segment = Keyword.get(opts, :authoring_segment)
    authoring_validator = Keyword.get(opts, :authoring_validator)

    Repo.transaction(
      fn ->
        AuthoringSessionLog.validate_write!(run_record, authoring_segment, authoring_validator)
        run = upsert_run(run_record) |> unwrap!()

        segment_state =
          AuthoringSessionLog.append_run(run_record, authoring_segment) |> unwrap_segment!()

        validate_associations!(run, steps, events, checkpoint)
        Enum.each(steps, fn attrs -> insert_step(attrs) |> unwrap!() end)
        Enum.each(events, fn attrs -> insert_event_record(attrs) |> unwrap!() end)
        commit_checkpoint!(checkpoint, run, segment_state)
        run
      end,
      mode: :immediate
    )
  rescue
    error -> {:error, error}
  catch
    :exit, reason -> {:error, reason}
  end

  @spec get_run(String.t()) :: AgentRunRecord.t() | nil
  def get_run(run_id) when is_binary(run_id), do: Repo.get(AgentRunRecord, run_id)

  @doc """
  按 work/session 批量读取运行记录，供历史定位一次取回显式绑定的候选。

  查询本身带 scope，不会先读出其他作品或会话的私有 history 再交给 consumer 过滤。
  """
  @spec list_by_ids(String.t(), String.t(), [String.t()]) :: [AgentRunRecord.t()]
  def list_by_ids(work_id, session_id, run_ids)
      when is_binary(work_id) and is_binary(session_id) and is_list(run_ids) do
    case normalize_ids(run_ids) do
      [] ->
        []

      ids ->
        from(r in AgentRunRecord,
          where: r.work_id == ^work_id and r.session_id == ^session_id and r.id in ^ids
        )
        |> Repo.all()
    end
  end

  @spec list_steps(String.t()) :: [AgentRunStepRecord.t()]
  def list_steps(run_id) when is_binary(run_id) do
    from(s in AgentRunStepRecord,
      where: s.run_id == ^run_id,
      order_by: [asc: s.sequence]
    )
    |> Repo.all()
  end

  @doc "按 run id 批量读取已持久化步骤，供 child turn 的一次性步骤匹配。"
  @spec list_steps_by_run_ids([String.t()]) :: %{String.t() => [AgentRunStepRecord.t()]}
  def list_steps_by_run_ids(run_ids) when is_list(run_ids) do
    case normalize_ids(run_ids) do
      [] ->
        %{}

      ids ->
        from(s in AgentRunStepRecord,
          where: s.run_id in ^ids,
          order_by: [asc: s.run_id, asc: s.sequence]
        )
        |> Repo.all()
        |> Enum.group_by(& &1.run_id)
    end
  end

  @spec list_events(String.t()) :: [AgentEventRecord.t()]
  def list_events(run_id) when is_binary(run_id) do
    from(e in AgentEventRecord,
      where: e.run_id == ^run_id,
      order_by: [asc: e.sequence]
    )
    |> Repo.all()
  end

  @spec list_author_events(String.t()) :: [AgentEventRecord.t()]
  def list_author_events(run_id) when is_binary(run_id) do
    from(e in AgentEventRecord,
      where: e.run_id == ^run_id and e.visibility == "author",
      order_by: [asc: e.sequence]
    )
    |> Repo.all()
  end

  @spec list_author_events_by_run_ids([String.t()]) :: %{String.t() => [AgentEventRecord.t()]}
  def list_author_events_by_run_ids(run_ids) when is_list(run_ids) do
    case normalize_ids(run_ids) do
      [] ->
        %{}

      ids ->
        from(e in AgentEventRecord,
          where: e.run_id in ^ids and e.visibility == "author",
          order_by: [asc: e.run_id, asc: e.sequence]
        )
        |> Repo.all()
        |> Enum.group_by(& &1.run_id)
    end
  end

  @spec list_by_parent_turn(String.t(), String.t(), String.t()) :: [AgentRunRecord.t()]
  def list_by_parent_turn(work_id, session_id, parent_turn_ref)
      when is_binary(work_id) and is_binary(session_id) and is_binary(parent_turn_ref) do
    from(r in AgentRunRecord,
      where:
        r.work_id == ^work_id and r.session_id == ^session_id and
          r.parent_turn_ref == ^parent_turn_ref,
      order_by: [asc: r.inserted_at]
    )
    |> Repo.all()
  end

  @spec list_by_parent_turns(String.t(), String.t(), [String.t()]) :: [AgentRunRecord.t()]
  def list_by_parent_turns(work_id, session_id, parent_turn_refs)
      when is_binary(work_id) and is_binary(session_id) and is_list(parent_turn_refs) do
    case normalize_ids(parent_turn_refs) do
      [] ->
        []

      refs ->
        from(r in AgentRunRecord,
          where:
            r.work_id == ^work_id and r.session_id == ^session_id and
              r.parent_turn_ref in ^refs,
          order_by: [asc: r.parent_turn_ref, asc: r.inserted_at]
        )
        |> Repo.all()
    end
  end

  @spec list_active_durable(String.t(), String.t()) :: [AgentRunRecord.t()]
  def list_active_durable(work_id, session_id)
      when is_binary(work_id) and is_binary(session_id) do
    from(r in AgentRunRecord,
      where:
        r.work_id == ^work_id and r.session_id == ^session_id and r.run_mode == "durable" and
          r.status not in ["completed", "cancelled", "failed"],
      order_by: [desc: r.updated_at]
    )
    |> Repo.all()
  end

  @spec list_active_durable_by_work(String.t()) :: [AgentRunRecord.t()]
  def list_active_durable_by_work(work_id) when is_binary(work_id) do
    from(r in AgentRunRecord,
      where:
        r.work_id == ^work_id and r.run_mode == "durable" and
          r.status not in ["completed", "cancelled", "failed"],
      order_by: [desc: r.updated_at]
    )
    |> Repo.all()
  end

  @spec list_active_bounded(String.t(), String.t()) :: [AgentRunRecord.t()]
  def list_active_bounded(work_id, session_id)
      when is_binary(work_id) and is_binary(session_id) do
    from(r in AgentRunRecord,
      where:
        r.work_id == ^work_id and r.session_id == ^session_id and r.run_mode == "bounded" and
          r.status not in ["completed", "cancelled", "failed"],
      order_by: [desc: r.updated_at]
    )
    |> Repo.all()
  end

  @doc """
  B23 CP4：首次 join 的惰性收口——把仍非终态、且运行时已无进程的 bounded run
  一次性置为 `failed`（`failure_ref` 标记原因），保留历史记录可查。

  条件更新在单条 SQL 内完成（status 仍在非终态才更新），因此并发 join 至多一方
  得到 `{:ok, record}` 并负责本次失效广播；其余方得到 `:already_terminal`，不得
  重复广播。数据库拒写/读取异常统一返回 `:write_failed`，调用方不得把旧记录当成
  收口结果。零 migration：复用既有 status/phase/failure_ref/completed_at 列。
  """
  @spec mark_runtime_lost(String.t(), String.t()) ::
          {:ok, AgentRunRecord.t()}
          | {:error, :not_found | :already_terminal | :write_failed}
  def mark_runtime_lost(run_id, failure_ref)
      when is_binary(run_id) and is_binary(failure_ref) do
    now = DateTime.utc_now()

    query =
      from(r in AgentRunRecord,
        where:
          r.id == ^run_id and r.run_mode == "bounded" and
            r.status not in ["completed", "cancelled", "failed"],
        update: [
          set: [
            status: "failed",
            phase: "stopped",
            failure_ref: ^failure_ref,
            completed_at: ^now,
            updated_at: ^now
          ]
        ]
      )

    case Repo.update_all(query, []) do
      {1, _} ->
        {:ok, Repo.get!(AgentRunRecord, run_id)}

      {0, _} ->
        classify_runtime_lost_miss(run_id)
    end
  rescue
    _error -> {:error, :write_failed}
  catch
    _kind, _reason -> {:error, :write_failed}
  end

  # 更新未命中时只允许“记录确实不存在”“记录已是合法终态”或“durable 不属于本
  # 收口范围”三种情况；其余（例如并发写入后 bounded 仍非终态、读取失败）统一按
  # 写入失败返回，调用方不得据此读取旧记录或宣布收口成功。
  defp classify_runtime_lost_miss(run_id) do
    case Repo.get(AgentRunRecord, run_id) do
      nil ->
        {:error, :not_found}

      %{status: status} when status in ["completed", "cancelled", "failed"] ->
        {:error, :already_terminal}

      # durable 永远不进入 runtime-lost 收口；保留既有“未更新”返回值，调用方
      # 不得据此读取非终态记录作为收口结果。
      %{run_mode: "durable"} ->
        {:error, :already_terminal}

      _still_open ->
        {:error, :write_failed}
    end
  rescue
    _error -> {:error, :write_failed}
  catch
    _kind, _reason -> {:error, :write_failed}
  end

  defp insert_event_record(attrs) do
    %AgentEventRecord{}
    |> AgentEventRecord.changeset(attrs)
    |> Repo.insert(on_conflict: :nothing)
  end

  defp validate_associations!(run, steps, events, checkpoint) do
    Enum.each(steps, &require_run_id!(&1, run.id, :step_run_mismatch))
    Enum.each(events, &require_run_id!(&1, run.id, :event_run_mismatch))
    validate_checkpoint_binding!(run, checkpoint)
  end

  defp require_run_id!(attrs, run_id, reason) do
    if attr(attrs, :run_id) == run_id, do: :ok, else: Repo.rollback(reason)
  end

  defp validate_checkpoint_binding!(_run, nil), do: :ok

  defp validate_checkpoint_binding!(
         _run,
         %{task_ref: task_ref, attrs: attrs}
       )
       when is_binary(task_ref) and is_map(attrs),
       do: :ok

  defp validate_checkpoint_binding!(_run, _checkpoint), do: Repo.rollback(:invalid_checkpoint)

  defp commit_checkpoint!(nil, _run, _segment_state), do: :ok

  defp commit_checkpoint!(%{task_ref: ref, attrs: attrs}, run, segment_state)
       when is_binary(ref) and is_map(attrs) do
    case LongRunTaskLog.get(ref) do
      nil ->
        Repo.rollback(:checkpoint_task_missing)

      %LongRunTask{} = task ->
        validate_task_ref_matches_run!(ref, run)
        validate_task_binding!(task, run)

        attrs = preserve_segment_ref(attrs, task)
        validate_checkpoint_header!(attrs, task, run)
        validate_segment_ref!(attrs, run, segment_state)

        task
        |> LongRunTaskLog.update(attrs)
        |> unwrap!()
    end
  end

  defp commit_checkpoint!(_invalid, _run, _segment_state), do: Repo.rollback(:invalid_checkpoint)

  defp validate_task_ref_matches_run!(task_ref, run) do
    if is_binary(run.long_run_task_ref) and run.long_run_task_ref == task_ref do
      :ok
    else
      Repo.rollback(:checkpoint_task_mismatch)
    end
  end

  # task 与 run 必须真实绑定：workspace 字段在 task 侧存 work_id，parent turn 同源；
  # 已写入 header 的 run_id 属于既有绑定，不能被同作品同父轮次的另一 run 接管。
  defp validate_task_binding!(%LongRunTask{} = task, run) do
    bound_run_id = nested_get(task.checkpoint_data, [:agent_run, :run_id])

    cond do
      task.workspace_id != run.work_id ->
        Repo.rollback(:checkpoint_task_workspace_mismatch)

      task.parent_turn_ref != run.parent_turn_ref ->
        Repo.rollback(:checkpoint_task_parent_mismatch)

      is_binary(bound_run_id) and bound_run_id != run.id ->
        Repo.rollback(:checkpoint_task_run_mismatch)

      true ->
        :ok
    end
  end

  # 无新会话段的状态更新省略段引用；旧 v3 引用不能被整份 checkpoint_data 覆盖清空。
  defp preserve_segment_ref(attrs, %LongRunTask{} = task) do
    data = attr(attrs, :checkpoint_data)
    old_ref = nested_get(task.checkpoint_data, [:agent_run, :authoring_segment_ref])
    current_ref = nested_get(data, [:agent_run, :authoring_segment_ref])

    if is_map(data) and not is_nil(old_ref) and is_nil(current_ref) do
      data
      |> nested_put(["agent_run", "authoring_segment_ref"], old_ref)
      |> then(&put_attr(attrs, :checkpoint_data, &1))
    else
      attrs
    end
  end

  # 新写入 header 只接受 v3（项目未发布，不兼容旧 v2 内嵌格式）。
  # 未提供 checkpoint_data 的状态更新沿用既有 header，不制造空版本。
  defp validate_checkpoint_header!(attrs, %LongRunTask{} = _task, run) do
    case attr(attrs, :checkpoint_data) do
      nil ->
        :ok

      data when is_map(data) ->
        validate_new_checkpoint_header!(data, run)

      _other ->
        Repo.rollback(:invalid_checkpoint)
    end
  end

  defp validate_new_checkpoint_header!(data, run) do
    agent_run = nested_get(data, [:agent_run])
    version = nested_get(agent_run, [:checkpoint_version])
    header_run_id = nested_get(agent_run, [:run_id])

    cond do
      not is_map(agent_run) ->
        Repo.rollback(:checkpoint_header_missing)

      version != 3 ->
        Repo.rollback(:checkpoint_version_not_writable)

      header_run_id != run.id ->
        Repo.rollback(:checkpoint_run_mismatch)

      true ->
        :ok
    end
  end

  # durable checkpoint 的段引用：指向本 run、版本正确，且会话段在同一事务内已存在
  # （新段或既有段都算；状态更新不得让引用悬空）。
  defp validate_segment_ref!(attrs, run, segment_state) do
    agent_run = nested_get(attr(attrs, :checkpoint_data), [:agent_run])
    version = nested_get(agent_run, [:checkpoint_version])
    ref = nested_get(agent_run, [:authoring_segment_ref])
    segment_present? = not is_nil(segment_state) or AuthoringSessionLog.segment_present?(run.id)

    cond do
      not is_nil(ref) and not segment_present? ->
        Repo.rollback(:authoring_segment_missing)

      not is_nil(ref) ->
        validate_ref!(ref, run)

      version == 3 and segment_present? ->
        Repo.rollback(:authoring_segment_ref_missing)

      true ->
        :ok
    end
  end

  defp validate_ref!(ref, run) when is_map(ref) do
    keys = ref |> Map.keys() |> Enum.map(&normalize_key/1) |> Enum.sort()
    run_id = attr(ref, :run_id)
    version = attr(ref, :version)

    if keys == ["run_id", "version"] and run_id == run.id and
         version == AuthoringSessionLog.segment_format_version() do
      :ok
    else
      Repo.rollback(:authoring_segment_ref_mismatch)
    end
  end

  defp validate_ref!(_ref, _run), do: Repo.rollback(:authoring_segment_ref_mismatch)

  defp attr(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp attr(_map, _key), do: nil

  defp put_attr(attrs, key, value) do
    if Map.has_key?(attrs, key),
      do: Map.put(attrs, key, value),
      else: Map.put(attrs, to_string(key), value)
  end

  defp nested_get(value, []), do: value

  defp nested_get(value, [key | rest]) when is_map(value),
    do: nested_get(attr(value, key), rest)

  defp nested_get(_value, _path), do: nil

  defp nested_put(value, [key], item) when is_map(value), do: Map.put(value, key, item)

  defp nested_put(value, [key | rest], item) when is_map(value) do
    child = Map.get(value, key)
    Map.put(value, key, nested_put(if(is_map(child), do: child, else: %{}), rest, item))
  end

  defp normalize_key(key) when is_binary(key), do: key
  defp normalize_key(key) when is_atom(key), do: Atom.to_string(key)
  defp normalize_key(key), do: key

  defp unwrap!({:ok, value}), do: value
  defp unwrap!({:error, reason}), do: Repo.rollback(reason)

  defp unwrap_segment!({:ok, segment_state}), do: segment_state
  defp unwrap_segment!({:error, reason}), do: Repo.rollback(reason)

  defp normalize_ids(ids) do
    ids
    |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
    |> Enum.uniq()
  end
end
