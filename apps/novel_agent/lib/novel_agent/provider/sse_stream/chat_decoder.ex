defmodule NovelAgent.Provider.SSEStream.ChatDecoder do
  @moduledoc """
  OpenAI-compatible Chat Completions SSE decoder（VS-00L §6.1 / I-ART-8）。

  逐帧累积 `choices[].delta.content` 与 `choices[].delta.tool_calls[]`：
  工具调用按 `index` 无损拼接原始参数字节，结束后交给与非流式响应同一个
  `Provider.extract_openai_tool_calls/1` 归一，避免第二套解析语义。
  """

  @behaviour NovelAgent.Provider.SSEStream

  alias NovelAgent.Provider.Usage

  @impl true
  def init(_state) do
    %{content: [], tool_calls: %{}, usage: nil, model: nil, private_reasoning: []}
  end

  @impl true
  def decode(state, decoded) do
    state =
      state
      |> merge_usage(Map.get(decoded, "usage"))
      |> merge_model(Map.get(decoded, "model"))
      |> merge_tool_calls(decoded)
      |> merge_private_reasoning(decoded)

    text = delta_content(decoded)
    state = append_content(state, text)

    {state, %{text: text, activity?: text != "" or tool_call_delta?(decoded)}}
  end

  @impl true
  def finalize(state) do
    %{
      content: state.content |> Enum.reverse() |> Enum.join(),
      tool_calls: completed_tool_calls(state.tool_calls),
      usage: state.usage,
      model: state.model,
      private_reasoning: state.private_reasoning |> Enum.reverse() |> Enum.join(),
      error: nil
    }
  end

  @impl true
  def usage(nil, model, duration), do: Usage.new(0, 0, model, duration)

  def usage(usage, model, duration) when is_map(usage) do
    Usage.from_openai_response(%{"usage" => usage, "model" => model}, model, duration)
  end

  # ── delta 解析 ────────────────────────────────────────────────────────────

  defp append_content(state, ""), do: state

  defp append_content(%{content: content} = state, text) when is_binary(text),
    do: %{state | content: [text | content]}

  defp delta_content(%{"choices" => choices}) when is_list(choices) do
    Enum.map_join(choices, "", &choice_delta/1)
  end

  defp delta_content(_decoded), do: ""

  defp choice_delta(%{"delta" => %{"content" => content}}) when is_binary(content), do: content
  defp choice_delta(%{"message" => %{"content" => content}}) when is_binary(content), do: content
  defp choice_delta(_choice), do: ""

  defp tool_call_delta?(%{"choices" => choices}) when is_list(choices) do
    Enum.any?(choices, fn
      %{"delta" => %{"tool_calls" => calls}} -> is_list(calls) and calls != []
      _other -> false
    end)
  end

  defp tool_call_delta?(_decoded), do: false

  defp merge_usage(state, usage) when is_map(usage), do: %{state | usage: usage}
  defp merge_usage(state, _usage), do: state

  defp merge_model(state, model) when is_binary(model) and model != "",
    do: %{state | model: model}

  defp merge_model(state, _model), do: state

  # 供应商私有推理增量（如 DeepSeek reasoning_content）：只在流内累积为私有事实，
  # 由 adapter 决定是否绑定 provider_state 回放；不进入正文/作者可见事件。
  defp merge_private_reasoning(%{private_reasoning: parts} = state, %{"choices" => choices})
       when is_list(choices) do
    case choice_reasoning_fragments(choices) do
      [] -> state
      fragments -> %{state | private_reasoning: [Enum.join(fragments) | parts]}
    end
  end

  defp merge_private_reasoning(state, _decoded), do: state

  defp choice_reasoning_fragments(choices) do
    Enum.flat_map(choices, fn choice ->
      payloads = [Map.get(choice, "delta", %{}), Map.get(choice, "message", %{})]
      Enum.flat_map(payloads, &reasoning_fragment/1)
    end)
  end

  defp reasoning_fragment(payload) do
    case Map.get(payload, "reasoning_content") do
      text when is_binary(text) -> [text]
      _other -> []
    end
  end

  defp merge_tool_calls(state, %{"choices" => choices}) when is_list(choices) do
    Enum.reduce(choices, state, fn choice, current ->
      choice
      |> Map.get("delta", %{})
      |> Map.get("tool_calls", [])
      |> Enum.reduce(current, &merge_tool_call_delta/2)
    end)
  end

  defp merge_tool_calls(state, _decoded), do: state

  defp merge_tool_call_delta(delta, %{tool_calls: entries} = state) when is_map(delta) do
    index = normalize_tool_call_index(Map.get(delta, "index"))
    entry = Map.get(entries, index, %{id: nil, name: nil, arguments: ""})
    function = Map.get(delta, "function") || %{}

    entry = %{
      id: present_string(entry.id) || present_string(Map.get(delta, "id")),
      name: present_string(entry.name) || present_string(Map.get(function, "name")),
      arguments: entry.arguments <> arguments_fragment(Map.get(function, "arguments"))
    }

    %{state | tool_calls: Map.put(entries, index, entry)}
  end

  defp merge_tool_call_delta(_delta, state), do: state

  defp normalize_tool_call_index(index) when is_integer(index) and index >= 0, do: index
  defp normalize_tool_call_index(_index), do: 0

  defp present_string(value) when is_binary(value) and value != "", do: value
  defp present_string(_value), do: nil

  defp arguments_fragment(arguments) when is_binary(arguments), do: arguments
  defp arguments_fragment(_arguments), do: ""

  defp completed_tool_calls(entries) do
    payloads =
      entries
      |> Enum.sort_by(fn {index, _entry} -> index end)
      |> Enum.map(fn {_index, entry} -> tool_call_payload(entry) end)
      |> Enum.reject(&is_nil/1)

    NovelAgent.Provider.extract_openai_tool_calls(%{"tool_calls" => payloads})
  end

  defp tool_call_payload(%{name: name} = entry) when is_binary(name) and name != "" do
    function =
      case entry.arguments do
        "" -> %{"name" => name}
        arguments -> %{"name" => name, "arguments" => arguments}
      end

    call = %{"function" => function}
    if entry.id, do: Map.put(call, "id", entry.id), else: call
  end

  defp tool_call_payload(_entry), do: nil
end
