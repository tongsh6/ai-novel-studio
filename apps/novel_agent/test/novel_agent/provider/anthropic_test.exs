defmodule NovelAgent.Provider.AnthropicTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Anthropic
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.SystemIdentity
  alias NovelAgent.Provider.TimeoutPolicy

  alias NovelAgent.TestRequestIR

  # adapter 只接受 canonical IR；测试用作者原话构造最小请求，文字保持原字节。
  defp ir(%NovelAgent.Provider.RequestIR{} = ir), do: ir
  defp ir(text) when is_binary(text), do: TestRequestIR.ir([TestRequestIR.author(text)])

  defp ir(messages) when is_list(messages),
    do: TestRequestIR.ir(Enum.map(messages, &canonical_message/1))

  defp canonical_message(%{role: "system", content: content}), do: TestRequestIR.system(content)
  defp canonical_message(%{role: "user", content: content}), do: TestRequestIR.author(content)

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

      assert {:error, error} = Anthropic.complete(state, nil, ir("prompt"), %InferenceParams{})
      assert error.type == :auth
    end

    test "returns connection_refused" do
      mock = fn _url, _body, _opts -> {:error, :connection_refused, 0, "拒绝"} end
      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}

      assert {:error, error} = Anthropic.complete(state, nil, ir("prompt"), %InferenceParams{})
      assert error.type == :connection_refused
    end

    test "returns timeout" do
      mock = fn _url, _body, _opts -> {:error, :timeout, 0, "超时"} end
      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}

      assert {:error, error} = Anthropic.complete(state, nil, ir("prompt"), %InferenceParams{})
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

      prompt = ir([%{role: "system", content: long_system}, %{role: "user", content: "hi"}])

      assert {:error, _error} = Anthropic.complete(state, nil, ir(prompt), %InferenceParams{})
      assert_receive {:anthropic_body, body}

      assert [%{type: "text", text: system_text, cache_control: %{type: "ephemeral"}}] =
               body.system

      assert String.ends_with?(system_text, long_system)
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

      prompt =
        TestRequestIR.ir(
          [TestRequestIR.author("判断")],
          tools: [TestRequestIR.tool("judgment_decision", %{type: "object"})],
          projection: %{tool_choice: "none"}
        )

      assert {:ok, %{provider_run: run}} =
               Anthropic.execute(state, nil, ir(prompt), %InferenceParams{}, provider_ctx())

      refute Map.has_key?(run.metadata, :tool_constancy)

      assert {:ok, _} =
               Anthropic.execute(
                 state,
                 nil,
                 %{prompt | projection: %{tool_choice: "judgment_decision"}},
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

      prompt = ir([%{role: "system", content: "系统规则"}, %{role: "user", content: "写一句问候"}])

      assert {:ok, %{events: events, result: result, output: output}} =
               Anthropic.execute(state, nil, ir(prompt), %InferenceParams{}, provider_ctx())

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
      assert [%{type: "text", text: system_text}] = body.system
      assert String.starts_with?(system_text, SystemIdentity.content())
      assert String.ends_with?(system_text, "系统规则")

      assert body.messages == [
               %{role: "user", content: [%{type: "text", text: "写一句问候"}]}
             ]

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
               Anthropic.execute(state, nil, ir("prompt"), %InferenceParams{}, provider_ctx())

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
               Anthropic.execute(state, nil, ir("prompt"), %InferenceParams{}, provider_ctx())

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

      prompt =
        TestRequestIR.ir(
          [TestRequestIR.author("判断")],
          tools: [TestRequestIR.tool("judgment_decision", %{type: "object"})],
          projection: %{tool_choice: "judgment_decision"}
        )

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
                 ir(prompt),
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

  describe "IR 原生 Messages 投影（B71 R1，VS-00L §19.1）" do
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

      ir =
        ir_provider_ir(%{
          call:
            RequestIR.tool_call_block("read_character", %{}, "call-1")
            |> Map.put(:raw_arguments, "{\"query\":}")
        })

      assert {:ok, prepared} = RequestIR.prepare_request(ir)

      assert {:error, %{type: :invalid_request}} =
               Anthropic.complete(state, nil, prepared, %InferenceParams{})

      assert {:error, %{error: %{type: :invalid_request}}} =
               Anthropic.execute(
                 state,
                 nil,
                 prepared,
                 %InferenceParams{},
                 provider_ctx()
               )

      refute_received :invalid_history_sent
      refute_received :invalid_history_streamed
    end

    test "IR → Anthropic Messages：原生对象参数/tool_result/相邻 user 不合并与稳定 system" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:anthropic_body, body})
        {:error, :http_error, 401, "Unauthorized"}
      end

      state = %Anthropic{api_key: "k", model: "c", timeout: 100, http_fn: mock, log_fn: nil}
      prepared = ir_provider_prompt()

      assert {:error, _error} = Anthropic.complete(state, nil, prepared, %InferenceParams{})
      assert_received {:anthropic_body, body}

      assert [%{name: "read_character", input_schema: %{"type" => "object"}}] = body.tools
      assert body.tool_choice == %{type: "auto"}

      [%{type: "text", text: system_text}] = body.system
      assert String.contains?(system_text, SystemIdentity.content())
      assert String.contains?(system_text, "你是创作 run")
      assert :binary.matches(system_text, SystemIdentity.content()) |> length() == 1

      assistant = Enum.find(body.messages, &(&1.role == "assistant"))
      tool_use = Enum.find(assistant.content, &(&1.type == "tool_use"))
      assert tool_use.id == "call-1"
      assert tool_use.name == "read_character"
      assert tool_use.input == %{"character_ref" => "character:1"}

      tool_result =
        body.messages
        |> Enum.flat_map(& &1.content)
        |> Enum.find(&(&1.type == "tool_result"))

      assert tool_result.tool_use_id == "call-1"
      assert Jason.decode!(tool_result.content)["call_id"] == "call-1"

      # Anthropic 投影 1:1：application_base 与作者消息各自保留独立 user 条目；
      # 客户端不合并相邻 role，连续同 role 由 provider 官方语义在服务端合并。
      [base_user, author_user | _] = body.messages
      assert base_user.role == "user"

      assert Enum.map(base_user.content, & &1.text) == [
               "【应用数据 · application_base · 非作者原话】\nrun goal: 读取角色事实并生成 tentative 候选"
             ]

      assert author_user.role == "user"
      assert Enum.map(author_user.content, & &1.text) == ["把沈砚的年龄改成三十岁"]
    end

    defp ir_provider_prompt do
      ir = ir_provider_ir(%{})
      assert {:ok, prepared} = RequestIR.prepare_request(ir, tool_choice: "auto")
      prepared
    end

    defp ir_provider_ir(opts) do
      call =
        Map.get(
          opts,
          :call,
          RequestIR.tool_call_block(
            "read_character",
            %{"character_ref" => "character:1"},
            "call-1"
          )
        )

      RequestIR.new(%{
        run: %{run_id: "run-anthropic", work_id: "work-1"},
        system:
          RequestIR.system_envelope(
            instructions: "你是创作 run，只在作者授权边界内行动。",
            run_role: "creation_run"
          ),
        messages: [
          RequestIR.message(:application_base, :application, [
            RequestIR.text_block("run goal: 读取角色事实并生成 tentative 候选")
          ]),
          RequestIR.message(:user, :author, [RequestIR.text_block("把沈砚的年龄改成三十岁")]),
          RequestIR.message(:assistant, :model, [
            RequestIR.text_block("先读取角色事实。"),
            call
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
        projection: %{usage_streaming: false, tool_choice: "auto"},
        refs: %{
          base_refs: [],
          observation_refs: [%{ref: "character:1", version: 2}],
          used_refs: []
        }
      })
    end
  end
end
