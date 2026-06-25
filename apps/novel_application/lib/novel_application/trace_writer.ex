defmodule NovelApplication.TraceWriter do
  @moduledoc """
  v3 trace 写入。覆盖 reply_only、decision、tool、recovery 全部 trace 类型。
  """

  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.TraceRedactor
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.BehaviorState
  alias NovelDomain.ContextSourceRef
  alias NovelDomain.DecisionTrace
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @doc "Record reply-only/exploration trace."
  @spec record(DialogueFrame.t(), map(), DialogueContext.t() | nil) :: {DecisionTrace.t(), map()}
  def record(%DialogueFrame{} = frame, turn_result, context \\ nil) do
    trace_id = allocate_trace_id()
    context_refs = if context, do: context.context_refs, else: []

    trace = %DecisionTrace{
      trace_id: trace_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      decision_type: decision_type(frame.frame_type),
      no_tool_reason: to_string(frame.tool_need.reason_code),
      no_behavior_reason: no_behavior_reason(frame.frame_type),
      no_write_reason: "this turn does not perform production write",
      turn_result_ref: turn_result[:turn_id] || frame.turn_id,
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      redaction_level: :author_safe,
      event_order: build_event_order(context)
    }

    summary =
      %{
        trace_ref: trace_id,
        decision_type: trace.decision_type,
        frame_type: frame.frame_type,
        dialogue_goal: frame.dialogue_goal.summary,
        no_tool_reason: trace.no_tool_reason,
        context_refs: format_context_refs(context_refs),
        has_context: context != nil and DialogueContext.has_context?(context)
      }
      |> maybe_put_ai_message_envelope(frame)

    {trace, TraceRedactor.author_safe(summary)}
  end

  @doc "Record trace with OrchestratorDecision and gate results."
  @spec record_with_decision(
          DialogueFrame.t(),
          MicroPlan.t(),
          OrchestratorDecision.t(),
          map(),
          DialogueContext.t() | nil
        ) :: {DecisionTrace.t(), map()}
  def record_with_decision(
        %DialogueFrame{} = frame,
        %MicroPlan{} = plan,
        %OrchestratorDecision{} = decision,
        turn_result,
        context
      ) do
    trace_id = allocate_trace_id()
    context_refs = if context, do: context.context_refs, else: []

    trace = %DecisionTrace{
      trace_id: trace_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_type: decision_type_for(decision.decision_type),
      no_tool_reason: "micro_plan_evaluated_by_orchestrator",
      no_behavior_reason: no_behavior_reason(frame.frame_type),
      no_write_reason: "orchestrator blocked execution: #{decision.first_blocking_gate}",
      turn_result_ref: turn_result[:turn_id] || frame.turn_id,
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      redaction_level: :author_safe,
      event_order: [
        :author_input_received,
        :dialogue_context_attached,
        :dialogue_frame_validated,
        :micro_plan_generated,
        :planner_boundary_validated,
        :gate_evaluation_started,
        :orchestrator_decision_recorded,
        :turn_result_emitted
      ]
    }

    summary =
      %{
        trace_ref: trace_id,
        plan_ref: plan.plan_id,
        decision_type: trace.decision_type,
        frame_type: frame.frame_type,
        dialogue_goal: frame.dialogue_goal.summary,
        plan_goal: plan.plan_goal.summary,
        plan_actions: length(plan.proposed_actions),
        orchestrator_decision: decision.decision_type,
        first_blocking_gate: decision.first_blocking_gate,
        reason_codes: decision.reason_codes,
        context_refs: format_context_refs(context_refs)
      }
      |> maybe_put_ai_message_envelope(frame)

    {trace, TraceRedactor.author_safe(summary)}
  end

  @doc "Record trace with tool execution (VS-02)."
  @spec record_with_tool(
          DialogueFrame.t(),
          MicroPlan.t(),
          OrchestratorDecision.t(),
          ToolRequest.t(),
          ToolResult.t(),
          map(),
          DialogueContext.t() | nil
        ) :: {DecisionTrace.t(), map()}
  def record_with_tool(
        %DialogueFrame{} = frame,
        %MicroPlan{} = plan,
        %OrchestratorDecision{} = decision,
        %ToolRequest{} = req,
        %ToolResult{} = result,
        turn_result,
        context
      ) do
    trace_id = allocate_trace_id()
    context_refs = if context, do: context.context_refs, else: []

    trace = %DecisionTrace{
      trace_id: trace_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_type: :tool_dispatched,
      no_tool_reason: "tool_was_dispatched",
      no_behavior_reason: "tool_execution_completed",
      no_write_reason: "tool_result_not_adoption_awaiting_adoption_boundary",
      turn_result_ref: turn_result[:turn_id] || frame.turn_id,
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      redaction_level: :author_safe,
      tool_trace_refs: [tool_trace_ref(req, result, decision)],
      event_order: [
        :author_input_received,
        :dialogue_frame_validated,
        :micro_plan_generated,
        :orchestrator_decision_allow_tool,
        :tool_request_constructed,
        :tool_dispatched,
        :tool_result_received,
        :tool_trace_recorded,
        :turn_result_emitted
      ]
    }

    summary =
      %{
        trace_ref: trace_id,
        plan_ref: plan.plan_id,
        decision_type: :tool_dispatched,
        tool_name: req.tool_name,
        tool_version: req.tool_version,
        tool_status: result.status,
        tool_request_id: req.tool_request_id,
        tool_result_id: result.tool_result_id,
        decision_ref: decision.decision_id,
        adoption_status: "not_adopted",
        context_refs: format_context_refs(context_refs)
      }
      |> maybe_put_omissions(turn_result)
      |> maybe_put_brief_ref(turn_result)
      |> maybe_put_ai_message_envelope(frame)

    {trace, TraceRedactor.author_safe(summary)}
  end

  @doc "Attach a behavior lifecycle ref to an already allocated DecisionTrace."
  @spec attach_behavior(DecisionTrace.t(), BehaviorState.t(), atom()) :: DecisionTrace.t()
  def attach_behavior(%DecisionTrace{} = trace, %BehaviorState{} = behavior, event_type \\ :open) do
    ref = behavior_trace_ref(behavior, event_type)

    %{
      trace
      | behavior_trace_refs: trace.behavior_trace_refs ++ [ref],
        event_order: append_once(trace.event_order, :behavior_trace_recorded)
    }
  end

  # CP1：本轮组装/执行期被省略的材料进入作者可见 trace（`06` §5.3 omission_notes / §7）。
  defp maybe_put_omissions(summary, %{omission_notes: [_ | _] = notes}) do
    Map.put(
      summary,
      :omission_notes,
      Enum.map(notes, &NovelDomain.OmissionNote.author_safe_summary/1)
    )
  end

  defp maybe_put_omissions(summary, _turn_result), do: summary

  # VS-00E CP1：场级执行简述引用进作者可见 trace summary（来源留痕，非作品事实）。
  defp maybe_put_brief_ref(summary, %{brief_ref: ref}) when is_binary(ref) and ref != "" do
    Map.put(summary, :prose_execution_brief_ref, ref)
  end

  defp maybe_put_brief_ref(summary, _turn_result), do: summary

  defp maybe_put_ai_message_envelope(summary, %DialogueFrame{
         evidence_summary: %{ai_message_envelope: envelope}
       })
       when is_map(envelope) do
    summary
    |> Map.put(:guidance_mode, get_in(envelope, [:turn_guidance_layer, :guidance_mode]))
    |> Map.put(:ai_message_envelope, envelope)
  end

  defp maybe_put_ai_message_envelope(summary, _frame), do: summary

  @doc "Record recovery trace when plan generation fails."
  @spec record_recovery(DialogueFrame.t(), map(), DialogueContext.t() | nil) ::
          {DecisionTrace.t(), map()}
  def record_recovery(%DialogueFrame{} = frame, turn_result, _context) do
    trace_id = allocate_trace_id()

    trace = %DecisionTrace{
      trace_id: trace_id,
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      decision_type: :fail_with_recovery,
      no_tool_reason: "micro_plan_generation_failed",
      no_behavior_reason: "recovery mode: reverted to reply-only",
      no_write_reason: "plan generation failed, no execution attempted",
      turn_result_ref: turn_result[:turn_id] || frame.turn_id,
      replay_policy: %{use_recorded_frame: true, recall_provider: false},
      redaction_level: :author_safe,
      event_order: [
        :author_input_received,
        :dialogue_frame_validated,
        :micro_plan_generation_failed,
        :recovery_fallback,
        :turn_result_emitted
      ]
    }

    summary = %{
      trace_ref: trace_id,
      decision_type: :fail_with_recovery,
      frame_type: frame.frame_type,
      dialogue_goal: frame.dialogue_goal.summary,
      recovery: "plan generation failed, reverted to reply_only"
    }

    {trace, TraceRedactor.author_safe(summary)}
  end

  # ── helpers ───────────────────────────────────

  defp decision_type(:creative_exploration), do: :exploration
  defp decision_type(:execution_candidate), do: :tool_allowed
  defp decision_type(_), do: :reply_only

  defp decision_type_for(:downgrade_to_dialogue), do: :downgrade
  defp decision_type_for(:require_confirmation), do: :confirmation_required
  defp decision_type_for(:require_clarification), do: :clarification_required
  defp decision_type_for(:reject), do: :rejected
  defp decision_type_for(:fail_with_recovery), do: :recovery
  defp decision_type_for(:allow_tool), do: :tool_allowed

  defp no_behavior_reason(:creative_exploration), do: "exploration stays conversational"

  defp no_behavior_reason(:execution_candidate),
    do: "execution candidate evaluated by orchestrator"

  defp no_behavior_reason(_), do: "reply-only turn does not open durable behavior"

  defp build_event_order(context) do
    base = [
      :author_input_received,
      :dialogue_context_attached,
      :dialogue_frame_validated,
      :reply_only_decision_recorded,
      :turn_result_emitted
    ]

    if context && DialogueContext.has_context?(context) do
      base
    else
      List.delete(base, :dialogue_context_attached) |> List.insert_at(1, :dialogue_context_empty)
    end
  end

  defp format_context_refs(refs) when is_list(refs) do
    Enum.map(refs, fn %ContextSourceRef{} = ref ->
      %{
        context_ref: ref.context_ref,
        source_type: ref.source_type,
        summary: author_safe_summary(ref)
      }
    end)
  end

  defp format_context_refs(_), do: []

  defp author_safe_summary(%ContextSourceRef{redaction_level: :author_safe, summary: summary})
       when is_binary(summary) do
    summary
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> String.slice(0, 180)
    |> TraceRedactor.author_safe()
  end

  defp author_safe_summary(_ref), do: nil

  defp allocate_trace_id, do: "trace_#{System.unique_integer([:positive, :monotonic])}"

  defp tool_trace_ref(%ToolRequest{} = req, %ToolResult{} = result, %OrchestratorDecision{} = d) do
    registry_snapshot = tool_registry_snapshot(req.tool_name)

    %{
      trace_status: :registry_snapshot,
      tool_request_ref: req.tool_request_id,
      tool_result_ref: result.tool_result_id,
      tool_name: req.tool_name,
      tool_version: req.tool_version,
      tool_status: result.status,
      decision_ref: d.decision_id,
      registry_snapshot: registry_snapshot,
      contract_refs: %{
        input_contract_ref: registry_snapshot.input_contract_ref,
        output_contract_ref: registry_snapshot.output_contract_ref
      },
      grant_summary: %{
        requested_read_scopes: req.read_scope_grants,
        requested_write_scopes: req.write_scope_grants,
        registry_read_scopes: registry_snapshot.read_scopes,
        registry_write_scopes: registry_snapshot.write_scopes,
        grants_within_registry:
          CapabilityRegistry.grants_valid?(
            req.tool_name,
            req.read_scope_grants,
            req.write_scope_grants
          )
      },
      request_summary: redacted_payload_summary(req.input),
      result_summary: tool_result_summary(result),
      io_redaction: %{
        profile: :author_safe,
        input_payload_stored: false,
        output_payload_stored: false
      }
    }
  end

  defp tool_registry_snapshot(tool_name) do
    case CapabilityRegistry.get(tool_name) do
      nil ->
        %{
          tool_name: tool_name,
          tool_version: "unknown",
          tool_layer: :unknown,
          input_contract_ref: "unknown",
          output_contract_ref: "unknown",
          read_scopes: [],
          write_scopes: [],
          risk_class: :unknown,
          status: :unknown,
          trace_level: :minimal,
          provider_dependency: :unknown,
          supports_retry: false,
          supports_cancellation: false,
          budget_profile_ref: nil
        }

      entry ->
        %{
          tool_name: entry.tool_name,
          tool_version: entry.tool_version,
          tool_layer: entry.tool_layer,
          input_contract_ref: entry.input_contract_ref,
          output_contract_ref: entry.output_contract_ref,
          read_scopes: entry.read_scopes,
          write_scopes: entry.write_scopes,
          risk_class: entry.risk_class,
          status: entry.status,
          trace_level: entry.trace_level,
          provider_dependency: entry.provider_dependency,
          supports_retry: entry.supports_retry,
          supports_cancellation: entry.supports_cancellation,
          budget_profile_ref: entry.budget_profile_ref
        }
    end
  end

  defp tool_result_summary(%ToolResult{} = result) do
    result.output
    |> redacted_payload_summary()
    |> Map.merge(%{
      status: result.status,
      state_delta_count: length(result.state_delta),
      artifact_ref_count: length(result.artifact_refs),
      error_count: length(result.errors),
      warning_count: length(result.warnings),
      usage_summary: redacted_usage_summary(result.usage)
    })
  end

  defp redacted_payload_summary(payload) when is_map(payload) do
    keys = payload |> Map.keys() |> Enum.map(&to_string/1) |> Enum.sort()
    visible_keys = Enum.reject(keys, &sensitive_payload_key?/1)

    %{
      payload_type: :map,
      key_count: length(keys),
      keys: visible_keys,
      redacted_key_count: length(keys) - length(visible_keys),
      payload_stored: false
    }
  end

  defp redacted_payload_summary(nil) do
    %{
      payload_type: :none,
      key_count: 0,
      keys: [],
      redacted_key_count: 0,
      payload_stored: false
    }
  end

  defp redacted_payload_summary(payload) do
    %{
      payload_type: payload |> type_name(),
      key_count: 0,
      keys: [],
      redacted_key_count: 0,
      payload_stored: false
    }
  end

  defp redacted_usage_summary(usage) when is_map(usage) do
    usage
    |> Map.take([:duration_ms, :tool, :version, "duration_ms", "tool", "version"])
    |> TraceRedactor.author_safe()
  end

  defp redacted_usage_summary(_usage), do: %{}

  defp sensitive_payload_key?(key) do
    key
    |> String.downcase()
    |> then(
      &(&1 in [
          "api_key",
          "authorization",
          "credential",
          "hidden_policy",
          "password",
          "provider_raw_log",
          "provider_raw_response",
          "raw_prompt",
          "raw_provider_log",
          "raw_provider_response",
          "secret",
          "sensitive_memory",
          "system_prompt",
          "tool_input",
          "tool_output",
          "unredacted_memory"
        ])
    )
  end

  defp type_name(value) when is_list(value), do: :list
  defp type_name(value) when is_binary(value), do: :string
  defp type_name(value) when is_number(value), do: :number
  defp type_name(value) when is_boolean(value), do: :boolean
  defp type_name(_value), do: :term

  defp behavior_trace_ref(%BehaviorState{} = behavior, event_type) do
    %{
      trace_status: :summary_level,
      behavior_ref: behavior.behavior_id,
      behavior_type: behavior.behavior_type,
      event_type: event_type,
      event_turn_ref: behavior.closed_at_turn_ref || behavior.opened_at_turn_ref,
      decision_ref: behavior.opened_by_decision_ref,
      target_ref: behavior.target_ref,
      next_status: behavior.lifecycle_status,
      required_next_action: behavior.required_next_action
    }
  end

  defp append_once(values, value) do
    if value in values, do: values, else: values ++ [value]
  end
end
