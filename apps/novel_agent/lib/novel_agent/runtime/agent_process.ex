defmodule NovelAgent.Runtime.AgentProcess do
  @moduledoc """
  Agent 子树查询入口。
  """

  alias NovelAgent.Runtime.Registries

  @spec whereis(String.t(), String.t(), String.t()) :: pid() | nil
  def whereis(workspace_id, author_id, agent_id)
      when is_binary(workspace_id) and is_binary(author_id) and is_binary(agent_id) do
    case Registry.lookup(Registries.Agent, {workspace_id, author_id, agent_id}) do
      [{pid, _}] -> pid
      [] -> nil
    end
  end

  @spec list(String.t(), String.t()) :: [String.t()]
  def list(workspace_id, author_id) do
    pattern = {{workspace_id, author_id, :"$1"}, :_, :_}
    Registry.select(Registries.Agent, [{pattern, [], [:"$1"]}])
  end
end
