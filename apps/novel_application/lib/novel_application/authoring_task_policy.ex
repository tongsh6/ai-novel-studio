defmodule NovelApplication.AuthoringTaskPolicy do
  @moduledoc """
  B27：判断/计划专业调用共用的创作任务规则。

  共享段落（作者主权/事实边界/来源/材料完整性/完成声明/输出契约/重试纪律）唯一真源为
  `NovelCommon.AuthoringSemantics.shared_rules/0`；本模块只组合判断/计划专属段与能力目录，
  不再各写一份等价文本。事实由调用者按来源投影（不在此虚构作者意图/对象/范围）。
  """

  alias NovelCommon.AuthoringSemantics

  @version "b27-task-v4"
  @judgment_capabilities ~w(character_design character_evolution prose_writing plot_outline world_building work_archive_read)
  @pending_capabilities ~w(revise_pending_artifact discard_pending_artifact)
  @adopted_capabilities ~w(revise_adopted_content)
  @structure_capabilities ~w(maintain_chapter_structure)
  @character_profile_capabilities ~w(revise_character_profile)

  def version, do: @version

  @doc "判断角色支持的固定能力名称；当前许可仍由每次 Scope 与执行门禁决定。"
  @spec judgment_capabilities() :: [String.t()]
  def judgment_capabilities, do: @judgment_capabilities ++ artifact_capabilities(:all)

  @doc "候选工作流的能力分组；效果定义仍以既有能力 registry 为唯一来源。"
  @spec artifact_capabilities(:pending | :adopted | :structure | :character_profile | :all) ::
          [String.t()]
  def artifact_capabilities(:pending), do: @pending_capabilities
  def artifact_capabilities(:adopted), do: @adopted_capabilities
  def artifact_capabilities(:structure), do: @structure_capabilities
  def artifact_capabilities(:character_profile), do: @character_profile_capabilities

  def artifact_capabilities(:all),
    do:
      @pending_capabilities ++
        @adopted_capabilities ++
        @structure_capabilities ++
        @character_profile_capabilities

  @doc "判断角色固定定义的唯一渲染口；能力效果复用 registry，探索定义由现役目录传入。"
  @spec judgment_definitions([map()]) :: String.t()
  def judgment_definitions(exploration_catalog) do
    definitions = %{
      capabilities: operation_data(capabilities: judgment_capabilities()),
      exploration: exploration_catalog
    }

    "\n\n判断角色固定定义（不是当前许可；当前允许集、目标、权限和预算以最新 Scope 为准）：\n" <>
      Jason.encode!(definitions)
  end

  @doc "只校验本次目录名称属于已支持定义且不重复；权限、目标与预算仍由当前 Scope 决定。"
  @spec validate_judgment_options(keyword(), [String.t()]) :: :ok | {:error, atom()}
  def validate_judgment_options(options, exploration_tool_names) do
    if valid_names?(Keyword.get(options, :capabilities, []), judgment_capabilities()) and
         valid_names?(Keyword.get(options, :explore_tools, []), exploration_tool_names),
       do: :ok,
       else: {:error, :unsupported_judgment_capabilities}
  end

  defp valid_names?(names, supported) do
    is_list(names) and Enum.uniq(names) == names and Enum.all?(names, &(&1 in supported))
  end

  @doc "判断阶段的对象、版本与可操作范围证据纪律。"
  def judgment_scope_rules do
    """
    ## 对象与版本证据纪律（先取证/消歧，再操作）
    对象/版本操作（revise/discard/改权威版本等）只能引用本轮上下文或观察中真实列出的 ref；
    上下文没有真实 ref 时先 explore（如 session_adoptions 查候选、chapter_read/archive_read 查版本），
    或用 ask_author 具体澄清，不得编造 ref、不得用标题/记忆猜 ref。
    存在多个候选（pending_adoption_count > 1）且作者当前消息没有唯一指定对象/范围时，不得猜“最新/首条/最近讨论”，
    必须先 explore(session_adoptions) 取证或 ask_author 指出具体分歧；明确前不执行 revise。
    修改权威版本（正式开头/当前采纳版本/canon 等）前，必须有当前版本事实（先取证）或作者明确指定；
    只讨论/比较时不改变 canon，也不得把建议包装成系统已定；最终选择由作者决定。
    """
  end

  # 作者明确"只聊/先别动笔/讨论"且没有要求生成/登记时：分析类任务，不得物化候选。
  @discussion_re ~r/(先别动笔|别动笔|只聊|聊聊|先聊|讨论一下|讨论|聊聊看|分析一下|不要写|别写|不生成|别生成)/u
  @materialize_request_re ~r/(生成|写一段|写个|写一版|候选|方向|草稿|续写|改写|重写|登记|保存|存进|存到|产出)/u

  @doc false
  def discussion_only?(text) when is_binary(text) do
    Regex.match?(@discussion_re, text) and not Regex.match?(@materialize_request_re, text)
  end

  def discussion_only?(_text), do: false

  @doc "判断/计划提示词使用的规则文本：共享段落（单一真源）+ 判断计划专属段。"
  def rules do
    [AuthoringSemantics.shared_rules(), judgment_rules()]
    |> Enum.join("\n")
    |> String.trim()
  end

  @doc "判断/计划专属规则（对话协作/取证/必要提问/能力缺口/自然表达）；不含作者主权等共享段。"
  def judgment_rules do
    """
    结合作者原话、对话历史和实际结果推进当前创作目标，作者无需使用工具名或固定句式。
    作品材料只在当前目标需要时取证；当前作品身份不代表作者要求读取或沿用其中的故事。
    所需事实可由已授权只读能力取得时先取证；已有足够证据则推进原任务，不机械重复读取。
    对追问、纠正和不满，结合前轮目标与真实结果继续处理；只有无法从材料消歧且影响
    方向、对象或范围的决定才问作者。只聊、先收下、不要改等本轮限制保持有效。
    角色叙事身份以实际读取的 Character 主档案 narrative_role 为当前事实；记忆/摘要中的
    旧主角描述只是历史参考，不得覆盖或冒充当前字段（多主角照实全列，无主角诚实说明）。
    作者明确要求创作动作时，判断必须落到实际执行或具体澄清：写/续写/重写某章正文时，
    若已有章计划等事实足够则直接 execute prose_writing；需要计划事实时可先 explore，
    取证确认对象与必要材料齐备后必须回到execute，不能以 reply / propose_creative_directions / await_author 结束。
    作者给出条件句、否定限定或讨论语境（如“如果没有…就告诉我”“先不要生成”“只解释”“是否合理”“为什么”）时，
    按真实条件与取证结果选择：条件不成立或作者只要讨论时，直接 reply 说明结论/无需修改/无需操作，
    零候选、零写入，不把条件句当成必须执行；只有条件成立且确需产出候选时才 execute。
    以实际读到的材料和作者给出的条件支持创作判断；向作者交付结论或方案时，说明与当前创作问题有关的依据与边界。
    不得声称已检查未读材料。
    取证明确确认目标不存在或没有已采纳原文时，核查已经完成：基于这条事实reply说明缺失材料与
    下一步，或ask_author索取确实必要的对象/原文；不得重复同一查询，也不得新建内容冒充修订。
    设计一个角色时用 execute character_design（作者明确只要方向讨论/建议时除外，那走讨论回复）。
    修订某章内容且目标明确时用 execute capability=revise_adopted_content，按判断工具契约
    选择真实章对象和修改范围，具体目标与保留要求写入 dialogue_goal。范围有实质歧义时用 ask_author。
    局部修订无论由段号、原文字词还是阅读发现定位，都先 chapter_read，再选择真实观察的片段；
    不存在或有歧义的目标不得换成其他对象，也不要向作者索要内部段编号。
    作者只要求改变换行时，所有非换行字节保持不变；改标点不属于仅换行。
    候选再次修订沿用其既有范围，不能借本轮判断扩展。作者只聊/只分析时保持讨论，不生成候选。
    已采纳稿数量、材料覆盖、可编辑目标与修改授权是不同事实；覆盖完整或读取完整不等于整章授权。
    判断阶段不得声称候选已生成；只有系统返回实际候选后才可说明已生成。
    选择实际效果匹配的操作，不能用记忆更新冒充角色主档案修改、用新增大纲冒充结构维护、
    用单段修订冒充整章修订。章级仅排版由模型提出换行计划，系统从完整原文计算独立预览，
    所有非换行字节保持不变；作者采纳后才应用，不能将拒绝或生成方案说成排版已完成。
    作者要求当前系统不具备的能力时，用整体缺口说明与最近可行路径，不能用近似工具填平。
    #{AuthoringSemantics.author_narrative_rules()}
    不在判断说明中提前生成应由创作能力产出的正文。所有动作均须经系统门禁放行。
    """
    |> String.trim()
  end

  @doc "仅 :judgment 输出的操作路由规则；不进入 continuation/agentic_plan 的共用 rules()。"
  def judgment_operation_rules do
    """
    固定能力与探索目录只说明定义，不授予执行权限；当前 Scope 的允许集、目标、权限和预算才是本轮边界。
    作者需要作品事实时，系统可读的章节目录、章状态、统计、正文/档案材料不得转向作者索取：
    未提供的目录/统计先 archive_read，必要正文与章计划先 chapter_read；不能将未提供材料说成空或不存在。
    实际已读目录/统计足够回答章数、字数或是否已有正文时直接 reply，不为形式重复读取。
    统计只证明进度与可核对状态，不能单凭章状态或“已保存/无待采纳候选”断言叙事完成、质量或无矛盾；
    这些判断需要相应正文与章计划证据，不得编造未读情节。
    章节结构维护：作者要求“把第N卷/第N章编号理顺、只改列表编号、重编号、只修正章节序号、章节顺序编号”等
    既有结构维护时，必须用 judgment_decision.execute capability=maintain_chapter_structure（effect 仅
    display_number_only：只重编号/只改展示章号，不生成大纲、不新建章、不改 title/正文/归卷/章数）；
    不得回退为 reply/plot_outline/prose_writing，也不得生成大纲候选冒充维护。缺目标/越界/同名歧义时，
    用 ask_author 按页面章序与章名给可辨认澄清（卷/章）或 report_capability_gap，不得猜。
    角色主档案字段修订：作者要求“指定/改判/确立/把 <已有角色名或别名> 设为主角/反派/配角/群像”等
    已有角色叙事身份修订时，必须用 judgment_decision.execute capability=revise_character_profile，
    先 archive_read 发现并读取目标角色详情，再逐字复制该真实观察的 character_ref 与当前基线；
    目录只供发现与消歧，name/aliases 不替代 ref，也不授予未读详情的修改资格。
    只允许修订既有角色主档案 narrative_role，不新建角色、不写正文、不冒充角色演化记忆。
    同名/别名歧义不得猜：ask_author 用姓名与作品内可见特征（身份/关系/最近出现处）列出候选让作者选择；
    不存在/越界用澄清或 report_capability_gap；不得回退 reply/character_evolution/character_design
    （“设计/创建新主角”仍走 character_design）。
    章正文修订绑定同一作品的真实章身份和当前完整已采纳基线，并按作者要求限定修改范围；
    不得以单个 artifact 冒充整章，不得退化成首稿或续写。缺章目标或同名章歧义时，
    用 ask_author 按页面章序与章名给可辨认澄清，禁止猜同名或跨作品对象。
    需要作者裁决对象/来源/方向时，必须用 ask_author 工具提出具体问题（可带选项）——它是正式提问通道；
    不能用普通 reply 里的问句或说明代替 ask_author；多候选无法消歧时先 explore 或 ask_author。
    作者指代“资料/原文/之前那段”且可能存在于正文时，来源探索优先 prose_search/chapter_read 查正文原文，
    不要只查 session_adoptions/memory_recall 就断定没有；探索预算内优先覆盖最可能来源。
    """
    |> String.trim()
  end

  @doc "规则内容 hash：共享段、判断段或判断操作段变更必须改变它（供 prompt 捕获/漂移测试）。"
  def content_hash do
    @version
    |> then(&[&1, AuthoringSemantics.content_hash(), rules(), judgment_operation_rules()])
    |> Enum.join("\n---\n")
    |> then(&(:sha256 |> :crypto.hash(&1) |> Base.encode16(case: :lower)))
  end

  @doc "当前真实能力目录的结构投影；名称与效果仍来自既有 registry。"
  def operation_data(options) do
    Enum.map(Keyword.get(options, :capabilities, []), fn name ->
      case NovelApplication.CapabilityRegistry.get(name) do
        nil ->
          %{name: name, effect_summary: operation(name)}

        entry ->
          entry
          |> Map.take([
            :effect_summary,
            :read_scopes,
            :write_scopes,
            :output_contract_ref,
            :risk_class
          ])
          |> Map.put(:name, name)
      end
    end)
  end

  defp operation("work_archive_read") do
    profile = NovelAgent.AgentTaskProfileRegistry.get("readonly_batch_context_v1")
    "- work_archive_read：#{profile.effect_summary}"
  end

  defp operation(name) do
    case NovelApplication.CapabilityRegistry.get(name) do
      nil ->
        "- #{name}：仅在本轮 available_operations 允许该能力且对应目标检查通过时可用；修订产候选，放弃仅改变候选状态。"

      entry ->
        "- #{name}：#{entry.effect_summary || entry.tool_layer}；读域=#{Enum.join(entry.read_scopes, ",")}；" <>
          "写域=#{Enum.join(entry.write_scopes, ",")}；输出契约=#{entry.output_contract_ref}；" <>
          "风险=#{entry.risk_class}；创作结果先待采纳。"
    end
  end
end
