defmodule NovelApplication.TurnExecutionService do
  @moduledoc """
  Application service for the tool execution portion of a v3 turn.

  DialogueGateway delegates approved tool execution here. The service constructs
  ToolRequest, invokes the agent toolbox, assembles tentative artifacts, records
  trace, and builds the final TurnResult.
  """

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelAgent.Toolbox
  alias NovelApplication.ArtifactAssembler
  alias NovelApplication.CapabilityRegistry
  alias NovelApplication.Planner
  alias NovelApplication.TraceWriter
  alias NovelApplication.TurnResultBuilder
  alias NovelCommon.Contracts.ToolRequest
  alias NovelCommon.Contracts.ToolResult
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.MissingPolicyResult
  alias NovelDomain.OmissionNote
  alias NovelDomain.OrchestratorDecision
  alias NovelDomain.WritingCoordinate

  @creative_tools ~w(world_building character_design plot_outline prose_writing)

  @type execution_input :: %{
          required(:frame) => DialogueFrame.t(),
          required(:plan) => MicroPlan.t(),
          required(:decision) => OrchestratorDecision.t(),
          optional(:candidates) => list(),
          optional(:context) => term(),
          optional(:author_input) => map(),
          optional(:complete_fn) => function(),
          optional(:chapter_prose_reader) => function(),
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
        frame.workspace_id
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
    prior_prose_full =
      continuation_prior_prose(frame, action, resolved_chapter, input[:chapter_prose_reader])

    # CP1：前文 excerpt 预算由本上下文的组装策略给出（按 provider 档位），超预算尾部裁剪
    # 并产生 OmissionNote + 发 context.downgrade.done 业务日志；裁剪不再用写死的常量。
    {prior_prose, omission_notes} =
      budget_prior_prose(
        frame,
        resolved_chapter,
        prior_prose_full,
        DialogueContext.policy(input[:context])
      )

    maybe_emit_target_word_count(frame, action)

    req = build_tool_request(frame, plan, decision, input, action, prior_prose)
    tool_result = dispatch_tool(req, input[:complete_fn])
    artifact_set = assemble_artifact(tool_result, frame.turn_id, plan, resolved_chapter)

    {trace, trace_summary} =
      TraceWriter.record_with_tool(
        frame,
        plan,
        decision,
        req,
        tool_result,
        %{turn_id: frame.turn_id, omission_notes: omission_notes},
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

  defp build_tool_request(frame, plan, decision, input, action, prior_prose) do
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
      input: tool_input(frame, action, input[:author_input], input[:context], prior_prose),
      read_scope_grants: (entry && entry.read_scopes) || [],
      write_scope_grants: [],
      idempotency_key: "idem_#{frame.turn_id}_#{tool_name}#{input[:idempotency_suffix] || ""}",
      trace_policy: %{level: "standard"},
      created_at: DateTime.utc_now()
    }
  end

  defp tool_input(frame, action, author_input, context, prior_prose) do
    text =
      case author_input do
        %{text: text} when is_binary(text) -> text
        %{"text" => text} when is_binary(text) -> text
        _ -> frame.author_visible_draft.message
      end

    context_text =
      [prior_prose_section(action, prior_prose), tool_context_text(context, text)]
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
  # - 续写/重写但漏给或没命中目标章 → 回退到"最近一个已写正文的章"（"接着往下写"默认续最新已写章）。
  #   注意：current_chapters 现含计划待写章，不能简单取 List.last（会落到末尾的计划空章）。
  # - 其它（写全新章、不针对具体章）→ ""（不归章，由创作内容自身标题命名）。
  # AI 只识别意图与候选目标章；安全解析在应用层用 DialogueContext.current_chapters 完成。
  defp resolve_target_chapter(action, context, reader, work_id) do
    chapters = accepted_chapter_titles(context)
    target = normalize_target_chapter(action[:target_chapter])
    intent = action[:authoring_intent]

    cond do
      target != "" and target in chapters ->
        target

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
          NovelDomain.AssemblyPolicy.t()
        ) ::
          {String.t(), [OmissionNote.t()]}
  defp budget_prior_prose(_frame, _chapter, "", _policy), do: {"", []}

  defp budget_prior_prose(frame, chapter, prose, policy) do
    max = policy.excerpt_budget_chars

    if String.length(prose) <= max do
      {prose, []}
    else
      excerpt =
        "（本章更早的正文已省略，以下是最近的部分）\n…" <>
          String.slice(prose, String.length(prose) - max, max)

      note = OmissionNote.new("prior_prose:#{chapter_label(chapter)}", :budget_limited, nil)

      LogEmit.emit(:context, :downgrade, :done, %{
        turn_id: frame.turn_id,
        source: note.source,
        reason: to_string(note.reason),
        assembly_policy_id: policy.policy_id,
        excerpt_budget_chars: max,
        original_chars: String.length(prose)
      })

      {excerpt, [note]}
    end
  end

  defp chapter_label(chapter) when is_binary(chapter) and chapter != "", do: chapter
  defp chapter_label(_), do: "本章"

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

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""

  defp dispatch_tool(%ToolRequest{tool_name: tool_name} = req, complete_fn)
       when tool_name in @creative_tools do
    Toolbox.execute(req, complete_fn)
  end

  defp dispatch_tool(%ToolRequest{} = req, _complete_fn), do: Toolbox.execute(req)

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
       when type in [:world_setting, "world_setting"] do
    "已生成世界设定草稿。请先审阅，保存后会进入作品档案；未保存前不会写入作品事实。"
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
