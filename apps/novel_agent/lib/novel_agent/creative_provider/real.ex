defmodule NovelAgent.CreativeProvider.Real do
  @moduledoc """
  Real provider adapter for creative tools.

  `generate/2` and `generate_with_session/2,3` share one native Request IR exchange.
  Decoded native arguments are validated before normalization. They never pass
  through a second JSON-text parser or supply adoption facts.
  """

  @behaviour NovelAgent.CreativeProvider

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.NativeToolExchange
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.CreativeItemAttributes
  alias NovelCommon.Contracts.CreativeProviderResult
  alias NovelCommon.Contracts.CreativeRequest
  alias NovelCommon.Contracts.ToolArgumentSchema
  alias NovelCommon.Contracts.ToolOutputContract
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Operation

  # 正文写作质量约束（show-don't-tell / 对白个性化 / 反 AI 套话 / 节奏）。
  # 面向真实作者的写作质量要求，集中在此便于维护（如日后扩充套话黑名单）。
  # 这些约束属于完整阶段指令；动态创作简述与作品材料独立进入 scope。
  @prose_writing_guidelines """
  写作要求：
  - 用动作、神态、对白和具体细节表现情绪，禁止直接断言"他很生气""她很悲伤"这类总结句。
  - 对白要贴合各人物的性格与处境，不同人物的说话方式应有区别。
  - 避免"随着""在……中""阳光洒落""不由得""仿佛"等 AI 套话式表达。
  - 节奏紧凑，删去与情节和人物无关的环境与背景堆砌。
  - 若创作简述给出"目标字数：约 N 字"，正文篇幅应贴近该字数，不要明显过短，也不要靠重复句子注水。
  - 正文只写故事本身：不得出现"第N章"这类章节编号自指或对后文章节的预告，不得出现"待采纳""草稿""审校"等工作流程词，不要写解释正文的元评论。章节坐标与计划信息只是给你的背景，不是剧情事实。
  """

  @candidate_response_guidance "只返回 submit_tentative_artifact 的候选工具调用；content 必须为 null 或空字符串，纯空白也不允许。"

  @impl true
  def generate(%CreativeRequest{} = request, provider_execution) do
    request |> generate_with_session(provider_execution) |> elem(0)
  end

  defp enforce_artifact_shape(%CreativeProviderResult{status: :ok} = result, request) do
    case ToolOutputContract.validate_artifact_shape(
           request.artifact_type,
           result.items,
           result.companion_artifacts,
           request.task
         ) do
      :ok -> result
      {:error, error} -> provider_error(error.code, error.message)
    end
  end

  defp enforce_artifact_shape(result, _request), do: result

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

  @doc "把创作任务与前序 IR 合并为原生 tentative-artifact 请求。"
  @spec request_ir(CreativeRequest.t()) :: {:ok, RequestIR.t()} | {:error, term()}
  def request_ir(%CreativeRequest{task: %AuthoringTask{}} = request) do
    {role, domain_schema, extra} = creative_role_schema(request)

    instructions =
      [
        "#{role}只提出待作者审阅的 tentative 候选，不执行采纳或 canon 写入。",
        AuthoringSemantics.static_block(request.task),
        nonce_requirement(),
        domain_schema,
        extra
      ]
      |> Enum.reject(&(&1 in [nil, ""]))
      |> Enum.join("\n\n")

    scope = %{
      authoring_task: AuthoringTask.to_request_map(request.task),
      operation: %{
        role: "creative_execution",
        capability: request.tool_name,
        artifact_type: request.artifact_type,
        creative_brief: request.creative_brief,
        context_text: request.context_text,
        execution_brief: request.execution_brief,
        progress_state: request.progress_state,
        planning_mission: request.planning_mission,
        revision: request.revision
      }
    }

    # AuthoringTask 的 enum 是 atom；在纯值边界转成实际 JSON 标量，材料字符串字节不变。
    scope = scope |> Jason.encode!() |> Jason.decode!()

    {run, projection} = operation_context(request)
    material_refs = AuthoringTask.material_refs(request.task)

    base_materials =
      Enum.reject(request.task.materials, &(Map.get(&1, :kind) in [:observation, "observation"]))

    base_refs = AuthoringTask.material_refs(%{request.task | materials: base_materials})

    Operation.prepare(request.request_ir, run, %{
      role: "creative_execution",
      instructions: instructions,
      scope: scope,
      tool: tentative_artifact_tool(request),
      source_refs: source_refs(request, material_refs),
      base_refs: base_refs,
      versions: %{},
      author_text: request.task.author_words,
      source_input_ref: request.source_input_ref,
      projection: projection
    })
  end

  def request_ir(%CreativeRequest{}), do: {:error, :authoring_task_required}

  @doc "执行原生创作调用，返回业务结果与唯一的内部会话。"
  @spec generate_with_session(CreativeRequest.t(), Execution.dependency(), keyword()) ::
          {CreativeProviderResult.t(), map()}
  def generate_with_session(request, provider_execution, opts \\ [])

  def generate_with_session(%CreativeRequest{task: nil}, _provider_execution, _opts) do
    {provider_error("authoring_task_required", "creative provider requires an authoring task"),
     %{}}
  end

  def generate_with_session(%CreativeRequest{} = request, provider_execution, opts) do
    with true <- supported_tool?(request.tool_name),
         {:ok, ir} <- request_ir(request),
         result_fn when is_function(result_fn, 1) <- Execution.result_fn(provider_execution) do
      {result, session} =
        NativeToolExchange.run(
          ir,
          result_fn,
          "submit_tentative_artifact",
          fn result, _attempt, actual_request ->
            parse_native_result(result, request, actual_request)
          end,
          &exchange_error/2,
          opts
          |> Keyword.take([:validate_result, :max_provider_calls])
          |> Keyword.put(:feedback, &candidate_feedback/1)
        )

      {result, session}
    else
      false ->
        {provider_error("unsupported_creative_tool", "unsupported creative tool"), %{}}

      {:error, reason} ->
        {provider_error("invalid_request_ir", RequestIR.rejection_message(reason)), %{}}

      _ ->
        {provider_error("provider_execution_required", "creative provider requires execution"),
         %{}}
    end
  end

  # 独立外观（无 AgentRun / 无 durable 恢复）只是运行归属不同，不是传输能力受限：
  # 不能写入 IR.projection.finite_mode（VS-00L §6.4 只允许声明传输能力受限），否则
  # Gateway 会把正常完整传输的 creative 调用记成受限模式并误导验收读侧。standalone
  # 语义由本分支的 run 归属（仅 request_id、无 work/session）表达，不持久化传输事实。
  defp operation_context(%{request_ir: nil, run: nil, request_id: id}) do
    {%{run_id: id}, %{}}
  end

  defp operation_context(request), do: {request.run, %{}}

  defp source_refs(request, material_refs) do
    refs =
      [request.source_turn_ref | List.wrap(request.task.source_refs)]
      |> Enum.filter(&is_binary/1)
      |> Enum.uniq()

    Enum.uniq_by(material_refs ++ Enum.map(refs, &%{ref: &1}), & &1.ref)
  end

  defp tentative_artifact_tool(request) do
    %{
      name: "submit_tentative_artifact",
      description: "提出待作者审阅的创作候选；不执行采纳、不修改权威作品事实。" <> @candidate_response_guidance,
      input_schema: ToolOutputContract.creative_output_schema(request.artifact_type, request.task)
    }
  end

  # 请求构造失败用作者安全文案（不回显内部 capability atom / IR 结构）；
  # 其余工具协议错误保留内部 inspect 诊断。
  defp exchange_error("invalid_request_ir", reason),
    do: provider_error("invalid_request_ir", RequestIR.rejection_message(reason))

  defp exchange_error(code, reason),
    do: provider_error(code, inspect(reason), provider_error_type(reason))

  defp candidate_feedback(%CreativeProviderResult{errors: [error | _] = errors}) do
    %{
      reason_code: error.code,
      detail: %{errors: Enum.map(errors, &Map.take(&1, [:code, :message]))},
      message: Enum.map_join(errors, "\n", & &1.message)
    }
  end

  # 候选结构与真实材料资格各有独立输入；同一响应已证的错误一次回流，
  # 不让条目失败隐藏合法形状的引用问题，也不让坏形状进入资格推断。
  defp parse_native_result(%{tool_calls: [call]} = result, request, actual_request) do
    report = call |> map_get(:arguments) |> map_get(:self_report)
    refs_shape = ToolOutputContract.validate_creative_self_report_refs(report)

    parsed =
      result
      |> decode_native_result(request, refs_shape)
      |> enforce_companion_scope(request)
      |> enforce_artifact_shape(request)

    case used_context_ref_errors(refs_shape, report, actual_request) do
      [] -> parsed
      errors -> %CreativeProviderResult{status: :error, errors: parsed.errors ++ errors}
    end
  end

  defp used_context_ref_errors(:ok, report, actual_request) when is_map(report) do
    with used when is_list(used) <- map_get(report, :used_context_refs),
         {:error, _reason} <- RequestIR.validate_used_refs(actual_request, used) do
      [
        %{
          code: "used_context_refs_invalid",
          message: "used_context_refs 必须来自本次实际供应的 Base 或 Observation；作者消息来源、未读及其它调用的引用不具备资格"
        }
      ]
    else
      _ -> []
    end
  end

  defp used_context_ref_errors(_refs_shape, _report, _actual_request), do: []

  # 单工具交换由 NativeToolExchange 的允许响应门保证（恰好一个具名 tool call）；
  # 这里不再保留「无 tool call → 解析纯文本 JSON」的退役 fallback。
  defp decode_native_result(%{tool_calls: [call]} = result, request, refs_shape) do
    arguments = map_get(call, :arguments)

    with :ok <- validate_native_content(result),
         :ok <- refs_shape,
         true <-
           ToolArgumentSchema.valid?(
             arguments,
             ToolOutputContract.creative_output_schema(request.artifact_type, request.task)
           ),
         :ok <- validate_raw_references(arguments),
         {:ok, items} <- ToolOutputContract.validate_creative_items(map_get(arguments, :items)),
         {:ok, companions} <-
           ToolOutputContract.validate_prose_companion_artifacts(
             map_get(arguments, :companion_artifacts)
           ),
         :ok <- ToolOutputContract.validate_unique_item_ids(items, companions),
         {:ok, self_report} <-
           ToolOutputContract.normalize_creative_self_report(map_get(arguments, :self_report)) do
      call_ref = provider_call_ref(result)

      %CreativeProviderResult{
        status: :ok,
        items: put_provider_call_ref(items, call_ref),
        companion_artifacts: put_companion_provider_call_ref(companions, call_ref),
        self_report: self_report,
        provider_call_ref: call_ref
      }
    else
      false ->
        provider_error(
          "provider_response_invalid",
          "原始候选参数不符合本次工具 schema；只提交已声明字段，并遵守字段类型、必填项和嵌套形状。" <> @candidate_response_guidance
        )

      {:error, %{code: code, message: message}} ->
        provider_error(code, message)
    end
  end

  defp validate_native_content(result) do
    if Map.get(result, :content, Map.get(result, "content")) in [nil, ""],
      do: :ok,
      else: {:error, %{code: "provider_response_invalid", message: @candidate_response_guidance}}
  end

  defp validate_raw_references(arguments) do
    items = map_get(arguments, :items) ++ (map_get(arguments, :companion_artifacts) || [])

    Enum.find_value(items, fn item ->
      case CreativeItemAttributes.validate_raw_references(item) do
        :ok -> nil
        error -> error
      end
    end) || :ok
  end

  @creative_tool_names ~w(plot_outline character_design character_evolution world_building)

  # ── B27 CP3d：creative 角色模板（task 必填，角色差异保留在域段）─────────────

  defp creative_role_schema(%CreativeRequest{
         tool_name: "prose_writing",
         artifact_type: :prose_formatting_plan
       }) do
    {"本次你承担小说分段编辑的角色。",
     """
     只提出换行计划，不重写或抄录正文。应用会把计划确定性应用于绑定版本的原文，供作者预览采纳。
     items 必须只有一项：item_id 为你生成的短标识；title 为方案标题；body 为简短方案说明；rationale 为分段依据。
     同一项必须含 line_break_changes 数组，每个元素恰好是 {"boundary_id":"从上下文原样复制的边界ID","lines":2}。
     lines 只能为整数 0（取消换行）、1（换行）、2（空行分段）。只列需要改变的边界；未列边界原样保留。
     必须至少改变一处，不能把原样返回冒充完成。根据语义、对话和阅读节奏选择分段，不要逐句机械分段。
     不得编造 boundary_id，不得输出正文替换字段，不得返回伴生产物。
     """, ""}
  end

  defp creative_role_schema(%CreativeRequest{tool_name: "prose_writing"} = request) do
    extra =
      if revision?(request),
        do: @prose_writing_guidelines <> "\n" <> prose_revision_guidance(request),
        else: @prose_writing_guidelines

    {"本次你承担小说正文写作助手的角色。", prose_domain_schema(), extra}
  end

  defp creative_role_schema(%CreativeRequest{tool_name: "plot_outline"} = request) do
    role =
      if revision?(request),
        do: "本次你承担小说大纲修订助手的角色。",
        else: "本次你承担小说大纲规划助手的角色。"

    {role, outline_domain_schema(), ""}
  end

  defp creative_role_schema(%CreativeRequest{tool_name: "character_design"} = request) do
    role =
      if revision?(request),
        do: "本次你承担小说角色设定修订助手的角色。",
        else: "本次你承担小说角色设计助手的角色。"

    {role, character_design_domain_schema(), ""}
  end

  defp creative_role_schema(%CreativeRequest{tool_name: "character_evolution"}) do
    {"本次你承担小说角色连续性助手的角色。", character_evolution_domain_schema(), ""}
  end

  defp creative_role_schema(%CreativeRequest{tool_name: "world_building"} = request) do
    role =
      if revision?(request),
        do: "本次你承担小说设定修订助手的角色。",
        else: "本次你承担小说设定与连续性设计助手的角色。"

    {role, world_building_domain_schema(request), ""}
  end

  defp supported_tool?(tool), do: tool == "prose_writing" or tool in @creative_tool_names

  # 仅显式章范围补充结构字段规则；普通修订共用 AuthoringSemantics 的静态操作契约。
  defp prose_revision_guidance(request) do
    case chapter_modification_scope(request) do
      :format_only -> format_only_guidance()
      :whole_chapter -> chapter_content_guidance("整章")
      :target_segments -> target_segments_guidance()
      "target_segments" -> target_segments_guidance()
      _ -> ""
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

  # target_segments 按实际来源块映射替换；文学段落边界只属于 body 内容。
  defp target_segments_guidance do
    """
    ## 指定修订片段内容修订（target_segments）
    - 修订片段是应用按基线切分的来源块，不等同文学段落；只使用本次任务供应的片段 ID。
    - 每个 item 必须含 target_segment_ids，原样列出它替换的连续来源块，按来源顺序排列且不得重复。
    - body 是这些来源块的完整替换文本，可含多个自然段；选中整块时，仍须在 body 内保留作者要求不变的锚句。
    - 所有 items 的映射必须恰好覆盖本次目标片段；不要凭 items 的排列顺序表达映射，不输出未选片段。
    - 未指定片段由系统逐字保留；只做要求的修改，不续写，不加解释/标题/摘要/fence；创作取舍放 rationale。
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

  defp revision?(%CreativeRequest{task: %AuthoringTask{kind: :revision}}), do: true
  defp revision?(_request), do: false

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
    - "title"：本条目的大纲对象标题，按下述对应层级的形状填写
    - "body"：本条目的结构化规划内容
    - "rationale"：一句话说明该条目在整体结构中的作用（或 null）

    根据 authoring_task.author_goal 与 scope 确定本轮规划层级，只产出目标要求的对象。
    卷级规划可以仅包含卷蓝图，不必附带章计划；作者未要求新增章节时不得另造章节。

    卷蓝图条目：title 必须为“卷蓝图”；body 必须为单行，子槽用｜分隔：
    卷标题｜序号：N｜目标冲突：…｜弧光阶段：…｜地图边界：…｜支线启动：…｜支线推进：…｜支线收束：…｜高潮章：…｜爽点密度：…｜缓冲章：…｜新人物：…｜新设定：…｜新地图：…
    序号从 1 起并遵守已有卷顺序；没有依据的子槽可以省略，标签不要改写。
    高潮章/缓冲章只引用已有或本轮实际规划的章标题；仅规划卷蓝图时不得为填槽新建章节。

    章计划条目：title 为章节标题，格式建议为“第NN章：标题”；body 逐行包含以下标签：
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
    - "chapter_ref"（可选）：若该章在上下文「作品章节」索引中已存在，**逐字复制**该条目的
      `chapter_ref`（形如 `chapter:<uuid>`）；新规划的章省略该字段；不得自行编造、改写 ref，
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
    - "body"：供作者采纳的设定正文。正文形式与范围服从作者明确要求，
      不因默认领域维度补栏目或扩写。
    - "rationale"：必要的创作依据、来源说明或不确定性（或 null）；不把作者未要求的说明添进正文。

    默认领域维度（按任务需要参考，不要求逐栏输出）：#{guidance.dimensions}
    草稿必须基于上下文中的作品背景、世界观、设定、角色和已采纳内容，不编造既有事实。
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

  defp nonce_requirement do
    "如果用户创作简述中出现任意随机标识符串（字母数字组合），必须在至少一个条目的 title/body/rationale 中原样保留至少一处。"
  end

  defp world_building_guidance(type) when type in [:foreshadowing_seed, "foreshadowing_seed"] do
    %{
      label: "伏笔草稿",
      title: "伏笔标题，以“伏笔：”开头",
      dimensions: "伏笔线索 / 首次出现位置 / 推进方式 / 回收方式 / 风险与禁忌"
    }
  end

  defp world_building_guidance(type) when type in [:world_rule_seed, "world_rule_seed"] do
    %{
      label: "世界规则草稿",
      title: "世界规则标题，以“规则：”或“世界规则：”开头",
      dimensions: "世界规则 / 适用范围 / 例外条件 / 对人物选择的压力 / 与既有设定的关系"
    }
  end

  defp world_building_guidance(type) when type in [:style_rule_seed, "style_rule_seed"] do
    %{
      label: "风格规则草稿",
      title: "风格规则标题，以“风格规则：”开头",
      dimensions: "风格规则 / 适用文本范围 / 禁止事项 / 推荐写法 / 后续复核方式"
    }
  end

  defp world_building_guidance(type) when type in [:constraint_seed, "constraint_seed"] do
    %{
      label: "创作约束草稿",
      title: "约束标题，以“约束：”开头",
      dimensions: "约束内容 / 适用范围 / 禁止事项 / 例外条件 / 后续复核方式"
    }
  end

  defp world_building_guidance(_type) do
    %{
      label: "世界设定草稿",
      title: "世界设定标题，聚焦世界观、组织、地理、能力体系或背景设定",
      dimensions: "设定内容 / 适用范围 / 与既有设定的关系 / 对剧情的影响 / 待作者确认处"
    }
  end

  defp map_get(map, key) when is_map(map), do: Map.get(map, key) || Map.get(map, to_string(key))
  defp map_get(_, _), do: nil

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
