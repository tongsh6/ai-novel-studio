defmodule NovelAgent.Provider.HTTPTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.HTTP
  alias NovelAgent.Provider.InferenceParams

  describe "apply_params/2" do
    test "adds non-nil fields to body map" do
      params = %InferenceParams{temperature: 0.5, max_tokens: 100}
      body = HTTP.apply_params(%{model: "test"}, params)

      assert body.temperature == 0.5
      assert body.max_tokens == 100
      assert body.model == "test"
    end

    test "skips nil fields" do
      params = %InferenceParams{temperature: nil, max_tokens: nil}
      body = HTTP.apply_params(%{model: "test"}, params)

      refute Map.has_key?(body, :temperature)
      refute Map.has_key?(body, :max_tokens)
      assert body.model == "test"
    end
  end

  describe "get/2 error handling" do
    test "returns connection_refused for unreachable host" do
      assert {:error, :connection_refused, 0, _} =
               HTTP.get("http://127.0.0.1:19999/v1/models", receive_timeout: 100)
    end

    test "returns timeout for non-routable address" do
      result = HTTP.get("http://192.0.2.1:80/models", receive_timeout: 50)
      assert match?({:error, reason, 0, _} when reason in [:connection_refused, :timeout], result)
    end
  end
end
