defmodule NovelApplication.AgentRunFlows.CharacterDesignWithContext do
  @moduledoc """
  Bounded AgentRun flow for reading the current character roster before
  producing a tentative character-design candidate.
  """

  alias NovelAgent.Provider.Gateway
  alias NovelApplication.AgentFinalizer
  alias NovelApplication.AgentObservationAssembler
  alias NovelApplication.AgentStepPlanner
  alias NovelApplication.ExecutionOrchestrator
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AgentStep
  alias NovelDomain.DialogueFrame

  @profile_ref "character_design_with_context_v1"

  @spec profile_ref() :: String.t()
  def profile_ref, do: @profile_ref

  @spec steps(map()) :: [NovelApplication.AgentRunService.step_fun()]
  def steps(spec) when is_map(spec), do: [step_fun(spec), step_fun(spec)]

  defp step_fun(spec) do
    fn run, sequence, snapshot ->
      execute_tool_step(run, sequence, spec, Map.get(snapshot, :observations, []))
    end
  end

  defp execute_tool_step(run, sequence, spec, observations) do
    with {:ok, plan} <- AgentStepPlanner.next_plan(run, sequence, observations) do
      frame = frame(run, sequence, plan.plan_goal.summary)
      plan = %{plan | turn_id: frame.turn_id, frame_ref: frame.frame_id}
      {decision, _behavior} = ExecutionOrchestrator.decide(frame, plan)

      if decision.decision_type == :allow_tool do
        do_execute_tool_step(run, sequence, spec, frame, plan, decision, observations)
      else
        {:error, {:agent_step_blocked, tool_name(plan), decision.first_blocking_gate}}
      end
    end
  end

  defp do_execute_tool_step(run, sequence, spec, frame, plan, decision, observations) do
    tool_name = tool_name(plan)

    {turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame,
        plan: plan,
        decision: decision,
        candidates: [],
        context: Map.get(spec, :context),
        author_input: %{text: author_input_text(run, plan, observations)},
        source_turn_ref: run.parent_turn_ref,
        complete_fn: complete_fn(tool_name, spec),
        quality_complete_fn: nil,
        chapter_prose_reader: NovelApplication.persistence_chapter_prose_reader(),
        chapter_summary_reader: NovelApplication.persistence_chapter_summary_reader(),
        character_reader:
          Map.get(spec, :character_reader) || NovelApplication.persistence_character_reader()
      })

    tool_result = Map.get(turn_result, :tool_result) || %{}

    if Map.get(tool_result, :status) == :failed do
      {:error, {:tool_failed, tool_name, Map.get(tool_result, :errors, [])}}
    else
      turn_result = maybe_finalize(turn_result, run, sequence)

      {:ok,
       %{
         step: step(run, sequence, plan, turn_result),
         observations:
           AgentObservationAssembler.from_turn_result(turn_result, %{
             run_id: run.run_id,
             step_id: current_step_ref(run, sequence)
           }),
         artifact_refs: artifact_refs(turn_result),
         turn_result: turn_result,
         tool_call_count: 1,
         provider_call_count: provider_call_count(tool_name),
         progress_signature: progress_signature(turn_result)
       }}
    end
  end

  defp complete_fn("character_design", spec) do
    Map.get(spec, :complete_fn) || (&Gateway.complete/1)
  end

  defp complete_fn(_tool_name, _spec), do: nil

  defp author_input_text(run, plan, observations) do
    observation_text =
      observations
      |> Enum.map(& &1.summary)
      |> Enum.reject(&blank?/1)
      |> Enum.join("\n")

    [
      run.goal.text,
      "当前 AgentStep：#{plan.plan_goal.summary}",
      observation_section(observation_text)
    ]
    |> Enum.reject(&blank?/1)
    |> Enum.join("\n\n")
  end

  defp observation_section(""), do: nil
  defp observation_section(text), do: "已完成观察：\n#{text}"

  defp frame(run, sequence, summary) do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame_#{run.run_id}_#{sequence}",
      turn_id: "#{run.parent_turn_ref}:agent:#{sequence}",
      workspace_id: run.work_id,
      primary: false,
      frame_type: :execution_candidate,
      source_refs: %{
        author_input_ref: run.parent_turn_ref,
        agent_run_ref: run.run_id
      },
      dialogue_goal: %{summary: summary},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: summary},
      evidence_summary: %{agent_run_ref: run.run_id},
      uncertainty: []
    }
  end

  defp step(run, sequence, plan, turn_result) do
    action = hd(plan.proposed_actions)
    step_tool_name = action[:target_ref]
    trace_summary = Map.get(turn_result, :trace_summary) || %{}
    tool_result = Map.get(turn_result, :tool_result) || %{}

    {:ok, step} =
      AgentStep.new(%{
        step_id: current_step_ref(run, sequence),
        run_ref: run.run_id,
        sequence: sequence,
        status: :completed,
        goal: action[:summary],
        micro_plan_ref: Map.get(trace_summary, :plan_ref) || plan.plan_id,
        decision_ref: Map.get(trace_summary, :decision_ref),
        tool_request_ref: Map.get(trace_summary, :tool_request_id),
        tool_result_ref:
          Map.get(trace_summary, :tool_result_id) || Map.get(tool_result, :tool_result_id),
        observation_refs: [observation_id(run, sequence, observation_type(action[:target_ref]))],
        state_snapshot_ref: state_snapshot_ref(run, sequence, step_tool_name),
        idempotency_key: "#{run.run_id}:#{sequence}:#{step_tool_name}:goal_v#{run.goal.version}"
      })

    step
  end

  defp state_snapshot_ref(run, sequence, tool_name) do
    [
      "agent_snapshot",
      run.work_id,
      run.session_id,
      run.run_id,
      "step",
      sequence,
      tool_name,
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

  defp current_step_ref(run, sequence),
    do: run.current_step_ref || "step_#{run.run_id}_#{sequence}"

  defp observation_type("character_design"), do: :artifact_created
  defp observation_type(_tool_name), do: :character_roster

  defp observation_id(run, sequence, type), do: "obs_#{run.run_id}_#{sequence}_#{type}"

  defp tool_name(plan), do: plan.proposed_actions |> hd() |> Map.fetch!(:target_ref)

  defp maybe_finalize(turn_result, run, 2) do
    AgentFinalizer.attach_run_summary(turn_result, %{
      run_id: run.run_id,
      run_mode: run.run_mode,
      profile_ref: run.profile_ref,
      status: :completed
    })
  end

  defp maybe_finalize(turn_result, _run, _sequence), do: turn_result

  defp provider_call_count("character_design"), do: 1
  defp provider_call_count(_tool_name), do: 0

  defp progress_signature(turn_result) do
    tool_result = Map.get(turn_result, :tool_result) || %{}
    output = Map.get(tool_result, :output) || Map.get(tool_result, "output") || %{}

    [
      Map.get(tool_result, :tool_name),
      stable_signature(output),
      artifact_refs(turn_result) |> Enum.join(",")
    ]
    |> Enum.reject(&blank?/1)
    |> Enum.join(":")
  end

  defp stable_signature(value) do
    :crypto.hash(:sha256, :erlang.term_to_binary(value))
    |> Base.encode16(case: :lower)
  end

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""
end
