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
        assert {:ok, health} = NovelApplication.provider_health()

        assert health.provider == :stub
        assert health.model == nil

        # 作者可见面只消费 display 字段；测试替身不登记显示名、不暴露内部 id，
        # 未登记 code 走作者安全 fallback（2026-11-08 作者裁决）。
        assert health.provider_display_name == "当前模型服务"
        assert health.model_display_name == nil
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

      # 每个 provider 都带作者可读 display_name，且不回显内部 id。
      for provider <- options.providers do
        assert is_binary(provider.display_name) and provider.display_name != ""
        refute provider.display_name =~ to_string(provider.id)
      end

      # 测试替身不登记作者可见显示名；回退到 fallback 且不回显内部 id。
      assert Enum.find(options.providers, &(&1.id == :stub)).display_name ==
               "当前模型服务"
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
