defmodule NovelApplication.AgenticNextStepPlanner do
  @moduledoc """
  Provider-backed next-step planner for AgentRun loops.

  The planner proposes only the next loop decision. It does not approve
  execution; callers must turn `:execute_step` into a single-action MicroPlan
  and re-enter ExecutionOrchestrator.
  """

  alias NovelAgent.AgentTaskProfileRegistry
  alias NovelAgent.Provider.Execution
  alias NovelApplication.ProviderActivityProjector
  alias NovelDomain.{AgentNextStepDecision, AgentObservation, AgentRun}

  @type provider_execution :: Execution.dependency()

  @spec next_decision(
          AgentRun.t(),
          pos_integer(),
          [AgentObservation.t()],
          provider_execution(),
          map()
        ) ::
          {:ok, AgentNextStepDecision.t()} | {:error, term()}
  def next_decision(
        %AgentRun{} = run,
        sequence,
        observations,
        provider_execution,
        snapshot \\ %{}
      ) do
    complete_fn =
      provider_execution
      |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: :planner)
      |> Execution.complete_fn()

    with complete_fn when is_function(complete_fn, 1) <- complete_fn,
         {:ok, %{content: content}} <- complete_fn.(prompt(run, sequence, observations)),
         {:ok, parsed} <- parse_json(content),
         {:ok, decision} <- build_decision(run, sequence, observations, parsed),
         :ok <- validate_profile_tool(run, decision) do
      {:ok, decision}
    else
      nil -> {:error, :provider_execution_required}
      {:error, reason} -> {:error, reason}
      other -> {:error, {:invalid_next_step_decision, other}}
    end
  end

  defp prompt(%AgentRun{} = run, sequence, observations) do
    """
    你是小说创作系统的 AgentRun 下一步规划器。你每次只决定下一步，不批准执行。

    ## 当前 AgentRun
    - run_id: #{run.run_id}
    - profile_ref: #{run.profile_ref}
    - goal_version: #{run.goal.version}
    - author_goal: #{run.goal.text}
    - sequence: #{sequence}
    - allowed_tools: #{Enum.join(run.authority_scope.allowed_tools, ", ")}
    - internal_observation_steps: #{Enum.join(internal_observation_steps(run.profile_ref), ", ")}

    ## 已有观察
    #{observation_lines(observations)}

    ## 决策规则
    #{profile_rules(run.profile_ref)}
    - 如果缺少作者输入或不能在当前 allowed_tools 内推进，decision_type 使用 await_author。
    - 如果下一步只会重复已有观察且没有新增信息，decision_type 使用 no_progress。
    - 不得输出多个工具，不得声称已经执行，不得包含批准语义。

    ## 输出格式（严格 JSON）
    {
      "decision_type": "execute_step" | "goal_satisfied" | "await_author" | "no_progress",
      "summary": "作者可读的一句话，说明你为什么选择这一步或为什么停止",
      "target_tool_ref": "allowed_tools 或 internal_observation_steps 中的一个；非 execute_step 时为 null",
      "write_intent": "none" | "tentative",
      "risk_hint": "low" | "medium" | "high",
      "reason_codes": ["agentic_next_step"],
      "confidence": 0.0
    }
    """
  end

  defp internal_observation_steps("plot_outline_with_context_v1"), do: ["context_assemble"]
  defp internal_observation_steps("character_evolution_with_context_v1"), do: ["context_assemble"]
  defp internal_observation_steps("prose_drafting_with_quality_v1"), do: ["context_assemble"]

  defp internal_observation_steps("prose_revision_from_findings_v1"),
    do: ["revision_prepare", "revision_plan", "revision_finalize"]

  defp internal_observation_steps("conversation_turn_v1"),
    do: ["context_assemble", "dialogue_frame", "strategy_gate", "response_finalize"]

  defp internal_observation_steps(_profile_ref), do: []

  defp profile_rules("character_design_with_context_v1") do
    """
    - 如果还没有角色阵容观察，而目标需要先了解现有角色，下一步选择 character_roster，write_intent 为 none。
    - 如果已经有角色阵容观察，但还没有生成角色候选，下一步选择 character_design，write_intent 为 tentative。
    - 如果已经有待采纳角色候选，目标已满足，decision_type 使用 goal_satisfied。
    """
  end

  defp profile_rules("plot_outline_with_context_v1") do
    """
    - 如果还没有章节大纲上下文观察，下一步选择 context_assemble，write_intent 为 none。
    - 如果已经有章节大纲上下文观察，但还没有生成大纲候选，下一步选择 plot_outline，write_intent 为 tentative。
    - 如果已经有待采纳大纲候选，目标已满足，decision_type 使用 goal_satisfied。
    """
  end

  defp profile_rules("prose_drafting_with_quality_v1") do
    """
    - 如果还没有正文写作上下文观察，下一步选择 context_assemble，write_intent 为 none。
    - 如果已经有正文写作上下文观察，但还没有生成正文草稿候选和质量复核观察，下一步选择 prose_writing，write_intent 为 tentative。
    - 如果已经有待采纳正文草稿候选且已有质量复核观察，目标已满足，decision_type 使用 goal_satisfied。
    """
  end

  defp profile_rules("character_evolution_with_context_v1") do
    """
    - 如果还没有角色演化上下文观察，下一步选择 context_assemble，write_intent 为 none。
    - 如果已经有角色演化上下文观察，但还没有生成角色演化候选，下一步选择 character_evolution，write_intent 为 tentative。
    - 如果已经有待采纳角色演化候选，目标已满足，decision_type 使用 goal_satisfied。
    """
  end

  defp profile_rules("prose_revision_from_findings_v1") do
    """
    - 如果还没有修订源观察，下一步选择 revision_prepare，write_intent 为 none。
    - 如果已经有修订源观察，但还没有修订计划和系统裁决观察，下一步选择 revision_plan，write_intent 为 none。
    - 如果已经有修订计划和系统裁决观察，但还没有生成修订候选，下一步选择 prose_writing，write_intent 为 tentative。
    - 如果已经有修订候选观察，但还没有汇总给作者，下一步选择 revision_finalize，write_intent 为 none。
    - 如果已经有待采纳正文草稿观察，目标已满足，decision_type 使用 goal_satisfied。
    """
  end

  defp profile_rules("conversation_turn_v1") do
    """
    - 如果还没有创作上下文观察，下一步选择 context_assemble，write_intent 为 none。
    - 如果已经有创作上下文观察，但还没有对话认知帧观察，下一步选择 dialogue_frame，write_intent 为 none。
    - 如果已经有对话认知帧观察，但还没有执行策略或系统裁决观察，下一步选择 strategy_gate，write_intent 为 none。
    - 如果已经有执行策略或系统裁决观察，但还没有本轮回应观察，下一步选择 response_finalize，write_intent 为 none。
    - 如果已经有本轮回应观察，目标已满足，decision_type 使用 goal_satisfied。
    """
  end

  defp profile_rules(_profile_ref) do
    """
    - 如果已有观察足以执行 allowed_tools 中的单个工具，下一步选择该工具。
    - 如果已经生成待采纳候选或目标已满足，decision_type 使用 goal_satisfied。
    """
  end

  defp observation_lines([]), do: "- （暂无观察）"

  defp observation_lines(observations) do
    observations
    |> Enum.filter(&match?(%AgentObservation{}, &1))
    |> Enum.map_join("\n", fn observation ->
      "- #{observation.observation_id} / #{observation.observation_type}: #{observation.summary}"
    end)
  end

  defp build_decision(run, sequence, observations, parsed) when is_map(parsed) do
    AgentNextStepDecision.new(%{
      decision_id: "and_#{run.run_id}_#{sequence}",
      run_ref: run.run_id,
      sequence: sequence,
      decision_type: Map.get(parsed, "decision_type"),
      summary: Map.get(parsed, "summary"),
      target_tool_ref: Map.get(parsed, "target_tool_ref"),
      write_intent: Map.get(parsed, "write_intent"),
      risk_hint: Map.get(parsed, "risk_hint"),
      reason_codes: Map.get(parsed, "reason_codes", []),
      observation_refs: Enum.map(observations, & &1.observation_id),
      confidence: Map.get(parsed, "confidence", 1.0)
    })
  end

  defp validate_profile_tool(%AgentRun{} = run, %AgentNextStepDecision{
         decision_type: :execute_step,
         target_tool_ref: tool
       }) do
    if AgentTaskProfileRegistry.allowed_tool?(run.profile_ref, tool) or
         tool in internal_observation_steps(run.profile_ref) do
      :ok
    else
      {:error, {:tool_not_allowed_by_profile, tool}}
    end
  end

  defp validate_profile_tool(_run, %AgentNextStepDecision{}), do: :ok

  defp parse_json(content) when is_binary(content) do
    content
    |> strip_code_fence()
    |> find_brace_substring()
    |> Jason.decode()
    |> case do
      {:ok, parsed} when is_map(parsed) -> {:ok, parsed}
      {:ok, _other} -> {:error, :json_object_required}
      {:error, _} -> {:error, :json_parse_failed}
    end
  end

  defp parse_json(_), do: {:error, :json_parse_failed}

  defp strip_code_fence(content) do
    trimmed = String.trim(content)

    cond do
      String.starts_with?(trimmed, "```json") ->
        trimmed
        |> String.replace_prefix("```json", "")
        |> String.replace_suffix("```", "")
        |> String.trim()

      String.starts_with?(trimmed, "```") ->
        trimmed
        |> String.replace_prefix("```", "")
        |> String.replace_suffix("```", "")
        |> String.trim()

      true ->
        trimmed
    end
  end

  defp find_brace_substring(content) do
    case {first_open(content), last_close(content)} do
      {start_pos, end_pos}
      when not is_nil(start_pos) and not is_nil(end_pos) and start_pos < end_pos ->
        String.slice(content, start_pos..end_pos)

      _ ->
        content
    end
  end

  defp first_open(s) do
    case String.split(s, "{", parts: 2) do
      [before, _] -> byte_size(before)
      [_] -> nil
    end
  end

  defp last_close(s) do
    s
    |> String.reverse()
    |> String.split("}", parts: 2)
    |> case do
      [before, _] -> byte_size(s) - byte_size(before) - 1
      [_] -> nil
    end
  end
end
