defmodule NovelAgent.Runtime.AuthorSession.Supervisor do
  @moduledoc """
  Per-author supervisor。`:rest_for_one` —— Orchestrator 重启时其下子 Agent 也重启（依赖关系）。

  当前阶段（Phase 0 Week 2）：Agent.Orchestrator 尚未实现，仅放 Agent.Children.DynamicSupervisor。
  """

  use Supervisor

  alias NovelAgent.Runtime.Agent, as: Agent
  alias NovelAgent.Runtime.Registries

  def start_link({workspace_id, author_id}) do
    Supervisor.start_link(__MODULE__, {workspace_id, author_id},
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
    do: {:via, Registry, {Registries.Author, {workspace_id, author_id}}}

  @impl true
  def init({workspace_id, author_id}) do
    children = [
      # Agent.Orchestrator 留待 Phase 1（capability + intent registry 落地之后）。
      {Agent.Children.DynamicSupervisor, {workspace_id, author_id}}
    ]

    Supervisor.init(children, strategy: :rest_for_one)
  end
end
