defmodule NovelAgent.Runtime.Agent.Dummy do
  @moduledoc """
  占位 Agent。Phase 0 Week 2 T4 用于打通 supervision 三层 + 验证 crash isolation。
  Phase 1 真 Agent.Writer / Reviewer / Planner 落地后此模块作废。
  """

  use GenServer

  alias NovelAgent.Runtime.Registries

  defmodule State do
    @moduledoc false
    defstruct [:workspace_id, :author_id, :agent_id, :spawned_at]
  end

  def start_link({workspace_id, author_id, agent_id} = arg) do
    GenServer.start_link(__MODULE__, arg, name: via(workspace_id, author_id, agent_id))
  end

  def child_spec({workspace_id, author_id, agent_id} = arg) do
    %{
      id: {__MODULE__, workspace_id, author_id, agent_id},
      start: {__MODULE__, :start_link, [arg]},
      restart: :temporary
    }
  end

  defp via(workspace_id, author_id, agent_id),
    do: {:via, Registry, {Registries.Agent, {workspace_id, author_id, agent_id}}}

  @impl true
  def init({workspace_id, author_id, agent_id}) do
    {:ok,
     %State{
       workspace_id: workspace_id,
       author_id: author_id,
       agent_id: agent_id,
       spawned_at: DateTime.utc_now()
     }}
  end

  @impl true
  def handle_call(:state, _from, state), do: {:reply, state, state}

  @impl true
  def handle_call(:crash, _from, _state), do: raise("dummy agent crash test")
end
