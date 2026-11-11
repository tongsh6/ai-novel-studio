defmodule NovelAgent.Provider.SplashProviderOptionsTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Gateway
  alias NovelAgent.Provider.RuntimeConfig
  alias NovelAgent.Provider.Splash

  setup do
    old_splash = Application.get_env(:novel_agent, Splash)
    RuntimeConfig.reset()

    Application.put_env(:novel_agent, Splash,
      endpoint: "http://127.0.0.1:8000/v1",
      model: nil
    )

    on_exit(fn ->
      RuntimeConfig.reset()

      if old_splash do
        Application.put_env(:novel_agent, Splash, old_splash)
      else
        Application.delete_env(:novel_agent, Splash)
      end
    end)

    :ok
  end

  describe "provider_options/0" do
    test "exposes Splash as a configurable keyless local backend with its own endpoint" do
      splash = Enum.find(Gateway.provider_options().providers, &(&1.id == :splash))

      assert splash.label == "Splash"
      assert splash.requires_api_key == false
      assert splash.supports_api_key == true

      # Splash 端口由本机 `splash serve --port` 决定：端点允许作者在设置页配置，
      # 与 Strata 的固定统一入口不同。
      assert splash.supports_endpoint == true
      assert splash.supports_thinking == true
      assert splash.supports_streaming == true
      assert splash.supports_cancellation == true
      # 模型由 Splash 管理：未显式选择时不下发模型。
      assert splash.model == nil
      assert splash.endpoint == "http://127.0.0.1:8000/v1"
      assert is_boolean(splash.api_key_configured)
      refute Map.has_key?(splash, :api_key)
    end
  end
end
