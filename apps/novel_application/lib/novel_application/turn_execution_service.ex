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
          optional(:complete_fn) => function(),
          optional(:chapter_prose_reader) => function(),
          optional(:chapter_summary_reader) => map() | nil,
          optional(:character_reader) => function() | nil,
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
          decision_packet: decision_packet(brief_result)
        }
      )

    tool_result = dispatch_tool(req, input[:complete_fn])
    artifact_set = assemble_artifact(tool_result, frame.turn_id, plan, resolved_chapter)

    # VS-00E CP2：正文生成后运行独立质量评估（与 writer 逻辑分离），产出 QualityFinding +
    # 策略。只读，不改 artifact / 作品事实；evaluator 失败诚实降级为 quality_review_unavailable。
    quality =
      run_prose_quality(
        frame,
        action,
        tool_result,
        input[:quality_complete_fn],
        render_execution_brief(brief_result)
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
            provider_call_budget(input[:complete_fn], input[:quality_complete_fn], nil),
          quality_policy_action: quality_policy_action(quality),
          quality_review_status: quality_review_status(quality)
        },
        input[:context]
      )

    assistant_message = narrate(tool_result, artifact_set, input[:complete_fn])

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
      tool_request_id: "tq_#{System.unique_integer([:positive, :monotonic])}",
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

    # 顺序：目标章结构对象（L2 设计态）→ 现有角色主档案（作品级阵容）→ 前文各章摘要
    # （L3a 跨章实现态）→ 本章已采纳正文（L5 衔接）→ 当前作者输入。
    context_text =
      [
        target_structure_section(frame, action, context, sections.resolved_chapter),
        sections.character_roster,
        sections.prior_summaries,
        prior_prose_section(action, sections.prior_prose),
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
    |> maybe_put_characters(action, sections.characters)
    |> maybe_put_execution_brief(sections)
    |> maybe_put_decision_packet(sections)
  end

  # VS-00E：把已渲染的场级执行简述文本放入工具输入，由 CreativeToolAdapter 透传给
  # provider（仅 prose_writing 路径非空）。
  defp maybe_put_execution_brief(input, %{execution_brief: text})
       when is_binary(text) and text != "" do
    Map.put(input, "execution_brief", text)
  end

  defp maybe_put_execution_brief(input, _sections), do: input

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
    if prose_writing_action?(action) do
      policy = DialogueContext.policy(context)

      previous.(frame.workspace_id, resolved_chapter, policy.summary_window)
      |> Enum.reject(&(&1.chapter_title == resolved_chapter))
      |> build_summaries_section(frame, policy)
    else
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

  defp character_context_action?(action) do
    (action[:target_ref] || action[:capability_name]) in [
      "character_design",
      "character_evolution",
      "prose_writing"
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

  # ── VS-00E CP2：独立质量评估 ──────────────────────

  # 仅 prose_writing 成功路径评估。CP2 当前接入确定性 validator（无 semantic_fn，
  # review_status=completed）；语义 evaluator 作为可注入 semantic_fn 在后续接 Gateway。
  defp run_prose_quality(
         frame,
         action,
         %ToolResult{status: :succeeded} = tool_result,
         quality_complete_fn,
         brief_text
       ) do
    if prose_writing_action?(action) do
      ctx = %{
        source_ref: List.first(tool_result.artifact_refs || []),
        source_turn_ref: frame.turn_id,
        source_type: :prose_fragment
      }

      opts = semantic_opts(quality_complete_fn, frame, brief_text)
      result = ProseQualityService.evaluate(prose_body(tool_result), ctx, opts)
      emit_quality(frame, result)
      result
    end
  end

  defp run_prose_quality(_frame, _action, _tool_result, _quality_complete_fn, _brief_text),
    do: nil

  # 独立 evaluator 通过单独的 quality_complete_fn 调用（与 writer 的 complete_fn 分离的
  # provider 调用 + 独立 prompt）。未注入时为确定性评估。
  defp semantic_opts(quality_complete_fn, frame, brief_text)
       when is_function(quality_complete_fn, 1) do
    semantic_fn = fn text, ctx ->
      request = %QualityEvaluationRequest{
        request_id: "qer_#{frame.turn_id}",
        source_turn_ref: frame.turn_id,
        source_ref: Map.get(ctx, :source_ref),
        source_type: :prose_fragment,
        prose_text: text,
        execution_brief: brief_text
      }

      case ProseQualityEvaluator.evaluate(request, quality_complete_fn) do
        %QualityEvaluationResult{status: :ok, findings: findings, provider_call_ref: ref} ->
          {:ok, findings, ref}

        %QualityEvaluationResult{status: :error, error: error} ->
          {:error, error}
      end
    end

    [semantic_fn: semantic_fn]
  end

  defp semantic_opts(_quality_complete_fn, _frame, _brief_text), do: []

  defp prose_body(%ToolResult{output: %{items: [item | _]}}) when is_map(item) do
    clean_text(Map.get(item, :body) || Map.get(item, "body"))
  end

  defp prose_body(_tool_result), do: ""

  defp clean_text(value) when is_binary(value), do: value
  defp clean_text(_value), do: ""

  defp emit_quality(frame, %{findings: findings, review_status: status, policy: policy}) do
    LogEmit.emit(:prose_quality, :evaluated, :done, %{
      turn_id: frame.turn_id,
      finding_count: length(findings),
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
  # 中先登记，作者才能据此触发“按这些问题重写”。无发现或无正文草稿时不暴露。
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
            findings |> Enum.map(& &1.validator_ref) |> Enum.reject(&is_nil/1) |> Enum.uniq()
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

  defp provider_call_count(fun) when is_function(fun, 1), do: 1
  defp provider_call_count(_fun), do: 0

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

  defp dispatch_tool(%ToolRequest{tool_name: tool_name} = req, complete_fn)
       when tool_name in @creative_tools do
    AuthorizedToolExecutor.execute(req, complete_fn)
  end

  defp dispatch_tool(%ToolRequest{} = req, _complete_fn), do: AuthorizedToolExecutor.execute(req)

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
         _complete_fn
       )
       when type in [:prose_fragment, "prose_fragment"] and is_binary(chapter) and chapter != "" do
    "已生成#{chapter}正文草稿。请先审阅，保存后会写入章节正文；未保存前不会进入阅读模式或作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _complete_fn)
       when type in [:prose_fragment, "prose_fragment"] do
    "已生成章节正文草稿。请先审阅，保存后会写入章节正文；未保存前不会进入阅读模式或作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _complete_fn)
       when type in [:outline_draft, "outline_draft"] do
    "已生成大纲草稿。请先审阅，保存后会进入作品档案的大纲与结构；未保存前只保留为本轮草稿。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _complete_fn)
       when type in [:character_seed, "character_seed"] do
    "已生成角色设定草稿。请先审阅，保存后会进入作品档案；未保存前不会写入作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _complete_fn)
       when type in [:foreshadowing_seed, "foreshadowing_seed"] do
    "已生成伏笔草稿。请先审阅，保存后会进入作品档案的伏笔；未保存前不会写入作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _complete_fn)
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

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: type}, _complete_fn)
       when type in [:world_setting, "world_setting"] do
    "已生成世界设定草稿。请先审阅，保存后会进入作品档案；未保存前不会写入作品事实。"
  end

  defp narrate(
         %ToolResult{status: :succeeded, tool_name: "character_roster"} = tool_result,
         nil,
         _complete_fn
       ) do
    characters = get_in(tool_result.output, [:characters]) || []
    CharacterRosterNarration.message(characters)
  end

  defp narrate(%ToolResult{status: :succeeded}, %{artifact_type: _type}, _complete_fn) do
    "已生成待保存草稿。请先审阅，保存后才会进入作品档案；未保存前不会写入作品事实。"
  end

  defp narrate(%ToolResult{status: :succeeded} = tool_result, _artifact_set, complete_fn)
       when is_function(complete_fn, 1) do
    Planner.narrate_tool_result(tool_result, complete_fn)
  end

  defp narrate(%ToolResult{status: :succeeded}, _artifact_set, _complete_fn) do
    "已生成待保存草稿。请先审阅，保存后才会进入作品档案；未保存前不会写入作品事实。"
  end

  defp narrate(%ToolResult{status: :failed} = tool_result, _artifact_set, _complete_fn) do
    reason =
      tool_result.errors
      |> List.wrap()
      |> List.first(%{message: "工具执行失败"})
      |> Map.get(:message)

    "这次没有生成创作草稿，工具执行失败：#{reason}。未创建待采纳内容，也没有写入作品事实。"
  end

  defp narrate(_tool_result, _artifact_set, _complete_fn) do
    "工具执行未完成。未创建待采纳内容，也没有写入作品事实。"
  end
end
