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
      assert is_binary(state.model) and byte_size(state.model) > 0
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
      assert Map.has_key?(state, :log_fn)
      assert Map.has_key?(state, :json_mode)
    end

    test "http_fn and log_fn default to nil when not set" do
      state = %LMStudio{}
      assert state.http_fn == nil
      assert state.log_fn == nil
    end
  end

  describe "complete/4 error handling" do
    test "sends chat messages without flattening history into one user prompt" do
      test_pid = self()

      mock = fn _url, body, _opts ->
        send(test_pid, {:request_body, body})

        {:ok, 200,
         %{
           "choices" => [%{"message" => %{"content" => "{\"ok\":true}"}}],
           "usage" => %{}
         }}
      end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      messages = [
        %{role: "system", content: "规则"},
        %{role: "user", content: "第一轮"},
        %{role: "assistant", content: "回应第一轮"},
        %{role: "user", content: "第二轮"}
      ]

      assert {:ok, _result} = LMStudio.complete(state, nil, messages, %InferenceParams{})
      assert_receive {:request_body, body}
      assert body.messages == messages
    end

    test "returns connection_refused" do
      mock = fn _url, _body, _opts -> {:error, :connection_refused, 0, "拒绝"} end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      assert {:error, error_map} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert error_map.type == :connection_refused
    end

    test "returns timeout" do
      mock = fn _url, _body, _opts -> {:error, :timeout, 0, "超时"} end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      assert {:error, error_map} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert error_map.type == :timeout
    end

    test "returns provider_internal for unknown errors" do
      mock = fn _url, _body, _opts -> {:error, :unknown, 0, "异常"} end

      state = %LMStudio{
        endpoint: "http://localhost/v1",
        model: "t",
        timeout: 100,
        http_fn: mock,
        log_fn: nil
      }

      assert {:error, error_map} = LMStudio.complete(state, nil, "prompt", %InferenceParams{})
      assert error_map.type == :provider_internal
    end
  end
end
