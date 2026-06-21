defmodule NovelApplication.ReplayService do
  @moduledoc """
  结构化回放服务。基于 DecisionTrace + trace refs 重建决策链，不调用 LLM。

  规格见 docs/design/contracts/VS-06-replay-surface-contract-pack.md §4。
  """

  alias NovelApplication.TraceRedactor
  alias NovelDomain.DecisionTrace
  alias NovelDomain.ReplayReport

  @doc """
  从 DecisionTrace 构建 ReplayReport。不调用 provider。
  """
  @spec build_report(DecisionTrace.t()) :: ReplayReport.t()
  def build_report(%DecisionTrace{} = trace) do
    replay_id = "replay_#{System.unique_integer([:positive, :monotonic])}"
    missing_trace_refs = find_missing_refs(trace)

    %ReplayReport{
      replay_report_id: replay_id,
      replay_case_ref: "replay_case:#{trace.trace_id}",
      trace_ref: trace.trace_id,
      replay_level: :structural,
      chain_summary: TraceRedactor.author_safe(build_chain_summary(trace)),
      required_questions: TraceRedactor.author_safe(build_required_questions(trace)),
      decision_explanations: TraceRedactor.author_safe(build_decision_explanations(trace)),
      state_explanations: TraceRedactor.author_safe(build_state_explanations(trace)),
      missing_trace_refs: missing_trace_refs,
      redaction_profile: :author_safe,
      provider_called: false,
      result_status: result_status(trace, missing_trace_refs),
      generated_at: DateTime.utc_now() |> DateTime.to_iso8601()
    }
  end

  # ── chain ────────────────────────────────────────

  defp build_chain_summary(trace) do
    base = [
      %{step: "frame", ref: trace.frame_ref, note: "DialogueFrame formed"},
      plan_chain_step(trace),
      %{step: "decision", type: trace.decision_type, note: "Orchestrator decision recorded"}
    ]

    tail = [
      %{step: "turn_result", ref: trace.turn_result_ref, note: "TurnResult emitted"}
    ]

    base ++
      tool_chain_steps(trace) ++
      behavior_chain_steps(trace) ++
      state_chain_steps(trace) ++
      tail
  end

  defp build_decision_explanations(trace) do
    entry = %{
      decision_type: trace.decision_type,
      no_tool_reason: trace.no_tool_reason,
      no_behavior_reason: trace.no_behavior_reason,
      no_write_reason: trace.no_write_reason
    }

    entry =
      cond do
        trace.decision_type == :tool_dispatched ->
          entry
          |> Map.put(:tool_chain_step, tool_decision_note(trace))
          |> Map.put(:tool_trace_count, length(trace.tool_trace_refs))

        behavior_decision?(trace) ->
          entry
          |> Map.put(:execution_blocked, true)
          |> Map.put(:behavior_trace_count, length(trace.behavior_trace_refs))

        true ->
          Map.put(entry, :execution_blocked, trace.decision_type != :reply_only)
      end

    [entry]
  end

  defp build_state_explanations(trace) do
    state_steps = state_explanation_steps(trace)
    behavior_steps = behavior_explanation_steps(trace)

    cond do
      state_steps != [] or behavior_steps != [] ->
        behavior_steps ++ state_steps

      state_chain_required?(trace) ->
        [
          %{
            step: "state_trace_missing",
            status: :partial,
            note: "state change requires StateTrace"
          }
        ]

      true ->
        [%{step: "candidate_boundary", note: "no production write in this turn"}]
    end
  end

  defp find_missing_refs(trace) do
    missing = []
    missing = if is_nil(trace.turn_result_ref), do: ["turn_result_ref" | missing], else: missing

    missing =
      missing_if(missing, plan_chain_required?(trace), trace.plan_ref, "plan_ref")

    missing =
      missing_if(missing, tool_chain_required?(trace), trace.tool_trace_refs, "tool_trace_refs")

    missing =
      missing_if(
        missing,
        behavior_chain_required?(trace),
        trace.behavior_trace_refs,
        "behavior_trace_refs"
      )

    missing =
      missing_if(
        missing,
        state_chain_required?(trace),
        trace.state_trace_refs,
        "state_trace_refs"
      )

    Enum.reverse(missing)
  end

  defp result_status(trace, []) do
    if trace.event_order != [] and not is_nil(trace.turn_result_ref) do
      :complete
    else
      :partial
    end
  end

  defp result_status(_trace, _missing_trace_refs), do: :partial

  defp build_required_questions(%DecisionTrace{} = trace) do
    [
      question(
        :decision_reason,
        "本轮为什么是 reply-only / require confirmation / tool dispatch / adoption",
        "OrchestratorDecision / gate trace",
        decision_reason_answer(trace)
      ),
      question(
        :planner_vs_decision,
        "Planner 建议和最终 decision 有什么差异",
        "MicroPlan / DecisionTrace",
        planner_vs_decision_answer(trace)
      ),
      question(
        :tool_approval,
        "哪个 tool 被批准、使用哪个 registry version、返回什么结果",
        "ToolTrace",
        tool_approval_answer(trace)
      ),
      question(
        :adoption_boundary,
        "为什么 ToolResult 没有直接成为 adopted state",
        "AdoptionDecision / StateTrace",
        adoption_boundary_answer(trace)
      ),
      question(
        :behavior_lifecycle,
        "哪个 behavior 被打开、如何关闭",
        "BehaviorTrace / DecisionTrace",
        behavior_lifecycle_answer(trace)
      ),
      question(
        :turn_result_surface,
        "TurnResult 为什么可以展示这些 action / cards / trace summary",
        "TurnResultViewModel / TraceSummaryView",
        turn_result_surface_answer(trace)
      )
    ]
  end

  defp question(id, question, source, {status, answer}) do
    %{id: id, question: question, source: source, status: status, answer: answer}
  end

  defp decision_reason_answer(%DecisionTrace{} = trace) do
    {:answered,
     "decision=#{trace.decision_type}; no_tool=#{trace.no_tool_reason}; no_behavior=#{trace.no_behavior_reason}; no_write=#{trace.no_write_reason}"}
  end

  defp planner_vs_decision_answer(%DecisionTrace{} = trace) do
    cond do
      is_binary(trace.plan_ref) and trace.plan_ref != "" ->
        {:answered, "plan=#{trace.plan_ref}; final_decision=#{trace.decision_type}"}

      plan_chain_required?(trace) ->
        {:missing, "DecisionTrace requires a MicroPlan ref but plan_ref is missing."}

      true ->
        {:not_applicable, "This trace did not record a MicroPlan-mediated decision."}
    end
  end

  defp tool_approval_answer(%DecisionTrace{tool_trace_refs: [ref | _]}) do
    {:answered,
     "tool=#{ref_value(ref, :tool_name)}; version=#{ref_value(ref, :tool_version)}; status=#{ref_value(ref, :tool_status)}"}
  end

  defp tool_approval_answer(%DecisionTrace{} = trace) do
    if tool_chain_required?(trace) do
      {:missing, "Tool dispatch was recorded but tool_trace_refs are missing."}
    else
      {:not_applicable, "No tool was approved for this trace."}
    end
  end

  defp adoption_boundary_answer(%DecisionTrace{state_trace_refs: [ref | _]}) do
    {:answered,
     "state_event=#{ref_value(ref, :event_type)}; adopted_state_ref=#{ref_value(ref, :adopted_state_ref)}; projection_ref=#{ref_value(ref, :projection_ref)}"}
  end

  defp adoption_boundary_answer(%DecisionTrace{tool_trace_refs: [_ | _]}) do
    {:answered, "ToolResult remained non-adopted; adoption requires a separate StateTrace."}
  end

  defp adoption_boundary_answer(%DecisionTrace{} = trace) do
    if state_chain_required?(trace) do
      {:missing, "State-changing trace requires state_trace_refs."}
    else
      {:not_applicable, "This trace did not change adopted production state."}
    end
  end

  defp behavior_lifecycle_answer(%DecisionTrace{behavior_trace_refs: [ref | _]}) do
    {:answered,
     "behavior=#{ref_value(ref, :behavior_ref)}; event=#{ref_value(ref, :event_type)}; status=#{ref_value(ref, :next_status)}; resolution=#{ref_value(ref, :resolution_ref)}"}
  end

  defp behavior_lifecycle_answer(%DecisionTrace{} = trace) do
    if behavior_chain_required?(trace) do
      {:missing, "Behavior decision was recorded but behavior_trace_refs are missing."}
    else
      {:not_applicable, "No durable behavior was opened or closed for this trace."}
    end
  end

  defp turn_result_surface_answer(%DecisionTrace{turn_result_ref: ref}) when is_binary(ref) do
    {:answered, "TurnResult ref #{ref} was emitted with the trace summary."}
  end

  defp turn_result_surface_answer(_trace) do
    {:missing, "turn_result_ref is missing, so the UI surface cannot be fully replayed."}
  end

  defp plan_chain_step(%DecisionTrace{plan_ref: ref}) when is_binary(ref) and ref != "" do
    %{step: "plan", ref: ref, note: "MicroPlan recorded"}
  end

  defp plan_chain_step(%DecisionTrace{} = trace) do
    if plan_chain_required?(trace) do
      %{step: "plan_missing", ref: nil, status: :partial, note: "MicroPlan ref is missing"}
    else
      %{step: "plan", ref: nil, status: :not_applicable, note: "No MicroPlan recorded"}
    end
  end

  defp tool_chain_steps(%DecisionTrace{} = trace) do
    Enum.map(trace.tool_trace_refs, fn ref ->
      %{
        step: "tool_trace",
        ref: ref_value(ref, :tool_result_ref),
        request_ref: ref_value(ref, :tool_request_ref),
        tool_name: ref_value(ref, :tool_name),
        tool_version: ref_value(ref, :tool_version),
        status: ref_value(ref, :tool_status),
        note: "Tool request/result summary is available for replay"
      }
    end)
  end

  defp behavior_chain_steps(%DecisionTrace{} = trace) do
    Enum.map(trace.behavior_trace_refs, fn ref ->
      %{
        step: "behavior_trace",
        ref: ref_value(ref, :behavior_ref),
        event_type: ref_value(ref, :event_type),
        event_turn_ref: ref_value(ref, :event_turn_ref),
        status: ref_value(ref, :next_status),
        target_ref: ref_value(ref, :target_ref),
        resolution_ref: ref_value(ref, :resolution_ref),
        note: "Behavior lifecycle summary is available for replay"
      }
    end)
  end

  defp state_chain_steps(%DecisionTrace{} = trace) do
    Enum.map(trace.state_trace_refs, fn ref ->
      %{
        step: "state_trace",
        ref: ref_value(ref, :state_trace_ref),
        event_type: ref_value(ref, :event_type),
        target_ref: ref_value(ref, :target_ref),
        note: "State transition summary is available for replay"
      }
    end)
  end

  defp behavior_explanation_steps(%DecisionTrace{} = trace) do
    Enum.map(trace.behavior_trace_refs, fn ref ->
      %{
        step: "behavior_lifecycle",
        behavior_ref: ref_value(ref, :behavior_ref),
        event_type: ref_value(ref, :event_type),
        event_turn_ref: ref_value(ref, :event_turn_ref),
        status: ref_value(ref, :next_status),
        resolution_ref: ref_value(ref, :resolution_ref),
        note: "author-blocking behavior can be explained from recorded lifecycle summary"
      }
    end)
  end

  defp state_explanation_steps(%DecisionTrace{} = trace) do
    Enum.map(trace.state_trace_refs, fn ref ->
      %{
        step: "state_transition",
        state_trace_ref: ref_value(ref, :state_trace_ref),
        event_type: ref_value(ref, :event_type),
        adopted_state_ref: ref_value(ref, :adopted_state_ref),
        projection_ref: ref_value(ref, :projection_ref),
        note: "state/adoption/projection change can be explained from recorded state summary"
      }
    end)
  end

  defp tool_decision_note(%DecisionTrace{tool_trace_refs: [_ | _]}),
    do: "tool request/result refs were recorded"

  defp tool_decision_note(_trace), do: "tool dispatch was recorded without tool trace refs"

  defp tool_chain_required?(%DecisionTrace{} = trace) do
    trace.decision_type == :tool_dispatched or event?(trace, :tool_trace_recorded)
  end

  defp plan_chain_required?(%DecisionTrace{} = trace) do
    trace.decision_type in [
      :tool_dispatched,
      :tool_allowed,
      :confirmation_required,
      :clarification_required,
      :downgrade
    ] or event?(trace, :micro_plan_generated)
  end

  defp behavior_chain_required?(%DecisionTrace{} = trace) do
    behavior_decision?(trace) or event?(trace, :behavior_trace_recorded)
  end

  defp behavior_decision?(%DecisionTrace{} = trace) do
    trace.decision_type in [:confirmation_required, :clarification_required]
  end

  defp state_chain_required?(%DecisionTrace{} = trace) do
    trace.decision_type in [:adopt_tentative] or
      Enum.any?(
        [
          :state_trace_recorded,
          :production_state_written,
          :candidate_adopted,
          :adoption_state_changed,
          :projection_hint_emitted
        ],
        &event?(trace, &1)
      )
  end

  defp event?(%DecisionTrace{event_order: events}, event), do: event in events

  defp missing_if(missing, true, [], ref), do: [ref | missing]
  defp missing_if(missing, true, nil, ref), do: [ref | missing]
  defp missing_if(missing, true, "", ref), do: [ref | missing]
  defp missing_if(missing, _required, _refs, _ref), do: missing

  defp ref_value(ref, key) when is_map(ref), do: Map.get(ref, key) || Map.get(ref, to_string(key))
  defp ref_value(_ref, _key), do: nil
end
