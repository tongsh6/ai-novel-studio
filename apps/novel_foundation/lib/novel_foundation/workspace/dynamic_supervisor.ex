defmodule NovelFoundation.Workspace.DynamicSupervisor do
  @moduledoc """
  顶层多 workspace 根。`:one_for_one` —— 一个 workspace 崩了不影响别的。

  权威定义：`docs/design-v2/tech-stack/08-multi-agent.md` §2 / §2.1。
  """

  use DynamicSupervisor

  alias NovelFoundation.Workspace

  def start_link(init_arg) do
    DynamicSupervisor.start_link(__MODULE__, init_arg, name: __MODULE__)
  end

  @impl true
  def init(_init_arg) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  @doc """
  动态启动一个 workspace 子树。

  幂等：同一 workspace_id 二次启动返回 `{:ok, pid}` 指向已存在的 Supervisor。
  """
  @spec start_workspace(String.t()) :: {:ok, pid()} | {:error, term()}
  def start_workspace(workspace_id) when is_binary(workspace_id) do
    spec = {Workspace.Supervisor, workspace_id}

    case DynamicSupervisor.start_child(__MODULE__, spec) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      other -> other
    end
  end

  @doc """
  停止一个 workspace 子树。
  """
  @spec stop_workspace(String.t()) :: :ok | {:error, :not_found}
  def stop_workspace(workspace_id) when is_binary(workspace_id) do
    case Workspace.whereis(workspace_id) do
      nil -> {:error, :not_found}
      pid -> DynamicSupervisor.terminate_child(__MODULE__, pid)
    end
  end
end
