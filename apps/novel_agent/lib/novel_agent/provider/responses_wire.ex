defmodule NovelAgent.Provider.ResponsesWire do
  @moduledoc """
  Responses API 输出事实的单一解析边界（VS-00L §6.3/§19.1）。

  非流式 `POST /responses` 的 `output` 与流式 SSE 的 done items 使用同一套解析：

  - 正文只来自 `message.content[]` 的 `output_text`；
  - 工具调用身份只认 `call_id`：item `id`（如 `fc_...`）是 provider 私有输出标识，
    与 `call_id` 分属不同用途，混用会让下一轮 `function_call_output.call_id` 绑错；
  - `raw_arguments` 保留 provider 原始参数字节，解析失败不丢弃原字节。
  """

  alias NovelAgent.Provider.Usage

  @doc "从完整或流式合并后的 output items 归一正文与 canonical 工具调用。"
  @spec output([map()]) :: {String.t(), [map()]}
  def output(items) when is_list(items) do
    content = items |> Enum.flat_map(&text_parts/1) |> Enum.join()
    calls = Enum.flat_map(items, &function_call_item/1)
    {content, calls}
  end

  @doc "function_call item → canonical 工具调用；缺 call_id 的 item 不冒充合法调用。"
  @spec function_call_item(map()) :: [map()]
  def function_call_item(
        %{"type" => "function_call", "name" => name, "arguments" => arguments} = item
      )
      when is_binary(name) do
    case Map.get(item, "call_id") do
      call_id when is_binary(call_id) and call_id != "" ->
        [
          %{
            "id" => call_id,
            "name" => name,
            "arguments" => decode_arguments(arguments),
            "raw_arguments" => arguments
          }
        ]

      _missing_call_id ->
        []
    end
  end

  def function_call_item(_item), do: []

  defp text_parts(%{"type" => "message", "content" => blocks}) when is_list(blocks) do
    Enum.flat_map(blocks, fn
      %{"type" => type, "text" => text}
      when type in ["output_text", "text"] and is_binary(text) ->
        [text]

      _block ->
        []
    end)
  end

  defp text_parts(_item), do: []

  @doc "provider usage 事实 → 统一 Usage；缺字段按 0 处理，cached 读嵌套明细。"
  @spec usage(map() | nil, String.t() | nil, non_neg_integer()) :: Usage.t()
  def usage(resp_body, fallback_model, latency) do
    usage = Map.get(resp_body || %{}, "usage") || %{}
    cached = get_in(usage, ["input_tokens_details", "cached_tokens"]) || usage["cached_tokens"]

    Usage.new(
      usage["input_tokens"] || 0,
      usage["output_tokens"] || 0,
      Map.get(resp_body || %{}, "model") || fallback_model,
      latency,
      cached
    )
  end

  @doc "把 provider 原始参数字节解析为对象参数；非法输入返回 `%{}`，原字节由调用方保留。"
  @spec decode_arguments(term()) :: map()
  def decode_arguments(arguments) when is_map(arguments), do: arguments

  def decode_arguments(arguments) when is_binary(arguments) do
    case Jason.decode(arguments) do
      {:ok, value} when is_map(value) -> value
      _other -> %{}
    end
  end

  def decode_arguments(_arguments), do: %{}
end
