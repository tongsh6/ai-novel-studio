defmodule NovelApplication.AgentRunFlows.ToolConfirmation do
  @moduledoc """
  非采纳工具确认的子 AgentRun flow（VS-00L §16.14）。

  - 重新从当前作品/会话组装上下文，再用源 MicroPlan 与持久确认绑定经过
    Orchestrator 重新裁决；
  - 放行后仍调用既有 `TurnExecutionService` 主链完成 writer/quality、canonical、
    pcall/prun 与结果事务；
  - 上下文/查询来自持久真实事实，作者消息使用源 turn 的真实作者原字节，
    不把“确认执行”按钮文案冒充作者输入；
  - gate 阻止与工具失败仍返回真实子结果和 DecisionTrace。
  """

  alias NovelApplication.AgentObservationAssembler
  alias NovelApplication.AgentRunFlows.AuthoringSession
  alias NovelApplication.ContextAssembler
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.ProviderActivityProjector
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AgentNextStepDecision
  alias NovelDomain.AgentStep
  alias NovelDomain.ConfirmationBinding
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan

  @profile_ref "tool_confirmation_v1"
  @step_target "author_action_confirmation"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: no_return()
  def steps(_spec) do
    raise ArgumentError, "tool_confirmation_v1 requires next_step_planner/1"
  end

  @spec next_step_planner(map()) :: NovelApplication.AgentRunServer.next_step_planner()
  def next_step_planner(spec) when is_map(spec) do
    fn run, sequence, _snapshot ->
      if sequence == 1 do
        {:execute, step_fun(spec), execute_decision(run, sequence), %{provider_call_count: 0}}
      else
        {:complete, complete_decision(run, sequence), %{provider_call_count: 0}}
      end
    end
  end

  defp execute_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_tool_confirmation",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :execute_step,
        summary: "重新组装当前上下文并执行作者已确认的动作。",
        target_tool_ref: @step_target,
        write_intent: :tentative,
        risk_hint: :medium,
        reason_codes: ["author_confirmed_action", "current_context_regate"],
        observation_refs: [],
        evaluation_of_last: %{advanced: true, plan_holds: true, new_constraint: nil},
        confidence: 1.0
      })

    decision
  end

  defp complete_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}_tool_confirmation_done",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "作者确认的动作已处理。",
        target_tool_ref: nil,
        write_intent: :none,
        risk_hint: :low,
        reason_codes: ["author_action_processed"],
        observation_refs: [],
        evaluation_of_last: %{advanced: true, plan_holds: true, new_constraint: nil},
        confidence: 1.0
      })

    decision
  end

  defp step_fun(spec) do
    fn run, sequence, snapshot ->
      action_input = Map.fetch!(spec, :action_input)
      source = Map.fetch!(spec, :source_turn_result)
      author = Map.fetch!(spec, :author_message)
      behavior_ref = Map.fetch!(spec, :behavior_ref)
      turn_id = NovelApplication.AgentRunFlows.TurnBinding.bind(run, sequence)

      with {:ok, plan} <- source_plan(source),
           {:ok, context} <- assemble_context(run, author.text, spec),
           {:ok, frame} <- build_frame(run, turn_id, source, author),
           plan = %{plan | turn_id: frame.turn_id},
           {:ok, binding} <- build_binding(action_input, source, context, behavior_ref, turn_id),
           {decision, _behavior} <-
             ExecutionOrchestrator.decide(frame, plan,
               confirmation_binding: binding,
               gate_context: gate_context(binding)
             ) do
        execute_decision_step(
          run,
          sequence,
          snapshot,
          spec,
          frame,
          plan,
          context,
          decision,
          behavior_ref,
          binding
        )
      else
        {:error, reason} -> {:error, {:tool_confirmation_prepare_failed, reason}}
      end
    end
  end

  defp execute_decision_step(
         run,
         sequence,
         snapshot,
         spec,
         frame,
         plan,
         context,
         decision,
         behavior_ref,
         binding
       ) do
    if decision.decision_type == :allow_tool do
      execute_allowed(
        run,
        sequence,
        snapshot,
        spec,
        frame,
        plan,
        context,
        decision,
        behavior_ref,
        binding
      )
    else
      execute_blocked(
        run,
        sequence,
        snapshot,
        spec,
        frame,
        plan,
        context,
        decision,
        behavior_ref,
        binding
      )
    end
  end

  defp execute_allowed(
         run,
         sequence,
         snapshot,
         spec,
         frame,
         plan,
         context,
         decision,
         behavior_ref,
         binding
       ) do
    emit_stage(
      snapshot,
      :tool_started,
      "已确认动作通过重新裁决，开始执行。",
      ["author_confirmed_action_allowed"],
      [plan.plan_id, decision.decision_id],
      %{
        stage: :author_action_execution_started,
        tool_name: action_target(spec),
        plan_ref: plan.plan_id,
        decision_ref: decision.decision_id
      }
    )

    provider_execution =
      spec
      |> Map.get(:provider_execution)
      |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: :tool)

    {turn_result, trace, transcript} =
      TurnExecutionService.execute(%{
        frame: frame,
        plan: plan,
        decision: decision,
        candidates: [],
        context: context,
        author_input: %{
          text: spec.author_message.text,
          author_goal_text: spec.author_message.text
        },
        source_turn_ref: spec.action_input.source_turn_ref,
        provider_execution: provider_execution,
        quality_provider_execution: provider_execution,
        chapter_prose_reader: NovelApplication.persistence_chapter_prose_reader(),
        chapter_summary_reader: NovelApplication.persistence_chapter_summary_reader(),
        character_reader: NovelApplication.persistence_character_reader(),
        assumption_reader: NovelApplication.persistence_assumption_character_reader(),
        ledger_reader: NovelApplication.persistence_ledger_reader(),
        memory_reader: NovelApplication.persistence_memory_reader(),
        agent_run: run,
        idempotency_suffix: "_confirmed"
      })

    turn_result =
      turn_result
      |> Map.put(:parent_turn_id, spec.action_input.source_turn_ref)
      |> Map.put(:source_turn_ref, spec.action_input.source_turn_ref)
      |> Map.put(:author_turn_ref, spec.author_message.turn_ref)
      |> Map.put(:behavior_ref, behavior_ref)
      |> put_trace_source(spec, behavior_ref)
      |> put_binding_proof(binding)

    emit_stage(
      snapshot,
      :tool_completed,
      "作者确认的动作已处理，结果作为新的待处理候选返回。",
      ["author_confirmed_action_processed"],
      artifact_refs(turn_result),
      %{
        stage: :author_action_execution_completed,
        tool_name: action_target(spec),
        turn_ref: turn_result.turn_id
      }
    )

    {:ok,
     result_map(
       run,
       sequence,
       turn_result,
       trace,
       transcript,
       snapshot,
       spec
     )}
  end

  defp execute_blocked(
         run,
         sequence,
         snapshot,
         spec,
         frame,
         plan,
         context,
         decision,
         behavior_ref,
         binding
       ) do
    turn_result = %{
      schema_version: "3.0-draft",
      turn_id: frame.turn_id,
      parent_turn_id: spec.action_input.source_turn_ref,
      source_turn_ref: spec.action_input.source_turn_ref,
      frame_ref: frame.frame_id,
      assistant_message: %{
        text: "作者已确认，但当前上下文未通过重新裁决（#{decision.first_blocking_gate}），没有执行工具或写入作品事实。"
      },
      ui_cards: [],
      frame_summary: %{
        frame_type: :confirmation_answer,
        dialogue_goal: "处理作者已确认的动作"
      },
      trace_summary: %{
        trace_ref: "trace:#{frame.turn_id}",
        decision_type: "gate_blocked",
        reason_codes: ["author_confirmed_action_blocked", to_string(decision.first_blocking_gate)],
        source_turn_ref: spec.action_input.source_turn_ref,
        author_turn_ref: spec.author_message.turn_ref,
        behavior_ref: behavior_ref
      },
      phase: "blocked",
      status: "conversational",
      available_actions: [],
      truthfulness: %{
        tool_called: false,
        artifact_adopted: false,
        production_write_performed: false,
        state_persisted: false,
        durable_behavior_opened: false,
        decision_type: :gate_blocked,
        reason_codes: ["author_confirmed_action_blocked"]
      }
    }

    {trace, trace_summary} =
      TraceWriter.record_with_decision(frame, plan, decision, turn_result, context)

    turn_result =
      turn_result
      |> Map.put(:trace_summary, trace_summary)
      |> Map.put(:orchestrator_decision, decision_summary(decision))
      |> put_binding_proof(binding)

    emit_stage(
      snapshot,
      :gate_decided,
      "作者确认的动作被当前 gate 阻止。",
      ["author_confirmed_action_blocked"],
      [decision.decision_id],
      %{
        stage: :author_action_execution_blocked,
        decision_ref: decision.decision_id,
        first_blocking_gate: decision.first_blocking_gate
      }
    )

    {:ok, result_map(run, sequence, turn_result, trace, nil, snapshot, spec)}
  end

  defp result_map(run, sequence, turn_result, trace, transcript, _snapshot, spec) do
    step_id = "step_#{run.run_id}_#{sequence}"
    observations = AgentObservationAssembler.from_turn_result(turn_result, %{run_id: run.run_id, step_id: step_id})
    trace_summary = Map.get(turn_result, :trace_summary) || %{}

    {:ok, step} =
      AgentStep.new(%{
        step_id: step_id,
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "执行作者已确认的动作",
        micro_plan_ref: Map.get(trace_summary, :plan_ref),
        decision_ref: Map.get(trace_summary, :decision_ref),
        tool_request_ref: Map.get(trace_summary, :tool_request_id),
        tool_result_ref: Map.get(trace_summary, :tool_result_id),
        observation_refs: Enum.map(observations, & &1.observation_id),
        state_snapshot_ref: "state_snapshot:#{run.run_id}:#{sequence}:tool_confirmation",
        idempotency_key: "#{run.run_id}:#{sequence}:tool_confirmation:#{spec.receipt_id}"
      })

    provider_calls =
      trace_summary
      |> Map.get(:execution_counts, %{})
      |> Map.get(:provider_calls, 0)

    %{
      step: step,
      observations: observations,
      stage_state:
        (if transcript, do: AuthoringSession.transcript_state(transcript), else: %{}),
      turn_result: turn_result,
      decision_trace: trace,
      artifact_refs: artifact_refs(turn_result),
      provider_call_count: provider_calls,
      tool_call_count: get_in(trace_summary, [:execution_counts, :tool_calls]) || 0,
      loop_status: :completed,
      loop_decision: complete_decision(run, sequence + 1),
      progress_signature: "#{run.run_id}:tool_confirmation:#{turn_result.turn_id}"
    }
  end

  defp source_plan(source) do
    case Map.get(source, :plan) || Map.get(source, "plan") do
      nil -> {:error, :source_plan_missing}
      plan -> {:ok, MicroPlan.from_map(plan)}
    end
  end

  defp assemble_context(run, author_text, spec) do
    fetcher = Map.get(spec, :context_fetcher) || NovelApplication.persistence_fetcher()

    {:ok,
     ContextAssembler.assemble_for_input(
       run.work_id,
       author_text,
       fetcher || (&empty_context/1),
       session_id: run.session_id,
       assembly_policy: NovelApplication.current_assembly_policy()
     )}
  rescue
    error -> {:error, {:context_assembly_failed, Exception.message(error)}}
  end

  defp empty_context(_workspace_id), do: {:ok, nil, nil, nil, nil}

  defp build_frame(run, turn_id, source, author) do
    plan = Map.get(source, :plan) || Map.get(source, "plan") || %{}
    frame_ref = Map.get(plan, :frame_ref) || Map.get(plan, "frame_ref") || "frame_#{turn_id}"

    frame = %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: frame_ref,
      turn_id: turn_id,
      workspace_id: run.work_id,
      primary: true,
      frame_type: :confirmation_answer,
      source_refs: %{
        author_input_ref: "author_input:#{author.turn_ref}",
        dialogue_context_ref: nil
      },
      dialogue_goal: %{summary: "处理作者已确认的动作"},
      tool_need: %{needs_tool: true, reason_code: :no_tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: author.text},
      evidence_summary: %{},
      uncertainty: []
    }

    {:ok, frame}
  end

  defp build_binding(action_input, source, context, behavior_ref, turn_id) do
    source_action =
      source
      |> field(:available_actions)
      |> List.wrap()
      |> Enum.find(%{}, &(field(&1, :action_id) == action_input.action_id))

    snapshot_ref =
      compact_ref([
        "state_snapshot",
        context.current_work_snapshot && Map.get(context.current_work_snapshot, :revision),
        action_input.source_turn_ref,
        action_input.action_id,
        turn_id
      ])

    ConfirmationBinding.build(%{
      binding_id: "cb_#{action_input.input_id}",
      behavior_ref: behavior_ref,
      target_ref: field(source_action, :target_ref) || action_input.target_ref,
      author_input_ref: action_input.input_id,
      answer_type: :confirm,
      idempotency_key: field(source_action, :idempotency_key) || action_input.idempotency_key,
      rebased_state_snapshot_ref: snapshot_ref,
      gate_result_refs: ["gate_result:confirmation_re_gate:#{action_input.source_turn_ref}:#{turn_id}"],
      trace_ref:
        field(source_action, :trace_ref) ||
          field(field(source, :trace_summary), :trace_ref) || "trace:#{turn_id}"
    })
  end

  defp compact_ref(parts) do
    parts
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
    |> Enum.map(&to_string/1)
    |> Enum.join(":")
  end

  defp gate_context(binding) do
    %{
      idempotency: %{key: binding.idempotency_key},
      behavior_resolution: :author_confirmed
    }
  end

  defp put_binding_proof(turn_result, binding) do
    proof = %{
      behavior_ref: binding.behavior_ref,
      target_ref: binding.target_ref,
      rebased_state_snapshot_ref: binding.rebased_state_snapshot_ref,
      gate_result_refs: binding.gate_result_refs,
      trace_ref: binding.trace_ref
    }

    turn_result
    |> Map.update(:trace_summary, %{confirmation_binding: proof}, fn summary ->
      Map.put(summary, :confirmation_binding, proof)
    end)
    |> Map.update(:truthfulness, %{}, fn truth ->
      codes =
        Enum.uniq(
          [
            "rebased_state_snapshot:#{binding.rebased_state_snapshot_ref}"
            | List.wrap(Map.get(truth, :reason_codes))
          ] ++ Enum.map(binding.gate_result_refs, &"gate_result_ref:#{&1}")
        )

      Map.put(truth, :reason_codes, codes)
    end)
  end

  defp put_trace_source(turn_result, spec, behavior_ref) do
    Map.update(turn_result, :trace_summary, %{}, fn summary ->
      summary
      |> Map.put(:source_turn_ref, spec.action_input.source_turn_ref)
      |> Map.put(:author_turn_ref, spec.author_message.turn_ref)
      |> Map.put(:behavior_ref, behavior_ref)
    end)
  end

  defp decision_summary(decision) do
    %{
      decision_id: decision.decision_id,
      decision_type: to_string(decision.decision_type),
      first_blocking_gate: to_string(decision.first_blocking_gate)
    }
  end

  defp artifact_refs(turn_result) do
    turn_result
    |> get_in([:adoption_state, :pending])
    |> List.wrap()
    |> Enum.map(&field(&1, :artifact_id))
    |> Enum.reject(&is_nil/1)
  end

  defp action_target(spec) do
    spec.action_input.target_ref || "unknown"
  end

  defp emit_stage(%{stage_sink: sink}, event_type, summary, reason_codes, refs, payload)
       when is_function(sink, 1) do
    sink.(%{
      event_type: event_type,
      summary: summary,
      reason_codes: reason_codes,
      refs: refs,
      payload: payload
    })
  end

  defp emit_stage(_snapshot, _event_type, _summary, _reason_codes, _refs, _payload), do: :ok

  defp field(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp field(_map, _key), do: nil
end
