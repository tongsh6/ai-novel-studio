Code.require_file("prompt_prefix_probe.exs", __DIR__)
ExUnit.start()

defmodule ModelContracts.PromptPrefixProbeTest do
  use ExUnit.Case, async: true
  alias ModelContracts.PromptPrefixProbe, as: Probe

  test "缺失、零、正缓存字段分别报告" do
    assert Probe.cache_status(%{}) == "unobservable"
    assert Probe.cache_status(%{"prompt_tokens_details" => %{"cached_tokens" => 0}}) == "miss"
    assert Probe.cache_status(%{"prompt_cache_hit_tokens" => 128}) == "hit"
    assert Probe.cache_status(%{"cache_read_input_tokens" => 32}) == "hit"
  end

  test "生产单调用必须 auto、同响应字节绑定且如实计数" do
    first =
      row(
        %{messages: [%{content: "作者输入"}], stream: true, tool_choice: "auto"},
        nil,
        "data: " <> Jason.encode!(%{choices: [%{delta: %{content: "模型实际说明"}}]}) <> "\n\n"
      )

    result = {:ok, %{provider_call_count: 1, action: "reply", narrative: "模型实际说明"}}
    assert Probe.evaluate_single("single", [first], result).protocol_ok
    refute Probe.evaluate_single("single", [first, first], result).protocol_ok

    refute Probe.evaluate_single(
             "single",
             [put_in(first, [:request, :tool_choice], "none")],
             result
           ).protocol_ok

    refute Probe.evaluate_single(
             "single",
             [first],
             {:ok, %{provider_call_count: 1, action: "reply", narrative: "伪造"}}
           ).protocol_ok
  end

  test "SSE 零缓存保留，全程耗时不作 TTFT" do
    wire =
      "data: {\"choices\":[{\"delta\":{\"content\":\"答\"}}]}\r\n\r\n" <>
        "data: {\"usage\":{\"prompt_tokens\":2000,\"prompt_tokens_details\":{\"cached_tokens\":0}}}\n\n" <>
        "data: [DONE]\n\n"

    streamed = row(%{stream: true}, nil, wire)
    assert Probe.native_usage(streamed)["prompt_tokens"] == 2000
    assert Probe.summarize_call(streamed).cache_status == "miss"
    nonstream = row(%{stream: false}, %{"usage" => %{}})
    assert Probe.summarize_call(nonstream).ttft_ms == nil
    assert Probe.summarize_call(nonstream).cache_status == "unobservable"
  end

  test "空 content 的作者叙事必须来自当次真实工具字段，纠错不借旧字节" do
    request = %{stream: false, tool_choice: %{type: "auto"}}

    response = %{
      "choices" => [
        %{
          "message" => %{
            "tool_calls" => [
              %{
                "function" => %{
                  "name" => "ask_author",
                  "arguments" => Jason.encode!(%{question: "选择哪种结尾？", options: []})
                }
              }
            ]
          }
        }
      ]
    }

    good = row(request, response)
    result = {:ok, %{provider_call_count: 1, action: "await_author", narrative: "选择哪种结尾？"}}
    assert Probe.evaluate_single("single", [good], result).protocol_ok
    final = row(request, %{"choices" => [%{"message" => %{"content" => "纠正后的内容"}}]})

    refute Probe.evaluate_single(
             "retry",
             [good, final],
             {:ok, %{provider_call_count: 2, action: "reply", narrative: "选择哪种结尾？"}}
           ).protocol_ok
  end

  test "Provider 选择来自注册集合，未知名称和替身不能静默运行" do
    options = [%{id: :stub}, %{id: :strata}, %{id: :deepseek}]
    assert Probe.select_providers("all", options) == [%{id: :strata}, %{id: :deepseek}]
    assert_raise RuntimeError, fn -> Probe.select_providers("missing", options) end
    assert_raise RuntimeError, fn -> Probe.select_providers("stub", options) end
  end

  defp row(request, response, stream \\ nil),
    do: %{
      endpoint: "http://localhost/v1/chat/completions",
      request: request,
      response: response,
      stream: stream,
      http_status: 200,
      wall_ms: 123
    }
end
