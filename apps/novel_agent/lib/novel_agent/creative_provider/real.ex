defmodule NovelAgent.CreativeProvider.Real do
  @moduledoc """
  Real provider adapter for creative tools.

  It asks the injected LLM provider for strict JSON items and validates shape.
  It never supplies demo content or UI/adoption wording.
  """

  @behaviour NovelAgent.CreativeProvider

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result, as: ProviderResult
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

  @impl true
  def generate(%CreativeRequest{} = request, provider_execution) do
    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) ->
        result =
          request
          |> build_prompt()
          |> do_generate(result_fn, _retry? = true)

        enforce_companion_scope(result, request)

      _ ->
        provider_error(
          "provider_execution_required",
          "creative provider requires provider execution"
        )
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

  defp do_generate(prompt, result_fn, retry?) do
    case result_fn.(prompt) do
      {:ok, %ProviderResult{content: content} = result} when is_binary(content) ->
        parse_or_retry(content, provider_call_ref(result), prompt, result_fn, retry?)

      {:ok, %{content: content} = result} when is_binary(content) ->
        parse_or_retry(content, provider_call_ref(result), prompt, result_fn, retry?)

      {:ok, %{"content" => content} = result} when is_binary(content) ->
        parse_or_retry(content, provider_call_ref(result), prompt, result_fn, retry?)

      {:ok, content} when is_binary(content) ->
        parse_or_retry(content, nil, prompt, result_fn, retry?)

      {:error, error} ->
        provider_error("provider_error", inspect(error))

      other ->
        provider_error(
          "provider_response_unexpected",
          "unexpected provider return: #{inspect(other)}"
        )
    end
  end

  # 真实 LLM 偶发输出非法 JSON（长上下文下字符串值内裸换行、JSON 外多余文字等），
  # 与 Planner 的 frame JSON 重试同模式：携带失败片段重试一次，再失败才向上报错。
  defp parse_or_retry(content, provider_call_ref, prompt, result_fn, retry?) do
    result = parse_content(content, provider_call_ref)

    if retry? and invalid_json?(result) do
      prompt
      |> json_correction_prompt(content)
      |> do_generate(result_fn, false)
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

  defp json_correction_prompt(original_prompt, failed_content) do
    """
    你上一次的输出不是合法 JSON，解析失败。请严格重新输出：
    - 只返回一个合法的 JSON 数组，或一个包含 "items" 数组的 JSON 对象
    - 如果原始任务要求 self_report，必须保留 self_report 对象
    - 不要输出 JSON 以外的任何文字
    - 字符串值内的换行必须写成 \\n 转义，不能出现裸换行

    ## 你的上一次输出（截取前 300 字符）
    #{String.slice(failed_content, 0, 300)}

    ## 原始任务
    #{original_prompt}
    """
  end

  # prose_writing：写一章/一段正文，结果应是一段连贯文本，而不是多个互相竞争、
  # 各自从头另起的开头。因此要求"恰好一个连贯条目"。其余创意发散类能力（大纲、
  # 人物草案等）仍返回多个候选供作者择一。
  defp build_prompt(%CreativeRequest{tool_name: "prose_writing"} = request) do
    """
    你是小说正文写作助手。请严格按 JSON 对象格式返回，不要附加任何额外文字。

    顶层对象必须包含：
    - "items"：JSON 数组，且恰好包含一个连贯正文条目
    - "companion_artifacts"：本轮新引入且值得登记的伴生产物数组；没有则 []，不得凑数
    - "self_report"：非权威自报告对象，只供质量门和 trace 复核，不代表作品事实

    items 内的正文条目必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：本段正文的简短标题（只给一个标题，不要罗列多个备选）
    - "body"：一段连贯、完整的正文。直接写正文，不要在开头重复标题或章节名，也不要把同一情节用多个不同开头写多遍。若上下文中已给出本章前文，请在其后自然衔接续写，承接情节与人物状态，不要从头另起或重复已写内容。body 内不得出现独立的结构/状态元标签，例如“场景 2”“第2场”“第二场”“正文草稿”“待采纳草稿”“标题：”；这些只能放在 title / self_report 等结构字段里，不属于小说正文。
    - "rationale"：一句话依据（或 null）

    companion_artifacts 每项含 artifact_type/item_id/title/body/rationale。类型仅限
    character_seed、foreshadowing_seed、world_rule_seed、constraint_seed；角色可带
    narrative_role/role/aliases。只提取有依据的新事实，不重复已有事实或升级普通细节。
    rationale 写明依据；所有 item_id 唯一。
    若上下文中没有「现有角色」章节（作品尚无角色档案），必须为本段正文中每个具名
    出场人物各产出一条 character_seed（含 narrative_role），供作者把人物立进档案；
    已有「现有角色」章节时，仍只为真正新引入的人物产出 character_seed。

    self_report 必须包含以下键：
    - "assumptions"：数组；列出你为了完成正文所做的关键假设，没有则 []
    - "intended_reader_effect"：字符串或 null；概括你尝试制造的读者效果
    - "used_context_refs"：数组；列出你实际使用的上下文段名称，例如 reader_effect_brief、target_structure、continuity_summary、prior_prose
    - "risk_flags"：数组；列出可能需要作者或质量门复核的风险，没有则 []

    capability：#{request.tool_name}
    artifact_type：#{request.artifact_type}
    用户创作简述：#{request.creative_brief}
    上下文：#{request.context_text}

    重要：如果用户创作简述中出现任意随机标识符串（字母数字组合），必须在该条目的 body 或 rationale 中原样保留至少一处。
    #{execution_brief_section(request)}
    #{progress_state_section(request)}
    #{revision_section(request)}
    #{@prose_writing_guidelines}
    只返回 JSON 对象。
    """
  end

  defp build_prompt(
         %CreativeRequest{tool_name: "plot_outline", artifact_type: :outline_draft} = request
       ) do
    """
    你是长篇小说章计划助手。请严格按 JSON 数组格式返回多个章节条目，不要附加任何额外文字。

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
    - "rationale"：一句话说明该章在整体结构中的作用（或 null）

    capability：#{request.tool_name}
    artifact_type：#{request.artifact_type}
    用户创作简述：#{request.creative_brief}
    上下文：#{request.context_text}

    重要：如果用户创作简述中出现任意随机标识符串（字母数字组合），
    必须在至少一个条目的 title/body/rationale 中原样保留。
    #{progress_state_section(request)}
    #{planning_mission_section(request)}
    只返回 JSON 数组。
    """
  end

  # character_design：AI 引导的上下文感知角色设计（AU09 / `01` §3.2 结构引导 / `21` §7.2 角色对象模型）。
  # schema 是开放框架（I-g）：覆盖核心骨架维度，并据作品信息推断补充作品专属维度，不被固定字段表封死。
  defp build_prompt(%CreativeRequest{tool_name: "character_design"} = request) do
    """
    你是小说角色设计助手。请基于作品上下文为作者设计贴合本作的角色，并严格按 JSON 数组格式返回，不要附加任何额外文字。

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

    capability：#{request.tool_name}
    artifact_type：#{request.artifact_type}
    用户创作简述：#{request.creative_brief}
    上下文：#{request.context_text}

    重要：角色设计必须基于上下文中的作品背景、世界观、设定与现有角色，不要脱离本作凭空生成。如果用户创作简述中出现任意随机标识符串（字母数字组合），必须在至少一个条目的 title/body/rationale 中原样保留。

    只返回 JSON 数组。
    """
  end

  # character_evolution：更新已有角色的演化 / 当前状态 / 关系变化（AU-09 §4.5 角色记忆）。
  # 不是创建新角色，也不改主档案底座；采纳后写角色记忆（CHARACTER_PROFILE/CURRENT_STATE/RELATIONSHIP）。
  defp build_prompt(%CreativeRequest{tool_name: "character_evolution"} = request) do
    """
    你是小说角色连续性助手。作者要记录一个已有角色随剧情发生的**演化事件**（成长/转变、当前状态变化、或与其他角色的关系变化），不是创建新角色。请基于作品上下文与现有角色，生成 1 条可采纳的角色演化记忆草稿，并严格按 JSON 数组格式返回，不要附加任何额外文字。

    条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：一句话标题，点明是哪个角色的什么演化（如“林烬：黑化转向”“林烬与苏晚：结盟转敌对”）
    - "body"：具体演化事实。说明发生了什么变化、触发原因、对后续的影响；只写这次演化，不要重写整份角色档案
    - "memory_subtype"：从下列三选一——CHARACTER_PROFILE（长期设定/弧光演化）、CURRENT_STATE（当前处境/伤势/所知/所在）、RELATIONSHIP（角色间关系变化）。无法判断时省略或给 null
    - "rationale"：一句话说明该演化如何贴合剧情（或 null）

    capability：#{request.tool_name}
    artifact_type：#{request.artifact_type}
    用户创作简述：#{request.creative_brief}
    上下文：#{request.context_text}

    重要：必须基于上下文中的现有角色与剧情，不要脱离本作凭空生成；只记录演化事件，不重建主档案。如果用户创作简述中出现任意随机标识符串（字母数字组合），必须在 title/body/rationale 中原样保留。

    只返回 JSON 数组。
    """
  end

  # world_building：作品档案中的世界设定 / 伏笔 / 规则草稿。
  # 采纳后仍经 AU-09 memory governance；provider 只生成 tentative artifact。
  defp build_prompt(%CreativeRequest{tool_name: "world_building"} = request) do
    guidance = world_building_guidance(request.artifact_type)

    """
    你是小说设定与连续性设计助手。请基于作品上下文为作者生成可采纳的#{guidance.label}，并严格按 JSON 数组格式返回，不要附加任何额外文字。

    本次草稿类型：#{request.artifact_type}

    数组包含 1 个（必要时至多 2 个取向明显不同的）草稿候选，每个条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：#{guidance.title}
    - "body"：#{guidance.body}
      缺少上下文支撑的字段写“（待定）”，不要编造既有事实。
    - "rationale"：一句话说明该草稿如何贴合作品背景、当前剧情或后续创作约束（或 null）

    capability：#{request.tool_name}
    artifact_type：#{request.artifact_type}
    用户创作简述：#{request.creative_brief}
    上下文：#{request.context_text}

    重要：草稿必须基于上下文中的作品背景、世界观、设定、角色和已采纳内容。不要把 tentative 草稿说成已经生效。如果用户创作简述中出现任意随机标识符串（字母数字组合），必须在至少一个条目的 title/body/rationale 中原样保留。

    只返回 JSON 数组。
    """
  end

  defp build_prompt(%CreativeRequest{} = request) do
    """
    你是创作助手。请严格按 JSON 数组格式返回多个候选条目，不要附加任何额外文字。

    每个条目是 JSON 对象，必须包含以下键：
    - "item_id"：你生成的短标识符（不含空格）
    - "title"：简短标题
    - "body"：核心内容
    - "rationale"：一句话依据（或 null）

    capability：#{request.tool_name}
    artifact_type：#{request.artifact_type}
    用户创作简述：#{request.creative_brief}
    上下文：#{request.context_text}

    重要：如果用户创作简述中出现任意随机标识符串（字母数字组合），
    必须在至少一个条目的 title/body/rationale 中原样保留。

    只返回 JSON 数组。
    """
  end

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

  defp provider_call_ref(_), do: nil

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

  defp provider_error(code, message) do
    %CreativeProviderResult{
      status: :error,
      errors: [%{code: code, message: message}]
    }
  end
end
