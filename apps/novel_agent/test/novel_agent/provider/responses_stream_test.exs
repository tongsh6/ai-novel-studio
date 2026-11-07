defmodule NovelAgent.Provider.ResponsesStreamTest do
  @moduledoc """
  B71 R2：Responses API SSE 流的失败/截断/取消与工具参数增量归一。

  这些用例保护「流式事实不得冒充完整响应」：失败事件、未正常终止的截断流必须
  失败；provider 显式 incomplete 保留真实内容；工具参数只从真实增量累积并在
  结束时归一到 canonical call_id/raw_arguments。
  """

  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.OpenAI
  alias NovelCommon.RequestIR

  alias NovelTest.TestRequestIR

  defp ir(text) when is_binary(text), do: TestRequestIR.ir([TestRequestIR.author(text)])

  defp responses_state(eventsource) do
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

  defp provider_ctx do
    %{
      provider_name: :openai,
      model_name: "gpt-5-fixture",
      provider_call_ref: "pcall_responses_stream_test",
      provider_run_id: "prun_responses_stream_test",
      purpose: :conversation,
      owner_refs: %{}
    }
  end

  test "response.failed 作为 provider 显式失败，不产生成功结果" do
    eventsource = fn _url, _body, _opts, on_data ->
      on_data.(sse(%{"type" => "response.created", "response" => %{"model" => "gpt-5-fixture"}}))

      on_data.(
        sse(%{
          "type" => "response.failed",
          "response" => %{
            "error" => %{"code" => "rate_limit_exceeded", "message" => "上游限流"}
          }
        })
      )

      {:ok, 200, ""}
    end

    assert {:error, %{error: error}} =
             OpenAI.execute(
               responses_state(eventsource),
               nil,
               ir("写一句问候"),
               %InferenceParams{},
               provider_ctx()
             )

    assert error.type == :rate_limit
    assert error.message =~ "上游限流"
  end

  test "流提前结束（无 completed/incomplete）时 fail-closed，不把半截增量当完整响应" do
    eventsource = fn _url, _body, _opts, on_data ->
      on_data.(sse(%{"type" => "response.created", "response" => %{"model" => "gpt-5-fixture"}}))

      on_data.(
        sse(%{
          "type" => "response.output_text.delta",
          "item_id" => "msg_1",
          "output_index" => 0,
          "delta" => "只写了一半"
        })
      )

      {:ok, 200, ""}
    end

    assert {:error, %{error: error}} =
             OpenAI.execute(
               responses_state(eventsource),
               nil,
               ir("写一段正文"),
               %InferenceParams{},
               provider_ctx()
             )

    assert error.type == :parse
    assert error.message =~ "未正常终止"
  end

  test "response.incomplete 是合法终止事实：保留真实内容，不误判协议失败" do
    eventsource = fn _url, _body, _opts, on_data ->
      on_data.(sse(%{"type" => "response.created", "response" => %{"model" => "gpt-5-fixture"}}))

      on_data.(
        sse(%{
          "type" => "response.output_text.delta",
          "item_id" => "msg_1",
          "output_index" => 0,
          "delta" => "达到输出上限前的正文"
        })
      )

      on_data.(
        sse(%{
          "type" => "response.incomplete",
          "response" => %{
            "model" => "gpt-5-fixture",
            "usage" => %{"input_tokens" => 2, "output_tokens" => 4},
            "incomplete_details" => %{"reason" => "max_output_tokens"}
          }
        })
      )

      {:ok, 200, ""}
    end

    assert {:ok, %{result: result}} =
             OpenAI.execute(
               responses_state(eventsource),
               nil,
               ir("写一段正文"),
               %InferenceParams{},
               provider_ctx()
             )

    assert result.content == "达到输出上限前的正文"
    assert result.usage.output_tokens == 4
  end

  test "工具参数只从 SSE 增量累积，结束时按 call_id 归一（item id 不混用）" do
    raw = ~s({"query":"沈砚","offset":0})
    {first, second} = String.split_at(raw, 10)

    eventsource = fn _url, _body, _opts, on_data ->
      on_data.(sse(%{"type" => "response.created", "response" => %{"model" => "gpt-5-fixture"}}))

      on_data.(
        sse(%{
          "type" => "response.output_item.added",
          "output_index" => 0,
          "item" => %{
            "type" => "function_call",
            "id" => "fc_private_1",
            "call_id" => "call-read-1",
            "name" => "read_character"
          }
        })
      )

      on_data.(
        sse(%{
          "type" => "response.function_call_arguments.delta",
          "item_id" => "fc_private_1",
          "output_index" => 0,
          "delta" => first
        })
      )

      on_data.(
        sse(%{
          "type" => "response.function_call_arguments.delta",
          "item_id" => "fc_private_1",
          "output_index" => 0,
          "delta" => second
        })
      )

      # done item 不带 final arguments：归一必须使用真实增量累积字节。
      on_data.(
        sse(%{
          "type" => "response.output_item.done",
          "output_index" => 0,
          "item" => %{
            "type" => "function_call",
            "id" => "fc_private_1",
            "call_id" => "call-read-1",
            "name" => "read_character"
          }
        })
      )

      on_data.(
        sse(%{
          "type" => "response.completed",
          "response" => %{
            "model" => "gpt-5-fixture",
            "usage" => %{"input_tokens" => 3, "output_tokens" => 2}
          }
        })
      )

      {:ok, 200, ""}
    end

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
             OpenAI.execute(
               responses_state(eventsource),
               nil,
               prompt,
               %InferenceParams{},
               provider_ctx()
             )

    assert [
             %{
               "id" => "call-read-1",
               "name" => "read_character",
               "arguments" => %{"query" => "沈砚", "offset" => 0},
               "raw_arguments" => ^raw
             }
           ] = result.tool_calls
  end

  test "provider execution token 取消时停止消费流并以 cancelled 终态结束" do
    {:ok, token} = Execution.start_cancellation_token(%{run_id: "run_responses_cancel_test"})
    test_pid = self()

    eventsource = fn _url, _body, _opts, on_data ->
      assert :cont ==
               on_data.(
                 sse(%{
                   "type" => "response.output_text.delta",
                   "item_id" => "msg_1",
                   "output_index" => 0,
                   "delta" => "先"
                 })
               )

      send(test_pid, :first_chunk_consumed)
      assert :ok = Execution.cancel(token, :author_cancelled)

      assert :halt ==
               on_data.(
                 sse(%{
                   "type" => "response.output_text.delta",
                   "item_id" => "msg_1",
                   "output_index" => 0,
                   "delta" => "后"
                 })
               )

      {:ok, 200, ""}
    end

    ctx = Map.put(provider_ctx(), :cancellation_token, token)

    assert {:error, %{events: events, output: output, provider_run: run, error: error}} =
             OpenAI.execute(
               responses_state(eventsource),
               nil,
               ir("写一段正文"),
               %InferenceParams{},
               ctx
             )

    assert_receive :first_chunk_consumed
    assert run.status == :cancelled
    assert output.status == :cancelled
    assert error.type == :cancelled

    event_types = Enum.map(events, & &1.event_type)
    assert :chunk in event_types
    assert :cancelled in event_types
    refute :final_output in event_types
  end

  test "Responses SSE 正文增量进入 provider execution chunk 事件（作者可见前先结构化）" do
    eventsource = fn _url, _body, _opts, on_data ->
      on_data.(sse(%{"type" => "response.created", "response" => %{"model" => "gpt-5-fixture"}}))

      on_data.(
        sse(%{
          "type" => "response.output_text.delta",
          "item_id" => "msg_1",
          "output_index" => 0,
          "delta" => "第一段"
        })
      )

      on_data.(
        sse(%{
          "type" => "response.output_text.delta",
          "item_id" => "msg_1",
          "output_index" => 0,
          "delta" => "第二段"
        })
      )

      on_data.(
        sse(%{
          "type" => "response.completed",
          "response" => %{
            "model" => "gpt-5-fixture",
            "usage" => %{"input_tokens" => 2, "output_tokens" => 2}
          }
        })
      )

      {:ok, 200, ""}
    end

    assert {:ok, %{result: result, events: events}} =
             OpenAI.execute(
               responses_state(eventsource),
               nil,
               ir("写两句"),
               %InferenceParams{},
               provider_ctx()
             )

    assert result.content == "第一段第二段"

    chunk_events = Enum.filter(events, &(&1.event_type == :chunk))
    assert Enum.map(chunk_events, & &1.payload[:content_length]) == [3, 3]
    assert result.usage.output_tokens == 2
  end
end
