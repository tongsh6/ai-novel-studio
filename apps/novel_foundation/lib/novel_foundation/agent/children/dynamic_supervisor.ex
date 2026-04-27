defmodule NovelFoundation.Agent.Children.DynamicSupervisor do
  @moduledoc """
  单 author 下子 Agent 的 supervisor。`:one_for_one` —— **关键**：crash isolation，
  一个 Agent crash 不影响其他 Agent（08-multi-agent.md §2.1）。
  """

  use DynamicSupervisor

  alias NovelFoundation.Agent
  alias NovelFoundation.Registries

  def start_link({workspace_id, author_id}) do
    DynamicSupervisor.start_link(__MODULE__, {workspace_id, author_id},
      name: via(workspace_id, author_id)
    )
  end

  def child_spec({workspace_id, author_id} = arg) do
    %{
      id: {__MODULE__, workspace_id, author_id},
      start: {__MODULE__, :start_link, [arg]},
      type: :supervisor,
      restart: :temporary
    }
  end

  defp via(workspace_id, author_id),
    do: {:via, Registry, {Registries.AgentChildrenDyn, {workspace_id, author_id}}}

  @impl true
  def init(_arg) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  @doc """
  当前阶段使用 dummy GenServer 占位（Phase 0 Week 2 T4）。
  Phase 1 实现真 Agent.Writer / Reviewer / Planner / LongRunner 时替换。
  """
  @spec spawn_dummy(String.t(), String.t(), String.t()) :: {:ok, pid()} | {:error, term()}
  def spawn_dummy(workspace_id, author_id, agent_id)
      when is_binary(workspace_id) and is_binary(author_id) and is_binary(agent_id) do
    parent = via(workspace_id, author_id)
    spec = {Agent.Dummy, {workspace_id, author_id, agent_id}}

    case DynamicSupervisor.start_child(parent, spec) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      other -> other
    end
  end
end
