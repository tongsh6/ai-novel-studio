defmodule NovelAgent.ProseQualityEvaluator do
  @moduledoc """
  独立正文质量 evaluator（VS-00E §10.4）。

  与正文 writer **职责分离**：writer 写正文，本 evaluator 只读地评审正文是否实现场级目标，
  输出**严格 JSON** 的 `QualityFinding` 列表，绝不生成修订正文、绝不修改作品事实。
  可复用 Provider Gateway（注入 provider execution），但用独立 request contract 与独立 prompt
  （不含正文三锚点）。非法 JSON 重试一次，二次失败诚实返回 error（上层记录不可用，不当通过）。
  """

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelCommon.Contracts.QualityEvaluationRequest
  alias NovelCommon.Contracts.QualityEvaluationResult

  @spec evaluate(QualityEvaluationRequest.t(), Execution.dependency()) ::
          QualityEvaluationResult.t()
  def evaluate(%QualityEvaluationRequest{} = request, provider_execution) do
    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) ->
        request
        |> build_prompt()
        |> do_evaluate(result_fn, _retry? = true)

      _ ->
        QualityEvaluationResult.error(%{
          code: "provider_execution_required",
          message: "evaluator requires provider execution"
        })
    end
  end

  defp do_evaluate(prompt, result_fn, retry?) do
    case result_fn.(prompt) do
      {:ok, %ProviderResult{content: content} = result} when is_binary(content) ->
        parse_or_retry(content, provider_call_ref(result), prompt, result_fn, retry?)

      {:ok, %{content: content} = result} when is_binary(content) ->
        parse_or_retry(content, provider_call_ref(result), prompt, result_fn, retry?)

      {:ok, content} when is_binary(content) ->
        parse_or_retry(content, nil, prompt, result_fn, retry?)

      {:error, error} ->
        QualityEvaluationResult.error(%{
          code: "evaluator_provider_error",
          message: inspect(error)
        })

      other ->
        QualityEvaluationResult.error(%{code: "evaluator_unexpected", message: inspect(other)})
    end
  end

  defp parse_or_retry(content, provider_call_ref, prompt, result_fn, retry?) do
    case parse_findings(content) do
      {:ok, findings} ->
        QualityEvaluationResult.ok(findings, provider_call_ref)

      :error when retry? ->
        prompt
        |> correction_prompt(content)
        |> do_evaluate(result_fn, false)

      :error ->
        QualityEvaluationResult.error(%{
          code: "evaluator_invalid_json",
          message: "evaluator did not return valid findings JSON"
        })
    end
  end

  defp parse_findings(content) do
    with {:ok, decoded} <- decode(content),
         findings when is_list(findings) <- extract_findings(decoded),
         true <- Enum.all?(findings, &valid_finding?/1) do
      {:ok, findings}
    else
      _ -> :error
    end
  end

  defp valid_finding?(finding) when is_map(finding) do
    non_empty_string?(finding["quality_finding_id"]) and
      non_empty_string?(finding["quality_gate_ref"]) and
      non_empty_string?(finding["validator_ref"]) and
      non_empty_string?(finding["summary"]) and
      non_empty_string?(finding["reasoning"]) and
      valid_evidence_spans?(finding["evidence_spans"]) and
      finding["impact_scope"] in ["local", "paragraph", "chapter"] and
      finding["revision_scope"] in ["local", "paragraph", "chapter"] and
      valid_confidence?(finding["confidence"])
  end

  defp valid_finding?(_finding), do: false

  defp valid_evidence_spans?(spans) when is_list(spans) and spans != [] do
    Enum.all?(spans, fn span ->
      is_map(span) and
        non_empty_string?(span["text"]) and
        positive_integer?(span["sentence_start"]) and
        positive_integer?(span["sentence_end"]) and
        span["sentence_end"] >= span["sentence_start"]
    end)
  end

  defp valid_evidence_spans?(_spans), do: false

  defp valid_confidence?(confidence) when is_number(confidence),
    do: confidence >= 0 and confidence <= 1

  defp valid_confidence?(_confidence), do: false

  defp non_empty_string?(value) when is_binary(value), do: String.trim(value) != ""
  defp non_empty_string?(_value), do: false

  defp positive_integer?(value), do: is_integer(value) and value > 0

  defp decode(content) do
    # 与 creative_provider/real.ex 同款收口（M2 长跑实测：10/12 次正文起草 JSON
    # 解析失败因模型漏转义字符串内换行）——本 evaluator 同样要求模型产出含长文本
    # 字段（summary/evidence_spans）的 JSON，同一风险面。
    repaired = NovelAgent.Provider.repair_unescaped_control_chars(content)

    case Jason.decode(repaired) do
      {:ok, value} -> {:ok, value}
      {:error, _} -> extract_json(repaired)
    end
  end

  # 真实 LLM 偶发包裹多余文字：截取第一个 JSON 对象/数组再试一次。
  defp extract_json(content) do
    case Regex.run(~r/(\{.*\}|\[.*\])/su, content) do
      [json | _] -> Jason.decode(json)
      _ -> {:error, :no_json}
    end
  end

  defp extract_findings(%{"findings" => findings}), do: findings
  defp extract_findings(findings) when is_list(findings), do: findings
  defp extract_findings(_decoded), do: :error

  defp provider_call_ref(result) when is_map(result) do
    Map.get(result, :provider_call_ref) || Map.get(result, "provider_call_ref")
  end

  defp provider_call_ref(_result), do: nil

  defp build_prompt(%QualityEvaluationRequest{} = request) do
    """
    你是小说正文质量评审助手。请只读地评审下面这段正文是否实现其写作目标，严格按 JSON
    对象返回，不要附加任何额外文字，不要重写正文。

    顶层对象必须包含 "findings"：JSON 数组，每个元素是一个发现项（只列真实存在的问题，
    没有问题则返回空数组）。每个发现项包含：
    - "quality_finding_id"：稳定 finding 标识；形式候选确认项使用 "qf_" + candidate_id
    - "candidate_id"：仅形式候选确认项填写对应 candidate_id，其他 finding 可省略
    - "quality_gate_ref"：如 quality_gate.character_logic / quality_gate.pacing /
      quality_gate.payoff_validity / quality_gate.style_fit / quality_gate.knowledge_boundary /
      quality_gate.web_hook_strength / quality_gate.power_scaling
    - "validator_ref"：如 validator.scene_change / validator.emotional_transition /
      validator.character_agency / validator.causal_progression /
      validator.setup_turn_consequence / validator.brief_alignment / validator.dialogue_intent_fit /
      validator.chapter_end_hook / validator.power_curve_consistency
    - "severity"：info | warn | high
    - "action"：warn | adoption_review | block | confirm（文学类问题用 warn/adoption_review，
      只有高置信事实冲突/认知越界才用 block/confirm；战力膨胀仅当与既有规则硬冲突才 block，
      成长过快用 confirm/adoption_review）
    - "summary"：一句话说明问题
    - "reasoning"：说明为什么这些原句构成问题；不得只复述统计信号
    - "evidence_spans"：数组，每项至少包含
      {"text": "正文中的原句", "sentence_start": 2, "sentence_end": 4}
    - "impact_scope"：local | paragraph | chapter
    - "revision_scope"：local | paragraph | chapter；默认 local，只有问题确实覆盖段落或整章
      才能扩大
    - "brief_field_refs"：数组，关联的执行简述字段（如 scene_1.emotion_transition），没有则 []
    - "confidence"：0~1 之间的小数
    - "suggested_revision"：{"instruction": "给作者的具体修订策略"}

    任务 A：局部形式候选的语义判定。
    #{form_candidates_section(request)}
    形式候选只是召回信号，不是问题结论。这里必须区分机械重复与刻意排比、回环、咒语感、
    仪式感或情绪升级。只要原句在强度、意义、视角、动作后果或情绪上形成清晰递进，就不要
    输出 finding。只有重复没有形成上述递进、读感近似模板填充时，才输出
    quality_gate.style_fit / validator.sentence_rhythm_uniformity，并沿用 candidate_id、
    位置和原句证据。禁止把此类形式问题命名为“章节节奏”。

    任务 B：章节级叙事节奏独立评审。
    #{pacing_context_section(request)}
    节奏是“实际叙事密度是否匹配本章结构功能”的相对判断，不是句长、句数、段落长度或对白
    数量统计。请对照章功能、情节推进、人物变化、信息释放、情绪目标和 hook，判断正文的
    事件密度、张力轨迹以及细写/概述选择是否匹配。只有存在具体错配且能引用正文原句时，
    才输出 quality_gate.pacing / validator.narrative_pacing_fit；影响整章时
    impact_scope/revision_scope 才可为 chapter。

    其他评审维度：场景是否产生变化、情绪转向是否有触发、人物是否有明确目标与阻力、人物行动是否
    来自选择、转折是否导致后果、信息释放是否符合执行简述、实际读者效果是否偏离目标、对话是否
    服务冲突/潜台词、结尾是否留下继续阅读的驱动力（hook，且不是虚假承诺）、能力/境界/资源/代价
    与成长路径是否符合既有规则（不跳过必要铺垫、强度不失衡）。不要仅凭关键字命中就判失败。

    #{brief_section(request)}#{reader_effect_section(request)}#{facts_section(request)}待评审正文：
    #{request.prose_text}

    只返回 JSON 对象。
    """
  end

  defp brief_section(%QualityEvaluationRequest{execution_brief: brief})
       when is_binary(brief) and brief != "" do
    "本章执行简述（评审对照）：\n#{brief}\n\n"
  end

  defp brief_section(_request), do: ""

  defp reader_effect_section(%QualityEvaluationRequest{reader_effect: effect})
       when is_binary(effect) and effect != "" do
    "读者效果目标（评审对照）：\n#{effect}\n\n"
  end

  defp reader_effect_section(_request), do: ""

  # CA02（31 §6.12 🟡 门补输入）：作品事实基线——knowledge_boundary/character_logic/
  # power_scaling 类判断据此比对，而非仅凭正文自评。缺席诚实缺席（不伪造基线）。
  defp facts_section(%QualityEvaluationRequest{facts_context: facts})
       when is_binary(facts) and facts != "" do
    "作品事实基线（作者已确认的设定/伏笔/状态/风格，评审对照；正文与之冲突属高置信问题）：\n#{facts}\n\n"
  end

  defp facts_section(_request), do: ""

  defp form_candidates_section(%QualityEvaluationRequest{form_candidates: candidates})
       when is_list(candidates) and candidates != [] do
    "待判定形式候选（JSON）：\n#{Jason.encode!(candidates)}"
  end

  defp form_candidates_section(_request), do: "本次没有形式候选；不要自行虚构形式命中。"

  defp pacing_context_section(%QualityEvaluationRequest{pacing_context: context})
       when is_map(context) and map_size(context) > 0 do
    "章节结构参照（JSON）：\n#{Jason.encode!(context)}"
  end

  defp pacing_context_section(_request),
    do: "本次缺少章节结构参照；不得输出 narrative_pacing_fit finding。"

  defp correction_prompt(original_prompt, failed_content) do
    """
    你上一次的输出不是合法且字段完整的质量评审 JSON。请严格重新输出一个包含 "findings"
    数组的 JSON 对象；每个 finding 必须包含原句证据、句子位置、判断理由、影响范围、修订
    范围和 0~1 置信度。不要输出 JSON 以外的任何文字。

    ## 你的上一次输出（截取前 300 字符）
    #{String.slice(failed_content, 0, 300)}

    ## 原始任务
    #{original_prompt}
    """
  end
end
