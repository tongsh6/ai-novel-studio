defmodule NovelAgent.Provider.LMStudioTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.LMStudio

  describe "name/0" do
    test "returns lmstudio identifier" do
      assert LMStudio.name() == "lmstudio"
    end
  end

  describe "behaviour conformance" do
    test "exports required callbacks" do
      assert function_exported?(LMStudio, :complete, 3)
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
    end
  end

  describe "complete/3 error handling" do
    test "returns connection_refused when LM Studio is not running" do
      # Use an unlikely port to simulate connection refused
      state = %LMStudio{endpoint: "http://127.0.0.1:19999/v1", model: "test", timeout: 100}

      assert {:error, error_map} = LMStudio.complete(state, "test", "hello")
      assert error_map.type == :connection_refused
    end

    test "returns timeout with short timeout" do
      # Use a non-routable IP to trigger timeout quickly
      state = %LMStudio{endpoint: "http://192.0.2.1:1234/v1", model: "test", timeout: 50}

      assert {:error, error_map} = LMStudio.complete(state, "test", "hello")

      # Should be either connection_refused or timeout
      assert error_map.type in [:connection_refused, :timeout]
    end
  end
end
