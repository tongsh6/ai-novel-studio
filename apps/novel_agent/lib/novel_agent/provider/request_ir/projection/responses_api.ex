defmodule NovelAgent.Provider.RequestIR.Projection.ResponsesAPI do
  @moduledoc """
  B71 CP2：Request IR → Responses API body 投影（VS-00L §6.3）。

  - system → `instructions`（稳定前缀）
  - assistant tool calls → `function_call` input items
  - observation/validation → `function_call_output` input items（call_id 关联）
  - `previous_response_id` 只作优化，不进入本地 IR 事实源
  """

  alias NovelAgent.Provider.RequestIR.Projection

  @spec project(struct()) :: map()
  def project(ir) do
    %{
      instructions: Projection.system_text(ir.system),
      input: Enum.flat_map(ir.messages, &project_message/1),
      tools: Enum.map(ir.tools, &tool_schema/1),
      stream: Projection.usage_streaming?(ir)
    }
  end

  defp project_message(%{role: "system"} = message),
    do: message_item("system", message.blocks, nil)

  defp project_message(%{role: "application_base"} = message),
    do: message_item("user", message.blocks, "application_base")

  defp project_message(%{role: "checkpoint"} = message) do
    case Projection.checkpoint_text(message.blocks) do
      "" ->
        []

      text ->
        [
          %{
            type: "message",
            role: "user",
            content: [
              %{type: "input_text", text: Projection.provenance_header("checkpoint") <> text}
            ]
          }
        ]
    end
  end

  defp project_message(%{role: "user"} = message), do: message_item("user", message.blocks, nil)

  defp project_message(%{role: "assistant"} = message) do
    text = Projection.text_of(message.blocks)

    message_items =
      case text do
        "" ->
          []

        text ->
          [%{type: "message", role: "assistant", content: [%{type: "output_text", text: text}]}]
      end

    call_items =
      message.blocks
      |> Enum.filter(&(Map.get(&1, :type) == "tool_call"))
      |> Enum.map(fn block ->
        %{
          type: "function_call",
          call_id: Map.get(block, :call_id),
          name: Map.get(block, :name),
          arguments: Jason.encode!(Map.get(block, :arguments, %{}))
        }
      end)

    message_items ++ call_items
  end

  defp project_message(%{role: "tool"} = message) do
    message.blocks
    |> Enum.filter(&(Map.get(&1, :type) in ["observation", "validation_result"]))
    |> Enum.map(fn block ->
      %{
        type: "function_call_output",
        call_id: Map.get(block, :call_id),
        output: Projection.structured_content(block)
      }
    end)
  end

  defp project_message(_message), do: []

  defp message_item(role, blocks, provenance) do
    case Projection.text_of(blocks) do
      "" ->
        []

      text ->
        content =
          case provenance do
            nil -> text
            kind -> Projection.provenance_header(kind) <> text
          end

        [%{type: "message", role: role, content: [%{type: "input_text", text: content}]}]
    end
  end

  defp tool_schema(tool) do
    %{
      type: "function",
      name: Projection.tool_name(tool),
      description: Projection.tool_description(tool),
      parameters: Projection.tool_schema(tool)
    }
  end
end
