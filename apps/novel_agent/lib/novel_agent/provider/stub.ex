defmodule NovelAgent.Provider.Stub do
  @moduledoc """
  Stub provider — 离线/骨架验证用的合法 fixture provider。

  根据 08-provider-abstraction.md §2.4，stub 是正式 provider 实现，用于：
  - greenfield 开发期间离线验证
  - 契约测试（contract test）
  - Provider Gateway 骨架调试

  ## 响应策略

  stub 不调用任何外部 LLM。它根据 prompt 中显式声明的"输出格式契约"识别
  请求类型（frame / plan / creative items），返回对应的最小合法 JSON。
  识别失败时回退为 echo 响应。

  creative items prompt 的响应同时满足：
  - **I3 种子贯通**：保留 user 输入文本中的随机标识符，让它们自然出现在 artifact
  - **I2 输入差异**：`item_id` 从 user input 派生 fingerprint，保证不同输入产生
    不同 id（两两不相交）

  此处持有的 JSON 字面量是 schema 的最小契约样本（contract skeleton，
  不是作品内容），属于 `docs/engineering/scenario-invariants.md` §4 允许
  的字符串字面量。
  """

  @behaviour NovelAgent.Provider

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.Result

  defstruct []

  @type t :: %__MODULE__{}

  @impl true
  def complete(_state, _model, prompt, _params) do
    text = prompt_text(prompt)
    {:ok, Result.new(infer_response(text))}
  end

  @impl true
  def execute(_state, _model, prompt, _params, ctx) do
    if AdapterExecution.cancelled?(ctx) do
      AdapterExecution.materialize_cancelled(ctx)
    else
      execute_uncancelled(prompt, ctx)
    end
  end

  defp execute_uncancelled(prompt, ctx) do
    text = prompt_text(prompt)
    content = infer_response(text)
    initial_events = AdapterExecution.initial_events(ctx)
    chunk_events = AdapterExecution.text_chunk_events(ctx, content, length(initial_events) + 1)

    AdapterExecution.emit_events(ctx, initial_events, :running)
    AdapterExecution.emit_events(ctx, chunk_events, :running)

    if AdapterExecution.cancelled?(ctx) do
      AdapterExecution.materialize_cancelled(ctx,
        initial_events: initial_events ++ chunk_events,
        emit: :terminal
      )
    else
      {:ok, Result.new(content)}
      |> AdapterExecution.materialize_result(
        ctx,
        initial_events: initial_events ++ chunk_events,
        emit: :terminal
      )
    end
  end

  @impl true
  def name, do: "stub"

  @impl true
  def health_check(_state), do: :ok

  # ── prompt 识别 ──

  defp infer_response(text) do
    cond do
      creative_items_prompt?(text) -> creative_items_json(text)
      profile_routing_prompt?(text) -> profile_routing_json(text)
      agent_next_step_decision_prompt?(text) -> agent_next_step_decision_content(text)
      plan_prompt?(text) -> plan_json()
      frame_prompt?(text) -> frame_json(text)
      true -> "[stub] echo: " <> text
    end
  end

  defp creative_items_prompt?(text) do
    String.contains?(text, "JSON 数组") and String.contains?(text, "artifact_type：")
  end

  defp plan_prompt?(text) do
    String.contains?(text, "plan_goal_summary") and String.contains?(text, "proposed_actions")
  end

  defp profile_routing_prompt?(text) do
    String.contains?(text, "AgentRun profile router") and
      String.contains?(text, "\"profile_ref\"")
  end

  defp agent_next_step_decision_prompt?(text) do
    String.contains?(text, "AgentRun 下一步规划器")
  end

  defp frame_prompt?(text) do
    String.contains?(text, "frame_type") and String.contains?(text, "assistant_message")
  end

  defp profile_routing_json(prompt_text) do
    prompt_text
    |> profile_route_response()
    |> Jason.encode!()
  end

  defp profile_route_response(prompt_text) do
    author_text = profile_route_author_text(prompt_text)
    normalized = String.downcase(author_text)
    {profile_ref, summary, reason_codes} = profile_route_match(normalized)

    profile_route(profile_ref, summary, reason_codes)
    |> Map.put("matched_terms", matched_terms(author_text))
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
      {:contains, ["provider 进度", "流式进度", "streaming progress", "UA01CP6SLOW"],
       {"provider_progress_v1", "模型选择模型执行进度工作流。",
        ["model_profile_selected", "provider_progress_text_match"]}},
      {:contains, ["章节大纲", "章节计划", "分章大纲", "卷纲", "outline"],
       {"plot_outline_with_context_v1", "模型选择章节大纲工作流。",
        ["model_profile_selected", "plot_outline_text_match"]}},
      {:contains, ["角色演化", "当前状态", "关系变化", "受伤", "黑化"],
       {"character_evolution_with_context_v1", "模型选择角色演化工作流。",
        ["model_profile_selected", "character_evolution_text_match"]}},
      {:contains, ["世界观", "世界设定", "伏笔", "线索", "写作规则", "风格规则", "文风"],
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

  defp profile_route(profile_ref, summary, reason_codes) do
    %{
      "profile_ref" => profile_ref,
      "summary" => summary,
      "reason_codes" => reason_codes,
      "matched_terms" => [],
      "confidence" => 1.0
    }
  end

  defp agent_next_step_decision_content(prompt_text) do
    prompt_text
    |> agent_next_step_decision_response()
    |> reasoning_tail()
  end

  defp agent_next_step_decision_response(prompt_text) do
    profile_next_step_decision(prompt_text) || character_design_next_step_decision(prompt_text)
  end

  defp reasoning_tail(packet) when is_map(packet) do
    tail = %{
      "evaluation_of_last" => Map.get(packet, :evaluation_of_last, evaluation_holds()),
      "decision" => Map.fetch!(packet, :decision),
      "next_action" => Map.fetch!(packet, :next_action),
      "plan_revision" => Map.get(packet, :plan_revision),
      "reason_codes" => Map.get(packet, :reason_codes, []),
      "confidence" => Map.get(packet, :confidence, 1.0)
    }

    Map.fetch!(packet, :reasoning) <> "\n" <> Jason.encode!(tail)
  end

  defp continue_next(reasoning, target_tool_ref, write_intent \\ "none", reason_codes \\ []) do
    %{
      reasoning: reasoning,
      evaluation_of_last: evaluation_holds(),
      decision: %{"type" => "continue"},
      next_action: %{
        "target_tool_ref" => target_tool_ref,
        "write_intent" => write_intent,
        "risk_hint" => "low"
      },
      plan_revision: nil,
      reason_codes: ["agentic_next_step" | reason_codes],
      confidence: 1.0
    }
  end

  defp done_next(reasoning, reason_codes \\ ["goal_satisfied"]) do
    %{
      reasoning: reasoning,
      evaluation_of_last: evaluation_holds(),
      decision: %{"type" => "done"},
      next_action: %{"target_tool_ref" => nil, "write_intent" => "none", "risk_hint" => "low"},
      plan_revision: nil,
      reason_codes: reason_codes,
      confidence: 1.0
    }
  end

  defp evaluation_holds do
    %{"advanced" => true, "plan_holds" => true, "new_constraint" => nil}
  end

  defp profile_next_step_decision(prompt_text) do
    Enum.find_value(profile_next_step_rules(), fn {profile_ref, decision_fun} ->
      if String.contains?(prompt_text, "profile_ref: #{profile_ref}") do
        decision_fun.(prompt_text)
      end
    end)
  end

  defp profile_next_step_rules do
    [
      {"conversation_turn_v1", &conversation_next_step_decision/1},
      {"world_building_with_context_v1", &world_building_next_step_decision/1},
      {"prose_drafting_with_quality_v1", &prose_drafting_next_step_decision/1},
      {"plot_outline_with_context_v1", &plot_outline_next_step_decision/1},
      {"character_evolution_with_context_v1", &character_evolution_next_step_decision/1},
      {"prose_revision_from_findings_v1", &prose_revision_next_step_decision/1}
    ]
  end

  defp character_design_next_step_decision(prompt_text) do
    cond do
      String.contains?(prompt_text, "/ artifact_created:") ->
        done_next("[stub] 已生成待采纳角色候选，本轮目标已满足。")

      String.contains?(prompt_text, "/ character_roster:") ->
        continue_next("[stub] 基于角色阵容设计新角色。", "character_design", "tentative")

      true ->
        continue_next("[stub] 先读取当前角色阵容。", "character_roster")
    end
  end

  defp prose_drafting_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        done_next("[stub] 已生成待采纳正文草稿并完成质量复核，本轮目标已满足。")

      String.contains?(observations, "正文写作上下文") ->
        continue_next(
          "[stub] 基于已读取的正文上下文生成正文草稿并完成质量复核。",
          "prose_writing",
          "tentative"
        )

      true ->
        continue_next("[stub] 先读取正文写作上下文。", "context_assemble")
    end
  end

  defp plot_outline_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        done_next("[stub] 已生成待采纳大纲候选，本轮目标已满足。")

      String.contains?(observations, "章节大纲规划上下文") ->
        continue_next("[stub] 基于已读取的章节上下文生成章节大纲草稿。", "plot_outline", "tentative")

      true ->
        continue_next("[stub] 先读取章节大纲规划上下文。", "context_assemble")
    end
  end

  defp character_evolution_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        done_next("[stub] 已生成待采纳角色演化候选，本轮目标已满足。")

      String.contains?(observations, "角色演化上下文") ->
        continue_next("[stub] 基于已读取的角色上下文生成角色演化草稿。", "character_evolution", "tentative")

      true ->
        continue_next("[stub] 先读取角色演化上下文。", "context_assemble")
    end
  end

  defp world_building_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        done_next("[stub] 已生成待采纳世界设定候选，本轮目标已满足。")

      String.contains?(observations, "世界设定上下文") ->
        continue_next("[stub] 基于已读取的作品设定上下文生成世界设定草稿。", "world_building", "tentative")

      true ->
        continue_next("[stub] 先读取作品设定上下文。", "context_assemble")
    end
  end

  defp prose_revision_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        done_next("[stub] 修订草稿已汇总，目标已满足。")

      String.contains?(observations, "已生成新的修订候选") ->
        continue_next("[stub] 汇总修订候选给作者。", "revision_finalize")

      String.contains?(observations, "重新经过 Orchestrator") ->
        continue_next("[stub] 基于修订计划生成正文修订候选。", "prose_writing", "tentative")

      String.contains?(observations, "已读取待修订草稿") ->
        continue_next("[stub] 制定修订计划并重新经过系统裁决。", "revision_plan")

      true ->
        continue_next("[stub] 读取待修订草稿和质量发现。", "revision_prepare")
    end
  end

  defp conversation_next_step_decision(prompt_text) do
    observations = existing_observation_section(prompt_text)

    cond do
      String.contains?(observations, "已生成本轮回应") ->
        done_next("[stub] 本轮回应已生成，目标已满足。")

      conversation_strategy_observation?(observations) ->
        continue_next("[stub] 根据系统裁决生成本轮回应。", "response_finalize")

      String.contains?(observations, "对话认知帧") ->
        continue_next("[stub] 基于对话认知帧完成执行策略与系统裁决。", "strategy_gate")

      String.contains?(observations, "创作上下文") ->
        continue_next("[stub] 基于已组装上下文形成对话认知帧。", "dialogue_frame")

      true ->
        continue_next("[stub] 先组装当前作品上下文。", "context_assemble")
    end
  end

  defp existing_observation_section(prompt_text) do
    prompt_text
    |> String.split("## 决策规则", parts: 2)
    |> hd()
  end

  defp conversation_strategy_observation?(observations) do
    Enum.any?(
      ["无需工具", "工具执行授权", "执行策略生成失败", "作者确认", "授权判断"],
      &String.contains?(observations, &1)
    )
  end

  # ── 最小合法响应 ──

  # creative items：生成产品形态的最小 fixture 内容，并保留 user 输入中的
  # 随机标识符（nonce），避免离线 provider 在 UI 中泄漏 prompt/context heading。
  # item_id 从 user input 派生 fingerprint，保证不同输入产生不同 id
  # （I2 不变量：N 个语义独立输入的 item_id 集合两两不相交）。
  defp creative_items_json(prompt_text) do
    {brief, context} = extract_creative_parts(prompt_text)
    user_excerpt = [brief, context] |> Enum.reject(&(&1 == "")) |> Enum.join("\n")
    fp = input_fingerprint(user_excerpt)

    item =
      %{
        "item_id" => "stub_item_" <> fp <> "_1",
        "title" => stub_creative_title(prompt_text, brief, fp),
        "body" => stub_creative_body(prompt_text, brief, context),
        "rationale" => stub_creative_rationale(prompt_text)
      }
      |> maybe_put_narrative_role(prompt_text, brief)

    Jason.encode!([item])
  end

  # character_seed 时按 user brief 中的角色类型词派生结构化叙事角色（fixture 确定性）。
  defp maybe_put_narrative_role(item, prompt_text, brief) do
    if character_seed_prompt?(prompt_text) do
      case stub_narrative_role(brief) do
        nil -> item
        role -> Map.put(item, "narrative_role", role)
      end
    else
      item
    end
  end

  defp stub_narrative_role(brief) do
    text = to_string(brief)

    cond do
      String.contains?(text, "反派") -> "ANTAGONIST"
      String.contains?(text, "配角") -> "SUPPORTING"
      String.contains?(text, "次要") or String.contains?(text, "龙套") -> "MINOR"
      String.contains?(text, "群像") -> "ENSEMBLE_POV"
      String.contains?(text, "主角") or String.contains?(text, "主人公") -> "PROTAGONIST"
      true -> nil
    end
  end

  defp input_fingerprint(text) do
    text |> :erlang.phash2() |> Integer.to_string(36)
  end

  defp plan_json do
    Jason.encode!(%{
      "plan_goal_summary" => "[stub] 调用 character_design 推进",
      "risk_hint" => "low",
      "requires_confirmation_hint" => false,
      "proposed_actions" => [
        %{
          "action_id" => "act-stub-1",
          "action_type" => "capability_invocation",
          "summary" => "[stub] 调用 character_design",
          "target_ref" => "character_design",
          "write_intent" => "tentative",
          "risk_hint" => "low"
        }
      ],
      "state_changes_requested" => [],
      "required_capabilities" => ["character_design"],
      "fallback_message" => "[stub] 无可调度行动"
    })
  end

  # frame 默认 reply-only（needs_tool=false）以兼容 reply-only 主链测试。
  # driver 通过 generate_micro_plan: true 显式强制走 plan/tool 路径。
  defp frame_json(prompt_text) do
    user_excerpt = extract_user_text(prompt_text)

    Jason.encode!(%{
      "frame_type" => "casual_reply",
      "dialogue_goal_summary" => "[stub] 收到用户输入",
      "needs_tool" => false,
      "no_tool_reason" => "no_tool_needed",
      "execution_readiness" => "not_applicable",
      "assistant_message" => "[stub] 已收到。原文：" <> user_excerpt,
      "candidate_directions" => [],
      "context_used" => context_provided?(prompt_text),
      "uncertainty" => []
    })
  end

  # 当 prompt 中 "当前作品上下文" 段落不是空标记时，认为 context 已提供。
  # 注：此处标记字符串与 plan prompt 模板隐式耦合 —
  # 如果 Planner 改了"当前作品上下文"段落或空标记文案，stub 也要同步更新。
  # 这种耦合是 fixture provider 与真实 prompt template 之间合理的契约链接。
  defp context_provided?(prompt_text) do
    String.contains?(prompt_text, "当前作品上下文") and
      not String.contains?(prompt_text, "（无——这是新对话或尚未创建作品）")
  end

  # 从 normalized prompt 中提取 user role 部分（含 nonce 等用户随机内容）
  defp extract_user_text(prompt_text) do
    case Regex.run(~r/用户创作简述：(.+?)\n\s*上下文：(.+?)\n\s*重要：/su, prompt_text) do
      [_, brief, context] ->
        [String.trim(brief), String.trim(context)]
        |> Enum.reject(&(&1 == ""))
        |> Enum.join("\n")

      _ ->
        extract_role_user_text(prompt_text)
    end
  end

  defp extract_creative_parts(prompt_text) do
    case Regex.run(~r/用户创作简述：(.+?)\n\s*上下文：(.+?)\n\s*重要：/su, prompt_text) do
      [_, brief, context] -> {String.trim(brief), String.trim(context)}
      _ -> {extract_role_user_text(prompt_text), ""}
    end
  end

  defp character_seed_prompt?(prompt_text),
    do: String.contains?(prompt_text, "artifact_type：character_seed")

  defp stub_creative_title(prompt_text, brief, fp) do
    if character_seed_prompt?(prompt_text) do
      "沈砚 " <> String.slice(fp, 0, 4)
    else
      case Regex.run(~r/第\d+章[：:]\s*([^。\n]+?)(?:正文草稿|$)/u, brief) do
        [_, chapter_title] -> String.trim(chapter_title) <> " 草稿"
        _ -> "离线待确认素材 " <> fp
      end
    end
  end

  defp stub_creative_body(prompt_text, brief, context) do
    if character_seed_prompt?(prompt_text) do
      stub_character_body(brief, context)
    else
      stub_prose_body(brief, context)
    end
  end

  defp stub_prose_body(brief, context) do
    nonce_text =
      context
      |> random_identifier_tokens()
      |> Enum.take(3)
      |> Enum.join("、")

    nonce_sentence = if nonce_text == "", do: "", else: "校验标识 #{nonce_text} 被刻在旧终端的边框上。"

    [
      "离线草稿从作者请求出发：#{String.slice(brief, 0, 80)}。",
      "主角站在灵气账单闪烁的巷口，意识到这次欠费不是普通催缴，而是有人借系统规则逼他现身。",
      nonce_sentence,
      "他收起最后一张护身符，沿着停电的楼梯向下走，准备在巡检车抵达前找到账单背后的漏洞。"
    ]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n")
  end

  defp stub_character_body(brief, context) do
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
      "定位：灵气交易所稽查官，负责追查灵气账单异常。",
      "动机：查清公司黑账，保护被规则压迫的底层修士。",
      "背景：出身账务区，左腕旧阵芯记录着一次未公开事故。",
      "关系：可与现有角色形成调查、互信或对抗关系，避免重名与设定冲突。",
      "弧光：从只相信账面证据，转向理解人的选择与牺牲。",
      "外貌：瘦削、深色旧制服、左腕阵芯微光。",
      "语言风格：短句、克制、审计式追问。",
      "能力体系绑定：读取灵气流水、识别伪造功法凭证、追踪阵纹残留。",
      nonce_line,
      "作品专属维度：可继续补足境界、功法、社会关系和关键弱点。请求摘要：#{String.slice(brief, 0, 80)}"
    ]
    |> Enum.join("\n")
  end

  defp stub_creative_rationale(prompt_text) do
    if character_seed_prompt?(prompt_text) do
      "离线 fixture provider 生成的角色主档案草稿，未写入作品事实。"
    else
      "离线 fixture provider 生成的待保存草稿，未写入作品事实。"
    end
  end

  defp random_identifier_tokens(text) do
    ~r/\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{6,}\b/u
    |> Regex.scan(text)
    |> Enum.map(fn [token] -> token end)
    |> Enum.uniq()
  end

  defp extract_role_user_text(prompt_text) do
    case Regex.run(~r/user:\s*(.+?)(?:\n[a-z_]+:|\z)/su, prompt_text) do
      [_, text] -> String.trim(text)
      _ -> prompt_text |> String.slice(-200, 200) |> String.trim()
    end
  end

  defp profile_route_author_text(prompt_text) do
    case Regex.run(~r/## 作者输入\s*(.*?)\s*## 可选 profile/su, prompt_text) do
      [_, text] -> String.trim(text)
      _ -> extract_role_user_text(prompt_text)
    end
  end

  defp matched_terms(text) do
    terms = [
      "角色阵容",
      "反派",
      "正文草稿",
      "写下一章",
      "续写",
      "章节大纲",
      "角色演化",
      "当前状态",
      "世界设定",
      "伏笔",
      "写作规则",
      "风格规则",
      "provider 进度",
      "流式进度",
      "只读批量"
    ]

    Enum.filter(terms, &String.contains?(text, &1))
  end

  defp contains_any?(text, terms), do: Enum.any?(terms, &String.contains?(text, &1))

  # ── prompt 归一化 ──

  defp prompt_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_text(prompt) when is_list(prompt) do
    prompt
    |> NovelAgent.Provider.normalize_messages()
    |> Enum.map_join("\n", fn message -> "#{message.role}: #{message.content}" end)
  end
end
