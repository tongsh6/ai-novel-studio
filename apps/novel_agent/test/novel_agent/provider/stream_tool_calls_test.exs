defmodule NovelAgent.Provider.StreamToolCallsTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Anthropic
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.OpenAI
  alias NovelAgent.Provider.RequestIR

  @prompt %{
    messages: [%{role: "user", content: "读取角色事实"}],
    tools: [
      %{
        name: "read_character",
        description: "读取角色",
        input_schema: %{type: "object", properties: %{query: %{type: "string"}}}
      }
    ],
    # tools 存在但模型未被强制调用：真实 adapter 走流式路径，SSE 中仍可能返回
    # 原生 tool_calls（VS-00L §6 投影无损；I-ART-8 不得静默丢字段）。
    tool_choice: "none"
  }

  defp provider_ctx(provider) do
    %{
      provider_name: provider,
      model_name: "fixture-model",
      provider_call_ref: "pcall_stream_tool_test",
      provider_run_id: "prun_stream_tool_test",
      purpose: :conversation,
      owner_refs: %{}
    }
  end

  defp sse(payload), do: "data: #{Jason.encode!(payload)}\n\n"

  defp anthropic_sse(event, payload) do
    "event: #{event}\ndata: #{Jason.encode!(payload)}\n\n"
  end

  defp ir_with_author_message do
    RequestIR.new(%{
      run: %{run_id: "run-stream-tool", work_id: "work-stream-tool"},
      system: %{identity_ref: "identity:fixture"},
      messages: [RequestIR.message(:user, :author, [RequestIR.text_block("读取角色事实")])],
      projection: %{
        target: "chat_completions",
        capability_profile: Map.new(RequestIR.required_capabilities(), &{&1, true})
      }
    })
  end

  test "OpenAI 兼容 SSE 的 tool_call 分片无损累积到 Result.tool_calls" do
    raw_arguments = ~s({"query":"沈砚","offset":0})

    eventsource = fn _url, _body, _opts, on_data ->
      on_data.(
        sse(%{
          "choices" => [
            %{
              "delta" => %{
                "tool_calls" => [
                  %{
                    "index" => 0,
                    "id" => "call-read-1",
                    "type" => "function",
                    "function" => %{"name" => "read_character", "arguments" => ""}
                  }
                ]
              }
            }
          ]
        })
      )

      on_data.(
        sse(%{
          "choices" => [
            %{
              "delta" => %{
                "tool_calls" => [
                  %{"index" => 0, "function" => %{"arguments" => ~s({"query":"沈砚",)}}
                ]
              }
            }
          ]
        })
      )

      on_data.(
        sse(%{
          "choices" => [
            %{
              "delta" => %{
                "tool_calls" => [
                  %{"index" => 0, "function" => %{"arguments" => ~s("offset":0})}}
                ]
              }
            }
          ]
        })
      )

      on_data.(
        sse(%{
          "choices" => [%{"delta" => %{}}],
          "usage" => %{"prompt_tokens" => 9, "completion_tokens" => 4}
        })
      )

      on_data.("data: [DONE]\n\n")
      {:ok, 200, ""}
    end

    state = %OpenAI{
      api_key: "sk-test",
      endpoint: "https://example.invalid/v1",
      model: "fixture-model",
      timeout: 100,
      eventsource_fn: eventsource,
      log_fn: nil
    }

    assert {:ok, %{result: result}} =
             OpenAI.execute(state, nil, @prompt, %InferenceParams{}, provider_ctx(:openai))

    assert result.content == ""

    assert [
             %{
               "id" => "call-read-1",
               "name" => "read_character",
               "arguments" => %{"query" => "沈砚", "offset" => 0},
               "raw_arguments" => ^raw_arguments
             }
           ] = result.tool_calls

    assert result.usage.input_tokens == 9
    assert result.usage.output_tokens == 4

    # Result.tool_calls 与 canonical IR 必须同源：原参数字节不得被改写。
    {ir, _result} = RequestIR.append_assistant_result(ir_with_author_message(), result)
    assistant = Enum.find(ir.messages, &(&1.role == "assistant"))
    assert [%{type: "tool_call", call_id: "call-read-1", name: "read_character"} = call] =
             Enum.filter(assistant.blocks, &(&1.type == "tool_call"))

    assert call.raw_arguments == raw_arguments
    assert call.arguments == %{"query" => "沈砚", "offset" => 0}
  end

  test "Anthropic SSE 的 tool_use input_json_delta 无损累积到 Result.tool_calls" do
    raw_arguments = ~s({"query":"沈砚","offset":6000})

    eventsource = fn _url, _body, _opts, on_data ->
      on_data.(
        anthropic_sse("message_start", %{
          "type" => "message_start",
          "message" => %{
            "model" => "claude-fixture",
            "usage" => %{"input_tokens" => 11, "output_tokens" => 0}
          }
        })
      )

      on_data.(
        anthropic_sse("content_block_start", %{
          "type" => "content_block_start",
          "index" => 0,
          "content_block" => %{
            "type" => "tool_use",
            "id" => "toolu-read-1",
            "name" => "read_character",
            "input" => %{}
          }
        })
      )

      on_data.(
        anthropic_sse("content_block_delta", %{
          "type" => "content_block_delta",
          "index" => 0,
          "delta" => %{"type" => "input_json_delta", "partial_json" => ~s({"query":"沈砚",)}
        })
      )

      on_data.(
        anthropic_sse("content_block_delta", %{
          "type" => "content_block_delta",
          "index" => 0,
          "delta" => %{"type" => "input_json_delta", "partial_json" => ~s("offset":6000})}
        })
      )

      on_data.(
        anthropic_sse("content_block_stop", %{
          "type" => "content_block_stop",
          "index" => 0
        })
      )

      on_data.(
        anthropic_sse("message_delta", %{
          "type" => "message_delta",
          "usage" => %{"output_tokens" => 6}
        })
      )

      on_data.(anthropic_sse("message_stop", %{"type" => "message_stop"}))
      {:ok, 200, ""}
    end

    state = %Anthropic{
      api_key: "sk-ant-test",
      model: "claude-fixture",
      timeout: 100,
      eventsource_fn: eventsource,
      log_fn: nil
    }

    assert {:ok, %{result: result}} =
             Anthropic.execute(state, nil, @prompt, %InferenceParams{}, provider_ctx(:anthropic))

    assert result.content == ""

    assert [
             %{
               "id" => "toolu-read-1",
               "name" => "read_character",
               "arguments" => %{"query" => "沈砚", "offset" => 6000},
               "raw_arguments" => ^raw_arguments
             }
           ] = result.tool_calls

    assert result.usage.input_tokens == 11
    assert result.usage.output_tokens == 6

    {ir, _result} = RequestIR.append_assistant_result(ir_with_author_message(), result)
    assistant = Enum.find(ir.messages, &(&1.role == "assistant"))
    assert [%{type: "tool_call", call_id: "toolu-read-1"} = call] =
             Enum.filter(assistant.blocks, &(&1.type == "tool_call"))

    assert call.raw_arguments == raw_arguments
  end
end
