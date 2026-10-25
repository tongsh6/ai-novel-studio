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
    所需事实可由已授权只读能力取得时先取证；已有足够证据则直接分析，不机械重复读取。
    对追问、纠正和不满，结合前轮目标与真实结果继续处理；只有无法从材料消歧且影响
    方向、对象或范围的决定才问作者。只聊、先收下、不要改等本轮限制保持有效。
    角色叙事身份以「角色索引」里的 Character 主档案 narrative_role 为当前事实；记忆/摘要中的
    旧主角描述只是历史参考，不得覆盖或冒充当前字段（多主角照实全列，无主角诚实说明）。
    作者明确要求创作动作时，判断必须落到实际执行或具体澄清：写/续写/重写某章正文时，
    若已有章计划等事实足够则直接 execute prose_writing；需要计划事实时可先 explore，
    但取证后必须回到 execute，不能以 reply / propose_creative_directions / await_author 结束。
    设计一个角色时用 execute character_design（作者明确只要方向讨论/建议时除外，那走讨论回复）。
    修订某章内容且目标明确时用 execute capability=revise_adopted_content：章节级 ref 或候选 ref
    只能原样复制到 adopted_content_ref / pending_artifact_ref，范围（第一段/整章/仅排版…）写在
    dialogue_goal；judgment_decision 里不要填 target_chapter_ref、modification_scope 等候选 payload
    字段（这些由产品在候选里生成，判断工具 schema 不允许）。目标段/范围不明确时用 ask_author
    具体问清缺的对象/段，不能空泛等待。作者只聊/只分析时保持讨论，不生成候选。
    选择实际效果匹配的操作，不能用记忆更新冒充角色主档案修改、用新增大纲冒充结构维护、
    用单段修订冒充整章修订。系统当前没有保证字句不变的独立排版能力：作者要求仅排版时，
    不要声称已完成仅排版，应说明只能生成待采纳修订候选且措辞可能变化（B28 另有完整章修订任务）。
    作者要求当前系统不具备的能力时，用整体缺口说明与最近可行路径，不能用近似工具填平。
    用自然创作语言说明有用的结论、依据与下一步，不机械复述输入或报告内部形态，
    不在判断说明中提前生成应由创作能力产出的正文。所有动作均须经系统门禁放行。
    """
    |> String.trim()
  end

  @doc """
  B33 CP2：作者原话中是否存在明确的创作动作意图（用于 judgment 输出后的有界纠错门，
  不做关键词路由器/不直接选能力）。返回 :write_chapter | :design_character |
  :revise_content | nil；讨论/询问/只聊等返回 nil。
  """
  def explicit_action_intent(text) when is_binary(text) do
    t = String.trim(text)

    cond do
      t == "" -> nil
      discussion_intent_text?(t) -> nil
      design_character_action?(t) -> :design_character
      write_chapter_action?(t) -> :write_chapter
      revise_content_action?(t) -> :revise_content
      true -> nil
    end
  end

  def explicit_action_intent(_text), do: nil

  @doc "动作意图对应的首选执行能力（纠错提示/测试用；不用于直接路由）。"
  def action_intent_capability(:write_chapter), do: "prose_writing"
  def action_intent_capability(:design_character), do: "character_design"
  def action_intent_capability(:revise_content), do: "revise_adopted_content"
  def action_intent_capability(_intent), do: nil

  @doc "动作意图的人话标签。"
  def action_intent_label(:write_chapter), do: "写/续写/重写某章正文"
  def action_intent_label(:design_character), do: "设计角色"
  def action_intent_label(:revise_content), do: "修订某章内容"
  def action_intent_label(_intent), do: "创作动作"

  defp discussion_intent_text?(text) do
    String.contains?(text, [
      "只讨论",
      "只聊",
      "先聊",
      "先讨论",
      "不要改",
      "别改",
      "不要写",
      "别写",
      "先别写",
      "先别动笔",
      "分析一下",
      "给点建议"
    ])
  end

  defp design_character_action?(text) do
    String.contains?(text, ["设计", "创建", "新增", "塑造", "加个", "加一个", "写一个"]) and
      String.contains?(text, ["主角", "反派", "配角", "角色", "人物"]) and
      not String.contains?(text, ["建议", "方向", "讨论", "是否", "怎么", "如何", "吗", "要不要", "候选"])
  end

  defp write_chapter_action?(text) do
    action_verb =
      String.contains?(text, [
        "帮我写",
        "写一下",
        "写出来",
        "续写",
        "接着写",
        "继续写",
        "往下写",
        "重写",
        "起草",
        "生成正文",
        "写第",
        "写这章",
        "写本章"
      ])

    target =
      String.contains?(text, ["正文", "章节", "章", "首稿", "这一章", "本章", "下一章"]) or
        Regex.match?(~r/第\s*[0-9一二三四五六七八九十]+\s*章/u, text)

    action_verb and target and
      not String.contains?(text, [
        "建议",
        "方向",
        "讨论",
        "是否",
        "怎么",
        "如何",
        "写完",
        "进度",
        "质量",
        "矛盾",
        "评价"
      ])
  end

  defp revise_content_action?(text) do
    verb =
      String.contains?(text, [
        "修订",
        "修改",
        "改一下",
        "改一改",
        "改改",
        "改得",
        "调整",
        "改成",
        "改为"
      ])

    target =
      String.contains?(text, ["正文", "内容", "段落", "句子", "情节", "这一章", "本章"]) or
        Regex.match?(~r/第\s*[0-9一二三四五六七八九十]+\s*章/u, text)

    verb and target and
      not String.contains?(text, ["建议", "方向", "讨论", "是否", "怎么", "如何", "吗", "不改", "别改"])
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
