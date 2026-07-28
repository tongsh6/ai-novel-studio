defmodule NovelApplication.TurnExecutionService do
  @moduledoc """
  Application service for the tool execution portion of a v3 turn.

  DialogueGateway delegates approved tool execution here. The service constructs
  ToolRequest, invokes the agent toolbox, assembles tentative artifacts, records
  trace, and builds the final TurnResult.
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.AuthorizedToolExecutor
  alias NovelAgent.ProseQualityEvaluator
  alias NovelAgent.Provider.Execution
  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.CharacterRosterNarration
  alias NovelApplication.CreativeDecisionPacketBuilder
  alias NovelApplication.Planner
  alias NovelApplication.ProseExecutionBriefBuilder
  alias NovelApplication.ProseQualityService
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.QualityEvaluationRequest
  alias NovelCommon.Contracts.QualityEvaluationResult
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.ChapterPlanDirection
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.MissingPolicyResult
  alias NovelDomain.OmissionNote
  alias NovelDomain.OrchestratorDecision
  alias NovelDomain.ProseExecutionBrief
  alias NovelDomain.QualityFinding
  alias NovelDomain.ReaderEffectBrief
  alias NovelDomain.WritingCoordinate

  @creative_tools ~w(world_building character_design character_evolution plot_outline prose_writing)

  @type execution_input :: %{
          required(:frame) => DialogueFrame.t(),
          required(:plan) => MicroPlan.t(),
          required(:decision) => OrchestratorDecision.t(),
          optional(:candidates) => list(),
          optional(:context) => term(),
          optional(:author_input) => map(),
          optional(:provider_execution) => Execution.dependency(),
          optional(:quality_provider_execution) => Execution.dependency(),
          optional(:chapter_prose_reader) => function(),
          optional(:chapter_summary_reader) => map() | nil,
          optional(:character_reader) => function() | nil,
          optional(:assumption_reader) => function() | nil,
          optional(:ledger_reader) => function() | nil,
          optional(:memory_reader) => function() | nil,
          optional(:source_turn_ref) => String.t(),
          optional(:idempotency_suffix) => String.t()
        }

  @spec execute(execution_input()) :: {map(), NovelDomain.DecisionTrace.t()}
  def execute(%{frame: frame, plan: plan, decision: decision} = input) do
    action = hd(plan.proposed_actions)

    # AI 只识别意图与候选目标章；目标章由应用层用作品现有章节列表确定性解析（LLM 对结构化
    # target_chapter 不可靠），并把解析结果同时用于"读前文"和"采纳归章"，二者保持一致。
    resolved_chapter =
      resolve_target_chapter(
        action,
        input[:context],
        input[:chapter_prose_reader],
        frame.workspace_id,
        author_input_text(frame, input[:author_input])
      )

    # CP0：固化写作坐标并评估缺失策略。hard missing（作者点名但 planner 匹配不到的章）→ 不调 provider。
    coordinate = build_coordinate(frame, action, input)
    missing = MissingPolicyResult.evaluate(coordinate)
    emit_coordinate(frame, coordinate, missing)

    if MissingPolicyResult.block?(missing) do
      blocked_result(frame, input, coordinate, missing)
    else
      do_execute(frame, plan, decision, input, action, resolved_chapter)
    end
  end

  defp do_execute(frame, plan, decision, input, action, resolved_chapter) do
    summary_reader = input[:chapter_summary_reader]

    prior_prose_full =
      continuation_prior_prose(frame, action, resolved_chapter, input[:chapter_prose_reader])

    # CP1：前文 excerpt 预算由本上下文的组装策略给出（按 provider 档位），超预算尾部裁剪
    # 并产生 OmissionNote + 发 context.downgrade.done 业务日志；裁剪不再用写死的常量。
    # CP2.2（G3）：裁剪时以本章已采纳摘要兜底——replacement=chapter_summary:章 + excerpt
    # 前置「更早正文摘要」，让被省略的更早正文以摘要替代而非凭空消失；无摘要才回落 nil。
    {prior_prose, omission_notes} =
      budget_prior_prose(
        frame,
        resolved_chapter,
        prior_prose_full,
        DialogueContext.policy(input[:context]),
        read_chapter_summary(summary_reader, frame.workspace_id, resolved_chapter)
      )

    # CP2.2（G5）：写作轮注入目标章之前的实现态摘要窗口，让模型知道前面已写了什么。
    prior_summaries =
      prior_chapter_summaries_section(
        frame,
        action,
        resolved_chapter,
        input[:context],
        summary_reader
      )

    # I-c（AU09 角色主档案）：从 Character 主档案注入"现有角色"，让 AI 写作保持一致、
    # 设计新角色时看得见现有阵容（停角色 memory 后不回退角色感知）。
    character_roster =
      existing_characters_section(frame, action, input[:character_reader])

    characters =
      read_character_roster(frame, action, input[:character_reader])

    # VS-00F CP1（ADR-0026）：progress_state_packet 账面投影（VS-00C §3.0 既有槽）。
    # 仅 prose_writing 注入弧光账相关条目；无账面数据时诚实缺席（06 §5.0，不伪造）。
    progress_state =
      progress_state_section(frame, action, input[:ledger_reader])

    # CA02（VS-00C §3.1 L3b/L4 最小形态）：确认记忆机械分组注入写作——事实段
    # （伏笔/规则/状态/关系）+ 风格段（STYLE_RULE/AUTHOR_PREFERENCE）。与关键词
    # recall 通道并存；无确认记忆时诚实缺席。
    %{facts: creative_facts, style: style_guide} =
      creative_memory_sections(frame, action, input[:context], input[:memory_reader])

    # VS-00G CP1：承重事实完备性判定（机械准备，0 调用，ADR-0025）。按能力 manifest
    # 对现状快照逐项查缺，required 缺席且有守则→注入缺席守则（防主角真空被模型想象填补，
    # M3 地基事实真空病例的直接下药）；design_missing 留痕供负债规则消费（CP2）。
    # VS-00G CP5c：激活中的工作假定计入在场判定（缺席守则让位），并以【暂定】标注段
    # 注入——注入期临时文本，随 turn 消失不落持久层（§2.3 三防护①）。
    absence_directives =
      absence_directives_section(
        frame,
        action,
        input[:character_reader],
        input[:assumption_reader]
      )

    # VS-00G CP3：规划期全书骨架注入 + 收官守则（仅 plot_outline）。直接对着 M3 收官
    # 循环下药——扩章批不再自带终局章（骨架事实+当前进度+指令式禁终局，决策点邻近）。
    # 无 target_length（骨架未立）时空段（R6 负债规则催办，不在此伪造骨架）。
    work_skeleton = work_skeleton_section(action, input[:context])

    maybe_emit_target_word_count(frame, action)

    # VS-00E CP1：把章级方向展开为场级执行简述，渲染进 provider 请求并记入 trace。
    # 仅 prose_writing 路径生成；缺结构化章方向时降级（不伪造场级因果）。brief 是设计态、
    # 非作品事实。
    brief_result =
      prose_execution_brief(
        frame,
        action,
        input[:context],
        resolved_chapter,
        author_input_text(frame, input[:author_input])
      )

    emit_execution_brief(frame, brief_result)

    req =
      build_tool_request(
        frame,
        plan,
        decision,
        input,
        action,
        %{
          resolved_chapter: resolved_chapter,
          prior_prose: prior_prose,
          prior_summaries: prior_summaries,
          character_roster: character_roster,
          characters: characters,
          execution_brief: render_execution_brief(brief_result),
          decision_packet: decision_packet(brief_result),
          progress_state: progress_state,
          creative_facts: creative_facts,
          style_guide: style_guide,
          absence_directives: absence_directives,
          work_skeleton: work_skeleton
        }
      )

    provider_execution = provider_execution(input)
    quality_provider_execution = quality_provider_execution(input)

    tool_result = dispatch_tool(req, provider_execution)
    artifact_set = assemble_artifact(tool_result, frame.turn_id, plan, resolved_chapter)

    # VS-00E CP2：正文生成后运行独立质量评估（与 writer 逻辑分离），产出 QualityFinding +
    # 策略。只读，不改 artifact / 作品事实；evaluator 失败诚实降级为 quality_review_unavailable。
    quality =
      run_prose_quality(
        frame,
        action,
        tool_result,
        quality_provider_execution,
        render_execution_brief(brief_result),
        facts_context_text(creative_facts, style_guide),
        quality_pacing_context(brief_result)
      )

    {trace, trace_summary} =
      TraceWriter.record_with_tool(
        frame,
        plan,
        decision,
        req,
        tool_result,
        %{
          turn_id: frame.turn_id,
          omission_notes: omission_notes,
          brief_ref: execution_brief_ref(brief_result),
          decision_packet_ref: decision_packet_ref(brief_result),
          writer_provider_call_ref: writer_provider_call_ref(tool_result),
          evaluator_provider_call_ref: evaluator_provider_call_ref(quality),
          provider_call_budget:
            provider_call_budget(provider_execution, quality_provider_execution, nil),
          quality_policy_action: quality_policy_action(quality),
          quality_review_status: quality_review_status(quality)
        },
        input[:context]
      )

    assistant_message = narrate(tool_result, artifact_set, provider_execution)

    turn_result =
      TurnResultBuilder.build(
        frame,
        trace_summary,
        input[:candidates] || [],
        decision,
        tool_result,
        artifact_set
      )
      |> Map.put(:assistant_message, %{text: assistant_message})
      |> maybe_put_quality_review(quality)

    {turn_result, trace}
  end

  # ── CP0: WritingCoordinate + MissingPolicyResult ──

  # requested_chapter = 作者点名原文（planner requested_chapter_raw）；
  # matched_chapter = planner 精确匹配到列表的章（planner target_chapter，回退前）。
  # 二者据此判定"点名了找不到的章"，不受 resolve_target_chapter 的回退掩盖。
  defp build_coordinate(frame, action, input) do
    WritingCoordinate.derive(%{
      capability: action[:target_ref] || action[:capability_name],
      authoring_intent: action[:authoring_intent],
      requested_chapter: action[:requested_chapter_raw],
      matched_chapter: action[:target_chapter],
      work_ref: frame.workspace_id,
      source_turn_ref: input[:source_turn_ref]
    })
  end

  # 坐标与缺失决策 observability（ADR-0018），让外部验收能证明本轮坐标与缺失处理。
  defp emit_coordinate(frame, %WritingCoordinate{} = coordinate, %MissingPolicyResult{} = missing) do
    LogEmit.emit(:turn_execution, :writing_coordinate, :done, %{
      turn_id: frame.turn_id,
      authoring_mode: to_string(coordinate.authoring_mode),
      requested_chapter: coordinate.requested_chapter,
      matched_chapter: coordinate.matched_chapter,
      missing_severity: to_string(missing.severity)
    })
  end

  # hard missing 短路：不调用 provider，产出可解释 conversational TurnResult；trace 记 reply-only。
  defp blocked_result(
         frame,
         input,
         %WritingCoordinate{} = coordinate,
         %MissingPolicyResult{} = missing
       ) do
    LogEmit.emit(:turn_execution, :missing_policy, :done, %{
      turn_id: frame.turn_id,
      severity: to_string(missing.severity),
      missing: inspect(missing.missing)
    })

    {trace, trace_summary} = TraceWriter.record(frame, %{turn_id: frame.turn_id}, input[:context])

    turn_result =
      TurnResultBuilder.build(frame, trace_summary, input[:candidates] || [], nil, nil, nil)
      |> Map.put(:assistant_message, %{text: blocked_message(coordinate)})

    {turn_result, trace}
  end

  defp blocked_message(%WritingCoordinate{requested_chapter: chapter})
       when is_binary(chapter) and chapter != "" do
    "没有找到《#{chapter}》这一章。当前作品里还没有这一章，无法续写或重写它——" <>
      "你可以先创建该章的计划，或确认要写的是哪一章。"
  end

  defp blocked_message(_coordinate),
    do: "没有找到要续写或重写的目标章节，无法继续。请确认要写哪一章。"

  defp build_tool_request(
         frame,
         plan,
         decision,
         input,
         action,
         sections
       ) do
    tool_name = action[:target_ref] || action[:capability_name] || "text_analysis"
    entry = CapabilityRegistry.get(tool_name)

    %ToolRequest{
      tool_request_id: NovelFoundation.ID.unique("tq"),
      turn_id: frame.turn_id,
      frame_ref: frame.frame_id,
      plan_ref: plan.plan_id,
      decision_ref: decision.decision_id,
      tool_name: tool_name,
      tool_version: (entry && entry.tool_version) || "unknown",
      input:
        tool_input(
          frame,
          action,
          input[:author_input],
          input[:context],
          sections
        ),
      read_scope_grants: (entry && entry.read_scopes) || [],
      write_scope_grants: [],
      idempotency_key: "idem_#{frame.turn_id}_#{tool_name}#{input[:idempotency_suffix] || ""}",
      trace_policy: %{level: "standard"},
      created_at: DateTime.utc_now()
    }
  end

  defp tool_input(
         frame,
         action,
         author_input,
         context,
         sections
       ) do
    text = author_input_text(frame, author_input)
    author_goal_text = author_goal_text(author_input)

    # 顺序：目标章结构对象（L2 设计态）→ 现有角色主档案（作品级阵容）→ 前文各章摘要
    # （L3a 跨章实现态）→ 本章已采纳正文（L5 衔接）→ 确认记忆事实（L3b）→ 风格偏好
    # （L4 最小形态）→ 当前作者输入。
    context_text =
      [
        target_structure_section(frame, action, context, sections.resolved_chapter),
        sections.character_roster,
        sections.prior_summaries,
        prior_prose_section(action, sections.prior_prose),
        sections.creative_facts,
        sections.style_guide,
        sections.work_skeleton,
        sections.absence_directives,
        tool_context_text(context, text)
      ]
      |> Enum.reject(&blank?/1)
      |> Enum.join("\n\n")

    %{
      "text" => text,
      "creative_brief" =>
        [action_summary(action), word_count_brief(action), text]
        |> Enum.reject(&blank?/1)
        |> Enum.join("\n"),
      "context_text" => context_text
    }
    |> maybe_put_author_goal_text(author_goal_text)
    |> maybe_put_characters(action, sections.characters)
    |> maybe_put_execution_brief(sections)
    |> maybe_put_decision_packet(sections)
    |> maybe_put_progress_state(sections)
  end

  defp maybe_put_author_goal_text(input, text) when is_binary(text) and text != "",
    do: Map.put(input, "author_goal_text", text)

  defp maybe_put_author_goal_text(input, _text), do: input

  # VS-00E：把已渲染的场级执行简述文本放入工具输入，由 CreativeToolAdapter 透传给
  # provider（仅 prose_writing 路径非空）。
  defp maybe_put_execution_brief(input, %{execution_brief: text})
       when is_binary(text) and text != "" do
    Map.put(input, "execution_brief", text)
  end

  defp maybe_put_execution_brief(input, _sections), do: input

  # VS-00F CP1：账面投影文本放入工具输入（progress_state_packet 的传输载体，
  # 与 execution_brief 同型走 tool_input 独立字段，不进 context_text 不碰 stub 锚点）。
  defp maybe_put_progress_state(input, %{progress_state: text})
       when is_binary(text) and text != "" do
    Map.put(input, "progress_state", text)
  end

  defp maybe_put_progress_state(input, _sections), do: input

  defp maybe_put_decision_packet(input, %{decision_packet: packet}) when is_map(packet) do
    Map.put(input, "decision_packet", packet)
  end

  defp maybe_put_decision_packet(input, _sections), do: input

  defp maybe_put_characters(input, action, characters) do
    if (action[:target_ref] || action[:capability_name]) == "character_roster" do
      Map.put(input, "characters", characters)
    else
      input
    end
  end

  # 作者明确篇幅诉求时，把目标字数并入创作简述（走 brief 通道：brief 本就被创作
  # provider 与 stub/slice_verify 的三锚点正则捕获，无需在 prompt 另加行、也不破坏锚点）。
  defp word_count_brief(action) do
    case action[:target_word_count] do
      n when is_integer(n) and n > 0 -> "目标字数：约 #{n} 字"
      _ -> ""
    end
  end

  # 作者篇幅诉求 observability（ADR-0018）：作者明确目标字数时记一条业务日志，
  # 让外部审计/验收能证明该诉求确实进入执行链（与 continuation_context 对称）。
  defp maybe_emit_target_word_count(frame, action) do
    case action[:target_word_count] do
      n when is_integer(n) and n > 0 ->
        LogEmit.emit(:turn_execution, :target_word_count, :done, %{
          turn_id: frame.turn_id,
          target_word_count: n
        })

      _ ->
        :ok
    end
  end

  # 解析本次正文归属的章（确定性，不依赖 LLM 结构化输出可靠性）：
  # - target_chapter 精确命中作品现有章（计划章或已写章）→ 归到该章
  #   （写第X章首稿 / 续写 / 重写都走这里，章身份由作品结构定，不由模型自创标题定）。
  # - planner 漏给 target_chapter，但真实作者输入点名了现有章标题/章号 → 归到该章
  #   （外部 UI 的"生成正文草稿"会把可见章名写进作者输入，应用层不能只依赖 LLM 补字段）。
  # - 续写/重写但漏给或没命中目标章 → 回退到"最近一个已写正文的章"（"接着往下写"默认续最新已写章）。
  #   注意：current_chapters 现含计划待写章，不能简单取 List.last（会落到末尾的计划空章）。
  # - 其它（写全新章、不针对具体章）→ ""（不归章，由创作内容自身标题命名）。
  # AI 只识别意图与候选目标章；安全解析在应用层用 DialogueContext.current_chapters 完成。
  defp resolve_target_chapter(action, context, reader, work_id, author_text) do
    chapters = accepted_chapter_titles(context)
    target = normalize_target_chapter(action[:target_chapter])
    intent = action[:authoring_intent]
    mentioned = mentioned_chapter_title(author_text, chapters)

    cond do
      target != "" and target in chapters ->
        target

      mentioned != "" ->
        mentioned

      intent in [:continuation, :rewrite] ->
        latest_written_chapter(chapters, reader, work_id) || target

      true ->
        ""
    end
  end

  # 按计划顺序从后往前找第一个已有已采纳正文的章（无 reader 或都没正文 → nil）。
  defp latest_written_chapter(chapters, reader, work_id)
       when is_function(reader, 2) and is_binary(work_id) do
    chapters
    |> Enum.reverse()
    |> Enum.find(fn title -> safe_read_prose(reader, work_id, title) != "" end)
  end

  defp latest_written_chapter(_chapters, _reader, _work_id), do: nil

  defp normalize_target_chapter(target) when is_binary(target), do: String.trim(target)
  defp normalize_target_chapter(_target), do: ""

  defp author_input_text(frame, author_input) do
    case author_input do
      %{text: text} when is_binary(text) -> text
      %{"text" => text} when is_binary(text) -> text
      _ -> frame.author_visible_draft.message
    end
  end

  defp author_goal_text(author_input) do
    case author_input do
      %{author_goal_text: text} when is_binary(text) -> String.trim(text)
      %{"author_goal_text" => text} when is_binary(text) -> String.trim(text)
      _ -> ""
    end
  end

  defp mentioned_chapter_title(text, chapters) when is_binary(text) and is_list(chapters) do
    Enum.find(chapters, &(is_binary(&1) and String.contains?(text, &1))) ||
      mentioned_chapter_by_number(text, chapters) ||
      ""
  end

  defp mentioned_chapter_title(_text, _chapters), do: ""

  defp mentioned_chapter_by_number(text, chapters) do
    case Regex.run(~r/第\s*(\d+)\s*章/u, text) do
      [_, n] ->
        number = String.to_integer(n)
        Enum.find(chapters, &(chapter_number(&1) == number))

      _ ->
        nil
    end
  end

  defp chapter_number(title) when is_binary(title) do
    case Regex.run(~r/第\s*(\d+)\s*章/u, title) do
      [_, n] -> String.to_integer(n)
      _ -> nil
    end
  end

  defp chapter_number(_title), do: nil

  defp accepted_chapter_titles(%NovelDomain.DialogueContext{current_chapters: chapters})
       when is_list(chapters),
       do: chapters

  defp accepted_chapter_titles(_context), do: []

  # 只有续写/重写才把目标章已采纳正文喂给 prose_writing 衔接前文（28「基于前文」）。
  # 写计划章首稿（intent=none 但归到某章）不注入前文：该章本就还没有正文。
  # 同时记一条业务日志（observability，ADR-0018），让外部验收能证明前文确实进入续写上下文。
  defp continuation_prior_prose(frame, action, resolved_chapter, reader)
       when is_function(reader, 2) and is_binary(resolved_chapter) and resolved_chapter != "" do
    if action[:authoring_intent] in [:continuation, :rewrite] do
      prose = safe_read_prose(reader, frame.workspace_id, resolved_chapter)

      if prose != "" do
        LogEmit.emit(:turn_execution, :continuation_context, :done, %{
          turn_id: frame.turn_id,
          authoring_intent: to_string(action[:authoring_intent]),
          target_chapter: resolved_chapter,
          prior_prose_chars: String.length(prose)
        })
      end

      prose
    else
      ""
    end
  end

  defp continuation_prior_prose(_frame, _action, _resolved_chapter, _reader), do: ""

  defp safe_read_prose(reader, work_id, chapter) when is_binary(work_id) do
    case reader.(work_id, chapter) do
      prose when is_binary(prose) -> prose
      _ -> ""
    end
  end

  defp safe_read_prose(_reader, _work_id, _chapter), do: ""

  # CP1：按组装策略给的 excerpt 预算裁剪前文（续写「衔接」只需最近文脉；不裁剪则章越写
  # 越长后，prompt 会超出小上下文窗口模型的 n_ctx——实测 LM Studio n_ctx=4096 时 ~1000 字章
  # 续写被 HTTP 400 拒绝）。预算随 provider 档位（地板档 2000、大窗口放开），不再写死常量。
  # 裁剪时产生 OmissionNote（reason=:budget_limited，CP1 暂无 summary 替代，replacement=nil）
  # 并发 context.downgrade.done 业务日志（`domain/26` §25 / ADR-0018），让省略可解释、可外部验证。
  @spec budget_prior_prose(
          DialogueFrame.t(),
          String.t(),
          String.t(),
          NovelDomain.AssemblyPolicy.t(),
          String.t() | nil
        ) ::
          {String.t(), [OmissionNote.t()]}
  defp budget_prior_prose(_frame, _chapter, "", _policy, _summary), do: {"", []}

  defp budget_prior_prose(frame, chapter, prose, policy, summary) do
    max = policy.excerpt_budget_chars

    if String.length(prose) <= max do
      {prose, []}
    else
      tail = String.slice(prose, String.length(prose) - max, max)
      {preamble, replacement} = omitted_prose_preamble(summary, chapter)
      excerpt = preamble <> "\n…" <> tail

      note =
        OmissionNote.new("prior_prose:#{chapter_label(chapter)}", :budget_limited, replacement)

      LogEmit.emit(:context, :downgrade, :done, %{
        turn_id: frame.turn_id,
        source: note.source,
        reason: to_string(note.reason),
        replacement: replacement,
        assembly_policy_id: policy.policy_id,
        excerpt_budget_chars: max,
        original_chars: String.length(prose)
      })

      {excerpt, [note]}
    end
  end

  # CP2.2（G3）：有本章摘要则以摘要替代被省略的更早正文（replacement=chapter_summary:章）；
  # 无摘要才回落 CP1 行为（replacement=nil，凭空消失仅有省略记录）。
  defp omitted_prose_preamble(summary, chapter) when is_binary(summary) and summary != "" do
    {"（本章更早的正文已省略，以下是其摘要与最近的部分）\n更早正文摘要：#{summary}", "chapter_summary:#{chapter_label(chapter)}"}
  end

  defp omitted_prose_preamble(_summary, _chapter) do
    {"（本章更早的正文已省略，以下是最近的部分）", nil}
  end

  defp chapter_label(chapter) when is_binary(chapter) and chapter != "", do: chapter
  defp chapter_label(_), do: "本章"

  # CP2.2（G3）：读本章当前已采纳摘要，作为裁剪前文的替代物。
  defp read_chapter_summary(%{by_title: by_title}, work_id, chapter)
       when is_function(by_title, 2) and is_binary(work_id) and is_binary(chapter) and
              chapter != "" do
    case by_title.(work_id, chapter) do
      text when is_binary(text) and text != "" -> text
      _ -> nil
    end
  end

  defp read_chapter_summary(_reader, _work_id, _chapter), do: nil

  # CP2.2（G5）：prose_writing 轮按 AssemblyPolicy.summary_window 注入目标章之前
  # 最近 N 章摘要，让模型知道前面已写了什么；记 context.continuity.done（source_type=continuity）。
  defp prior_chapter_summaries_section(
         frame,
         action,
         resolved_chapter,
         context,
         %{previous: previous}
       )
       when is_function(previous, 3) do
    policy = DialogueContext.policy(context)

    cond do
      prose_writing_action?(action) ->
        previous.(frame.workspace_id, resolved_chapter, policy.summary_window)
        |> Enum.reject(&(&1.chapter_title == resolved_chapter))
        |> build_summaries_section(frame, policy)

      # CA01（Order 7 刀二·②）：规划带最近章摘要窗——扩章计划必须承接实际前情
      # （M2 扩章批失忆的根）。target 传空串=取末 N 章（章表无空标题，take_while
      # 不命中即全量再取尾窗，语义确定）。
      plot_outline_action?(action) ->
        previous.(frame.workspace_id, "", policy.summary_window)
        |> build_summaries_section(frame, policy)

      true ->
        ""
    end
  end

  defp prior_chapter_summaries_section(_frame, _action, _resolved_chapter, _context, _reader),
    do: ""

  defp build_summaries_section([], _frame, _policy), do: ""

  defp build_summaries_section(summaries, frame, policy) do
    LogEmit.emit(:context, :continuity, :done, %{
      turn_id: frame.turn_id,
      source_type: "continuity",
      chapter_count: length(summaries),
      summary_window: policy.summary_window,
      assembly_policy_id: policy.policy_id
    })

    body =
      Enum.map_join(summaries, "\n\n", fn s -> "### #{s.chapter_title}\n#{s.summary_text}" end)

    "## 前文各章摘要（用于跨章连续性，不要照抄）\n" <> body
  end

  defp prose_writing_action?(action) do
    (action[:target_ref] || action[:capability_name]) == "prose_writing"
  end

  # VS-00F CP1：弧光账投影渲染（机械，不代笔）。STALLED 优先、按最近出场倒序，
  # 上限 6 条控预算；无 reader/无账面数据返回空串（诚实缺席，不伪造账本存在）。
  @progress_state_max_entries 6

  # VS-00F 账面投影（progress_state_packet 传输载体）：文案按 action 在此渲染
  # 完成，provider 侧只做原样嵌入。prose=出场角色弧光+反泄漏约束（Q2/Q3 修向）；
  # plot_outline=五账规划摘要+延续性要求（CP4a：治增量规划与前文脱节的根）。
  defp progress_state_section(frame, action, reader) when is_function(reader, 1) do
    section =
      cond do
        prose_writing_action?(action) ->
          frame.workspace_id |> reader.() |> prose_progress_text()

        plot_outline_action?(action) ->
          frame.workspace_id |> reader.() |> planning_ledger_digest()

        true ->
          ""
      end

    # ADR-0018 观测性：账面投影进入创作请求的事实（外部验收与运维据此归因；
    # 空账面不发——诚实缺席不制造噪声）。
    if section != "" do
      LogEmit.emit(:context, :progress_state, :done, %{
        turn_id: frame.turn_id,
        entry_count: section |> String.split("\n") |> length()
      })
    end

    section
  end

  defp progress_state_section(_frame, _action, _reader), do: ""

  # CA02（VS-00C §3.1 L3b/L4 最小形态）：确认记忆机械分组注入。仅 prose_writing；
  # memory_reader 未注入或无确认记忆时诚实缺席（06 §5.0）。每组按策略
  # facts_group_limit 截断（组内已按更新时间倒序），标题字串避开 stub/slice_verify
  # 内容级锚点（现有角色/作品章节/已采纳章节/目标情绪/已采纳正文）。
  defp creative_memory_sections(frame, action, context, memory_reader) do
    if prose_writing_action?(action) and is_function(memory_reader, 1) do
      facts = memory_reader.(frame.workspace_id)
      limit = DialogueContext.policy(context).facts_group_limit

      sections = %{
        facts: render_creative_facts(facts, limit),
        style: render_style_guide(Map.get(facts, :style, []), limit)
      }

      # ADR-0018 观测性：事实/风格段进入创作请求的事实；空段不发（诚实缺席不制造噪声）。
      if sections.facts != "" or sections.style != "" do
        LogEmit.emit(:context, :creative_facts, :done, %{
          turn_id: frame.turn_id,
          fact_lines: count_bullet_lines(sections.facts),
          style_lines: count_bullet_lines(sections.style)
        })
      end

      sections
    else
      %{facts: "", style: ""}
    end
  end

  @creative_fact_groups [
    {:foreshadowing, "伏笔与情节事实"},
    {:world_rules, "世界规则与约束"},
    {:current_states, "人物当前状态"},
    {:relationships, "人物关系"}
  ]

  defp render_creative_facts(facts, limit) do
    blocks =
      Enum.flat_map(@creative_fact_groups, fn {key, label} ->
        case facts |> Map.get(key, []) |> Enum.take(limit) do
          [] -> []
          items -> ["#{label}：\n" <> Enum.map_join(items, "\n", &fact_line/1)]
        end
      end)

    case blocks do
      [] -> ""
      blocks -> "## 作品事实（作者已确认，写作必须保持一致）\n" <> Enum.join(blocks, "\n")
    end
  end

  defp render_style_guide(style_items, limit) do
    case Enum.take(style_items, limit) do
      [] ->
        ""

      items ->
        "## 写作风格与作者偏好（作者已确认，写作遵循）\n" <>
          Enum.map_join(items, "\n", &fact_line/1)
    end
  end

  # 条目行：summary 为压缩主句，content 兜底并裁剪（记忆正文可能很长，事实段是
  # 提示不是档案，细节经探索面按需取）。
  @fact_content_clip 200

  defp fact_line(item) do
    summary = trimmed(Map.get(item, :summary))
    content = clip_chars(trimmed(Map.get(item, :content)), @fact_content_clip)

    cond do
      summary != "" and content != "" and summary != content -> "- #{summary}：#{content}"
      summary != "" -> "- #{summary}"
      true -> "- #{content}"
    end
  end

  defp trimmed(nil), do: ""
  defp trimmed(value) when is_binary(value), do: String.trim(value)

  defp clip_chars(text, max) do
    if String.length(text) > max, do: String.slice(text, 0, max) <> "……", else: text
  end

  defp count_bullet_lines(text) do
    text |> String.split("\n") |> Enum.count(&String.starts_with?(&1, "- "))
  end

  # evaluator 事实基线（31 §6.12 🟡 门补输入）：与 writer 同源的事实+风格文本。
  defp facts_context_text(facts, style) do
    case [facts, style] |> Enum.reject(&blank?/1) |> Enum.join("\n\n") do
      "" -> nil
      text -> text
    end
  end

  defp plot_outline_action?(action) do
    (action[:target_ref] || action[:capability_name]) == "plot_outline"
  end

  # VS-00G CP3：规划期全书骨架段+收官守则（仅 plot_outline）。已写章数用当前章列表长度
  # 近似（含计划章，作规模信号）；无 target_length 时空段（诚实缺席，R6 负债催办）。
  defp work_skeleton_section(action, context) do
    if plot_outline_action?(action) do
      snapshot = work_skeleton_snapshot(context)
      written = work_skeleton_written_count(context)
      NovelDomain.WorkSkeleton.render(snapshot, written)
    else
      ""
    end
  end

  defp work_skeleton_snapshot(%DialogueContext{current_work_snapshot: snapshot})
       when is_map(snapshot),
       do: snapshot

  defp work_skeleton_snapshot(_context), do: %{}

  defp work_skeleton_written_count(%DialogueContext{current_chapters: chapters})
       when is_list(chapters),
       do: length(chapters)

  defp work_skeleton_written_count(_context), do: 0

  @doc false
  def prose_progress_text(entries) do
    lines =
      entries
      |> Enum.filter(&(&1.ledger == "arc"))
      |> Enum.sort_by(&progress_entry_rank/1)
      |> Enum.take(@progress_state_max_entries)
      |> Enum.map_join("\n", &progress_entry_line/1)

    if lines == "" do
      ""
    else
      "作品脉络（相关角色近期弧光，供保持人物连续性参考）：\n#{lines}\n" <>
        "注意：本段仅为背景参照。不得在正文中引用本段的状态词、编号或章号；角色是否出场由情节需要决定。"
    end
  end

  # CP4a：规划消费账面——弧光/主线/承诺/情绪的机械摘要 + 延续性要求。
  @doc false
  def planning_ledger_digest([]), do: ""

  @doc false
  def planning_ledger_digest(entries) do
    lines =
      arc_digest_lines(entries) ++
        conflict_digest_lines(entries) ++
        promise_digest_lines(entries) ++ emotion_digest_lines(entries)

    if lines == [] do
      ""
    else
      "作品脉络摘要（规划参照）：\n#{Enum.join(lines, "\n")}\n" <>
        "规划要求：延续上述未完成弧光与主线，停滞角色需给出回归或明确退场安排；" <>
        "除非作者明示转向，不引入取代现有主角团的新主导角色，保持类型承诺的题材元素在场。"
    end
  end

  defp arc_digest_lines(entries) do
    arc = Enum.filter(entries, &(&1.ledger == "arc"))
    stalled = arc |> Enum.filter(&(&1.status == "STALLED")) |> Enum.map(& &1.subject_label)
    on_track = arc |> Enum.filter(&(&1.status == "ON_TRACK")) |> Enum.map(& &1.subject_label)

    Enum.reject(
      [
        if(stalled != [], do: "- 弧光停滞待处理：#{Enum.join(stalled, "、")}"),
        if(on_track != [], do: "- 弧光推进中：#{Enum.join(on_track, "、")}")
      ],
      &is_nil/1
    )
  end

  defp conflict_digest_lines(entries) do
    case Enum.find(entries, &(&1.ledger == "conflict" and &1.subject_ref == "main")) do
      nil ->
        []

      main ->
        seq = Map.get(main.payload || %{}, "last_advanced_seq") || "?"
        ["- 主线：#{main.status}，最近推进第#{seq}章"]
    end
  end

  defp promise_digest_lines(entries) do
    case Enum.find(entries, &(&1.ledger == "promise" and &1.subject_ref == "genre")) do
      nil -> []
      promise -> ["- #{promise.subject_label}：#{promise.status}"]
    end
  end

  defp emotion_digest_lines(entries) do
    case Enum.filter(entries, &(&1.ledger == "emotion_curve")) do
      [] ->
        []

      emotion ->
        counts = Enum.frequencies_by(emotion, & &1.status)

        [
          "- 情绪曲线：符合#{counts["MATCHED"] || 0}/偏差#{counts["DEVIATED"] || 0}/无设计#{counts["UNPLANNED"] || 0}"
        ]
    end
  end

  defp progress_entry_rank(entry) do
    stalled_rank = if entry.status == "STALLED", do: 0, else: 1
    seq = Map.get(entry.payload || %{}, "last_seen_seq") || 0
    {stalled_rank, -seq}
  end

  defp progress_entry_line(entry) do
    seen = Map.get(entry.payload || %{}, "last_seen_seq")
    seen_text = if is_integer(seen), do: "最近出场第#{seen}章", else: "尚无出场记录"
    "- #{entry.subject_label}：#{status_label(entry.status)}，#{seen_text}"
  end

  defp status_label("ON_TRACK"), do: "弧光推进中"
  defp status_label("STALLED"), do: "已多章未出场"
  defp status_label("DRIFTED"), do: "已确认偏离设计"
  defp status_label("RESUMED"), do: "裁决后回归"
  defp status_label("COMPLETED"), do: "弧光已完成"
  defp status_label("RETIRED"), do: "已退场"
  defp status_label(other), do: other

  # I-c（AU09 角色主档案）：从 Character 主档案读现有角色，注入创作/角色设计上下文。
  # 仅对会用到角色的能力注入：character_design（设计新角色看现有阵容）、prose_writing（写作保持一致）。
  defp existing_characters_section(frame, action, reader) when is_function(reader, 1) do
    if character_context_action?(action) do
      frame.workspace_id
      |> reader.()
      |> build_characters_section(frame)
    else
      ""
    end
  end

  defp existing_characters_section(_frame, _action, _reader), do: ""

  # VS-00G CP1：承重事实完备性判定 + 缺席守则注入（机械准备）。按能力 manifest 对
  # 现状快照逐项查缺；required 缺席且有守则 → 注入缺席守则文本。design_missing 留痕
  # 供负债规则消费（CP2）。仅对 manifest 登记的能力生效（未登记能力空段）。
  defp absence_directives_section(frame, action, reader, assumption_reader) do
    capability = to_string(action[:target_ref] || action[:capability_name] || "")

    case NovelDomain.CapabilityFactManifest.facts(capability) do
      [] ->
        ""

      _facts ->
        assumptions = active_assumption_characters(frame, assumption_reader)
        snapshot = %{roster: fact_completeness_roster(frame, reader) ++ assumptions}
        missing = NovelDomain.CapabilityFactManifest.evaluate_presence(capability, snapshot)
        emit_fact_completeness(frame, capability, missing, length(assumptions))
        NovelDomain.AbsenceDirective.render(missing) <> assumption_section(assumptions)
    end
  end

  # CP5c：激活假定读取（失败降级空列表——注入通道诚实缺席，不阻断创作调用）。
  defp active_assumption_characters(frame, reader) when is_function(reader, 1) do
    frame.workspace_id
    |> reader.()
    |> Enum.filter(&NovelDomain.WorkingAssumption.active?/1)
    |> Enum.map(fn character ->
      %{
        name: Map.get(character, :name),
        narrative_role: Map.get(character, :narrative_role),
        summary: Map.get(character, :summary)
      }
    end)
  rescue
    _error -> []
  catch
    _kind, _reason -> []
  end

  defp active_assumption_characters(_frame, _reader), do: []

  # CP5c 防护①：【暂定】标注段——模型可参考但明知未确认；作者侧同文案有裁决入口。
  defp assumption_section([]), do: ""

  defp assumption_section(assumptions) do
    lines =
      Enum.map_join(assumptions, "\n", fn assumption ->
        role_label =
          case assumption.narrative_role do
            "PROTAGONIST" -> "主角"
            _ -> "角色"
          end

        content =
          [
            "#{role_label}：#{assumption.name}",
            case to_string(assumption.summary || "") do
              "" -> nil
              summary -> summary
            end
          ]
          |> Enum.reject(&is_nil/1)
          |> Enum.join("——")

        "- " <> NovelDomain.WorkingAssumption.annotate(content, "设定盘点")
      end)

    "\n\n暂定设定（作者尚未确认，按此暂用，不得当作已定案设定展开重大转折）：\n" <> lines
  end

  defp fact_completeness_roster(frame, reader) when is_function(reader, 1) do
    frame.workspace_id |> reader.() |> normalize_character_list()
  end

  defp fact_completeness_roster(_frame, _reader), do: []

  defp emit_fact_completeness(_frame, _capability, [], 0), do: :ok

  defp emit_fact_completeness(frame, capability, missing, assumption_count) do
    LogEmit.emit(:context, :fact_completeness, :done, %{
      turn_id: frame.turn_id,
      capability: capability,
      design_missing: Enum.map(missing, &to_string(&1.element)),
      required_missing: missing |> Enum.filter(&(&1.tier == :required)) |> length(),
      assumption_active: assumption_count
    })
  end

  defp read_character_roster(frame, action, reader) when is_function(reader, 1) do
    if (action[:target_ref] || action[:capability_name]) == "character_roster" do
      characters = frame.workspace_id |> reader.() |> normalize_character_list()

      LogEmit.emit(:context, :characters, :done, %{
        turn_id: frame.turn_id,
        source_type: "character_dossier",
        character_count: length(characters)
      })

      characters
    else
      []
    end
  end

  defp read_character_roster(_frame, _action, _reader), do: []

  defp normalize_character_list(characters) when is_list(characters), do: characters
  defp normalize_character_list(_characters), do: []

  # CA01（Order 7 刀二·ⓐ）：plot_outline 纳入角色阵容注入——M2 扩章批凭空发明
  # 接管主角团新角色的机制原因就是规划工具看不见现有 cast。
  defp character_context_action?(action) do
    (action[:target_ref] || action[:capability_name]) in [
      "character_design",
      "character_evolution",
      "prose_writing",
      "plot_outline"
    ]
  end

  defp build_characters_section([], _frame), do: ""

  defp build_characters_section(characters, frame) when is_list(characters) do
    LogEmit.emit(:context, :characters, :done, %{
      turn_id: frame.turn_id,
      source_type: "character_dossier",
      character_count: length(characters)
    })

    body = Enum.map_join(characters, "\n", &character_roster_line/1)

    "## 现有角色（作品已确认角色主档案；设计新角色时避免重名/冲突并融入关系，写作时保持一致）\n" <>
      body
  end

  defp build_characters_section(_characters, _frame), do: ""

  defp character_roster_line(character) when is_map(character) do
    name = character |> Map.get(:name) |> to_string()
    role = character_role_suffix(Map.get(character, :role))
    summary = character_summary_suffix(Map.get(character, :summary))
    "- #{name}#{role}#{summary}"
  end

  defp character_role_suffix(role) when is_binary(role) and role != "", do: "（#{role}）"
  defp character_role_suffix(_role), do: ""

  defp character_summary_suffix(summary) when is_binary(summary) do
    case String.trim(summary) do
      "" -> ""
      trimmed -> "：" <> trimmed
    end
  end

  defp character_summary_suffix(_summary), do: ""

  # CP3（G6/G1）：tool 侧独立 L2 结构对象。current_chapters 标题列表仍保留给 planner；
  # prose_writing 额外拿到目标章计划摘要、顺序和前后章位置。
  defp target_structure_section(frame, action, %DialogueContext{} = context, resolved_chapter) do
    if prose_writing_action?(action) do
      target = structure_target_title(action, resolved_chapter)

      context.structured_chapters
      |> structured_chapter_window(target)
      |> render_target_structure_section(frame, DialogueContext.policy(context))
    else
      ""
    end
  end

  defp target_structure_section(_frame, _action, _context, _resolved_chapter), do: ""

  # VS-00E CP1：仅 prose_writing 路径，从目标章方向 + 读者效果确定性投影出场级执行简述。
  # 章窗口与 target_structure_section 同源（context.structured_chapters）。
  defp prose_execution_brief(
         frame,
         action,
         %DialogueContext{} = context,
         resolved_chapter,
         author_text
       ) do
    if prose_writing_action?(action) do
      target = structure_target_title(action, resolved_chapter)
      window = structured_chapter_window(context.structured_chapters, target)
      current = window && Map.get(window, :current)

      direction =
        current && current |> Map.get(:plan_direction) |> ChapterPlanDirection.from_storage()

      reader_effect = ReaderEffectBrief.from_plan_direction(direction)

      packet =
        %{
          chapter_direction: direction,
          reader_effect_brief: reader_effect,
          chapter: current_chapter_map(current),
          author_input: author_text,
          source_turn_ref: frame.turn_id
        }
        |> CreativeDecisionPacketBuilder.build()

      {brief, meta} = ProseExecutionBriefBuilder.build(packet)

      {brief,
       Map.merge(meta, %{
         decision_packet: packet,
         decision_packet_ref: "cdp_#{frame.turn_id}"
       })}
    end
  end

  defp prose_execution_brief(_frame, _action, _context, _resolved_chapter, _author_text), do: nil

  defp current_chapter_map(current) when is_map(current) do
    %{
      "id" => Map.get(current, :id),
      "title" => Map.get(current, :title),
      "seq" => Map.get(current, :seq),
      "summary" => Map.get(current, :summary)
    }
  end

  defp current_chapter_map(_current), do: %{}

  defp render_execution_brief({brief, _meta}), do: ProseExecutionBrief.to_prompt_section(brief)
  defp render_execution_brief(_), do: nil

  defp execution_brief_ref({brief, _meta}), do: ProseExecutionBrief.ref(brief)
  defp execution_brief_ref(_), do: nil

  defp decision_packet({_, %{decision_packet: packet}}) when is_map(packet), do: packet
  defp decision_packet(_), do: nil

  defp decision_packet_ref({_, %{decision_packet_ref: ref}}) when is_binary(ref), do: ref
  defp decision_packet_ref(_), do: nil

  defp emit_execution_brief(frame, {brief, meta}) do
    LogEmit.emit(:creative_decision_packet, :built, :done, %{turn_id: frame.turn_id})

    LogEmit.emit(:prose_execution_brief, :built, :done, %{
      turn_id: frame.turn_id,
      brief_ref: ProseExecutionBrief.ref(brief),
      scene_unit_count: length(brief.scene_units),
      degraded: meta.degraded
    })
  end

  defp emit_execution_brief(_frame, _brief_result), do: :ok

  defp provider_execution(input), do: Map.get(input, :provider_execution)

  defp quality_provider_execution(input), do: Map.get(input, :quality_provider_execution)

  # ── VS-00E CP2：独立质量评估 ──────────────────────

  # 仅 prose_writing 成功路径评估。确定性 validator 与局部形式候选总是运行；当独立质量
  # provider execution 可用时，同轮调用语义 evaluator 完成候选裁决与章节节奏评审。
  defp run_prose_quality(
         frame,
         action,
         %ToolResult{status: :succeeded} = tool_result,
         quality_provider_execution,
         brief_text,
         facts_context,
         pacing_context
       ) do
    if prose_writing_action?(action) do
      ctx = %{
        source_ref: List.first(tool_result.artifact_refs || []),
        source_turn_ref: frame.turn_id,
        source_type: :prose_fragment
      }

      opts =
        semantic_opts(
          quality_provider_execution,
          frame,
          brief_text,
          facts_context,
          pacing_context
        )

      result = ProseQualityService.evaluate(prose_body(tool_result), ctx, opts)
      emit_quality(frame, result)
      result
    end
  end

  defp run_prose_quality(
         _frame,
         _action,
         _result,
         _quality_execution,
         _brief,
         _facts,
         _pacing
       ),
       do: nil

  # 独立 evaluator 通过单独的 quality provider execution 调用（与 writer 分离的
  # provider 调用 + 独立 prompt）。未注入时为确定性评估。
  defp semantic_opts(
         quality_provider_execution,
         frame,
         brief_text,
         facts_context,
         pacing_context
       ) do
    case Execution.result_fn(quality_provider_execution) do
      result_fn when is_function(result_fn, 1) ->
        semantic_opts_from_provider_execution(
          quality_provider_execution,
          frame,
          brief_text,
          facts_context,
          pacing_context
        )

      _ ->
        []
    end
  end

  defp semantic_opts_from_provider_execution(
         provider_execution,
         frame,
         brief_text,
         facts_context,
         pacing_context
       ) do
    semantic_fn = fn text, ctx ->
      request = %QualityEvaluationRequest{
        request_id: "qer_#{frame.turn_id}",
        source_turn_ref: frame.turn_id,
        source_ref: Map.get(ctx, :source_ref),
        source_type: :prose_fragment,
        prose_text: text,
        execution_brief: brief_text,
        facts_context: facts_context,
        form_candidates: Map.get(ctx, :form_candidates, []),
        pacing_context: pacing_context
      }

      case ProseQualityEvaluator.evaluate(request, provider_execution) do
        %QualityEvaluationResult{status: :ok, findings: findings, provider_call_ref: ref} ->
          {:ok, findings, ref}

        %QualityEvaluationResult{status: :error, error: error} ->
          {:error, error}
      end
    end

    [semantic_fn: semantic_fn]
  end

  defp quality_pacing_context({_, %{decision_packet: packet}}) when is_map(packet) do
    direction =
      packet
      |> Map.get("chapter_direction")
      |> ChapterPlanDirection.to_storage()

    reader_effect =
      case Map.get(packet, "reader_effect_brief") do
        %ReaderEffectBrief{} = brief -> ReaderEffectBrief.to_storage(brief)
        _ -> nil
      end

    context =
      %{
        "chapter_direction" => direction,
        "reader_effect_brief" => reader_effect,
        "chapter" => Map.get(packet, "chapter", %{})
      }
      |> Enum.reject(fn {_key, value} -> value in [nil, %{}] end)
      |> Map.new()

    if map_size(context) == 0, do: nil, else: context
  end

  defp quality_pacing_context(_brief_result), do: nil

  defp prose_body(%ToolResult{output: %{items: [item | _]}}) when is_map(item) do
    clean_text(Map.get(item, :body) || Map.get(item, "body"))
  end

  defp prose_body(_tool_result), do: ""

  defp clean_text(value) when is_binary(value), do: value
  defp clean_text(_value), do: ""

  defp emit_quality(frame, %{
         findings: findings,
         form_candidates: form_candidates,
         review_status: status,
         policy: policy
       }) do
    LogEmit.emit(:prose_quality, :evaluated, :done, %{
      turn_id: frame.turn_id,
      finding_count: length(findings),
      form_candidate_count: length(form_candidates),
      review_status: status
    })

    LogEmit.emit(:quality_policy, :decided, :done, %{
      turn_id: frame.turn_id,
      policy_action: policy.action,
      review_status: status
    })
  end

  defp maybe_put_quality_review(turn_result, nil), do: turn_result

  defp maybe_put_quality_review(turn_result, %{
         findings: findings,
         review_status: status,
         policy: policy
       }) do
    turn_result
    |> Map.put(:quality_review, %{
      status: quality_status(policy.action),
      policy_action: Atom.to_string(policy.action),
      review_status: Atom.to_string(status),
      findings: Enum.map(findings, &QualityFinding.author_safe_summary/1)
    })
    |> maybe_add_revise_action(findings)
  end

  # VS-00E CP3：本轮有质量发现且存在待采纳正文草稿时，暴露 revise_from_findings 可用动作。
  # ActionValidator 反“凭空发明动作”，故修订入口必须在 source TurnResult 的 available_actions
  # 中先登记，作者才能据此触发按范围修订。无发现或无正文草稿时不暴露。
  defp maybe_add_revise_action(turn_result, []), do: turn_result

  defp maybe_add_revise_action(turn_result, findings) do
    case prose_pending_artifact_id(turn_result) do
      nil ->
        turn_result

      artifact_id ->
        action = %{
          action_id: "revise_from_findings:#{artifact_id}",
          action_type: "revise_from_findings",
          label_key: "quality.revise_from_findings",
          source_turn_ref: turn_result.turn_id,
          target_ref: artifact_id,
          enabled: true,
          idempotency_key: "idem:#{turn_result.turn_id}:revise_from_findings:#{artifact_id}",
          quality_finding_refs:
            findings
            |> Enum.map(&(&1.quality_finding_id || &1.validator_ref))
            |> Enum.reject(&is_nil/1)
            |> Enum.uniq()
        }

        Map.update(turn_result, :available_actions, [action], fn actions ->
          actions ++ [action]
        end)
    end
  end

  defp prose_pending_artifact_id(turn_result) do
    turn_result
    |> Map.get(:adoption_state, %{})
    |> Map.get(:pending, [])
    |> Enum.find(fn p -> Map.get(p, :artifact_type) in [:prose_fragment, "prose_fragment"] end)
    |> case do
      nil -> nil
      entry -> Map.get(entry, :artifact_id)
    end
  end

  defp quality_status(:proceed), do: "passed"
  defp quality_status(:proceed_with_warning), do: "warnings"
  defp quality_status(:adoption_review), do: "adoption_review"
  defp quality_status(:confirm), do: "adoption_review"
  defp quality_status(:block), do: "blocked"
  defp quality_status(:quality_review_unavailable), do: "unavailable"
  defp quality_status(_action), do: "passed"

  defp quality_policy_action(%{policy: %{action: action}}), do: Atom.to_string(action)
  defp quality_policy_action(_quality), do: nil

  defp quality_review_status(%{review_status: status}), do: Atom.to_string(status)
  defp quality_review_status(_quality), do: nil

  defp evaluator_provider_call_ref(%{evaluator_provider_call_ref: ref})
       when is_binary(ref) and ref != "",
       do: ref

  defp evaluator_provider_call_ref(_quality), do: nil

  defp writer_provider_call_ref(%ToolResult{output: %{items: items}}) when is_list(items) do
    Enum.find_value(items, fn item -> map_value(item, :provider_call_ref) end)
  end

  defp writer_provider_call_ref(_tool_result), do: nil

  defp provider_call_budget(writer_fn, evaluator_fn, revision_fn) do
    %{
      frame_planning: 0,
      micro_planning: 0,
      writer: provider_call_count(writer_fn),
      evaluator: provider_call_count(evaluator_fn),
      revision_writer: provider_call_count(revision_fn),
      step_planning: 0,
      final_synthesizer: 0
    }
  end

  defp provider_call_count(provider_execution) do
    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) -> 1
      _ -> 0
    end
  end

  defp map_value(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp map_value(_map, _key), do: nil

  defp structure_target_title(_action, resolved_chapter)
       when is_binary(resolved_chapter) and resolved_chapter != "",
       do: resolved_chapter

  defp structure_target_title(action, _resolved_chapter),
    do: normalize_target_chapter(action[:target_chapter])

  defp structured_chapter_window(chapters, target)
       when is_list(chapters) and is_binary(target) and target != "" do
    index = Enum.find_index(chapters, &(Map.get(&1, :title) == target))

    if is_integer(index) do
      %{
        current: Enum.at(chapters, index),
        previous: if(index > 0, do: Enum.at(chapters, index - 1), else: nil),
        next: Enum.at(chapters, index + 1)
      }
    end
  end

  defp structured_chapter_window(_chapters, _target), do: nil

  defp render_target_structure_section(nil, _frame, _policy), do: ""

  defp render_target_structure_section(%{current: current} = window, frame, policy) do
    title = Map.get(current, :title, "")
    seq = Map.get(current, :seq)
    summary = Map.get(current, :summary, "")
    direction = current |> Map.get(:plan_direction) |> ChapterPlanDirection.from_storage()
    reader_effect = ReaderEffectBrief.from_plan_direction(direction)
    has_prose = Map.get(current, :has_prose, false)

    LogEmit.emit(:context, :structure, :done, %{
      turn_id: frame.turn_id,
      source_type: "structure",
      target_chapter: title,
      chapter_seq: seq,
      has_plan_summary: not blank?(summary),
      has_plan_direction: not is_nil(direction),
      has_reader_effect_brief: not is_nil(reader_effect),
      has_previous: not is_nil(window.previous),
      has_next: not is_nil(window.next),
      assembly_policy_id: policy.policy_id
    })

    emit_reader_effect(frame, title, reader_effect, policy)

    [
      "## 目标章结构（写前设计态）",
      "- 目标章：#{title}#{seq_suffix(seq)}",
      direction_or_summary_lines(direction, summary),
      reader_effect_lines(reader_effect),
      "- 卷内位置：#{neighbor_label("上一章", window.previous)}；#{neighbor_label("下一章", window.next)}",
      "- 正文状态：#{if has_prose, do: "已有已采纳正文", else: "尚无已采纳正文"}"
    ]
    |> List.flatten()
    |> Enum.join("\n")
  end

  defp direction_or_summary_lines(nil, summary), do: ["- 计划摘要：#{summary_or_empty(summary)}"]

  defp direction_or_summary_lines(direction, summary) do
    [
      "- 章方向：E18-E22 结构化方向",
      ChapterPlanDirection.prompt_lines(direction),
      if(blank?(summary), do: [], else: ["- 计划摘要：#{summary}"])
    ]
  end

  defp reader_effect_lines(reader_effect) do
    ["## 读者效果目标（写前约束）", ReaderEffectBrief.prompt_lines(reader_effect)]
  end

  defp emit_reader_effect(frame, title, reader_effect, policy) do
    storage = ReaderEffectBrief.to_storage(reader_effect) || %{}

    LogEmit.emit(:context, :reader_effect, :done, %{
      turn_id: frame.turn_id,
      source_type: "reader_effect",
      target_chapter: title,
      has_reader_effect_brief: not is_nil(reader_effect),
      intended_emotion_present: present?(storage["intended_emotion"]),
      hook_target_present: present?(storage["hook_target"]),
      payoff_or_promise_present: present?(storage["payoff_or_promise"]),
      suspense_boundary_present: present?(storage["suspense_boundary"]),
      risk_note_count: length(storage["web_serial_risk_notes"] || []),
      assembly_policy_id: policy.policy_id
    })
  end

  defp seq_suffix(seq) when is_integer(seq), do: "（seq=#{seq}）"
  defp seq_suffix(_seq), do: ""

  defp summary_or_empty(summary) when is_binary(summary) and summary != "", do: summary
  defp summary_or_empty(_summary), do: "（无计划摘要）"

  defp neighbor_label(label, %{title: title}) when is_binary(title) and title != "",
    do: "#{label}=#{title}"

  defp neighbor_label(label, _chapter), do: "#{label}=无"

  defp prior_prose_section(_action, ""), do: ""

  defp prior_prose_section(action, prose) do
    heading =
      case action[:authoring_intent] do
        :rewrite ->
          "## 本章当前已采纳正文（请基于它重写整章，可大幅改动情节与措辞，但保持人物与设定一致）"

        _ ->
          "## 本章已采纳正文（请在其后自然衔接续写，承接情节、人物状态与语气，不要重复已写内容，也不要从头另起）"
      end

    heading <> "\n" <> prose
  end

  defp tool_context_text(%NovelDomain.DialogueContext{} = context, text) do
    [NovelDomain.DialogueContext.to_prompt_text(context), "## 当前作者输入\n#{text}"]
    |> Enum.reject(&blank?/1)
    |> Enum.join("\n\n")
  end

  defp tool_context_text(_context, text), do: text

  defp action_summary(action) when is_map(action) do
    Map.get(action, :summary) || Map.get(action, "summary")
  end

  defp action_summary(_), do: nil

  defp present?(value), do: is_binary(value) and String.trim(value) != ""

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""

  defp dispatch_tool(%ToolRequest{tool_name: tool_name} = req, result_fn)
       when tool_name in @creative_tools do
    AuthorizedToolExecutor.execute(req, result_fn)
  end

  defp dispatch_tool(%ToolRequest{} = req, _result_fn), do: AuthorizedToolExecutor.execute(req)

  defp assemble_artifact(
         %ToolResult{tool_name: tool_name} = result,
         turn_id,
         plan,
         resolved_chapter
       )
       when tool_name in @creative_tools do
    case ArtifactAssembler.assemble(result, turn_id, provenance(plan, resolved_chapter)) do
      {:ok, artifact_set} -> artifact_set
      {:error, _reason} -> nil
    end
  end

  defp assemble_artifact(_result, _turn_id, _plan, _resolved_chapter), do: nil

  # artifact provenance：authoring_intent 来自 plan；target_chapter 用应用层解析后的归章
  # （命中/回退后的章），保证"生成时读前文的章"与"采纳时归入的章"是同一章。
  # 非续写/重写时 resolved_chapter=""，回退到 plan 的 target_chapter（通常为 nil）。
  defp provenance(%MicroPlan{proposed_actions: [action | _]}, resolved_chapter)
       when is_map(action) do
    target =
      if is_binary(resolved_chapter) and resolved_chapter != "",
        do: resolved_chapter,
        else: Map.get(action, :target_chapter)

    %{authoring_intent: Map.get(action, :authoring_intent), target_chapter: target}
  end

  defp provenance(_plan, _resolved_chapter), do: %{}

  defp narrate(
         %ToolResult{status: :succeeded},
         %{artifact_type: type, target_chapter: chapter},
         _result_fn
       )
       when type in [:prose_fragment, "prose_fragment"] and is_binary(chapter) and chapter != "" do
    "已生成#{chapter}正文草稿。请先审阅，保存后会写入章节正文；未保存前不会进入阅读模式或作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _result_fn)
       when type in [:prose_fragment, "prose_fragment"] do
    "已生成章节正文草稿。请先审阅，保存后会写入章节正文；未保存前不会进入阅读模式或作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _result_fn)
       when type in [:outline_draft, "outline_draft"] do
    "已生成大纲草稿。请先审阅，保存后会进入作品档案的大纲与结构；未保存前只保留为本轮草稿。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _result_fn)
       when type in [:character_seed, "character_seed"] do
    "已生成角色设定草稿。请先审阅，保存后会进入作品档案；未保存前不会写入作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _result_fn)
       when type in [:foreshadowing_seed, "foreshadowing_seed"] do
    "已生成伏笔草稿。请先审阅，保存后会进入作品档案的伏笔；未保存前不会写入作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _result_fn)
       when type in [
              :world_rule_seed,
              "world_rule_seed",
              :style_rule_seed,
              "style_rule_seed",
              :constraint_seed,
              "constraint_seed"
            ] do
    "已生成规则草稿。请先审阅，保存后会进入作品档案的经验规则；未保存前不会写入作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _result_fn)
       when type in [:world_setting, "world_setting"] do
    "已生成世界设定草稿。请先审阅，保存后会进入作品档案；未保存前不会写入作品事实。"
  end

  defp narrate(
         %ToolResult{status: :succeeded, tool_name: "character_roster"} = tool_result,
         nil,
         _result_fn
       ) do
    characters = get_in(tool_result.output, [:characters]) || []
    CharacterRosterNarration.message(characters)
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: _type}, _result_fn) do
    "已生成待保存草稿。请先审阅，保存后才会进入作品档案；未保存前不会写入作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded} = tool_result, _artifact_set, provider_execution) do
    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) ->
        Planner.narrate_tool_result(tool_result, provider_execution)

      _ ->
        "已生成待保存草稿。请先审阅，保存后才会进入作品档案；未保存前不会写入作品事实。"
    end
  end

  defp narrate(%ToolResult{status: :failed} = tool_result, _artifact_set, _result_fn) do
    reason =
      tool_result.errors
      |> List.wrap()
      |> List.first(%{message: "工具执行失败"})
      |> Map.get(:message)

    "这次没有生成创作草稿，工具执行失败：#{reason}。未创建待采纳内容，也没有写入作品事实。"
  end

  defp narrate(_tool_result, _artifact_set, _result_fn) do
    "工具执行未完成。未创建待采纳内容，也没有写入作品事实。"
  end
end
