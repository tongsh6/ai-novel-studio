defmodule NovelApplication.Planner do
  @moduledoc """
  帧纪元退役后的 Planner 残余职责（2026-07-19 回顾 B-1 第二批）：

  原 v3 帧管线（form_frame / form_micro_plan / 帧校验族）随判断纪元退役——
  frame 语义并入判断①（JudgmentProtocol），本模块只保留判断循环仍消费的三件：
  - `narrate_tool_result/2`：工具结果的作者可见叙述（provider 叙述调用）。
  - `provider_failure_fallback_message/1`：S7 失败终局的作者安全文案分类。
  - `fallback_candidates/1`：探索候选不可用时的应用兜底候选（S2 韧性）。
  """

  alias NovelAgent.Provider.Execution
  alias NovelCommon.LogContext
  alias NovelDomain.CandidateDirection

  @type provider_execution :: Execution.dependency()

  @doc "工具结果的作者可见叙述（provider 叙述调用；失败降级为结构短语）。"
  @spec narrate_tool_result(map(), provider_execution()) :: String.t()
  def narrate_tool_result(
        tool_result,
        provider_execution \\ Execution.dependency(purpose: :narration)
      ) do
    result_fn = result_fn(provider_execution)
    prompt = tool_narration_prompt(tool_result)

    case LogContext.with_step("narrate_tool_result", fn -> result_fn.(prompt) end) do
      {:ok, %{content: content}} ->
        String.trim(content)

      {:error, _} ->
        "工具执行完成。"
    end
  end

  defp tool_narration_prompt(tool_result) do
    output_summary =
      case tool_result.output do
        %{item_count: n, items: items} when n > 0 ->
          titles = items |> Enum.map_join("、", & &1.title)
          "生成了 #{n} 个创作内容：#{titles}"

        %{artifact_type: type, item_count: n} ->
          "生成了 #{n} 个 #{type}"

        other ->
          inspect(other)
      end

    """
    你是一个小说创作 AI。下面是你完成一个创作工具调用后的结果。

    ## 工具执行结果
    - 工具: #{tool_result.tool_name}
    - 状态: #{tool_result.status}
    - 输出摘要: #{output_summary}

    ## 要求
    请用 1-2 句自然中文告诉作者你完成了什么、产出了什么，并引导作者下一步可以做什么（查看、选择、修改建议等）。
    必须明确这些内容只是待确认创作材料，尚未被采纳，也没有写入作品事实。
    不得宣称正文已经完成入库，不得宣称章节计划已经成为正式大纲。
    不要用 markdown，不要重复工具名。
    """
  end

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
  defp frame_error_reason_code(%{type: :invalid_request}), do: :invalid_request
  defp frame_error_reason_code(%{type: :invalid_response}), do: :invalid_response
  defp frame_error_reason_code(%{type: :timeout}), do: :provider_timeout
  defp frame_error_reason_code(%{type: :connection_refused}), do: :provider_unavailable
  defp frame_error_reason_code(_), do: :provider_error

  defp fallback_message(:json_parse_failed),
    do: "创作引擎返回的格式不符合工作台契约，请重试。"

  defp fallback_message(:invalid_request),
    do: "创作引擎拒绝了这次请求：模型参数可能配置有误（如思考模式、推理强度）。这一轮没有创建待采纳内容，也没有写入作品事实。请在模型设置中检查参数后重试。"

  defp fallback_message(:invalid_response), do: "创作引擎返回内容为空，请重试。"

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
