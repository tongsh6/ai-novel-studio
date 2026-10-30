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
    选择实际效果匹配的操作，不能用记忆更新冒充角色主档案修改、用新增大纲冒充结构维护、
    用单段修订冒充整章修订。章级仅排版由模型提出换行计划，系统从完整原文计算独立预览，
    所有非换行字节保持不变；作者采纳后才应用，不能将拒绝或生成方案说成排版已完成。
    作者要求当前系统不具备的能力时，用整体缺口说明与最近可行路径，不能用近似工具填平。
    用自然创作语言说明有用的结论、依据与下一步，不机械复述输入或报告内部形态，
    不在判断说明中提前生成应由创作能力产出的正文。所有动作均须经系统门禁放行。
    """
    |> String.trim()
  end

  @doc "规则内容 hash：共享段或判断段变更必须改变它（供 prompt 捕获/漂移测试）。"
  def content_hash do
    @version
    |> then(&[&1, AuthoringSemantics.content_hash(), rules()])
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
      "缺失或多处命中会拒绝，不猜段号。writer只生成目标段替换文本，其余正文由确定性合并逐字保留；" <>
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
