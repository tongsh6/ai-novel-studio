defmodule NovelAgent.Provider.RequestIR.Projection.AnthropicMessages do
  @moduledoc """
  B71 CP2：Request IR → Anthropic Messages body 投影（VS-00L §6.2）。

  - system → system text blocks（可作缓存断点）
  - assistant tool calls → `tool_use` content blocks
  - observation/validation → `tool_result` content blocks（tool_use_id 关联）
  """

  alias NovelAgent.Provider.RequestIR.Projection

  @spec project(struct()) :: map()
  def project(ir) do
    %{
      system: [%{type: "text", text: Projection.system_text(ir.system)}],
      messages: Enum.flat_map(ir.messages, &project_message/1),
      tools: Enum.map(ir.tools, &tool_schema/1),
      stream: Projection.usage_streaming?(ir)
    }
  end

  defp project_message(%{role: "system"} = message), do: user_text(message.blocks, nil)

  defp project_message(%{role: "application_base"} = message),
    do: user_text(message.blocks, "application_base")

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
