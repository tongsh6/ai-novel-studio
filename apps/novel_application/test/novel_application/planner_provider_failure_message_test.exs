defmodule NovelApplication.PlannerProviderFailureMessageTest do
  use ExUnit.Case, async: true

  alias NovelApplication.Planner

  @raw_message "raw provider payload must never reach the author"

  defp timeout_reason(kind) do
    %{
      type: :timeout,
      message: @raw_message,
      provider: "strata",
      retryable: true,
      details: %{
        timeout_kind: kind,
        response_timeout_ms: 900_000,
        deadline_ms: nil,
        duration_ms: 900_000,
        ttft_ms: if(kind == :connection_stall, do: nil, else: 2_000),
        output_chars: if(kind == :connection_stall, do: 0, else: 1_200),
        output_chunks: 3,
        wire_chunks: 9
      }
    }
  end

  test "connection_stall tells the author no generation content arrived, without raw payload" do
    message = Planner.provider_failure_fallback_message(timeout_reason(:connection_stall))

    assert message =~ "没有返回任何生成内容"
    assert message =~ "没有创建待采纳内容"
    refute message =~ @raw_message
  end

  test "stream_interrupted tells the author the generation stopped mid-way, without raw payload" do
    message = Planner.provider_failure_fallback_message(timeout_reason(:stream_interrupted))

    assert message =~ "中途中断"
    assert message =~ "没有创建待采纳内容"
    refute message =~ @raw_message
  end

  test "deadline explains a deployment-configured total-time cap" do
    message = Planner.provider_failure_fallback_message(timeout_reason(:deadline))

    assert message =~ "总时长上限"
    refute message =~ @raw_message
  end

  test "timeout without B22 details keeps the generic timeout message" do
    message =
      Planner.provider_failure_fallback_message(%{
        type: :timeout,
        message: @raw_message,
        provider: "strata",
        retryable: true,
        details: %{}
      })

    assert message == "创作引擎响应超时。这一轮没有创建待采纳内容，也没有写入作品事实。你可以稍后重试，或继续对话。"
    refute message =~ @raw_message
  end
end
