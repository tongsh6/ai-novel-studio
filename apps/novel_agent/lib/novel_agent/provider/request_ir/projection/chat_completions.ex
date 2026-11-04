defmodule NovelAgent.Provider.RequestIR.Projection.ChatCompletions do
  @moduledoc """
  B71 CP2：Request IR → OpenAI-compatible Chat Completions body 投影（VS-00L §6.1）。

  - assistant tool calls → `assistant.tool_calls[]`（`id` = call_id）
  - observation/validation → `role: "tool"` + `tool_call_id`
  - application_base/scope_update/application_notice/checkpoint 保留应用 provenance
  - 作者原话独立 user 消息、字节不变；assistant 保留原始参数与私有推理引用
  """

  alias NovelAgent.Provider.RequestIR.{Compaction, Projection}

  @spec project(struct(), keyword()) :: map()
  def project(ir, opts \\ []) do
    %{
      messages:
        [%{role: "system", content: Projection.system_text(ir.system)}] ++
          Enum.flat_map(Compaction.project(ir.messages), fn message ->
            message
            |> project_message()
            |> preserve_provider_state(message, Keyword.get(opts, :include_provider_state, false))
          end),
      stream: Projection.usage_streaming?(ir)
    }
    |> put_tools(Enum.map(ir.tools, &tool_schema/1))
    |> put_tool_choice(NovelAgent.Provider.tool_choice(ir))
  end

  defp put_tools(body, []), do: body
  defp put_tools(body, tools), do: Map.put(body, :tools, tools)

  defp put_tool_choice(body, nil), do: body
  defp put_tool_choice(body, "none"), do: Map.put(body, :tool_choice, "none")
  defp put_tool_choice(body, "auto"), do: Map.put(body, :tool_choice, "auto")
  defp put_tool_choice(body, "required"), do: Map.put(body, :tool_choice, "required")

  defp put_tool_choice(body, name) when is_binary(name),
    do: Map.put(body, :tool_choice, %{type: "function", function: %{name: name}})

  # 只有来源 adapter 显式请求时才携带 opaque 私有状态；默认 HTTP 投影不输出。
  defp preserve_provider_state([projected], %{role: "assistant", provider_state: state}, true)
       when is_map(state) and map_size(state) > 0,
       do: [Map.put(projected, :provider_state, state)]

  defp preserve_provider_state(projected, _message, _include?), do: projected

  defp project_message(%{role: "system"} = message) do
    case Projection.text_of(message.blocks) do
      "" -> []
      text -> [%{role: "system", content: text}]
    end
  end

  defp project_message(%{role: role} = message)
       when role in ["application_base", "application_notice"] do
    case Projection.text_of(message.blocks) do
      "" -> []
      text -> [%{role: "user", content: Projection.provenance_header(role) <> text}]
    end
  end

  defp project_message(%{role: "checkpoint"} = message) do
    case Projection.checkpoint_text(message.blocks) do
      "" -> []
      text -> [%{role: "user", content: Projection.provenance_header("checkpoint") <> text}]
    end
  end

  defp project_message(%{role: "scope_update"} = message) do
    case Projection.text_of(message.blocks) do
      "" -> []
      _text -> [%{role: "user", content: Projection.scope_update_text(message)}]
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

    assistant =
      case calls do
        [] -> base
        _ -> Map.put(base, :tool_calls, Enum.map(calls, &tool_call/1))
      end

    [assistant]
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
        arguments:
          Map.get(block, :raw_arguments) ||
            Jason.encode!(Projection.json_value(Map.get(block, :arguments, %{})))
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
