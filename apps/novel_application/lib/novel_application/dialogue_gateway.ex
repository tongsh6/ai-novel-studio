defmodule NovelApplication.DialogueGateway do
  @moduledoc """
  v3 对话入口。完整主链：AuthorInput → Frame → Plan → Decision → Action/Tool/Behavior → TurnResult。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider.Execution
  alias NovelApplication.ActionValidator
  alias NovelApplication.AdoptionBoundary
  alias NovelApplication.AuthorVisible.Presenter
  alias NovelApplication.ProseRevisionService
  alias NovelDomain.AdoptionDecision
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.BehaviorState
  alias NovelDomain.CandidateSet

  def persist_turn_trace(result, ws_id, session_id, trace_persister) do
    maybe_persist_trace(
      result,
      ws_id,
      session_id,
      trace_persister || NovelApplication.persistence_tracer()
    )
  end

  # ── trace persistence ─────────────────────────

  defp maybe_persist_trace(
         {:ok, _turn_result, _trace, _candidates, _context},
         _ws_id,
         _session_id,
         nil
       ),
       do: :ok

  defp maybe_persist_trace(
         {:ok, _turn_result, trace, _candidates, _context},
         ws_id,
         session_id,
         persister
       ) do
    with attrs <- trace_to_attrs(trace, ws_id, session_id),
         :ok <- persister.(ws_id, attrs) do
      :ok
    else
      {:error, reason} ->
        LogEmit.emit(:dialogue_gateway, :persist_trace, :error, %{
          reason_code: :persistence_failed,
          outcome_detail: changeset_error_summary(reason)
        })

        :ok
    end
  end

  defp maybe_persist_trace(_, _ws_id, _session_id, _persister), do: :ok

  @doc false
  # 持久化/广播前把 turn_result 规范化为 JSON 安全形态：confirmation 路径的 turn_result
  # 内嵌 MicroPlan 等 domain struct，而 Interaction.content 是 Ecto :map（JSON）、channel
  # broadcast 走 Jason 序列化，二者都不接受无 Encoder 的嵌套 struct（Ecto.ChangeError /
  # Protocol.UndefinedError）。只展开 Jason 不能原生编码的 struct（impl 落 Encoder.Any）；
  # DateTime/Date 等有专属 Encoder 的标量 struct 原样保留（展开反而丢 ISO8601 编码）。
  # 纯 map 路径（allow_tool/reply）经此不变。公开仅为可测（@doc false，内部用途）。
  def jsonable(value) when is_struct(value) do
    case Jason.Encoder.impl_for(value) do
      Jason.Encoder.Any -> value |> Map.from_struct() |> jsonable()
      _native_encoder -> value
    end
  end

  def jsonable(value) when is_map(value), do: Map.new(value, fn {k, v} -> {k, jsonable(v)} end)
  def jsonable(value) when is_list(value), do: Enum.map(value, &jsonable/1)
  def jsonable(value), do: value

  @doc false
  def trace_to_attrs(trace, ws_id, session_id) do
    %{
      workspace_id: ws_id,
      session_id: session_id,
      trace_id: trace.trace_id,
      turn_id: trace.turn_id,
      frame_ref: trace.frame_ref,
      plan_ref: trace.plan_ref,
      decision_type: to_string(trace.decision_type),
      no_tool_reason: trace.no_tool_reason,
      no_behavior_reason: trace.no_behavior_reason,
      no_write_reason: trace.no_write_reason,
      turn_result_ref: trace.turn_result_ref,
      replay_policy: trace.replay_policy,
      redaction_level: to_string(trace.redaction_level),
      gate_order_version: trace.gate_order_version,
      gate_result_refs: jsonable(trace.gate_result_refs),
      tool_trace_refs: jsonable(trace.tool_trace_refs),
      behavior_trace_refs: jsonable(trace.behavior_trace_refs),
      state_trace_refs: jsonable(trace.state_trace_refs),
      event_order: Enum.map(trace.event_order, &to_string/1)
    }
  end

  # ── action ingestion (VS-05) ──────────────────

  @doc """
  处理作者动作输入。

  `confirm_before_execute` / `reject_or_cancel_confirmation` 的旧同步执行支路
  已退役（VS-00L §16.14）：确认与拒绝必须经统一作者动作受理
  （`WorkspaceChannel → AuthorActionAdmission/AuthorActionConfirmation`），
  由该事务创建独立作者动作 run 并提交行为关闭事实。本入口对这些动作明确拒绝，
  不再委托受理、不同步写作品事实、不发起工具调用。
  """
  @spec handle_action(AuthorActionInput.t(), map()) ::
          {:ok, map()} | {:ok, map(), map()} | {:error, String.t()}
  def handle_action(action_input, source_turn_result) do
    handle_action(action_input, source_turn_result, Execution.dependency(purpose: :tool))
  end

  @spec handle_action(AuthorActionInput.t(), map(), Execution.dependency()) ::
          {:ok, map()} | {:ok, map(), map()} | {:error, String.t()}
  def handle_action(%AuthorActionInput{}, _source_turn_result, nil), do: provider_boundary_error()

  def handle_action(
        %AuthorActionInput{action_type: "confirm_before_execute"},
        _source_turn_result,
        _provider_execution
      ) do
    # 旧同步确认执行已退役；真实入口见 WorkspaceChannel → AuthorActionConfirmation。
    {:error, :retired_synchronous_confirmation}
  end

  def handle_action(
        %AuthorActionInput{action_type: "choose_candidate"} = action_input,
        source_turn_result,
        _provider_execution
      ) do
    with :ok <- ActionValidator.validate(action_input, source_turn_result),
         {:ok, candidate_set} <- candidate_set_from_turn_result(source_turn_result, action_input),
         {:ok, chosen_candidate} <- chosen_candidate(candidate_set, action_input.candidate_ref) do
      decision =
        AdoptionBoundary.evaluate(
          candidate_set,
          chosen_candidate,
          nil,
          candidate_adoption_scope(source_turn_result)
        )

      with :ok <-
             persist_direction_adoption(
               decision,
               candidate_set,
               chosen_candidate,
               source_turn_result
             ) do
        {:ok, candidate_action_result(action_input, decision),
         candidate_turn_result(source_turn_result, chosen_candidate, decision)}
      end
    end
  end

  def handle_action(
        %AuthorActionInput{action_type: "reject_or_cancel_confirmation"},
        _source_turn_result,
        _provider_execution
      ) do
    # 拒绝同样经统一作者动作受理；旧同步入口不再接受该动作。
    {:error, :retired_synchronous_confirmation}
  end

  def handle_action(
        %AuthorActionInput{action_type: "cancel_pending_behavior"} = action_input,
        source_turn_result,
        _provider_execution
      ) do
    case ActionValidator.validate(action_input, source_turn_result) do
      :ok ->
        {:ok, cancel_waiting_action_result(action_input),
         cancel_waiting_turn_result(action_input, source_turn_result)}

      {:error, reason} ->
        {:error, reason}
    end
  end

  def handle_action(
        %AuthorActionInput{action_type: "revise_from_findings"} = action_input,
        source_turn_result,
        provider_execution
      ) do
    # VS-00E CP3：按质量发现重写——校验动作非 stale/invented 后，由 ProseRevisionService
    # 调用 prose writer 产出新的 tentative 修订草稿（原草稿保留、不自动采纳，不自我递归评估）。
    case ActionValidator.validate(action_input, source_turn_result) do
      :ok -> ProseRevisionService.revise(source_turn_result, action_input, provider_execution)
      {:error, reason} -> {:error, reason}
    end
  end

  def handle_action(%AuthorActionInput{} = action_input, source_turn_result, _provider_execution) do
    case ActionValidator.validate(action_input, source_turn_result) do
      :ok ->
        {:ok,
         %{
           action_id: action_input.action_id,
           action_type: action_input.action_type,
           status: "accepted",
           idempotency_key: action_input.idempotency_key
         }}

      {:error, reason} ->
        {:error, reason}
    end
  end

  # AU09 T2/A（2026-10-31）：方向采纳 adopt_tentative 时写 governed memory（WORK_DIRECTION）。
  # 未采纳/需确认/拒绝/幂等重复均不写；写入失败让动作失败，不静默 accepted。
  defp persist_direction_adoption(
         %AdoptionDecision{decision_type: :adopt_tentative, adoption_decision_id: decision_id},
         %CandidateSet{candidate_type: :direction} = candidate_set,
         candidate,
         source_turn_result
       ) do
    work_id = candidate.work_id || map_field(source_turn_result, :work_id)
    candidate_ref = candidate.candidate_id

    cond do
      # lobby/legacy fixture 无真实 work UUID 上下文：不写方向记忆（生产真实采纳总有 work）。
      not match?({:ok, _}, Ecto.UUID.cast(work_id)) ->
        :ok

      blank?(candidate_ref) ->
        {:error, "direction adoption missing candidate identity"}

      NovelPersistence.AdoptionRepository.direction_mutation_exists?(work_id, candidate_ref) ->
        :ok

      true ->
        attrs = %{
          actor_ref: "author",
          work_id: work_id,
          source_turn_ref: candidate_set.turn_id,
          source_task_ref: "decision:#{decision_id}",
          artifact_id: candidate_ref,
          artifact_type: :work_direction,
          base_revision: 1,
          content: candidate.content_ref || candidate.summary,
          summary: candidate.summary,
          direction_scope: "WORK",
          extra_tags: direction_tags(candidate, candidate_set, decision_id)
        }

        case NovelPersistence.AdoptionRepository.persist(attrs) do
          {:ok, _persisted} ->
            :ok

          {:error, reason} ->
            {:error, "direction adoption persistence failed: #{inspect(reason)}"}
        end
    end
  end

  defp persist_direction_adoption(_decision, _candidate_set, _candidate, _source_turn_result),
    do: :ok

  defp direction_tags(candidate, candidate_set, decision_id) do
    [
      "candidate:#{candidate.candidate_id}",
      "candidate_set:#{candidate_set.candidate_set_id}",
      "decision:#{decision_id}",
      "risk:#{candidate.risk_hint || :low}"
    ]
  end

  defp candidate_set_from_turn_result(source_turn_result, action_input) do
    candidates =
      source_turn_result
      |> map_field(:candidate_directions)
      |> List.wrap()
      |> Enum.map(&candidate_direction_to_boundary_candidate/1)
      |> Enum.reject(&is_nil/1)

    cond do
      candidates == [] ->
        {:error, "candidate set has no candidates"}

      blank?(action_input.candidate_set_ref) ->
        {:error, "choose_candidate missing candidate_set_ref"}

      blank?(action_input.candidate_ref) ->
        {:error, "choose_candidate missing candidate_ref"}

      true ->
        {:ok,
         %CandidateSet{
           candidate_set_id: action_input.candidate_set_ref,
           turn_id: map_field(source_turn_result, :turn_id),
           source_refs: [map_field(source_turn_result, :frame_ref)] |> Enum.reject(&blank?/1),
           candidate_type: :direction,
           candidates: candidates,
           stability: candidate_set_stability(source_turn_result),
           trace_ref: trace_ref(source_turn_result)
         }}
    end
  end

  defp candidate_adoption_scope(source_turn_result) do
    [
      work_id:
        map_field(source_turn_result, :current_work_id) ||
          map_field(source_turn_result, :work_id),
      source_work_id: map_field(source_turn_result, :work_id)
    ]
  end

  defp candidate_set_stability(source_turn_result) do
    source_turn_result
    |> map_field(:candidate_set_stability)
    |> normalize_candidate_set_stability()
  end

  defp normalize_candidate_set_stability(:stale), do: :stale
  defp normalize_candidate_set_stability(:adopted), do: :adopted
  defp normalize_candidate_set_stability(:conflicted), do: :conflicted
  defp normalize_candidate_set_stability("stale"), do: :stale
  defp normalize_candidate_set_stability("expired"), do: :stale
  defp normalize_candidate_set_stability("adopted"), do: :adopted
  defp normalize_candidate_set_stability("conflicted"), do: :conflicted
  defp normalize_candidate_set_stability(_), do: :tentative

  defp chosen_candidate(%CandidateSet{} = candidate_set, candidate_ref) do
    case Enum.find(candidate_set.candidates, &(&1.candidate_id == candidate_ref)) do
      nil -> {:error, "candidate not found in source turn"}
      candidate -> {:ok, candidate}
    end
  end

  defp candidate_action_result(action_input, %AdoptionDecision{} = decision) do
    %{
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      status: candidate_action_status(decision),
      idempotency_key: action_input.idempotency_key,
      candidate_set_ref: action_input.candidate_set_ref,
      candidate_ref: action_input.candidate_ref,
      adoption_decision: adoption_decision_view(decision)
    }
  end

  defp candidate_action_status(%AdoptionDecision{decision_type: :adopt_tentative}), do: "accepted"

  defp candidate_action_status(%AdoptionDecision{decision_type: :require_confirmation}),
    do: "needs_confirmation"

  defp candidate_action_status(%AdoptionDecision{decision_type: :reject}), do: "rejected"

  defp candidate_action_status(%AdoptionDecision{decision_type: :fail_with_recovery}),
    do: "failed"

  defp candidate_action_status(_decision), do: "accepted"

  defp cancel_waiting_action_result(%AuthorActionInput{} = action_input) do
    %{
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      status: "cancelled",
      idempotency_key: action_input.idempotency_key,
      behavior_ref: action_input.behavior_ref,
      target_ref: action_input.target_ref
    }
  end

  defp cancel_waiting_turn_result(%AuthorActionInput{} = action_input, source_turn_result) do
    source_turn_id = map_field(source_turn_result, :turn_id)
    turn_id = NovelFoundation.ID.unique("turn")
    behavior_state = cancel_waiting_behavior_state(action_input, source_turn_result, turn_id)
    behavior_trace_refs = terminal_behavior_trace_refs(behavior_state, :close)

    %{
      schema_version: "3.0-draft",
      turn_id: turn_id,
      parent_turn_id: source_turn_id,
      frame_ref: "frame_#{turn_id}",
      assistant_message: %{text: Presenter.cancelled_action_message(action_input.target_ref)},
      ui_cards: [],
      frame_summary: %{
        frame_type: :confirmation_answer,
        dialogue_goal: "取消等待中的操作"
      },
      trace_summary: %{
        trace_ref: "trace:#{turn_id}",
        decision_type: "cancel_waiting",
        reason_codes: ["author_cancelled_waiting_behavior"],
        source_turn_ref: source_turn_id,
        behavior_ref: action_input.behavior_ref,
        target_ref: action_input.target_ref,
        behavior_trace_refs: behavior_trace_refs,
        no_tool_reason: "author_action_does_not_call_tool",
        no_behavior_reason: "author action closed waiting behavior",
        no_write_reason: "cancel waiting action does not perform production write",
        replay_policy: %{use_recorded_frame: true, recall_provider: false},
        event_order: cancel_waiting_event_order(behavior_trace_refs)
      },
      phase: "cancelled",
      status: "cancelled",
      available_actions: [],
      behavior_state: behavior_state,
      projection_refs: [],
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false,
        state_persisted: false,
        durable_behavior_opened: false,
        decision_type: :cancel_waiting,
        reason_codes: ["author_cancelled_waiting_behavior"]
      }
    }
  end

  defp cancel_waiting_behavior_state(
         %AuthorActionInput{} = action_input,
         source_turn_result,
         closed_turn_id
       ) do
    active_behavior =
      source_turn_result
      |> map_field(:behavior_state)
      |> map_field(:active)

    source_decision = map_field(source_turn_result, :orchestrator_decision)
    source_plan = map_field(source_turn_result, :plan)
    source_trace = map_field(source_turn_result, :trace_summary)

    %BehaviorState{
      behavior_id:
        first_present([
          action_input.behavior_ref,
          map_field(active_behavior, :behavior_id),
          "behavior:#{action_input.action_id}"
        ]),
      behavior_type: cancelled_behavior_type(active_behavior),
      lifecycle_status: :cancelled,
      blocking_actor: :author,
      opened_at_turn_ref:
        first_present([
          map_field(active_behavior, :opened_at_turn_ref),
          map_field(source_turn_result, :turn_id)
        ]),
      opened_by_decision_ref:
        first_present([
          map_field(active_behavior, :opened_by_decision_ref),
          map_field(source_decision, :decision_id),
          "decision:#{action_input.action_id}"
        ]),
      frame_ref:
        first_present([
          map_field(active_behavior, :frame_ref),
          map_field(source_turn_result, :frame_ref),
          "frame:#{map_field(source_turn_result, :turn_id)}"
        ]),
      plan_ref:
        first_present([
          map_field(active_behavior, :plan_ref),
          map_field(source_plan, :plan_id),
          map_field(source_decision, :plan_ref)
        ]),
      target_ref:
        first_present([action_input.target_ref, map_field(active_behavior, :target_ref)]),
      required_next_action:
        first_present([
          map_field(active_behavior, :required_next_action),
          action_input.action_type
        ]),
      available_actions: [],
      prompt_contract: map_field(active_behavior, :prompt_contract) || %{},
      constraints: map_field(active_behavior, :constraints) || %{},
      resolution: %{
        ref: "behavior_resolution:#{closed_turn_id}",
        status: "cancelled",
        action_id: action_input.action_id,
        action_type: action_input.action_type,
        source_turn_ref: action_input.source_turn_ref,
        idempotency_key: action_input.idempotency_key
      },
      closed_at_turn_ref: closed_turn_id,
      trace_ref:
        first_present([
          map_field(source_trace, :trace_ref),
          map_field(source_trace, :trace_id),
          "behavior_trace:#{closed_turn_id}"
        ])
    }
    |> BehaviorState.snapshot()
  end

  defp terminal_behavior_trace_refs(%{history: [history | _]}, event_type) when is_map(history) do
    [
      %{
        trace_status: :summary_level,
        behavior_ref: map_field(history, :behavior_id),
        behavior_type: map_field(history, :behavior_type),
        event_type: event_type,
        event_turn_ref: map_field(history, :closed_at_turn_ref),
        decision_ref: map_field(history, :opened_by_decision_ref),
        target_ref: map_field(history, :target_ref),
        next_status: map_field(history, :status),
        required_next_action: map_field(history, :required_next_action),
        resolution_ref: map_field(history, :resolution_ref),
        trace_ref: map_field(history, :trace_ref)
      }
      |> reject_blank_values()
    ]
  end

  defp terminal_behavior_trace_refs(_behavior_state, _event_type), do: []

  defp cancel_waiting_event_order([_ | _]) do
    [
      :author_action_received,
      :behavior_close_requested,
      :behavior_trace_recorded,
      :behavior_resolution_recorded,
      :turn_result_emitted
    ]
  end

  defp cancel_waiting_event_order([]) do
    [
      :author_action_received,
      :behavior_close_requested,
      :turn_result_emitted
    ]
  end

  defp cancelled_behavior_type(active_behavior) do
    case map_field(active_behavior, :behavior_type) do

      :recovery -> :recovery
      "recovery" -> :recovery
      _ -> :confirmation
    end
  end

  defp first_present(values) do
    Enum.find(values, &(not blank?(&1)))
  end

  defp reject_blank_values(map) when is_map(map) do
    Map.reject(map, fn {_key, value} -> blank?(value) end)
  end

  defp candidate_turn_result(source_turn_result, chosen_candidate, %AdoptionDecision{} = decision) do
    adopted? = AdoptionDecision.adopted?(decision)
    turn_id = NovelFoundation.ID.unique("turn")
    title = chosen_candidate_title(source_turn_result, chosen_candidate.candidate_id)

    %{
      schema_version: "3.0-draft",
      turn_id: turn_id,
      parent_turn_id: map_field(source_turn_result, :turn_id),
      frame_ref: "frame_#{turn_id}",
      assistant_message: %{text: candidate_decision_message(decision, title)},
      ui_cards: [candidate_decision_card(decision, title)],
      frame_summary: %{
        frame_type: :confirmation_answer,
        dialogue_goal: "设置后续创作方向"
      },
      trace_summary: candidate_trace_summary(decision),
      phase: candidate_phase(decision),
      status: candidate_status(decision),
      available_actions: [],
      truthfulness: %{
        tool_called: false,
        candidate_selected: true,
        candidate_adopted: adopted?,
        artifact_adopted: adopted?,
        production_write_performed: false,
        durable_behavior_opened: false,
        reason_codes: decision.reason_codes
      },
      adoption_decision: adoption_decision_view(decision),
      projection_hints: decision.projection_hints
    }
  end

  defp candidate_phase(%AdoptionDecision{decision_type: :require_confirmation}),
    do: "awaiting_author"

  defp candidate_phase(%AdoptionDecision{decision_type: :fail_with_recovery}), do: "failed"
  defp candidate_phase(_decision), do: "completed"

  defp candidate_status(%AdoptionDecision{decision_type: :require_confirmation}),
    do: "needs_confirmation"

  defp candidate_status(%AdoptionDecision{decision_type: :reject}), do: "cancelled"

  # B13b BB-4（2026-10-23 作者拍板方案 A）：fail_with_recovery 决策 = 失败但可恢复
  # （phase 仍 failed，action_result.status 仍 failed）。
  defp candidate_status(%AdoptionDecision{decision_type: :fail_with_recovery}),
    do: "failed_recoverable"

  defp candidate_status(_decision), do: "conversational"

  defp candidate_decision_message(%AdoptionDecision{decision_type: :adopt_tentative}, title) do
    "已将「#{title}」写入创作方向记忆，后续创作可召回；不会写入章节正文。"
  end

  defp candidate_decision_message(%AdoptionDecision{decision_type: :require_confirmation}, title) do
    "「#{title}」需要进一步确认后才能设为后续创作方向。"
  end

  defp candidate_decision_message(%AdoptionDecision{decision_type: :reject}, title) do
    "「#{title}」当前不能设为后续创作方向，候选来源或状态已不满足条件。"
  end

  defp candidate_decision_message(%AdoptionDecision{decision_type: :fail_with_recovery}, title) do
    "未能将「#{title}」设为后续创作方向，请重新选择当前轮次中的候选。"
  end

  defp candidate_decision_message(_decision, title), do: "已处理「#{title}」的后续方向请求。"

  # N-SURF（ADR-0024 决策 2）：卡片是信息通告，结构上不携带动作字段；
  # 可提交动作唯一来源是 available_actions。
  defp candidate_decision_card(%AdoptionDecision{} = decision, title) do
    %{
      card_type: "result_card",
      priority: "normal",
      visibility: "always",
      title: candidate_decision_title(decision),
      body: candidate_decision_message(decision, title)
    }
  end

  defp candidate_decision_title(%AdoptionDecision{decision_type: :adopt_tentative}),
    do: "已设为后续方向"

  defp candidate_decision_title(%AdoptionDecision{decision_type: :require_confirmation}),
    do: "后续方向待确认"

  defp candidate_decision_title(%AdoptionDecision{decision_type: :reject}), do: "后续方向未设置"

  defp candidate_decision_title(%AdoptionDecision{decision_type: :fail_with_recovery}),
    do: "后续方向设置失败"

  defp candidate_decision_title(_decision), do: "后续方向已处理"

  defp candidate_trace_summary(%AdoptionDecision{} = decision) do
    %{
      decision_type: decision.decision_type,
      no_tool_reason: :user_requested_discussion,
      dialogue_goal: "设置后续创作方向",
      reason_codes: decision.reason_codes,
      turn_result_ref: decision.turn_id,
      candidate_ref: decision.candidate_ref
    }
  end

  defp adoption_decision_view(%AdoptionDecision{} = decision) do
    %{
      adoption_decision_id: decision.adoption_decision_id,
      turn_id: decision.turn_id,
      source_action_ref: decision.source_action_ref,
      candidate_ref: decision.candidate_ref,
      target_ref: decision.target_ref,
      decision_type: decision.decision_type,
      adopted_state_ref: decision.adopted_state_ref,
      state_trace_ref: decision.state_trace_ref,
      reason_codes: decision.reason_codes,
      projection_hints: decision.projection_hints,
      decision_trace_ref: decision.decision_trace_ref
    }
  end

  defp chosen_candidate_title(source_turn_result, candidate_ref) do
    source_turn_result
    |> map_field(:candidate_directions)
    |> List.wrap()
    |> Enum.find(&(map_field(&1, :direction_id) == candidate_ref))
    |> case do
      nil -> candidate_ref
      candidate -> map_field(candidate, :title) || candidate_ref
    end
  end

  defp trace_ref(source_turn_result) do
    trace_summary = map_field(source_turn_result, :trace_summary) || %{}

    map_field(trace_summary, :trace_ref) ||
      map_field(trace_summary, :trace_id) ||
      "decision_trace:#{map_field(source_turn_result, :turn_id)}"
  end

  defp map_field(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_field(_map, _key), do: nil

  defp blank?(value), do: is_nil(value) or value == ""

  defp candidate_direction_to_boundary_candidate(candidate) do
    candidate_id = map_field(candidate, :direction_id)

    if blank?(candidate_id) do
      nil
    else
      %{
        candidate_id: candidate_id,
        summary: map_field(candidate, :title) || candidate_id,
        content_ref: map_field(candidate, :pitch) || candidate_id,
        origin_ref: map_field(candidate, :source_frame_ref) || candidate_id,
        risk_hint: candidate_risk_hint(map_field(candidate, :risk_hint)),
        work_id: map_field(candidate, :work_id),
        adoption_target_ref: map_field(candidate, :adoption_target_ref) || "work_direction",
        canon_conflicts: map_field(candidate, :canon_conflicts) || []
      }
    end
  end

  defp candidate_risk_hint(:high), do: :high
  defp candidate_risk_hint(:medium), do: :medium
  defp candidate_risk_hint(:low), do: :low
  defp candidate_risk_hint("high"), do: :high
  defp candidate_risk_hint("medium"), do: :medium
  defp candidate_risk_hint("low"), do: :low
  defp candidate_risk_hint(_), do: :low

  defp provider_boundary_error do
    {:error,
     "provider execution must be explicit: inject provider execution or use the real Gateway entry"}
  end

  defp changeset_error_summary(%Ecto.Changeset{errors: errors}) when errors != [] do
    errors |> Enum.map_join("; ", fn {field, {msg, _}} -> "#{field}: #{msg}" end)
  end

  defp changeset_error_summary(other), do: inspect(other)
end
