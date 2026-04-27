defmodule NovelAgent.Runtime.AuthorSession.DynamicSupervisor do
  @moduledoc """
  单 workspace 下的多 author session 根。`:one_for_one` —— 一个 author crash 不影响别的。
  """

  use DynamicSupervisor

  alias NovelAgent.Runtime.AuthorSession, as: Author
  alias NovelAgent.Runtime.Registries

  def start_link(workspace_id) when is_binary(workspace_id) do
    DynamicSupervisor.start_link(__MODULE__, workspace_id, name: via(workspace_id))
  end

  def child_spec(workspace_id) do
    %{
      id: {__MODULE__, workspace_id},
      start: {__MODULE__, :start_link, [workspace_id]},
      type: :supervisor,
      restart: :temporary
    }
  end

  defp via(workspace_id),
    do: {:via, Registry, {Registries.AuthorDyn, workspace_id}}

  @impl true
  def init(_workspace_id) do
    DynamicSupervisor.init(strategy: :one_for_one)
  end

  @doc """
  动态启动一个 author session 子树。

  幂等：同 (workspace_id, author_id) 二次启动返回已存在的 Supervisor pid。
  """
  @spec start_author(String.t(), String.t()) :: {:ok, pid()} | {:error, term()}
  def start_author(workspace_id, author_id)
      when is_binary(workspace_id) and is_binary(author_id) do
    parent = via(workspace_id)
    spec = {Author.Supervisor, {workspace_id, author_id}}

    case DynamicSupervisor.start_child(parent, spec) do
      {:ok, pid} -> {:ok, pid}
      {:error, {:already_started, pid}} -> {:ok, pid}
      other -> other
    end
  end

  @spec stop_author(String.t(), String.t()) :: :ok | {:error, :not_found}
  def stop_author(workspace_id, author_id) do
    case Author.whereis(workspace_id, author_id) do
      nil ->
        {:error, :not_found}

      pid ->
        DynamicSupervisor.terminate_child(via(workspace_id), pid)
    end
  end
end
