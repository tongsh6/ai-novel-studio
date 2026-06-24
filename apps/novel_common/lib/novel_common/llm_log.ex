defmodule NovelCommon.LLMLog do
  @moduledoc """
  LLM HTTP 调用日志 — JSONL 按天记录，行首带时间戳。

  每次 Provider 调用追加一行 `[ts] {...}` 到 `log/llm-calls/YYYY-MM-DD.jsonl`。
  """

  require Logger
  require NovelCommon.LogEmit, as: LogEmit

  # 从源文件向上查找 mix.exs 定位项目根。有停止条件，不会无限循环
  @project_root_dir __DIR__
                    |> Stream.iterate(&Path.dirname/1)
                    |> Stream.take_while(&(&1 != "/"))
                    |> Enum.find(&File.exists?(Path.join(&1, "mix.exs"))) ||
                      raise("Cannot find project root (mix.exs) from #{__DIR__}")

  @doc """
  记录一次 LLM 调用。各 adapter 在 complete/4 返回前调用。
  """
  @spec record(String.t(), String.t(), map(), term(), integer()) :: :ok
  def record(provider, url, req_body, result, start_time) do
    {status, usage, duration, resp_body} = extract_attrs(result, start_time)

    append(%{
      step: current_step(),
      provider: provider,
      request: %{method: "POST", url: url, body: req_body},
      response: %{
        status: status,
        body: resp_body,
        model: provider,
        usage: usage,
        duration_ms: duration
      }
    })
  end

  defp extract_attrs({:ok, _ok_result, %{status: status} = attrs}, _start_time)
       when status in 200..299 do
    {status, attrs.usage, attrs.duration, Map.get(attrs, :resp_body, "")}
  end

  defp extract_attrs({:ok, _ok_result, attrs}, _start_time) do
    {Map.get(attrs, :status, 0), Map.get(attrs, :usage, %{}), Map.get(attrs, :duration, 0),
     Map.get(attrs, :resp_body, "")}
  end

  defp extract_attrs({:error, _error_tuple, attrs}, start_time) do
    duration = attrs[:duration] || System.monotonic_time(:millisecond) - start_time
    {attrs[:status] || 0, attrs[:usage] || %{}, duration, Map.get(attrs, :resp_body, "")}
  end

  @doc false
  def append(%{request: _req, response: _resp} = entry) do
    if health_check?(entry) do
      :ok
    else
      do_append(entry)
    end
  end

  defp do_append(entry) do
    dir = Application.get_env(:novel_common, :llm_log_dir) || default_log_dir()
    date = NovelCommon.LogFileDate.today_iso8601()
    path = Path.join(dir, "#{date}.jsonl")

    ts = DateTime.utc_now() |> DateTime.to_iso8601()

    turn_id =
      case Keyword.fetch(Logger.metadata(), :turn_id) do
        {:ok, val} -> val
        :error -> Process.get(:current_turn_id) || "unknown"
      end

    metadata = Logger.metadata()

    record =
      %{
        ts: ts,
        turn_id: turn_id,
        step: Map.get(entry, :step, "unknown"),
        provider: Map.get(entry, :provider, "unknown"),
        request: sanitize_request(entry.request),
        response: sanitize_response(entry.response)
      }
      |> maybe_put_from_meta(:workspace_id, metadata)
      |> maybe_put_from_meta(:work_id, metadata)
      |> maybe_put_from_meta(:session_id, metadata)

    case Jason.encode(record) do
      {:ok, json} ->
        write_line(dir, path, ts, json)

      {:error, reason} ->
        # 不静默丢：发结构化告警（进 app 日志），并退化写入一条可编码的占位，
        # 保证"发生过一次调用"这件事不丢失。
        emit_append_error(:encode_failed, reason)
        write_fallback(dir, path, ts, turn_id, record, reason)
    end
  end

  defp write_line(dir, path, ts, json) do
    line = "[#{ts}] #{json}\n"
    File.mkdir_p!(dir)

    case File.write(path, line, [:append]) do
      :ok -> :ok
      {:error, reason} -> emit_append_error(:write_failed, reason)
    end
  end

  defp write_fallback(dir, path, ts, turn_id, record, reason) do
    fallback = %{
      ts: ts,
      turn_id: turn_id,
      encode_error: inspect(reason),
      record_inspect: inspect(record)
    }

    case Jason.encode(fallback) do
      {:ok, json} -> write_line(dir, path, ts, json)
      {:error, _reason} -> :ok
    end
  end

  defp emit_append_error(reason_code, reason) do
    LogEmit.emit(:llm_log, :append, :error, %{
      reason_code: reason_code,
      outcome_detail: inspect(reason)
    })
  end

  # step 与 turn_id 同样优先读 Logger.metadata（随 Task 继承 / snapshot 传递），
  # 进程字典仅作兼容回退。读不到则 "unknown"。
  defp current_step do
    case Keyword.fetch(Logger.metadata(), :current_step) do
      {:ok, val} when is_binary(val) -> val
      _ -> Process.get(:current_step) || "unknown"
    end
  end

  defp default_log_dir, do: Path.join(@project_root_dir, "log/llm-calls")

  defp health_check?(entry) do
    body = Map.get(entry.request, :body, %{})

    if is_map(body) do
      case Map.get(body, "messages") do
        [%{"content" => content} | _] when byte_size(content) < 10 ->
          String.trim(content) == "ping"

        _ ->
          false
      end
    else
      false
    end
  end

  defp sanitize_request(req) do
    %{
      method: Map.get(req, :method, "POST"),
      url: Map.get(req, :url, ""),
      body: Map.get(req, :body, %{})
    }
  end

  defp sanitize_response(resp) do
    %{
      status: Map.get(resp, :status, 0),
      body: Map.get(resp, :body, ""),
      model: Map.get(resp, :model, ""),
      usage: normalize_term(Map.get(resp, :usage, %{})),
      duration_ms: Map.get(resp, :duration_ms, 0)
    }
  end

  # 日志层不依赖任何业务结构体类型（umbrella 依赖方向约束），
  # 但要对结构体免疫：任何结构体一律转成 plain map，保证可序列化。
  defp normalize_term(term) when is_struct(term), do: Map.from_struct(term)
  defp normalize_term(term), do: term

  defp maybe_put_from_meta(map, key, metadata) do
    case Keyword.get(metadata, key) do
      nil -> map
      value -> Map.put(map, key, value)
    end
  end
end
