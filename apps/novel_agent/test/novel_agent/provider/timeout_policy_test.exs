defmodule NovelAgent.Provider.TimeoutPolicyTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.TimeoutPolicy

  defp resolve(provider, config \\ [], env \\ %{}) do
    TimeoutPolicy.resolve(provider, config, env: fn key -> Map.get(env, key) end)
  end

  describe "profile defaults" do
    test "local providers get wire-silence and non-stream windows but no total deadline" do
      for provider <- [:lmstudio, :strata] do
        policy = resolve(provider)

        assert policy.profile == :local
        assert TimeoutPolicy.local?(provider)
        assert policy.connect_ms == 15_000
        assert policy.response_ms == 900_000
        assert policy.non_stream_ms == 1_800_000

        assert policy.deadline_ms == nil,
               "#{provider} must not have a hard total-time kill by default"
      end
    end

    test "hosted providers keep the legacy timeout as response/non-stream window without a deadline" do
      policy = resolve(:deepseek, timeout: 300_000)

      assert policy.profile == :hosted
      refute TimeoutPolicy.local?(:deepseek)
      assert policy.response_ms == 300_000
      assert policy.non_stream_ms == 300_000
      assert policy.deadline_ms == nil
    end

    test "hosted provider without explicit legacy timeout falls back to the hosted default" do
      policy = resolve(:anthropic)

      assert policy.response_ms == 300_000
      assert policy.non_stream_ms == 300_000
    end
  end

  describe "config overrides" do
    test "explicit response_timeout / non_stream_timeout win over legacy timeout" do
      policy =
        resolve(:lmstudio,
          timeout: 300_000,
          response_timeout: 600_000,
          non_stream_timeout: 1_000_000
        )

      assert policy.response_ms == 600_000
      assert policy.non_stream_ms == 1_000_000
    end

    test "explicit deadline_timeout enables the optional total-time safety valve" do
      policy = resolve(:lmstudio, deadline_timeout: 7_200_000)

      assert policy.deadline_ms == 7_200_000
    end

    test "deadline_timeout accepts 0/off/disabled as disabled" do
      assert resolve(:lmstudio, deadline_timeout: 0).deadline_ms == nil
      assert resolve(:lmstudio, deadline_timeout: "off").deadline_ms == nil
      assert resolve(:lmstudio, deadline_timeout: "disabled").deadline_ms == nil
    end
  end

  describe "env overrides" do
    test "legacy per-provider TIMEOUT_MS sets both response and non-stream windows" do
      policy = resolve(:lmstudio, [], %{"NOVEL_LMSTUDIO_TIMEOUT_MS" => "120000"})

      assert policy.response_ms == 120_000
      assert policy.non_stream_ms == 120_000
    end

    test "explicit response env wins over legacy TIMEOUT_MS" do
      policy =
        resolve(:lmstudio, [], %{
          "NOVEL_LMSTUDIO_TIMEOUT_MS" => "120000",
          "NOVEL_LMSTUDIO_RESPONSE_TIMEOUT_MS" => "240000"
        })

      assert policy.response_ms == 240_000
      assert policy.non_stream_ms == 120_000
    end

    test "local group env overrides the profile default" do
      policy = resolve(:strata, [], %{"NOVEL_LOCAL_RESPONSE_TIMEOUT_MS" => "450000"})

      assert policy.response_ms == 450_000
    end

    test "deadline env enables the optional total-time valve" do
      policy = resolve(:strata, [], %{"NOVEL_STRATA_DEADLINE_TIMEOUT_MS" => "600000"})

      assert policy.deadline_ms == 600_000
    end

    test "group deadline env applies when provider-specific env is absent" do
      policy = resolve(:lmstudio, [], %{"NOVEL_LOCAL_DEADLINE_TIMEOUT_MS" => "1800000"})

      assert policy.deadline_ms == 1_800_000
    end

    test "connect timeout env override" do
      policy = resolve(:strata, [], %{"NOVEL_STRATA_CONNECT_TIMEOUT_MS" => "30000"})

      assert policy.connect_ms == 30_000
    end
  end

  describe "probe timeout" do
    test "caps health/model-list probes at a short window" do
      assert TimeoutPolicy.probe_timeout() == 15_000
      assert TimeoutPolicy.probe_timeout(nil) == 15_000
      assert TimeoutPolicy.probe_timeout(300_000) == 15_000
    end

    test "respects a shorter legacy value used by tests" do
      assert TimeoutPolicy.probe_timeout(100) == 100
      assert TimeoutPolicy.probe_timeout(5_000) == 5_000
    end
  end

  describe "normalization" do
    test "accepts string provider names" do
      assert TimeoutPolicy.local?("strata")
      assert TimeoutPolicy.resolve("lmstudio").profile == :local
    end

    test "unknown providers fall back to hosted profile" do
      assert TimeoutPolicy.resolve(:unknown_provider).profile == :hosted
    end
  end
end
