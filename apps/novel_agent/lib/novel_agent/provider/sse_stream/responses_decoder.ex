defmodule NovelAgent.Provider.SSEStream.ResponsesDecoder do
  @moduledoc """
  Responses API SSE decoder（VS-00L §6.3 / §19.1，B71 R2）。

  Responses 流式事件分三类：

  - 输出项生命周期：`response.output_item.added/.done` 携带完整 item（message 或
    function_call）；`response.content_part.*` 只是子结构，最终事实以 done item 为准；
  - 文本增量：`response.output_text.delta` → 作者可见正文增量；
    `response.output_text.done` 提供完整文本（用于最终内容校验/回退）；
  - 工具参数增量：`response.function_call_arguments.delta/.done`；参数原始字节按
    item 累积，结束后用与 `ResponsesWire.function_call_item/1` 同一解析归一。
    Responses 的 item `id` 与工具 `call_id` 分属不同用途，本模块只用 call_id 作
    canonical 工具调用身份。
  - 终止：`response.completed` 携带完整 response（含 usage/output）作为最终事实；
    `response.failed` / `error` 是 provider 显式失败，不能当成功结果下传。
  """

  @behaviour NovelAgent.Provider.SSEStream

  alias NovelAgent.Provider.ResponsesWire
  alias NovelAgent.Provider.Usage

  @impl true
  def init(_state) do
    %{
      text: [],
      text_done: nil,
      items: %{},
      arguments: %{},
      usage: nil,
      model: nil,
      error: nil,
      terminal?: false
    }
  end

  @impl true
  def decode(state, decoded) do
    {state, tool_arguments_delta} = apply_event(state, decoded)

    {state,
     %{
       text: text_delta(decoded),
       activity?: activity?(decoded),
       tool_arguments_delta: tool_arguments_delta
     }}
  end

  @impl true
  def finalize(state) do
    error = state.error || terminal_error(state)

    indexed_items =
      state.items
      |> Enum.sort_by(fn {index, _item} -> index end)

    output_items = Enum.map(indexed_items, fn {_index, item} -> item end)

    content =
      case state.text do
        [] -> state.text_done || content_from_items(output_items)
        _deltas -> state.text |> Enum.reverse() |> Enum.join()
      end

    %{
      content: content,
      tool_calls: tool_calls(indexed_items, state.arguments),
      usage: state.usage,
      model: state.model,
      error: error
    }
  end

  # Responses SSE 以 response.completed / response.incomplete 作为正常终止事实；
  # 流提前结束（wire 断开/截断）时不能把已收到的半截增量冒充完整响应。
  defp terminal_error(%{terminal?: true}), do: nil

  defp terminal_error(_state) do
    %{type: :parse, message: "响应流未正常终止（缺少 response.completed/incomplete）"}
  end

  @impl true
  def usage(nil, model, duration), do: Usage.new(0, 0, model, duration)

  def usage(usage, model, duration) when is_map(usage) do
    ResponsesWire.usage(%{"usage" => usage, "model" => model}, model, duration)
  end

  # ── 事件处理 ──────────────────────────────────────────────────────────────

  defp apply_event(state, %{"type" => "response.created", "response" => response})
       when is_map(response) do
    {merge_model(state, Map.get(response, "model")), ""}
  end

  defp apply_event(state, %{"type" => "response.output_item.added"} = decoded) do
    {put_item(state, output_index(decoded), Map.get(decoded, "item")), ""}
  end

  defp apply_event(state, %{"type" => "response.output_item.done"} = decoded) do
    {put_item(state, output_index(decoded), Map.get(decoded, "item")), ""}
  end

  defp apply_event(state, %{"type" => "response.output_text.delta"} = decoded) do
    case Map.get(decoded, "delta") do
      text when is_binary(text) and text != "" ->
        {%{state | text: [text | state.text]}, ""}

      _other ->
        {state, ""}
    end
  end

  defp apply_event(state, %{"type" => "response.output_text.done"} = decoded) do
    case Map.get(decoded, "text") do
      text when is_binary(text) -> {%{state | text_done: text}, ""}
      _other -> {state, ""}
    end
  end

  defp apply_event(state, %{"type" => "response.function_call_arguments.delta"} = decoded) do
    key = item_key(decoded)

    case Map.get(decoded, "delta") do
      fragment when is_binary(fragment) ->
        arguments = Map.update(state.arguments, key, fragment, &(&1 <> fragment))
        {%{state | arguments: arguments}, fragment}

      _other ->
        {state, ""}
    end
  end

  defp apply_event(state, %{"type" => "response.function_call_arguments.done"} = decoded) do
    key = item_key(decoded)

    case Map.get(decoded, "arguments") do
      arguments when is_binary(arguments) ->
        {%{state | arguments: Map.put(state.arguments, key, arguments)}, ""}

      _other ->
        {state, ""}
    end
  end

  defp apply_event(state, %{"type" => "response.completed", "response" => response})
       when is_map(response) do
    {state
     |> merge_model(Map.get(response, "model"))
     |> merge_usage(Map.get(response, "usage"))
     |> merge_completed_output(Map.get(response, "output"))
     |> Map.put(:terminal?, true), ""}
  end

  # response.incomplete 是「已生成但被截断」的合法终止事实（如 max_output_tokens）；
  # 保留已收到内容，不当作协议失败；是否可用由上层内容/质量判据决定。
  defp apply_event(state, %{"type" => "response.incomplete", "response" => response})
       when is_map(response) do
    {state
     |> merge_model(Map.get(response, "model"))
     |> merge_usage(Map.get(response, "usage"))
     |> merge_completed_output(Map.get(response, "output"))
     |> Map.put(:terminal?, true), ""}
  end

  defp apply_event(state, %{"type" => "response.failed", "response" => response})
       when is_map(response) do
    {%{state | error: normalize_error(Map.get(response, "error") || response), terminal?: true},
     ""}
  end

  defp apply_event(state, %{"type" => "error"} = decoded) do
    {%{state | error: normalize_error(decoded)}, ""}
  end

  defp apply_event(state, _decoded), do: {state, ""}

  defp put_item(state, index, item) when is_map(item) do
    %{state | items: Map.put(state.items, index, item)}
  end

  defp put_item(state, _index, _item), do: state

  # completed 事件的 response.output 是完整输出事实；done item 缺失时用它补全
  # （真实 SSE 正常会发 output_item.done，这里只做同一事实的兜底，不伪造内容）。
  defp merge_completed_output(state, output) when is_list(output) do
    Enum.reduce(Enum.with_index(output), state, fn {item, index}, current ->
      if Map.has_key?(current.items, index) do
        current
      else
        put_item(current, index, item)
      end
    end)
  end

  defp merge_completed_output(state, _output), do: state

  defp output_index(decoded) do
    case Map.get(decoded, "output_index") do
      index when is_integer(index) and index >= 0 -> index
      _other -> 0
    end
  end

  defp item_key(decoded) do
    Map.get(decoded, "item_id") || "output_index:#{output_index(decoded)}"
  end

  defp text_delta(%{"type" => "response.output_text.delta"} = decoded) do
    case Map.get(decoded, "delta") do
      text when is_binary(text) -> text
      _other -> ""
    end
  end

  defp text_delta(_decoded), do: ""

  defp activity?(%{"type" => type})
       when type in [
              "response.output_text.delta",
              "response.output_item.added",
              "response.function_call_arguments.delta"
            ],
       do: true

  defp activity?(_decoded), do: false

  defp content_from_items(output_items) do
    {content, _calls} = ResponsesWire.output(output_items)
    content
  end

  defp tool_calls(indexed_items, arguments) do
    indexed_items
    |> Enum.map(fn {index, item} -> merge_arguments(item, arguments, index) end)
    |> Enum.flat_map(&ResponsesWire.function_call_item/1)
  end

  # function_call item 的 arguments 若在 done item 中缺失，用
  # function_call_arguments.delta/.done 的累积字节补齐；不改变其它字段。
  #
  # 累积键与 item 身份必须同源：delta/.done 事件按 `item_key/1`（item_id 或
  # `output_index:N`）累积；done item 里只有 `id`（= item_id）与 `call_id`
  # （工具身份，不用于参数累积）。此前用 call_id 兜底查以 item_id 为键的 map
  # 永远查不到，属于错配兜底；这里只按 item id / output_index 同一语义查找。
  defp merge_arguments(%{"type" => "function_call"} = item, arguments, index) do
    keys =
      [Map.get(item, "id"), "output_index:#{index}"]
      |> Enum.reject(&(is_nil(&1) or &1 == ""))

    case Map.get(item, "arguments") do
      raw when is_binary(raw) and raw != "" ->
        item

      _other ->
        case Enum.find_value(keys, &Map.get(arguments, &1)) do
          raw when is_binary(raw) -> Map.put(item, "arguments", raw)
          _missing -> item
        end
    end
  end

  defp merge_arguments(item, _arguments, _index), do: item

  defp merge_usage(state, usage) when is_map(usage), do: %{state | usage: usage}
  defp merge_usage(state, _usage), do: state

  defp merge_model(state, model) when is_binary(model) and model != "",
    do: %{state | model: model}

  defp merge_model(state, _model), do: state

  defp normalize_error(error) when is_map(error) do
    type = Map.get(error, "type") || Map.get(error, "code") || "provider_error"
    message = Map.get(error, "message") || inspect(error)
    %{type: provider_error_type(to_string(type)), message: message}
  end

  defp normalize_error(error) do
    %{type: :provider_internal, message: inspect(error)}
  end

  defp provider_error_type(type)
       when type in ["authentication_error", "invalid_api_key", "permission_denied"],
       do: :auth

  defp provider_error_type(type) when type in ["rate_limit_exceeded", "rate_limit_error"],
    do: :rate_limit

  defp provider_error_type(type)
       when type in ["invalid_request_error", "invalid_prompt", "invalid_request"],
       do: :invalid_request

  defp provider_error_type(_type), do: :provider_internal
end
