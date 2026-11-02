defmodule NovelAgent.Provider.AnthropicTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Anthropic
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.TimeoutPolicy

  describe "name/0" do
    test "returns anthropic identifier" do
      assert Anthropic.name() == "anthropic"
    end
  end

  describe "from_config/0" do
    test "returns struct with defaults" do
      state = Anthropic.from_config()
      assert state.model == "claude-sonnet-4-6"
      assert state.timeout == 300_000
    end
  end

  describe "complete/4" do
    test "returns auth error on 401" do
      mock = fn _url, _body, _opts -> {:error, :http_error, 401, "Unauthorized"} end
      state = %Anthropic{api_key: nil, model: "c", timeout: 100, http_fn: mock, log_fn: nil}

      assert {:error, error} = Anthropic.complete(state, nil, "prompt", %InferenceParams{})
      assert error.type == :auth
    end

    test "returns connection_refused" do
      mock = fn _url, _body, _opts -> {:error, :connection_refused, 0, "拒绝"} end
      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}

      assert {:error, error} = Anthropic.complete(state, nil, "prompt", %InferenceParams{})
      assert error.type == :connection_refused
    end

    test "returns timeout" do
      mock = fn _url, _body, _opts -> {:error, :timeout, 0, "超时"} end
      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}

      assert {:error, error} = Anthropic.complete(state, nil, "prompt", %InferenceParams{})
      assert error.type == :timeout
    end

    test "marks a long system prompt with Anthropic cache_control" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:anthropic_body, body})
        {:error, :http_error, 401, "Unauthorized"}
      end

      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}
      long_system = String.duplicate("规则", 2100)

      prompt = [
        %{role: "system", content: long_system},
        %{role: "user", content: "hi"}
      ]

      assert {:error, _error} = Anthropic.complete(state, nil, prompt, %InferenceParams{})
      assert_receive {:anthropic_body, body}

      assert [
               %{
                 type: "text",
                 text: ^long_system,
                 cache_control: %{type: "ephemeral"}
               }
             ] = body.system
    end
  end

  describe "execute/5" do
    # provider 能力整形：同一工具集分别映射原生 none 与具名 tool_choice，供不同调用族按需使用。
    test "同一工具集在 none 与具名强制调用下分别映射原生 none / 具名 tool_choice" do
      test_pid = self()

      eventsource = fn _url, body, _opts, on_data ->
        send(test_pid, {:tool_choice_none_body, body})

        on_data.(
          anthropic_sse("content_block_delta", %{
            "type" => "content_block_delta",
            "index" => 0,
            "delta" => %{"type" => "text_delta", "text" => "判断说明"}
          })
        )

        {:ok, 200, ""}
      end

      http = fn _url, body, _opts ->
        send(test_pid, {:tool_choice_named_body, body})

        {:ok, 200,
         %{
           "content" => [
             %{
               "type" => "tool_use",
               "id" => "tool-1",
               "name" => "judgment_decision",
               "input" => %{"action" => "reply"}
             }
           ]
         }}
      end

      state = %Anthropic{
        api_key: "test-key",
        model: "claude-sonnet-4-6",
        timeout: 100,
        eventsource_fn: eventsource,
        http_fn: http,
        log_fn: nil
      }

      prompt = %{
        messages: [%{role: "user", content: "判断"}],
        tools: [%{name: "judgment_decision", description: "判断", input_schema: %{type: "object"}}],
        tool_choice: "none"
      }

      assert {:ok, %{provider_run: run}} =
               Anthropic.execute(state, nil, prompt, %InferenceParams{}, provider_ctx())

      refute Map.has_key?(run.metadata, :tool_constancy)

      assert {:ok, _} =
               Anthropic.execute(
                 state,
                 nil,
                 %{prompt | tool_choice: "judgment_decision"},
                 %InferenceParams{},
                 provider_ctx()
               )

      assert_receive {:tool_choice_none_body, first}
      assert_receive {:tool_choice_named_body, second}
      assert first.tools == second.tools
      assert first.tool_choice == %{type: "none"}
      assert second.tool_choice == %{type: "tool", name: "judgment_decision"}
    end

    test "streams Anthropic SSE chunks through provider execution facts" do
      test_pid = self()

      eventsource = fn url, body, opts, on_data ->
        send(test_pid, {:stream_request, url, body, opts})

        on_data.(
          anthropic_sse("message_start", %{
            "type" => "message_start",
            "message" => %{
              "model" => "claude-sonnet-4-6",
              "usage" => %{"input_tokens" => 7, "output_tokens" => 0}
            }
          })
        )

        split_frame =
          anthropic_sse("content_block_delta", %{
            "type" => "content_block_delta",
            "index" => 0,
            "delta" => %{"type" => "text_delta", "text" => "你"}
          })

        {first_half, second_half} = String.split_at(split_frame, div(byte_size(split_frame), 2))
        on_data.(first_half)
        on_data.(second_half)

        on_data.(
          anthropic_sse("content_block_delta", %{
            "type" => "content_block_delta",
            "index" => 0,
            "delta" => %{"type" => "text_delta", "text" => "好"}
          })
        )

        on_data.(
          anthropic_sse("message_delta", %{
            "type" => "message_delta",
            "usage" => %{"output_tokens" => 2}
          })
        )

        on_data.(anthropic_sse("message_stop", %{"type" => "message_stop"}))

        {:ok, 200, ""}
      end

      state = %Anthropic{
        api_key: "sk-ant-secret",
        model: "claude-sonnet-4-6",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }

      prompt = [
        %{role: "system", content: "系统规则"},
        %{role: "user", content: "写一句问候"}
      ]

      assert {:ok, %{events: events, result: result, output: output}} =
               Anthropic.execute(state, nil, prompt, %InferenceParams{}, provider_ctx())

      assert result.content == "你好"
      assert result.usage.input_tokens == 7
      assert result.usage.output_tokens == 2
      assert result.usage.model == "claude-sonnet-4-6"
      assert is_integer(result.usage.ttft_ms)
      assert result.usage.ttft_ms >= 0
      assert output.content.text == "你好"

      assert_receive {:stream_request, url, body, opts}
      assert url == "https://api.anthropic.com/v1/messages"
      assert body.stream == true
      assert body.system == "系统规则"
      assert body.messages == [%{role: "user", content: "写一句问候"}]
      assert {"x-api-key", "sk-ant-secret"} in Keyword.fetch!(opts, :headers)
      assert {"anthropic-version", "2023-06-01"} in Keyword.fetch!(opts, :headers)

      chunk_events = Enum.filter(events, &(&1.event_type == :chunk))
      assert length(chunk_events) == 2
      assert Enum.map(chunk_events, & &1.payload[:content_length]) == [1, 1]
      assert Enum.map(chunk_events, & &1.payload[:accumulated_content_length]) == [1, 2]
      refute Enum.any?(chunk_events, &Map.has_key?(&1.payload, :text_delta))
      refute Enum.any?(chunk_events, &Map.has_key?(&1.payload, :content))
    end

    test "returns auth error before opening an event stream when API key is missing" do
      eventsource = fn _url, _body, _opts, _on_data ->
        send(self(), :unexpected_eventsource)
        {:ok, 200, ""}
      end

      state = %Anthropic{
        api_key: nil,
        model: "claude-sonnet-4-6",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }

      assert {:error, %{error: %{type: :auth}, events: events}} =
               Anthropic.execute(state, nil, "prompt", %InferenceParams{}, provider_ctx())

      assert Enum.map(events, & &1.event_type) == [:started, :error]
      refute_received :unexpected_eventsource
    end

    test "maps Anthropic stream error events into provider execution errors" do
      eventsource = fn _url, _body, _opts, on_data ->
        on_data.(
          anthropic_sse("error", %{
            "type" => "error",
            "error" => %{"type" => "overloaded_error", "message" => "busy"}
          })
        )

        {:ok, 200, ""}
      end

      state = %Anthropic{
        api_key: "sk-ant-secret",
        model: "claude-sonnet-4-6",
        timeout: 100,
        eventsource_fn: eventsource,
        log_fn: nil
      }

      assert {:error, %{error: %{type: :rate_limit, message: message}, events: events}} =
               Anthropic.execute(state, nil, "prompt", %InferenceParams{}, provider_ctx())

      assert message =~ "Anthropic API: busy"
      assert Enum.any?(events, &(&1.event_type == :error))
    end

    test "B22: non-stream tool calls use the non-stream wait window" do
      test_pid = self()

      mock = fn _url, _body, opts ->
        send(test_pid, {:http_opts, opts})

        {:ok, 200,
         %{
           "content" => [%{"type" => "text", "text" => "判断完成"}],
           "usage" => %{"input_tokens" => 5, "output_tokens" => 2}
         }}
      end

      state = %Anthropic{
        api_key: "sk-ant-secret",
        model: "claude-sonnet-4-6",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      prompt = %{
        messages: [%{role: "user", content: "判断"}],
        tools: [
          %{name: "judgment_decision", description: "decision", input_schema: %{type: "object"}}
        ],
        tool_choice: "judgment_decision"
      }

      policy = %TimeoutPolicy{
        provider: :anthropic,
        profile: :hosted,
        connect_ms: 15_000,
        response_ms: 300_000,
        non_stream_ms: 1_234_000,
        deadline_ms: nil
      }

      assert {:ok, _result} =
               Anthropic.execute(
                 state,
                 nil,
                 prompt,
                 %InferenceParams{},
                 provider_ctx(timeout_policy: policy)
               )

      assert_receive {:http_opts, opts}
      assert Keyword.fetch!(opts, :receive_timeout) == 1_234_000
      assert Keyword.fetch!(opts, :connect_timeout) == 15_000
    end
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(Anthropic, :complete, 4)
      assert function_exported?(Anthropic, :execute, 5)
      assert function_exported?(Anthropic, :name, 0)
      assert function_exported?(Anthropic, :from_config, 0)
    end
  end

  defp provider_ctx(overrides \\ []) do
    Map.merge(
      %{
        provider_name: :anthropic,
        model_name: "claude-sonnet-4-6",
        provider_call_ref: "pcall_anthropic_test",
        provider_run_id: "prun_anthropic_test",
        purpose: :conversation,
        owner_refs: %{}
      },
      Map.new(overrides)
    )
  end

  defp anthropic_sse(event, payload) do
    "event: #{event}\ndata: #{Jason.encode!(payload)}\n\n"
  end

  describe "IR v1 桥（B71 CP2，VS-00L §6.2）" do
    test "真实 adapter 在发送前拒绝其它协议的不可表示工具参数" do
      parent = self()

      state = %Anthropic{
        api_key: "test",
        model: "fixture",
        timeout: 100,
        log_fn: nil,
        http_fn: fn _, _, _ ->
          send(parent, :invalid_history_sent)
          {:error, :http_error, 400, "bad"}
        end,
        eventsource_fn: fn _, _, _, _ ->
          send(parent, :invalid_history_streamed)
          {:ok, 200, ""}
        end
      }

      prompt = ir_provider_prompt()

      prompt = %{
        prompt
        | messages:
            Enum.map(prompt.messages, fn
              %{role: "assistant", tool_calls: calls} = message ->
                %{
                  message
                  | tool_calls:
                      Enum.map(calls, &put_in(&1, [:function, :arguments], "{\"query\":}"))
                }

              message ->
                message
            end)
      }

      assert {:error, %{type: :invalid_request}} =
               Anthropic.complete(state, nil, prompt, %InferenceParams{})

      assert {:error, %{error: %{type: :invalid_request}}} =
               Anthropic.execute(
                 state,
                 nil,
                 Map.put(prompt, :tool_choice, "none"),
                 %InferenceParams{},
                 provider_ctx()
               )

      refute_received :invalid_history_sent
      refute_received :invalid_history_streamed
    end

    test "IR → Anthropic Messages：tool_use/tool_result content blocks + 轮次交替" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:anthropic_body, body})
        {:error, :http_error, 401, "Unauthorized"}
      end

      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}
      prompt = ir_provider_prompt()

      assert {:error, _error} = Anthropic.complete(state, nil, prompt, %InferenceParams{})
      assert_received {:anthropic_body, body}

      assert [%{name: "read_character", input_schema: %{"type" => "object"}}] = body.tools

      assert Enum.any?(body.messages, fn message ->
               message.role == "assistant" and
                 Enum.any?(message.content, &(&1.type == "tool_use" and &1.id == "call-1"))
             end)

      assert Enum.any?(body.messages, fn message ->
               Enum.any?(
                 message.content,
                 &(&1.type == "tool_result" and &1.tool_use_id == "call-1")
               )
             end)

      roles = Enum.map(body.messages, & &1.role)

      refute Enum.chunk_every(roles, 2, 1, :discard)
             |> Enum.any?(fn [left, right] -> left == right end)

      assert body[:system] != nil
    end

    test "legacy prompt 仍走原字符串/块路径（无 ir_version 时不进入桥）" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:anthropic_body, body})
        {:error, :http_error, 401, "Unauthorized"}
      end

      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}
      prompt = [%{role: "user", content: "hi"}]

      assert {:error, _error} = Anthropic.complete(state, nil, prompt, %InferenceParams{})
      assert_received {:anthropic_body, body}
      assert [%{role: "user", content: "hi"}] == body.messages
    end

    defp ir_provider_prompt do
      alias NovelAgent.Provider.RequestIR

      ir =
        RequestIR.new(%{
          run: %{run_id: "run-anthropic", work_id: "work-1"},
          system: %{
            identity_ref: "identity:authoring/v1",
            instructions: "你是创作 run，只在作者授权边界内行动。",
            run_role: "creation_run"
          },
          messages: [
            RequestIR.message(:application_base, :application, [
              RequestIR.text_block("run goal: 读取角色事实并生成 tentative 候选")
            ]),
            RequestIR.message(:user, :author, [RequestIR.text_block("把沈砚的年龄改成三十岁")]),
            RequestIR.message(:assistant, :model, [
              RequestIR.text_block("先读取角色事实。"),
              RequestIR.tool_call_block(
                "read_character",
                %{"character_ref" => "character:1"},
                "call-1"
              )
            ]),
            RequestIR.message(:tool, :tool_result, [
              RequestIR.observation_block("call-1", %{
                status: "ok",
                source_refs: [%{ref: "character:1", version: 2}],
                content: %{"narrative_role" => "ENSEMBLE_POV"}
              })
            ])
          ],
          tools: [
            %{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}
          ],
          projection: %{
            target: "anthropic_messages",
            capability_profile: Map.new(RequestIR.required_capabilities(), &{&1, true}),
            usage_streaming: false
          },
          refs: %{
            base_refs: [],
            observation_refs: [%{ref: "character:1", version: 2}],
            used_refs: []
          }
        })

      assert {:ok, prompt} = RequestIR.to_provider_prompt(ir)
      prompt
    end
  end
end
