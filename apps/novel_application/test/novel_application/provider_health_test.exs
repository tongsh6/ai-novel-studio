defmodule NovelApplication.ProviderHealthTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.RuntimeConfig

  setup do
    RuntimeConfig.reset()
    on_exit(fn -> RuntimeConfig.reset() end)
  end

  describe "provider_health/0" do
    test "returns provider metadata when the configured provider is healthy" do
      old_provider = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :stub)

      try do
        assert {:ok, %{provider: :stub, model: nil}} = NovelApplication.provider_health()
      after
        Application.put_env(:novel_agent, :provider, old_provider)
      end
    end

    test "keeps provider metadata on disconnected health results" do
      old_provider = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :nonexistent)

      try do
        assert {:error, %{provider: :nonexistent, model: nil, error: error}} =
                 NovelApplication.provider_health()

        assert error.message == "unknown provider: nonexistent"
      after
        Application.put_env(:novel_agent, :provider, old_provider)
      end
    end
  end

  describe "provider_options/0" do
    test "returns the registered providers" do
      options = NovelApplication.provider_options()

      assert options.current_provider == :stub
      assert Enum.any?(options.providers, &(&1.id == :deepseek))
    end
  end

  describe "configure_provider/1" do
    test "switches the runtime provider" do
      assert {:ok, %{provider: :stub, model: nil}} =
               NovelApplication.configure_provider(%{"provider" => "stub"})

      assert {:ok, %{provider: :stub, model: nil}} = NovelApplication.provider_health()
    end
  end
end
