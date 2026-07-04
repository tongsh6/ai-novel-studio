defmodule NovelApplication.AgenticNextStepPlanner do
  @moduledoc """
  Provider-backed next-step planner for AgentRun loops.

  The planner proposes only the next loop decision. It does not approve
  execution; callers must turn `:execute_step` into a single-action MicroPlan
  and re-enter ExecutionOrchestrator.
  """

  alias NovelAgent.AgentTaskProfileRegistry
  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentNarrativeSource
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
    result_fn =
      provider_execution
      |> Execution.with_purpose(:author_reasoning)
      |> ProviderActivityProjector.with_stage_sink(snapshot, purpose: :author_reasoning)
      |> Execution.result_fn()

    with result_fn when is_function(result_fn, 1) <- result_fn,
         {:ok, %{content: content} = provider_result} <-
           result_fn.(prompt(run, sequence, observations, snapshot)),
         {:ok, reasoning, parsed} <- parse_reasoning_tail(content),
         {:ok, decision} <-
           build_decision(run, sequence, observations, reasoning, parsed, provider_result),
         :ok <- validate_profile_tool(run, decision) do
      {:ok, decision}
    else
      nil -> {:error, :provider_execution_required}
      {:error, reason} -> {:error, reason}
      other -> {:error, {:invalid_next_step_decision, other}}
    end
  end

  defp prompt(%AgentRun{} = run, sequence, observations, snapshot) do
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
    - stage_state_keys: #{stage_state_keys(snapshot)}

    ## 已有观察
    #{observation_lines(observations)}

    ## 决策规则
    ## 可选下一步能力
    #{step_catalog(run.profile_ref)}

    ## 目标完成信号
    #{completion_signals(run.profile_ref)}
    #{authoring_intent_section(run.profile_ref, snapshot)}
    - 在决定下一步之前，先填写 evaluation_of_last：上一轮是否推进目标、当前计划前提是否仍成立、是否出现新约束。
    - evaluation_of_last.plan_holds=false 时，必须输出 plan_revision.revision_reason，并把 decision.type 设为 replan；replan 仍不批准执行，只能给出下一步建议，后续仍会 re-gate。
    - 根据作者目标、已有观察、stage_state_keys 和可选下一步能力选择最能推进目标的一步；不要按能力列表顺序机械推进。
    - execute_step 只能选择一个 target_tool_ref，且必须来自 allowed_tools 或 internal_observation_steps。
    - 选择 execute_step 时，优先选择前置观察已满足或能补足最关键缺口的能力；如果缺少必要前置信息，先选择能产生该观察的 internal_observation_step。
    - 如果已有观察已经满足作者目标，或已产生待采纳候选/最终回应，decision.type 使用 done。
    - 如果缺少作者输入或不能在当前 allowed_tools 内推进，decision.type 使用 await_author。
    - 如果下一步只会重复已有观察且没有新增信息，decision.type 使用 no_progress。
    - 不得输出多个工具，不得声称已经执行，不得包含批准语义。

    ## 输出格式（严格两段）
    第一段：作者可见 reasoning 原文。用自然中文说明你如何评估上一轮、为什么继续/重规划/停止。不要写 JSON，不要写机器 ref。
    第二段：机器 JSON tail。只给系统消费，不作为作者叙事来源。

    JSON tail 格式：
    {
      "evaluation_of_last": {
        "advanced": true | false,
        "plan_holds": true | false,
        "new_constraint": "新增约束；没有则为 null"
      },
      "decision": {
        "type": "continue" | "replan" | "done" | "await_author" | "no_progress"
      },
      "next_action": {
        "target_tool_ref": "allowed_tools 或 internal_observation_steps 中的一个；非 continue/replan 时为 null",
        "write_intent": "none" | "tentative",
        "risk_hint": "low" | "medium" | "high",
        "authoring_intent": "none" | "continuation" | "rewrite"（仅正文写作步按上方意图规则必填，其余为 null）,
        "target_chapter": "作品章节列表中精确复制的标题；非正文步或不针对具体章时为 null",
        "requested_chapter_raw": "作者原话点名的章节标识原样填写；没点名时为 null"
      },
      "plan_revision": {
        "plan_version": 2,
        "revision_reason": "仅当 evaluation_of_last.plan_holds=false 时必填，否则为 null"
      },
      "reason_codes": ["agentic_next_step"],
      "confidence": 0.0
    }

    注意字段顺序：必须先 evaluation_of_last，再 decision / next_action / plan_revision，最后 reason_codes 与 confidence。
    作者可见文字只能出现在第一段 reasoning 原文中；JSON tail 不能包含 summary、narrative、explanation、description 等叙事字段。
    """
  end

  # 正文写作意图规则沿用 Planner 直连路径的同一套冻结语义（VS-00C WritingCoordinate）：
  # 意图由 AI 判定，目标章由应用层按现有章节列表确定性解析；这里只让 step planner
  # 在同一次调用里产出这三个字段，不新增 provider 调用。
  defp authoring_intent_section("prose_drafting_with_quality_v1", snapshot) do
    """

    ## 正文写作意图与目标章（选择 prose_writing 时 next_action 必须按此填写）
    - 作者想“写 / 生成”列表里某个具体章节的正文（含还没写正文的计划章，首次成稿）→ authoring_intent = "none"，target_chapter 精确复制该章标题
    - 作者想在某个已有章节“接着往下写 / 继续 / 补一段 / 加场景” → authoring_intent = "continuation"，target_chapter 精确复制该章标题
    - 作者想“推翻重写 / 改写 / 重新写”某个已有章节 → authoring_intent = "rewrite"，target_chapter 精确复制该章标题，risk_hint 用 "high"
    - 写全新章节（不在列表里）→ authoring_intent = "none"，target_chapter = null
    - 无法确定指向列表里哪一章时，target_chapter = null，不要猜一个不在列表里的标题
    - requested_chapter_raw：只要作者原话点名了具体章节（如“第99章”），把原话里的章节标识原样填写（即使不在列表里也不要置 null）；只有“接着往下写/继续”这种没点名具体章时才为 null
    #{accepted_chapters_lines(snapshot)}
    """
  end

  defp authoring_intent_section(_profile_ref, _snapshot), do: ""

  defp accepted_chapters_lines(snapshot) do
    snapshot
    |> stage_context_chapters()
    |> case do
      [] ->
        "- （当前尚未读取作品章节列表；先执行 context_assemble 再选择 prose_writing）"

      chapters ->
        listed = Enum.map_join(chapters, "\n", &"- #{&1}")
        "\n### 作品章节（target_chapter 必须从此列表精确复制；含已规划但还没写正文的章）\n#{listed}"
    end
  end

  defp stage_context_chapters(snapshot) when is_map(snapshot) do
    snapshot
    |> Map.get(:stage_state, %{})
    |> case do
      %{context: %NovelDomain.DialogueContext{current_chapters: chapters}}
      when is_list(chapters) ->
        Enum.filter(chapters, &is_binary/1)

      _ ->
        []
    end
  end

  defp stage_context_chapters(_snapshot), do: []

  defp internal_observation_steps("plot_outline_with_context_v1"), do: ["context_assemble"]
  defp internal_observation_steps("character_evolution_with_context_v1"), do: ["context_assemble"]
  defp internal_observation_steps("world_building_with_context_v1"), do: ["context_assemble"]
  defp internal_observation_steps("prose_drafting_with_quality_v1"), do: ["context_assemble"]

  defp internal_observation_steps("prose_revision_from_findings_v1"),
    do: ["revision_prepare", "revision_plan", "revision_finalize"]

  defp internal_observation_steps("conversation_turn_v1"),
    do: ["context_assemble", "dialogue_frame", "strategy_gate", "response_finalize"]

  defp internal_observation_steps(_profile_ref), do: []

  defp step_catalog(profile_ref) do
    profile_ref
    |> step_options()
    |> Enum.map_join("\n", fn option ->
      "- #{option.ref} | intent=#{option.intent} | write_intent=#{option.write_intent} | requires=#{option.requires} | produces=#{option.produces}"
    end)
  end

  defp step_options("character_design_with_context_v1") do
    [
      option("character_roster", "读取现有角色阵容", :none, "作者目标需要现有角色关系", "角色阵容观察"),
      option(
        "character_design",
        "生成新角色候选",
        :tentative,
        "足够的角色阵容或作者已给出自足角色约束",
        "待采纳 character_seed"
      )
    ]
  end

  defp step_options("plot_outline_with_context_v1") do
    [
      option("context_assemble", "读取章节/作品上下文", :none, "需要作品上下文", "大纲上下文观察"),
      option("plot_outline", "生成章节大纲候选", :tentative, "足够的大纲上下文", "待采纳 outline_draft")
    ]
  end

  defp step_options("prose_drafting_with_quality_v1") do
    [
      option("context_assemble", "读取正文写作上下文", :none, "需要章节和连续性上下文", "正文上下文观察"),
      option(
        "prose_writing",
        "生成正文草稿并触发质量复核",
        :tentative,
        "足够的正文写作上下文",
        "待采纳 prose_fragment 与质量复核观察"
      )
    ]
  end

  defp step_options("character_evolution_with_context_v1") do
    [
      option("context_assemble", "读取角色演化上下文", :none, "需要角色当前状态", "角色演化上下文观察"),
      option(
        "character_evolution",
        "生成角色演化候选",
        :tentative,
        "足够的角色演化上下文",
        "待采纳 character_evolution_seed"
      )
    ]
  end

  defp step_options("world_building_with_context_v1") do
    [
      option("context_assemble", "读取作品设定上下文", :none, "需要现有设定与作品状态", "世界设定上下文观察"),
      option(
        "world_building",
        "生成世界设定、伏笔或规则候选",
        :tentative,
        "足够的设定上下文或作者已给出自足约束",
        "待采纳 world_setting / foreshadowing_seed / rule seed"
      )
    ]
  end

  defp step_options("prose_revision_from_findings_v1") do
    [
      option("revision_prepare", "读取待修订草稿和质量发现", :none, "需要修订源", "修订源观察"),
      option("revision_plan", "制定修订计划并重新经过系统裁决", :none, "修订源观察", "修订计划和裁决观察"),
      option("prose_writing", "生成修订候选", :tentative, "修订计划和允许执行裁决", "待采纳 revision prose_fragment"),
      option("revision_finalize", "汇总修订候选给作者", :none, "修订候选观察", "最终 turn_result")
    ]
  end

  defp step_options("conversation_turn_v1") do
    [
      option("context_assemble", "读取当前作品上下文", :none, "需要理解作品状态", "创作上下文观察"),
      option("dialogue_frame", "形成对话认知帧", :none, "创作上下文观察", "对话认知帧观察"),
      option("strategy_gate", "制定执行策略并完成系统裁决", :none, "对话认知帧观察", "策略/裁决观察"),
      option("response_finalize", "生成本轮回应并写入可回放留痕", :none, "回复路线或系统裁决观察", "最终 turn_result")
    ]
  end

  defp step_options(_profile_ref) do
    [
      option("allowed_tool", "执行一个 allowed_tools 中的能力", :tentative, "已有观察足以执行单个能力", "待采纳候选或最终回应")
    ]
  end

  defp option(ref, intent, write_intent, requires, produces) do
    %{
      ref: ref,
      intent: intent,
      write_intent: write_intent,
      requires: requires,
      produces: produces
    }
  end

  defp completion_signals("conversation_turn_v1"),
    do: "- 已有“本轮回应”或 turn_result 观察。"

  defp completion_signals("prose_revision_from_findings_v1"),
    do: "- 已有修订候选并已汇总给作者，或已有待采纳 revision prose_fragment。"

  # 强制性措辞：真实模型曾在 artifact_created 后再次选择 prose_writing，产生作者
  # 未请求的第二份候选并把 run 拖到预算耗尽（狗粮 2026-07-04 实锤）。
  defp completion_signals("prose_drafting_with_quality_v1"),
    do:
      "- 已有 artifact_created 观察（待采纳正文候选已生成）→ 本轮目标已满足，decision 必须用 done；不得再次选择 prose_writing 生成第二份候选。"

  defp completion_signals(_profile_ref),
    do: "- 已有待采纳候选或 artifact_created 观察 → 本轮目标已满足，decision 用 done，不要再执行会产生新候选的能力。"

  defp observation_lines([]), do: "- （暂无观察）"

  defp observation_lines(observations) do
    observations
    |> Enum.filter(&match?(%AgentObservation{}, &1))
    |> Enum.map_join("\n", fn observation ->
      "- #{observation.observation_id} / #{observation.observation_type}: #{observation.summary}"
    end)
  end

  defp stage_state_keys(snapshot) when is_map(snapshot) do
    snapshot
    |> Map.get(:stage_state, %{})
    |> case do
      stage_state when is_map(stage_state) ->
        stage_state
        |> Map.keys()
        |> Enum.map(&to_string/1)
        |> Enum.sort()
        |> Enum.join(", ")
        |> case do
          "" -> "none"
          keys -> keys
        end

      _ ->
        "none"
    end
  end

  defp stage_state_keys(_snapshot), do: "none"

  defp build_decision(run, sequence, observations, reasoning, parsed, provider_result)
       when is_binary(reasoning) and is_map(parsed) do
    with {:ok, evaluation} <- evaluation_of_last(parsed),
         {:ok, decision_kind} <- decision_kind(parsed),
         :ok <- validate_evaluation_decision(evaluation, decision_kind),
         {:ok, decision_type} <- decision_type(decision_kind),
         {:ok, action} <- next_action(parsed, decision_type),
         {:ok, plan_revision} <- plan_revision(parsed, evaluation, run),
         :ok <- tail_has_no_narrative(parsed),
         {:ok, narrative_source} <- narrative_source(provider_result, reasoning) do
      AgentNextStepDecision.new(%{
        decision_id: "and_#{run.run_id}_#{sequence}",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: decision_type,
        summary: reasoning,
        target_tool_ref: Map.get(action, "target_tool_ref"),
        write_intent: Map.get(action, "write_intent"),
        risk_hint: Map.get(action, "risk_hint"),
        authoring_intent: Map.get(action, "authoring_intent"),
        target_chapter: Map.get(action, "target_chapter"),
        requested_chapter_raw: Map.get(action, "requested_chapter_raw"),
        reason_codes: Map.get(parsed, "reason_codes", []),
        observation_refs: Enum.map(observations, & &1.observation_id),
        evaluation_of_last: evaluation,
        plan_revision: plan_revision,
        narrative_source: narrative_source,
        confidence: Map.get(parsed, "confidence", 1.0)
      })
    else
      {:error, {:invalid_author_narrative_source, _reason}} = error ->
        error

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp narrative_source(provider_result, summary) do
    case AgentNarrativeSource.from_provider_result(provider_result, summary) do
      {:ok, source} -> {:ok, source}
      {:error, reason} -> {:error, {:invalid_author_narrative_source, reason}}
    end
  end

  defp tail_has_no_narrative(parsed) do
    forbidden = ~w(summary narrative explanation description author_narrative reasoning)

    if Enum.any?(forbidden, &Map.has_key?(parsed, &1)) do
      {:error, :json_tail_must_not_contain_author_narrative}
    else
      :ok
    end
  end

  defp evaluation_of_last(parsed) do
    case Map.get(parsed, "evaluation_of_last") do
      %{} = evaluation ->
        if Map.has_key?(evaluation, "plan_holds") and Map.has_key?(evaluation, "advanced") do
          {:ok, evaluation}
        else
          {:error, :evaluation_of_last_requires_advanced_and_plan_holds}
        end

      _ ->
        {:error, :evaluation_of_last_required}
    end
  end

  defp decision_kind(parsed) do
    kind =
      parsed
      |> Map.get("decision", %{})
      |> case do
        %{} = decision -> Map.get(decision, "type")
        _ -> nil
      end

    case kind do
      value when value in ["continue", "replan", "done", "await_author", "no_progress"] ->
        {:ok, value}

      _ ->
        {:error, :decision_type_required}
    end
  end

  defp validate_evaluation_decision(%{"plan_holds" => false}, "replan"), do: :ok

  defp validate_evaluation_decision(%{"plan_holds" => false}, _kind),
    do: {:error, :plan_holds_false_requires_replan_decision}

  defp validate_evaluation_decision(_evaluation, "replan"),
    do: {:error, :replan_requires_plan_holds_false}

  defp validate_evaluation_decision(_evaluation, _kind), do: :ok

  defp decision_type(kind) do
    case kind do
      "continue" -> {:ok, :execute_step}
      "replan" -> {:ok, :execute_step}
      "done" -> {:ok, :goal_satisfied}
      "await_author" -> {:ok, :await_author}
      "no_progress" -> {:ok, :no_progress}
    end
  end

  defp next_action(parsed, :execute_step) do
    case Map.get(parsed, "next_action") do
      %{} = action -> {:ok, action}
      _ -> {:error, :next_action_required}
    end
  end

  defp next_action(_parsed, _decision_type),
    do: {:ok, %{"target_tool_ref" => nil, "write_intent" => "none", "risk_hint" => "low"}}

  defp plan_revision(parsed, %{"plan_holds" => false}, run) do
    revision = Map.get(parsed, "plan_revision")

    reason =
      case revision do
        %{} -> Map.get(revision, "revision_reason")
        _ -> nil
      end

    if is_binary(reason) and String.trim(reason) != "" do
      {:ok,
       %{
         "plan_version" => next_plan_version(run, revision),
         "revision_reason" => reason
       }}
    else
      {:error, :plan_revision_reason_required}
    end
  end

  defp plan_revision(_parsed, _evaluation, _run), do: {:ok, nil}

  defp next_plan_version(run, revision) do
    case revision do
      %{"plan_version" => value} when is_integer(value) and value > 0 ->
        value

      _ ->
        (run.plan_version || 1) + 1
    end
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

  defp parse_reasoning_tail(content) when is_binary(content) do
    case json_bounds(content) do
      {start_pos, end_pos} when start_pos < end_pos ->
        reasoning =
          content
          |> binary_part(0, start_pos)
          |> clean_reasoning()

        json = binary_part(content, start_pos, end_pos - start_pos + 1)

        with :ok <- require_reasoning(reasoning),
             {:ok, parsed} <- decode_tail_json(json) do
          {:ok, reasoning, parsed}
        end

      _ ->
        {:error, :json_tail_required}
    end
  end

  defp parse_reasoning_tail(_content), do: {:error, :json_tail_required}

  defp decode_tail_json(json) do
    json
    |> Jason.decode()
    |> case do
      {:ok, parsed} when is_map(parsed) -> {:ok, parsed}
      {:ok, _other} -> {:error, :json_object_required}
      {:error, _} -> {:error, :json_parse_failed}
    end
  end

  defp require_reasoning(""), do: {:error, :reasoning_text_required}
  defp require_reasoning(_reasoning), do: :ok

  defp clean_reasoning(reasoning) do
    reasoning
    |> String.trim()
    |> String.replace(~r/```json\s*$/u, "")
    |> String.replace(~r/```\s*$/u, "")
    |> String.trim()
  end

  defp json_bounds(content) do
    case {first_open(content), last_close(content)} do
      {start_pos, end_pos}
      when not is_nil(start_pos) and not is_nil(end_pos) and start_pos < end_pos ->
        {start_pos, end_pos}

      _ ->
        nil
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
