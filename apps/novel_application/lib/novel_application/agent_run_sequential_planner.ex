defmodule NovelApplication.AgentRunSequentialPlanner do
  @moduledoc """
  Temporary next-step planner for profiles not yet migrated to observation-led planning.

  It keeps those profiles on the single AgentRun `next_step_planner` runtime
  path. New profile work should prefer a provider-backed or rule-backed planner
  that decides from the run goal and observations.
  """

  alias NovelDomain.{AgentNextStepDecision, AgentRun}

  @type step_snapshot :: NovelApplication.AgentRunServer.step_snapshot()
  @type step_fun :: NovelApplication.AgentRunServer.step_fun()

  @spec from_steps([step_fun()]) :: NovelApplication.AgentRunServer.next_step_planner()
  def from_steps(steps) when is_list(steps) do
    fn %AgentRun{} = run, sequence, _snapshot ->
      case Enum.at(steps, sequence - 1) do
        nil ->
          {:complete, complete_decision(run, sequence), %{provider_call_count: 0}}

        step_fun when is_function(step_fun) ->
          {:execute, wrap_step(step_fun, length(steps)), execute_decision(run, sequence),
           %{provider_call_count: 0}}
      end
    end
  end

  defp wrap_step(step_fun, step_count) do
    fn run, sequence, snapshot ->
      step_fun
      |> execute_step_fun(run, sequence, snapshot)
      |> maybe_complete_after_step(sequence, step_count)
    end
  end

  defp execute_step_fun(step_fun, run, sequence, snapshot) when is_function(step_fun, 3),
    do: step_fun.(run, sequence, snapshot)

  defp execute_step_fun(step_fun, run, sequence, _snapshot) when is_function(step_fun, 2),
    do: step_fun.(run, sequence)

  defp maybe_complete_after_step({:ok, result}, sequence, step_count)
       when is_map(result) and sequence >= step_count do
    {:ok, Map.put(result, :loop_status, :completed)}
  end

  defp maybe_complete_after_step(result, _sequence, _step_count), do: result

  defp execute_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :execute_step,
        summary: step_summary(run, sequence),
        target_tool_ref: first_allowed_tool(run),
        write_intent: :none,
        risk_hint: :low,
        reason_codes: ["sequential_profile_pending_agentic_migration"]
      })

    decision
  end

  defp complete_decision(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "AgentRun 已完成。",
        reason_codes: ["sequential_profile_completed"]
      })

    decision
  end

  defp step_summary(run, sequence) do
    case milestone_summary(run.plan, sequence) do
      summary when is_binary(summary) and summary != "" -> summary
      _ -> "执行第 #{sequence} 步"
    end
  end

  defp milestone_summary(plan, sequence) when is_map(plan) do
    milestones = Map.get(plan, :milestones) || Map.get(plan, "milestones") || []

    milestones
    |> Enum.at(sequence - 1)
    |> case do
      milestone when is_map(milestone) ->
        Map.get(milestone, :summary) || Map.get(milestone, "summary")

      _ ->
        nil
    end
  end

  defp milestone_summary(_plan, _sequence), do: nil

  defp first_allowed_tool(%AgentRun{authority_scope: %{allowed_tools: [tool | _rest]}}), do: tool
  defp first_allowed_tool(%AgentRun{}), do: "agent_step"
end
