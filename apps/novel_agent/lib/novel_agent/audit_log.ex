defmodule NovelAgent.AuditLog do
  @moduledoc """
  Audit log — JSONL 写入。

  Phase 0 Week 3：简单文件追加，每行一条 JSON 记录。
  后续 Phase 加 rotation、retention、search。
  """

  require Logger

  @log_file "audit.jsonl"

  @doc """
  追加一条审计记录到 JSONL 文件。
  """
  @spec append(map()) :: :ok
  def append(entry) when is_map(entry) do
    path = log_path()

    case File.write(path, Jason.encode!(entry) <> "\n", [:append, :utf8]) do
      :ok ->
        :ok

      {:error, reason} ->
        Logger.warning("[审计日志] 写入失败：#{inspect(reason)}")
        :ok
    end
  end

  @doc """
  返回审计日志文件路径。
  """
  def log_path do
    dir = Application.get_env(:novel_agent, :audit_log_dir, "log")
    Path.join([dir, @log_file])
  end
end
