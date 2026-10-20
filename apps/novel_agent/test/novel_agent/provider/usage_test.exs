defmodule NovelAgent.Provider.UsageTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Usage

  test "new/4 leaves cached_tokens unknown, new/5 records it" do
    usage = Usage.new(10, 5, "m", 12)
    assert usage.cached_tokens == nil

    cached = Usage.new(10, 5, "m", 12, 7)
    assert cached.cached_tokens == 7
  end

  test "from_openai_response reads OpenAI and DeepSeek cache fields" do
    openai =
      Usage.from_openai_response(
        %{
          "model" => "m",
          "usage" => %{
            "prompt_tokens" => 10,
            "completion_tokens" => 2,
            "prompt_tokens_details" => %{"cached_tokens" => 6}
          }
        },
        nil,
        20
      )

    assert openai.cached_tokens == 6

    deepseek =
      Usage.from_openai_response(
        %{
          "usage" => %{
            "prompt_tokens" => 10,
            "completion_tokens" => 2,
            "prompt_cache_hit_tokens" => 4
          }
        },
        "deepseek",
        20
      )

    assert deepseek.cached_tokens == 4
  end

  test "from_anthropic_response reads cache_read_input_tokens" do
    usage =
      Usage.from_anthropic_response(
        %{
          "model" => "claude",
          "usage" => %{
            "input_tokens" => 10,
            "output_tokens" => 2,
            "cache_read_input_tokens" => 8
          }
        },
        nil,
        20
      )

    assert usage.cached_tokens == 8
  end

  test "to_map carries cached_tokens for ProviderRun / developer activity" do
    assert %{cached_tokens: 3} = Usage.new(1, 2, "m", 3, 3) |> Usage.to_map()
  end
end
