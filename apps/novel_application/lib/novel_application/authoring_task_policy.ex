defmodule NovelApplication.AuthoringTaskPolicy do
  @moduledoc """
  B27：判断/计划专业调用共用的创作任务规则。

  共享段落（作者主权/事实边界/来源/材料完整性/完成声明/输出契约/重试纪律）唯一真源为
  `NovelCommon.AuthoringSemantics.shared_rules/0`；本模块只组合判断/计划专属段与能力目录，
  不再各写一份等价文本。事实由调用者按来源投影（不在此虚构作者意图/对象/范围）。
  """

  alias NovelCommon.AuthoringSemantics

  @version "b27-task-v2"
  def version, do: @version

  @doc "判断/计划提示词使用的规则文本：共享段落（单一真源）+ 判断计划专属段。"
  def rules do
    [AuthoringSemantics.shared_rules(), judgment_rules()]
    |> Enum.join("\n")
    |> String.trim()
  end

  @doc "判断/计划专属规则（对话协作/取证/必要提问/能力缺口/自然表达）；不含作者主权等共享段。"
  def judgment_rules do
    """
    结合作者原话、近期对话、作品状态和实际结果推进当前作品，作者无需使用工具名或固定句式。
    所需事实可由已授权只读能力取得时先取证；已有足够证据则推进原任务，不机械重复读取。
    对追问、纠正和不满，结合前轮目标与真实结果继续处理；只有无法从材料消歧且影响
    方向、对象或范围的决定才问作者。只聊、先收下、不要改等本轮限制保持有效。
    角色叙事身份以「角色索引」里的 Character 主档案 narrative_role 为当前事实；记忆/摘要中的
    旧主角描述只是历史参考，不得覆盖或冒充当前字段（多主角照实全列，无主角诚实说明）。
    作者明确要求创作动作时，判断必须落到实际执行或具体澄清：写/续写/重写某章正文时，
    若已有章计划等事实足够则直接 execute prose_writing；需要计划事实时可先 explore，
    取证确认对象与必要材料齐备后必须回到execute，不能以 reply / propose_creative_directions / await_author 结束。
    作者给出条件句、否定限定或讨论语境（如“如果没有…就告诉我”“先不要生成”“只解释”“是否合理”“为什么”）时，
    按真实条件与取证结果选择：条件不成立或作者只要讨论时，直接 reply 说明结论/无需修改/无需操作，
    零候选、零写入，不把条件句当成必须执行；只有条件成立且确需产出候选时才 execute。
    判断说明要复述所依据的真实观察与条件，不得声称已检查未读材料。
    取证明确确认目标不存在或没有已采纳原文时，核查已经完成：基于这条事实reply说明缺失材料与
    下一步，或ask_author索取确实必要的对象/原文；不得重复同一查询，也不得新建内容冒充修订。
    设计一个角色时用 execute character_design（作者明确只要方向讨论/建议时除外，那走讨论回复）。
    修订某章内容且目标明确时用 execute capability=revise_adopted_content：章节级 ref 或候选 ref
    只能原样复制到 adopted_content_ref / pending_artifact_ref，范围（第一段/整章/仅排版…）写在
    dialogue_goal；judgment_decision 里不要填 target_chapter_ref、modification_scope 等候选 payload
    字段（这些由产品在候选里生成，判断工具 schema 不允许）。目标段/范围不明确时用 ask_author
    具体问清缺的对象/段，不能空泛等待。作者明确给出要替换的原文字词也可定位范围，
    不把缺少段号单独视为缺口；具体定位与保留规则见当前操作目录。作者只聊/只分析时保持讨论，不生成候选。
    作者要求根据阅读发现的内容提修订时，不把指代当原文，
    也不向作者索要内部段编号：先 chapter_read，再把观察 target_segments 的真实 segment_id
    原样填进 target_segment_ids（仅章级 revise_adopted_content）；作者已给段号/开头结尾/明确
    字面目标时省略，由系统按作者原话定位，模型提议不得覆盖写出的不存在/歧义原文。
    已采纳稿数量、材料覆盖、可编辑目标与修改授权是不同事实；覆盖完整或读取完整不等于整章授权。
    判断阶段不得声称候选已生成；只有系统返回实际候选后才可说明已生成。
    选择实际效果匹配的操作，不能用记忆更新冒充角色主档案修改、用新增大纲冒充结构维护、
    用单段修订冒充整章修订。章级仅排版由模型提出换行计划，系统从完整原文计算独立预览，
    所有非换行字节保持不变；作者采纳后才应用，不能将拒绝或生成方案说成排版已完成。
    作者要求当前系统不具备的能力时，用整体缺口说明与最近可行路径，不能用近似工具填平。
    用自然创作语言说明有用的结论、依据与下一步，不机械复述输入或报告内部形态，
    不在判断说明中提前生成应由创作能力产出的正文。所有动作均须经系统门禁放行。
    """
    |> String.trim()
  end

  @doc "仅 :judgment 输出的操作路由规则；不进入 continuation/agentic_plan 的共用 rules()。"
  def judgment_operation_rules do
    """
    系统已有的章节索引、章状态、统计、正文/档案材料不得向作者索取：能只读取证先 chapter_read/archive_read；
    无法读取时用已有索引/统计事实回答并说明证据边界。问“某章写完了吗/有无矛盾/质量如何”必须先读正文与章计划，
    不得仅凭章状态或“已保存/无待采纳候选”断言完成，也不得编造未读到的情节作为依据。
    统计/章节索引已经足够回答的问题（如“第二章写完了吗”）直接 reply，不要为形式先 explore；
    只有需要正文/章计划细节时才 chapter_read/archive_read。
    统计/索引类问题只回答进度与可核对事实；不得凭统计给质量/完成度结论（如“更像骨架/片段/未成型/
    篇幅不够=没写完”），需要质量判断时明确说明需读正文，或给下一步，而不是下结论。
    只问进度/章数/字数/是否已写/章状态（如“第二章写完了吗”）时直接按索引/统计 reply，不要 chapter_read；
    只有问质量/矛盾/计划兑现时才读正文。不得把统计本身当质量结论。
    章节结构维护：作者要求“把第N卷/第N章编号理顺、只改列表编号、重编号、只修正章节序号、章节顺序编号”等
    既有结构维护时，必须用 judgment_decision.execute capability=maintain_chapter_structure（effect 仅
    display_number_only：只重编号/只改展示章号，不生成大纲、不新建章、不改 title/正文/归卷/章数）；
    不得回退为 reply/plot_outline/prose_writing，也不得生成大纲候选冒充维护。缺目标/越界/同名歧义时，
    用 ask_author 按页面章序与章名给可辨认澄清（卷/章）或 report_capability_gap，不得猜。
    角色主档案字段修订：作者要求“指定/改判/确立/把 <已有角色名或别名> 设为主角/反派/配角/群像”等
    已有角色叙事身份修订时，必须用 judgment_decision.execute capability=revise_character_profile，
    并逐字复制「角色索引」中该角色的 character_ref（身份只认 ref，name/aliases 仅展示与消歧）；
    只允许修订既有角色主档案 narrative_role，不新建角色、不写正文、不冒充角色演化记忆。
    同名/别名歧义不得猜：ask_author 用姓名与作品内可见特征（身份/关系/最近出现处）列出候选让作者选择；
    不存在/越界用澄清或 report_capability_gap；不得回退 reply/character_evolution/character_design
    （“设计/创建新主角”仍走 character_design）。
    整章正文修订绑定：作者要求“把第X章正文整理一下/只调整分段和排版/整章修订/改这一章正文”时，
    必须产出 chapter-scoped 修订（目标章 ref + 该章全部当前 accepted 片段有序覆盖 + modification_scope：
    仅排版=format_only、指定片段=target_segments、整章=whole_chapter）；不得只绑单个 as_* artifact，
    不得退化成 prose_writing 新创作（first_draft/continuation）。缺章目标或同名章歧义时，用 ask_author
    按页面章序与章名给可辨认澄清（含覆盖范围），禁止猜同名/跨作品。
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

  def operations(options) do
    options
    |> Keyword.get(:capabilities, [])
    |> Enum.map_join("\n", &operation/1)
  end

  defp operation("work_archive_read") do
    profile = NovelAgent.AgentTaskProfileRegistry.get("readonly_batch_context_v1")
    "- work_archive_read：#{profile.effect_summary}"
  end

  defp operation("revise_adopted_content") do
    "- revise_adopted_content：仅对本轮列出的已采纳对象生成修订候选。章级目标由系统读取全部当前正文并校验基线版本；" <>
      "作者明确给出替换前后字词时，可据真实chapter_ref提出修订，系统在全文中精确匹配原文字词并定位唯一目标段，" <>
      "缺失或多处命中会拒绝，不猜段号。" <>
      "writer只生成目标段替换文本，其余正文由确定性合并逐字保留；" <>
      "整章内容修订要求完整章候选；仅分段排版由模型提出换行计划、系统生成正文预览，所有非换行字节保持不变。" <>
      "所有结果须作者采纳后才改变当前正文，生成候选不会直接写入作品。"
  end

  defp operation(name) do
    case NovelApplication.CapabilityRegistry.get(name) do
      nil ->
        "- #{name}：仅对本轮 available_operations 列出的对象可用；修订产候选，放弃仅改变候选状态。"

      entry ->
        "- #{name}：#{entry.effect_summary || entry.tool_layer}；读域=#{Enum.join(entry.read_scopes, ",")}；" <>
          "写域=#{Enum.join(entry.write_scopes, ",")}；输出契约=#{entry.output_contract_ref}；" <>
          "风险=#{entry.risk_class}；创作结果先待采纳。"
    end
  end
end
