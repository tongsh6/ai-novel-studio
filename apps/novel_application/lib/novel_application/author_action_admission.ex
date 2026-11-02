defmodule NovelApplication.AuthorActionAdmission do
  @moduledoc """
  作者动作的原子受理边界（VS-00L §16.10）。

  调用顺序固定为两步：

  1. `prepare/2` 在拥有运行的进程内生成不可变 receipt 身份、完整动作语义摘要，
     并把 receipt 身份写回 run trigger；此时不写库、不发布。
  2. `admit/2` 在 `AgentRunServer.init/1` 内、同一数据库事务中核验当前持久
     source Interaction、执行 `ActionValidator`、插入 receipt、提交初始 run 与
     `run_started` 事件。只有事务成功返回后，调用方才发布启动事件并继续执行。

  重复/冲突只回滚候选事务，不留下新 run 或事件；旧 payload-only receipt 保留
  历史边界，不补造完整摘要。
  """

  alias NovelApplication.ActionIdempotencyLedger
  alias NovelApplication.ActionValidator
  alias NovelApplication.AgentRunPersistence
  alias NovelApplication.ApprovalAudit
  alias NovelApplication.AuthorActionDecision
  alias NovelApplication.TurnInteractionService
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentRun
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.BehaviorState
  alias NovelPersistence.{AgentRunLog, AuthorActionReceiptRepo, WorkSessionRepo}

  @type context :: %{
          required(:action_input) => AuthorActionInput.t(),
          required(:source_turn_ref) => String.t(),
          optional(:source_turn_result) => map() | nil,
          optional(:work_id) => String.t() | nil,
          optional(:session_id) => String.t() | nil
        }

  @type plan :: %{
          run: AgentRun.t(),
          action_input: AuthorActionInput.t(),
          key_attrs: map(),
          receipt_id: String.t(),
          semantic_digest: String.t(),
          result: map(),
          expected_source: map() | nil
        }

  @doc """
  读取当前 work/session/source turn 的持久 assistant TurnResult。

  只使用精确 work+session+turn 作用域；不会回退到 work-only 查询或 socket 缓存。
  """
  @spec source_turn_result(String.t(), String.t(), String.t()) ::
          {:ok, map()} | {:error, atom()}
  def source_turn_result(work_id, session_id, source_turn_ref)
      when is_binary(work_id) and is_binary(session_id) and is_binary(source_turn_ref) do
    entries = WorkSessionRepo.assistant_entries(work_id, session_id, [source_turn_ref])

    results =
      entries
      |> Enum.map(&entry_turn_result/1)
      |> Enum.reject(&is_nil/1)
      |> Enum.uniq()

    case results do
      [turn_result] -> {:ok, turn_result}
      [] -> {:error, :source_turn_result_missing}
      _many -> {:error, :source_turn_result_ambiguous}
    end
  end

  def source_turn_result(_work_id, _session_id, _source_turn_ref),
    do: {:error, :source_turn_scope_unavailable}

  @doc "生成候选受理计划（纯内存）；不验证 source、不写库、不发布。"
  @spec prepare(AgentRun.t(), context()) :: {:ok, plan()} | {:error, term()}
  def prepare(%AgentRun{} = run, %{action_input: %AuthorActionInput{} = input} = spec) do
    with :ok <- ensure_context(run, input, spec),
         {:ok, key_attrs} <- key_attrs(run, input) do
      receipt_id = Ecto.UUID.generate()
      digest = ActionIdempotencyLedger.action_semantic_digest(input)
      run = put_receipt_identity(run, receipt_id)

      {:ok,
       %{
         run: run,
         action_input: input,
         key_attrs: Map.put(key_attrs, :id, receipt_id),
         receipt_id: receipt_id,
         semantic_digest: digest,
         result: admission_result(run, input, receipt_id, digest, spec),
         expected_source: Map.get(spec, :source_turn_result)
       }}
    end
  end

  @doc """
  同一事务内完成 source 核验、receipt 严格插入、run 与 run_started 提交。

  返回 `{:ok, receipt, run}` 表示已提交；`{:duplicate, receipt}` 表示同键同语义
  已有受理；`{:conflict, receipt}` 表示同键异语义；`{:error, reason}` 表示候选
  事务已回滚。
  """
  @spec admit(plan(), map()) ::
          {:ok, struct(), AgentRun.t()}
          | {:duplicate, struct()}
          | {:conflict, struct()}
          | {:error, term()}
  def admit(plan, state) when is_map(plan) and is_map(state) do
    transaction =
      AgentRunLog.transaction(fn ->
        with {:ok, source} <- load_source(plan.run, plan.action_input),
             :ok <- ensure_expected_source(plan.expected_source, source),
             :ok <- ActionValidator.validate(plan.action_input, source),
             {:ok, receipt} <-
               AuthorActionReceiptRepo.insert_strict(plan.key_attrs, plan.result),
             {:ok, snapshot} <- AgentRunPersistence.snapshot(plan.run, state, :delivery),
             {:ok, _run} <- AgentRunPersistence.commit(snapshot) do
          {:ok, receipt}
        end
      end)

    case transaction do
      {:ok, receipt} ->
        {:ok, receipt, plan.run}

      {:error, :duplicate} ->
        classify_existing(plan)

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp classify_existing(plan) do
    case AuthorActionReceiptRepo.get(plan.key_attrs) do
      nil ->
        {:error, :receipt_duplicate_not_found}

      receipt ->
        case same_semantics(receipt, plan) do
          {:ok, true} -> {:duplicate, receipt}
          {:ok, false} -> {:conflict, receipt}
          {:error, reason} -> {:error, reason}
        end
    end
  end

  @doc """
  在同一受理事务里消费确认/拒绝行为（VS-00L §16.14）。

  `source_state` 是源 AgentRunServer 的实时状态（`%{run: %AgentRun{}}`）或
  `nil`（源离线/仅历史）。事务内读取持久 source Interaction、最后明确行为快照与
  真实作者消息，一次核验后提交 receipt、子 run/启动事件、作者决定的子
  TurnResult/DecisionTrace 与行为关闭；源非终态记录在同一事务内收束为
  `author_action_handoff`，已有终态不回写。
  """
  @spec admit_handoff(plan(), map() | nil, keyword()) ::
          {:ok, map()}
          | {:duplicate, struct()}
          | {:conflict, struct()}
          | {:behavior_consumed, struct()}
          | {:error, term()}
  def admit_handoff(plan, source_state, opts \\ []) when is_map(plan) do
    store = Keyword.get(opts, :interaction_store) || TurnInteractionService.store()

    transaction =
      AgentRunLog.transaction(fn ->
        with {:ok, source_ctx} <- load_source_context(plan.run, plan.action_input),
             :ok <- ensure_expected_source(plan.expected_source, source_ctx.source),
             :ok <- ActionValidator.validate(plan.action_input, source_ctx.source),
             {:ok, behavior} <- current_behavior(plan.run, plan.action_input, source_ctx.source),
             {:ok, author} <- source_author_message(plan.run, source_ctx),
             {:ok, receipt} <- insert_behavior_receipt(plan, behavior, author),
             child_run = child_run(plan.run, receipt, behavior, author, plan.action_input),
             {:ok, decision} <-
               commit_author_decision(
                 child_run,
                 receipt,
                 source_ctx.source,
                 behavior,
                 author,
                 store
               ),
             :ok <- commit_child_initial(child_run),
             {:ok, source_run} <-
               commit_source_handoff(source_state, source_ctx, receipt, child_run) do
          {:ok,
           %{
             receipt: receipt,
             child_run: child_run,
             source_run: source_run,
             source_run_id: author.source_run_id,
             author_turn_ref: author.turn_ref,
             author_text: author.text,
             source_turn_result: source_ctx.source,
             behavior_ref: behavior.behavior_id,
             behavior: behavior,
             decision: decision
           }}
        end
      end)

    classify_handoff_transaction(transaction, plan)
  end

  defp classify_handoff_transaction({:ok, result}, _plan), do: {:ok, result}

  defp classify_handoff_transaction({:error, :duplicate}, plan), do: classify_existing(plan)

  defp classify_handoff_transaction({:error, :behavior_consumed}, plan) do
    case AuthorActionReceiptRepo.get_by_behavior(
           plan.run.work_id,
           plan.run.session_id,
           behavior_ref(plan.action_input)
         ) do
      nil -> {:error, :behavior_consumed}
      receipt -> {:behavior_consumed, receipt}
    end
  end

  defp classify_handoff_transaction({:error, {:behavior_consumed, behavior_ref}}, plan) do
    case AuthorActionReceiptRepo.get_by_behavior(
           plan.run.work_id,
           plan.run.session_id,
           behavior_ref
         ) do
      nil -> {:error, :behavior_consumed}
      receipt -> {:behavior_consumed, receipt}
    end
  end

  defp classify_handoff_transaction({:error, reason}, _plan), do: {:error, reason}

  defp load_source_context(run, input) do
    case WorkSessionRepo.assistant_entry(run.work_id, run.session_id, input.source_turn_ref) do
      nil ->
        {:error, :source_turn_result_missing}

      entry ->
        content = Map.get(entry, :content) || %{}

        case field(content, :turn_result) do
          source when is_map(source) ->
            source_run_id = field(content, :agent_run_id)
            source_run_record = source_run_id && AgentRunLog.get_run(source_run_id)
            author_turn_ref = source_author_turn_ref(source, source_run_record)

            {:ok,
             %{
               source: source,
               source_run_id: source_run_id,
               source_run_record: source_run_record,
               author_turn_ref: author_turn_ref
             }}

          _missing ->
            {:error, :source_turn_result_missing}
        end
    end
  end

  defp source_author_turn_ref(source, source_run_record) do
    trace_ref =
      source
      |> field(:trace_summary)
      |> field(:source_turn_ref)

    trace_ref || field(source_run_record || %{}, :parent_turn_ref)
  end

  defp current_behavior(run, input, source) do
    case WorkSessionRepo.latest_behavior_snapshot(run.work_id, run.session_id) do
      :absent ->
        {:error, :source_behavior_missing}

      {:ok, nil} ->
        {:error, :source_behavior_not_open}

      {:ok, %BehaviorState{} = behavior} ->
        with :ok <- ensure_behavior_open(behavior, input, source) do
          {:ok, behavior}
        end
    end
  end

  defp ensure_behavior_open(behavior, input, source) do
    action_behavior = source_action_behavior_ref(source, input.action_id)
    source_behavior = source_behavior_id(source)

    cond do
      not BehaviorState.open?(behavior) ->
        {:error, :source_behavior_not_open}

      is_binary(input.behavior_ref) and input.behavior_ref != behavior.behavior_id ->
        {:error, :source_behavior_changed}

      is_binary(action_behavior) and action_behavior != behavior.behavior_id ->
        {:error, :source_behavior_changed}

      is_binary(source_behavior) and source_behavior != behavior.behavior_id ->
        {:error, :source_behavior_changed}

      true ->
        :ok
    end
  end

  defp source_action_behavior_ref(source, action_id) do
    source
    |> field(:available_actions)
    |> List.wrap()
    |> Enum.find(%{}, &(field(&1, :action_id) == action_id))
    |> field(:behavior_ref)
  end

  defp source_behavior_id(source) do
    source
    |> field(:behavior_state)
    |> field(:active)
    |> field(:behavior_id)
  end

  defp source_author_message(run, source_ctx) do
    author_turn_ref = source_ctx.author_turn_ref

    with true <- is_binary(author_turn_ref) and String.trim(author_turn_ref) != "",
         entry when not is_nil(entry) <-
           WorkSessionRepo.user_entry(run.work_id, run.session_id, author_turn_ref),
         text when is_binary(text) <- field(Map.get(entry, :content) || %{}, :text),
         true <- String.trim(text) != "" do
      {:ok, %{turn_ref: author_turn_ref, text: text, source_run_id: source_ctx.source_run_id}}
    else
      _ -> {:error, :source_author_message_missing}
    end
  end

  defp insert_behavior_receipt(plan, behavior, author) do
    behavior_ref = behavior.behavior_id

    status =
      if plan.action_input.action_type == "confirm_before_execute",
        do: "accepted",
        else: "cancelled"

    result =
      plan.result
      |> Map.put("status", status)
      |> Map.put("behavior_ref", behavior_ref)
      |> Map.put("author_turn_ref", author.turn_ref)
      |> Map.put("source_run_id", author.source_run_id)
      |> Map.put(
        "turn_id",
        AuthorActionDecision.turn_id(plan.action_input.source_turn_ref, plan.receipt_id)
      )

    result = ApprovalAudit.enrich(plan.action_input, result)

    key_attrs = Map.put(plan.key_attrs, :behavior_ref, behavior_ref)

    case AuthorActionReceiptRepo.insert_strict(key_attrs, result) do
      {:error, :behavior_consumed} -> {:error, {:behavior_consumed, behavior_ref}}
      other -> other
    end
  end

  defp behavior_ref(input) when is_map(input) do
    input |> field(:behavior_ref)
  end

  defp child_run(run, receipt, behavior, author, input) do
    trigger =
      (run.trigger || %{})
      |> Map.put(:receipt_id, receipt.id)
      |> Map.put(:behavior_ref, behavior.behavior_id)
      |> Map.put(:author_turn_ref, author.turn_ref)
      |> Map.put(:source_run_id, author.source_run_id)
      |> Map.put(
        :source_surface_ref,
        field(behavior, :target_ref) && "author_action:#{behavior.behavior_id}"
      )

    status = if input.action_type == "confirm_before_execute", do: :running, else: :cancelled
    phase = if status == :running, do: :executing, else: :stopped

    %{run | trigger: trigger, status: status, phase: phase, active_behavior_ref: nil}
  end

  defp commit_author_decision(child_run, receipt, source, behavior, author, store) do
    decision =
      AuthorActionDecision.build(decision_kind(receipt.action_type), %{
        child_run: child_run,
        receipt_id: receipt.id,
        action_input: %AuthorActionInput{
          input_id: receipt.id,
          source_turn_ref: receipt.source_turn_ref,
          action_id: receipt.action_id,
          action_type: receipt.action_type,
          target_ref: behavior.target_ref,
          behavior_ref: behavior.behavior_id,
          idempotency_key: receipt.idempotency_key
        },
        source_turn_result: source,
        behavior: BehaviorState.summary(behavior),
        author_turn_ref: author.turn_ref,
        author_text: author.text
      })

    attrs =
      TurnInteractionService.result_attrs(
        child_run,
        decision.turn_result,
        decision.decision_trace
      )

    case TurnInteractionService.persist_result(attrs, store, decision.turn_result) do
      :ok -> {:ok, decision.turn_result}
      {:ok, persisted} -> {:ok, persisted}
      {:error, reason} -> {:error, reason}
    end
  end

  defp decision_kind("confirm_before_execute"), do: :confirm
  defp decision_kind(_action_type), do: :reject

  defp commit_child_initial(run) do
    sequence = 1

    {:ok, event} =
      AgentEvent.new(%{
        event_id: "evt_#{run.run_id}_#{sequence}",
        run_ref: run.run_id,
        step_ref: run.current_step_ref,
        sequence: sequence,
        event_type: :run_started,
        visibility: :author,
        summary: "AgentRun 已启动。",
        reason_codes: ["agent_run_started", "profile_selected"],
        refs: [],
        payload: %{
          profile_ref: run.profile_ref,
          trigger: run.trigger || %{},
          allowed_tools: Map.get(run.authority_scope || %{}, :allowed_tools, []),
          profile_selection:
            Map.get(run.authority_scope || %{}, :profile_selection) ||
              Map.get(run.authority_scope || %{}, "profile_selection") || %{}
        },
        emitted_at: DateTime.utc_now()
      })

    state = %{stage_state: %{}, events: [event], event_sequence: sequence}

    with {:ok, snapshot} <- AgentRunPersistence.snapshot(run, state, :delivery) do
      case AgentRunPersistence.commit(snapshot) do
        {:ok, _run} -> :ok
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp commit_source_handoff(source_state, source_ctx, receipt, child_run) do
    case source_state do
      %{run: %AgentRun{} = run} ->
        commit_live_source_handoff(run, receipt, child_run)

      %AgentRun{} = run ->
        commit_live_source_handoff(run, receipt, child_run)

      _ ->
        commit_persisted_source_handoff(source_ctx.source_run_record, receipt, child_run)
    end
  end

  defp commit_live_source_handoff(run, receipt, child_run) do
    cond do
      run.status in [:completed, :cancelled, :failed] ->
        {:ok, run}

      true ->
        updated = handoff_run(run, receipt, child_run)
        state = %{stage_state: %{}, events: [], event_sequence: 0}

        with {:ok, snapshot} <- AgentRunPersistence.snapshot(updated, state, :compaction),
             {:ok, _record} <- AgentRunPersistence.commit(snapshot) do
          {:ok, updated}
        end
    end
  end

  defp commit_persisted_source_handoff(nil, _receipt, _child_run), do: {:ok, nil}

  defp commit_persisted_source_handoff(record, receipt, child_run) do
    if record.status in ["completed", "cancelled", "failed"] do
      {:ok, record}
    else
      handoff = handoff_payload(receipt, child_run)

      trigger =
        (record.trigger || %{})
        |> Map.put(:handoff, handoff)
        |> Map.put(:handoff_reason, "author_action_handoff")
        |> Map.put(:successor_run_id, child_run.run_id)

      case AgentRunLog.upsert_run(%{
             id: record.id,
             status: "completed",
             phase: "stopped",
             active_behavior_ref: nil,
             trigger: AgentRunPersistence.json_safe(trigger),
             completed_at: DateTime.utc_now()
           }) do
        {:ok, updated} -> {:ok, updated}
        {:error, reason} -> {:error, reason}
      end
    end
  end

  defp handoff_payload(receipt, child_run) do
    %{
      reason: "author_action_handoff",
      successor_run_id: child_run.run_id,
      receipt_id: receipt.id,
      behavior_ref: receipt.behavior_ref,
      decision_turn_ref: AuthorActionDecision.turn_id(receipt.source_turn_ref, receipt.id)
    }
  end

  defp handoff_run(run, receipt, child_run) do
    handoff = handoff_payload(receipt, child_run)

    trigger =
      (run.trigger || %{})
      |> Map.put(:handoff, handoff)
      |> Map.put(:handoff_reason, "author_action_handoff")
      |> Map.put(:successor_run_id, child_run.run_id)

    %{run | status: :completed, phase: :stopped, trigger: trigger, active_behavior_ref: nil}
  end

  defp same_semantics(receipt, plan) do
    result = receipt.result || %{}

    case ActionIdempotencyLedger.admission_version(result) do
      :legacy ->
        {:ok, legacy_payload_matches?(result, plan.action_input)}

      {:supported, _version} ->
        {:ok, result["semantic_digest"] == plan.semantic_digest}

      {:unsupported, version} ->
        {:error, {:unsupported_admission_version, version}}
    end
  end

  # 旧记录只有 payload-only 摘要：保留其历史边界，不追加完整动作语义证据。
  defp legacy_payload_matches?(result, input) do
    case result["payload_digest"] do
      nil -> true
      digest -> digest == ActionIdempotencyLedger.payload_digest(input)
    end
  end

  defp load_source(run, input) do
    case source_turn_result(run.work_id, run.session_id, input.source_turn_ref) do
      {:ok, source} -> {:ok, source}
      {:error, reason} -> {:error, reason}
    end
  end

  defp ensure_expected_source(nil, _source), do: :ok

  defp ensure_expected_source(expected, source) when is_map(expected) do
    if expected == source, do: :ok, else: {:error, :source_turn_changed}
  end

  defp ensure_expected_source(_expected, _source), do: {:error, :source_turn_changed}

  defp ensure_context(run, input, spec) do
    cond do
      input.source_turn_ref != Map.get(spec, :source_turn_ref, input.source_turn_ref) ->
        {:error, :author_action_source_mismatch}

      run.parent_turn_ref != input.source_turn_ref ->
        {:error, :author_action_source_mismatch}

      Map.get(spec, :work_id, run.work_id) != run.work_id ->
        {:error, :author_action_scope_mismatch}

      Map.get(spec, :session_id, run.session_id) != run.session_id ->
        {:error, :author_action_scope_mismatch}

      not is_binary(run.workspace_id) or String.trim(run.workspace_id) == "" ->
        {:error, :author_action_scope_mismatch}

      true ->
        :ok
    end
  end

  defp key_attrs(run, input) do
    case ActionIdempotencyLedger.key_attrs(input, %{
           work_id: run.work_id,
           session_id: run.session_id
         }) do
      {:ok, attrs} -> {:ok, attrs}
      :skip -> {:error, :author_action_idempotency_key_required}
    end
  end

  defp put_receipt_identity(run, receipt_id) do
    trigger =
      (run.trigger || %{})
      |> Map.delete("receipt_id")
      |> Map.delete(:receipt_id)
      |> Map.put(:receipt_id, receipt_id)

    %{run | trigger: trigger}
  end

  defp admission_result(run, input, receipt_id, digest, spec) do
    trigger = run.trigger || %{}

    %{
      "action_id" => input.action_id,
      "action_type" => input.action_type,
      "idempotency_key" => input.idempotency_key,
      "status" => "accepted",
      "receipt_id" => receipt_id,
      "run_id" => run.run_id,
      "run_mode" => AgentRunPersistence.atom_string(run.run_mode),
      "long_run_task_ref" => run.long_run_task_ref,
      "source_turn_ref" => input.source_turn_ref,
      "source_surface_ref" => trigger_value(trigger, :source_surface_ref),
      "target_artifact_ref" => trigger_value(trigger, :target_artifact_ref) || input.target_ref,
      "profile_ref" => run.profile_ref,
      "goal" => AgentRunPersistence.json_safe(run.goal),
      "trigger" => AgentRunPersistence.json_safe(trigger),
      "source_agent_run_id" => source_agent_run_id(Map.get(spec, :source_turn_result)),
      "admission_version" => ActionIdempotencyLedger.action_semantic_version(),
      "semantic_digest" => digest
    }
  end

  defp source_agent_run_id(source) when is_map(source) do
    source
    |> field(:agent_run)
    |> field(:run_id)
  end

  defp source_agent_run_id(_source), do: nil

  defp entry_turn_result(entry) do
    entry
    |> field(:content)
    |> field(:turn_result)
  end

  defp trigger_value(trigger, key), do: field(trigger, key)

  defp field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp field(_map, _key), do: nil
end
