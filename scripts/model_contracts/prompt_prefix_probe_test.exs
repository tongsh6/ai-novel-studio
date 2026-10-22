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

  test "真实说明必须进入 call2；重复 call1 和隐藏重试不能冒充调用对" do
    first =
      row(
        %{messages: [%{content: "call1"}], stream: true, tool_choice: "none"},
        nil,
        "data: " <> Jason.encode!(%{choices: [%{delta: %{content: "模型实际说明"}}]}) <> "\n\n"
      )

    second =
      row(
        %{
          messages: [%{content: "说明：模型实际说明\n决策"}],
          stream: false,
          tool_choice: %{type: "function", function: %{name: "judgment_decision"}}
        },
        %{"usage" => %{"prompt_tokens_details" => %{"cached_tokens" => 64}}}
      )

    result = {:ok, %{provider_call_count: 2, action: "execute"}}
    assert Probe.evaluate_pair("pair", [first, second], result).protocol_ok
    refute Probe.evaluate_pair("pair", [first, first], result).protocol_ok
    auto = put_in(first, [:request, :tool_choice], "auto")
    refute Probe.evaluate_pair("pair", [auto, second], result).protocol_ok

    refute Probe.evaluate_pair(
             "pair",
             [first, second],
             {:ok, %{provider_call_count: 3, action: "execute"}}
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

  test "长说明消费生产 call2 的截断规则，替换说明不能通过" do
    input = Probe.judgment_input("long-narrative-test")
    narrative = String.duplicate("这是模型当次产生的长判断说明。", 30)

    first =
      row(
        %{stream: true, tool_choice: "none"},
        nil,
        "data: " <> Jason.encode!(%{choices: [%{delta: %{content: narrative}}]}) <> "\n\n"
      )

    prompt = NovelApplication.JudgmentProtocol.decision_prompt(input, narrative)

    second =
      row(
        %{
          messages: prompt.messages,
          stream: false,
          tool_choice: %{type: "tool", name: "judgment_decision"}
        },
        %{}
      )

    result = {:ok, %{provider_call_count: 2, action: "execute"}}
    assert Probe.evaluate_pair("pair", [first, second], result, input).protocol_ok
    fake = row(%{messages: [%{role: "user", content: "伪造说明"}], stream: false}, %{})
    refute Probe.evaluate_pair("pair", [first, fake], result, input).protocol_ok
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
