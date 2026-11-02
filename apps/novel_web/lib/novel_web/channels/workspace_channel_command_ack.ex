defmodule NovelWeb.WorkspaceChannelCommandAck do
  @moduledoc """
  `agent_command` 的 author-safe 回执形状唯一所属点（VS-00L §16.2/§16.4）。

  运行控制命令与作者显式压缩共用同一 ack：只携带 received/run_id/command/
  resolved_run_id/binding_source，压缩额外 additive `compaction`（整理项数与
  作者安全说明，由 application 投影）。不暴露内部 call_id、ref 原值、版本或
  canonical 内容。

  独立成模块是为了让超限的 workspace_channel 只委托回执投影（模块规模规则
  `docs/coding-standards/03-module-boundaries.md` §3.2）。
  """

  @spec build(String.t(), String.t(), map()) :: map()
  def build(run_id, command, extra \\ %{}) when is_binary(run_id) and is_binary(command) do
    %{
      received: true,
      run_id: run_id,
      command: command,
      resolved_run_id: run_id,
      binding_source: if(command == "steer", do: "explicit_steer", else: "active_run")
    }
    |> Map.merge(extra)
  end
end
