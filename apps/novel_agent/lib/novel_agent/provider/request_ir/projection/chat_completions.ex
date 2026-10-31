defmodule NovelAgent.Provider.RequestIR.Projection.ChatCompletions do
  @moduledoc """
  B71 CP2：Request IR → OpenAI-compatible Chat Completions body 投影（VS-00L §6.1）。

  - assistant tool calls → `assistant.tool_calls[]`（`id` = call_id）
  - observation/validation → `role: "tool"` + `tool_call_id`
  - application_base/checkpoint 加 provenance 标记；作者原话独立 user 消息、字节不变
  """

  alias NovelAgent.Provider.RequestIR.Projection

  @spec project(struct()) :: map()
  def project(ir) do
    %{
      messages:
        [%{role: "system", content: Projection.system_text(ir.system)}] ++
          Enum.flat_map(ir.messages, &project_message/1),
      tools: Enum.map(ir.tools, &tool_schema/1),
      stream: Projection.usage_streaming?(ir)
    }
  end

  defp project_message(%{role: "system"} = message) do
    case Projection.text_of(message.blocks) do
      "" -> []
      text -> [%{role: "system", content: text}]
    end
  end

  defp project_message(%{role: "application_base"} = message) do
    case Projection.text_of(message.blocks) do
      "" -> []
      text -> [%{role: "user", content: Projection.provenance_header("application_base") <> text}]
    end
  end

  defp project_message(%{role: "checkpoint"} = message) do
    case Projection.checkpoint_text(message.blocks) do
      "" -> []
      text -> [%{role: "user", content: Projection.provenance_header("checkpoint") <> text}]
    end
  end

  defp project_message(%{role: "user"} = message) do
    case Projection.text_of(message.blocks) do
      "" -> []
      text -> [%{role: "user", content: text}]
    end
  end

  defp project_message(%{role: "assistant"} = message) do
    text = Projection.text_of(message.blocks)
    calls = Enum.filter(message.blocks, &(Map.get(&1, :type) == "tool_call"))

    base = %{role: "assistant", content: text}

    case calls do
      [] -> [base]
      _ -> [Map.put(base, :tool_calls, Enum.map(calls, &tool_call/1))]
    end
  end

  defp project_message(%{role: "tool"} = message) do
    message.blocks
    |> Enum.filter(&(Map.get(&1, :type) in ["observation", "validation_result"]))
    |> Enum.map(fn block ->
      %{
        role: "tool",
        tool_call_id: Map.get(block, :call_id),
        content: Projection.structured_content(block)
      }
    end)
  end

  # tentative_artifact / author_exit 是应用侧事实，由 base_refs 承载（VS-00L §3.5）。
  defp project_message(_message), do: []

  defp tool_call(block) do
    %{
      id: Map.get(block, :call_id),
      type: "function",
      function: %{
        name: Map.get(block, :name),
        arguments: Jason.encode!(Map.get(block, :arguments, %{}))
      }
    }
  end

  defp tool_schema(tool) do
    %{
      type: "function",
      function: %{
        name: Projection.tool_name(tool),
        description: Projection.tool_description(tool),
        parameters: Projection.tool_schema(tool)
      }
    }
  end
end
