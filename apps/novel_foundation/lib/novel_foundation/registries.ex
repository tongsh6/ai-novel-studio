defmodule NovelFoundation.Registries do
  @moduledoc """
  集中声明 supervision tree 三层使用的 Registry name，避免散落。

  - `Workspace` —— key: workspace_id (String.t)
  - `AuthorDyn` —— key: workspace_id（Author.DynamicSupervisor 的 via name）
  - `Author` —— key: {workspace_id, author_id}
  - `AgentChildrenDyn` —— key: {workspace_id, author_id}
  - `Agent` —— key: {workspace_id, author_id, agent_id}

  全部走 `:unique`。
  """

  @type t :: module()

  def workspace, do: __MODULE__.Workspace
  def author_dyn, do: __MODULE__.AuthorDyn
  def author, do: __MODULE__.Author
  def agent_children_dyn, do: __MODULE__.AgentChildrenDyn
  def agent, do: __MODULE__.Agent

  @doc false
  def child_specs do
    [
      {Registry, keys: :unique, name: __MODULE__.Workspace},
      {Registry, keys: :unique, name: __MODULE__.AuthorDyn},
      {Registry, keys: :unique, name: __MODULE__.Author},
      {Registry, keys: :unique, name: __MODULE__.AgentChildrenDyn},
      {Registry, keys: :unique, name: __MODULE__.Agent}
    ]
  end
end
