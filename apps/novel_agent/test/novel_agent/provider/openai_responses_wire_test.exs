defmodule NovelAgent.Provider.OpenAIResponsesWireTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.OpenAI
  alias NovelAgent.Provider.Result
  alias NovelCommon.CapabilityProfile
  alias NovelCommon.RequestIR

  alias NovelTest.TestRequestIR

  # adapter 只接受 canonical IR；测试用作者原话构造最小请求，文字保持原字节。
  defp ir(text) when is_binary(text), do: TestRequestIR.ir([TestRequestIR.author(text)])

  # R2：execute/5 走 Responses SSE 流式传输；用 eventsource mock 捕获真实 body
  # 并返回官方事件序列（created/output_item/output_text.delta/completed）。
  defp responses_stream_state(eventsource) do
    %OpenAI{
      api_key: "sk-test",
      endpoint: "https://api.openai.com/v1",
      model: "gpt-5-fixture",
      timeout: 100,
      log_fn: nil,
      http_fn: fn _url, _body, _opts -> raise "responses execute must stream" end,
      eventsource_fn: eventsource
    }
    |> Map.put(:wire_api, :responses)
  end

  defp sse(payload), do: "data: #{Jason.encode!(payload)}\n\n"

  describe "adapter 级真实传输" do
    test "execute/5 的普通文本请求走 responses SSE 流式传输，不伪装 chat 流" do
      parent = self()

      eventsource = fn url, body, _opts, on_data ->
        send(parent, {:responses_execute, url, body})

        on_data.(
          sse(%{"type" => "response.created", "response" => %{"model" => "gpt-5-fixture"}})
        )

        on_data.(
          sse(%{
            "type" => "response.output_text.delta",
            "item_id" => "msg_1",
            "output_index" => 0,
            "delta" => "你好，世界"
          })
        )

        on_data.(
          sse(%{
            "type" => "response.completed",
            "response" => %{
              "model" => "gpt-5-fixture",
              "usage" => %{"input_tokens" => 5, "output_tokens" => 3}
            }
          })
        )

        {:ok, 200, ""}
      end

      state = responses_stream_state(eventsource)

      assert {:ok, %{result: result, output: output}} =
               OpenAI.execute(state, nil, ir("写一句问候"), %InferenceParams{}, provider_ctx())

      assert result.content == "你好，世界"
      assert result.usage.input_tokens == 5
      assert result.usage.output_tokens == 3
      assert output.content.text == "你好，世界"
      assert_receive {:responses_execute, url, body}
      assert url == "https://api.openai.com/v1/responses"
      assert body.stream == true
      refute Map.has_key?(body, :messages)
    end

    test "工具调用请求投影为 Responses 原生 tools 并解析 function_call 输出（SSE）" do
      parent = self()
      raw_arguments = ~s({"query":"沈砚","offset":0})

      eventsource = fn url, body, _opts, on_data ->
        send(parent, {:responses_tool_request, url, body})

        on_data.(
          sse(%{"type" => "response.created", "response" => %{"model" => "gpt-5-fixture"}})
        )

        on_data.(
          sse(%{
            "type" => "response.output_item.done",
            "output_index" => 0,
            "item" => %{
              "type" => "function_call",
              "id" => "fc_private_1",
              "call_id" => "call-read-1",
              "name" => "read_character",
              "arguments" => raw_arguments
            }
          })
        )

        on_data.(
          sse(%{
            "type" => "response.completed",
            "response" => %{
              "model" => "gpt-5-fixture",
              "usage" => %{"input_tokens" => 7, "output_tokens" => 2}
            }
          })
        )

        {:ok, 200, ""}
      end

      state = responses_stream_state(eventsource)

      prompt =
        TestRequestIR.ir(
          [TestRequestIR.author("读取角色事实")],
          tools: [
            TestRequestIR.tool("read_character", %{
              type: "object",
              properties: %{query: %{type: "string"}}
            })
          ],
          projection: %{tool_choice: "read_character"}
        )

      assert {:ok, %{result: result}} =
               OpenAI.execute(state, nil, prompt, %InferenceParams{}, provider_ctx())

      # canonical 工具身份只认 call_id；provider 私有 item id（fc_...）不混用。
      assert [
               %{
                 "id" => "call-read-1",
                 "name" => "read_character",
                 "arguments" => %{"query" => "沈砚", "offset" => 0},
                 "raw_arguments" => ^raw_arguments
               }
             ] = result.tool_calls

      assert_receive {:responses_tool_request, url, body}
      assert url == "https://api.openai.com/v1/responses"
      refute Map.has_key?(body, :messages)

      assert [tool] = body.tools
      assert tool.type == "function"
      assert tool.name == "read_character"
      assert body.tool_choice == %{type: "function", name: "read_character"}
    end

    test "canonical IR 的 tool 结果回投为 function_call_output，原参数与 call_id 保持（SSE）" do
      parent = self()
      raw_arguments = ~s({"query":"沈砚"})

      eventsource = fn url, body, _opts, on_data ->
        send(parent, {:responses_replay, url, body})

        on_data.(
          sse(%{"type" => "response.created", "response" => %{"model" => "gpt-5-fixture"}})
        )

        on_data.(
          sse(%{
            "type" => "response.output_text.delta",
            "item_id" => "msg_1",
            "output_index" => 0,
            "delta" => "已读取"
          })
        )

        on_data.(
          sse(%{
            "type" => "response.completed",
            "response" => %{
              "model" => "gpt-5-fixture",
              "usage" => %{"input_tokens" => 3, "output_tokens" => 1}
            }
          })
        )

        {:ok, 200, ""}
      end

      ir =
        RequestIR.new(%{
          run: %{run_id: "run-responses", work_id: "work-responses"},
          system: RequestIR.system_envelope(),
          messages: [RequestIR.message(:user, :author, [RequestIR.text_block("读取角色事实")])],
          tools: [
            %{
              name: "read_character",
              description: "读取角色",
              input_schema: %{type: "object"}
            }
          ],
          projection: %{}
        })

      result =
        Result.new("", nil,
          tool_calls: [
            %{
              "id" => "call-read-1",
              "name" => "read_character",
              "arguments" => %{"query" => "沈砚"},
              "raw_arguments" => raw_arguments
            }
          ]
        )

      {ir, _result} = RequestIR.append_assistant_result(ir, result)
      ir = RequestIR.append_validation_result(ir, "call-read-1", "passed", "fixture")

      assert {:ok, prepared} =
               RequestIR.prepare_request(ir, tool_names: ["read_character"])

      assert {:ok, %{result: result}} =
               OpenAI.execute(
                 responses_stream_state(eventsource),
                 nil,
                 prepared,
                 %InferenceParams{},
                 provider_ctx()
               )

      assert result.content == "已读取"

      assert_receive {:responses_replay, url, body}
      assert url == "https://api.openai.com/v1/responses"

      function_call = Enum.find(body.input, &(&1.type == "function_call"))
      assert function_call.call_id == "call-read-1"
      assert function_call.arguments == raw_arguments

      output = Enum.find(body.input, &(&1.type == "function_call_output"))
      assert output.call_id == "call-read-1"
      assert output.output =~ "fixture"

      # chat 形状（role/content 消息）不得冒充 responses 工具结果。
      refute Enum.any?(body.input, &(Map.get(&1, :role) == "tool"))
    end
  end

  describe "能力事实" do
    test "responses wire 提供真实 SSE 流式能力，其余必备能力可证" do
      state = Map.put(OpenAI.from_config(), :wire_api, :responses)
      profile = CapabilityProfile.from_adapter(OpenAI, state)

      assert profile[:streaming] == true
      assert profile[:tool_calls] == true
      assert profile[:tool_results] == true
      assert profile[:structured_output] == true
      assert profile[:native_multi_turn] == true
      assert profile[:usage] == true

      chat = CapabilityProfile.from_adapter(OpenAI, OpenAI.from_config())
      assert chat[:streaming] == true
    end
  end

  defp provider_ctx do
    %{
      provider_name: :openai,
      model_name: "gpt-5-fixture",
      provider_call_ref: "pcall_responses_test",
      provider_run_id: "prun_responses_test",
      purpose: :conversation,
      owner_refs: %{}
    }
  end
end
