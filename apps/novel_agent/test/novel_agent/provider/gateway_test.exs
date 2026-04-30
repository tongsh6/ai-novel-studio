defmodule NovelAgent.Provider.GatewayTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Gateway

  describe "registered_providers/0" do
    test "returns known providers" do
      providers = Gateway.registered_providers()
      assert :stub in providers
      assert :lmstudio in providers
    end
  end

  describe "complete/2 with test env (stub default)" do
    test "returns echo content from stub" do
      assert {:ok, content} = Gateway.complete("hello novel")
      assert content =~ "[stub]"
      assert content =~ "hello novel"
    end

    test "works with empty prompt" do
      assert {:ok, content} = Gateway.complete("")
      assert content =~ "[stub]"
    end
  end

  describe "complete/2 fallback behavior" do
    test "gateway completes without error when stub is available" do
      result = Gateway.complete("test", "any-model")
      assert {:ok, _} = result
    end
  end
end
