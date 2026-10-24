defmodule NovelApplication.Planner do
  @moduledoc """
  帧纪元退役后的 Planner 残余职责（2026-07-19 回顾 B-1 第二批）：

  原 v3 帧管线（form_frame / form_micro_plan / 帧校验族）随判断纪元退役——
  frame 语义并入判断①（JudgmentProtocol），本模块只保留判断循环仍消费的三件：
  - `narrate_tool_result/3`：工具结果的作者可见叙述（B27 CP3c：消费
    `AuthoringTask(kind: :result_narration)`，输入含真实作者目标/工具后果；
    任务缺失或 provider 失败时退回确定性叙述，不退回无依据的模型叙述）。
  - `provider_failure_fallback_message/1`：S7 失败终局的作者安全文案分类。
  - `fallback_candidates/1`：探索候选不可用时的应用兜底候选（S2 韧性）。
  """

  alias NovelAgent.Provider.Execution
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.LogContext
  alias NovelDomain.CandidateDirection

  @type provider_execution :: Execution.dependency()

  @doc """
  工具结果的作者可见叙述（B27 CP3c / C5）。

  `task` 为 application 组装并经 `AuthoringSemantics.validate/1` 的
  `:result_narration` 任务（真实作者目标 + 工具实际后果）。`task == nil` 或
  provider 失败时不发起无依据调用，返回与工具真实后果一致的确定性叙述。
  """
  @spec narrate_tool_result(map(), AuthoringTask.t() | nil, provider_execution()) :: String.t()
  def narrate_tool_result(tool_result, %AuthoringTask{} = task, provider_execution) do
    result_fn = result_fn(provider_execution)
    prompt = tool_narration_prompt(tool_result, task)

    case LogContext.with_step("narrate_tool_result", fn -> result_fn.(prompt) end) do
      {:ok, %{content: content}} when is_binary(content) ->
        case String.trim(content) do
          "" -> deterministic_narration(tool_result)
          text -> text
        end

      _ ->
        deterministic_narration(tool_result)
    end
  end

  def narrate_tool_result(tool_result, nil, _provider_execution),
    do: deterministic_narration(tool_result)

  # 只有真实作者目标/工具后果在场时才组装提示词；这里不再用 inspect(output) 把
  # 内部结构带进 prompt，也不复述共享规则（规则文本唯一真源是 AuthoringSemantics）。
  defp tool_narration_prompt(tool_result, %AuthoringTask{} = task) do
    """
    本次你承担创作助手的角色，向作者叙述一次工具执行的真实结果与下一步。

    #{AuthoringSemantics.render(task)}

    ## 工具执行结果
    - 工具: #{tool_result.tool_name}
    - 状态: #{tool_result.status}
    - 输出摘要: #{output_summary(tool_result)}

    ## 角色输出要求
    请用 1-2 句自然中文说明这次实际发生了什么、影响范围以及下一步可以做什么；
    #{candidate_output_clause(tool_result)}
    不要用 markdown，不要重复工具名，不要机械复述输入。
    """
    |> String.trim()
  end

  defp output_summary(%{output: output} = tool_result) when is_map(output) do
    summary_for_output(output) ||
      "工具返回了结果（#{tool_result.tool_name} / #{tool_result.status}）"
  end

  defp output_summary(tool_result), do: "工具返回了结果（#{tool_result.tool_name}）"

  defp summary_for_output(%{items: items} = output) when is_list(items) and items != [] do
    titles = items |> Enum.map(&title_of/1) |> Enum.reject(&is_nil/1) |> Enum.take(5)
    count = Map.get(output, :item_count) || length(items)
    "生成 #{count} 个创作内容#{if titles == [], do: "（待采纳）", else: "：#{Enum.join(titles, "、")}"}"
  end

  defp summary_for_output(%{artifact_type: type} = output)
       when not is_nil(type) and (is_binary(type) or is_atom(type)) do
    "生成 #{Map.get(output, :item_count) || "若干"} 个 #{type}（待采纳）"
  end

  defp summary_for_output(%{characters: characters}) when is_list(characters) do
    "读取到 #{length(characters)} 个角色"
  end

  defp summary_for_output(%{item_count: count}) when is_integer(count) do
    "工具输出 #{count} 项"
  end

  defp summary_for_output(_output), do: nil

  defp title_of(item) when is_map(item), do: Map.get(item, :title) || Map.get(item, "title")
  defp title_of(_item), do: nil

  defp candidate_output_clause(%{output: output}) when is_map(output) do
    if (is_list(Map.get(output, :items)) and Map.get(output, :items) != []) or
         not is_nil(Map.get(output, :artifact_type)) do
      "本次产出是待确认创作材料：明确尚未被采纳，也没有写入作品事实，不要宣称已入库或成为正式产物。"
    else
      "本次是只读/无创作产物的操作：如实说明读取或执行结果，不要把结果描述成创作候选或待采纳材料。"
    end
  end

  defp candidate_output_clause(_tool_result),
    do: "本次是只读/无创作产物的操作：如实说明读取或执行结果，不要把结果描述成创作候选或待采纳材料。"

  # 确定性叙述：与工具真实后果一致；不含「已完成目标」等未经证据的声明。
  defp deterministic_narration(tool_result) do
    if creative_output?(tool_result) do
      "已生成待保存草稿。请先审阅，保存后才会进入作品档案；未保存前不会写入作品事实。"
    else
      "本次操作已执行（工具：#{tool_result.tool_name}，状态：#{tool_result.status}）。" <>
        "未生成待采纳创作材料，也未写入作品事实；如需继续，请查看工作台结果或说明下一步。"
    end
  end

  defp creative_output?(%{output: output}) when is_map(output) do
    (is_list(Map.get(output, :items)) and Map.get(output, :items) != []) or
      not is_nil(Map.get(output, :artifact_type))
  end

  defp creative_output?(_tool_result), do: false

  # ── shared helpers ──

  defp result_fn(provider_execution) do
    case Execution.result_fn(provider_execution) do
      result_fn when is_function(result_fn, 1) ->
        result_fn

      _ ->
        fn _prompt -> {:error, :provider_execution_required} end
    end
  end

  @doc "S7 失败终局的作者安全文案（按 provider 错误契约分类；结构词，47 红线内）。"
  @spec provider_failure_fallback_message(term()) :: String.t()
  def provider_failure_fallback_message(reason),
    do: reason |> frame_error_reason_code() |> fallback_message()

  defp frame_error_reason_code(:json_parse_failed), do: :json_parse_failed
  defp frame_error_reason_code(:frame_contract_invalid), do: :json_parse_failed
  defp frame_error_reason_code({:judgment_decision_unparseable, _}), do: :json_parse_failed
  defp frame_error_reason_code({:judgment_semantic_conflict, _}), do: :judgment_semantic_conflict
  defp frame_error_reason_code(%{type: :invalid_request}), do: :invalid_request
  defp frame_error_reason_code(%{type: :invalid_response}), do: :invalid_response

  # B22：超时按"哪一层没有进展"分类（见 Provider.TimeoutPolicy / 流式 adapter），
  # 作者文案只使用结构性类别 + 时长/字数，绝不透传 provider 原始 message。
  defp frame_error_reason_code(%{type: :timeout, details: %{timeout_kind: kind}})
       when kind in [:connection_stall, :stream_interrupted, :deadline],
       do: {:provider_timeout, kind}

  defp frame_error_reason_code(%{type: :timeout}), do: :provider_timeout
  defp frame_error_reason_code(%{type: :connection_refused}), do: :provider_unavailable
  defp frame_error_reason_code(_), do: :provider_error

  defp fallback_message(:json_parse_failed),
    do: "创作引擎返回的格式不符合工作台契约，请重试。"

  # Q3a 语义对账降级文案（缺口诚实律）：矛盾重试后仍矛盾——诚实告知没有冒充写入。
  defp fallback_message(:judgment_semantic_conflict),
    do: "模型这次的判定自相矛盾（声称要写入，选的却是只读能力），已安全停止，没有把只读操作冒充成写入。请重试，或换个说法明确你要的结果。"

  defp fallback_message(:invalid_request),
    do: "创作引擎拒绝了这次请求：模型参数可能配置有误（如思考模式、推理强度）。这一轮没有创建待采纳内容，也没有写入作品事实。请在模型设置中检查参数后重试。"

  defp fallback_message(:invalid_response), do: "创作引擎返回内容为空，请重试。"

  defp fallback_message({:provider_timeout, :connection_stall}),
    do: "模型在限定的等待时间内没有返回任何生成内容（本机模型可能仍在排队、预填充或思考）。这一轮没有创建待采纳内容，也没有写入作品事实。你可以稍后重试，或继续对话。"

  defp fallback_message({:provider_timeout, :stream_interrupted}),
    do: "模型的生成输出中途中断（已经产出的内容没有达到可交付状态）。这一轮没有创建待采纳内容，也没有写入作品事实。你可以稍后重试，或继续对话。"

  defp fallback_message({:provider_timeout, :deadline}),
    do: "模型调用超过了部署侧配置的总时长上限。这一轮没有创建待采纳内容，也没有写入作品事实。你可以稍后重试，或继续对话。"

  defp fallback_message(:provider_timeout),
    do: "创作引擎响应超时。这一轮没有创建待采纳内容，也没有写入作品事实。你可以稍后重试，或继续对话。"

  defp fallback_message(_),
    do: "抱歉，我现在无法连接到创作引擎。这一轮没有创建待采纳内容，也没有写入作品事实。你可以检查模型连接后重试，或继续对话。"

  @doc """
  探索候选不可用（坏结构/空/无效）时的应用兜底候选（S2 韧性）。

  判断循环 reply 路径消费（judgment_candidates），保证同类降级行为一致。
  """
  @spec fallback_candidates(String.t()) :: [CandidateDirection.t()]
  def fallback_candidates(frame_id) do
    [
      %CandidateDirection{
        direction_id: NovelFoundation.ID.unique("dir"),
        title: "矛盾切入",
        pitch: "先抓住作品里最有冲突感的设定，让主角从压力中心进入故事。",
        tone_tags: ["冲突", "推进"],
        source_frame_ref: frame_id,
        adoption_status: :not_adopted
      },
      %CandidateDirection{
        direction_id: NovelFoundation.ID.unique("dir"),
        title: "人物切入",
        pitch: "从一个有强烈欲望或困境的角色出发，用他的选择带出世界观。",
        tone_tags: ["角色", "共情"],
        source_frame_ref: frame_id,
        adoption_status: :not_adopted
      },
      %CandidateDirection{
        direction_id: NovelFoundation.ID.unique("dir"),
        title: "世界规则切入",
        pitch: "先定义一个反常但有吸引力的世界规则，再让剧情围绕它展开。",
        tone_tags: ["世界观", "设定"],
        source_frame_ref: frame_id,
        adoption_status: :not_adopted
      }
    ]
  end
end
