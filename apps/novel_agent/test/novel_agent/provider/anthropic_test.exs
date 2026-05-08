defmodule NovelAgent.Provider.AnthropicTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Anthropic

  describe "name/0" do
    test "returns anthropic identifier" do
      assert Anthropic.name() == "anthropic"
    end
  end

  describe "from_config/0" do
    test "returns struct with defaults" do
      state = Anthropic.from_config()
      assert state.model == "claude-sonnet-4-6"
      assert state.timeout == 120_000
    end
  end

  describe "complete/3" do
    test "reports error when api key is missing" do
      state = %Anthropic{api_key: nil, model: "claude-sonnet-4-6", timeout: 5000}
      result = Anthropic.complete(state, "claude-sonnet-4-6", "hello")
      assert {:error, error} = result
      assert is_map(error)
      assert error.type in [:connection_refused, :auth, :timeout, :provider_internal]
    end
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(Anthropic, :complete, 3)
      assert function_exported?(Anthropic, :name, 0)
      assert function_exported?(Anthropic, :from_config, 0)
    end
  end
end
