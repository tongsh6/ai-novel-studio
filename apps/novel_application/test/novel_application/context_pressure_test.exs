defmodule NovelApplication.ContextPressureTest do
  @moduledoc """
  B71 上下文压力只读派生（阶段 4 基础设施；自动触发门控于 VS-00L §18 评审）。

  只验证「真实 usage → 保守窗口 → 压力线」的只读派生；不验证也不触发任何压缩。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.ContextPressure
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{ProviderOutputRecord, ProviderRunRecord}

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})

    on_exit(fn ->
      Application.delete_env(:novel_application, :context_window_overrides)
      Application.delete_env(:novel_application, :context_pressure)
    end)

    :ok
  end

  test "window：默认保守值、未知 provider 兜底、应用配置可覆盖且不向作者暴露" do
    assert ContextPressure.window("deepseek") == 64_000
    assert ContextPressure.window("anthropic") == 200_000
    assert ContextPressure.window("splash") == 32_000
    assert ContextPressure.window("unknown-provider") == 32_000
    assert ContextPressure.window(nil) == 32_000

    Application.put_env(:novel_application, :context_window_overrides, %{"deepseek" => 40_000})
    assert ContextPressure.window("deepseek") == 40_000
  end

  test "parse_window_overrides：产品化 provider:window 覆盖解析，非法项忽略" do
    assert ContextPressure.parse_window_overrides(nil) == %{}
    assert ContextPressure.parse_window_overrides("") == %{}
    assert ContextPressure.parse_window_overrides("strata:4096") == %{"strata" => 4096}

    assert ContextPressure.parse_window_overrides("strata:4096, openai:8192") == %{
             "strata" => 4096,
             "openai" => 8192
           }

    assert ContextPressure.parse_window_overrides("strata:0,openai:-3,bad,tool:abc,:4096") == %{}
    assert ContextPressure.parse_window_overrides("strata:4096,bad") == %{"strata" => 4096}
  end

  test "没有真实 usage 时压力未知，不按消息数猜测" do
    pressure = ContextPressure.pressure("run_no_usage")

    assert pressure.available == false
    assert pressure.input_tokens == nil
    assert pressure.ratio == nil
    refute pressure.maintenance_due?
    refute pressure.hard_due?

    assert ContextPressure.latest_usage("run_no_usage") == :unavailable
    refute ContextPressure.maintenance_due?("run_no_usage")
  end

  test "真实 usage 驱动维护线与硬线（只读派生，不执行压缩）" do
    run_id = unique_run_id()
    insert_provider_usage(run_id, 48_000, "deepseek", "deepseek-chat")

    pressure = ContextPressure.pressure(run_id)

    assert pressure.available
    assert pressure.input_tokens == 48_000
    assert pressure.provider == "deepseek"
    assert pressure.window == 64_000
    assert_in_delta pressure.ratio, 0.75, 0.0001
    assert pressure.maintenance_due?
    refute pressure.hard_due?

    assert {:ok, %{input_tokens: 48_000, provider: "deepseek"}} =
             ContextPressure.latest_usage(run_id)
  end

  test "低压力不触发维护线；最近一次 usage 优先" do
    run_id = unique_run_id()
    insert_provider_usage(run_id, 10_000, "openai", "gpt-x")
    insert_provider_usage(run_id, 20_000, "openai", "gpt-x")

    pressure = ContextPressure.pressure(run_id)

    assert pressure.input_tokens == 20_000
    refute pressure.maintenance_due?

    assert 20_000 / 128_000 < 0.70
  end

  test "usage 为 0 或缺 input_tokens 时按未知处理" do
    run_id = unique_run_id()
    insert_provider_usage(run_id, 0, "stub", "stub")

    assert ContextPressure.latest_usage(run_id) == :unavailable
    refute ContextPressure.pressure(run_id).available
  end

  defp unique_run_id do
    "run_pressure_#{System.unique_integer([:positive, :monotonic])}"
  end

  defp insert_provider_usage(run_id, tokens, provider, model) do
    run_ref = "prun_#{System.unique_integer([:positive, :monotonic])}"
    call_ref = "pcall_#{System.unique_integer([:positive, :monotonic])}"
    now = DateTime.utc_now()

    Repo.insert!(%ProviderRunRecord{
      id: run_ref,
      provider_call_ref: call_ref,
      agent_run_id: run_id,
      purpose: "writer",
      execution_mode: "non_stream",
      status: "completed",
      provider_id: provider,
      model: model,
      started_at: now,
      completed_at: now
    })

    Repo.insert!(%ProviderOutputRecord{
      provider_run_id: run_ref,
      provider_call_ref: call_ref,
      agent_run_id: run_id,
      status: "completed",
      output_type: "text",
      usage: %{"input_tokens" => tokens, "output_tokens" => 120}
    })

    :ok
  end
end
