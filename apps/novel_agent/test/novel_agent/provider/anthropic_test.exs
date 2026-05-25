defmodule NovelAgent.Provider.AnthropicTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Anthropic
  alias NovelAgent.Provider.InferenceParams

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
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(Anthropic, :complete, 4)
      assert function_exported?(Anthropic, :name, 0)
      assert function_exported?(Anthropic, :from_config, 0)
    end
  end
end
