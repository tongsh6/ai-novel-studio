defmodule NovelAgent do
  @moduledoc """
  Agent 层公开 API。暴露 supervision 三层（workspace / author / agent）的启停。

  - `start_workspace/1` —— 启动一个 workspace 子树（幂等）
  - `start_author/2` —— 在已启动的 workspace 下启一个 author session（幂等）
  - `spawn_agent/4` —— 在已启动的 author 下 spawn 指定类型的 Agent
  """

  alias NovelAgent.Runtime.Agent, as: Agent
  alias NovelAgent.Runtime.AuthorSession, as: Author
  alias NovelAgent.Runtime.WorkspaceSession, as: Workspace

  @spec start_workspace(String.t()) :: {:ok, pid()} | {:error, term()}
  def start_workspace(workspace_id),
    do: Workspace.DynamicSupervisor.start_workspace(workspace_id)

  @spec stop_workspace(String.t()) :: :ok | {:error, :not_found}
  def stop_workspace(workspace_id),
    do: Workspace.DynamicSupervisor.stop_workspace(workspace_id)

  @spec start_author(String.t(), String.t()) :: {:ok, pid()} | {:error, term()}
  def start_author(workspace_id, author_id),
    do: Author.DynamicSupervisor.start_author(workspace_id, author_id)

  @spec stop_author(String.t(), String.t()) :: :ok | {:error, :not_found}
  def stop_author(workspace_id, author_id),
    do: Author.DynamicSupervisor.stop_author(workspace_id, author_id)

  @doc "Spawn 指定类型的 Agent（:writer | :reviewer | :planner）。"
  @spec spawn_agent(String.t(), String.t(), String.t(), atom()) ::
          {:ok, pid()} | {:error, term()}
  def spawn_agent(workspace_id, author_id, agent_id, agent_type \\ :writer),
    do:
      Agent.Children.DynamicSupervisor.spawn_agent(workspace_id, author_id, agent_id, agent_type)

  @doc "查询 workspace 子树根 pid"
  @spec workspace_pid(String.t()) :: pid() | nil
  def workspace_pid(workspace_id), do: Workspace.whereis(workspace_id)

  @doc "查询 author 子树根 pid"
  @spec author_pid(String.t(), String.t()) :: pid() | nil
  def author_pid(workspace_id, author_id),
    do: Author.whereis(workspace_id, author_id)

  @doc "查询单个 agent process pid"
  @spec agent_pid(String.t(), String.t(), String.t()) :: pid() | nil
  def agent_pid(workspace_id, author_id, agent_id),
    do: Agent.whereis(workspace_id, author_id, agent_id)
end
