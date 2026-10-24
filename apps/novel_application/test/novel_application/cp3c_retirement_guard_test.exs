defmodule NovelApplication.CP3cRetirementGuardTest do
  @moduledoc "B27 CP3c / D1+D6：ProviderProgress 与 AIMessageEnvelope 退役后无死引用。"
  use ExUnit.Case, async: true

  @lib_dir "lib/novel_application"

  defp lib_sources do
    @lib_dir
    |> Path.join("**/*.ex")
    |> Path.wildcard()
    |> Enum.map(&{&1, File.read!(&1)})
  end

  test "AIMessageEnvelope 模块/引用已退役，无生产死读取" do
    refute File.exists?(Path.join(@lib_dir, "ai_message_envelope.ex"))

    offenders =
      for {file, source} <- lib_sources(), String.contains?(source, "AIMessageEnvelope") do
        Path.relative_to(file, @lib_dir)
      end

    assert offenders == []
  end

  test "AIMessageEnvelope 死 trace 键读取已删除" do
    for {_file, source} <- lib_sources() do
      refute source =~ "ai_message_envelope"
    end
  end

  test "ProviderProgress flow/注册/计划目录/预算/路由引用已退役" do
    refute File.exists?(Path.join(@lib_dir, "agent_run_flows/provider_progress.ex"))

    offenders =
      for {file, source} <- lib_sources(),
          String.contains?(source, "ProviderProgress") or
            String.contains?(source, "provider_progress_v1") do
        Path.relative_to(file, @lib_dir)
      end

    assert offenders == []
  end

  test "provider_progress AgentEvent 类型保留（provider 运行活动事件，不是已退役 flow）" do
    # 只退役 flow/profile；:provider_progress 事件类型仍由 ProviderActivityProjector 消费。
    assert File.exists?(Path.join(@lib_dir, "provider_activity_projector.ex"))
  end
end
