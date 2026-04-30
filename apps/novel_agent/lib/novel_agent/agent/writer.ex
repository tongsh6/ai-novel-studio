defmodule NovelAgent.Agent.Writer do
  @moduledoc """
  Writer Agent — 文本生成角色。

  Phase 1：实现 Agent behaviour，使用 Provider 生成文本。
  """

  use GenServer

  @behaviour NovelAgent.Agent

  alias NovelAgent.Agent
  alias NovelAgent.Provider.Stub
  alias NovelAgent.Runtime.Registries
  alias NovelFoundation.Enums.AgentType

  defstruct [:agent_id, :workspace_id, :author_id]

  @type state :: %__MODULE__{
          agent_id: String.t(),
          workspace_id: String.t(),
          author_id: String.t()
        }

  # ---- GenServer lifecycle ----

  def start_link({workspace_id, author_id, agent_id}) do
    GenServer.start_link(__MODULE__, {workspace_id, author_id, agent_id},
      name: via(workspace_id, author_id, agent_id)
    )
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
     %__MODULE__{
       agent_id: agent_id,
       workspace_id: workspace_id,
       author_id: author_id
     }}
  end

  # ---- Agent behaviour callbacks ----

  @impl Agent
  def identity(server) do
    GenServer.call(server, :identity)
  end

  @impl Agent
  def handle_task(%{task_id: task_id, payload: payload}, server) do
    GenServer.call(server, {:handle_task, task_id, payload})
  end

  # ---- GenServer callbacks ----

  @impl true
  def handle_call(:identity, _from, state) do
    identity = %{
      agent_id: state.agent_id,
      agent_type: AgentType.writer(),
      workspace_id: state.workspace_id,
      author_id: state.author_id
    }

    {:reply, identity, state}
  end

  @impl true
  def handle_call({:handle_task, _task_id, payload}, _from, state) do
    prompt = Map.get(payload, "text") || Map.get(payload, :text, "")
    {:ok, %{content: content}} = Stub.complete(%Stub{}, "default", prompt)
    {:reply, {:ok, %{text: content}}, state}
  end
end
