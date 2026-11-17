defmodule NovelAgent.Provider.StreamToolCallsTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Anthropic
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.OpenAI
  alias NovelCommon.RequestIR
  alias NovelTest.TestRequestIR

  # tools 存在但模型未被强制调用：真实 adapter 走流式路径，SSE 中仍可能返回
  # 原生 tool_calls（VS-00L §6 投影无损；I-ART-8 不得静默丢字段）。
  defp prompt_ir do
    TestRequestIR.ir(
      [TestRequestIR.author("读取角色事实")],
      tools: [
        TestRequestIR.tool("read_character", %{
          type: "object",
          properties: %{query: %{type: "string"}}
        })
      ],
      projection: %{tool_choice: "none"}
    )
  end

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
      system: RequestIR.system_envelope(),
      messages: [RequestIR.message(:user, :author, [RequestIR.text_block("读取角色事实")])],
      projection: %{}
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

    parent = self()

    state = %OpenAI{
      api_key: "sk-test",
      endpoint: "https://example.invalid/v1",
      model: "fixture-model",
      timeout: 100,
      eventsource_fn: eventsource,
      log_fn: fn vendor, url, body, log_result, started ->
        send(parent, {:llm_log, vendor, url, body, log_result, started})
      end
    }

    assert {:ok, %{result: result}} =
             OpenAI.execute(state, nil, prompt_ir(), %InferenceParams{}, provider_ctx(:openai))

    assert result.content == ""

    assert_received {:llm_log, "openai", "https://example.invalid/v1/chat/completions", log_body,
                     {:ok, ^result, attrs}, started}

    assert log_body.stream == true
    assert attrs.status == 200
    assert attrs.usage == result.usage
    assert is_integer(attrs.duration)
    assert is_integer(started)

    assert attrs.resp_body == %{source: "sse_decoder", tool_calls: result.tool_calls}

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

    parent = self()

    state = %Anthropic{
      api_key: "sk-ant-test",
      model: "claude-fixture",
      timeout: 100,
      eventsource_fn: eventsource,
      log_fn: fn vendor, url, body, log_result, started ->
        send(parent, {:llm_log, vendor, url, body, log_result, started})
      end
    }

    assert {:ok, %{result: result}} =
             Anthropic.execute(
               state,
               nil,
               prompt_ir(),
               %InferenceParams{},
               provider_ctx(:anthropic)
             )

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

    assert_received {:llm_log, "anthropic", "https://api.anthropic.com/v1/messages", log_body,
                     {:ok, ^result, attrs}, started}

    assert is_map(log_body)
    assert attrs.status == 200
    assert attrs.usage == result.usage
    assert is_integer(attrs.duration)
    assert is_integer(started)

    assert attrs.resp_body == %{source: "sse_decoder", tool_calls: result.tool_calls}

    {ir, _result} = RequestIR.append_assistant_result(ir_with_author_message(), result)
    assistant = Enum.find(ir.messages, &(&1.role == "assistant"))

    assert [%{type: "tool_call", call_id: "toolu-read-1"} = call] =
             Enum.filter(assistant.blocks, &(&1.type == "tool_call"))

    assert call.raw_arguments == raw_arguments
  end

  # 预期来自协议终结及作者交付边界，不由 decoder 的返回值反推。
  @tag :terminal_contract
  test "Chat HTTP200 和部分正文不能替代完整终结帧" do
    text = sse(%{"choices" => [%{"delta" => %{"content" => "尚未结束的原文"}}]})

    for suffix <- [
          "",
          sse(%{"choices" => [%{"delta" => %{}, "finish_reason" => "stop"}]}),
          sse(%{"choices" => [], "usage" => %{"prompt_tokens" => 7, "completion_tokens" => 3}}),
          sse(%{"choices" => [%{"delta" => %{"content" => "[DONE]"}}]}),
          "data: [DONE]",
          "data: [DONE]\n"
        ] do
      assert {:error, %{error: %{type: :parse}, events: events}} =
               execute_terminal_stream(:openai, [text, suffix])

      assert Enum.any?(events, &(&1.event_type == :chunk))
      assert Enum.any?(events, &(&1.event_type == :error))
      refute Enum.any?(events, &(&1.event_type == :final_output))
    end
  end

  @tag :terminal_contract
  test "完整工具 JSON 在 Chat 流未终结时也不可成为成功工具结果" do
    chunk =
      sse(%{
        "choices" => [
          %{
            "delta" => %{
              "tool_calls" => [
                %{
                  "index" => 0,
                  "id" => "call-original",
                  "function" => %{"name" => "read_character", "arguments" => "{}"}
                }
              ]
            }
          }
        ]
      })

    assert {:error, %{error: %{type: :parse}, events: events}} =
             execute_terminal_stream(:openai, [chunk])

    refute Enum.any?(events, &(&1.event_type == :final_output))
  end

  @tag :terminal_contract
  test "Chat 合法终结可跨任意分片，正文和工具字节不被终结信号修改" do
    text = "原文 **不修改**\n\n末行"
    chunk = sse(%{"choices" => [%{"delta" => %{"content" => text}}]})
    terminal = "data: [DONE]\n\n"

    for split <- 0..byte_size(terminal) do
      <<left::binary-size(split), right::binary>> = terminal
      assert {:ok, %{result: result}} = execute_terminal_stream(:openai, [chunk, left, right])
      assert result.content == text
    end
  end

  @tag :terminal_contract
  test "供应商错误或终结后的新输出不能被 DONE 洗成成功" do
    text = sse(%{"choices" => [%{"delta" => %{"content" => "已收到的预览"}}]})
    error = sse(%{"error" => %{"message" => "upstream failed"}})

    for chunks <- [[text, error, "data: [DONE]\n\n"], [text, "data: [DONE]\n\n", text]] do
      assert {:error, %{events: events}} = execute_terminal_stream(:openai, chunks)
      refute Enum.any?(events, &(&1.event_type == :final_output))
    end
  end

  @tag :terminal_contract
  test "Anthropic 只认 message_stop，不借正文、usage、stop_reason 或 Chat 标记签完成" do
    text =
      anthropic_sse("content_block_delta", %{
        "type" => "content_block_delta",
        "delta" => %{"type" => "text_delta", "text" => "原始增量"}
      })

    stop = anthropic_sse("message_stop", %{"type" => "message_stop"})

    for suffix <- [
          "",
          "data: [DONE]\n\n",
          String.trim_trailing(stop),
          anthropic_sse("message_delta", %{
            "type" => "message_delta",
            "delta" => %{"stop_reason" => "end_turn"},
            "usage" => %{"output_tokens" => 4}
          })
        ] do
      assert {:error, %{error: %{type: :parse}, events: events}} =
               execute_terminal_stream(:anthropic, [text, suffix])

      assert Enum.any?(events, &(&1.event_type == :chunk))
      refute Enum.any?(events, &(&1.event_type == :final_output))
    end

    assert {:ok, %{result: result}} = execute_terminal_stream(:anthropic, [text, stop])
    assert result.content == "原始增量"
  end

  @tag :terminal_contract
  test "SSE CRLF 跨分片不能把一行结尾误认为空行终结" do
    text = sse(%{"choices" => [%{"delta" => %{"content" => "原文"}}]})
    incomplete = "data: [DONE]\r\n"

    for split <- 0..byte_size(incomplete) do
      <<left::binary-size(split), right::binary>> = incomplete

      assert {:error, %{error: %{type: :parse}}} =
               execute_terminal_stream(:openai, [text, left, right])
    end

    for terminal <- ["data: [DONE]\r\n\r\n", "data: [DONE]\r\r"],
        split <- 0..byte_size(terminal) do
      <<left::binary-size(split), right::binary>> = terminal

      assert {:ok, %{result: %{content: "原文"}}} =
               execute_terminal_stream(:openai, [text, left, right])
    end
  end

  @tag :terminal_contract
  test "合法终结后的未封闭 SSE 尾部不补发事件，也不抹掉已确认终结" do
    text = sse(%{"choices" => [%{"delta" => %{"content" => "原文"}}]})

    for tail <- [": keepalive", "event: ping\n", "data: {\"ignored\":true}"] do
      assert {:ok, %{result: %{content: "原文"}}} =
               execute_terminal_stream(:openai, [text, "data: [DONE]\n\n", tail])

      assert {:error, %{error: %{type: :parse}}} =
               execute_terminal_stream(:openai, [text, tail])
    end
  end

  @tag :terminal_contract
  test "真实 HTTP200 EOF 仍须协议终结，不以 eventsource 替身代签传输" do
    text = sse(%{"choices" => [%{"delta" => %{"content" => "真实传输原文"}}]})

    for {suffix, expected} <- [{"", :error}, {"data: [DONE]\n\n", :ok}] do
      {:ok, listener} = :gen_tcp.listen(0, [:binary, active: false, ip: {127, 0, 0, 1}])
      {:ok, {_ip, port}} = :inet.sockname(listener)
      body = text <> suffix

      server =
        Task.async(fn ->
          {:ok, socket} = :gen_tcp.accept(listener, 2_000)

          try do
            request = read_http_request(socket, "")

            :ok =
              :gen_tcp.send(
                socket,
                "HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: " <>
                  Integer.to_string(byte_size(body)) <> "\r\nConnection: close\r\n\r\n" <> body
              )

            request
          after
            :gen_tcp.close(socket)
          end
        end)

      try do
        state = %OpenAI{
          api_key: "fixture",
          endpoint: "http://127.0.0.1:#{port}/v1",
          model: "fixture-model",
          timeout: 2_000,
          log_fn: nil
        }

        {outcome, execution} =
          OpenAI.execute(state, nil, prompt_ir(), %InferenceParams{}, provider_ctx(:openai))

        assert outcome == expected
        assert Task.await(server, 3_000)["stream"] == true

        if expected == :error do
          assert execution.error.type == :parse
          refute Enum.any?(execution.events, &(&1.event_type == :final_output))
        else
          assert execution.result.content == "真实传输原文"
        end
      after
        Task.shutdown(server, :brutal_kill)
        :gen_tcp.close(listener)
      end
    end
  end

  # 仅服务上面的单请求 loopback 反例，不构造通用服务器或替换产品 HTTP。
  defp read_http_request(socket, buffer) do
    case String.split(buffer, "\r\n\r\n", parts: 2) do
      [headers, body] ->
        [_, length] = Regex.run(~r/content-length:\s*(\d+)/i, headers)

        if byte_size(body) >= String.to_integer(length) do
          Jason.decode!(body)
        else
          {:ok, data} = :gen_tcp.recv(socket, 0, 2_000)
          read_http_request(socket, buffer <> data)
        end

      _ ->
        {:ok, data} = :gen_tcp.recv(socket, 0, 2_000)
        read_http_request(socket, buffer <> data)
    end
  end

  defp execute_terminal_stream(provider, chunks) do
    eventsource = fn _url, _body, _opts, on_data ->
      Enum.each(chunks, on_data)
      {:ok, 200, ""}
    end

    state =
      case provider do
        :openai ->
          %OpenAI{
            api_key: "fixture",
            endpoint: "https://example.invalid/v1",
            model: "fixture-model",
            timeout: 100,
            log_fn: nil,
            eventsource_fn: eventsource
          }

        :anthropic ->
          %Anthropic{
            api_key: "fixture",
            model: "fixture-model",
            timeout: 100,
            log_fn: nil,
            eventsource_fn: eventsource
          }
      end

    state.__struct__.execute(state, nil, prompt_ir(), %InferenceParams{}, provider_ctx(provider))
  end

  # VS-00L §6.4 usage recovery：Chat Completions 流式只有显式声明
  # stream_options.include_usage 才会在 [DONE] 前收到 usage chunk。官方 usage chunk
  # 形态是 choices: []（不携带内容），decoder 必须如实归一到 Result.usage。
  test "OpenAI 兼容 Chat 流式请求声明 stream_options.include_usage 并归一标准 usage chunk" do
    parent = self()

    eventsource = fn _url, body, _opts, on_data ->
      send(parent, {:request_body, body})

      on_data.(sse(%{"choices" => [%{"delta" => %{"content" => "正文"}}]}))

      on_data.(
        sse(%{
          "choices" => [],
          "usage" => %{"prompt_tokens" => 7, "completion_tokens" => 3}
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
             OpenAI.execute(state, nil, prompt_ir(), %InferenceParams{}, provider_ctx(:openai))

    assert_received {:request_body, body}
    assert body.stream == true
    assert body.stream_options == %{include_usage: true}

    assert result.content == "正文"
    assert result.usage.input_tokens == 7
    assert result.usage.output_tokens == 3
  end

  test "缺 usage 帧时流式 usage 保持 0，不伪造非零 token" do
    eventsource = fn _url, _body, _opts, on_data ->
      on_data.(sse(%{"choices" => [%{"delta" => %{"content" => "正文"}}]}))
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
             OpenAI.execute(state, nil, prompt_ir(), %InferenceParams{}, provider_ctx(:openai))

    assert result.content == "正文"
    assert result.usage.input_tokens == 0
    assert result.usage.output_tokens == 0
  end
end
