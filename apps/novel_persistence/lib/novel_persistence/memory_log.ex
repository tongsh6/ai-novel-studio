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

  @doc "查询 session 下完整 transcript，按写入顺序返回。"
  @spec transcript(String.t()) :: [Interaction.t()]
  def transcript(session_id) do
    Interaction
    |> where([i], i.session_id == ^session_id)
    |> order_by([i], asc: i.inserted_at, asc: i.id)
    |> Repo.all()
  end

  @doc """
  查询 session transcript 的一页消息。

  返回值始终按写入顺序排列。`before_id` 是当前已加载最早 interaction 的 id；
  传入后会返回它之前的一页更早消息，并校验 cursor 属于同一 session。
  """
  @spec transcript_page(String.t(), keyword()) ::
          {:ok, map()} | {:error, :cursor_not_found}
  def transcript_page(session_id, opts \\ []) when is_binary(session_id) and is_list(opts) do
    page_limit = opts |> Keyword.get(:limit, 30) |> normalize_limit()
    fetch_size = page_limit + 1
    before_id = Keyword.get(opts, :before_id)

    with {:ok, query} <- transcript_page_query(session_id, before_id) do
      rows =
        query
        |> order_by([i], desc: i.inserted_at, desc: i.id)
        |> limit(^fetch_size)
        |> Repo.all()

      entries =
        rows
        |> Enum.take(page_limit)
        |> Enum.reverse()

      {:ok,
       %{
         entries: entries,
         limit: page_limit,
         returned_count: length(entries),
         has_more_before: length(rows) > page_limit,
         before_id: entries |> List.first() |> interaction_id(),
         after_id: entries |> List.last() |> interaction_id()
       }}
    end
  end

  @doc "将 retention_tier 降级（hot → warm → cold）。"
  @spec downgrade(String.t(), String.t(), String.t()) :: {integer(), nil}
  def downgrade(workspace_id, from_tier, to_tier) do
    Interaction
    |> where([i], i.workspace_id == ^workspace_id and i.retention_tier == ^from_tier)
    |> Repo.update_all(set: [retention_tier: to_tier])
  end

  defp transcript_page_query(session_id, nil) do
    {:ok, where(Interaction, [i], i.session_id == ^session_id)}
  end

  defp transcript_page_query(session_id, "") do
    transcript_page_query(session_id, nil)
  end

  defp transcript_page_query(session_id, before_id) when is_binary(before_id) do
    case Repo.get_by(Interaction, id: before_id, session_id: session_id) do
      nil ->
        {:error, :cursor_not_found}

      %Interaction{} = cursor ->
        {:ok,
         Interaction
         |> where([i], i.session_id == ^session_id)
         |> where(
           [i],
           i.inserted_at < ^cursor.inserted_at or
             (i.inserted_at == ^cursor.inserted_at and i.id < ^cursor.id)
         )}
    end
  end

  defp transcript_page_query(_session_id, _before_id), do: {:error, :cursor_not_found}

  defp normalize_limit(limit) when is_integer(limit) and limit > 0, do: min(limit, 100)

  defp normalize_limit(limit) when is_binary(limit) do
    case Integer.parse(limit) do
      {value, ""} -> normalize_limit(value)
      _ -> 30
    end
  end

  defp normalize_limit(_limit), do: 30

  defp interaction_id(%Interaction{id: id}), do: id
  defp interaction_id(_), do: nil
end
