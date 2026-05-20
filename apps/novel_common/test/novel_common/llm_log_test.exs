defmodule NovelCommon.LLMLogTest do
  use ExUnit.Case, async: false

  alias NovelCommon.LLMLog
  alias NovelCommon.LogContext

  setup do
    old_dir = Application.get_env(:novel_common, :llm_log_dir)
    dir = Path.join(System.tmp_dir!(), "novel-llm-log-test-#{System.unique_integer([:positive])}")

    Application.put_env(:novel_common, :llm_log_dir, dir)
    Logger.reset_metadata([])

    on_exit(fn ->
      Logger.reset_metadata([])

      if old_dir do
        Application.put_env(:novel_common, :llm_log_dir, old_dir)
      else
        Application.delete_env(:novel_common, :llm_log_dir)
      end

      File.rm_rf!(dir)
    end)

    %{dir: dir}
  end

  test "writes shared turn correlation keys into LLM JSONL", %{dir: dir} do
    LogContext.put_turn("ws-llm", "work-llm", "turn-llm", "session-llm")

    :ok =
      LLMLog.append(%{
        step: "planner.form_frame",
        provider: "test-provider",
        request: %{
          method: "POST",
          url: "http://llm.test/v1/chat",
          body: %{"messages" => [%{"content" => "hello with context"}]}
        },
        response: %{status: 200, body: "ok", model: "test-provider", usage: %{}, duration_ms: 12}
      })

    path = Path.join(dir, "#{NovelCommon.LogFileDate.today_iso8601()}.jsonl")
    [_prefix, json] = path |> File.read!() |> String.trim() |> String.split("] ", parts: 2)
    record = Jason.decode!(json)

    assert record["workspace_id"] == "ws-llm"
    assert record["work_id"] == "work-llm"
    assert record["session_id"] == "session-llm"
    assert record["turn_id"] == "turn-llm"
  end
end
