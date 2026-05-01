defmodule NovelAgent.LLMLog do
  @moduledoc """
  LLM HTTP 调用日志 — JSONL 按天记录。

  每次 HTTP 调用追加一行到 `log/llm-calls/YYYY-MM-DD.jsonl`。
  """

  require Logger

  @default_dir "log/llm-calls"

  @doc """
  追加一条 LLM HTTP 调用记录。

  ## 字段

  - `turn_id` — 当前 turn 标识（从进程字典读取）
  - `step` — 调用阶段：intent_classify | slot_extract | generate
  - `provider` — provider 名称
  - `request` — HTTP 请求信息 (method, url, body)
  - `response` — HTTP 响应信息 (status, body, model, usage, duration_ms)
  """
  @spec append(map()) :: :ok
  def append(%{request: _req, response: _resp} = entry) do
    # 跳过健康检查探针，避免污染业务日志
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

    record = %{
      ts: DateTime.utc_now() |> DateTime.to_iso8601(),
      turn_id: Process.get(:current_turn_id) || "unknown",
      step: Map.get(entry, :step, "unknown"),
      provider: Map.get(entry, :provider, "unknown"),
      request: sanitize_request(entry.request),
      response: sanitize_response(entry.response)
    }

    json = Jason.encode!(record)

    File.mkdir_p!(dir)

    case File.write(path, json <> "\n", [:append]) do
      :ok -> :ok
      {:error, reason} -> Logger.warning("[LLMLog] 写入失败: #{inspect(reason)}")
    end
  end

  defp health_check?(entry) do
    case get_in(entry.request, [:body, "messages"]) do
      [%{"content" => content} | _] when byte_size(content) < 10 ->
        String.trim(content) == "ping"
      _ -> false
    end
  end

  defp sanitize_request(req) do
    body = Map.get(req, :body, %{})
    # 截断长 prompt 避免日志膨胀
    sanitized_body =
      case body["messages"] do
        messages when is_list(messages) ->
          Map.put(body, "messages", Enum.map(messages, &truncate_message/1))
        _ ->
          body
      end

    %{
      method: Map.get(req, :method, "POST"),
      url: Map.get(req, :url, ""),
      body: sanitized_body
    }
  end

  defp truncate_message(%{"role" => _role, "content" => content} = msg) do
    truncated =
      if byte_size(content) > 2000 do
        String.slice(content, 0, 2000) <> "...[截断 #{byte_size(content)} 字节]"
      else
        content
      end

    %{msg | "content" => truncated}
  end
  defp truncate_message(msg), do: msg

  defp sanitize_response(resp) do
    body_raw = Map.get(resp, :body, "")
    # 响应内容截断到 5000 字节
    body =
      if is_binary(body_raw) and byte_size(body_raw) > 5000 do
        String.slice(body_raw, 0, 5000) <> "...[截断 #{byte_size(body_raw)} 字节]"
      else
        body_raw
      end

    %{
      status: Map.get(resp, :status, 0),
      body: body,
      model: Map.get(resp, :model, ""),
      usage: Map.get(resp, :usage, %{}),
      duration_ms: Map.get(resp, :duration_ms, 0)
    }
  end
end
