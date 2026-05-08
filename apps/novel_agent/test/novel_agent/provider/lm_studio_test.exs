defmodule NovelAgent.Provider.LMStudioTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.InferenceParams
  alias NovelAgent.Provider.LMStudio

  describe "name/0" do
    test "returns lmstudio identifier" do
      assert LMStudio.name() == "lmstudio"
    end
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(LMStudio, :complete, 4)
      assert function_exported?(LMStudio, :name, 0)
    end
  end

  describe "from_config/0" do
    test "returns struct with configured values" do
      state = LMStudio.from_config()

      assert %LMStudio{} = state
      assert state.endpoint =~ "localhost"
      assert state.endpoint =~ "/v1"
      assert state.model =~ "model"
      assert is_integer(state.timeout) and state.timeout > 0
    end
  end

  describe "struct defaults" do
    test "struct has all required fields" do
      state = %LMStudio{}

      assert Map.has_key?(state, :endpoint)
      assert Map.has_key?(state, :model)
      assert Map.has_key?(state, :timeout)
      assert Map.has_key?(state, :http_fn)
    end

    test "http_fn defaults to HTTP.post/3 when not set" do
      state = %LMStudio{}
      # Without http_fn, complete should fall back to HTTP.post
      assert state.http_fn == nil
    end
  end

  describe "complete/4 error handling" do
    test "returns connection_refused" do
      mock = fn _url, _body, _opts -> {:error, :connection_refused, 0, "拒绝"} end
      state = %LMStudio{endpoint: "http://localhost/v1", model: "t", timeout: 100, http_fn: mock}

      assert {:error, error_map} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert error_map.type == :connection_refused
    end

    test "returns timeout" do
      mock = fn _url, _body, _opts -> {:error, :timeout, 0, "超时"} end
      state = %LMStudio{endpoint: "http://localhost/v1", model: "t", timeout: 100, http_fn: mock}

      assert {:error, error_map} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert error_map.type == :timeout
    end

    test "returns provider_internal for unknown errors" do
      mock = fn _url, _body, _opts -> {:error, :unknown, 0, "异常"} end
      state = %LMStudio{endpoint: "http://localhost/v1", model: "t", timeout: 100, http_fn: mock}

      assert {:error, error_map} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert error_map.type == :provider_internal
    end
  end
end
