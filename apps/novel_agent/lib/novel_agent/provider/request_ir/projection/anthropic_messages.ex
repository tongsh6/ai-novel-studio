defmodule NovelAgent.Provider.RequestIR.Projection.AnthropicMessages do
  @moduledoc """
  B71 CP2：Request IR → Anthropic Messages body 投影（VS-00L §6.2）。

  - system → system text blocks（可作缓存断点）
  - assistant tool calls → `tool_use` content blocks
  - observation/validation → `tool_result` content blocks（tool_use_id 关联）
  """

  alias NovelAgent.Provider.RequestIR.{Compaction, Projection}

  @spec project(struct()) :: map() | {:error, term()}
  def project(ir) do
    with {:ok, messages} <- prepare_messages(Compaction.project(ir.messages)) do
      %{
        system: [%{type: "text", text: Projection.system_text(ir.system)}],
        messages: Enum.flat_map(messages, &project_message/1),
        tools: Enum.map(ir.tools, &tool_schema/1),
        stream: Projection.usage_streaming?(ir)
      }
    end
  end

  @doc "Messages 的 tool_use 只接受对象；不能把其它协议的坏参数原文替换成空对象。"
  def parse_arguments(arguments, _call_id) when is_map(arguments),
    do: {:ok, Projection.json_value(arguments)}

  def parse_arguments(arguments, call_id) when is_binary(arguments) do
    case Jason.decode(arguments) do
      {:ok, input} when is_map(input) -> {:ok, input}
      _ -> {:error, {:unrepresentable_tool_arguments, call_id}}
    end
  end

  def parse_arguments(_arguments, call_id),
    do: {:error, {:unrepresentable_tool_arguments, call_id}}

  defp prepare_messages(messages), do: map_validated(messages, &prepare_message/1)

  defp prepare_message(message) do
    with {:ok, blocks} <- map_validated(message.blocks, &prepare_block/1),
         do: {:ok, %{message | blocks: blocks}}
  end

  defp prepare_block(%{type: "tool_call"} = block) do
    with {:ok, arguments} <-
           parse_arguments(block[:raw_arguments] || block.arguments, block.call_id),
         do: {:ok, %{block | arguments: arguments}}
  end

  defp prepare_block(block), do: {:ok, block}

  defp map_validated(items, fun) do
    items
    |> Enum.reduce_while({:ok, []}, fn item, {:ok, acc} ->
      case fun.(item) do
        {:ok, value} -> {:cont, {:ok, [value | acc]}}
        error -> {:halt, error}
      end
    end)
    |> case do
      {:ok, values} -> {:ok, Enum.reverse(values)}
      error -> error
    end
  end

  defp project_message(%{role: "system"} = message), do: user_text(message.blocks, nil)

  defp project_message(%{role: role} = message)
       when role in ["application_base", "application_notice"],
       do: user_text(message.blocks, role)

  defp project_message(%{role: "checkpoint"} = message) do
    case Projection.checkpoint_text(message.blocks) do
      "" ->
        []

      text ->
        [
          %{
            role: "user",
            content: [%{type: "text", text: Projection.provenance_header("checkpoint") <> text}]
          }
        ]
    end
  end

  defp project_message(%{role: "scope_update"} = message) do
    case Projection.text_of(message.blocks) do
      "" ->
        []

      _text ->
        [
          %{
            role: "user",
            content: [%{type: "text", text: Projection.scope_update_text(message)}]
          }
        ]
    end
  end

  defp project_message(%{role: "user"} = message), do: user_text(message.blocks, nil)

  defp project_message(%{role: "assistant"} = message) do
    text_blocks =
      case Projection.text_of(message.blocks) do
        "" -> []
        text -> [%{type: "text", text: text}]
      end

    tool_blocks =
      message.blocks
      |> Enum.filter(&(Map.get(&1, :type) == "tool_call"))
      |> Enum.map(fn block ->
        %{
          type: "tool_use",
          id: Map.get(block, :call_id),
          name: Map.get(block, :name),
          input: Map.get(block, :arguments, %{})
        }
      end)

    case text_blocks ++ tool_blocks do
      [] -> []
      blocks -> [%{role: "assistant", content: blocks}]
    end
  end

  defp project_message(%{role: "tool"} = message) do
    blocks =
      message.blocks
      |> Enum.filter(&(Map.get(&1, :type) in ["observation", "validation_result"]))
      |> Enum.map(fn block ->
        %{
          type: "tool_result",
          tool_use_id: Map.get(block, :call_id),
          content: Projection.structured_content(block)
        }
      end)

    case blocks do
      [] -> []
      blocks -> [%{role: "user", content: blocks}]
    end
  end

  defp project_message(_message), do: []

  defp user_text(blocks, provenance) do
    case Projection.text_of(blocks) do
      "" ->
        []

      text ->
        content =
          case provenance do
            nil -> text
            kind -> Projection.provenance_header(kind) <> text
          end

        [%{role: "user", content: [%{type: "text", text: content}]}]
    end
  end

  defp tool_schema(tool) do
    %{
      name: Projection.tool_name(tool),
      description: Projection.tool_description(tool),
      input_schema: Projection.tool_schema(tool)
    }
  end
end
