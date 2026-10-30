defmodule NovelApplication.JudgmentProtocol do
  @moduledoc "B26/B27：单调用 auto 判断/续行协议；先校验整个响应，再交业务边界派发。"
  alias NovelAgent.Provider.{Execution, InferenceParams}

  alias NovelApplication.{
    AgentNarrativeSource,
    AuthoringTaskPolicy,
    CharacterProfile,
    JudgmentToolContract,
    PendingArtifactWorkflow,
    ProviderActivityProjector,
    TurnInteractionService
  }

  require NovelCommon.LogEmit, as: LogEmit

  @max_attempts 2
  @pending_target_capabilities ~w(revise_pending_artifact discard_pending_artifact)
  @adopted_target_capabilities ~w(revise_adopted_content)
  @judgment_tool_names ~w(judgment_decision ask_author agent_plan_draft register_author_content
                          propose_creative_directions report_capability_gap)
  @error_excerpt_chars 400
  @write_intent_reason_re ~r/写入|保存|存档|落库|存入|登记进|写进/
  @type judgment :: map()
  def tool_name, do: "judgment_decision"
  def continuation_tool_name, do: "continuation_decision"
  def actions(_opts \\ []), do: ~w(execute plan explore)

  def request_judgment(provider, snapshot \\ %{}, input),
    do: request(provider, snapshot, input, :judgment)

  def request_continuation(provider, snapshot \\ %{}, input),
    do: request(provider, snapshot, input, :continuation)

  defp request(provider, snapshot, input, profile) do
    result_fn =
      provider
      |> Execution.with_purpose(:planner)
      |> Execution.with_content_visibility(:author)
      |> Execution.with_params(InferenceParams.new(temperature: 0.2))
      |> ProviderActivityProjector.with_stage_sink(snapshot,
        purpose: :planner,
        content_visibility: :author
      )
      |> Execution.result_fn()

    if is_function(result_fn, 1),
      do: invoke(result_fn, prompt(input, profile), input, profile, 1),
      else: {:error, :provider_execution_required}
  end

  defp invoke(fun, prompt, input, profile, attempt, previous_tools \\ []) do
    case fun.(prompt) do
      {:ok, provider_result} ->
        validate_response(fun, prompt, input, profile, attempt, provider_result, previous_tools)

      {:error, _reason} when attempt < @max_attempts ->
        LogEmit.emit(:judgment, :provider_retry, :start, %{
          attempt: attempt,
          reason_code: "provider_request_failed"
        })

        invoke(fun, prompt, input, profile, attempt + 1, previous_tools)

      {:error, _} = error ->
        error
    end
  end

  defp validate_response(fun, prompt, input, profile, attempt, provider_result, previous_tools) do
    case decode(provider_result, profile, input, previous_tools, attempt) do
      {:ok, judgment} ->
        {:ok, Map.put(judgment, :provider_call_count, attempt)}

      {:error, reason} ->
        log_output_validation(attempt, reason)

        if reason == :exploration_not_available and attempt >= @max_attempts + 1 do
          degrade_to_reply(provider_result, input, attempt)
        else
          # 纠错重试时把本次尝试的工具名带上：若本次是 ask_author（即使参数有误），
          # 重试不得在没有作者回答的情况下改为 execute/revise 推进候选（M06）。
          correct_or_reject(
            fun,
            prompt,
            input,
            profile,
            attempt,
            reason,
            tool_names(provider_result)
          )
        end
    end
  end

  defp log_output_validation(attempt, reason) do
    LogEmit.emit(:judgment, :output_validation, :done, %{
      outcome: if(attempt < @max_attempts, do: "retry", else: "rejected"),
      reason_code: validation_reason_code(reason),
      reason: inspect(reason),
      attempt: attempt
    })
  end

  defp tool_names(result) do
    (field(result, :tool_calls) || [])
    |> Enum.map(&field(&1, :name))
    |> Enum.reject(&is_nil/1)
  end

  # 探索预算关闭/覆盖已充分时不再终局：用模型本条可见文本作为 reply 收束
  # （必须是 provider 输出字节，保持 N-NARR 可追溯；不伪造结论）。
  defp degrade_to_reply(provider_result, input, attempt) do
    content = field(provider_result, :content)

    with true <- nonblank?(content),
         {:ok, text, source} <- content_narrative(provider_result, content) do
      judgment =
        normalized("reply", %{}, nil, provider_result, text, source, input)
        |> Map.put(:provider_call_count, attempt)
        |> Map.put(:degraded_reason, "exploration_budget_exhausted")

      {:ok, judgment}
    else
      _ -> {:error, {:judgment_protocol_violation, :exploration_not_available}}
    end
  end

  # 工具参数 schema 错误：给出“只填契约声明字段”的可执行纠正（M14 等模型常加 action/capability 等多余字段）。
  defp correction_content(:invalid_tool_arguments) do
    "本次响应的工具参数未通过 schema 校验：只填该工具契约声明的字段，不要添加 action/capability/body 等未声明字段。" <>
      "report_capability_gap 只填 dialogue_goal、missing_effect、author_reasoning（optional alternative_operation_refs）；" <>
      "ask_author 只填 question、options（optional reason_codes）；judgment_decision 按 action 填对应字段。" <>
      "保留原任务、目标、来源与范围，只纠正工具参数结构。"
  end

  # M06：上一轮请求作者选择后，纠错重试不得改成推进具体候选/版本。
  defp correction_content(:await_author_unanswered) do
    "本次响应未通过契约校验：上一轮已向作者提问，但作者尚未回答/选择。" <>
      "不得推进具体候选或版本：不能 execute/revise 指向某候选，不能规划“按某候选执行”，" <>
      "也不能用 report_capability_gap 代替作者回答。请保持等待、重新做具体澄清（ask_author），或只说明仍在等待作者选择。" <>
      "保留同一作者输入、来源、目标、范围与权限，不要猜测作者选择。"
  end

  defp correction_content(:character_target_ambiguous) do
    "本次响应未通过契约校验：character_target_ambiguous（作者点名的角色在角色索引里同名/别名歧义）。" <>
      "用 ask_author 列出候选 character_ref+name 让作者选择，不得猜；不要新建角色。"
  end

  defp correction_content(:character_target_missing) do
    "本次响应未通过契约校验：character_target_missing（没有找到作者点名的已有角色）。" <>
      "先确认对象：可用 ask_author 澄清，或 report_capability_gap 说明缺口；不得新建角色/写正文，不得用演化记忆冒充主档案修订。"
  end

  defp correction_content(:invalid_character_role) do
    "本次响应未通过契约校验：invalid_character_role（无法确定要改成的叙事角色）。" <>
      "narrative_role 只能取 PROTAGONIST/ANTAGONIST/SUPPORTING/MINOR/ENSEMBLE_POV；请用 ask_author 澄清或按作者原话选择合法值。"
  end

  defp correction_content({:incompatible_operation_fields, detail}) do
    "本次响应未通过契约校验：incompatible_operation_fields（动作与字段不匹配）。" <>
      to_string(detail) <>
      "\n规则：explore 只填 explore_request（tool/query），不得携带 capability/pending_artifact_ref/adopted_content_ref；" <>
      "execute 才填 capability 与一个目标 ref，不得携带 explore_request；plan 只填 plan 相关字段与判断字段。" <>
      "保留取证意图与目标，只纠正字段。"
  end

  defp correction_content(:exploration_not_available) do
    "本次响应未通过契约校验：exploration_not_available（本轮只读探索预算已用尽/不可用）。" <>
      "不得再请求 explore；请直接基于已有观察与覆盖事实给作者最终答复（说明已覆盖范围与未读缺口/下一步），" <>
      "或用 ask_author 做必要澄清；覆盖已充分则直接给结论。不得以过程语或空内容收束。"
  end

  defp correction_content(:discussion_only_violation) do
    "本次响应未通过契约校验：discussion_only_violation（作者本轮只要求分析/讨论，明确说先别动笔/只聊/不生成）。" <>
      "不得调用 propose_creative_directions、register_author_content 或任何生成/写入操作。" <>
      "请只在 content 里给出分析/讨论本身；不要物化候选、方向卡片或登记原文。"
  end

  # M18：指代历史材料且可探索时，先取证再问作者；纠错给出明确顺序。
  defp correction_content(:explore_before_ask_required) do
    "本次响应未通过契约校验：explore_before_ask_required（来源缺失但尚未取证就先问作者）。" <>
      "作者在指代系统可能已有的历史材料，而本轮还没有观察证据；若只读探索可用，" <>
      "必须先用 judgment_decision.explore 取证（chapter_read/prose_search 查正文原文；session_adoptions 查历史候选/登记），" <>
      "探索后仍无合法来源，再用 ask_author 具体澄清是哪条消息或请作者贴出原文；不得默认先问作者。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正取证顺序。"
  end

  # 对象/版本证据纪律：ref 不在可见集合时，纠错必须给出“用真实 ref 或先取证/澄清”的路径。
  defp correction_content({:pending_artifact_invalid, :target_not_available}) do
    "本次响应未通过契约校验：target_not_available（引用的对象 ref 不在本轮可见目录）。" <>
      "只能引用当前上下文/观察中真实列出的 pending_artifact_ref/adopted_content_ref；" <>
      "没有真实 ref 时先 explore（session_adoptions 查候选、chapter_read/archive_read 查版本），或 ask_author 具体澄清，" <>
      "不得编造 ref、不得用标题/记忆猜 ref。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正目标选择。"
  end

  defp correction_content(:target_ref_field_conflict) do
    "本次响应未通过契约校验：target_ref_field_conflict（目标 ref 字段不合法）。" <>
      "execute 只填一个目标 ref：待采纳候选用 pending_artifact_ref，已采纳内容用 adopted_content_ref；" <>
      "不得同时填两个，也不得把候选 ref 填进 adopted_content_ref。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正字段与目标选择。"
  end

  # 用户可见动作为空内容时，纠错必须明确“需要非空作者可见文本”，而不是泛泛说结构。
  defp correction_content(:judgment_narrative_required) do
    "本次响应未通过契约校验：judgment_narrative_required（缺少作者可见内容）。" <>
      "纯文本回复/登记/缺口说明等用户可见动作必须给出非空 content；只输出思考、空 content、“-”/“—”/仅标点占位或“[assistant reasoning omitted]”这类内容不算回复。" <>
      "请用一两句自然中文给出实际回复；使用工具时 content 可为空但 question/reason/author_reasoning 必须提供作者可见原话。" <>
      "保留同一作者输入、来源、目标、范围与权限，只补足可见内容。"
  end

  # M18：指代历史原文但把其它消息/指令当来源时，给出可执行的来源纠正路径。
  defp correction_content(
         {:author_content_registration_invalid, :anaphoric_current_source_requires_explicit_text}
       ) do
    "本次响应未通过契约校验：anaphoric_current_source_requires_explicit_text（作者在指代过去的资料，current 不是合法来源）。" <>
      "current 只适用于本条消息本身就是被登记原文。请选择其一：改用已列出的合法历史来源，且仅当该来源完整原文就是作者指代的资料；用 judgment_decision.explore 取证合法来源；或用 ask_author 请作者指出来源/贴出原文。" <>
      "不得把历史指令、会话摘要或保存指令当作原文，也不得先登记再说明来源不含内容。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正来源选择。"
  end

  # invalid_tool_combination 是模型最容易重复的协议错误：纠错回执必须给出可执行的
  # 合法组合指引（同源 helper），让一次纠错可修复；其它 reason 文案保持不变。
  defp correction_content(:invalid_tool_combination) do
    "本次响应未通过契约校验：invalid_tool_combination（工具组合非法）。" <>
      JudgmentToolContract.legal_combination_guidance() <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正工具组合；不要扩大操作或复述失败响应。"
  end

  defp correction_content({:invalid_tool_combination, _detail}),
    do: correction_content(:invalid_tool_combination)

  defp correction_content({:invalid_tool_arguments, detail}) do
    disallowed =
      case Map.get(detail, :disallowed, []) do
        [] -> "无"
        fields -> Enum.join(fields, "、")
      end

    missing =
      case Map.get(detail, :missing, []) do
        [] -> "无"
        fields -> Enum.join(fields, "、")
      end

    revision? =
      Map.get(detail, :tool) == "judgment_decision" and
        (Map.get(detail, :capability) == "revise_adopted_content" or
           Enum.any?(
             ["target_chapter_ref", "modification_scope"],
             &(&1 in Map.get(detail, :disallowed, []))
           ))

    example =
      if revision? do
        ~s({"action":"execute","capability":"revise_adopted_content","adopted_content_ref":"<本轮可选目标里的真实章级/pending ref>","dialogue_goal":"只改第一段，其余段落保持原样","reason":"..."})
      else
        ~s({"action":"execute","capability":"<本轮可用能力>","dialogue_goal":"...","reason":"..."})
      end

    "本次响应的工具参数未通过 schema 校验：只填该工具契约声明的字段，不要添加 action/capability/body 等未声明字段。" <>
      "上次未允许字段：#{disallowed}；缺少必填字段：#{missing}；judgment_decision 允许字段：#{Enum.join(Map.get(detail, :allowed, []), "、")}。" <>
      if revision? do
        "内容修订的 execute 必须用 adopted_content_ref（章级 ref 或 pending artifact ref，按本轮可选目标原样复制），" <>
          "范围（第一段/整章/仅排版）写在 dialogue_goal；不要在 judgment_decision 里填 target_chapter_ref/modification_scope（候选 payload 字段由产品生成）。"
      else
        ""
      end <>
      "合法最小示例：#{example}。" <>
      "report_capability_gap 只填 dialogue_goal、missing_effect、author_reasoning（optional alternative_operation_refs）；" <>
      "ask_author 只填 question、options（optional reason_codes）；" <>
      "judgment_decision 按 action 填对应字段。保留原任务、目标、来源与范围，只纠正工具参数结构。"
  end

  defp correction_content(reason) do
    "本次响应未通过契约校验：#{inspect(reason) |> String.slice(0, @error_excerpt_chars)}。" <>
      "保留同一作者输入、来源、目标、范围与权限，只纠正不合法结构；不要扩大操作或复述失败响应。"
  end

  # 探索预算用尽/伪工具文本：多给一次有界重试，避免直接终局（M03/M17 key-set）。
  defp correct_or_reject(fun, prompt, input, profile, attempt, reason, previous_tools)
       when reason in [:exploration_not_available, :judgment_narrative_required] and
              attempt < @max_attempts + 1 do
    correction = %{role: "user", content: correction_content(reason)}

    invoke(
      fun,
      %{prompt | messages: prompt.messages ++ [correction]},
      input,
      profile,
      attempt + 1,
      previous_tools
    )
  end

  defp correct_or_reject(fun, prompt, input, profile, attempt, reason, previous_tools)
       when attempt < @max_attempts do
    correction = %{role: "user", content: correction_content(reason)}

    invoke(
      fun,
      %{prompt | messages: prompt.messages ++ [correction]},
      input,
      profile,
      attempt + 1,
      previous_tools
    )
  end

  defp correct_or_reject(_, _, _, _, _, {family, _} = reason, _previous_tools)
       when family in [:author_content_registration_invalid, :pending_artifact_invalid],
       do: {:error, reason}

  defp correct_or_reject(_, _, _, _, _, {:invalid_tool_arguments, _detail}, _previous_tools),
    do: {:error, {:judgment_protocol_violation, :invalid_tool_arguments}}

  defp correct_or_reject(_, _, _, _, _, reason, _previous_tools),
    do: {:error, {:judgment_protocol_violation, reason}}

  defp validation_reason_code({:invalid_tool_arguments, _detail}), do: "invalid_tool_arguments"
  defp validation_reason_code({_, reason}) when is_atom(reason), do: Atom.to_string(reason)
  defp validation_reason_code(reason) when is_atom(reason), do: Atom.to_string(reason)
  defp validation_reason_code(_), do: "invalid_response"

  @doc "实际生产构造器；固定 schema/profile，动态事实在消息中更新。"
  def prompt(input, profile \\ :judgment) do
    %{
      messages: [%{role: "user", content: content(input, profile)}],
      tools: JudgmentToolContract.tools(profile),
      tool_choice: "auto"
    }
  end

  defp content(input, :judgment) do
    options = Map.get(input, :options, [])

    """
    本次你承担创作判断器的角色，与作者讨论并判断创作下一步。
    共同任务规则版本：#{AuthoringTaskPolicy.version()}；工具协议版本：#{JudgmentToolContract.version()}。
    #{AuthoringTaskPolicy.rules()}

    ## 当前作品与实际观察
    #{Map.get(input, :context_block, "")}

    #{chapter_revision_targets_section(options)}
    #{character_targets_section(options)}

    ## 当前可用操作（效果与权限，以本轮真实目录为准）
    #{AuthoringTaskPolicy.operations(options)}
    #{Map.get(input, :author_content_context, "")}

    ## 作者输入
    #{Map.fetch!(input, :author_text)}

    ## 来源与原文登记
    #{TurnInteractionService.author_registration_rules()}
    合法原文来源：#{Jason.encode!(["current" | Keyword.get(options, :author_content_sources, [])])}

    ## 对象与版本证据纪律（先取证/消歧，再操作）
    对象/版本操作（revise/discard/改权威版本等）只能引用本轮上下文或观察中真实列出的 ref；
    上下文没有真实 ref 时先 explore（如 session_adoptions 查候选、chapter_read/archive_read 查版本），
    或用 ask_author 具体澄清，不得编造 ref、不得用标题/记忆猜 ref。
    存在多个候选（pending_adoption_count > 1）且作者当前消息没有唯一指定对象/范围时，不得猜“最新/首条/最近讨论”，
    必须先 explore(session_adoptions) 取证或 ask_author 指出具体分歧；明确前不执行 revise。
    修改权威版本（正式开头/当前采纳版本/canon 等）前，必须有当前版本事实（先取证）或作者明确指定；
    只讨论/比较时不改变 canon，也不得把建议包装成系统已定；最终选择由作者决定。
    execute 只填一个目标 ref 字段：待采纳候选用 pending_artifact_ref，已采纳内容用 adopted_content_ref；
    不得同时填两个，也不得把候选 ref 填进 adopted_content_ref。

    ## 决策与输出契约
    普通问答或分析整段 content 就是回复，无需调工具，无固定开场或空行格式。
    需要可点击创作方向时用 propose_creative_directions；原文物化用 register_author_content；
    真实缺少操作效果用 report_capability_gap；需要作者决定仅用 ask_author，可不给选项。
    单个创作产物用 judgment_decision.execute，capability 必须在本轮目录；只读取证仅用
    judgment_decision.explore + explore_request{tool,query}，不能直接调用探索目录里的 native tool。
    只读探索当前允许：#{Keyword.get(options, :explore, false)}；目录：#{Jason.encode!(Keyword.get(options, :explore_tools, []))}。
    多个相互依赖的产物/阶段才用 judgment_decision.plan，且必须与 agent_plan_draft 同批返回。
    #{JudgmentToolContract.legal_combination_guidance()}
    内容修订（execute capability=revise_adopted_content）最小示例：
    {"action":"execute","capability":"revise_adopted_content","adopted_content_ref":"<本轮可选目标里的真实章级/pending ref>","dialogue_goal":"只改第一段，其余段落保持原样","reason":"..."}
    范围写在 dialogue_goal；不要填 target_chapter_ref/modification_scope 等候选 payload 字段（judgment_decision schema 不允许）。
    模型工具调用不代表执行授权。
    用户可见动作必须有可见文本：纯文本回复必须给出非空 content（只输出思考/占位词不算回复）；
    使用工具时 content 可为空，但 question/reason/author_reasoning 必须提供作者可见原话。
    覆盖事实约束：若本轮观测明确显示章节正文未覆盖末页（覆盖事实显示“未读>0”），
    不得声称已读全章或全章无矛盾；必须继续读取，或在结论中明确已覆盖范围与未读缺口。
    最终答复收束：content 必须是作者可直接读到的最终结论本身，不得只写内部推理、计划或过渡语
    （如“我先核对一下”“我需要给出方向”）；方向/比较/状态核对类请求的可见文本必须包含实际方向内容、
    比较依据与建议，或明确核对结论及所依据的正文证据。工具参数不能替代作者可见答复。
    用 propose_creative_directions 时 content 必须逐条写出每个方向的标题与一句话走向（至少 2 条），
    不能只概述“我给出三个方向”，也不能只把方向放进工具参数，也不能用“你的请求属于创作方向讨论”这类
    元描述代替实际方向内容。
    作者只要求收下资料/只聊不展开时：只简短确认收到，不追加下一步菜单、方向提示或可做动作清单
    （零方向菜单、零候选/登记）。
    judgment_decision 各 action 的专属字段互斥：explore 只带 explore_request（tool/query），不得带
    capability/pending_artifact_ref/adopted_content_ref；execute 只带 capability 与一个目标 ref，
    不得带 explore_request；plan 只带 plan 相关字段，不得带 explore_request 或目标 ref。
    需要作者裁决对象/来源/方向时，必须用 ask_author 工具提出具体问题（可带选项）——它是正式提问通道；
    不能用普通 reply 里的问句或说明代替 ask_author；多候选无法消歧时先 explore 或 ask_author。
    能力缺口判断只看“是否存在能产出目标效果的最接近可行操作”：存在可产出的修订/生成候选（只是不能保证
    某些属性，如仅排版的字句不变）时，应执行该操作并在可见文本如实说明限制，不得用 report_capability_gap
    或“没有能力”拒绝；确实没有任何可行操作时才报缺口。
    修改已有对象的主档案/权威字段（如把已有角色改成主角/改身份）而目录没有对应能力时，缺口说明不得把
    “新建同名对象”“演化/记忆候选”列为实现该效果的最近路径或建议——它们不改变原对象主档案，属于不同效果；
    如需提及只能明确说明差别，不能说“新建档案后他就是主角/就实现了修改”。
    系统已有的章节索引、章状态、统计、正文/档案材料不得向作者索取：能只读取证先 chapter_read/archive_read；
    无法读取时用已有索引/统计事实回答并说明证据边界。问“某章写完了吗/有无矛盾/质量如何”必须先读正文与章计划，
    不得仅凭章状态或“已保存/无待采纳候选”断言完成，也不得编造未读到的情节作为依据。
    统计/章节索引已经足够回答的问题（如“第二章写完了吗”）直接 reply，不要为形式先 explore；
    只有需要正文/章计划细节时才 chapter_read/archive_read。
    统计/索引类问题只回答进度与可核对事实；不得凭统计给质量/完成度结论（如“更像骨架/片段/未成型/
    篇幅不够=没写完”），需要质量判断时明确说明需读正文，或给下一步，而不是下结论。
    只问进度/章数/字数/是否已写/章状态（如“第二章写完了吗”）时直接按索引/统计 reply，不要 chapter_read；
    只有问质量/矛盾/计划兑现时才读正文。不得把统计本身当质量结论。
    作者明确“先别动笔/只聊/讨论/分析”且没有要求生成或登记时，属于分析任务：不得调用
    propose_creative_directions、register_author_content 或任何生成/写入操作；只在 content 给分析内容。
    分析/讨论类任务且系统已有充分事实（章节统计/索引/已给材料/最近观察）时直接 reply，
    不要为形式 explore 正文；只有质量/矛盾/覆盖结论确实需要正文时才 chapter_read/archive_read。
    工具调用必须使用原生 tool_calls；不得把“<tool_call>/<function=...>”这类伪工具文本写进 content
    （会被丢弃并触发纠错），也不得用伪工具文本代替作者可见答复。
    待采纳候选唯一且作者明确要修改它时，直接 execute revise_pending_artifact，不要先 explore；
    explore 只用于对象/版本不明；探索确认对象后必须继续执行修订，不得只描述计划或规则就结束。
    章节结构维护：作者要求“把第N卷/第N章编号理顺、只改列表编号、重编号、只修正章节序号、章节顺序编号”等
    既有结构维护时，必须用 judgment_decision.execute capability=maintain_chapter_structure（effect 仅
    display_number_only：只重编号/只改展示章号，不生成大纲、不新建章、不改 title/正文/归卷/章数）；
    不得回退为 reply/plot_outline/prose_writing，也不得生成大纲候选冒充维护。缺目标/越界/同名歧义时，
    用 ask_author 给可辨认澄清（卷/章序号或 ref）或 report_capability_gap，不得猜。
    角色主档案字段修订：作者要求“指定/改判/确立/把 <已有角色名或别名> 设为主角/反派/配角/群像”等
    已有角色叙事身份修订时，必须用 judgment_decision.execute capability=revise_character_profile，
    并逐字复制「角色索引」中该角色的 character_ref（身份只认 ref，name/aliases 仅展示与消歧）；
    只允许修订既有角色主档案 narrative_role，不新建角色、不写正文、不冒充角色演化记忆。
    同名/别名歧义不得猜：ask_author 列出候选 ref+name；不存在/越界用澄清或 report_capability_gap；
    不得回退 reply/character_evolution/character_design（“设计/创建新主角”仍走 character_design）。
    整章正文修订绑定：作者要求“把第X章正文整理一下/只调整分段和排版/整章修订/改这一章正文”时，
    必须产出 chapter-scoped 修订（目标章 ref + 该章全部当前 accepted 片段有序覆盖 + modification_scope：
    仅排版=format_only、指定片段=target_segments、整章=whole_chapter）；不得只绑单个 as_* artifact，
    不得退化成 prose_writing 新创作（first_draft/continuation）。缺章 ref 或同名章歧义时，用 ask_author
    给出可辨认澄清（章标题/序号/覆盖范围），禁止猜同名/跨作品。
    上一轮向作者提问后尚未收到作者回答/选择时，不得推进具体候选或版本：不得 execute/revise 指向某候选，
    不得规划“按某候选执行”，也不得用 report_capability_gap 代替作者回答；应保持等待、重新做具体澄清，
    或只说明仍在等待作者选择。不得把未回答当默认选择。
    作者指代“资料/原文/之前那段”且可能存在于正文时，来源探索优先 prose_search/chapter_read 查正文原文，
    不要只查 session_adoptions/memory_recall 就断定没有；探索预算内优先覆盖最可能来源。
    继续读取不是最终答复：读完后必须在本轮给出覆盖范围+结论（或明确缺口+下一步），不得只回“已继续读取/再给结论”
    这类过渡语结束。
    禁止用“-”“—”“…”或仅标点/空白的占位内容作为最终答复；覆盖不足时继续读取，或明确已覆盖范围+未读缺口+下一步。
    探索预算已用尽/不可用时不得再请求 explore；直接基于已有观察与覆盖事实 reply（已覆盖范围+结论
    或缺口+下一步），或做必要澄清。
    多意图请求（如“当前最终用哪一版”+“再写一段”）必须逐项回应：最终答复先回答版本/事实问题
    （例如当前最终版本是 EDITED_ACCEPTED 还是被 SUPERSEDED），再给生成/续写结果；不得只用“已生成草稿”结束。
    作者要求仅排版且存在可修订候选时，应执行 revise_pending_artifact（B28 format_only 边界在可见文本如实说明），
    不要只解释或报缺口。
    能力缺口优先：作者要求的效果（例如修改已有角色身份主档案、整章排版并保证字句不变）
    在当前可用操作目录里确实没有对应能力时，必须用 report_capability_gap 说明缺失效果与最近可行路径；
    不得用 ask_author 问“你要哪一种”来代替缺口报告，也不得用近似操作冒充。
    ask_author 只用于需要作者裁决方向/对象/范围且材料无法消歧，不是能力缺口的替代品。
    已有候选优先：pending_adoptions 中存在候选且本轮作者明确要对某个已有候选做修改/整理/排版/润色时，
    直接选择 revise_pending_artifact 并用 artifact_ref 引用该候选，不要先 ask_author。
    候选正文预览可能为空，不代表对象不存在——修订工具会读取真实候选全文；只有对象/范围确实无法消歧时才问。
    提供资料但只要求收下时不调工具、不生成方向/候选；保存指令不能代替被引用原文。
    """
  end

  defp content(input, :continuation) do
    """
    本次你根据真实产出与偏离判断是否继续当前任务。
    共同任务规则版本：#{AuthoringTaskPolicy.version()}；工具协议版本：#{JudgmentToolContract.version()}。
    #{AuthoringTaskPolicy.rules()}

    ## 当前目标
    #{Map.fetch!(input, :goal_text)}
    ## 偏离事实
    #{Map.fetch!(input, :deviation_summary)}
    ## 当前观察
    #{Map.get(input, :observation_block) || "（暂无观察）"}

    ## 决策与输出契约
    可以按已有事实修正时用 continuation_decision，action=continue 并给具体 guidance。
    只有需要作者决定时用 ask_author；真正缺少能力效果用 report_capability_gap。
    一次只返回一个工具，不能只给文本，不把应用故障或预算停止伪造成作者问题。
    content 可同时自然说明；空 content 时 reason/question/author_reasoning 保留作者可见原话。
    """
  end

  defp character_targets_section(options) do
    targets = Keyword.get(options, :character_targets, [])

    if is_list(targets) and targets != [] do
      lines =
        Enum.map_join(targets, "\n", fn target ->
          "- #{Map.get(target, :character_ref)}｜#{Map.get(target, :name)}｜别名：#{Enum.join(List.wrap(Map.get(target, :aliases)), "、")}｜narrative_role=#{Map.get(target, :narrative_role) || "未设置"}｜#{Map.get(target, :summary) || Map.get(target, :role) || ""}"
        end)

      "## 角色索引（已有角色；character_ref 是身份，name/aliases 仅展示与消歧）\n" <> lines
    else
      ""
    end
  end

  defp chapter_revision_targets_section(options) do
    targets = Keyword.get(options, :chapter_revision_targets, [])

    if is_list(targets) and targets != [] do
      lines =
        Enum.map_join(targets, "\n", fn target ->
          "- #{Map.get(target, :chapter_ref)}｜#{Map.get(target, :chapter_title)}｜片段数 #{Map.get(target, :fragment_count)}｜覆盖 #{Map.get(target, :coverage)}｜modification_scope 按作者要求选择：format_only=仅排版 / target_segments=指定片段 / whole_chapter=整章"
        end)

      "## 可选章级修订目标（只读；ref 唯一，title 仅展示）\n" <> lines
    else
      ""
    end
  end

  defp decode(result, profile, input, previous_tools, attempt) when is_map(result) do
    calls = field(result, :tool_calls) || []

    options =
      input
      |> Map.get(:options, [])
      |> Keyword.put(
        :author_text,
        Map.get(input, :author_text) || Map.get(input, :goal_text) || ""
      )
      |> Keyword.put(:observation_count, length(Map.get(input, :observations) || []))
      |> Keyword.put(:previous_attempt_tools, previous_tools)
      |> Keyword.put(:attempt, attempt)
      |> Keyword.put(:profile, profile)
      |> Keyword.put(
        :discussion_only,
        TurnInteractionService.discussion_only?(Map.get(input, :author_text) || "")
      )

    with :ok <- validate_tools(calls, profile),
         {:ok, operation, args, call} <- operation(calls, profile),
         :ok <- validate_character_profile_route(operation, args, options),
         {:ok, args} <- {:ok, sanitize_operation_args(operation, args, options)},
         :ok <- validate_operation(operation, args, options),
         {:ok, text, source} <- narrative(result, call, args) do
      judgment = normalized(operation, args, call, result, text, source, input)
      validate_inline_plan(judgment, input)
    end
  end

  defp decode(_, _, _, _, _), do: {:error, :invalid_judgment_result}

  defp validate_tools(calls, profile) do
    case JudgmentToolContract.validate(calls, profile) do
      {:error, :invalid_tool_arguments} -> registration_schema_error(calls, profile)
      result -> result
    end
  end

  defp registration_schema_error([call], profile) do
    args = field(call, :arguments)

    if field(call, :name) == "register_author_content" and is_map(args) and
         field(args, :author_content_source_ref) in [nil, ""] do
      {:error, {:author_content_registration_invalid, :source_required}}
    else
      invalid_tool_arguments_detail([call], profile)
    end
  end

  defp registration_schema_error(calls, profile) when is_list(calls) do
    invalid_tool_arguments_detail(calls, profile)
  end

  # B35 CP3/task-94：invalid_tool_arguments 的字段级可达反馈（只读 schema 解释，
  # 不改变 schema 允许字段/additionalProperties）。
  defp invalid_tool_arguments_detail(calls, profile) do
    schemas = Map.new(JudgmentToolContract.tools(profile), &{&1.name, &1.input_schema})

    call =
      Enum.find(calls, &(field(&1, :name) == "judgment_decision")) ||
        List.first(calls)

    args = field(call, :arguments)

    detail =
      with name when is_binary(name) <- field(call, :name),
           %{properties: properties, required: required} <- Map.get(schemas, name),
           true <- is_map(args) do
        allowed = properties |> Map.keys() |> Enum.map(&to_string/1)
        required = Enum.map(required, &to_string/1)
        present = args |> Map.keys() |> Enum.map(&to_string/1)

        %{
          tool: name,
          allowed: allowed,
          required: required,
          disallowed: Enum.reject(present, &(&1 in allowed)),
          missing: Enum.reject(required, &(&1 in present)),
          action: field(args, :action),
          capability: field(args, :capability)
        }
      else
        _ -> %{tool: field(call, :name), allowed: [], required: [], disallowed: [], missing: []}
      end

    {:error, {:invalid_tool_arguments, detail}}
  end

  defp validate_inline_plan(%{plan_result: result} = judgment, input) when is_map(result) do
    case get_in(input, [:options, :plan_run]) do
      nil ->
        {:ok, judgment}

      run ->
        with {:ok, _plan, _meta} <-
               NovelApplication.AgenticPlanDraftPlanner.plan_from_result(run, result),
             do: {:ok, judgment}
    end
  end

  defp validate_inline_plan(judgment, _input), do: {:ok, judgment}

  defp operation([], :judgment), do: {:ok, "reply", %{}, nil}

  defp operation([call], _) do
    args = field(call, :arguments)

    case field(call, :name) do
      "judgment_decision" -> {:ok, field(args, :action), args, call}
      "continuation_decision" -> {:ok, "continue", args, call}
      "ask_author" -> {:ok, "await_author", args, call}
      "register_author_content" -> {:ok, "author_content_registration", args, call}
      "propose_creative_directions" -> {:ok, "creative_directions", args, call}
      "report_capability_gap" -> {:ok, "capability_gap", args, call}
      _ -> {:error, :invalid_tool_combination}
    end
  end

  defp operation(calls, :judgment) when length(calls) == 2 do
    names = Enum.map(calls, &field(&1, :name)) |> Enum.sort()
    decision = Enum.find(calls, &(field(&1, :name) == "judgment_decision"))

    if names == ["agent_plan_draft", "judgment_decision"] and
         field(field(decision, :arguments), :action) == "plan",
       do: {:ok, "plan", field(decision, :arguments), decision},
       else: {:error, :invalid_tool_combination}
  end

  defp operation(_, _), do: {:error, :invalid_tool_combination}

  # B29 CP1（B33 整改后保留的客观检查）：execute revise_character_profile 仍校验真实目标、
  # 唯一 character_ref 与可由作者原话确定的目标叙事角色；reply/讨论/澄清不再由词法预定。
  defp validate_character_profile_route(operation, args, options) do
    if operation == "execute" and field(args, :capability) == "revise_character_profile" do
      validate_character_profile_execute(args, options, Keyword.get(options, :author_text, ""))
    else
      :ok
    end
  end

  defp validate_character_profile_execute(args, options, author_text) do
    targets = List.wrap(Keyword.get(options, :character_targets, []))
    model_ref = field(args, :character_ref)

    case CharacterProfile.narrative_role_from_text(author_text) do
      nil ->
        {:error, :invalid_character_role}

      _desired ->
        case CharacterProfile.resolve_target(author_text, targets, model_ref) do
          {:ok, _target} -> :ok
          {:error, :target_ambiguous} -> {:error, :character_target_ambiguous}
          {:error, _reason} -> {:error, :character_target_missing}
        end
    end
  end

  defp validate_operation("execute", args, options) do
    capability = field(args, :capability)

    # B33 CP2：动作意图 gate 主动纠错时明确要求「对象已知→execute」，此时不能沿用
    # M06 的“上一轮 ask 未回答不得推进”否决；否则明确动作永远无法被纠错修复。
    action_intent_retry? = Keyword.has_key?(options, :action_intent_correction_info)

    if not action_intent_retry? and
         "ask_author" in Keyword.get(options, :previous_attempt_tools, []) and
         capability in (@pending_target_capabilities ++ @adopted_target_capabilities) do
      {:error, :await_author_unanswered}
    else
      validate_execute_capability(capability, args, options)
    end
  end

  defp validate_operation("explore", args, options) do
    request = field(args, :explore_request)

    available =
      Keyword.get(options, :explore, false) and is_map(request) and
        field(request, :tool) in Keyword.get(options, :explore_tools, [])

    cond do
      # 先校验字段互斥：动作专属字段错误时给出可执行纠错（M16），再判断探索是否可用。
      not empty_targets?(args) ->
        {:error,
         {:incompatible_operation_fields,
          "explore 只提供 explore_request；capability/候选目标仅用于 execute，请保留取证意图并纠正字段。"}}

      not available ->
        {:error, :exploration_not_available}

      true ->
        :ok
    end
  end

  defp validate_operation("plan", args, _) do
    if empty_targets?(args) and is_nil(field(args, :explore_request)),
      do: :ok,
      else:
        {:error,
         {:incompatible_operation_fields,
          "plan 只带 plan 相关字段与 dialogue_goal/reason，不得携带 explore_request 或目标 ref；取证请用 explore，执行请用 execute。"}}
  end

  defp validate_operation("creative_directions", _args, options) do
    if Keyword.get(options, :discussion_only, false),
      do: {:error, :discussion_only_violation},
      else: :ok
  end

  defp validate_operation("author_content_registration", args, options) do
    if Keyword.get(options, :discussion_only, false) do
      {:error, :discussion_only_violation}
    else
      validate_author_registration(args, options)
    end
  end

  defp validate_operation("await_author", args, options) do
    values = Enum.map(field(args, :options), &field(&1, :value))

    cond do
      not (values == Enum.uniq(values) and Enum.all?(values, &(&1 == String.trim(&1)))) ->
        {:error, :question_option_values_invalid}

      # 作者指代可能已有的历史原文、只读探索可用且本轮尚无观察：先取证再问作者。
      Keyword.get(options, :explore, false) and
        Keyword.get(options, :observation_count, 0) == 0 and
          TurnInteractionService.anaphoric_reference?(Keyword.get(options, :author_text, "")) ->
        {:error, :explore_before_ask_required}

      true ->
        :ok
    end
  end

  # 缺口说明的 alternative_operation_refs 允许引用本轮真实可用的：
  # 能力目录、只读探索目录、或判断层工具（如 register_author_content）。
  # 仍然拒绝不存在的操作名（不发明操作），但不把“真实可用的下一步”误判成非法。

  defp validate_operation("capability_gap", _args, _options) do
    # 缺口说明是“如实报告”语义：alternative refs 只是最近可行路径提示，
    # 不能因模型写了带描述/不存在项而拒掉整个响应（M14 r2 终局根因）。
    :ok
  end

  defp validate_operation(_, _, _), do: :ok

  # 缺口说明的 alternative refs：过滤掉不在本轮真实目录中的项，保留可用项，
  # 不因为模型多写/写错替代项而拒绝整条响应（M14 r2 终局根因）。
  defp sanitize_operation_args("capability_gap", args, options) do
    allowed =
      Keyword.get(options, :capabilities, []) ++
        Keyword.get(options, :explore_tools, []) ++ @judgment_tool_names

    case field(args, :alternative_operation_refs) do
      refs when is_list(refs) ->
        args
        |> Map.delete("alternative_operation_refs")
        |> Map.put(:alternative_operation_refs, Enum.filter(refs, &(&1 in allowed)))

      _ ->
        args
    end
  end

  defp sanitize_operation_args(_operation, args, _options), do: args

  defp validate_author_registration(args, options) do
    TurnInteractionService.validate_author_registration(
      Map.put(args, "action", "author_content_registration"),
      Keyword.get(options, :author_content_sources, []),
      Keyword.get(options, :author_text, "")
    )
  end

  defp validate_execute_capability(capability, args, options) do
    targets =
      Map.merge(
        Keyword.get(options, :pending_artifact_targets, %{}),
        Keyword.get(options, :adopted_content_targets, %{})
      )

    cond do
      capability not in Keyword.get(options, :capabilities, []) ->
        {:error, :capability_not_available}

      not is_nil(field(args, :explore_request)) ->
        {:error,
         {:incompatible_operation_fields,
          "execute 只填 capability 与一个目标 ref（pending_artifact_ref 或 adopted_content_ref）；explore_request 只用于 explore，请移除该字段。"}}

      capability in Keyword.get(options, :readonly_capabilities, []) and
          Regex.match?(@write_intent_reason_re, field(args, :reason)) ->
        {:error, :judgment_semantic_conflict}

      true ->
        validate_execute_targets(args, targets)
    end
  end

  defp validate_execute_targets(args, targets) do
    capability = field(args, :capability)
    pending_ref = field(args, :pending_artifact_ref)
    adopted_ref = field(args, :adopted_content_ref)

    cond do
      capability in @pending_target_capabilities and not is_nil(adopted_ref) ->
        {:error, :target_ref_field_conflict}

      capability in @adopted_target_capabilities and not is_nil(pending_ref) ->
        {:error, :target_ref_field_conflict}

      true ->
        PendingArtifactWorkflow.validate(args, targets)
    end
  end

  defp empty_targets?(args),
    do:
      Enum.all?(
        [:capability, :pending_artifact_ref, :adopted_content_ref, :character_ref],
        &is_nil(field(args, &1))
      )

  defp narrative(result, call, args) do
    content = field(result, :content)

    if nonblank?(content),
      do: content_narrative(result, content),
      else: tool_narrative(result, call, args)
  end

  defp content_narrative(result, text) do
    case sanitize_visible_content(text) do
      nil ->
        {:error, :judgment_narrative_required}

      visible ->
        with {:ok, source} <- AgentNarrativeSource.from_provider_result(result, visible),
             do: {:ok, visible, source}
    end
  end

  # 厂商/网关在只有私有推理时会返回 "[assistant reasoning omitted]" 之类的占位行；
  # 它不是作者内容，不能展示、也不能当作非空回复。纯占位 → 视为空内容（走纠错），
  # 占位行+真实文本 → 去掉占位行并保留可追溯的真实字节（仍是 provider output 子串）。
  @provider_placeholder_lines [
    "[assistant reasoning omitted]",
    "[assistant reasoning internal]"
  ]

  defp sanitize_visible_content(text) when is_binary(text) do
    # 模型把工具调用写成 XML/函数字面量塞进 content（而非原生 tool_calls）时，
    # 它不是作者可见答复；不能展示，进入有界纠错要求用原生工具调用或给出真实答复。
    if raw_tool_markup?(text) do
      nil
    else
      sanitize_visible_lines(text)
    end
  end

  defp sanitize_visible_content(_text), do: nil

  defp raw_tool_markup?(text) do
    Regex.match?(~r/<\/?tool_call\b|<function=|parameter\s*=/iu, text)
  end

  defp sanitize_visible_lines(text) do
    lines = String.split(text, "\n")

    if Enum.any?(lines, &provider_placeholder_line?/1) do
      cleaned =
        lines
        |> Enum.reject(&provider_placeholder_line?/1)
        |> Enum.join("\n")
        |> String.trim()

      cond do
        cleaned == "" -> nil
        contentless?(cleaned) -> nil
        true -> cleaned
      end
    else
      # 没有占位行时保持 provider 输出字节不变（N-NARR 绑定与既有空白语义）；
      # 但纯占位/仅标点内容（如 "-"）视为空内容。
      if contentless?(text), do: nil, else: text
    end
  end

  # 仅空白/标点/符号的内容（如 "-"、"…"）不是作者可见答复，视为空内容走有界纠错。
  defp contentless?(text),
    do: String.replace(text, ~r/[\s\p{P}\p{S}]/u, "") == ""

  defp provider_placeholder_line?(line) do
    trimmed = String.trim(line)

    trimmed in @provider_placeholder_lines or
      Regex.match?(~r/^\[.*assistant reasoning.*\]$/iu, trimmed)
  end

  defp tool_narrative(_result, nil, _args), do: {:error, :judgment_narrative_required}

  defp tool_narrative(result, call, args) do
    key = narrative_field(field(call, :name))
    text = field(args, key)

    if nonblank?(text) do
      with {:ok, source} <-
             AgentNarrativeSource.from_tool_call_narrative(result, field(call, :name), text, key),
           do: {:ok, text, source}
    else
      {:error, :judgment_narrative_required}
    end
  end

  defp narrative_field("ask_author"), do: :question

  defp narrative_field(name) when name in ["judgment_decision", "continuation_decision"],
    do: :reason

  defp narrative_field(_), do: :author_reasoning
  defp nonblank?(text), do: is_binary(text) and String.trim(text) != ""

  defp normalized(operation, args, call, result, text, source, input) do
    calls = field(result, :tool_calls) || []
    plan_call = Enum.find(calls, &(field(&1, :name) == "agent_plan_draft"))

    %{
      action: operation,
      capability: field(args, :capability),
      reason: field(args, :reason) || operation,
      frame_type: frame_type(operation),
      dialogue_goal: field(args, :dialogue_goal),
      pending_artifact_ref: field(args, :pending_artifact_ref),
      adopted_content_ref: field(args, :adopted_content_ref),
      character_ref: field(args, :character_ref),
      explore_request: explore_request(field(args, :explore_request)),
      candidate_directions: field(args, :candidate_directions) || [],
      author_content_source_ref: field(args, :author_content_source_ref),
      question: field(args, :question),
      options: field(args, :options) || [],
      reason_codes: field(args, :reason_codes) || [],
      guidance: field(args, :guidance),
      missing_effect: field(args, :missing_effect),
      narrative: text,
      narrative_source: source,
      tool_call_id: field(call, :id),
      provider_result: result,
      plan_result: if(plan_call, do: Map.put(result, :tool_calls, [plan_call])),
      author_input: Map.get(input, :author_text) || Map.get(input, :goal_text),
      model_interpretation_status: if(operation == "reply", do: "not_provided", else: "provided"),
      reply_record: reply_record(operation, args, text, source, input)
    }
  end

  defp reply_record(operation, args, text, source, input) do
    observations = input[:observations] || []

    %{
      provider_call_ref: source.provider_call_ref,
      task_policy_version: AuthoringTaskPolicy.version(),
      protocol_version: JudgmentToolContract.version(),
      source_input_ref: input[:source_input_ref],
      exploration_call_count: length(observations),
      observation_refs: Enum.flat_map(observations, &(&1[:refs] || [])),
      coverage:
        Enum.map(
          observations,
          &Map.take(&1, [:tool, :chapter_ref, :prose_range, :prose_total_chars, :next_offset])
        ),
      raw_content: text
    }
    |> Map.merge(reply_kind_fields(operation, args))
    |> Map.merge(reply_provenance(input))
  end

  defp reply_kind_fields(operation, args) do
    reply? = operation == "reply"

    %{
      response_kind: if(reply?, do: "plain_text", else: "structured_tool"),
      model_interpretation_status: if(reply?, do: "not_provided", else: "provided"),
      model_interpretation: if(reply?, do: nil, else: args)
    }
  end

  # B27 §9：声明由请求构造事实派生；缺省空，旧记录不回填。
  defp reply_provenance(input) do
    %{
      supplied_context_refs: input[:supplied_context_refs] || [],
      available_context_refs: input[:available_context_refs] || [],
      supplied_observation_refs: input[:supplied_observation_refs] || [],
      unavailable_sources: input[:unavailable_sources] || [],
      rendered_context_sections: input[:rendered_context_sections] || []
    }
  end

  defp frame_type("creative_directions"), do: "creative_exploration"
  defp frame_type("capability_gap"), do: "capability_gap"
  defp frame_type(_), do: "casual_reply"
  defp explore_request(nil), do: nil
  defp explore_request(args), do: %{tool: field(args, :tool), query: field(args, :query)}
  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, to_string(key)))
  defp field(_, _), do: nil
end
