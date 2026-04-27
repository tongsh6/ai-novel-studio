defmodule NovelAgent.Runtime.WorkspaceSession do
  @moduledoc """
  Workspace 子树查询入口。提供 `whereis/1` / `list/0`，封装 Registry 访问。
  """

  alias NovelAgent.Runtime.Registries

  @doc """
  查找 workspace 对应 Workspace.Supervisor 的 pid，未启动返回 nil。
  """
  @spec whereis(String.t()) :: pid() | nil
  def whereis(workspace_id) when is_binary(workspace_id) do
    case Registry.lookup(Registries.Workspace, workspace_id) do
      [{pid, _}] -> pid
      [] -> nil
    end
  end

  @doc """
  列出当前所有已启动的 workspace_id。
  """
  @spec list() :: [String.t()]
  def list do
    Registry.select(Registries.Workspace, [{{:"$1", :_, :_}, [], [:"$1"]}])
  end
end
