defmodule NovelAgent.Provider.NativeToolExchange do
  @moduledoc """
  B71 原生单工具交换：保留响应事实、整体验证调用集合，再解析业务结果。

  创作、评审、计划与使命共用最多两次实际调用；协议纠错和可选传输重试共享
  同一预算。业务成功的调用保持待处理，由 application 的真实结果闭合。
  """

  alias NovelAgent.Provider.RequestIR

  @max_provider_calls 2
  @invalid_validation_callback_result "invalid_validation_callback_result"
  @invalid_validation_callback_message "validate_result callback returned an unsupported result"
  @invalid_validate_result_option_message "validate_result must be nil or a function of arity 1"

  @doc """
  执行一次原生交换并返回业务结果与会话。

  默认具名工具调用、传输失败不重试；tool_choice、retry_transport 可由消费者
  显式选择。解析器支持 (result) 或 (result, attempt)，attempt 是真实调用序号。
  feedback.(parsed) 返回 reason_code/detail/message，供原生失败结果或应用通知使用。
  validate_result 只接受 nil 或 arity 1 回调，入口即校验；回调只在协议解析成功后
  执行，返回 :ok 或 {:error, %{reason_code: binary, detail: map, message: binary}}。
  失败按原 call_id 回流并复用同一重试循环；回调返回坏形状属于程序契约故障，保留
  真实响应、闭合原 call、以固定安全原因结束且不重试，也不把回调返回值 inspect 回
  模型。max_provider_calls 只接受非负整数，有效上限为 min(2, 指定值)，默认 2；
  0 直接返回预算错误且不调用 provider。on_retry.(kind, reason, attempt) 只在下一
  请求实际发送前触发；reason 是原始传输错误或解析结果中的 error/首个 errors，
  attempt 是刚失败的真实调用序号。
  """
  @spec run(RequestIR.t(), function(), String.t(), function(), function()) :: {map(), map()}
  @spec run(RequestIR.t(), function(), String.t(), function(), function(), keyword()) ::
          {map(), map()}
  def run(ir, result_fn, tool_name, parse_result, error_result, opts \\ []) do
    operation = %{
      provider: result_fn,
      tool: tool_name,
      parse: parse_result,
      error: error_result,
      tool_choice: Keyword.get(opts, :tool_choice, tool_name),
      retry_transport: Keyword.get(opts, :retry_transport, false),
      feedback: Keyword.get(opts, :feedback),
      on_retry: Keyword.get(opts, :on_retry),
      validate_result: Keyword.get(opts, :validate_result)
    }

    case validate_options(opts) do
      {:ok, max_calls} ->
        exchange(%{ir: ir, result: nil, count: 0, max_calls: max_calls}, operation)

      {:error, code, message} ->
        finish(error_result.(code, message), %{ir: ir, result: nil, count: 0, max_calls: 0})
    end
  end

  @doc """
  统一校验原生交换选项：validate_result 只能是 nil 或 arity 1 回调，
  max_provider_calls 显式出现时必须是非负整数；缺省预算为 2，有效上限仍为 2。
  """
  @spec validate_options(keyword()) :: {:ok, non_neg_integer()} | {:error, String.t(), String.t()}
  def validate_options(opts) when is_list(opts) do
    with :ok <- validate_validate_result(Keyword.get(opts, :validate_result)) do
      case Keyword.fetch(opts, :max_provider_calls) do
        :error -> {:ok, @max_provider_calls}
        {:ok, value} -> normalize_max_provider_calls(value)
      end
    end
  end

  defp exchange(state, operation, retry_notice \\ nil)

  defp exchange(%{count: count, max_calls: max} = state, operation, _retry_notice)
       when count >= max do
    finish(
      operation.error.("provider_call_budget_exhausted", %{max_provider_calls: max}),
      state
    )
  end

  defp exchange(state, operation, retry_notice) do
    case RequestIR.prepare_request(state.ir,
           tool_names: [operation.tool],
           tool_choice: operation.tool_choice
         ) do
      {:ok, ir} ->
        notify_retry(operation.on_retry, retry_notice)
        next = %{state | count: state.count + 1, result: nil}
        consume(operation.provider.(ir), next, operation)

      {:error, reason} ->
        finish(operation.error.("invalid_request_ir", reason), state)
    end
  end

  defp consume({:ok, text}, state, operation) when is_binary(text),
    do: accept_response(%{content: text, tool_calls: []}, state, operation)

  defp consume({:ok, result}, state, operation) when is_map(result),
    do: accept_response(result, state, operation)

  defp consume({:error, reason}, state, operation) do
    parsed = operation.error.("provider_error", reason)

    retry_or_finish(
      %{
        retryable: operation.retry_transport == true,
        notice: {:provider, reason, state.count},
        final: parsed
      },
      state,
      operation
    )
  end

  defp consume(other, state, operation),
    do: finish(operation.error.("provider_response_unexpected", other), state)

  defp accept_response(result, state, operation) do
    {ir, result} = RequestIR.append_assistant_result(state.ir, result)
    state = %{state | ir: ir, result: result}
    parsed = parse_response(state, operation)

    case parsed.status do
      :ok ->
        validate_parsed_result(parsed, state, operation)

      :error ->
        reject_protocol(parsed, response_feedback(operation, parsed), state, operation)
    end
  end

  # 应用校验回调只在原生协议解析成功后执行。回调返回失败时，按原始 call_id
  # 追加 failed validation，并复用同一个重试预算；末次也先闭合再返回应用错误。
  # 回调返回坏形状属于程序契约故障：保留真实响应、闭合原 call、固定安全原因结束，
  # 不重试，也不把回调返回值（可能是函数或私有数据）inspect 后回流模型。
  defp validate_parsed_result(parsed, state, %{validate_result: validator} = operation)
       when is_function(validator, 1) do
    case validator.(parsed) do
      :ok ->
        finish(parsed, state)

      {:error, %{reason_code: code, detail: detail, message: message}}
      when is_binary(code) and is_map(detail) and is_binary(message) ->
        reject_validation(
          %{reason_code: code, detail: detail, message: message},
          state,
          operation
        )

      _other ->
        reject_validation(invalid_callback_feedback(), state, operation, false)
    end
  end

  defp validate_parsed_result(parsed, state, _operation), do: finish(parsed, state)

  defp reject_protocol(parsed, feedback, state, operation) do
    reject(feedback, state, operation, %{
      retryable: true,
      notice: {:validation, error_reason(parsed), state.count},
      final: parsed
    })
  end

  defp reject_validation(feedback, state, operation, retryable \\ true) do
    reject(feedback, state, operation, %{
      retryable: retryable,
      notice: {:validation, %{code: feedback.reason_code, detail: feedback.detail}, state.count},
      final: operation.error.(feedback.reason_code, feedback.message)
    })
  end

  defp invalid_callback_feedback do
    %{
      reason_code: @invalid_validation_callback_result,
      detail: %{},
      message: @invalid_validation_callback_message
    }
  end

  defp parse_response(state, operation) do
    calls = Map.get(state.result, :tool_calls, [])

    if allowed_response?(calls, state.ir, operation.tool) do
      parse_result(operation.parse, state.result, state.count)
    else
      code = if calls == [], do: "native_tool_call_required", else: "unexpected_tool_calls"

      operation.error.(code, %{
        expected: operation.tool,
        cardinality: 1,
        received_count: length(calls),
        received_calls: calls
      })
    end
  end

  defp allowed_response?([call], _ir, tool), do: field(call, :name) == tool

  defp allowed_response?(_calls, _ir, _tool), do: false

  defp parse_result(parse, result, attempt) when is_function(parse, 2),
    do: parse.(result, attempt)

  defp parse_result(parse, result, _attempt), do: parse.(result)

  defp response_feedback(%{feedback: feedback}, parsed) when is_function(feedback, 1),
    do: feedback.(parsed)

  defp response_feedback(operation, parsed) do
    reason = parsed |> error_reason() |> field(:code) || "invalid_tool_result"

    %{
      reason_code: reason,
      detail: %{
        expected_tool: operation.tool,
        expected_calls: 1,
        correction: "请只调用指定工具一次并满足其参数契约。"
      },
      message: "原生工具响应不符合契约：#{reason}；请只调用 #{operation.tool} 一次并满足其参数契约。"
    }
  end

  defp reject_response(ir, result, feedback) do
    case Map.get(result, :tool_calls, []) do
      [] ->
        RequestIR.append_application_notice(ir, feedback.message)

      calls ->
        detail = validation_detail(feedback)

        Enum.reduce(calls, ir, fn call, current ->
          RequestIR.append_validation_result(
            current,
            field(call, :id),
            "failed",
            feedback.reason_code,
            detail
          )
        end)
    end
  end

  # feedback.message 是模型可用的纠正指令，必须随原 call_id 的 validation 结果
  # 一起回流；detail 其它字段保持不变。atom/string 同名 message 冲突时只保留
  # 唯一一条明确 message，避免 JSON 序列化后出现重复键。
  defp validation_detail(%{detail: detail, message: message}) when is_map(detail) do
    detail
    |> Map.delete(:message)
    |> Map.delete("message")
    |> Map.put(:message, message)
  end

  defp validation_detail(%{message: message}), do: %{message: message}

  defp reject(feedback, state, operation, decision) do
    state = %{state | ir: reject_response(state.ir, state.result, feedback)}
    retry_or_finish(Map.put(decision, :feedback, feedback), state, operation)
  end

  # 唯一重试/结束决定：协议、应用校验、程序契约故障与传输失败都构造同一种
  # 拒绝记录（retryable/notice/final），由这里统一决定是否发起下一次真实调用。
  defp retry_or_finish(
         %{retryable: true, notice: notice},
         %{count: count, max_calls: max_calls} = state,
         operation
       )
       when count < max_calls do
    exchange(state, operation, notice)
  end

  defp retry_or_finish(%{final: final}, state, _operation), do: finish(final, state)

  defp normalize_max_provider_calls(value) when is_integer(value) and value >= 0,
    do: {:ok, min(@max_provider_calls, value)}

  defp normalize_max_provider_calls(value) do
    {:error, "invalid_max_provider_calls",
     "max_provider_calls must be a non-negative integer, got: #{inspect(value)}"}
  end

  defp validate_validate_result(nil), do: :ok
  defp validate_validate_result(validator) when is_function(validator, 1), do: :ok

  defp validate_validate_result(_value) do
    {:error, "invalid_validate_result_option", @invalid_validate_result_option_message}
  end

  defp notify_retry(callback, {kind, reason, attempt}) when is_function(callback, 3),
    do: callback.(kind, reason, attempt)

  defp notify_retry(_callback, _notice), do: :ok

  defp error_reason(parsed) do
    errors = List.wrap(Map.get(parsed, :errors))
    Map.get(parsed, :error) || List.first(errors) || %{}
  end

  defp finish(parsed, state) do
    {parsed,
     %{request_ir: state.ir, provider_result: state.result, provider_call_count: state.count}}
  end

  defp field(map, key) when is_map(map), do: Map.get(map, key, Map.get(map, to_string(key)))
  defp field(_value, _key), do: nil
end
