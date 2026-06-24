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

  # 回归守卫：成功调用的 usage 是一个结构体（provider 把原生 usage 归一化成 %Usage{}）。
  # 日志层不依赖该业务类型，但必须对任意结构体免疫——否则 Jason.encode 失败、整行被静默丢弃，
  # 正是"成功调用没有日志"的根因。
  defmodule FakeUsage do
    defstruct input_tokens: 0, output_tokens: 0, model: nil, latency_ms: 0
  end

  test "serializes a struct-typed usage instead of silently dropping the line", %{dir: dir} do
    :ok =
      LLMLog.append(%{
        step: "provider_gateway.complete",
        provider: "deepseek",
        request: %{
          method: "POST",
          url: "http://llm.test/v1/chat",
          body: %{"messages" => [%{"content" => "一段足够长的真实创作输入"}]}
        },
        response: %{
          status: 200,
          body: "ok",
          model: "deepseek-v4-pro",
          usage: %FakeUsage{input_tokens: 1172, output_tokens: 182, model: "deepseek-v4-pro"},
          duration_ms: 5374
        }
      })

    path = Path.join(dir, "#{NovelCommon.LogFileDate.today_iso8601()}.jsonl")
    assert File.exists?(path)

    [_prefix, json] = path |> File.read!() |> String.trim() |> String.split("] ", parts: 2)
    record = Jason.decode!(json)

    assert record["response"]["usage"]["input_tokens"] == 1172
    assert record["response"]["usage"]["output_tokens"] == 182
  end

  test "records current_step from LogContext metadata (Task-safe correlation)", %{dir: dir} do
    LogContext.put_step("tool.plot_outline")

    :ok =
      LLMLog.record(
        "deepseek",
        "http://llm.test/v1/chat",
        %{"messages" => [%{"content" => "一段足够长的真实创作输入，用于跳过健康检查"}]},
        {:ok, %{content: "正文"}, %{status: 200, usage: %{}, duration: 12, resp_body: "{}"}},
        System.monotonic_time(:millisecond)
      )

    path = Path.join(dir, "#{NovelCommon.LogFileDate.today_iso8601()}.jsonl")
    [_prefix, json] = path |> File.read!() |> String.trim() |> String.split("] ", parts: 2)
    record = Jason.decode!(json)

    assert record["step"] == "tool.plot_outline"
  end
end
