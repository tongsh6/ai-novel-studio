defmodule NovelAgent.Test.Provider.SliceVerify do
  @moduledoc """
  Deterministic provider for local slice verification.

  It returns planner-compatible JSON so Tauri slice journeys can verify the
  product chain without depending on an external LLM or the echo-only stub.
  """

  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.Usage

  @slow_work_switch_delay_ms 2_500
  @slow_work_switch_marker "SU02SLOW"
  # AU-12 档案并发读取：让一次普通对话 turn 故意慢，使外部 driver 能在执行期间打开作品档案。
  # 仅 test-support 慢延迟（不改生产 provider runtime），产出普通回复、不触发 slow_work_switch 语义。
  @archive_slow_delay_ms 6_000
  @archive_slow_marker "AU12SLOW"
  @agent_cancel_slow_delay_ms 3_000
  @agent_cancel_slow_marker "UA01CP6SLOW"
  @author_reasoning_chunk_delay_ms 25
  @garbage_json_marker "AU01GARBAGE"
  @invalid_frame_marker "AU01BADFRAME"
  @malformed_candidates_marker "AU02BADCANDIDATES"
  @candidate_context_marker "AU02CTX"
  @tool_failure_marker "AU04FAILTOOL"
  @provider_failure_marker "UA01PROVIDERFAIL"

  defstruct []

  @impl true
  def complete(_state, _model, prompt, _params) do
    prompt_text = prompt_text(prompt)
    maybe_delay_su02_slow_work_switch(prompt_text)
    maybe_delay_archive_slow(prompt_text)
    maybe_delay_agent_cancel(prompt_text)

    case maybe_fail_provider_execution_prompt(prompt_text) do
      :ok ->
        maybe_fail_tool_failure_prompt(prompt_text)

      {:error, reason} ->
        {:error, reason}
    end
    |> case do
      :ok ->
        content = response_content(prompt, prompt_text)
        {:ok, Result.new(content, usage_for(prompt_text, content))}

      {:error, reason} ->
        {:error, reason}
    end
  end

  @impl true
  def execute(state, model, prompt, params, ctx) do
    initial_events = AdapterExecution.initial_events(ctx)
    AdapterExecution.emit_events(ctx, initial_events, :running)

    case complete(state, model, prompt, params) do
      {:ok, %Result{content: content} = result} ->
        chunk_events =
          AdapterExecution.text_chunk_events(ctx, content, length(initial_events) + 1)

        emit_chunk_events(ctx, chunk_events)

        {:ok, result}
        |> AdapterExecution.materialize_result(
          ctx,
          initial_events: initial_events ++ chunk_events,
          emit: :terminal
        )

      {:error, reason} ->
        {:error, reason}
        |> AdapterExecution.materialize_result(ctx,
          initial_events: initial_events,
          emit: :terminal
        )
    end
  end

  @impl true
  def health_check(_state), do: :ok

  @impl true
  def name, do: "slice_verify"

  defp emit_chunk_events(ctx, events) do
    Enum.each(events, fn event ->
      AdapterExecution.emit_events(ctx, [event], :running)
      maybe_delay_author_reasoning_chunk(ctx, event)
    end)
  end

  defp maybe_delay_author_reasoning_chunk(ctx, event) do
    if Map.get(ctx, :purpose) in [:author_reasoning, "author_reasoning"] and
         is_binary(event.payload[:author_narrative_delta]) do
      Process.sleep(@author_reasoning_chunk_delay_ms)
    end
  end

  defp plan_prompt?(prompt) do
    String.contains?(prompt, "plan_goal_summary") or String.contains?(prompt, "proposed_actions")
  end

  defp agent_next_step_decision_prompt?(prompt) do
    String.contains?(prompt, "AgentRun 下一步规划器")
  end

  defp profile_routing_prompt?(prompt) do
    String.contains?(prompt, "AgentRun profile router") and
      String.contains?(prompt, "\"profile_ref\"")
  end

  defp creative_items_prompt?(prompt) do
    String.contains?(prompt, "JSON 数组") and String.contains?(prompt, "artifact_type：")
  end

  defp tool_narration_prompt?(prompt) do
    String.contains?(prompt, "## 工具执行结果") and
      String.contains?(prompt, "请用 1-2 句自然中文")
  end

  defp maybe_fail_tool_failure_prompt(prompt_text) do
    if tool_failure_prompt?(prompt_text) and creative_items_prompt?(prompt_text) do
      {:error,
       %{
         type: :provider_error,
         message: "AU04FAILTOOL fixture provider failure"
       }}
    else
      :ok
    end
  end

  defp maybe_fail_provider_execution_prompt(prompt_text) do
    if String.contains?(prompt_text, @provider_failure_marker) and
         not agent_next_step_decision_prompt?(prompt_text) do
      {:error,
       %{
         type: :provider_error,
         message: "UA01PROVIDERFAIL raw provider failure payload"
       }}
    else
      :ok
    end
  end

  defp usage_for(prompt_text, content) do
    input_tokens = prompt_text |> String.length() |> div(8) |> max(1)
    output_tokens = content |> String.length() |> div(6) |> max(1)

    Usage.new(input_tokens, output_tokens, "slice-verify-model", 0)
  end

  @quality_eval_fail_marker "VS00EEVALFAIL"
  # 中文降级标记：放进章节摘要时不会被 opening_body 的随机标识符回显（random_identifier_tokens
  # 只取字母数字混合 token），因此能进入 evaluator prompt 触发降级，却不污染用户可见正文。
  @quality_eval_fail_marker_cn "评审故障演练"

  defp quality_evaluator_prompt?(prompt) do
    String.contains?(prompt, "质量评审") and String.contains?(prompt, "findings")
  end

  # 默认空 findings（评审完成、无语义问题）；prompt 含 fail-marker（英文或中文）时返回非法 JSON →
  # evaluator 两次解析失败 → review_status unavailable（复现诚实降级）。
  defp quality_evaluator_response(prompt) do
    if String.contains?(prompt, @quality_eval_fail_marker) or
         String.contains?(prompt, @quality_eval_fail_marker_cn) do
      "evaluator 故意返回的非 JSON 文本 #{@quality_eval_fail_marker}"
    else
      Jason.encode!(%{"findings" => []})
    end
  end

  defp response_content(prompt, prompt_text) do
    cond do
      # VS-00E：独立质量 evaluator 的 prompt（含「质量评审」+「findings」，无正文三锚点）。
      # 默认返回空 findings（确定性 validator 仍可命中）；带 fail-marker 时返回非法 JSON 以
      # 复现 evaluator 降级。仅 test-support，不进生产 runtime。
      quality_evaluator_prompt?(prompt_text) ->
        quality_evaluator_response(prompt_text)

      garbage_json_prompt?(prompt) ->
        "not valid json {{{ AU01GARBAGE raw provider payload"

      invalid_frame_prompt?(prompt) ->
        invalid_frame_response() |> Jason.encode!()

      malformed_candidates_prompt?(prompt) ->
        malformed_candidates_response() |> Jason.encode!()

      true ->
        structured_response_content(prompt, prompt_text)
    end
  end

  defp structured_response_content(prompt, prompt_text) do
    cond do
      creative_items_prompt?(prompt_text) ->
        creative_items_response(prompt_text) |> Jason.encode!()

      profile_routing_prompt?(prompt_text) ->
        profile_routing_response(prompt_text) |> Jason.encode!()

      agent_next_step_decision_prompt?(prompt_text) ->
        agent_next_step_decision_response(prompt_text)

      plan_prompt?(prompt_text) ->
        plan_response(prompt_text) |> Jason.encode!()

      tool_narration_prompt?(prompt_text) ->
        tool_narration_response(prompt_text)

      true ->
        frame_response(prompt) |> Jason.encode!()
    end
  end

  defp frame_response(prompt) do
    flags = frame_flags(prompt)

    %{
      frame_type: frame_type(flags),
      dialogue_goal_summary: dialogue_goal_summary(flags),
      needs_tool:
        flags.readonly_character_query or flags.character_design_request or
          flags.character_evolution_request,
      no_tool_reason: no_tool_reason(flags),
      execution_readiness: execution_readiness(flags),
      assistant_message:
        frame_message(flags.slow_work_switch, flags.quality_diagnosis, flags.exploratory, prompt),
      candidate_directions:
        candidate_directions(
          flags.exploratory and not flags.candidate_context_followup and
            not flags.readonly_character_query,
          prompt
        ),
      context_used: context_provided?(prompt),
      uncertainty: []
    }
  end

  defp frame_flags(prompt) do
    %{
      quality_diagnosis: quality_diagnosis_prompt?(prompt),
      exploratory: exploratory_prompt?(prompt),
      slow_work_switch: slow_work_switch_prompt?(prompt),
      candidate_context_followup: candidate_context_followup_prompt?(prompt),
      readonly_character_query: readonly_character_query_prompt?(prompt),
      character_design_request: character_design_request_prompt?(prompt),
      character_evolution_request: character_evolution_request_prompt?(prompt)
    }
  end

  defp frame_type(%{readonly_character_query: true}), do: "execution_candidate"
  defp frame_type(%{character_design_request: true}), do: "execution_candidate"
  defp frame_type(%{character_evolution_request: true}), do: "execution_candidate"
  defp frame_type(%{slow_work_switch: true}), do: "casual_reply"
  defp frame_type(%{candidate_context_followup: true}), do: "casual_reply"
  defp frame_type(%{quality_diagnosis: true}), do: "question_answer"
  defp frame_type(%{exploratory: true}), do: "creative_exploration"
  defp frame_type(_flags), do: "casual_reply"

  defp dialogue_goal_summary(%{readonly_character_query: true}), do: "查看当前作品角色列表"
  defp dialogue_goal_summary(%{character_design_request: true}), do: "按作者意图设计新角色"
  defp dialogue_goal_summary(%{character_evolution_request: true}), do: "记录已有角色的演化事件"
  defp dialogue_goal_summary(%{slow_work_switch: true}), do: "验证慢回复跨作品归属"
  defp dialogue_goal_summary(%{candidate_context_followup: true}), do: "围绕已选候选方向继续探索"
  defp dialogue_goal_summary(%{quality_diagnosis: true}), do: "诊断章节爽感不足和胜利过轻"
  defp dialogue_goal_summary(_flags), do: "验证工作台对话主链"

  defp no_tool_reason(%{readonly_character_query: true}), do: "tool_needed"
  defp no_tool_reason(%{character_design_request: true}), do: "tool_needed"
  defp no_tool_reason(%{character_evolution_request: true}), do: "tool_needed"
  defp no_tool_reason(%{exploratory: true}), do: "exploratory_only"
  defp no_tool_reason(_flags), do: "no_tool_needed"

  defp execution_readiness(%{readonly_character_query: true}), do: "ready"
  defp execution_readiness(%{character_design_request: true}), do: "ready"
  defp execution_readiness(%{character_evolution_request: true}), do: "ready"
  defp execution_readiness(_flags), do: "not_applicable"

  defp maybe_delay_su02_slow_work_switch(prompt_text) do
    if String.contains?(prompt_text, @slow_work_switch_marker) do
      Process.sleep(@slow_work_switch_delay_ms)
    end
  end

  defp maybe_delay_archive_slow(prompt_text) do
    if String.contains?(prompt_text, @archive_slow_marker) do
      Process.sleep(@archive_slow_delay_ms)
    end
  end

  defp maybe_delay_agent_cancel(prompt_text) do
    if String.contains?(prompt_text, @agent_cancel_slow_marker) do
      Process.sleep(@agent_cancel_slow_delay_ms)
    end
  end

  defp slow_work_switch_prompt?(prompt) do
    prompt |> author_input_text() |> String.contains?(@slow_work_switch_marker)
  end

  defp garbage_json_prompt?(prompt) do
    prompt |> author_input_text() |> String.contains?(@garbage_json_marker)
  end

  defp invalid_frame_prompt?(prompt) do
    prompt |> author_input_text() |> String.contains?(@invalid_frame_marker)
  end

  defp malformed_candidates_prompt?(prompt) do
    prompt |> author_input_text() |> String.contains?(@malformed_candidates_marker)
  end

  defp tool_failure_prompt?(prompt), do: String.contains?(prompt, @tool_failure_marker)

  defp invalid_frame_response do
    %{
      frame_type: "casual_reply",
      dialogue_goal_summary: "验证 frame validation 禁止语义边界",
      needs_tool: false,
      no_tool_reason: "no_tool_needed",
      execution_readiness: "not_applicable",
      assistant_message:
        "slice_verify raw provider payload: approved and ready_to_execute should be blocked.",
      candidate_directions: [],
      context_used: false,
      uncertainty: []
    }
  end

  defp malformed_candidates_response do
    %{
      frame_type: "creative_exploration",
      dialogue_goal_summary: "验证候选方向坏格式 fallback",
      needs_tool: false,
      no_tool_reason: "exploratory_only",
      execution_readiness: "not_applicable",
      assistant_message: "上游候选结构不可用时，也应该继续给作者可选方向。",
      candidate_directions: %{title: "", pitch: ""},
      context_used: false,
      uncertainty: []
    }
  end

  defp quality_diagnosis_prompt?(prompt) do
    text = author_input_text(prompt)
    contains_any?(text, ["不够爽", "赢得太轻", "爽点", "张力不够", "质量诊断", "不成立"])
  end

  defp readonly_character_query_prompt?(prompt) do
    text = author_input_text(prompt)

    roster_query =
      contains_any?(text, ["查看", "列出", "查询", "看看", "展示"]) and
        contains_any?(text, ["当前角色列表", "角色列表", "已有角色", "人物表", "角色清单"])

    roster_query or protagonist_query?(text)
  end

  # "主角是谁/谁是主角/主角叫啥/有没有主角" 是只读查询；"设计/设定主角" 是创建，不在此命中。
  defp protagonist_query?(text) do
    String.contains?(text, "主角") and
      contains_any?(text, ["是谁", "谁是", "叫啥", "叫什么", "有没有", "有无", "是不是", "有谁"]) and
      not contains_any?(text, ["设计", "设定", "创建", "新增", "塑造", "加个", "加一个"])
  end

  # "设计/设定/创建一个主角/反派/配角/角色" 是创建意图，需要 character_design 工具。
  defp character_design_request_prompt?(prompt) do
    text = author_input_text(prompt)

    contains_any?(text, ["设计", "设定", "创建", "新增", "塑造", "加个", "加一个", "写一个"]) and
      contains_any?(text, ["主角", "反派", "配角", "角色", "人物"]) and
      not protagonist_query?(text) and
      not character_evolution_request?(text)
  end

  # "更新/演化/推进已有角色的成长/当前状态/关系变化" 是演化意图，需要 character_evolution 工具。
  defp character_evolution_request_prompt?(prompt) do
    prompt |> author_input_text() |> character_evolution_request?()
  end

  defp character_evolution_request?(text) do
    contains_any?(text, [
      "更新",
      "演化",
      "推进",
      "黑化",
      "觉醒",
      "蜕变",
      "成长转变",
      "当前状态",
      "现状",
      "结盟",
      "反目",
      "决裂",
      "关系变化"
    ]) and contains_any?(text, ["角色", "人物", "主角", "林烬", "他", "她"])
  end

  defp candidate_context_followup_prompt?(prompt) do
    author_text = author_input_text(prompt)

    contains_any?(author_text, ["开场冲突", "继续沿着这个方向", "沿着这个方向"]) and
      candidate_context_nonce(prompt) != nil
  end

  defp exploratory_prompt?(prompt) do
    text = author_input_text(prompt)
    Enum.any?(["生成", "角色", "方向", "怎么切入", "小说创作"], &String.contains?(text, &1))
  end

  defp frame_message(true, _quality_diagnosis, _exploratory, prompt) do
    nonce =
      prompt
      |> author_input_text()
      |> random_identifier_tokens()
      |> Enum.find(&String.starts_with?(&1, @slow_work_switch_marker))

    "慢回复归属校验完成：#{nonce || @slow_work_switch_marker} 只属于原作品。"
  end

  defp frame_message(false, true, _exploratory, prompt) do
    if quality_context_missing_prompt?(prompt) do
      "我还缺少当前章节摘要或正文，只能先按通用质量原则判断：需要补充目标章材料，再对冲突压力、代价和读者回报做具体诊断；这轮不会改写正文或写入作品事实。"
    else
      "这一章的问题不是主角赢，而是阻力、代价和读者回报没有层层加压。可以让林烬赢下局部却失去关键线索，或让胜利暴露更大的矿区代价；这轮只给诊断和结构修订建议，不会改写正文或写入作品事实。"
    end
  end

  defp frame_message(false, false, true, prompt) do
    case candidate_context_nonce(prompt) do
      nil ->
        "可以先从人物动机、核心冲突和世界规则三个方向拆开看。"

      nonce ->
        "可以先从人物动机 #{nonce}、核心冲突和世界规则三个方向拆开看。"
    end
  end

  defp frame_message(false, false, false, prompt) do
    if candidate_context_followup_prompt?(prompt) do
      nonce = candidate_context_nonce(prompt)
      "沿着人物动机 #{nonce} 这个方向，开场冲突可以从主角想要突破规则、却必须先承受代价开始。"
    else
      "可以，我们先围绕小说创作方向聊下去。"
    end
  end

  defp quality_context_missing_prompt?(prompt) do
    prompt
    |> prompt_text()
    |> String.contains?("缺章节摘要")
  end

  defp context_provided?(prompt) do
    text = prompt_text(prompt)

    String.contains?(text, "当前作品上下文") and
      not String.contains?(text, "（无——这是新对话或尚未创建作品）")
  end

  defp candidate_directions(true, prompt) do
    author_text = author_input_text(prompt)
    high_risk? = contains_any?(author_text, ["高风险", "覆盖主线", "重写设定", "推翻设定"])

    context_nonce =
      author_text
      |> random_identifier_tokens()
      |> Enum.find(&String.starts_with?(&1, @candidate_context_marker))

    first =
      if high_risk? do
        %{
          title: "高风险主线覆盖",
          pitch: "直接覆盖既有主线设定，需要作者再次确认后才能采用。",
          tone_tags: ["主线", "高风险"],
          risk_hint: "high"
        }
      else
        %{
          title: if(context_nonce, do: "人物动机 #{context_nonce}", else: "人物动机"),
          pitch: "从主角最想得到但最难承受的东西切入。",
          tone_tags: ["人物", "冲突"],
          risk_hint: "low"
        }
      end

    [
      first,
      %{
        title: "世界规则",
        pitch: "先确定一个会持续制造选择压力的规则。",
        tone_tags: ["设定", "推进"],
        risk_hint: "low"
      }
    ]
  end

  defp candidate_directions(false, _prompt), do: []

  defp candidate_context_nonce(prompt) do
    prompt
    |> prompt_text()
    |> random_identifier_tokens()
    |> Enum.find(&String.starts_with?(&1, @candidate_context_marker))
  end

  defp tool_narration_response(prompt) do
    cond do
      String.contains?(prompt, "character_design") ->
        "已生成角色设定草案，你可以查看内容后选择采纳、放弃或修改。"

      String.contains?(prompt, "world_building") ->
        "已生成世界设定草案，你可以查看内容后决定是否保存到作品档案。"

      String.contains?(prompt, "prose_writing") ->
        "已生成正文草稿，请先审阅，采纳后才会进入阅读模式。"

      String.contains?(prompt, "plot_outline") ->
        "已生成大纲草案，你可以审阅后决定是否纳入作品结构。"

      true ->
        "已生成创作草稿，你可以继续查看、采纳或修改。"
    end
  end

  # 章节计划主题（确定性、稳定、可支撑长篇），用于 outline_draft 多章生成。
  @outline_chapter_themes ~w(觉醒 试炼 盟约 裂隙 暗流 突围 真相 背叛 抉择 决战 余烬 新生)

  defp creative_items_response(prompt) do
    {brief, context} = creative_prompt_parts(prompt)

    cond do
      # 章节计划（plot_outline -> outline_draft）确定性产出多章，让 plan-minimum 等 slice
      # 在离线 provider 下也能演练「生成结构化章节计划」。
      outline_plan_prompt?(prompt) ->
        outline_chapter_items(brief, context)

      # AU-09：作者明确要多个角色候选（“两个/几个/候选/不同方向”）时确定性产出 2 条独立候选，
      # 让逐候选采纳 slice 在离线 provider 下也能演练；普通“设计一个角色”仍单条。
      multi_character_candidate_prompt?(prompt, brief) ->
        character_candidate_items(brief, context)

      # AU-09：角色演化记忆草稿（采纳后写角色记忆，非主档案）。
      character_evolution_seed_prompt?(prompt) ->
        [character_evolution_item(brief, context)]

      true ->
        text = [brief, context] |> Enum.reject(&(&1 == "")) |> Enum.join("\n")
        fingerprint = text |> :erlang.phash2() |> Integer.to_string(36)

        item =
          %{
            item_id: "slice_item_#{fingerprint}_1",
            title: creative_title(prompt, brief, fingerprint),
            body: creative_body(prompt, brief, context),
            rationale: creative_rationale(prompt, brief)
          }
          |> maybe_put_narrative_role(prompt, brief)

        if prose_fragment_prompt?(prompt) do
          %{items: [item], self_report: creative_self_report(context)}
        else
          [item]
        end
    end
  end

  defp character_evolution_seed_prompt?(prompt),
    do: String.contains?(prompt, "artifact_type：character_evolution_seed")

  # 角色演化记忆草稿：从 brief 派生 memory_subtype（关系/当前状态/演化），采纳后写对应角色 MemoryType。
  defp character_evolution_item(brief, context) do
    fingerprint = [brief, context] |> Enum.join("\n") |> :erlang.phash2() |> Integer.to_string(36)
    text = to_string(brief)

    subtype =
      cond do
        contains_any?(text, ["关系", "结盟", "反目", "决裂", "敌对", "背叛", "联手"]) -> "RELATIONSHIP"
        contains_any?(text, ["当前状态", "现状", "此刻", "目前", "伤势", "处境", "所在"]) -> "CURRENT_STATE"
        true -> "CHARACTER_PROFILE"
      end

    # 保留 user 输入中的随机标识符（nonce），证明采纳的角色记忆来自本轮输入而非 fixture。
    nonces =
      (random_identifier_tokens(text) ++ random_identifier_tokens(context))
      |> Enum.take(2)
      |> Enum.join("、")

    body_nonce = if nonces == "", do: "", else: "（线索：#{nonces}）"

    %{
      item_id: "slice_evo_#{fingerprint}_1",
      title: "林烬：演化事件 #{String.slice(fingerprint, 0, 4)}",
      body: "林烬随剧情发生演化#{body_nonce}。本条只记录该演化事实，不重写角色主档案。",
      rationale: "记录角色随剧情的连续性变化，供后续创作召回。",
      memory_subtype: subtype
    }
  end

  defp multi_character_candidate_prompt?(prompt, brief) do
    character_seed_prompt?(prompt) and
      contains_any?(to_string(brief), [
        "两个",
        "二个",
        "两位",
        "几个",
        "多个",
        "数个",
        "多位",
        "候选",
        "不同方向"
      ])
  end

  # 两条取向明显不同、各自独立可采纳的角色候选（item_id/标题各不相同，便于逐项采纳断言）。
  defp character_candidate_items(brief, context) do
    fingerprint = [brief, context] |> Enum.join("\n") |> :erlang.phash2() |> Integer.to_string(36)
    suffix = String.slice(fingerprint, 0, 4)

    [
      %{
        item_id: "slice_char_#{fingerprint}_1",
        title: "沈砚 #{suffix}",
        body: character_body(brief, context),
        rationale: "候选一：冷峻克制的稽查官方向。"
      },
      %{
        item_id: "slice_char_#{fingerprint}_2",
        title: "云栖 #{suffix}",
        body: character_body(brief, context),
        rationale: "候选二：游离于秩序之外的线人方向。"
      }
    ]
  end

  defp outline_plan_prompt?(prompt), do: String.contains?(prompt, "artifact_type：outline_draft")

  defp character_seed_prompt?(prompt),
    do: String.contains?(prompt, "artifact_type：character_seed")

  # character_seed 草稿按 user brief 中的角色类型词派生结构化叙事角色（确定性 fixture）。
  defp maybe_put_narrative_role(item, prompt, brief) do
    if character_seed_prompt?(prompt) do
      case brief_narrative_role(to_string(brief)) do
        nil -> item
        role -> Map.put(item, :narrative_role, role)
      end
    else
      item
    end
  end

  defp brief_narrative_role(text) do
    cond do
      String.contains?(text, "反派") -> "ANTAGONIST"
      String.contains?(text, "配角") -> "SUPPORTING"
      String.contains?(text, "次要") or String.contains?(text, "龙套") -> "MINOR"
      String.contains?(text, "群像") -> "ENSEMBLE_POV"
      String.contains?(text, "主角") or String.contains?(text, "主人公") -> "PROTAGONIST"
      true -> nil
    end
  end

  defp world_setting_prompt?(prompt),
    do:
      contains_any?(prompt, [
        "artifact_type：world_setting",
        "artifact_type：foreshadowing_seed",
        "artifact_type：world_rule_seed",
        "artifact_type：style_rule_seed",
        "artifact_type：constraint_seed"
      ])

  defp prose_fragment_prompt?(prompt),
    do: String.contains?(prompt, "artifact_type：prose_fragment")

  defp creative_self_report(context) do
    %{
      assumptions: ["按目标章结构和 ReaderEffectBrief 生成正文草稿"],
      intended_reader_effect: reader_effect_from_context(context),
      used_context_refs: ["target_structure", "reader_effect_brief"],
      risk_flags: ["WARN: 章尾钩子强度需作者审阅"]
    }
  end

  defp reader_effect_from_context(context) do
    case Regex.run(~r/目标情绪[:：]\s*([^\n]+)/u, context) do
      [_, emotion] -> String.trim(emotion)
      _ -> "按 ReaderEffectBrief 制造紧张和期待"
    end
  end

  # 章节计划生成具备增量感知（与真实 LLM 行为对称）：上下文里已有 N 章时，
  # 新计划从第 N+1 章接续编号（标题不与既有章相撞 → 采纳物化按 title 幂等追加）。
  defp outline_chapter_items(brief, context) do
    fingerprint =
      [brief, context]
      |> Enum.reject(&(&1 == ""))
      |> Enum.join("\n")
      |> :erlang.phash2()
      |> Integer.to_string(36)

    start = existing_chapter_count(context) + 1

    @outline_chapter_themes
    |> Enum.with_index(start)
    |> Enum.map(fn {theme, n} ->
      seq = n |> Integer.to_string() |> String.pad_leading(2, "0")

      %{
        item_id: "slice_outline_#{fingerprint}_#{n}",
        title: "第#{seq}章：#{theme}",
        body: outline_chapter_body(theme, n),
        rationale: nil
      }
    end)
  end

  defp outline_chapter_body(theme, n) do
    """
    章功能定位：#{outline_chapter_role(n)}
    情节推进：围绕「#{theme}」推进主线第 #{n} 阶段。
    人物变化：主角在「#{theme}」压力下完成一次选择升级。
    信息释放：释放与「#{theme}」相关的新线索。
    伏笔动作：埋下「#{theme}」后续回收点。
    情绪定位：紧张、期待。
    章首拉力：以「#{theme}」相关异常开场。
    章尾断章：在「#{theme}」线索刚要揭晓时切断。
    字数与场次：约 3000 字，2 场。
    """
    |> String.trim()
  end

  defp outline_chapter_role(n) when rem(n, 5) == 0, do: "高潮章"
  defp outline_chapter_role(n) when rem(n, 3) == 0, do: "转折章"
  defp outline_chapter_role(_n), do: "推进章"

  # creative 上下文（DialogueContext.to_prompt_text）的「## 已采纳章节」段行数。
  defp existing_chapter_count(context) do
    case Regex.run(~r/##\s*已采纳章节[^\n]*\n(.*?)(?:\n##|\z)/su, context) do
      [_, block] ->
        block |> String.split("\n") |> Enum.count(&String.match?(&1, ~r/^\s*-\s+/))

      _ ->
        0
    end
  end

  defp plan_response(prompt) do
    author_text = author_input_text(prompt)

    if multi_step_downgrade_prompt?(author_text) do
      multi_step_plan_response()
    else
      single_action_plan_response(prompt, author_text)
    end
  end

  defp profile_routing_response(prompt) do
    author_text = author_input_text_from_profile_route_prompt(prompt)
    normalized = String.downcase(author_text)
    {profile_ref, summary, reason_codes} = profile_route_match(normalized)

    profile_route_response(profile_ref, summary, reason_codes, author_text)
  end

  defp profile_route_match(normalized) do
    Enum.find_value(profile_route_rules(), default_profile_route(), fn
      {:contains, terms, route} ->
        if contains_any?(normalized, terms), do: route

      {:conversation_only, route} ->
        if conversation_only_text?(normalized), do: route
    end)
  end

  defp profile_route_rules do
    [
      {:contains, ["只读批量", "批量读取", "read-only batch", "readonly batch"],
       {"readonly_batch_context_v1", "模型选择只读批量上下文工作流。",
        ["model_profile_selected", "readonly_batch_text_match"]}},
      {:contains,
       [
         "provider 进度",
         "模型进度",
         "流式进度",
         "流式事件",
         "provider progress",
         "streaming progress",
         "UA01CP6SLOW"
       ],
       {"provider_progress_v1", "模型选择模型执行进度工作流。",
        ["model_profile_selected", "provider_progress_text_match"]}},
      {:contains, ["章节大纲", "章节计划", "分章大纲", "卷纲", "outline"],
       {"plot_outline_with_context_v1", "模型选择章节大纲工作流。",
        ["model_profile_selected", "plot_outline_text_match"]}},
      {:contains, ["角色演化", "角色成长", "当前状态", "关系变化", "受伤", "黑化"],
       {"character_evolution_with_context_v1", "模型选择角色演化工作流。",
        ["model_profile_selected", "character_evolution_text_match"]}},
      {:contains, ["世界观", "世界设定", "世界规则", "伏笔", "悬念", "线索", "写作规则", "风格规则", "文风"],
       {"world_building_with_context_v1", "模型选择世界设定工作流。",
        ["model_profile_selected", "world_building_text_match"]}},
      {:conversation_only, default_profile_route()},
      {:contains, ["正文草稿", "写下一章", "续写", "正文"],
       {"prose_drafting_with_quality_v1", "模型选择正文写作工作流。",
        ["model_profile_selected", "prose_drafting_text_match"]}},
      {:contains, ["角色阵容", "现有角色", "已有角色", "反派"],
       {"character_design_with_context_v1", "模型选择角色设计工作流。",
        ["model_profile_selected", "character_design_context_text_match"]}}
    ]
  end

  defp default_profile_route do
    {"conversation_turn_v1", "模型选择普通对话回应工作流。",
     ["model_profile_selected", "default_conversation_turn"]}
  end

  defp profile_route_response(profile_ref, summary, reason_codes, author_text) do
    %{
      profile_ref: profile_ref,
      summary: summary,
      reason_codes: reason_codes,
      matched_terms: profile_route_matched_terms(author_text),
      confidence: 1.0
    }
  end

  defp agent_next_step_decision_response(prompt) do
    profile_decision = profile_next_step_decision(prompt)

    decision =
      cond do
        observation_present?(prompt, "artifact_created") ->
          agent_done_packet(prompt)

        not is_nil(profile_decision) ->
          profile_decision

        observation_present?(prompt, "character_roster") and
            String.contains?(prompt, "重复读取角色阵容") ->
          continue_next("再次读取当前角色阵容，检查是否有新增信息。", "character_roster", "none", [
            "agentic_next_step",
            "repeat_roster_probe"
          ])

        observation_present?(prompt, "character_roster") ->
          continue_next("基于已读取的角色阵容设计新的主要反派。", "character_design", "tentative", [
            "agentic_next_step",
            "roster_observation_consumed"
          ])

        true ->
          continue_next("先读取当前作品已确认角色阵容。", "character_roster", "none", [
            "agentic_next_step",
            "missing_roster_observation"
          ])
      end

    structured_next_step_decision(decision, prompt)
  end

  defp structured_next_step_decision(packet, prompt) when is_map(packet) do
    {advanced, plan_holds, new_constraint} = next_step_evaluation(packet, prompt)

    tail = %{
      evaluation_of_last: %{
        advanced: advanced,
        plan_holds: plan_holds,
        new_constraint: new_constraint
      },
      decision: decision_for_plan_holds(packet, plan_holds),
      next_action: Map.fetch!(packet, :next_action),
      plan_revision: plan_revision_for(plan_holds, new_constraint, prompt),
      reason_codes: Map.get(packet, :reason_codes, []),
      confidence: Map.get(packet, :confidence, 1.0)
    }

    Map.fetch!(packet, :reasoning) <> "\n" <> Jason.encode!(tail)
  end

  defp next_step_evaluation(packet, prompt) do
    plan_holds = not String.contains?(prompt, "NNARR_REPLAN_PLAN_HOLDS_FALSE")
    advanced = Map.get(Map.fetch!(packet, :decision), :type) != "no_progress"
    new_constraint = if plan_holds, do: nil, else: "现有计划前提不成立，需要重排下一步。"

    {advanced, plan_holds, new_constraint}
  end

  defp decision_for_plan_holds(packet, false) do
    case Map.fetch!(packet, :decision) do
      %{type: "continue"} -> %{type: "replan"}
      %{"type" => "continue"} -> %{type: "replan"}
      decision -> decision
    end
  end

  defp decision_for_plan_holds(packet, _plan_holds), do: Map.fetch!(packet, :decision)

  defp continue_next(reasoning, target_tool_ref, write_intent, reason_codes) do
    %{
      reasoning: reasoning,
      decision: %{type: "continue"},
      next_action: %{
        target_tool_ref: target_tool_ref,
        write_intent: write_intent,
        risk_hint: "low"
      },
      plan_revision: nil,
      reason_codes: reason_codes,
      confidence: 1.0
    }
  end

  defp done_next(reasoning, reason_codes) do
    %{
      reasoning: reasoning,
      decision: %{type: "done"},
      next_action: %{target_tool_ref: nil, write_intent: "none", risk_hint: "low"},
      plan_revision: nil,
      reason_codes: reason_codes,
      confidence: 1.0
    }
  end

  defp plan_revision_for(false, revision_reason, prompt) do
    %{
      plan_version: prompt_plan_version(prompt) + 1,
      revision_reason: revision_reason
    }
  end

  defp plan_revision_for(_plan_holds, _revision_reason, _prompt), do: nil

  defp prompt_plan_version(prompt) do
    case Regex.run(~r/plan_version:\s*(\d+)/, prompt) do
      [_, value] -> String.to_integer(value)
      _ -> 1
    end
  end

  defp profile_next_step_decision(prompt) do
    cond do
      String.contains?(prompt, "profile_ref: conversation_turn_v1") ->
        conversation_turn_next_step_decision(prompt)

      String.contains?(prompt, "profile_ref: plot_outline_with_context_v1") ->
        plot_outline_next_step_decision(prompt)

      String.contains?(prompt, "profile_ref: prose_drafting_with_quality_v1") ->
        prose_drafting_next_step_decision(prompt)

      String.contains?(prompt, "profile_ref: character_evolution_with_context_v1") ->
        character_evolution_next_step_decision(prompt)

      String.contains?(prompt, "profile_ref: world_building_with_context_v1") ->
        world_building_next_step_decision(prompt)

      String.contains?(prompt, "profile_ref: prose_revision_from_findings_v1") ->
        prose_revision_next_step_decision(prompt)

      true ->
        nil
    end
  end

  defp agent_done_packet(prompt) do
    {summary, reason_code} =
      cond do
        String.contains?(prompt, "profile_ref: plot_outline_with_context_v1") ->
          {"已生成待采纳大纲候选，本轮目标已经满足。", "tentative_outline_draft_created"}

        String.contains?(prompt, "profile_ref: character_evolution_with_context_v1") ->
          {"已生成待采纳角色演化候选，本轮目标已经满足。", "tentative_character_evolution_seed_created"}

        String.contains?(prompt, "profile_ref: world_building_with_context_v1") ->
          {"已生成待采纳世界设定候选，本轮目标已经满足。", "tentative_world_building_seed_created"}

        String.contains?(prompt, "profile_ref: prose_drafting_with_quality_v1") ->
          {"已生成待采纳正文草稿并完成质量复核，本轮目标已经满足。", "tentative_prose_fragment_created"}

        String.contains?(prompt, "profile_ref: prose_revision_from_findings_v1") ->
          {"已生成待采纳修订草稿，本轮目标已经满足。", "tentative_revision_fragment_created"}

        true ->
          {"已生成待采纳角色候选，本轮目标已经满足。", "tentative_character_seed_created"}
      end

    done_next(summary, ["goal_satisfied", reason_code])
  end

  defp plot_outline_next_step_decision(prompt) do
    if observation_present?(prompt, "outline_context") do
      continue_next("基于已读取的章节上下文生成章节大纲草稿。", "plot_outline", "tentative", [
        "agentic_next_step",
        "outline_context_consumed"
      ])
    else
      context_assemble_decision("先读取章节大纲规划上下文。", "missing_outline_context")
    end
  end

  defp prose_drafting_next_step_decision(prompt) do
    if observation_present?(prompt, "prose_context") do
      continue_next("基于已读取的正文上下文生成正文草稿并完成质量复核。", "prose_writing", "tentative", [
        "agentic_next_step",
        "prose_context_consumed"
      ])
    else
      context_assemble_decision("先读取正文写作上下文。", "missing_prose_context")
    end
  end

  defp character_evolution_next_step_decision(prompt) do
    if observation_present?(prompt, "character_evolution_context") do
      continue_next("基于已读取的角色上下文生成角色演化草稿。", "character_evolution", "tentative", [
        "agentic_next_step",
        "character_evolution_context_consumed"
      ])
    else
      context_assemble_decision("先读取角色演化上下文。", "missing_character_evolution_context")
    end
  end

  defp world_building_next_step_decision(prompt) do
    if observation_present?(prompt, "custom") and String.contains?(prompt, "世界设定上下文") do
      continue_next("基于已读取的作品设定上下文生成世界设定草稿。", "world_building", "tentative", [
        "agentic_next_step",
        "world_building_context_consumed"
      ])
    else
      context_assemble_decision("先读取作品设定上下文。", "missing_world_building_context")
    end
  end

  defp prose_revision_next_step_decision(prompt) do
    observations = existing_observation_section(prompt)

    cond do
      String.contains?(observations, "已生成新的修订候选") ->
        continue_next("汇总修订候选给作者确认。", "revision_finalize", "none", [
          "agentic_next_step",
          "revision_candidate_ready"
        ])

      String.contains?(observations, "重新经过 Orchestrator") ->
        continue_next("基于修订计划生成正文修订候选。", "prose_writing", "tentative", [
          "agentic_next_step",
          "revision_plan_consumed"
        ])

      String.contains?(observations, "已读取待修订草稿") ->
        continue_next("制定修订执行策略并重新经过系统裁决。", "revision_plan", "none", [
          "agentic_next_step",
          "revision_source_consumed"
        ])

      true ->
        continue_next("读取待修订草稿和质量发现。", "revision_prepare", "none", [
          "agentic_next_step",
          "missing_revision_source"
        ])
    end
  end

  defp conversation_turn_next_step_decision(prompt) do
    cond do
      conversation_observation_present?(prompt, ["已生成本轮回应"]) ->
        done_next("已生成本轮回应，本轮目标已经满足。", [
          "goal_satisfied",
          "conversation_turn_response_created"
        ])

      conversation_observation_present?(prompt, [
        "无需工具",
        "工具执行授权",
        "执行策略生成失败",
        "作者确认",
        "授权判断"
      ]) ->
        continue_next("根据系统裁决生成本轮回应。", "response_finalize", "none", [
          "agentic_next_step",
          "conversation_strategy_consumed"
        ])

      conversation_observation_present?(prompt, ["对话认知帧"]) ->
        continue_next("基于对话认知帧完成执行策略与系统裁决。", "strategy_gate", "none", [
          "agentic_next_step",
          "dialogue_frame_consumed"
        ])

      conversation_observation_present?(prompt, ["创作上下文"]) ->
        continue_next("基于已组装上下文形成对话认知帧。", "dialogue_frame", "none", [
          "agentic_next_step",
          "conversation_context_consumed"
        ])

      true ->
        context_assemble_decision("先组装当前作品的创作上下文。", "missing_conversation_context")
    end
  end

  defp conversation_observation_present?(prompt, needles) do
    prompt
    |> existing_observation_section()
    |> then(fn section -> Enum.any?(needles, &String.contains?(section, &1)) end)
  end

  defp existing_observation_section(prompt) do
    prompt
    |> String.split("## 决策规则", parts: 2)
    |> hd()
  end

  defp context_assemble_decision(summary, reason_code) do
    continue_next(summary, "context_assemble", "none", ["agentic_next_step", reason_code])
  end

  defp observation_present?(prompt, type) do
    String.contains?(prompt, "/ #{type}:") or String.contains?(prompt, "#{type} /")
  end

  defp single_action_plan_response(prompt, author_text) do
    tool_name = tool_name_for_prompt(author_text)

    {authoring_intent, target_chapter, requested_chapter_raw} =
      authoring_intent_for(prompt, author_text)

    target_word_count = target_word_count_from_text(author_text)
    rewrite? = authoring_intent == "rewrite"

    action =
      %{
        action_id: "act-slice-verify",
        action_type: "capability_invocation",
        summary: action_summary(tool_name, author_text),
        target_ref: tool_name,
        write_intent: if(rewrite?, do: "production_candidate", else: "tentative"),
        risk_hint: if(rewrite?, do: "high", else: "low")
      }
      |> maybe_put_authoring(authoring_intent, target_chapter)
      |> maybe_put_requested_chapter_raw(requested_chapter_raw)
      |> maybe_put_target_word_count(target_word_count)

    %{
      plan_goal_summary: "验证工作台 micro plan 入口",
      risk_hint: if(rewrite?, do: "high", else: "low"),
      requires_confirmation_hint: false,
      proposed_actions: [action],
      state_changes_requested: [],
      required_capabilities: [tool_name],
      fallback_message: "如果暂时不能生成，就先继续用对话收束方向。"
    }
  end

  defp multi_step_downgrade_prompt?(text) do
    contains_any?(text, ["同时重写", "多个操作", "多步推进"]) and
      contains_any?(text, ["主角动机", "角色动机"]) and
      String.contains?(text, "伏笔")
  end

  defp multi_step_plan_response do
    %{
      plan_goal_summary: "拆解作者提出的多项创作操作",
      risk_hint: "medium",
      requires_confirmation_hint: false,
      proposed_actions: [
        %{
          action_id: "act-slice-downgrade-prose",
          action_type: "capability_invocation",
          summary: "重写第一章正文草稿",
          target_ref: "prose_writing",
          write_intent: "tentative",
          risk_hint: "medium",
          authoring_intent: "rewrite",
          target_chapter: nil,
          requested_chapter_raw: "第一章",
          target_word_count: nil
        },
        %{
          action_id: "act-slice-downgrade-character",
          action_type: "capability_invocation",
          summary: "更新主角动机设定",
          target_ref: "character_design",
          write_intent: "tentative",
          risk_hint: "medium",
          authoring_intent: "none",
          target_chapter: nil,
          requested_chapter_raw: nil,
          target_word_count: nil
        },
        %{
          action_id: "act-slice-downgrade-foreshadowing",
          action_type: "capability_invocation",
          summary: "整理伏笔清单",
          target_ref: "world_building",
          write_intent: "tentative",
          risk_hint: "medium",
          authoring_intent: "none",
          target_chapter: nil,
          requested_chapter_raw: nil,
          target_word_count: nil
        }
      ],
      state_changes_requested: [],
      required_capabilities: ["prose_writing", "character_design", "world_building"],
      fallback_message: "这个请求包含多项独立创作操作，建议先拆成单个步骤逐步推进。"
    }
  end

  defp maybe_put_authoring(action, nil, _chapter), do: action

  defp maybe_put_authoring(action, intent, chapter) do
    action
    |> Map.put(:authoring_intent, intent)
    |> Map.put(:target_chapter, chapter)
  end

  defp maybe_put_requested_chapter_raw(action, nil), do: action

  defp maybe_put_requested_chapter_raw(action, raw),
    do: Map.put(action, :requested_chapter_raw, raw)

  defp maybe_put_target_word_count(action, nil), do: action
  defp maybe_put_target_word_count(action, n), do: Map.put(action, :target_word_count, n)

  # 目标字数识别（确定性）：作者文本里的"约 N 字 / N 字"。与真实 LLM 的篇幅识别对称。
  defp target_word_count_from_text(text) do
    case Regex.run(~r/(\d+)\s*字/u, text) do
      [_, n] -> String.to_integer(n)
      _ -> nil
    end
  end

  # 续写/重写意图识别（确定性）：仅当 plan prompt 已带「作品章节」列表时才可能续写/重写。
  # 作者「接着/继续/续写/往下写」→ continuation；「推翻/重写/改写」→ rewrite。
  # target_chapter 精确取自 prompt 的作品章节列表（与真实 LLM「精确复制」规则一致）。
  defp authoring_intent_for(prompt, author_text) do
    case accepted_chapters_in_prompt(prompt) do
      [] ->
        {nil, nil, nil}

      chapters ->
        intent =
          cond do
            contains_any?(author_text, ["推翻", "重写", "改写", "重新写"]) ->
              "rewrite"

            contains_any?(author_text, ["接着", "继续", "续写", "往下写", "再写", "补一段", "补写"]) ->
              "continuation"

            true ->
              nil
          end

        resolve_chapter_refs(intent, author_text, chapters)
    end
  end

  # 返回 {intent, target_chapter（planner 匹配到列表的全名，未匹配为 nil）, requested_chapter_raw（作者点名原文）}。
  # 与真实 LLM「精确匹配列表标题或置空」对称：按章号把作者点名的章对到列表全名。
  defp resolve_chapter_refs(nil, _author_text, _chapters), do: {nil, nil, nil}

  defp resolve_chapter_refs(intent, author_text, chapters) do
    case named_chapter_token(author_text) do
      nil ->
        # 未点名具体章（如"接着往下写"）：维持既有"默认归首章"行为，不报缺失。
        {intent, target_chapter_for(chapters), nil}

      token ->
        num = chapter_num(token)
        matched = num && Enum.find(chapters, fn title -> chapter_num(title) == num end)

        # 点名但匹配不到列表 → target_chapter=nil（block 信号）；匹配到 → 列表全名。
        {intent, matched, token}
    end
  end

  defp named_chapter_token(text) do
    case Regex.run(~r/第\s*[0-9零一二三四五六七八九十百两]+\s*章/u, text) do
      [token] -> String.replace(token, ~r/\s+/, "")
      _ -> nil
    end
  end

  @cn_digits %{
    "零" => 0,
    "一" => 1,
    "二" => 2,
    "两" => 2,
    "三" => 3,
    "四" => 4,
    "五" => 5,
    "六" => 6,
    "七" => 7,
    "八" => 8,
    "九" => 9
  }

  # 从"第N章"提取章号（Arabic 或中文 1-99），匹配不出为 nil。
  defp chapter_num(nil), do: nil

  defp chapter_num(text) when is_binary(text) do
    cond do
      match = Regex.run(~r/第\s*(\d+)\s*章/u, text) ->
        match |> Enum.at(1) |> String.to_integer()

      match = Regex.run(~r/第\s*([零一二三四五六七八九十百两]+)\s*章/u, text) ->
        cn_numeral(Enum.at(match, 1))

      true ->
        nil
    end
  end

  defp cn_numeral(s) do
    cond do
      s == "十" -> 10
      String.starts_with?(s, "十") -> 10 + cn_digit(String.slice(s, 1, 8))
      String.contains?(s, "十") -> cn_tens(s)
      true -> cn_digit(s)
    end
  end

  defp cn_tens(s) do
    [tens, ones] = String.split(s, "十", parts: 2)
    cn_digit(tens) * 10 + if(ones == "", do: 0, else: cn_digit(ones))
  end

  defp cn_digit(""), do: 0
  defp cn_digit(s), do: Map.get(@cn_digits, s, 0)

  defp accepted_chapters_in_prompt(prompt) do
    # planner 段头为「## 作品章节（…含已规划但还没写正文的章）」，正文章节列表取自此段。
    case Regex.run(~r/##\s*作品章节[^\n]*\n(.*?)(?:\n##|\z)/su, prompt) do
      [_, block] ->
        ~r/^\s*-\s*(.+?)\s*$/mu
        |> Regex.scan(block)
        |> Enum.map(fn [_, title] -> title end)
        |> Enum.reject(&(&1 == ""))

      _ ->
        []
    end
  end

  # checkpoint 1 单章续写：默认归第一章（与 driver 续写第 1 章一致）。
  defp target_chapter_for(chapters), do: List.first(chapters)

  defp tool_name_for_prompt(prompt) do
    cond do
      readonly_character_query_prompt?(prompt) ->
        "character_roster"

      character_evolution_request_prompt?(prompt) ->
        "character_evolution"

      contains_any?(prompt, ["正文", "片段", "开场"]) ->
        "prose_writing"

      contains_any?(prompt, ["角色", "人物", "主角"]) ->
        "character_design"

      contains_any?(prompt, ["大纲", "章节"]) ->
        "plot_outline"

      true ->
        "world_building"
    end
  end

  defp action_summary(tool_name, author_text) do
    summary =
      case tool_name do
        "character_roster" -> "查看当前作品已确认角色列表"
        "prose_writing" -> "生成一段正文草稿"
        "character_design" -> "生成一个角色设定草案"
        "plot_outline" -> "生成一份大纲草案"
        "world_building" -> "生成一组世界设定草案"
        _ -> "生成一组可供作者继续选择的创作方向"
      end

    if String.contains?(author_text, @tool_failure_marker) do
      "#{@tool_failure_marker} #{summary}"
    else
      summary
    end
  end

  defp contains_any?(text, terms) do
    Enum.any?(terms, &String.contains?(text, &1))
  end

  defp author_input_text(prompt) do
    prompt
    |> current_user_message()
    |> case do
      nil -> author_input_text_from_prompt(prompt_text(prompt))
      text -> text
    end
  end

  defp current_user_message(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.reverse()
    |> Enum.find_value(fn
      %{role: "user", content: content} -> content
      _message -> nil
    end)
  end

  defp current_user_message(_prompt), do: nil

  defp author_input_text_from_prompt(prompt) do
    case Regex.run(~r/用户消息：\s*(.*?)\s*$/s, prompt) do
      [_, text] ->
        text

      _ ->
        case Regex.run(~r/## 用户输入\s*(.*?)\s*## 输出格式/s, prompt) do
          [_, text] -> text
          _ -> prompt
        end
    end
  end

  defp author_input_text_from_profile_route_prompt(prompt) do
    case Regex.run(~r/## 作者输入\s*(.*?)\s*## 可选 profile/su, prompt) do
      [_, text] -> String.trim(text)
      _ -> author_input_text_from_prompt(prompt)
    end
  end

  defp conversation_only_text?(normalized) do
    contains_any?(normalized, [
      "不写正文",
      "不要写正文",
      "不用写正文",
      "先聊方向",
      "只聊方向",
      "讨论方向"
    ])
  end

  defp profile_route_matched_terms(text) do
    [
      "角色阵容",
      "现有角色",
      "反派",
      "正文草稿",
      "写下一章",
      "续写",
      "正文",
      "章节大纲",
      "章节计划",
      "角色演化",
      "当前状态",
      "受伤",
      "世界设定",
      "伏笔",
      "线索",
      "写作规则",
      "风格规则",
      "provider 进度",
      "流式进度",
      "只读批量"
    ]
    |> Enum.filter(&String.contains?(text, &1))
  end

  defp creative_prompt_parts(prompt) do
    case Regex.run(~r/用户创作简述：(.+?)\n\s*上下文：(.+?)\n\s*重要：/su, prompt) do
      [_, brief, context] ->
        {String.trim(brief), String.trim(context)}

      _ ->
        {author_input_text_from_prompt(prompt), ""}
    end
  end

  # 章节正文 item 标题取章节计划标题（"第N章：标题"，止于下一个分隔符），让采纳后的章节名
  # 是真实章名而非占位。无法识别章号时回退占位标题。
  defp creative_title(prompt, brief, fingerprint) do
    cond do
      character_seed_prompt?(prompt) ->
        "沈砚 #{String.slice(fingerprint, 0, 4)}"

      world_setting_prompt?(prompt) ->
        world_setting_title(prompt, brief, fingerprint)

      true ->
        case Regex.run(~r/第\d+章[：:]\s*[^：:。\n]+/u, brief) do
          [chapter_title] -> String.trim(chapter_title)
          _ -> "待确认正文草稿 #{fingerprint}"
        end
    end
  end

  defp creative_body(prompt, brief, context) do
    cond do
      character_seed_prompt?(prompt) -> character_body(brief, context)
      world_setting_prompt?(prompt) -> world_setting_body(prompt, brief, context)
      true -> prose_body(brief, context)
    end
  end

  defp world_setting_title(prompt, brief, fingerprint) do
    suffix = String.slice(fingerprint, 0, 4)

    case world_setting_kind(prompt, brief) do
      :foreshadowing -> "伏笔：矿区旧账 #{suffix}"
      :style_rule -> "风格规则：审计式悬疑 #{suffix}"
      :world_rule -> "规则：灵气账单 #{suffix}"
      :constraint -> "约束：谜底释放 #{suffix}"
    end
  end

  defp world_setting_body(prompt, brief, context) do
    nonce_line = setting_nonce_line(brief, context)

    lines =
      case world_setting_kind(prompt, brief) do
        :foreshadowing ->
          [
            "伏笔线索：矿区旧账编号会在主角第一次查看欠费记录时出现。",
            "首次出现位置：第一卷矿区调查线。",
            "推进方式：每次出现都揭露一层公司灵气账单黑幕。",
            "回收方式：第三卷用旧账编号证明真正债主并非主角母亲。",
            "风险与禁忌：回收前不得提前说破旧账编号的真实归属。"
          ]

        :style_rule ->
          [
            "风格规则：后续写作保持审计式悬疑和赛博修仙质感。",
            "适用文本范围：公司、灵气账单、矿区调查相关章节。",
            "禁止事项：不得用旁白提前解释谜底，不得让角色无代价获得答案。",
            "推荐写法：用账单、阵纹、巡检记录推动冲突。",
            "后续复核方式：每次采纳正文前检查是否保留悬疑压力。"
          ]

        :world_rule ->
          [
            "世界规则：灵气以公司账单计价，欠费会触发巡检追缴。",
            "适用范围：城市矿区、修士交易所和低阶居民生活线。",
            "例外条件：黑市阵芯可以短时绕过追缴，但会留下审计痕迹。",
            "对人物选择的压力：角色必须在生存、债务和道义之间选择。",
            "与既有设定的关系：不覆盖已有章节计划，只补充可召回的作品规则。"
          ]

        :constraint ->
          [
            "约束内容：谜底回收前不得直接解释旧账编号真实归属。",
            "适用范围：矿区旧账、巡检账单和母亲失踪相关章节。",
            "禁止事项：不得让旁白提前剧透，不得让角色无代价破解账本。",
            "例外条件：只允许以误导性线索推进读者猜测。",
            "后续复核方式：采纳正文前检查信息释放是否仍保留悬念。"
          ]
      end

    [lines, [nonce_line]]
    |> List.flatten()
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp world_setting_kind(prompt, brief),
    do: prompt_setting_kind(prompt) || brief_setting_kind(brief)

  defp prompt_setting_kind(prompt) do
    cond do
      String.contains?(prompt, "artifact_type：foreshadowing_seed") ->
        :foreshadowing

      String.contains?(prompt, "artifact_type：style_rule_seed") ->
        :style_rule

      String.contains?(prompt, "artifact_type：world_rule_seed") ->
        :world_rule

      String.contains?(prompt, "artifact_type：constraint_seed") ->
        :constraint

      true ->
        nil
    end
  end

  defp brief_setting_kind(brief) do
    cond do
      contains_any?(brief, ["伏笔", "悬念", "线索", "回收"]) ->
        :foreshadowing

      contains_any?(brief, ["风格", "文风", "写作规则"]) ->
        :style_rule

      contains_any?(brief, ["约束", "限制", "禁止", "不得", "禁忌"]) ->
        :constraint

      contains_any?(brief, ["规则", "规则体系", "世界规则"]) ->
        :world_rule

      true ->
        :world_rule
    end
  end

  defp setting_nonce_line(brief, context) do
    tokens =
      [brief, context]
      |> Enum.join("\n")
      |> random_identifier_tokens()
      |> Enum.take(3)
      |> Enum.join("、")

    if tokens == "", do: "", else: "校验标识：#{tokens}"
  end

  defp prose_body(brief, context) do
    cond do
      # VS-00E：短促动作场面（作者要求“短促 + 动作/打斗/追击”）确定性产出句首/结构高度雷同
      # 的短句正文。这是“模型写出了节奏单调的动作段”这一真实情况的离线复刻：产品侧
      # 确定性 validator（uniform_line / sentence_start_repetition）会如实命中，作者据此
      # 可走 revise_from_findings。仅在写新正文（非修订/续写）时生效，避免污染其它 slice。
      action_beat_prose?(brief, context) and not revision_brief?(brief) ->
        action_beat_body(brief, context)

      continuation_brief?(brief) ->
        continuation_body(brief, context)

      is_integer(target_word_count_in_brief(brief)) ->
        length_targeted_body(target_word_count_in_brief(brief), brief, context)

      true ->
        opening_body(brief, context)
    end
  end

  # 作者要“短促 + 动作/打斗/追击”才命中（两类词同时出现），其它正文 slice 不受影响。
  defp action_beat_prose?(brief, context) do
    text = "#{brief}\n#{context}"
    contains_any?(text, ["短促", "短句", "快节奏"]) and contains_any?(text, ["动作", "打斗", "追击", "缠斗"])
  end

  # revision_section 由 application 渲染为「[质量修订要求]…」追加在锚点之后；修订轮即便
  # 上文动作场面雷同，也产出节奏有变化的新稿，证明“按问题重写”确实换了一稿。
  defp revision_brief?(brief), do: String.contains?(to_string(brief), "[质量修订要求]")

  # 句首与行结构高度雷同的短促动作段：5 行皆以「他」开头、无逗号 → 命中 uniform_line。
  defp action_beat_body(brief, context) do
    nonce_text =
      "#{brief}\n#{context}" |> random_identifier_tokens() |> Enum.take(1) |> Enum.join("、")

    nonce_line = if nonce_text == "", do: "他咬住暗号继续逼近。", else: "他咬住暗号#{nonce_text}继续逼近。"

    [
      "他猛地侧身。",
      "他一刀劈下。",
      "他反手格挡。",
      "他迈步逼近。",
      nonce_line
    ]
    |> Enum.join("\n")
  end

  defp character_body(brief, context) do
    nonce_text =
      [brief, context]
      |> Enum.join("\n")
      |> random_identifier_tokens()
      |> Enum.take(3)
      |> Enum.join("、")

    nonce_line =
      if nonce_text == "",
        do: "校验标识：（无）",
        else: "校验标识：#{nonce_text}"

    [
      "定位：灵气交易所稽查官，适合作为主角阵营的冷峻调查者。",
      "动机：查清灵气账单异常背后的权力交易，同时保护被系统规则压迫的普通修士。",
      "背景：出身底层账务区，曾因旧阵芯事故失去重要同伴，因此对交易所内部黑账格外敏感。",
      "关系：会主动避开与现有角色重名，并与黑市、交易所、巡检车势力形成可冲突关系。",
      "弧光：从只相信证据的孤立稽查者，逐步学会把他人托付纳入自己的判断。",
      "外貌：身形瘦削，常穿磨旧的深色制服，左腕嵌着会短暂发光的旧阵芯。",
      "语言风格：短句、克制、带审计式追问，很少表达情绪。",
      "能力体系绑定：擅长读取灵气账单、追踪阵纹流水和识别伪造功法凭证。",
      nonce_line,
      "作品专属维度：可围绕作者请求继续补足境界、功法、社会关系和关键弱点。请求摘要：#{String.slice(brief, 0, 80)}"
    ]
    |> Enum.join("\n")
  end

  # 目标字数槽（Slice B）：作者明确篇幅诉求时，确定性产出有效字数贴近 N 的正文。
  # 以 opening_body 为骨架（含 nonce 句，保 I3），再用带序号的填充句补到 >= N；
  # 序号让句子字节互不相同（不靠重复同句注水）。有效字数落在 [N, N + 一句] 区间。
  defp length_targeted_body(target, brief, context) do
    base = opening_body(brief, context)
    fill_to_word_count([base], effective_count(base), target, 1)
  end

  defp fill_to_word_count(acc, count, target, _idx) when count >= target do
    acc |> Enum.reverse() |> Enum.join("\n")
  end

  defp fill_to_word_count(acc, count, target, idx) do
    line = filler_line(idx)
    fill_to_word_count([line | acc], count + effective_count(line), target, idx + 1)
  end

  defp filler_line(idx) do
    "他在第#{idx}道阵纹前停下脚步，指尖缓缓描过冷硬的刻痕，把这一处岔路的走向与气味默默记进心里。"
  end

  # 从创作简述里取作者篇幅诉求（turn_execution 注入的"目标字数：约 N 字"）。
  defp target_word_count_in_brief(brief) do
    case Regex.run(~r/目标字数：约\s*(\d+)\s*字/u, brief) do
      [_, n] -> String.to_integer(n)
      _ -> nil
    end
  end

  # 有效字数口径与 NovelDomain.ProseWordCount 对齐（字母/表意文字/数字），
  # novel_agent 不依赖 novel_domain，故在此本地实现同口径正则。
  defp effective_count(text) do
    ~r/[^\p{L}\p{N}]/u |> Regex.replace(text, "") |> String.length()
  end

  defp continuation_brief?(brief) do
    contains_any?(brief, ["接着", "继续", "续写", "往下写", "再写", "补一段", "补写", "推翻", "重写", "改写"])
  end

  defp opening_body(brief, context) do
    subject = creative_subject(brief)
    nonce_text = context |> random_identifier_tokens() |> Enum.take(3) |> Enum.join("、")

    nonce_sentence =
      if nonce_text == "", do: "", else: "档案暗码 #{nonce_text} 像冷光一样贴在他的视野边缘，提醒这不是幻觉。"

    [
      "夜色压在#{subject}上，灵气账单从屋檐下垂落，像一串即将燃尽的符纸。",
      "主角停在巷口，听见远处公司巡检车的低鸣，也听见自己腕骨里那枚旧阵芯正在倒数。",
      nonce_sentence,
      "他没有立刻逃跑，而是把欠费记录折进袖中，反手扣住最后一张护身符，朝最黑的楼梯口走去。"
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  # 续写正文：单段约 500 有效字，2 轮续写叠加初稿（约 168）即可越过 P1 单章 1000 字门槛。
  # 各句互不相同（不靠重复段落注水）；fingerprint 让相邻续写不字节相同。
  defp continuation_body(brief, context) do
    fingerprint = [brief, context] |> Enum.join("|") |> :erlang.phash2() |> Integer.to_string(36)
    nonce_text = context |> random_identifier_tokens() |> Enum.take(2) |> Enum.join("、")

    nonce_line =
      if nonce_text == "",
        do: "矿道深处的旧阵芯仍在倒数，他听得见自己的心跳与符纸燃烧的细响交叠在一起。",
        else: "档案暗码 #{nonce_text} 在视野边缘明灭，像替这条矿道标好了退路与陷阱。"

    [
      "林澈把欠费记录折进袖口，借着护身符的微光辨认岔路，脚下碎石被踩出一连串闷响。",
      "矿道越往里越窄，潮湿的灵气贴着石壁缓缓流动，凝成一层会呼吸的薄霜。",
      "他想起母亲临走前的叮嘱，把翻涌的恐惧压回胸腔，逼自己一步一步丈量这片黑暗。",
      nonce_line,
      "前方传来金属摩擦的声响，像有什么东西在缓慢苏醒，又像巡检傀儡在重新校准刃口。",
      "他屏住呼吸贴着石壁挪动，指尖触到一道被人为凿开的暗槽，里面嵌着半枚冷却的阵钉。",
      "阵钉残留的纹路与他腕骨里的旧阵芯隐隐共鸣，刺痛顺着血管一路爬上后颈。",
      "他咬牙拔出阵钉，黑暗骤然裂开一线幽蓝，照亮墙上密密麻麻、尚未结清的灵气欠条。",
      "那一刻他才真正明白，这座矿区埋着的从来不是矿石，而是无数被账单困住的活人。",
      "身后的脚步声不紧不慢地逼近，他没有回头，只把阵钉攥得更紧，朝幽蓝走得更深。",
      "通道尽头是一扇半塌的阵门，门缝漏出的光像水一样在地面铺开，又被黑暗一点点吞回。",
      "他蹲下身，用阵钉在门槛上刻下一个只有自己看得懂的记号，给将来的退路留一道凭证。",
      "远处的低鸣忽然停了，整条矿道陷入令人牙酸的寂静，连灵气流动的声音都听得清楚。",
      "林澈知道，这种安静往往意味着对方已经发现了他，正等着他先露出破绽。",
      "他缓缓吐出一口浊气，把最后一张护身符贴在心口，做好了随时把命押上去的准备。",
      "黑暗里那串编号 #{fingerprint} 又一次在他脑海里亮起，提醒他记住走过的每一个拐角。"
    ]
    |> Enum.join("\n")
  end

  defp creative_subject(brief) do
    case Regex.run(~r/第\d+章[：:]\s*([^：:\n。]+?)(?:：|正文草稿|$)/u, brief) do
      [_, subject] ->
        String.trim(subject)

      _ ->
        "这座赛博修仙城市"
    end
  end

  defp creative_rationale(prompt, brief) do
    cond do
      character_seed_prompt?(prompt) ->
        "基于当前作品背景、设定与现有角色入口生成角色主档案草稿，未写入作品事实。"

      world_setting_prompt?(prompt) ->
        "基于当前作品背景生成可采纳的档案设定草稿，未写入作品事实。"

      String.contains?(brief, "正文草稿") ->
        "根据作者指定章节生成待确认正文片段，未写入作品事实。"

      true ->
        "根据本次作者输入生成待确认创作素材，未写入作品事实。"
    end
  end

  defp random_identifier_tokens(text) do
    ~r/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}\b/u
    |> Regex.scan(text)
    |> Enum.map(fn [token] -> token end)
    |> Enum.uniq()
  end

  defp prompt_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_text(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.map_join("\n", fn message -> "#{message.role}: #{message.content}" end)
  end
end
