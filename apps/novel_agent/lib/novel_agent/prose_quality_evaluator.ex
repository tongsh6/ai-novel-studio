defmodule NovelAgent.ProseQualityEvaluator do
  @moduledoc """
  独立正文质量 evaluator（VS-00E §10.4）。

  与正文 writer **职责分离**：writer 写正文，本 evaluator 只读地评审正文是否实现场级目标，
  通过原生 `report_quality_findings` 工具返回 `QualityFinding`，绝不生成修订正文或修改作品事实。
  质量 scope 追加到当前 canonical Request IR；没有前序 IR 时创建独立评审会话。旧 JSON
  仅作为显式有限模式；有界协议纠错后仍失败则诚实返回 error，不冒充复核通过。
  """

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.NativeToolExchange
  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.RequestIR.Operation
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.QualityEvaluationRequest
  alias NovelCommon.Contracts.QualityEvaluationResult

  @spec evaluate(QualityEvaluationRequest.t(), Execution.dependency()) ::
          QualityEvaluationResult.t()
  # B27 CP3d：质量评审强制携带 AuthoringTask（材料覆盖/范围由任务语义声明）。
  def evaluate(%QualityEvaluationRequest{task: nil}, _provider_execution) do
    QualityEvaluationResult.error(%{
      code: "authoring_task_required",
      message: "quality evaluation requires an authoring task"
    })
  end

  def evaluate(%QualityEvaluationRequest{} = request, provider_execution) do
    request |> evaluate_with_session(provider_execution) |> elem(0)
  end

  @doc "把质量任务叠加到既有创作 IR，使用独立的只读评审工具。"
  @spec request_ir(QualityEvaluationRequest.t()) :: {:ok, RequestIR.t()} | {:error, term()}
  def request_ir(%QualityEvaluationRequest{task: %AuthoringTask{} = task} = request) do
    instructions =
      [
        "本次你承担小说正文质量评审助手的角色。只读评审，不重写正文，不修改作品事实。",
        AuthoringSemantics.static_block(task),
        findings_contract()
      ]
      |> Enum.join("\n\n")

    scope =
      [
        material_coverage_statement(task),
        AuthoringSemantics.dynamic_block(task),
        review_tasks(request),
        brief_section(request),
        scene_units_section(request),
        facts_section(request),
        "待评审正文：\n#{request.prose_text}"
      ]
      |> Enum.reject(&(&1 in [nil, ""]))
      |> Enum.join("\n")

    {run, projection} = operation_context(request)

    Operation.prepare(request.request_ir, run, %{
      role: "quality_evaluation",
      instructions: instructions,
      scope: scope,
      tool: quality_findings_tool(),
      source_refs: quality_source_refs(request),
      versions: %{},
      author_text: task.author_words,
      projection: projection
    })
  end

  def request_ir(%QualityEvaluationRequest{}), do: {:error, :authoring_task_required}

  @doc "执行原生质量评审，返回 findings 与追加后的内部会话。"
  @spec evaluate_with_session(QualityEvaluationRequest.t(), Execution.dependency()) ::
          {QualityEvaluationResult.t(), map()}
  def evaluate_with_session(%QualityEvaluationRequest{task: nil}, _provider_execution) do
    {QualityEvaluationResult.error(%{code: "authoring_task_required", message: "task required"}),
     %{}}
  end

  def evaluate_with_session(%QualityEvaluationRequest{} = request, provider_execution) do
    with {:ok, ir} <- request_ir(request),
         result_fn when is_function(result_fn, 1) <- Execution.result_fn(provider_execution) do
      NativeToolExchange.run(
        ir,
        result_fn,
        "report_quality_findings",
        &parse_native_result/1,
        &exchange_error/2
      )
    else
      {:error, reason} ->
        {QualityEvaluationResult.error(%{code: "invalid_request_ir", message: inspect(reason)}),
         %{}}

      _ ->
        {QualityEvaluationResult.error(%{
           code: "provider_execution_required",
           message: "evaluator requires provider execution"
         }), %{}}
    end
  end

  defp operation_context(%{request_ir: nil, run: nil, request_id: id}) do
    {%{run_id: id}, %{finite_mode: %{name: "standalone_operation", durable_recovery: false}}}
  end

  defp operation_context(request), do: {request.run, %{}}

  defp quality_source_refs(request) do
    [request.source_turn_ref, request.source_ref | List.wrap(request.task.source_refs)]
    |> Enum.filter(&is_binary/1)
    |> Enum.uniq()
    |> Enum.map(&%{ref: &1})
  end

  defp quality_findings_tool do
    %{
      name: "report_quality_findings",
      description: "只读报告正文质量发现及原句证据，不重写正文或授权修订。",
      input_schema: %{
        type: "object",
        required: ["findings"],
        properties: %{
          findings: %{
            type: "array",
            items: %{
              type: "object",
              required: [
                "quality_finding_id",
                "quality_gate_ref",
                "validator_ref",
                "summary",
                "reasoning",
                "evidence_spans",
                "impact_scope",
                "revision_scope",
                "confidence"
              ],
              properties: %{
                quality_finding_id: %{type: "string", minLength: 1},
                quality_gate_ref: %{type: "string", minLength: 1},
                validator_ref: %{type: "string", minLength: 1},
                summary: %{type: "string", minLength: 1},
                reasoning: %{type: "string", minLength: 1},
                evidence_spans: %{
                  type: "array",
                  minItems: 1,
                  items: %{
                    type: "object",
                    required: ["text", "sentence_start", "sentence_end"],
                    properties: %{
                      text: %{type: "string", minLength: 1},
                      sentence_start: %{type: "integer", minimum: 1},
                      sentence_end: %{type: "integer", minimum: 1}
                    },
                    additionalProperties: false
                  }
                },
                impact_scope: %{type: "string", enum: ["local", "paragraph", "chapter"]},
                revision_scope: %{type: "string", enum: ["local", "paragraph", "chapter"]},
                confidence: %{type: "number", minimum: 0, maximum: 1}
              },
              additionalProperties: true
            }
          }
        },
        additionalProperties: false
      }
    }
  end

  defp exchange_error("provider_error", reason),
    do:
      QualityEvaluationResult.error(%{code: "evaluator_provider_error", message: inspect(reason)})

  defp exchange_error("provider_response_unexpected", reason),
    do: QualityEvaluationResult.error(%{code: "evaluator_unexpected", message: inspect(reason)})

  defp exchange_error(code, reason),
    do: QualityEvaluationResult.error(%{code: code, message: inspect(reason)})

  defp parse_native_result(result) do
    call =
      result
      |> Map.get(:tool_calls, Map.get(result, "tool_calls", []))
      |> List.wrap()
      |> Enum.find(fn call -> map_get(call, :name) == "report_quality_findings" end)

    if call do
      arguments = map_get(call, :arguments) || %{}

      case parse_findings(Jason.encode!(%{findings: map_get(arguments, :findings)})) do
        {:ok, findings} ->
          QualityEvaluationResult.ok(findings, provider_call_ref(result))

        :error ->
          QualityEvaluationResult.error(%{
            code: "evaluator_invalid_json",
            message: "invalid findings"
          })
      end
    else
      case parse_findings(map_get(result, :content) || "") do
        {:ok, findings} ->
          QualityEvaluationResult.ok(findings, provider_call_ref(result))

        :error ->
          QualityEvaluationResult.error(%{
            code: "native_tool_call_required",
            message: "expected report_quality_findings tool call"
          })
      end
    end
  end

  defp map_get(map, key) when is_map(map), do: Map.get(map, key) || Map.get(map, to_string(key))
  defp map_get(_, _), do: nil

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

  defp material_coverage_statement(%AuthoringTask{scope: scope}) do
    coverage = Map.get(scope || %{}, :coverage, :single)

    case coverage do
      :chapter ->
        "评审范围：整章材料（可给出章级结论；仍须以正文原句为证据）。"

      _ ->
        "评审范围：单对象/片段（只评审给定材料；不得据此声称整章或全书结论，证据不足时明确范围限制）。"
    end
  end

  # 评审角色专属任务说明（形式候选 + 章级节奏 + 其他维度）；两种渲染共用。
  defp review_tasks(request) do
    """
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
    impact_scope/revision_scope 才可为 chapter。材料范围是片段时不得给章级节奏结论。

    其他评审维度：场景是否产生变化、情绪转向是否有触发、人物是否有明确目标与阻力、人物行动是否
    来自选择、转折是否导致后果、信息释放是否符合执行简述、实际读者效果是否偏离目标、对话是否
    服务冲突/潜台词、结尾是否留下继续阅读的驱动力（hook，且不是虚假承诺）、能力/境界/资源/代价
    与成长路径是否符合既有规则（不跳过必要铺垫、强度不失衡）。不要仅凭关键字命中就判失败。
    """
    |> String.trim()
  end

  # 输出契约唯一文本：首次请求与纠错共用；字段要求与 valid_finding?/1 校验同源。
  defp findings_contract do
    """
    输出契约（调用 report_quality_findings，不直接回复 JSON 文本）：
    工具参数必须包含 "findings" 数组（没有问题则为空数组）。每个 finding 必填：
    - "quality_finding_id"：稳定 finding 标识
    - "quality_gate_ref"：质量门 ref（如 quality_gate.character_logic / quality_gate.pacing）
    - "validator_ref"：validator ref（如 validator.scene_change / validator.emotional_transition）
    - "summary"：一句话说明问题
    - "reasoning"：说明为什么这些原句构成问题，不得只复述统计信号
    - "evidence_spans"：非空数组；每项含 {"text": 正文原句, "sentence_start": 正整数, "sentence_end": 正整数}
    - "impact_scope"：local | paragraph | chapter
    - "revision_scope"：local | paragraph | chapter；默认 local，只有问题确实覆盖段落或整章才能扩大
    - "confidence"：0~1 之间的小数
    可选字段：severity（info|warn|high）、action（warn|adoption_review|block|confirm）、
    candidate_id、brief_field_refs、suggested_revision（{"instruction": ...}）。
    字符串值内的换行必须写成 \\n 转义。
    """
    |> String.trim()
  end

  defp brief_section(%QualityEvaluationRequest{execution_brief: brief})
       when is_binary(brief) and brief != "" do
    "本章执行简述（评审对照）：\n#{brief}\n\n"
  end

  defp brief_section(_request), do: ""

  # B11D（质量场粒度）：把合法场次清单给 evaluator；finding 指向具体场时，必须在
  # brief_field_refs 使用这里的 unit_id 前缀（服务端按该白名单归因，不采信自造场 id）。
  defp scene_units_section(%QualityEvaluationRequest{scene_units: units})
       when is_list(units) and units != [] do
    lines =
      Enum.map_join(units, "\n", fn unit ->
        unit_id = Map.get(unit, "unit_id") || Map.get(unit, :unit_id)
        title = Map.get(unit, "scene_title") || Map.get(unit, :scene_title)
        "- #{unit_id}（#{title}）"
      end)

    "本章计划场次（finding 若指向某一具体场，必须在 brief_field_refs 中使用下列 unit_id 前缀，例如 scene_2.emotion_transition；禁止发明不存在的场 id）：\n#{lines}\n\n"
  end

  defp scene_units_section(_request), do: ""

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
end
