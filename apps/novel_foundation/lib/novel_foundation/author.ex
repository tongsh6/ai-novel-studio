defmodule NovelFoundation.Author do
  @moduledoc """
  Author 子树查询入口。
  """

  alias NovelFoundation.Registries

  @spec whereis(String.t(), String.t()) :: pid() | nil
  def whereis(workspace_id, author_id)
      when is_binary(workspace_id) and is_binary(author_id) do
    case Registry.lookup(Registries.Author, {workspace_id, author_id}) do
      [{pid, _}] -> pid
      [] -> nil
    end
  end

  @spec list(String.t()) :: [String.t()]
  def list(workspace_id) when is_binary(workspace_id) do
    pattern = {{workspace_id, :"$1"}, :_, :_}
    Registry.select(Registries.Author, [{pattern, [], [:"$1"]}])
  end
end
