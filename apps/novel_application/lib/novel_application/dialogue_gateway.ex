defmodule NovelApplication.DialogueGateway do
  @moduledoc """
  v3 对话入口。完整主链：AuthorInput → Frame → Plan → Decision → Action/Tool/Behavior → TurnResult。
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Provider.Gateway
  alias NovelApplication.ActionValidator
  alias NovelApplication.AdoptionBoundary
  alias NovelApplication.ContextAssembler
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.Planner
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnExecutionService
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.LogContext
  alias NovelDomain.AdoptionDecision
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.CandidateSet
  alias NovelDomain.ConfirmationBinding
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan

  @doc "处理作者文本输入；未注入 provider 时显式走真实 Provider Gateway。"
  @spec handle_input(map(), (String.t() -> tuple()) | nil) ::
          {:ok, map(), any(), list(), any()} | {:error, term()}
  def handle_input(input, context_fetcher \\ nil) do
    handle_input_with_provider(input, context_fetcher, &Gateway.complete/1, nil, nil)
  end

  @doc "处理作者文本输入；显式注入 provider complete_fn。"
  @spec handle_input(map(), (String.t() -> tuple()) | nil, function()) ::
          {:ok, map(), any(), list(), any()} | {:error, term()}
  def handle_input(input, context_fetcher, complete_fn) when is_function(complete_fn, 1) do
    handle_input_with_provider(input, context_fetcher, complete_fn, nil, nil)
  end

  def handle_input(_input, _context_fetcher, nil), do: provider_boundary_error()

  @doc "处理作者文本输入；显式注入 provider complete_fn 和 trace persister。"
  @spec handle_input(map(), (String.t() -> tuple()) | nil, function(), function() | nil) ::
          {:ok, map(), any(), list(), any()} | {:error, term()}
  def handle_input(input, context_fetcher, complete_fn, trace_persister)
      when is_function(complete_fn, 1) do
    handle_input_with_provider(input, context_fetcher, complete_fn, trace_persister, nil)
  end

  def handle_input(_input, _context_fetcher, nil, _trace_persister), do: provider_boundary_error()

  @doc "处理作者文本输入；显式走真实 Provider Gateway 并注入持久化回调。"
  @spec handle_input_with_gateway(
          map(),
          (String.t() -> tuple()) | nil,
          function() | nil,
          function() | nil
        ) ::
          {:ok, map(), any(), list(), any()} | {:error, term()}
  def handle_input_with_gateway(input, context_fetcher, trace_persister, memory_recorder) do
    handle_input_with_provider(
      input,
      context_fetcher,
      &Gateway.complete/1,
      trace_persister,
      memory_recorder
    )
  end

  @doc "处理作者文本输入；显式注入 provider complete_fn 和持久化回调。"
  @spec handle_input(
          map(),
          (String.t() -> tuple()) | nil,
          function(),
          function() | nil,
          function() | nil
        ) ::
          {:ok, map(), any(), list(), any()} | {:error, term()}
  def handle_input(input, context_fetcher, complete_fn, trace_persister, memory_recorder)
      when is_function(complete_fn, 1) do
    handle_input_with_provider(
      input,
      context_fetcher,
      complete_fn,
      trace_persister,
      memory_recorder
    )
  end

  def handle_input(_input, _context_fetcher, nil, _trace_persister, _memory_recorder),
    do: provider_boundary_error()

  defp handle_input_with_provider(
         %{text: text} = input,
         context_fetcher,
         complete_fn,
         trace_persister,
         memory_recorder
       )
       when is_binary(text) and byte_size(text) > 0 do
    ws_id = Map.get(input, :workspace_id, "default")
    work_id = Map.get(input, :work_id) || ws_id
    session_id = Map.get(input, :session_id) || Map.get(input, "session_id")
    generate_plan = Map.get(input, :generate_micro_plan, false)
    turn_id = Map.get(input, :turn_id) || Map.get(input, "turn_id") || allocate_turn_id()

    t0 = System.monotonic_time(:millisecond)
    LogContext.put_turn(ws_id, work_id, turn_id, session_id)

    LogEmit.emit(:dialogue_gateway, :handle_input, :start, %{
      workspace_id: ws_id,
      work_id: work_id,
      session_id: session_id
    })

    context =
      ContextAssembler.assemble_for_input(
        ws_id,
        text,
        context_fetcher_or_default(context_fetcher),
        # CP1：在应用边界按当前 provider 解析组装策略，挂到 DialogueContext envelope。
        session_id: session_id,
        assembly_policy: NovelApplication.current_assembly_policy()
      )

    frame_input = %{text: text, workspace_id: ws_id, turn_id: turn_id}
    {frame, candidates} = Planner.form_frame(frame_input, context, complete_fn)

    # Update metadata now that Planner has generated frame_id.
    LogContext.put_frame(frame.frame_id)

    case DialogueFrame.validate(frame) do
      :ok ->
        result =
          handle_valid_frame(generate_plan, frame, candidates, context, input, complete_fn)
          |> scope_turn_result(ws_id, work_id, session_id)

        persist_turn_side_effects(
          result,
          ws_id,
          session_id,
          text,
          trace_persister,
          memory_recorder
        )

        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:dialogue_gateway, :handle_input, :done, %{
          turn_id: frame.turn_id,
          frame_type: frame.frame_type,
          duration_ms: duration
        })

        result

      {:error, reasons} ->
        duration = System.monotonic_time(:millisecond) - t0

        LogEmit.emit(:dialogue_gateway, :handle_input, :error, %{
          duration_ms: duration,
          reason_code: :frame_validation_failed,
          outcome_detail: Enum.join(reasons, "; ")
        })

        {:error, "frame validation failed: #{Enum.join(reasons, "; ")}"}
    end
  end

  defp handle_input_with_provider(_, _fetcher, _complete_fn, _trace_persister, _memory_recorder) do
    LogEmit.emit(:dialogue_gateway, :handle_input, :error, %{
      reason_code: :empty_text,
      outcome_detail: "text is required"
    })

    {:error, "text is required"}
  end

  defp provider_boundary_error do
    {:error,
     "provider complete_fn must be explicit: inject a function or use the real Gateway entry"}
  end

  defp context_fetcher_or_default(nil),
    do: NovelApplication.persistence_fetcher() || (&empty_context/1)

  defp context_fetcher_or_default(fetcher), do: fetcher

  defp empty_context(_workspace_id), do: {:ok, nil, nil, nil, nil}

  defp allocate_turn_id, do: "turn_#{System.unique_integer([:positive, :monotonic])}"

  defp scope_turn_result(
         {:ok, turn_result, trace, candidates, context},
         ws_id,
         work_id,
         session_id
       ) do
    {:ok, put_turn_result_scope(turn_result, ws_id, work_id, session_id), trace, candidates,
     context}
  end

  defp scope_turn_result(result, _ws_id, _work_id, _session_id), do: result

  defp put_turn_result_scope(turn_result, ws_id, work_id, session_id) do
    turn_result
    |> Map.put_new(:workspace_id, ws_id)
    |> Map.put_new(:work_id, work_id)
    |> Map.put_new(:session_id, session_id)
  end

  defp handle_valid_frame(generate_plan, frame, candidates, context, input, complete_fn) do
    if needs_micro_plan?(frame, generate_plan) do
      handle_with_plan(frame, candidates, context, input, complete_fn)
    else
      handle_reply_only(frame, candidates, context)
    end
  end

  defp persist_turn_side_effects(
         result,
         ws_id,
         session_id,
         text,
         trace_persister,
         memory_recorder
       ) do
    maybe_persist_trace(
      result,
      ws_id,
      session_id,
      trace_persister || NovelApplication.persistence_tracer()
    )

    maybe_record_interactions(
      result,
      ws_id,
      session_id,
      text,
      memory_recorder || NovelApplication.persistence_interaction_recorder()
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

  defp maybe_record_interactions(
         {:ok, turn_result, _trace, _candidates, _context},
         ws_id,
         session_id,
         user_text,
         recorder
       )
       when is_function(recorder, 2) do
    entries = interaction_entries(ws_id, session_id, turn_result, user_text)

    case recorder.(ws_id, entries) do
      :ok ->
        :ok

      {:error, reason} ->
        LogEmit.emit(:dialogue_gateway, :persist_interaction, :error, %{
          reason_code: :persistence_failed,
          outcome_detail: changeset_error_summary(reason)
        })

        :ok
    end
  end

  defp maybe_record_interactions(_, _ws_id, _session_id, _user_text, _recorder), do: :ok

  defp interaction_entries(ws_id, session_id, turn_result, user_text) do
    turn_id =
      Map.get(turn_result, :turn_id, "turn_#{System.unique_integer([:positive, :monotonic])}")

    assistant_text = get_in(turn_result, [:assistant_message, :text]) || ""

    [
      interaction_entry(ws_id, session_id, turn_id, "user", user_text, nil),
      interaction_entry(ws_id, session_id, turn_id, "assistant", assistant_text, turn_result)
    ]
  end

  defp interaction_entry(ws_id, session_id, turn_id, role, text, turn_result) do
    %{
      session_id: session_id,
      turn_id: turn_id,
      role: role,
      content: interaction_content(text, turn_result),
      source_ref: turn_id,
      scope_ref: ws_id,
      freshness_score: 1.0,
      importance_score: 0.5,
      replayable: true,
      retrievable: true
    }
  end

  defp interaction_content(text, nil), do: %{text: text}

  defp interaction_content(text, turn_result),
    do: %{text: text, turn_result: jsonable(turn_result)}

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

  defp trace_to_attrs(trace, ws_id, session_id) do
    %{
      workspace_id: ws_id,
      session_id: session_id,
      trace_id: trace.trace_id,
      turn_id: trace.turn_id,
      frame_ref: trace.frame_ref,
      decision_type: to_string(trace.decision_type),
      no_tool_reason: trace.no_tool_reason,
      no_behavior_reason: trace.no_behavior_reason,
      no_write_reason: trace.no_write_reason,
      turn_result_ref: trace.turn_result_ref,
      replay_policy: trace.replay_policy,
      redaction_level: to_string(trace.redaction_level),
      event_order: Enum.map(trace.event_order, &to_string/1)
    }
  end

  # ── action ingestion (VS-05) ──────────────────

  @doc """
  处理作者动作输入。confirm_before_execute 触发 re-gate → tool dispatch
  （ADR-0009 + 05-turn-behavior §18 不变量 #5）；其他动作走 validator。
  """
  @spec handle_action(AuthorActionInput.t(), map()) ::
          {:ok, map()} | {:ok, map(), map()} | {:error, String.t()}
  def handle_action(action_input, source_turn_result) do
    handle_action(action_input, source_turn_result, &Gateway.complete/1)
  end

  @spec handle_action(AuthorActionInput.t(), map(), function() | nil) ::
          {:ok, map()} | {:ok, map(), map()} | {:error, String.t()}
  def handle_action(
        %AuthorActionInput{action_type: "confirm_before_execute"} = action_input,
        source_turn_result,
        complete_fn
      )
      when is_function(complete_fn, 1) do
    case ActionValidator.validate(action_input, source_turn_result) do
      {:error, reason} ->
        {:error, reason}

      :ok ->
        # turn_result 携带的 plan 是 JSON 安全 map（broadcast/持久化要求，见
        # handle_behavior_open）；进程内为 atom key、resume 恢复后为 string key，
        # 统一经 MicroPlan.from_map 恢复 struct 再 re-gate（ADR-0009）。
        plan = MicroPlan.from_map(source_turn_result[:plan] || source_turn_result["plan"])
        confirm_with_plan(plan, action_input, source_turn_result, complete_fn)
    end
  end

  def handle_action(
        %AuthorActionInput{action_type: "choose_candidate"} = action_input,
        source_turn_result,
        complete_fn
      )
      when is_function(complete_fn, 1) do
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

      {:ok, candidate_action_result(action_input, decision),
       candidate_turn_result(source_turn_result, chosen_candidate, decision)}
    end
  end

  def handle_action(%AuthorActionInput{} = action_input, source_turn_result, complete_fn)
      when is_function(complete_fn, 1) do
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

  def handle_action(%AuthorActionInput{}, _source_turn_result, nil), do: provider_boundary_error()

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

  defp candidate_adoption_scope(source_turn_result) do
    [
      work_id:
        map_field(source_turn_result, :current_work_id) ||
          map_field(source_turn_result, :work_id),
      source_work_id: map_field(source_turn_result, :work_id)
    ]
  end

  defp candidate_risk_hint(:high), do: :high
  defp candidate_risk_hint(:medium), do: :medium
  defp candidate_risk_hint(:low), do: :low
  defp candidate_risk_hint("high"), do: :high
  defp candidate_risk_hint("medium"), do: :medium
  defp candidate_risk_hint("low"), do: :low
  defp candidate_risk_hint(_), do: :low

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
    if Enum.any?(candidate_set.candidates, &(&1.candidate_id == candidate_ref)) do
      {:ok, %{candidate_id: candidate_ref}}
    else
      {:error, "candidate not found in source turn"}
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

  defp candidate_turn_result(source_turn_result, chosen_candidate, %AdoptionDecision{} = decision) do
    adopted? = AdoptionDecision.adopted?(decision)
    turn_id = "turn_#{System.unique_integer([:positive, :monotonic])}"
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
  defp candidate_status(%AdoptionDecision{decision_type: :fail_with_recovery}), do: "failed"
  defp candidate_status(_decision), do: "conversational"

  defp candidate_decision_message(%AdoptionDecision{decision_type: :adopt_tentative}, title) do
    "已将「#{title}」设为后续创作方向；这不会写入章节正文或作品事实。"
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

  defp candidate_decision_card(%AdoptionDecision{} = decision, title) do
    %{
      card_type: "result_card",
      priority: "normal",
      visibility: "always",
      title: candidate_decision_title(decision),
      body: candidate_decision_message(decision, title),
      actions: []
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

  # ── confirmation re-gate (Strategy 1 / ADR-0009) ─

  defp confirm_with_plan(nil, _action_input, _source_turn_result, _complete_fn) do
    {:error, "confirmation without stored plan — cannot re-gate"}
  end

  # 确认必须绑定 open confirmation（ADR-0009 / VS-03 §5）：绑定字段取自服务端授权的
  # available_action 条目（AU04-I5：UI 不能自报权限字段）。
  defp confirm_with_plan(plan, action_input, source_turn_result, complete_fn) do
    case build_confirmation_binding(action_input, source_turn_result) do
      {:ok, binding} ->
        handle_confirmation_dispatch(action_input, source_turn_result, plan, binding, complete_fn)

      {:error, reason} ->
        {:error, reason}
    end
  end

  # 从服务端授权的 available_action 条目构造 ConfirmationBinding：behavior_ref /
  # target_ref / idempotency_key 取服务端下发值（ActionValidator 已验证该 action
  # 存在且未过期），author_input_ref 取本次作者动作。缺 behavior_ref 等于没有
  # open confirmation 可绑定 → 拒绝（VS-03 §5 规则 1）。
  defp build_confirmation_binding(action_input, source_turn_result) do
    source_action =
      source_turn_result
      |> map_field(:available_actions)
      |> List.wrap()
      |> Enum.find(%{}, &(map_field(&1, :action_id) == action_input.action_id))

    ConfirmationBinding.build(%{
      behavior_ref: map_field(source_action, :behavior_ref) || action_input.behavior_ref,
      target_ref: map_field(source_action, :target_ref) || action_input.target_ref,
      author_input_ref: action_input.input_id,
      answer_type: :confirm,
      idempotency_key: map_field(source_action, :idempotency_key) || action_input.idempotency_key
    })
  end

  defp handle_confirmation_dispatch(action_input, source_turn_result, plan, binding, complete_fn) do
    frame = frame_from_turn_result(source_turn_result)

    {decision, _behavior} =
      ExecutionOrchestrator.decide(frame, plan, confirmation_binding: binding)

    ack = %{
      action_id: action_input.action_id,
      action_type: action_input.action_type,
      status: "accepted",
      idempotency_key: action_input.idempotency_key
    }

    if decision.decision_type == :allow_tool do
      # CP1（关 G9）：确认后的执行与正常路径**同源组装**上下文——重新经 ContextAssembler
      # 取当前作品 snapshot/章节列表 + 挂组装策略，并注入 chapter_prose_reader。
      # 否则高风险 rewrite 确认后反而拿不到本章已采纳正文（原 context:nil 会让重写凭空另写）。
      context =
        ContextAssembler.assemble_for_input(
          frame.workspace_id,
          nil,
          context_fetcher_or_default(nil),
          assembly_policy: NovelApplication.current_assembly_policy()
        )

      {turn_result, trace} =
        TurnExecutionService.execute(%{
          frame: frame,
          plan: plan,
          decision: decision,
          candidates: [],
          context: context,
          author_input: %{text: frame.author_visible_draft.message},
          source_turn_ref: map_field(source_turn_result, :turn_id),
          complete_fn: complete_fn,
          chapter_prose_reader: NovelApplication.persistence_chapter_prose_reader(),
          idempotency_suffix: "_confirmed"
        })

      maybe_persist_trace(
        {:ok, turn_result, trace, [], nil},
        frame.workspace_id,
        nil,
        NovelApplication.persistence_tracer()
      )

      {:ok, ack, turn_result}
    else
      {:ok, Map.put(ack, :status, "confirmed_but_blocked")}
    end
  end

  defp frame_from_turn_result(tr) do
    # source turn_result 可能是 resume 恢复的 string-keyed 形态，refs 用 map_field 双取。
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: map_field(tr, :frame_ref) || "recovered_frame",
      turn_id: map_field(tr, :turn_id) || "recovered_turn",
      workspace_id: map_field(tr, :workspace_id) || "recovered",
      primary: true,
      frame_type: :confirmation_answer,
      source_refs: %{},
      dialogue_goal: %{summary: "作者确认执行"},
      tool_need: %{needs_tool: true, reason_code: :no_tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "确认执行"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  # ── reply-only ────────────────────────────────

  defp handle_reply_only(frame, candidates, context) do
    {trace, trace_summary} = TraceWriter.record(frame, %{turn_id: frame.turn_id}, context)
    turn_result = TurnResultBuilder.build(frame, trace_summary, candidates)
    {:ok, turn_result, trace, candidates, context}
  end

  # ── plan + decision + behavior ────────────────

  # Strategy 3: use frame.tool_need.needs_tool as the primary gate;
  # generate_plan param acts as override (author says "帮我规划一下").
  defp needs_micro_plan?(frame, generate_plan) do
    generate_plan || frame.tool_need.needs_tool
  end

  defp handle_with_plan(frame, candidates, context, author_input, complete_fn) do
    case Planner.form_micro_plan(frame, author_input, complete_fn, context) do
      {:ok, plan} ->
        {decision, behavior} = ExecutionOrchestrator.decide(frame, plan)

        cond do
          decision.decision_type == :allow_tool ->
            handle_tool_dispatch(
              frame,
              plan,
              decision,
              candidates,
              context,
              author_input,
              complete_fn
            )

          behavior != nil ->
            handle_behavior_open(frame, plan, decision, behavior, candidates, context)

          true ->
            handle_blocked_plan(frame, plan, decision, candidates, context)
        end

      {:error, _reason} ->
        {trace, trace_summary} =
          TraceWriter.record_recovery(frame, %{turn_id: frame.turn_id}, context)

        turn_result = TurnResultBuilder.build(frame, trace_summary, candidates)
        {:ok, turn_result, trace, candidates, context}
    end
  end

  defp handle_blocked_plan(frame, plan, decision, candidates, context) do
    {trace, trace_summary} =
      TraceWriter.record_with_decision(frame, plan, decision, %{turn_id: frame.turn_id}, context)

    turn_result = TurnResultBuilder.build(frame, trace_summary, candidates, decision)
    {:ok, turn_result, trace, candidates, context}
  end

  defp handle_behavior_open(frame, plan, decision, behavior, candidates, context) do
    {trace, trace_summary} =
      TraceWriter.record_with_decision(frame, plan, decision, %{turn_id: frame.turn_id}, context)

    # plan 是确认 re-gate 的载体（ADR-0009），但 TurnResult 要经 channel broadcast（Jason）
    # 与 Interaction 持久化（Ecto :map），raw struct 会 Protocol.UndefinedError /
    # Ecto.ChangeError。这里放 JSON 安全形态，确认侧用 MicroPlan.from_map 恢复。
    turn_result =
      TurnResultBuilder.build(frame, trace_summary, candidates, decision, nil, nil, behavior)
      |> Map.put(:plan, jsonable(plan))
      |> Map.put(:workspace_id, frame.workspace_id)

    {:ok, turn_result, trace, candidates, context}
  end

  # ── tool dispatch ─────────────────────────────

  defp handle_tool_dispatch(frame, plan, decision, candidates, context, author_input, complete_fn) do
    {turn_result, trace} =
      TurnExecutionService.execute(%{
        frame: frame,
        plan: plan,
        decision: decision,
        candidates: candidates,
        context: context,
        author_input: author_input,
        complete_fn: complete_fn,
        chapter_prose_reader: NovelApplication.persistence_chapter_prose_reader()
      })

    {:ok, turn_result, trace, candidates, context}
  end

  defp changeset_error_summary(%Ecto.Changeset{errors: errors}) when errors != [] do
    errors |> Enum.map_join("; ", fn {field, {msg, _}} -> "#{field}: #{msg}" end)
  end

  defp changeset_error_summary(other), do: inspect(other)
end
