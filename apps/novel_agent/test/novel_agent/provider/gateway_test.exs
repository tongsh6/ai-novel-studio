defmodule NovelAgent.Provider.GatewayTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Gateway

  describe "registered_providers/0" do
    test "returns known providers" do
      providers = Gateway.registered_providers()
      assert :stub in providers
      assert :slice_verify in providers
      assert :lmstudio in providers
      assert :anthropic in providers
    end
  end

  describe "complete/2 with test env (stub default)" do
    test "returns echo content from stub" do
      assert {:ok, %{content: content}} = Gateway.complete("hello novel")
      assert content =~ "[stub]"
      assert content =~ "hello novel"
    end

    test "works with empty prompt" do
      assert {:ok, %{content: content}} = Gateway.complete("")
      assert content =~ "[stub]"
    end

    test "completes without error" do
      assert {:ok, _} = Gateway.complete("should use stub in test env")
    end
  end

  describe "complete/2 with slice verify provider" do
    test "returns planner-compatible frame JSON" do
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :slice_verify)

      try do
        assert {:ok, %{content: content}} = Gateway.complete("分析用户消息并返回 JSON")
        assert {:ok, parsed} = Jason.decode(content)
        assert parsed["frame_type"] == "casual_reply"
        assert is_binary(parsed["assistant_message"])
      after
        Application.put_env(:novel_agent, :provider, old)
      end
    end
  end

  describe "complete error handling" do
    test "returns error map for unknown providers" do
      # Temporarily override provider config to trigger unknown provider path.
      # Restore after test to not affect other tests.
      old = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :nonexistent)

      result = Gateway.complete("test")
      assert {:error, error} = result
      assert is_map(error)
      assert error.type == :provider_internal

      Application.put_env(:novel_agent, :provider, old)
    end
  end
end
