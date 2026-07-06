defmodule NovelApplication.AgentRunFlows.ConversationTurn do
  @moduledoc """
  AgentRun flow for a single conversational turn.

  The flow keeps the v3 dialogue main chain inside the AgentRun lifecycle:
  context assembly -> frame formation -> planning/gate decision -> response
  finalization. It does not call `DialogueGateway.handle_input/5` as a black-box
  fallback; only the existing persistence side-effect helper is reused.
  """

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgenticDeviationSignal
  alias NovelApplication.AgenticNextStepPlanner
  alias NovelApplication.AgenticPlanDraftPlanner
  alias NovelApplication.ContextAssembler
  alias NovelApplication.DialogueGateway
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.Planner
  alias NovelApplication.ProviderActivityProjector
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnExecutionService
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.LogContext
  alias NovelDomain.AgentNextStepDecision
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentStep
  alias NovelDomain.BehaviorState
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @profile_ref "conversation_turn_v1"
  @context_step_target "context_assemble"
  @frame_step_target "dialogue_frame"
  @strategy_step_target "strategy_gate"
  @response_step_target "response_finalize"
  @plan_exhausted_replan_reason "计划步骤已走完，但本轮回应尚未生成。"

  # 各步派发前必须已存在的 stage_state 输入（与各 step 的 require_stage_state /
  # finalize_turn 模式匹配一致）。模型起草的计划漏排产出这些输入的步骤时，
  # AgenticDeviationSignal 在派发前按 D1 检出并走 replan，而不是执行期硬失败。
  @step_preconditions %{
    @frame_step_target => [:input, :context],
    @strategy_step_target => [:input, :frame, :context],
    @response_step_target => [:input, :frame, :candidates, :context, :route]
  }

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: no_return()
  def steps(_spec) do
    raise ArgumentError, "conversation_turn_v1 requires next_step_planner/1"
  end

  @spec next_step_planner(map()) :: NovelApplication.AgentRunServer.next_step_planner()
  def next_step_planner(spec) when is_map(spec) do
    fn run, sequence, snapshot ->
      with {:ok, plan, plan_meta} <- plan_for_run(run, snapshot, spec),
           {:ok, decision, result_meta} <-
             mechanical_decision(%{run | plan: plan}, sequence, snapshot, plan_meta, spec) do
        decision
        |> next_step_from_decision(spec)
        |> with_plan_cursor(Map.get(result_meta, :agent_plan_cursor, 0), result_meta)
        |> AgenticNextStepPlanner.with_provider_call_meta(result_meta)
      end
    end
  end

  defp plan_for_run(run, snapshot, spec) do
    if model_plan_ready?(run.plan) do
      {:ok, run.plan, %{provider_call_count: 0, suppress_plan_event: true}}
    else
      with {:ok, plan, meta} <-
             AgenticPlanDraftPlanner.draft_plan_with_meta(
               run,
               planner_provider_execution(spec),
               snapshot
             ) do
        {:ok, plan, Map.put(meta, :agent_plan, plan)}
      end
    end
  end

  defp model_plan_ready?(plan) when is_map(plan) do
    case Map.get(plan, :steps) || Map.get(plan, "steps") do
      [_ | _] = steps ->
        Enum.all?(steps, &(not blank?(map_get(&1, :target_tool_ref))))

      _ ->
        false
    end
  end

  defp model_plan_ready?(_plan), do: false

  defp mechanical_decision(run, sequence, snapshot, meta, spec) do
    steps = plan_steps(run.plan)
    index = plan_cursor(snapshot)
    meta = Map.put(meta, :agent_plan_cursor, index)

    case AgenticDeviationSignal.next(run, snapshot, steps, index,
           step_preconditions: @step_preconditions
         ) do
      nil ->
        cond do
          index < length(steps) ->
            steps
            |> Enum.at(index)
            |> mechanical_execute_decision(run, sequence, snapshot, meta)

          completion_ready?(snapshot) ->
            mechanical_complete_decision(run, sequence)

          true ->
            maybe_replan_exhausted_plan(run, sequence, snapshot, spec)
        end

      deviation ->
        maybe_replan_deviation(run, sequence, snapshot, spec, deviation)
    end
  end

  defp maybe_replan_deviation(run, sequence, snapshot, spec, deviation) do
    if replan_available?(run) do
      with {:ok, revised_plan, revision_meta} <-
             AgenticPlanDraftPlanner.revise_plan_with_meta(
               run,
               planner_provider_execution(spec),
               snapshot,
               revision_reason: AgenticDeviationSignal.revision_reason(deviation)
             ) do
        execute_from_revised_plan(run, sequence, snapshot, revised_plan, revision_meta, deviation)
      end
    else
      mechanical_await_author_decision(run, sequence)
    end
  end

  defp maybe_replan_exhausted_plan(run, sequence, snapshot, spec) do
    if replan_available?(run) do
      with {:ok, revised_plan, revision_meta} <-
             AgenticPlanDraftPlanner.revise_plan_with_meta(
               run,
               planner_provider_execution(spec),
               snapshot,
               revision_reason: @plan_exhausted_replan_reason
             ) do
        execute_from_revised_plan(run, sequence, snapshot, revised_plan, revision_meta, nil)
      end
    else
      mechanical_await_author_decision(run, sequence)
    end
  end

  defp execute_from_revised_plan(run, sequence, snapshot, revised_plan, revision_meta, deviation) do
    revised_run = %{
      run
      | plan: revised_plan,
        plan_ref: revised_plan.plan_id,
        plan_version: revised_plan.version
    }

    steps = plan_steps(revised_plan)
    index = plan_cursor(snapshot)

    meta =
      revision_meta
      |> Map.put(:agent_plan, revised_plan)
      |> Map.put(:agent_plan_cursor, index)
      |> attach_deviation_meta(deviation, snapshot)

    if index < length(steps) do
      steps
      |> Enum.at(index)
      |> mechanical_execute_decision(revised_run, sequence, snapshot, meta)
    else
      revised_await_author_decision(revised_run, sequence, meta)
    end
  end

  defp revised_await_author_decision(run, sequence, meta) do
    with {:ok, decision, await_meta} <- mechanical_await_author_decision(run, sequence) do
      decision = %{
        decision
        | reason_codes:
            (meta_reason_codes(meta) ++ decision.reason_codes)
            |> Enum.uniq(),
          evaluation_of_last: meta_evaluation(meta, sequence),
          plan_revision: map_get(meta, :plan_revision)
      }

      {:ok, decision, Map.merge(await_meta, meta)}
    end
  end

  defp attach_deviation_meta(meta, nil, _snapshot), do: meta

  defp attach_deviation_meta(meta, deviation, snapshot) do
    reason_codes = AgenticDeviationSignal.reason_codes(deviation)

    meta
    |> Map.update(:reason_codes, reason_codes, fn codes ->
      (string_list(codes) ++ reason_codes) |> Enum.uniq()
    end)
    |> Map.put(
      :stage_state_patch,
      AgenticDeviationSignal.stage_state_patch(deviation, stage_state(snapshot))
    )
  end

  defp plan_cursor(snapshot) when is_map(snapshot) do
    snapshot
    |> Map.get(:stage_state, %{})
    |> map_get(:agent_plan_cursor)
    |> case do
      value when is_integer(value) and value >= 0 -> value
      _ -> 0
    end
  end

  defp plan_cursor(_snapshot), do: 0

  defp plan_steps(plan) when is_map(plan) do
    case Map.get(plan, :steps) || Map.get(plan, "steps") do
      steps when is_list(steps) -> steps
      _ -> []
    end
  end

  defp plan_steps(_plan), do: []

  defp mechanical_execute_decision(step, run, sequence, snapshot, meta) do
    target = map_get(step, :target_tool_ref)

    with true <-
           target in [
             @context_step_target,
             @frame_step_target,
             @strategy_step_target,
             @response_step_target
           ],
         {:ok, decision} <-
           AgentNextStepDecision.new(%{
             decision_id:
               "and_#{run.run_id}_#{sequence}_plan_#{map_get(step, :step_id) || sequence}",
             run_ref: run.run_id,
             sequence: sequence,
             decision_type: :execute_step,
             summary: map_get(step, :description) || "执行计划步骤。",
             target_tool_ref: target,
             write_intent: :none,
             risk_hint: :low,
             reason_codes: plan_step_reason_codes(step, target, meta),
             observation_refs: observation_refs(Map.get(snapshot, :observations, [])),
             evaluation_of_last: meta_evaluation(meta, sequence),
             plan_revision: map_get(meta, :plan_revision),
             confidence: meta_confidence(meta)
           }) do
      {:ok, decision, meta}
    else
      _ -> {:error, {:invalid_plan_step_target, target}}
    end
  end

  defp mechanical_complete_decision(run, sequence) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}_plan_goal_satisfied",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :goal_satisfied,
      summary: "计划步骤已完成，本轮回应已生成。",
      target_tool_ref: nil,
      write_intent: :none,
      risk_hint: :low,
      reason_codes: ["goal_satisfied", "agent_plan_mechanical_completion"],
      observation_refs: [],
      evaluation_of_last: %{advanced: true, plan_holds: true, new_constraint: nil},
      confidence: 1.0
    })
    |> case do
      {:ok, decision} -> {:ok, decision, %{provider_call_count: 0}}
      error -> error
    end
  end

  defp mechanical_await_author_decision(run, sequence) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}_plan_exhausted",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: :await_author,
      summary: "计划步骤已走完，但完成条件尚未成立，等待作者确认下一步。",
      target_tool_ref: nil,
      write_intent: :none,
      risk_hint: :medium,
      reason_codes: ["plan_exhausted_without_completion"],
      observation_refs: [],
      evaluation_of_last: %{
        advanced: false,
        plan_holds: false,
        new_constraint: "completion_condition_missing"
      },
      confidence: 1.0
    })
    |> case do
      {:ok, decision} -> {:ok, decision, %{provider_call_count: 0}}
      error -> error
    end
  end

  defp completion_ready?(snapshot) do
    snapshot
    |> Map.get(:observations, [])
    |> Enum.any?(fn
      %AgentObservation{summary: summary} -> String.contains?(summary, "已生成本轮回应")
      _ -> false
    end)
  end

  defp observation_refs(observations) when is_list(observations),
    do: Enum.map(observations, & &1.observation_id)

  defp observation_refs(_observations), do: []

  defp replan_available?(run) do
    consumed = budget_value(run.consumed_budget, :replans, 0)
    max = budget_value(run.budget, :max_replans, 0)

    consumed < max
  end

  defp budget_value(map, key, default) when is_map(map) do
    case map_get(map, key) do
      value when is_integer(value) and value >= 0 -> value
      _ -> default
    end
  end

  defp budget_value(_map, _key, default), do: default

  defp meta_reason_codes(meta), do: meta |> map_get(:reason_codes) |> string_list()

  defp plan_step_reason_codes(step, target, meta) do
    (meta_reason_codes(meta) ++
       [
         "agent_plan_mechanical_step",
         "plan_step:#{map_get(step, :step_id) || target}"
       ])
    |> Enum.uniq()
  end

  defp meta_evaluation(meta, sequence) do
    case map_get(meta, :evaluation_of_last) do
      evaluation when is_map(evaluation) ->
        evaluation

      _ ->
        %{advanced: sequence > 1, plan_holds: true, new_constraint: nil}
    end
  end

  defp meta_confidence(meta) do
    case map_get(meta, :confidence) do
      value when is_float(value) and value >= 0.0 and value <= 1.0 -> value
      value when is_integer(value) and value >= 0 and value <= 1 -> value * 1.0
      _ -> 1.0
    end
  end

  defp string_list(values) when is_list(values) do
    values
    |> Enum.map(&to_string/1)
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
  end

  defp string_list(_values), do: []

  defp with_plan_cursor({:execute, step_fun, decision}, cursor, meta)
       when is_function(step_fun) do
    {:execute, wrap_plan_step(step_fun, cursor, meta), decision}
  end

  defp with_plan_cursor(result, _cursor, _meta), do: result

  defp wrap_plan_step(step_fun, cursor, meta) do
    fn run, sequence, snapshot ->
      run
      |> maybe_put_agent_plan(meta)
      |> then(&step_fun.(&1, sequence, snapshot))
      |> advance_plan_cursor(cursor, meta)
    end
  end

  defp maybe_put_agent_plan(run, %{agent_plan: plan}) when is_map(plan) do
    %{run | plan: plan, plan_ref: plan.plan_id, plan_version: plan.version}
  end

  defp maybe_put_agent_plan(run, _meta), do: run

  defp advance_plan_cursor({:ok, result}, cursor, meta) when is_map(result) do
    stage_patch = map_get(meta, :stage_state_patch) || %{}

    {:ok,
     result
     |> Map.update(:stage_state, Map.merge(stage_patch, %{agent_plan_cursor: cursor + 1}), fn
       stage_state ->
         stage_state
         |> Kernel.||(%{})
         |> Map.merge(stage_patch)
         |> Map.merge(%{agent_plan_cursor: cursor + 1})
     end)
     |> maybe_put_plan_run_patch(meta)}
  end

  defp advance_plan_cursor(result, _cursor, _meta), do: result

  defp maybe_put_plan_run_patch(result, %{agent_plan: plan}) when is_map(plan) do
    patch = %{plan: plan, plan_ref: plan.plan_id, plan_version: plan.version}

    Map.update(result, :run_patch, patch, fn existing ->
      Map.merge(existing || %{}, patch)
    end)
  end

  defp maybe_put_plan_run_patch(result, _meta), do: result

  defp context_step(spec) do
    fn run, sequence, snapshot ->
      input = run_input(spec, run)
      text = Map.fetch!(input, :text)
      ws_id = Map.fetch!(input, :workspace_id)
      work_id = Map.fetch!(input, :work_id)
      session_id = Map.fetch!(input, :session_id)
      turn_id = Map.fetch!(input, :turn_id)

      LogContext.put_turn(ws_id, work_id, turn_id, session_id)

      context =
        ContextAssembler.assemble_for_input(
          ws_id,
          text,
          Map.fetch!(spec, :context_fetcher),
          session_id: session_id,
          assembly_policy: NovelApplication.current_assembly_policy()
        )

      emit_stage(
        snapshot,
        :goal_understood,
        "已组装当前作品上下文。",
        ["context_assembled"],
        [
          "context:#{turn_id}"
        ],
        %{
          stage: :context_assembled,
          context_ref_count: context_ref_count(context)
        }
      )

      {:ok,
       %{
         step: step(run, sequence, "组装创作上下文", nil, nil, nil),
         observations: [
           observation(run, sequence, :custom, "已组装本轮创作上下文。", "context:#{turn_id}")
         ],
         stage_state: %{input: input, context: context},
         progress_signature: "#{run.run_id}:context:#{turn_id}"
       }}
    end
  end

  defp frame_step(spec) do
    fn run, sequence, snapshot ->
      with {:ok, state} <- require_stage_state(snapshot, @frame_step_target, [:input, :context]) do
        state
        |> form_dialogue_frame(spec, snapshot)
        |> frame_step_result(run, sequence)
      end
    end
  end

  defp strategy_step(spec) do
    fn run, sequence, snapshot ->
      with {:ok, state} <-
             require_stage_state(snapshot, @strategy_step_target, [:input, :frame, :context]) do
        execute_strategy_step(run, sequence, snapshot, spec, state)
      end
    end
  end

  defp form_dialogue_frame(state, spec, snapshot) do
    input = Map.fetch!(state, :input)
    context = Map.fetch!(state, :context)

    Planner.form_frame(
      %{
        text: Map.fetch!(input, :text),
        workspace_id: Map.fetch!(input, :workspace_id),
        turn_id: Map.fetch!(input, :turn_id)
      },
      context,
      provider_execution(spec, snapshot, :conversation)
    )
  end

  defp frame_step_result({frame, candidates}, run, sequence) do
    LogContext.put_frame(frame.frame_id)

    case DialogueFrame.validate(frame) do
      :ok -> valid_frame_step_result(frame, candidates, run, sequence)
      {:error, reasons} -> {:error, "frame validation failed: #{Enum.join(reasons, "; ")}"}
    end
  end

  defp valid_frame_step_result(frame, candidates, run, sequence) do
    {:ok,
     %{
       step: step(run, sequence, "形成对话认知帧", nil, nil, nil),
       observations: [
         observation(
           run,
           sequence,
           :custom,
           "已形成对话认知帧：#{frame.frame_type}。",
           "frame:#{frame.frame_id}"
         )
       ],
       stage_state: %{frame: frame, candidates: candidates},
       provider_call_count: 1,
       progress_signature: "#{run.run_id}:frame:#{frame.frame_id}:#{frame.frame_type}"
     }}
  end

  defp execute_strategy_step(run, sequence, snapshot, spec, state) do
    input = Map.fetch!(state, :input)
    frame = Map.fetch!(state, :frame)
    context = Map.fetch!(state, :context)

    if needs_micro_plan?(frame, Map.get(input, :generate_micro_plan, false)) do
      plan_strategy_step(run, sequence, snapshot, spec, input, frame, context)
    else
      reply_only_strategy_step(run, sequence, snapshot, frame)
    end
  end

  defp reply_only_strategy_step(run, sequence, snapshot, frame) do
    emit_stage(
      snapshot,
      :gate_decided,
      "本轮裁决为直接回复，不调用工具。",
      ["reply_only_no_tool"],
      [frame.frame_id],
      %{
        stage: :reply_only_gate,
        frame_ref: frame.frame_id,
        decision_type: :reply_only,
        no_tool_reason: frame.tool_need.reason_code
      }
    )

    {:ok,
     %{
       step: step(run, sequence, "判断无需工具执行", nil, nil, nil),
       observations: [
         observation(
           run,
           sequence,
           :custom,
           "本轮无需工具执行，进入自然回复。",
           "frame:#{frame.frame_id}"
         )
       ],
       stage_state: %{route: :reply_only},
       progress_signature: "#{run.run_id}:strategy:reply_only:#{frame.frame_id}"
     }}
  end

  defp response_step(spec) do
    fn run, sequence, snapshot ->
      state = stage_state(snapshot)

      case finalize_turn(state, spec, snapshot) do
        {:ok, turn_result, trace, candidates, context} ->
          turn_result =
            turn_result
            |> scope_turn_result(state)
            |> AgentFinalizer.attach_run_summary(run_summary(run))

          input = Map.fetch!(state, :input)

          DialogueGateway.persist_turn_side_effects(
            {:ok, turn_result, trace, candidates, context},
            Map.fetch!(input, :workspace_id),
            Map.fetch!(input, :session_id),
            Map.fetch!(input, :text),
            Map.get(spec, :trace_persister),
            Map.get(spec, :memory_recorder)
          )

          {:ok,
           %{
             step: final_step(run, sequence, turn_result),
             observations: [
               observation(
                 run,
                 sequence,
                 :custom,
                 "已生成本轮回应。",
                 "turn_result:#{turn_result.turn_id}"
               )
             ],
             artifact_refs: artifact_refs(turn_result),
             turn_result: turn_result,
             tool_call_count: tool_call_count(turn_result),
             provider_call_count: provider_call_count(turn_result),
             progress_signature: progress_signature(turn_result)
           }}

        {:error, reason} ->
          {:error, reason}
      end
    end
  end

  defp plan_strategy_step(run, sequence, snapshot, spec, input, %DialogueFrame{} = frame, context) do
    case Planner.form_micro_plan(
           frame,
           input,
           provider_execution(spec, snapshot, :conversation),
           context
         ) do
      {:ok, %MicroPlan{} = plan} ->
        {decision, behavior} = ExecutionOrchestrator.decide(frame, plan)
        {route, summary} = route_for(decision, behavior)

        emit_stage(
          snapshot,
          :gate_decided,
          summary,
          ["orchestrator_decision_recorded"],
          [decision.decision_id],
          %{
            stage: :orchestrator_decision_recorded,
            decision_ref: decision.decision_id,
            decision_type: decision.decision_type,
            first_blocking_gate: decision.first_blocking_gate
          }
        )

        {:ok,
         %{
           step: step(run, sequence, "制定执行策略并完成授权判断", plan, decision, nil),
           observations: [
             observation(run, sequence, :custom, summary, decision_or_plan_ref(decision, plan))
           ],
           stage_state:
             %{route: route, plan: plan, decision: decision, behavior: behavior}
             |> Map.merge(gate_deviation_state(route, decision)),
           provider_call_count: 1,
           progress_signature:
             "#{run.run_id}:strategy:#{route}:#{plan.plan_id}:#{decision.decision_id}"
         }}

      {:error, reason} ->
        {:ok,
         %{
           step: step(run, sequence, "制定执行策略失败，准备降级回复", nil, nil, nil),
           observations: [
             observation(
               run,
               sequence,
               :custom,
               "执行策略生成失败，已准备恢复为自然回复。",
               "frame:#{frame.frame_id}"
             )
           ],
           stage_state: %{route: :planner_recovery, planner_error: reason},
           progress_signature: "#{run.run_id}:strategy:recovery:#{frame.frame_id}"
         }}
    end
  end

  defp finalize_turn(
         %{route: :reply_only, frame: frame, candidates: candidates, context: context},
         _spec,
         _snapshot
       ) do
    {trace, trace_summary} = TraceWriter.record(frame, %{turn_id: frame.turn_id}, context)
    {:ok, TurnResultBuilder.build(frame, trace_summary, candidates), trace, candidates, context}
  end

  defp finalize_turn(
         %{route: :planner_recovery, frame: frame, candidates: candidates, context: context},
         _spec,
         _snapshot
       ) do
    {trace, trace_summary} =
      TraceWriter.record_recovery(frame, %{turn_id: frame.turn_id}, context)

    {:ok, TurnResultBuilder.build(frame, trace_summary, candidates), trace, candidates, context}
  end

  defp finalize_turn(
         %{
           route: :tool,
           frame: frame,
           plan: plan,
           decision: decision,
           candidates: candidates,
           context: context,
           input: input
         },
         spec,
         snapshot
       ) do
    {turn_result, trace} =
      TurnExecutionService.execute(%{
        frame: frame,
        plan: plan,
        decision: decision,
        candidates: candidates,
        context: context,
        author_input: input,
        provider_execution: provider_execution(spec, snapshot, :tool),
        quality_provider_execution: quality_provider_execution(input, spec, snapshot),
        chapter_prose_reader:
          map_get(input, :chapter_prose_reader) ||
            NovelApplication.persistence_chapter_prose_reader(),
        chapter_summary_reader:
          map_get(input, :chapter_summary_reader) ||
            NovelApplication.persistence_chapter_summary_reader(),
        character_reader:
          map_get(input, :character_reader) || NovelApplication.persistence_character_reader()
      })

    {:ok, turn_result, trace, candidates, context}
  end

  defp finalize_turn(
         %{
           route: :behavior,
           frame: frame,
           plan: plan,
           decision: decision,
           behavior: %BehaviorState{} = behavior,
           candidates: candidates,
           context: context
         },
         _spec,
         _snapshot
       ) do
    {trace, trace_summary} =
      TraceWriter.record_with_decision(frame, plan, decision, %{turn_id: frame.turn_id}, context)

    trace = TraceWriter.attach_behavior(trace, behavior, :open)

    turn_result =
      TurnResultBuilder.build(frame, trace_summary, candidates, decision, nil, nil, behavior)
      |> Map.put(:plan, DialogueGateway.jsonable(plan))
      |> Map.put(:workspace_id, frame.workspace_id)

    {:ok, turn_result, trace, candidates, context}
  end

  defp finalize_turn(
         %{
           route: route,
           frame: frame,
           plan: %MicroPlan{} = plan,
           decision: %OrchestratorDecision{} = decision,
           candidates: candidates,
           context: context
         },
         _spec,
         _snapshot
       )
       when route in [:blocked, :nested_agent_run_blocked] do
    {trace, trace_summary} =
      TraceWriter.record_with_decision(frame, plan, decision, %{turn_id: frame.turn_id}, context)

    {:ok, TurnResultBuilder.build(frame, trace_summary, candidates, decision), trace, candidates,
     context}
  end

  defp finalize_turn(state, _spec, _snapshot),
    do: {:error, {:invalid_conversation_stage_state, Map.keys(state)}}

  defp provider_execution(spec, snapshot, purpose) do
    spec
    |> provider_execution_base()
    |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: purpose)
  end

  defp quality_provider_execution(input, spec, snapshot) do
    (map_get(input, :quality_provider_execution) || provider_execution_base(spec))
    |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: :evaluator)
  end

  defp provider_execution_base(spec) do
    Map.get(spec, :provider_execution) ||
      Execution.dependency(purpose: :conversation)
  end

  defp planner_provider_execution(spec) do
    Map.get(spec, :planner_provider_execution) ||
      provider_execution_base(spec)
  end

  defp run_input(spec, run) do
    input = Map.fetch!(spec, :input)
    ws_id = map_get(input, :workspace_id) || "default"
    work_id = map_get(input, :work_id) || ws_id
    turn_id = map_get(input, :turn_id) || run.parent_turn_ref
    session_id = map_get(input, :session_id) || run.session_id || "session_#{turn_id}"

    input
    |> Map.put(:text, run.goal.text)
    |> Map.put(:workspace_id, ws_id)
    |> Map.put(:work_id, work_id)
    |> Map.put(:session_id, session_id)
    |> Map.put(:turn_id, turn_id)
  end

  defp needs_micro_plan?(%DialogueFrame{} = frame, generate_plan),
    do: generate_plan || frame.tool_need.needs_tool

  defp route_for(%OrchestratorDecision{decision_type: :allow_tool} = decision, _behavior),
    do: {:tool, "已通过工具执行授权：#{decision.decision_type}。"}

  defp route_for(%OrchestratorDecision{decision_type: :allow_agent_run}, _behavior),
    do: {:nested_agent_run_blocked, "本轮已在 AgentRun 内，阻止再次嵌套启动 AgentRun。"}

  defp route_for(%OrchestratorDecision{} = decision, %BehaviorState{}),
    do: {:behavior, "已进入作者确认或澄清流程：#{decision.decision_type}。"}

  defp route_for(%OrchestratorDecision{} = decision, _behavior),
    do: {:blocked, "授权判断未允许执行：#{decision.decision_type}。"}

  defp gate_deviation_state(route, %OrchestratorDecision{} = decision)
       when route in [:behavior, :blocked, :nested_agent_run_blocked] do
    summary = "Orchestrator 未允许继续执行：#{decision.decision_type}。"

    %{
      agentic_deviation: %{
        signal: "D4",
        ref: "gate:#{decision.decision_id}",
        summary: summary,
        source: "orchestrator_gate",
        payload: %{
          decision_type: decision.decision_type,
          first_blocking_gate: decision.first_blocking_gate
        }
      }
    }
  end

  defp gate_deviation_state(_route, _decision), do: %{}

  defp run_summary(run) do
    %{
      run_id: run.run_id,
      run_mode: run.run_mode,
      parent_turn_ref: run.parent_turn_ref,
      profile_ref: run.profile_ref,
      status: :completed
    }
  end

  defp step(run, sequence, goal, plan, decision, tool_result_ref) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: goal,
        micro_plan_ref: plan_ref(plan),
        decision_ref: decision_ref(decision),
        tool_result_ref: tool_result_ref,
        observation_refs: [],
        state_snapshot_ref: state_snapshot_ref(run, sequence, goal),
        idempotency_key:
          "#{run.run_id}:#{sequence}:conversation_turn:#{snapshot_slug(goal)}:goal_v#{run.goal.version}"
      })

    step
  end

  defp final_step(run, sequence, turn_result) do
    trace_summary = Map.get(turn_result, :trace_summary) || %{}
    tool_result = Map.get(turn_result, :tool_result) || %{}

    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: "生成本轮回应并写入可回放留痕",
        micro_plan_ref: Map.get(trace_summary, :plan_ref),
        decision_ref: Map.get(trace_summary, :decision_ref),
        tool_request_ref: Map.get(trace_summary, :tool_request_id),
        tool_result_ref:
          Map.get(trace_summary, :tool_result_id) || Map.get(tool_result, :tool_result_id),
        observation_refs: [],
        state_snapshot_ref: state_snapshot_ref(run, sequence, "生成本轮回应并写入可回放留痕"),
        idempotency_key:
          "#{run.run_id}:#{sequence}:conversation_turn:finalize:goal_v#{run.goal.version}"
      })

    step
  end

  defp observation(run, sequence, type, summary, evidence_ref) do
    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs_#{run.run_id}_#{sequence}_conversation",
        run_ref: run.run_id,
        step_ref: current_step_ref(run, sequence),
        observation_type: type,
        source_ref: evidence_ref,
        summary: summary,
        evidence_refs: [evidence_ref]
      })

    observation
  end

  defp scope_turn_result(turn_result, %{input: input}) do
    turn_result
    |> Map.put_new(:workspace_id, Map.fetch!(input, :workspace_id))
    |> Map.put_new(:work_id, Map.fetch!(input, :work_id))
    |> Map.put_new(:session_id, Map.fetch!(input, :session_id))
  end

  defp current_step_ref(run, sequence),
    do: run.current_step_ref || "step_#{run.run_id}_#{sequence}"

  defp state_snapshot_ref(run, sequence, goal) do
    [
      "agent_snapshot",
      run.work_id,
      run.session_id,
      run.run_id,
      "step",
      sequence,
      "conversation_turn",
      snapshot_slug(goal),
      "goal_v#{run.goal.version}"
    ]
    |> Enum.map_join(":", &to_string/1)
  end

  defp artifact_refs(turn_result) do
    turn_result
    |> Map.get(:adoption_state, %{})
    |> Map.get(:pending, [])
    |> Enum.map(&(Map.get(&1, :artifact_id) || Map.get(&1, "artifact_id")))
    |> Enum.reject(&blank?/1)
  end

  defp tool_call_count(turn_result) do
    if get_in(turn_result, [:truthfulness, :tool_called]) == true, do: 1, else: 0
  end

  defp provider_call_count(turn_result) do
    turn_result
    |> get_in([:trace_summary, :provider_call_budget])
    |> case do
      budget when is_map(budget) ->
        budget
        |> Map.values()
        |> Enum.filter(&is_integer/1)
        |> Enum.sum()

      _ ->
        0
    end
  end

  defp progress_signature(turn_result) do
    [
      Map.get(turn_result, :turn_id),
      get_in(turn_result, [:trace_summary, :decision_type]),
      get_in(turn_result, [:assistant_message, :text])
    ]
    |> Enum.reject(&blank?/1)
    |> Enum.map_join(":", &to_string/1)
  end

  defp stage_state(snapshot), do: Map.get(snapshot, :stage_state, %{})

  defp require_stage_state(snapshot, target_tool_ref, required_keys) do
    state = stage_state(snapshot)

    missing =
      Enum.reject(required_keys, fn key ->
        Map.has_key?(state, key) or Map.has_key?(state, Atom.to_string(key))
      end)

    if missing == [] do
      {:ok, state}
    else
      {:error,
       %{
         type: :agent_step_precondition_failed,
         target_tool_ref: target_tool_ref,
         missing_stage_state_keys: Enum.map(missing, &to_string/1),
         available_stage_state_keys: state |> Map.keys() |> Enum.map(&to_string/1) |> Enum.sort()
       }}
    end
  end

  defp decision_or_plan_ref(%OrchestratorDecision{decision_id: id}, _plan)
       when is_binary(id) and id != "",
       do: "decision:#{id}"

  defp decision_or_plan_ref(_decision, %MicroPlan{plan_id: id}) when is_binary(id) and id != "",
    do: "plan:#{id}"

  defp plan_ref(%MicroPlan{plan_id: plan_id}), do: plan_id
  defp plan_ref(_plan), do: nil

  defp decision_ref(%OrchestratorDecision{decision_id: decision_id}), do: decision_id
  defp decision_ref(_decision), do: nil

  defp emit_stage(%{stage_sink: stage_sink}, event_type, summary, reason_codes, refs, payload)
       when is_function(stage_sink, 1) do
    stage_sink.(%{
      event_type: event_type,
      summary: summary,
      reason_codes: reason_codes,
      refs: refs,
      payload: payload
    })

    :ok
  end

  defp emit_stage(_snapshot, _event_type, _summary, _reason_codes, _refs, _payload), do: :ok

  defp context_ref_count(%{context_refs: refs}) when is_list(refs), do: length(refs)
  defp context_ref_count(_context), do: 0

  defp map_get(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_get(_map, _key), do: nil

  defp snapshot_slug(value) do
    value
    |> to_string()
    |> String.downcase()
    |> String.replace(~r/[^a-z0-9一-龥]+/u, "_")
    |> String.trim("_")
    |> case do
      "" -> "stage"
      slug -> slug
    end
  end

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @context_step_target
         } = decision,
         spec
       ),
       do: {:execute, context_step(spec), decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @frame_step_target
         } = decision,
         spec
       ),
       do: {:execute, frame_step(spec), decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @strategy_step_target
         } = decision,
         spec
       ),
       do: {:execute, strategy_step(spec), decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{
           decision_type: :execute_step,
           target_tool_ref: @response_step_target
         } = decision,
         spec
       ),
       do: {:execute, response_step(spec), decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{decision_type: :goal_satisfied} = decision,
         _spec
       ),
       do: {:complete, decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{decision_type: :await_author} = decision,
         _spec
       ),
       do: {:await_author, decision}

  defp next_step_from_decision(
         %AgentNextStepDecision{decision_type: :no_progress} = decision,
         _spec
       ),
       do: {:await_author, decision}

  defp blank?(value), do: is_nil(value) or value == ""
end
