defmodule NovelTelemetry.LogEmitTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog

  require NovelTelemetry.LogEmit, as: LogEmit

  alias NovelFoundation.ID
  alias NovelTelemetry.LogContext

  setup do
    old_enabled = Application.get_env(:novel_telemetry, :log_jsonl_enabled)
    old_dir = Application.get_env(:novel_telemetry, :log_jsonl_dir)

    dir = Path.join(System.tmp_dir!(), "novel-log-emit-test-#{ID.uuid()}")

    # 目录一分配就登记退出清理；env 恢复也在此完成，顺序为恢复 env → 清理目录。
    on_exit(fn ->
      Logger.reset_metadata([])
      restore_env(:log_jsonl_enabled, old_enabled)
      restore_env(:log_jsonl_dir, old_dir)
      File.rm_rf!(dir)
    end)

    Application.put_env(:novel_telemetry, :log_jsonl_enabled, true)
    Application.put_env(:novel_telemetry, :log_jsonl_dir, dir)
    Logger.reset_metadata([])

    %{dir: dir}
  end

  # B13b BB-10（ADR-0018 §4）：JSONL 每行带 level——done/start 为 info、error 相为
  # error；噪声门禁据此实现「正常路径 0 error 级」。同步写出后立即读真实文件，
  # 期望值独立于实现（不轮询、不从 writer 派生）。
  test "writes level, correlation keys, and reserved fields before returning", %{dir: dir} do
    LogContext.put_turn("ws-log", "work-log", "turn-log", "session-log")

    assert :ok ==
             LogEmit.__emit__(:probe, :done_step, :done, %{
               tool_name: "prose_writing",
               level: "info",
               outcome: "start",
               event: "forged.event",
               timestamp: "forged-timestamp"
             })

    assert :ok ==
             LogEmit.__emit__(:probe, :failed_step, :error, %{
               reason_code: :tool_not_dispatchable,
               level: "info"
             })

    records = read_records!(dir)
    assert length(records) == 2

    done = Enum.find(records, &(&1["event"] == "probe.done_step.done"))
    error = Enum.find(records, &(&1["event"] == "probe.failed_step.error"))

    assert done["level"] == "info"
    assert done["level"] == "info"

    # outcome 是业务结果字段：调用方显式指定时按其语义（plan_draft/judgment 的
    # output_validation 依赖 rejected/retry 表达 done 相位的业务结果）；未指定时
    # 按 phase 推导，见下一个用例。
    assert done["outcome"] == "start"
    assert error["level"] == "error"
    assert error["outcome"] == "error"

    assert done["turn_id"] == "turn-log"
    assert done["work_id"] == "work-log"
    assert done["workspace_id"] == "ws-log"
    assert done["session_id"] == "session-log"

    # caller 字段不得覆盖 event/level/timestamp。
    refute Enum.any?(records, &(&1["event"] == "forged.event"))
    assert {:ok, %DateTime{}, _offset} = DateTime.from_iso8601(done["timestamp"])
  end

  test "derives outcome from phase when the caller omits it", %{dir: dir} do
    assert :ok == LogEmit.__emit__(:probe, :derived_done, :done, %{})
    assert :ok == LogEmit.__emit__(:probe, :derived_start, :start, %{})

    records = read_records!(dir)
    assert length(records) == 2

    assert Enum.find(records, &(&1["event"] == "probe.derived_done.done"))["outcome"] == "ok"
    assert Enum.find(records, &(&1["event"] == "probe.derived_start.start"))["outcome"] == "start"
  end

  test "disabled writes no file and creates no directory", %{dir: dir} do
    Application.put_env(:novel_telemetry, :log_jsonl_enabled, false)

    assert :ok == LogEmit.__emit__(:probe, :disabled_step, :done, %{})

    refute File.exists?(dir)
  end

  test "a real IO failure is diagnosed while the caller still returns :ok", %{dir: dir} do
    # 目录位置被普通文件占用：mkdir_p 与 append 都会失败。
    File.write!(dir, "not a directory")
    expected_path = Path.join(dir, "#{NovelTelemetry.LogFileDate.today_iso8601()}.jsonl")

    log =
      capture_log(fn ->
        assert :ok == LogEmit.__emit__(:probe, :io_failure, :done, %{})
      end)

    assert log =~ "novel_telemetry LogEmit JSONL write failed"
    assert log =~ expected_path
    assert log =~ "reason="
    assert File.regular?(dir)
  end

  test "a producer that exits after emitting leaves one complete readable line", %{dir: dir} do
    token = ID.uuid()
    test_pid = self()

    {:ok, producer} =
      Task.start(fn ->
        :ok = LogEmit.__emit__(:probe, :producer_exit, :done, %{probe: token})
        send(test_pid, :emitted)
      end)

    ref = Process.monitor(producer)
    assert_receive :emitted, 5_000
    assert_receive {:DOWN, ^ref, :process, ^producer, :normal}, 5_000

    assert [record] = read_records!(dir)
    assert record["probe"] == token
    assert record["event"] == "probe.producer_exit.done"

    # 生产者已退出；删除目录后没有独立 writer 会把它重新建出来。
    File.rm_rf!(dir)
    refute File.exists?(dir)
  end

  test "concurrent producers write individually valid, parseable lines", %{dir: dir} do
    # 预建目录，把并发边界限定在 append 本身；目录创建另有单线程用例覆盖。
    File.mkdir_p!(dir)
    tokens = for _ <- 1..20, do: ID.uuid()

    results =
      tokens
      |> Enum.map(fn token ->
        Task.async(fn ->
          LogEmit.__emit__(:probe, :concurrent, :done, %{probe: token})
        end)
      end)
      |> Task.await_many(10_000)

    assert Enum.all?(results, &(&1 == :ok))

    records = read_records!(dir)
    assert length(records) == length(tokens)
    assert Enum.all?(records, &(&1["event"] == "probe.concurrent.done"))
    assert Enum.sort(Enum.map(records, & &1["probe"])) == Enum.sort(tokens)
  end

  defp read_records!(dir) do
    path = Path.join(dir, "#{NovelTelemetry.LogFileDate.today_iso8601()}.jsonl")

    path
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.map(&Jason.decode!/1)
  end

  defp restore_env(key, nil), do: Application.delete_env(:novel_telemetry, key)
  defp restore_env(key, value), do: Application.put_env(:novel_telemetry, key, value)
end
