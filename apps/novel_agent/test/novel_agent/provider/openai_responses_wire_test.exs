defmodule NovelAgent.Provider.OpenAIResponsesWireTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.CapabilityProfile
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.OpenAI
  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.Result

  alias NovelAgent.TestRequestIR

  # adapter 只接受 canonical IR；测试用作者原话构造最小请求，文字保持原字节。
  defp ir(text) when is_binary(text), do: TestRequestIR.ir([TestRequestIR.author(text)])

  # VS-00L §6.3：Responses API 必须有真实生产传输，而不是「投影存在但不可达」。
  # `OpenAICompatible.endpoint_url/1` 过去固定 `/chat/completions`，HTTP body 也
  # 只投影 Chat Completions；本测试锁定 route 级 wire 选择与响应事实。
  defp responses_state(mock, opts \\ []) do
    Map.merge(
      %OpenAI{
        api_key: "sk-test",
        endpoint: "https://api.openai.com/v1",
        model: "gpt-5-fixture",
        timeout: 100,
        log_fn: nil,
        http_fn: mock,
        eventsource_fn: fn _url, _body, _opts, _on_data ->
          send(self(), :eventsource_used)
          {:ok, 200, ""}
        end
      },
      Map.new(opts)
    )
    |> Map.put(:wire_api, :responses)
  end

  defp responses_body do
    %{
      "id" => "resp_fixture",
      "model" => "gpt-5-fixture",
      "output" => [
        %{
          "type" => "message",
          "role" => "assistant",
          "content" => [
            %{"type" => "output_text", "text" => "你好"},
            %{"type" => "output_text", "text" => "，世界"}
          ]
        }
      ],
      "usage" => %{"input_tokens" => 5, "output_tokens" => 3}
    }
  end

  describe "adapter 级真实传输" do
    test "complete/4 走 /responses 并解析 Responses output（不是 chat choices）" do
      parent = self()

      mock = fn url, body, opts ->
        send(parent, {:responses_request, url, body, opts})
        {:ok, 200, responses_body()}
      end

      state = responses_state(mock)

      assert {:ok, result} =
               OpenAI.complete(state, nil, ir("写一句问候"), %InferenceParams{})

      assert result.content == "你好，世界"
      assert result.usage.input_tokens == 5
      assert result.usage.output_tokens == 3

      assert_receive {:responses_request, url, body, _opts}
      assert url == "https://api.openai.com/v1/responses"
      assert body.stream == false
      # Responses 使用 input items，而不是 chat messages。
      refute Map.has_key?(body, :messages)
      assert [%{type: "message", role: "user", content: content}] = body.input
      assert content == [%{type: "input_text", text: "写一句问候"}]
    end

    test "execute/5 的普通文本请求走 responses 非流式传输，不伪装 chat 流" do
      parent = self()

      mock = fn url, body, _opts ->
        send(parent, {:responses_execute, url, body})
        {:ok, 200, responses_body()}
      end

      state = responses_state(mock)

      assert {:ok, %{result: result, output: output}} =
               OpenAI.execute(state, nil, ir("写一句问候"), %InferenceParams{}, provider_ctx())

      assert result.content == "你好，世界"
      assert output.content.text == "你好，世界"
      assert_receive {:responses_execute, url, body}
      assert url == "https://api.openai.com/v1/responses"
      assert body.stream == false
      refute_received :eventsource_used
    end

    test "工具调用请求投影为 Responses 原生 tools 并解析 function_call 输出" do
      parent = self()
      raw_arguments = ~s({"query":"沈砚","offset":0})

      mock = fn url, body, _opts ->
        send(parent, {:responses_tool_request, url, body})

        {:ok, 200,
         %{
           "id" => "resp_tool",
           "model" => "gpt-5-fixture",
           "output" => [
             %{
               "type" => "function_call",
               "call_id" => "call-read-1",
               "name" => "read_character",
               "arguments" => raw_arguments
             }
           ],
           "usage" => %{"input_tokens" => 7, "output_tokens" => 2}
         }}
      end

      state = responses_state(mock)

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

      assert tool.parameters == %{
               "type" => "object",
               "properties" => %{"query" => %{"type" => "string"}}
             }

      assert body.tool_choice == %{type: "function", name: "read_character"}
    end

    test "canonical IR 的 tool 结果回投为 function_call_output，原参数与 call_id 保持" do
      parent = self()
      raw_arguments = ~s({"query":"沈砚"})

      mock = fn url, body, _opts ->
        send(parent, {:responses_replay, url, body})

        {:ok, 200,
         %{
           "id" => "resp_replay",
           "output" => [
             %{
               "type" => "message",
               "content" => [%{"type" => "output_text", "text" => "已读取"}]
             }
           ],
           "usage" => %{"input_tokens" => 3, "output_tokens" => 1}
         }}
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
                 responses_state(mock),
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
    test "responses wire 的 streaming 能力如实为 false，其余必备能力可证" do
      state = Map.put(OpenAI.from_config(), :wire_api, :responses)
      profile = CapabilityProfile.from_adapter(OpenAI, state)

      assert profile[:streaming] == false
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
