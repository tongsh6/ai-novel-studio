defmodule NovelAgent.Provider.SSEStream.AnthropicDecoder do
  @moduledoc """
  Anthropic Messages SSE decoder（VS-00L §6.2 / I-ART-8）。

  Anthropic 流式用命名事件 + content blocks：
  - `content_block_delta(delta.text)` → 正文增量；
  - `content_block_start(tool_use)` 给出 id/name，后续
    `content_block_delta(input_json_delta.partial_json)` 分片发送参数；
  - `message_start` / `message_delta` 给出 usage 与 model；
  - `error` 是 provider 显式失败事实，不能当成功结果下传。
  """

  @behaviour NovelAgent.Provider.SSEStream

  alias NovelAgent.Provider.Usage

  @impl true
  def init(_state) do
    %{content: [], tool_calls: %{}, usage: nil, model: nil, error: nil}
  end

  @impl true
  def decode(state, decoded) do
    state = apply_event(state, decoded)
    {state, %{text: text_delta(decoded), activity?: activity?(decoded)}}
  end

  @impl true
  def finalize(state) do
    %{
      content: state.content |> Enum.reverse() |> Enum.join(),
      tool_calls: completed_tool_calls(state.tool_calls),
      usage: state.usage,
      model: state.model,
      error: state.error
    }
  end

  @impl true
  def usage(nil, model, duration), do: Usage.new(0, 0, model, duration)

  def usage(usage, model, duration) when is_map(usage) do
    Usage.from_anthropic_response(%{"usage" => usage, "model" => model}, model, duration)
  end

  # ── 事件处理 ──────────────────────────────────────────────────────────────

  defp apply_event(state, %{"type" => "message_start", "message" => message})
       when is_map(message) do
    state
    |> merge_usage(Map.get(message, "usage"))
    |> merge_model(Map.get(message, "model"))
  end

  defp apply_event(state, %{"type" => "content_block_start", "content_block" => block} = decoded) do
    if Map.get(block, "type") == "tool_use" do
      entry = %{
        id: present_string(Map.get(block, "id")),
        name: present_string(Map.get(block, "name")),
        partial_json: ""
      }

      put_tool_call(state, tool_call_index(decoded), entry)
    else
      state
    end
  end

  defp apply_event(state, %{"type" => "content_block_delta"} = decoded) do
    state
    |> consume_tool_call_delta(decoded)
    |> append_content(text_delta(decoded))
  end

  defp apply_event(state, %{"type" => "message_delta"} = decoded) do
    merge_usage(state, Map.get(decoded, "usage"))
  end

  defp apply_event(state, %{"type" => "error", "error" => error}) when is_map(error) do
    %{
      state
      | error: %{type: provider_error_type(Map.get(error, "type")), message: error_message(error)}
    }
  end

  defp apply_event(state, _decoded), do: state

  defp text_delta(%{"delta" => %{"text" => text}}) when is_binary(text), do: text
  defp text_delta(_decoded), do: ""

  defp activity?(%{"type" => "content_block_delta"}), do: true
  defp activity?(%{"type" => "content_block_start"}), do: true
  defp activity?(_decoded), do: false

  defp append_content(state, ""), do: state
  defp append_content(%{content: content} = state, text), do: %{state | content: [text | content]}

  defp merge_usage(state, usage) when is_map(usage) do
    merged = (state.usage || %{}) |> Map.merge(usage)
    %{state | usage: merged}
  end

  defp merge_usage(state, _usage), do: state

  defp merge_model(state, model) when is_binary(model) and model != "",
    do: %{state | model: model}

  defp merge_model(state, _model), do: state

  defp tool_call_index(decoded) do
    case Map.get(decoded, "index") do
      index when is_integer(index) and index >= 0 -> index
      _other -> 0
    end
  end

  defp present_string(value) when is_binary(value) and value != "", do: value
  defp present_string(_value), do: nil

  defp put_tool_call(%{tool_calls: entries} = state, index, entry),
    do: %{state | tool_calls: Map.put(entries, index, entry)}

  defp consume_tool_call_delta(
         %{tool_calls: entries} = state,
         %{"delta" => %{"type" => "input_json_delta", "partial_json" => partial}} = decoded
       )
       when is_binary(partial) do
    index = tool_call_index(decoded)
    entry = Map.get(entries, index, %{id: nil, name: nil, partial_json: ""})

    put_tool_call(state, index, %{entry | partial_json: entry.partial_json <> partial})
  end

  defp consume_tool_call_delta(state, _decoded), do: state

  defp completed_tool_calls(entries) do
    entries
    |> Enum.sort_by(fn {index, _entry} -> index end)
    |> Enum.flat_map(fn {_index, entry} -> tool_call_payload(entry) end)
  end

  defp tool_call_payload(%{name: name} = entry) when is_binary(name) and name != "" do
    raw = entry.partial_json

    call = %{
      "id" => entry.id,
      "name" => name,
      "arguments" => NovelAgent.Provider.decode_tool_arguments(raw)
    }

    if raw == "", do: [call], else: [Map.put(call, "raw_arguments", raw)]
  end

  defp tool_call_payload(_entry), do: []

  defp error_message(error) do
    Map.get(error, "message") || inspect(error)
  end

  defp provider_error_type(type) when type in ["authentication_error", "permission_error"],
    do: :auth

  defp provider_error_type(type) when type in ["rate_limit_error", "overloaded_error"],
    do: :rate_limit

  defp provider_error_type("invalid_request_error"), do: :invalid_request
  defp provider_error_type(_type), do: :provider_internal
end
