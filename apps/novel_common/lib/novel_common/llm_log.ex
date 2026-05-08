defmodule NovelCommon.LLMLog do
  @moduledoc """
  LLM HTTP 调用日志 — JSONL 按天记录，行首带时间戳。

  每次 Provider 调用追加一行 `[ts] {...}` 到 `log/llm-calls/YYYY-MM-DD.jsonl`。
  """

  require Logger

  @default_dir Path.expand("log/llm-calls", File.cwd!())

  @doc """
  记录一次 LLM 调用。各 adapter 在 complete/4 返回前调用。
  """
  @spec record(String.t(), String.t(), map(), term(), integer()) :: :ok
  def record(provider, url, req_body, result, start_time) do
    {status, usage, duration, resp_body} = extract_attrs(result, start_time)

    append(%{
      step: Process.get(:current_step, "unknown"),
      provider: provider,
      request: %{method: "POST", url: url, body: req_body},
      response: %{status: status, body: resp_body, model: provider, usage: usage, duration_ms: duration}
    })
  end

  defp extract_attrs({:ok, _ok_result, %{status: 200} = attrs}, _start_time) do
    {attrs.status, attrs.usage, attrs.duration, Map.get(attrs, :resp_body, "")}
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
    dir = Application.get_env(:novel_agent, :llm_log_dir, @default_dir)
    date = Date.utc_today() |> Date.to_iso8601()
    path = Path.join(dir, "#{date}.jsonl")

    ts = DateTime.utc_now() |> DateTime.to_iso8601()

    record = %{
      ts: ts,
      turn_id: Process.get(:current_turn_id) || "unknown",
      step: Map.get(entry, :step, "unknown"),
      provider: Map.get(entry, :provider, "unknown"),
      request: sanitize_request(entry.request),
      response: sanitize_response(entry.response)
    }

    json = Jason.encode!(record)
    line = "[#{ts}] #{json}\n"
    File.mkdir_p!(dir)

    case File.write(path, line, [:append]) do
      :ok -> :ok
      {:error, reason} -> Logger.warning("[LLMLog] 写入失败: #{inspect(reason)}")
    end
  end

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
      usage: Map.get(resp, :usage, %{}),
      duration_ms: Map.get(resp, :duration_ms, 0)
    }
  end
end
