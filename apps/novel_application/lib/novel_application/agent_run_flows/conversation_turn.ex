defmodule NovelApplication.AgentRunFlows.ConversationTurn do
  @moduledoc """
  AgentRun flow for a single conversational turn.

  The flow keeps the v3 dialogue main chain inside the AgentRun lifecycle:
  context assembly -> frame formation -> planning/gate decision -> response
  finalization. It does not call `DialogueGateway.handle_input/5` as a black-box
  fallback; only the existing persistence side-effect helper is reused.
  """

  alias NovelApplication.AgentFinalizer
  alias NovelApplication.ContextAssembler
  alias NovelApplication.DialogueGateway
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.Planner
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnExecutionService
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.LogContext
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentStep
  alias NovelDomain.BehaviorState
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @profile_ref "conversation_turn_v1"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: [NovelApplication.AgentRunService.step_fun()]
  def steps(spec) when is_map(spec) do
    [
      context_step(spec),
      frame_step(spec),
      strategy_step(spec),
      response_step(spec)
    ]
  end

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

      emit_stage(snapshot, :goal_understood, "已组装当前作品上下文。", ["context_assembled"], [
        "context:#{turn_id}"
      ], %{
        stage: :context_assembled,
        context_ref_count: context_ref_count(context)
      })

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
      %{input: input, context: context} = stage_state(snapshot)
      text = Map.fetch!(input, :text)
      ws_id = Map.fetch!(input, :workspace_id)
      turn_id = Map.fetch!(input, :turn_id)

      {frame, candidates} =
        Planner.form_frame(
          %{text: text, workspace_id: ws_id, turn_id: turn_id},
          context,
          Map.fetch!(spec, :complete_fn)
        )

      LogContext.put_frame(frame.frame_id)

      case DialogueFrame.validate(frame) do
        :ok ->
          emit_stage(
            snapshot,
            :plan_created,
            "已形成对话认知帧：#{frame.frame_type}。",
            ["dialogue_frame_formed"],
            [frame.frame_id],
            %{
              stage: :dialogue_frame_formed,
              frame_ref: frame.frame_id,
              frame_type: frame.frame_type,
              needs_tool: frame.tool_need.needs_tool,
              candidate_count: length(candidates)
            }
          )

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

        {:error, reasons} ->
          {:error, "frame validation failed: #{Enum.join(reasons, "; ")}"}
      end
    end
  end

  defp strategy_step(spec) do
    fn run, sequence, snapshot ->
      state = stage_state(snapshot)
      input = Map.fetch!(state, :input)
      frame = Map.fetch!(state, :frame)
      context = Map.fetch!(state, :context)
      generate_plan = Map.get(input, :generate_micro_plan, false)

      if needs_micro_plan?(frame, generate_plan) do
        plan_strategy_step(run, sequence, snapshot, spec, input, frame, context)
      else
        emit_stage(snapshot, :gate_decided, "本轮裁决为直接回复，不调用工具。", [
          "reply_only_no_tool"
        ], [frame.frame_id], %{
          stage: :reply_only_gate,
          frame_ref: frame.frame_id,
          decision_type: :reply_only,
          no_tool_reason: frame.tool_need.reason_code
        })

        {:ok,
         %{
           step: step(run, sequence, "判断无需工具执行", nil, nil, nil),
           observations: [
             observation(run, sequence, :custom, "本轮无需工具执行，进入自然回复。", "frame:#{frame.frame_id}")
           ],
           stage_state: %{route: :reply_only},
           progress_signature: "#{run.run_id}:strategy:reply_only:#{frame.frame_id}"
         }}
      end
    end
  end

  defp response_step(spec) do
    fn run, sequence, snapshot ->
      state = stage_state(snapshot)

      case finalize_turn(state, spec) do
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
             observations: [],
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
    case Planner.form_micro_plan(frame, input, Map.fetch!(spec, :complete_fn), context) do
      {:ok, %MicroPlan{} = plan} ->
        {decision, behavior} = ExecutionOrchestrator.decide(frame, plan)
        {route, summary} = route_for(decision, behavior)

        emit_stage(
          snapshot,
          :plan_created,
          "已生成单步执行计划。",
          ["micro_plan_created"],
          [plan.plan_id],
          %{
            stage: :micro_plan_created,
            plan_ref: plan.plan_id,
            action_count: length(plan.proposed_actions)
          }
        )

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
           stage_state: %{route: route, plan: plan, decision: decision, behavior: behavior},
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
         _spec
       ) do
    {trace, trace_summary} = TraceWriter.record(frame, %{turn_id: frame.turn_id}, context)
    {:ok, TurnResultBuilder.build(frame, trace_summary, candidates), trace, candidates, context}
  end

  defp finalize_turn(
         %{route: :planner_recovery, frame: frame, candidates: candidates, context: context},
         _spec
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
         spec
       ) do
    {turn_result, trace} =
      TurnExecutionService.execute(%{
        frame: frame,
        plan: plan,
        decision: decision,
        candidates: candidates,
        context: context,
        author_input: input,
        complete_fn: Map.fetch!(spec, :complete_fn),
        quality_complete_fn:
          map_get(input, :quality_complete_fn) || Map.fetch!(spec, :complete_fn),
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
         _spec
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
         _spec
       )
       when route in [:blocked, :nested_agent_run_blocked] do
    {trace, trace_summary} =
      TraceWriter.record_with_decision(frame, plan, decision, %{turn_id: frame.turn_id}, context)

    {:ok, TurnResultBuilder.build(frame, trace_summary, candidates, decision), trace, candidates,
     context}
  end

  defp finalize_turn(state, _spec),
    do: {:error, {:invalid_conversation_stage_state, Map.keys(state)}}

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

  defp run_summary(run) do
    %{
      run_id: run.run_id,
      run_mode: run.run_mode,
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

  defp blank?(value), do: is_nil(value) or value == ""
end
