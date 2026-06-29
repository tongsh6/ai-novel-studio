defmodule NovelApplication.AgentStepPlanner do
  @moduledoc """
  Deterministic first AgentStep planner for bounded creative runs.

  It emits a single-action MicroPlan for each step. It does not approve the
  action; ExecutionOrchestrator remains the authority boundary.
  """

  alias NovelAgent.AgentTaskProfileRegistry
  alias NovelDomain.AgentObservation
  alias NovelDomain.AgentRun
  alias NovelDomain.MicroPlan

  @spec next_plan(AgentRun.t(), pos_integer(), [AgentObservation.t()]) ::
          {:ok, MicroPlan.t()} | {:error, term()}
  def next_plan(%AgentRun{profile_ref: "character_design_with_context_v1"} = run, 1, _obs) do
    build_plan(run, 1, %{
      action_id: "act_#{run.run_id}_inspect_roster",
      action_type: :capability_invocation,
      summary: "读取当前作品已确认角色阵容",
      target_ref: "character_roster",
      write_intent: :none,
      risk_hint: :low
    })
  end

  def next_plan(%AgentRun{profile_ref: "character_design_with_context_v1"} = run, 2, obs) do
    if repeat_roster_probe?(run.goal.text) do
      build_plan(run, 2, %{
        action_id: "act_#{run.run_id}_inspect_roster_again",
        action_type: :capability_invocation,
        summary: "再次读取当前作品已确认角色阵容，确认是否有新增信息",
        target_ref: "character_roster",
        write_intent: :none,
        risk_hint: :low
      })
    else
      case character_roster_observation(obs) do
        %AgentObservation{} = observation ->
          build_plan(run, 2, %{
            action_id: "act_#{run.run_id}_design_character",
            action_type: :capability_invocation,
            summary: "基于角色阵容观察设计新的主要反派：#{observation.summary}",
            target_ref: "character_design",
            write_intent: :tentative,
            risk_hint: :low
          })

        nil ->
          {:error, :missing_character_roster_observation}
      end
    end
  end

  def next_plan(%AgentRun{profile_ref: "prose_drafting_with_quality_v1"} = run, 2, _obs) do
    build_plan(run, 2, %{
      action_id: "act_#{run.run_id}_draft_prose_with_quality",
      action_type: :capability_invocation,
      summary: "生成正文草稿并进行质量复核",
      target_ref: "prose_writing",
      write_intent: :tentative,
      risk_hint: :low
    })
  end

  def next_plan(%AgentRun{} = run, _sequence, _obs),
    do: {:error, {:unknown_profile, run.profile_ref}}

  defp build_plan(run, sequence, action) do
    tool_name = action.target_ref

    if AgentTaskProfileRegistry.allowed_tool?(run.profile_ref, tool_name) do
      {:ok,
       %MicroPlan{
         plan_id: "mp_#{run.run_id}_#{sequence}",
         turn_id: run.parent_turn_ref,
         frame_ref: run.origin_frame_ref,
         plan_goal: %{summary: action.summary},
         risk_hint: action.risk_hint,
         proposed_actions: [action],
         required_capabilities: [tool_name]
       }}
    else
      {:error, {:tool_not_allowed_by_profile, tool_name}}
    end
  end

  defp character_roster_observation(observations) do
    Enum.find(observations, fn
      %AgentObservation{observation_type: :character_roster} -> true
      _ -> false
    end)
  end

  defp repeat_roster_probe?(text) when is_binary(text) do
    normalized = String.downcase(text)

    Enum.any?(
      ["重复读取角色阵容", "重复查看角色阵容", "没有新信息", "没有新进展", "无新进展"],
      &String.contains?(normalized, &1)
    )
  end

  defp repeat_roster_probe?(_), do: false
end
