defmodule NovelAgent.CreativeProvider.Real do
  @moduledoc """
  Real provider adapter for creative tools.

  It asks the injected LLM provider for strict JSON items and validates shape.
  It never supplies demo content or UI/adoption wording.
  """

  @behaviour NovelAgent.CreativeProvider

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.CreativeProviderResult
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.Contracts.ToolOutputContract

  # 正文写作质量约束（show-don't-tell / 对白个性化 / 反 AI 套话 / 节奏）。
  # 面向真实作者的写作质量要求，集中在此便于维护（如日后扩充套话黑名单）。
  # 注意位置：必须放在 stub/slice_verify provider 解析的
  # 「用户创作简述：…上下文：…重要：」三锚点之后，否则会污染 brief/context 捕获
  # （见记忆 creative-prompt-stub-anchor-coupling）。
  @prose_writing_guidelines """
  写作要求：
  - 用动作、神态、对白和具体细节表现情绪，禁止直接断言"他很生气""她很悲伤"这类总结句。
  - 对白要贴合各人物的性格与处境，不同人物的说话方式应有区别。
  - 避免"随着""在……中""阳光洒落""不由得""仿佛"等 AI 套话式表达。
  - 节奏紧凑，删去与情节和人物无关的环境与背景堆砌。
  - 若创作简述给出"目标字数：约 N 字"，正文篇幅应贴近该字数，不要明显过短，也不要靠重复句子注水。
  - 正文只写故事本身：不得出现"第N章"这类章节编号自指或对后文章节的预告，不得出现"待采纳""草稿""审校"等工作流程词，不要写解释正文的元评论。章节坐标与计划信息只是给你的背景，不是剧情事实。
  """

  # B27 CP3d：creative provider 只接受带 AuthoringTask 的专业调用；未知工具显式失败，
  # 不再有 legacy 无 task 模板或 generic fallback。
  @impl true
  def generate(%CreativeRequest{task: nil}, _provider_execution) do
    provider_error("authoring_task_required", "creative provider requires an authoring task")
  end

  @impl true
  def generate(%CreativeRequest{tool_name: tool} = request, provider_execution) do
    if supported_tool?(tool) do
      case Execution.result_fn(provider_execution) do
        result_fn when is_function(result_fn, 1) ->
          result =
            request
            |> build_prompt()
            |> do_generate(result_fn, _retry? = true, correction_contract(request))

          enforce_companion_scope(result, request)

        _ ->
          provider_error(
            "provider_execution_required",
            "creative provider requires provider execution"
          )
      end
    else
      provider_error("unsupported_creative_tool", "unsupported creative tool: #{inspect(tool)}")
    end
  end

  defp enforce_companion_scope(
         %CreativeProviderResult{status: :ok} = result,
         %CreativeRequest{artifact_type: :prose_formatting_plan}
       ) do
    case ToolOutputContract.validate_artifact_shape(
           :prose_formatting_plan,
           result.items,
           result.companion_artifacts
         ) do
      :ok -> result
      {:error, error} -> provider_error(error.code, error.message)
    end
  end

  defp enforce_companion_scope(
         %CreativeProviderResult{status: :ok, companion_artifacts: companions} = result,
         %CreativeRequest{tool_name: "prose_writing"}
       )
       when is_list(companions),
       do: result

  defp enforce_companion_scope(
         %CreativeProviderResult{status: :ok, companion_artifacts: []} = result,
         _request
       ),
       do: result

  defp enforce_companion_scope(%CreativeProviderResult{status: :ok}, _request) do
    provider_error(
      "unexpected_companion_artifacts",
      "only prose_writing may return companion_artifacts"
    )
  end

  defp enforce_companion_scope(result, _request), do: result

  defp do_generate(prompt, result_fn, retry?, contract) do
    case result_fn.(prompt) do
      {:ok, %ProviderResult{content: content} = result} when is_binary(content) ->
        parse_or_retry(content, provider_call_ref(result), prompt, result_fn, retry?, contract)

      {:ok, %{content: content} = result} when is_binary(content) ->
        parse_or_retry(content, provider_call_ref(result), prompt, result_fn, retry?, contract)

      {:ok, %{"content" => content} = result} when is_binary(content) ->
        parse_or_retry(content, provider_call_ref(result), prompt, result_fn, retry?, contract)

      {:ok, content} when is_binary(content) ->
        parse_or_retry(content, nil, prompt, result_fn, retry?, contract)

      {:error, error} ->
        provider_error("provider_error", inspect(error), provider_error_type(error))

      other ->
        provider_error(
          "provider_response_unexpected",
          "unexpected provider return: #{inspect(other)}"
        )
    end
  end

  # 真实 LLM 偶发输出非法 JSON（长上下文下字符串值内裸换行、JSON 外多余文字等），
  # 与 Planner 的 frame JSON 重试同模式：携带失败片段重试一次，再失败才向上报错。
  defp parse_or_retry(content, provider_call_ref, prompt, result_fn, retry?, contract) do
    result = parse_content(content, provider_call_ref)

    if retry? and invalid_json?(result) do
      prompt
      |> json_correction_prompt(content, contract)
      |> do_generate(result_fn, false, contract)
    else
      result
    end
  end

  defp invalid_json?(%CreativeProviderResult{
         status: :error,
         errors: [%{code: "provider_response_invalid"} | _]
       }),
       do: true

  defp invalid_json?(_result), do: false

  # 纠错只修协议/格式，不改变输出契约：契约片段由首次请求同一 task/output_contract
  # 渲染，禁止在重试时放宽为别的结构（B27 §3.1 retry 纪律）。
  defp json_correction_prompt(original_prompt, failed_content, contract) do
    """
    你上一次的输出不是合法 JSON，解析失败。请严格按首次请求的同一输出契约重新输出完整结果：
    #{contract}
    - 不要输出 JSON 以外的任何文字
    - 字符串值内的换行必须写成 \\n 转义，不能出现裸换行

    ## 你的上一次输出（截取前 300 字符）
    #{String.slice(failed_content, 0, 300)}

    ## 原始任务
    #{original_prompt}
    """
  end

  @creative_tool_names ~w(plot_outline character_design character_evolution world_building)

  # ── B27 CP3d：creative 角色模板（task 必填，角色差异保留在域段）─────────────

  defp build_prompt(
         %CreativeRequest{tool_name: "prose_writing", artifact_type: :prose_formatting_plan} =
           request
       ) do
    render_creative_prompt(request, "本次你承担小说分段编辑的角色。", """
    只提出换行计划，不重写或抄录正文。应用会把计划确定性应用于绑定版本的原文，供作者预览采纳。
    items 必须只有一项：item_id 为你生成的短标识；title 为方案标题；body 为简短方案说明；rationale 为分段依据。
    同一项必须含 line_break_changes 数组，每个元素恰好是 {"boundary_id":"从上下文原样复制的边界ID","lines":2}。
    lines 只能为整数 0（取消换行）、1（换行）、2（空行分段）。只列需要改变的边界；未列边界原样保留。
    必须至少改变一处，不能把原样返回冒充完成。根据语义、对话和阅读节奏选择分段，不要逐句机械分段。
    不得编造 boundary_id，不得输出正文替换字段，不得返回伴生产物。
    """)
  end

  defp build_prompt(%CreativeRequest{tool_name: "prose_writing"} = request),
    do: prose_prompt(request)

  defp build_prompt(%CreativeRequest{tool_name: "plot_outline"} = request),
    do: outline_prompt(request)

  defp build_prompt(%CreativeRequest{tool_name: "character_design"} = request),
    do: character_design_prompt(request)

  defp build_prompt(%CreativeRequest{tool_name: "character_evolution"} = request),
    do: character_evolution_prompt(request)

  defp build_prompt(%CreativeRequest{tool_name: "world_building"} = request),
    do: world_building_prompt(request)

  defp supported_tool?(tool), do: tool == "prose_writing" or tool in @creative_tool_names

  defp prose_prompt(request) do
    extra =
      if revision?(request),
        do: @prose_writing_guidelines <> "\n" <> prose_revision_guidance(request),
        else: @prose_writing_guidelines

    render_creative_prompt(request, "本次你承担小说正文写作助手的角色。", prose_domain_schema(), extra: extra)
  end

  # 修订类正文：B28 CP1 按任务 modification_scope 分支渲染；
  # 基线段落/未要求修改内容必须保留，且不得把修订表达成“继续往后写”。
  defp prose_revision_guidance(request) do
    case chapter_modification_scope(request) do
      :format_only -> format_only_guidance()
      :whole_chapter -> chapter_content_guidance("整章")
      :target_segments -> target_segments_guidance()
      "target_segments" -> target_segments_guidance()
      _ -> single_revision_guidance()
    end
  end

  defp chapter_modification_scope(%CreativeRequest{task: %AuthoringTask{scope: scope}}) do
    Map.get(scope || %{}, :modification_scope) ||
      Map.get(scope || %{}, "modification_scope")
  end

  defp chapter_modification_scope(_request), do: nil

  defp format_only_guidance do
    """
    ## 整章仅排版修订（format_only）
    - 按任务给出的覆盖顺序完整输出：每个 covered 片段对应一个条目，按顺序全部输出，
      不得遗漏、合并、新增、重排片段，也不得只输出改动过的片段。
    - 只允许调整分段、标点、排版与空白；不改变任何字句。应用会按冻结归一规则（行尾空白、
      换行形式、文末空行）做字节等价校验，违反会被拒绝。
    - 不得写成续写或“继续往后写”，不得增加原文没有的内容；body 是覆盖范围内完整候选，
      修改依据放 rationale。
    """
    |> String.trim()
  end

  # B36 CP2/task-97：target_segments 与产品 writer 指令一致——只产目标段替换文本；
  # 整章/format_only 仍走 chapter_content_guidance/format_only_guidance 原语义。
  defp target_segments_guidance do
    """
    ## 指定片段/段落内容修订（target_segments）
    - 只输出目标段落的完整替换文本（可含换行）；不要输出整章、不要复述其他段落、不要加解释/标题/摘要/fence。
    - 前后段落只作为连贯上下文阅读，不得改写；未指定段落由系统逐字保留，你不需要也不得在输出里重复它们。
    - 只对作者明确指定的目标段做真实修改；不得写成续写或“继续往后写”，不得新增未要求的内容。
    - body 只放目标段的替换文本；修改依据放 rationale。
    """
    |> String.trim()
  end

  defp chapter_content_guidance(coverage_label) do
    """
    ## #{coverage_label}内容修订
    - 按任务给出的覆盖顺序输出#{coverage_label}的完整替换稿；不得只返回修改片段、摘要或旧稿对照。
    - 只改作者明确指定范围内的内容；其余段落/片段逐字保留，不得合并、删除或重排未要求的片段。
    - 不得写成续写或“继续往后写”；这是对已有正文的修订，不是新增正文。
    - body 是覆盖范围内完整候选，修改依据放 rationale。
    """
    |> String.trim()
  end

  defp single_revision_guidance do
    """
    ## 修订基线纪律
    - 以给定原稿为唯一基线：保留原稿的段落边界与未要求修改段落的字句，只改作者明确要求的部分；
      作者指定段落（如“第二段”）时，其它段落逐字保留、不得合并或拆分；修订要求中给出的
      “目标段定位”就是该段原文，必须对它做真实修改。
    - 必须输出完整修订稿：body 是包含目标段真实修改后的完整新版本；原样返回基线原文视为未执行修订。
    - 若作者要求仅排版/分段/标点（如“只调标点和分段，别改字句”）：不得改动文字内容，
      不得新增或删除段落/空行；该路径尚未接入 B28 format_only 任务时如实说明限制，不伪造完成。
    - 作者给出明确改动（如“七成改六成”、某句替换）时，修订稿必须落实该改动；
      若原稿没有对应表述而无法落实，如实说明并停止，不要输出未改动候选冒充完成。
    - 不得写成续写或“继续往后写”；body 只放完整的新版本；修改依据放 rationale。
    """
    |> String.trim()
  end

  defp outline_prompt(request) do
    role =
      if revision?(request),
        do: "本次你承担章计划修订助手的角色。",
        else: "本次你承担章计划助手的角色。"

    render_creative_prompt(request, role, outline_domain_schema())
  end

  defp character_design_prompt(request) do
    role =
      if revision?(request),
        do: "本次你承担小说角色设定修订助手的角色。",
        else: "本次你承担小说角色设计助手的角色。"

    render_creative_prompt(request, role, character_design_domain_schema())
  end

  defp character_evolution_prompt(request) do
    render_creative_prompt(
      request,
      "本次你承担小说角色连续性助手的角色。",
      character_evolution_domain_schema()
    )
  end

  defp world_building_prompt(request) do
    role =
      if revision?(request),
        do: "本次你承担小说设定修订助手的角色。",
        else: "本次你承担小说设定与连续性设计助手的角色。"

    render_creative_prompt(request, role, world_building_domain_schema(request))
  end

  # 统一的 creative prompt 骨架：L1 角色句 + 共享语义静态段 → 角色域 schema →
  # L3 材料（三锚点/执行简述/账面/使命/修订要求）→ L4 输出契约置尾。
  defp render_creative_prompt(%CreativeRequest{} = request, role, domain_schema, opts \\ []) do
    extra = Keyword.get(opts, :extra, "")

    """
    #{role}请严格按本任务输出契约返回，不要附加任何额外文字。

    #{task_blocks(request)}

    #{domain_schema}

    capability：#{request.tool_name}
    artifact_type：#{request.artifact_type}
    用户创作简述：#{request.creative_brief}
    上下文：#{request.context_text}

    重要：#{nonce_requirement()}
    #{execution_brief_section(request)}
    #{progress_state_section(request)}
    #{planning_mission_section(request)}
    #{revision_section(request)}
    #{extra}
    #{output_contract_tail(request)}
    """
    |> String.trim()
  end

  defp task_blocks(%CreativeRequest{task: %AuthoringTask{} = task}) do
    [AuthoringSemantics.static_block(task), AuthoringSemantics.dynamic_block(task)]
    |> Enum.reject(&(&1 == ""))
    |> Enum.join("\n\n")
  end

  defp revision?(%CreativeRequest{task: %AuthoringTask{kind: :revision}}), do: true
  defp revision?(_request), do: false

  # 输出契约只承诺运行时真正强制/允许的字段（Audit F05）；角色域 schema 保留在上文。
  defp output_contract_tail(%CreativeRequest{task: %AuthoringTask{} = task}) do
    contract = task.output_contract || %{}
    required = contract_map_get(contract, :required_keys) |> List.wrap() |> Enum.reject(&blank?/1)
    companions = contract_map_get(contract, :allow_companions) == true
    item_keys = Enum.reject(required, &(&1 == "items"))

    """
    输出契约（只返回 JSON，不要附加 JSON 以外的文字）：
    - 只返回 JSON 数组，或一个含 "items" 非空数组的 JSON 对象；每个 item 必须含 #{Enum.join(item_keys, "、")}。
    - 伴生产物：#{if companions, do: "允许，没有则 []", else: "不允许"}；不得为凑数引入无依据的伴生对象。
    - 本角色其余结构与字段要求见上文；字符串值内的换行必须写成 \\\\n 转义。
    """
    |> String.trim()
  end

  defp prose_domain_schema do
    """
    items 内正文条目必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：本段正文的简短标题（只给一个标题，不要罗列多个备选）
    - "body"：一段连贯、完整的正文。直接写正文，不要在开头重复标题或章节名，也不要把同一情节用多个不同开头写多遍。body 内不得出现独立的结构/状态元标签，例如“场景 2”“第2场”“第二场”“正文草稿”“待采纳草稿”“标题：”；这些只能放在 title / self_report 等结构字段里，不属于小说正文。
    - "rationale"：一句话依据（或 null）

    companion_artifacts 可为空；每项含 artifact_type/item_id/title/body/rationale。类型仅限
    character_seed、foreshadowing_seed、world_rule_seed、constraint_seed；角色可带
    narrative_role/role/aliases。只提取有依据的新事实，不重复已有事实或升级普通细节；
    所有 item_id 必须唯一。若上下文没有「现有角色」章节，建议为本段具名出场人物各产出一条
    character_seed（含 narrative_role）供作者立档；已有阵容时只为真正新引入的人物产出。
    self_report 为可选对象（assumptions/intended_reader_effect/used_context_refs/risk_flags），
    只是非权威自报告，不代表作品事实。
    """
    |> String.trim()
  end

  defp outline_domain_schema do
    """
    每个条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：章节标题，格式建议为“第NN章：标题”
    - "body"：该章的结构化方向，必须逐行包含以下标签：
      章功能定位：推进章 / 铺垫章 / 高潮章 / 过渡章 / 转折章之一或自然语言等价描述
      情节推进：本章推进什么外部事件
      人物变化：本章人物状态或关系发生什么变化
      信息释放：本章向读者释放什么信息
      伏笔动作：本章新埋、推进或回收什么伏笔
      情绪定位：本章读者应感受到的情绪
      章首拉力：开章吸引读者继续读的钩子
      章尾断章：章尾悬念、危机或期待断点
      字数与场次：建议字数与场次划分
      另可按叙事需要给出逐场计划（每场一行，1-3 行；没把握就省略场次行）：
      场次：场名｜目标：该场必须发生的改变｜议程：出场人物各自想要什么｜情绪：该场情绪基调
      可选的逐场子槽（与场次同在一行、用｜分隔；按叙事需要任选，没把握可省略，不要求每场都有）：
      阻力：该场阻力或两难｜转折：该场转折｜后果：该场后果
      读者得知：本场读者得知什么｜主角得知：本场主角得知什么｜仍隐藏：本场仍对读者/主角隐藏什么
      对白表面：对白表面在谈什么｜潜台词：对白暗里争什么
      感官：该场时空与感官锚点（如潮湿霉味、风扇噪音）
    - "rationale"：一句话说明该章在整体结构中的作用（或 null）
    - "chapter_ref"（可选）：若该章在上下文「作品章节」索引中已存在，**逐字复制**该条目的
      `chapter_ref`（形如 `chapter:<uuid>`）；新规划的章不填/留空；不得自行编造、改写 ref，
      也不得把 ref 拼进 title 或 body。只有确实复制的 ref 才能填。
    """
    |> String.trim()
  end

  defp character_design_domain_schema do
    """
    数组包含 1 个（必要时至多 2 个取向明显不同的）角色设计候选，每个条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：角色名（只给一个名字，简洁，不要罗列备选）
    - "narrative_role"：该角色的叙事功能分类，必须从下列枚举里选一个（按作者意图与该角色定位判断）：
      PROTAGONIST（主角/主人公，故事核心视角）、ANTAGONIST（反派/主要对手）、SUPPORTING（配角/重要辅助）、MINOR（次要/龙套）、ENSEMBLE_POV（群像中的并列视角主角）。
      作者明确要"设计主角/设定主角"时用 PROTAGONIST；要"加个反派"用 ANTAGONIST；无法判断时省略该键或给 null，不要硬塞。
    - "role"：一句话身份描述（用本作语境写，如「黑市调频师」「公司内审专员」）；无法判断可省略
    - "aliases"：字符串数组，该角色会用到的别称/化名/旧名（与设定有依据时才给）；没有就省略该键，不要编造
    - "body"：结构化角色档案。先逐行覆盖以下核心骨架维度（缺上下文支撑的写“（待定）”，不要编造）：
      定位：角色在故事中的功能与重要性
      动机：核心欲望、目标与恐惧
      背景：来历、身份、关键过往
      关系：与现有角色/势力的关系（参考上下文“现有角色”，避免重名与设定冲突）
      弧光：随剧情可能的成长或转变方向
      外貌：标志性外形特征
      语言风格：说话方式、口头禅或语气
      能力体系绑定：与本作世界观/能力体系的结合（若适用）
      再根据作品题材、世界观与设定自行推断补充本作特有的维度（如修仙→境界/功法/灵根；科幻→种族/科技背景；都市→职业/社会网络）。上述列表只是骨架，不要被它限制。
    - "rationale"：一句话说明该设计如何贴合作品背景/世界观/剧情（或 null）

    角色设计必须基于上下文中的作品背景、世界观、设定与现有角色，不要脱离本作凭空生成。
    """
    |> String.trim()
  end

  defp character_evolution_domain_schema do
    """
    作者要记录一个已有角色随剧情发生的**演化事件**（成长/转变、当前状态变化、或与其他角色的关系变化），
    不是创建新角色。请基于作品上下文与现有角色，生成 1 条可采纳的角色演化记忆草稿。

    条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：一句话标题，点明是哪个角色的什么演化（如“林烬：黑化转向”“林烬与苏晚：结盟转敌对”）
    - "body"：具体演化事实。说明发生了什么变化、触发原因、对后续的影响；只写这次演化，不要重写整份角色档案
    - "memory_subtype"：从下列三选一——CHARACTER_PROFILE（长期设定/弧光演化）、CURRENT_STATE（当前处境/伤势/所知/所在）、RELATIONSHIP（角色间关系变化）。无法判断时省略或给 null
    - "rationale"：一句话说明该演化如何贴合剧情（或 null）

    必须基于上下文中的现有角色与剧情，不要脱离本作凭空生成；只记录演化事件，不重建主档案。
    """
    |> String.trim()
  end

  defp world_building_domain_schema(request) do
    if revision?(request) do
      world_building_revision_schema(request.artifact_type)
    else
      world_building_creation_schema(request.artifact_type)
    end
  end

  defp world_building_creation_schema(artifact_type) do
    guidance = world_building_guidance(artifact_type)

    """
    本次草稿类型：#{artifact_type}

    数组包含 1 个（必要时至多 2 个取向明显不同的）草稿候选，每个条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：#{guidance.title}
    - "body"：#{guidance.body}
      缺少上下文支撑的字段写“（待定）”，不要编造既有事实。
    - "rationale"：一句话说明该草稿如何贴合作品背景、当前剧情或后续创作约束（或 null）

    草稿必须基于上下文中的作品背景、世界观、设定、角色和已采纳内容。
    """
    |> String.trim()
  end

  # 设定修订沿用原稿形态，不复用新建设定的模板栏目（审计 D09 行为保留）。
  defp world_building_revision_schema(artifact_type) do
    """
    本次修订类型：#{artifact_type}
    这是已有内容的新版本：按修订要求编辑给定原稿，保留原稿结构和未要求修改的内容，
    不做新建设定的模板扩写。

    每个条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：修订稿标题
    - "body"：完整修订正文；只放可供作者采纳的新版本，不添加修改说明、旧值/新值对照或保存状态说明
    - "rationale"：修改依据（或 null）

    body 与修订依据必须基于上下文中的作品背景、世界观、设定与给定原稿。
    """
    |> String.trim()
  end

  defp contract_map_get(map, key) when is_map(map) do
    Map.get(map, key) || Map.get(map, Atom.to_string(key))
  end

  defp contract_map_get(_map, _key), do: nil

  # I3 种子贯通要求：creative 模板统一从此渲染，避免同一规则手写多份（审计 X2）。
  defp nonce_requirement do
    "如果用户创作简述中出现任意随机标识符串（字母数字组合），必须在至少一个条目的 title/body/rationale 中原样保留至少一处。"
  end

  # 纠错提示里的契约片段：与首次请求同一 task/output_contract，禁止重试时改变结构。
  defp correction_contract(%CreativeRequest{task: %AuthoringTask{} = task}) do
    contract = task.output_contract || %{}

    required =
      contract |> contract_map_get(:required_keys) |> List.wrap() |> Enum.reject(&blank?/1)

    companions = contract_map_get(contract, :allow_companions) == true

    "- 结构必须与首次请求完全一致（JSON；必须字段：#{Enum.join(required, "、")}；伴生产物：#{if companions, do: "允许", else: "不允许"}）；不得改成其它结构或放宽必填字段。"
  end

  defp blank?(value), do: not is_binary(value) or String.trim(value) == ""

  # VS-00E：场级执行简述（已由 application 渲染成文本）追加在 prose 三锚点之后，
  # 不污染 stub/slice_verify 的「用户创作简述：/上下文：/重要：」捕获。缺省为空。
  defp execution_brief_section(%CreativeRequest{execution_brief: brief})
       when is_binary(brief) and brief != "" do
    "\n#{brief}\n"
  end

  defp execution_brief_section(_request), do: ""

  # VS-00F（ADR-0026）：账面投影追加在三锚点之后，不污染锚点捕获。段落文案由
  # application 按 action 渲染完成（prose=弧光+反泄漏约束；plot_outline=五账规划
  # 摘要+延续性要求，CP4a），本函数只做原样嵌入。
  defp progress_state_section(%CreativeRequest{progress_state: progress})
       when is_binary(progress) and progress != "" do
    "\n#{progress}\n"
  end

  defp progress_state_section(_request), do: ""

  # WR02（VS-00E §16.9）：规划前推理结论（本轮规划使命）——账面摘要是材料、使命是结论，
  # 相邻呈现且在输出契约之前（决策点邻近）。缺席/降级时为空段，规划 prompt 逐字节不变。
  defp planning_mission_section(%CreativeRequest{planning_mission: text})
       when is_binary(text) and text != "" do
    "\n" <> text <> "\n"
  end

  defp planning_mission_section(_request), do: ""

  # VS-00E CP3：按质量发现重写要求（已由 application 渲染成文本）追加在 prose 三锚点 +
  # execution_brief 之后，不污染锚点捕获。仅 revise_from_findings 路径非空，缺省为空。
  defp revision_section(%CreativeRequest{revision: revision})
       when is_binary(revision) and revision != "" do
    "\n#{revision}\n"
  end

  defp revision_section(_request), do: ""

  defp world_building_guidance(type) when type in [:foreshadowing_seed, "foreshadowing_seed"] do
    %{
      label: "伏笔草稿",
      title: "伏笔标题，以“伏笔：”开头",
      body: "结构化伏笔正文，逐行包含：伏笔线索 / 首次出现位置 / 推进方式 / 回收方式 / 风险与禁忌"
    }
  end

  defp world_building_guidance(type) when type in [:world_rule_seed, "world_rule_seed"] do
    %{
      label: "世界规则草稿",
      title: "世界规则标题，以“规则：”或“世界规则：”开头",
      body: "结构化世界规则正文，逐行包含：世界规则 / 适用范围 / 例外条件 / 对人物选择的压力 / 与既有设定的关系"
    }
  end

  defp world_building_guidance(type) when type in [:style_rule_seed, "style_rule_seed"] do
    %{
      label: "风格规则草稿",
      title: "风格规则标题，以“风格规则：”开头",
      body: "结构化风格规则正文，逐行包含：风格规则 / 适用文本范围 / 禁止事项 / 推荐写法 / 后续复核方式"
    }
  end

  defp world_building_guidance(type) when type in [:constraint_seed, "constraint_seed"] do
    %{
      label: "创作约束草稿",
      title: "约束标题，以“约束：”开头",
      body: "结构化约束正文，逐行包含：约束内容 / 适用范围 / 禁止事项 / 例外条件 / 后续复核方式"
    }
  end

  defp world_building_guidance(_type) do
    %{
      label: "世界设定草稿",
      title: "世界设定标题，聚焦世界观、组织、地理、能力体系或背景设定",
      body: "结构化世界设定正文，逐行包含：设定内容 / 适用范围 / 与既有设定的关系 / 对剧情的影响 / 待作者确认处"
    }
  end

  defp parse_content(content, provider_call_ref) do
    trimmed =
      content
      |> strip_code_fence()
      |> String.trim()
      |> NovelAgent.Provider.repair_unescaped_control_chars()

    with {:ok, decoded} <- Jason.decode(trimmed),
         {:ok, raw_items, raw_self_report, raw_companions} <- creative_payload(decoded),
         {:ok, items} <- ToolOutputContract.validate_creative_items(raw_items),
         {:ok, companion_artifacts} <-
           ToolOutputContract.validate_prose_companion_artifacts(raw_companions),
         :ok <- ToolOutputContract.validate_unique_item_ids(items, companion_artifacts),
         {:ok, self_report} <- ToolOutputContract.normalize_creative_self_report(raw_self_report) do
      %CreativeProviderResult{
        status: :ok,
        items: put_provider_call_ref(items, provider_call_ref),
        companion_artifacts:
          put_companion_provider_call_ref(companion_artifacts, provider_call_ref),
        self_report: self_report,
        provider_call_ref: provider_call_ref
      }
    else
      {:error, %Jason.DecodeError{} = error} ->
        provider_error(
          "provider_response_invalid",
          "JSON decode error: #{Exception.message(error)}"
        )

      {:error, %{code: code, message: message}} ->
        provider_error(code, message)

      {:error, reason} ->
        provider_error("provider_response_invalid", inspect(reason))
    end
  end

  defp creative_payload(items) when is_list(items), do: {:ok, items, nil, []}

  defp creative_payload(%{} = payload) do
    items = Map.get(payload, "items") || Map.get(payload, :items)
    self_report = Map.get(payload, "self_report") || Map.get(payload, :self_report)

    companion_artifacts =
      Map.get(payload, "companion_artifacts") || Map.get(payload, :companion_artifacts) || []

    {:ok, items, self_report, companion_artifacts}
  end

  defp creative_payload(_decoded) do
    {:error,
     %{code: "invalid_items", message: "creative tool output items must be a non-empty list"}}
  end

  defp provider_call_ref(result) when is_map(result) do
    Map.get(result, :provider_call_ref) || Map.get(result, "provider_call_ref") ||
      Map.get(result, :provider_call_id) || Map.get(result, "provider_call_id")
  end

  defp put_provider_call_ref(items, nil), do: items

  defp put_provider_call_ref(items, provider_call_ref) do
    Enum.map(items, &Map.put(&1, :provider_call_ref, provider_call_ref))
  end

  defp put_companion_provider_call_ref(items, nil), do: items

  defp put_companion_provider_call_ref(items, provider_call_ref) do
    Enum.map(items, &Map.put(&1, :provider_call_ref, provider_call_ref))
  end

  defp strip_code_fence(content) do
    content
    |> String.replace(~r/^```(?:json)?\s*/, "")
    |> String.replace(~r/```\s*$/, "")
  end

  defp provider_error(code, message, type \\ nil) do
    error = %{code: code, message: message}
    error = if is_nil(type), do: error, else: Map.put(error, :type, type)

    %CreativeProviderResult{
      status: :error,
      errors: [error]
    }
  end

  # 保留 provider 错误的机器可读类别（如 :timeout）。message 仍是 inspect 文本，
  # 但上层偏离/停等决策不应从文本里猜失败类别。
  defp provider_error_type(%{type: type}), do: type
  defp provider_error_type(%{"type" => type}), do: type
  defp provider_error_type(%{reason: reason}), do: reason
  defp provider_error_type(%{"reason" => reason}), do: reason
  defp provider_error_type(_error), do: nil
end
