defmodule NovelPersistence.MemoryLog do
  @moduledoc """
  Memory Log — warm/cold tier 持久化。

  将 interaction 写入 DB，支持按 workspace / turn 检索。
  """

  import Ecto.Query, only: [where: 3, order_by: 3, limit: 2]

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Interaction

  @doc "写入一条 interaction 到 DB。"
  @spec record(map()) :: {:ok, Interaction.t()} | {:error, Ecto.Changeset.t()}
  def record(attrs) when is_map(attrs) do
    %Interaction{}
    |> Interaction.changeset(attrs)
    |> Repo.insert()
  end

  @doc "查询 workspace 下最近 N 条 interaction。"
  @spec recent(String.t(), pos_integer()) :: [Interaction.t()]
  def recent(workspace_id, n \\ 20) do
    Interaction
    |> where([i], i.workspace_id == ^workspace_id)
    |> order_by([i], desc: i.inserted_at)
    |> limit(^n)
    |> Repo.all()
  end

  @doc "将 retention_tier 降级（hot → warm → cold）。"
  @spec downgrade(String.t(), String.t(), String.t()) :: {integer(), nil}
  def downgrade(workspace_id, from_tier, to_tier) do
    Interaction
    |> where([i], i.workspace_id == ^workspace_id and i.retention_tier == ^from_tier)
    |> Repo.update_all(set: [retention_tier: to_tier])
  end
end
