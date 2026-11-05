defmodule NovelPersistence.ProviderRunLogFiniteModeTest do
  # VS-00L §6.4（2026-11-06 作者裁决 D）：有限模式必须进入持久执行事实。
  # 单独成文件以保持 provider_run_log_test 的职责边界与模块规模。
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelCommon.Contracts.{ProviderOutput, ProviderRun}
  alias NovelPersistence.ProviderRunLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  defp record_run(agent_run_id, provider_run_id, provider_call_ref, metadata) do
    {:ok, run} =
      ProviderRun.new(%{
        provider_run_id: provider_run_id,
        provider_call_ref: provider_call_ref,
        purpose: :writer,
        execution_mode: :event_stream,
        status: :completed,
        provider_id: "model_caps",
        model: "writer-model",
        metadata: metadata
      })

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: provider_run_id,
        provider_call_ref: provider_call_ref,
        status: :ok,
        output_type: :text,
        content: %{text: "输出"},
        usage: %{total_tokens: 1, input_tokens: 1, output_tokens: 0},
        refs: [provider_call_ref]
      })

    ProviderRunLog.record_execution(
      {:ok, %{provider_run: run, events: [], output: output}},
      %{agent_run_id: agent_run_id}
    )
  end

  test "有限模式进入 finite_mode_name 列与 metadata.finite_mode（boolean 保真）" do
    agent_run_id = "run-finite-mode-#{System.unique_integer([:positive, :monotonic])}"
    mode = %{name: "standalone_operation", durable_recovery: false}

    assert :ok =
             record_run(agent_run_id, "prun-finite-mode", "pcall-finite-mode", %{
               finite_mode: mode,
               safe_note: "kept"
             })

    assert [record] = ProviderRunLog.list_runs(agent_run_id)
    assert record.finite_mode_name == "standalone_operation"

    assert record.metadata["finite_mode"] == %{
             "name" => "standalone_operation",
             "durable_recovery" => false
           }

    assert record.metadata["safe_note"] == "kept"
  end

  test "无 finite_mode 的运行不写 finite_mode_name（完整模式以缺省判定）" do
    agent_run_id = "run-complete-mode-#{System.unique_integer([:positive, :monotonic])}"

    assert :ok = record_run(agent_run_id, "prun-complete-mode", "pcall-complete-mode", %{})

    assert [record] = ProviderRunLog.list_runs(agent_run_id)
    assert is_nil(record.finite_mode_name)
  end
end
