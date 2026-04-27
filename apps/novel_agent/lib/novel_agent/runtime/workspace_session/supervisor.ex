defmodule NovelAgent.Runtime.WorkspaceSession.Supervisor do
  @moduledoc """
  Per-workspace supervisor。`:rest_for_one` —— Memory.Service 重启时其下所有 Author/Agent 也重启
  （依赖关系，权威定义 08-multi-agent.md §2.1）。

  当前阶段（Phase 0 Week 2）：Memory.Service / EventBus.Subscriber 尚未实现，仅放 Author.DynamicSupervisor。
  """

  use Supervisor

  alias NovelAgent.Runtime.AuthorSession, as: Author
  alias NovelAgent.Runtime.Registries

  def start_link(workspace_id) when is_binary(workspace_id) do
    Supervisor.start_link(__MODULE__, workspace_id, name: via(workspace_id))
  end

  def child_spec(workspace_id) do
    %{
      id: {__MODULE__, workspace_id},
      start: {__MODULE__, :start_link, [workspace_id]},
      type: :supervisor,
      restart: :temporary
    }
  end

  defp via(workspace_id), do: {:via, Registry, {Registries.Workspace, workspace_id}}

  @impl true
  def init(workspace_id) do
    children = [
      # Memory.Service / EventBus.Subscriber 留待后续 ADR 落地（Foundation §5 / Domain §27）。
      {Author.DynamicSupervisor, workspace_id}
    ]

    Supervisor.init(children, strategy: :rest_for_one)
  end
end
