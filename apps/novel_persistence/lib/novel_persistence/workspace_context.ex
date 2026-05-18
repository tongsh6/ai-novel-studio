defmodule NovelPersistence.WorkspaceContext do
  @moduledoc """
  提供真实 persistence 层的 context fetcher 和 trace persister 回调。

  这些函数被注入到 NovelApplication，通过回调机制保持 umbrella 依赖方向：
  novel_web → novel_persistence → (callback) → novel_application
  """

  import Ecto.Query, only: [from: 2]

  alias NovelPersistence.MemoryLog
  alias NovelPersistence.MemoryRecallRepo
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Interaction
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Work
  alias NovelPersistence.Schemas.Workspace
  alias NovelPersistence.TraceRepository

  @doc """
  构建 context fetcher 回调。该回调从 DB 读取当前 workspace 信息和最近的对话。

  返回 (workspace_id -> {:ok, snapshot, conv_summary, mem_summary, behavior_summary})。
  """
  @spec context_fetcher() :: function()
  def context_fetcher do
    fn workspace_id ->
      snapshot = fetch_workspace_info(workspace_id)
      conv_summary = fetch_conversation_summary(workspace_id)
      {:ok, snapshot, conv_summary, fetch_memory_summary(workspace_id, nil), nil}
    end
  end

  @doc """
  构建带作者输入的 context fetcher 回调，用于当前 turn 的相关记忆召回。

  返回 (workspace_id, author_text -> {:ok, snapshot, conv_summary, mem_summary, behavior_summary})。
  """
  @spec context_fetcher_with_query() :: function()
  def context_fetcher_with_query do
    fn workspace_id, author_text ->
      snapshot = fetch_workspace_info(workspace_id)
      conv_summary = fetch_conversation_summary(workspace_id)
      {:ok, snapshot, conv_summary, fetch_memory_summary(workspace_id, author_text), nil}
    end
  end

  @doc """
  构建 trace persister 回调。该回调将 DecisionTrace attrs 写入 DB。
  """
  @spec trace_persister() :: function()
  def trace_persister do
    fn workspace_id, attrs ->
      attrs = Map.put(attrs, :workspace_id, workspace_id)

      case TraceRepository.insert(attrs) do
        {:ok, _record} -> :ok
        {:error, reason} -> {:error, reason}
      end
    end
  end

  @doc """
  构建 interaction recorder 回调。该回调将一轮对话中的 user / assistant
  消息写入 episodic memory，用于后续 turn 的 conversation_summary。
  """
  @spec interaction_recorder() :: function()
  def interaction_recorder do
    fn workspace_id, entries ->
      entries
      |> Enum.map(&Map.put(&1, :workspace_id, workspace_id))
      |> Enum.reduce_while(:ok, &persist_interaction/2)
    end
  end

  # ── private fetchers ─────────────────────────────

  defp fetch_workspace_info(workspace_id) do
    case Ecto.UUID.cast(workspace_id) do
      {:ok, uuid} ->
        case Repo.get(Work, uuid) do
          nil -> nil
          work -> %{id: work.id, title: work.title, genre: work.genre}
        end

      :error ->
        # Legacy workspace_id in channel = workspace.name in DB.
        ws =
          from(w in Workspace, where: w.name == ^workspace_id, limit: 1)
          |> Repo.one()

        if ws do
          %{name: ws.name, description: ws.description}
        end
    end
  end

  defp fetch_conversation_summary(workspace_id) do
    interactions =
      from(i in Interaction,
        where: i.workspace_id == ^workspace_id,
        order_by: [desc: i.inserted_at],
        limit: 10
      )
      |> Repo.all()

    if interactions != [] do
      snippets =
        interactions
        |> Enum.reverse()
        |> Enum.map_join("\n", fn i -> "#{i.role}: #{interaction_text(i)}" end)

      snippets
    end
  end

  defp interaction_text(%Interaction{content: content}) when is_map(content) do
    Map.get(content, "text") || Map.get(content, :text) || ""
  end

  defp fetch_memory_summary(workspace_id, author_text) do
    memories = MemoryRecallRepo.recall(workspace_id, author_text)

    if memories != [] do
      record_memory_references(workspace_id, memories, author_text)
    end

    MemoryRecallRepo.summary(memories)
  end

  defp record_memory_references(workspace_id, memories, author_text) do
    entries =
      Enum.map(memories, fn memory ->
        %{
          memory_id: memory.id,
          work_id: workspace_id,
          reference_scene: "dialogue_context",
          reference_reason: reference_reason(author_text)
        }
      end)

    _ = MemoryReferenceLog.batch_write(entries)

    memory_ids = Enum.map(memories, & &1.id)
    now = DateTime.utc_now()

    from(m in MemoryItem, where: m.id in ^memory_ids)
    |> Repo.update_all(inc: [reference_count: 1], set: [last_referenced_at: now])

    :ok
  end

  defp reference_reason(author_text) when is_binary(author_text) and author_text != "" do
    "dialogue recall matched author input: #{String.slice(author_text, 0, 80)}"
  end

  defp reference_reason(_), do: "dialogue context recall"

  defp persist_interaction(attrs, :ok) do
    case MemoryLog.record(attrs) do
      {:ok, _interaction} -> {:cont, :ok}
      {:error, reason} -> {:halt, {:error, reason}}
    end
  end
end
