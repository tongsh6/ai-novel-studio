defmodule NovelCommon.LogEmitTest do
  use ExUnit.Case, async: false

  require NovelCommon.LogEmit, as: LogEmit

  alias NovelCommon.LogContext

  setup do
    old_enabled = Application.get_env(:novel_common, :log_jsonl_enabled)
    old_dir = Application.get_env(:novel_common, :log_jsonl_dir)

    dir =
      Path.join(System.tmp_dir!(), "novel-log-emit-test-#{System.unique_integer([:positive])}")

    Application.put_env(:novel_common, :log_jsonl_enabled, true)
    Application.put_env(:novel_common, :log_jsonl_dir, dir)
    Logger.reset_metadata([])

    on_exit(fn ->
      Logger.reset_metadata([])

      if is_nil(old_enabled),
        do: Application.delete_env(:novel_common, :log_jsonl_enabled),
        else: Application.put_env(:novel_common, :log_jsonl_enabled, old_enabled)

      if is_nil(old_dir),
        do: Application.delete_env(:novel_common, :log_jsonl_dir),
        else: Application.put_env(:novel_common, :log_jsonl_dir, old_dir)

      File.rm_rf!(dir)
    end)

    %{dir: dir}
  end

  # B13b BB-10（ADR-0018 §4）：JSONL 每行带 level——done/start 为 info、error 相为
  # error；噪声门禁据此实现「正常路径 0 error 级」。
  test "writes level derived from phase plus turn correlation keys", %{dir: dir} do
    LogContext.put_turn("ws-log", "work-log", "turn-log", "session-log")

    LogEmit.__emit__(:probe, :done_step, :done, %{tool_name: "prose_writing"})
    LogEmit.__emit__(:probe, :failed_step, :error, %{reason_code: :tool_not_dispatchable})

    records = wait_for_records(dir, 2)
    done = Enum.find(records, &(&1["event"] == "probe.done_step.done"))
    error = Enum.find(records, &(&1["event"] == "probe.failed_step.error"))

    assert done["level"] == "info"
    assert done["outcome"] == "ok"
    assert error["level"] == "error"
    assert error["outcome"] == "error"

    assert done["turn_id"] == "turn-log"
    assert done["work_id"] == "work-log"
    assert done["workspace_id"] == "ws-log"
    assert done["session_id"] == "session-log"

    # level 是保留字段：caller 字段不得覆盖它（与 event/outcome/timestamp 同格）。
    assert error["level"] == "error"
  end

  defp wait_for_records(dir, expected) do
    path = Path.join(dir, "#{NovelCommon.LogFileDate.today_iso8601()}.jsonl")

    Enum.reduce_while(1..100, [], fn _attempt, _acc ->
      records =
        case File.read(path) do
          {:ok, content} ->
            content
            |> String.split("\n", trim: true)
            |> Enum.map(&Jason.decode!/1)

          _ ->
            []
        end

      if length(records) >= expected do
        {:halt, records}
      else
        Process.sleep(20)
        {:cont, records}
      end
    end)
  end
end
