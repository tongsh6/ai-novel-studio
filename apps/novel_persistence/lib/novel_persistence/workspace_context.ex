defmodule NovelPersistence.WorkspaceContext do
  @moduledoc """
  提供真实 persistence 层的 context fetcher 和 trace persister 回调。

  这些函数被注入到 NovelApplication，通过回调机制保持 umbrella 依赖方向：
  novel_web → novel_persistence → (callback) → novel_application
  """

  import Ecto.Query, only: [from: 2]

  alias NovelFoundation.Enums.StructureStatus
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.MemoryRecallRepo
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.ReadingProjectionRepo
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Interaction
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Work
  alias NovelPersistence.Schemas.WorkSession
  alias NovelPersistence.Schemas.Workspace
  alias NovelPersistence.TraceRepository
  alias NovelPersistence.WorkSessionRepo

  @archived_status StructureStatus.archived()
  @default_recent_conversation_interaction_limit 10
  @session_summary_sample_limit 6

  @doc """
  构建 context fetcher 回调。该回调从 DB 读取当前 workspace 信息和最近的对话。

  返回 (workspace_id -> {:ok, snapshot, conv_summary, mem_summary, behavior_summary, chapters})。
  末位 chapters 是当前作品已采纳章节标题（供 Planner 解析续写/重写目标章）。
  """
  @spec context_fetcher() :: function()
  def context_fetcher do
    fn workspace_id ->
      snapshot = fetch_workspace_info(workspace_id)
      conv_summary = fetch_conversation_summary(workspace_id)

      {:ok, snapshot, conv_summary, fetch_memory_summary(workspace_id, nil), nil,
       fetch_accepted_chapters(workspace_id)}
    end
  end

  @doc """
  构建带作者输入的 context fetcher 回调，用于当前 turn 的相关记忆召回。

  返回 (workspace_id, author_text, session_id -> {:ok, snapshot, conv_summary, mem_summary, behavior_summary, chapters})。
  """
  @spec context_fetcher_with_query() :: function()
  def context_fetcher_with_query do
    fn workspace_id, author_text, session_id ->
      snapshot = fetch_workspace_info(workspace_id)
      conv_summary = fetch_conversation_summary(workspace_id, session_id)

      {:ok, snapshot, conv_summary, fetch_memory_summary(workspace_id, author_text), nil,
       fetch_accepted_chapters(workspace_id)}
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
          work -> work_snapshot(work)
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

  # 已采纳章节标题（按卷/章顺序），供 Planner 解析续写/重写的目标章。
  # 复用阅读投影 TOC：只含已采纳正文章节，tentative 不计，与采纳层章节身份口径一致。
  defp fetch_accepted_chapters(workspace_id) when is_binary(workspace_id) do
    workspace_id
    |> ReadingProjectionRepo.toc()
    |> Map.get(:volumes, [])
    |> Enum.flat_map(&Map.get(&1, :chapters, []))
    |> Enum.map(&Map.get(&1, :title))
    |> Enum.reject(&(is_nil(&1) or &1 == ""))
  end

  defp fetch_accepted_chapters(_workspace_id), do: []

  defp fetch_conversation_summary(workspace_id) do
    limit = recent_conversation_interaction_limit()

    interactions =
      from(i in Interaction,
        left_join: s in WorkSession,
        on: i.session_id == s.id,
        where: i.workspace_id == ^workspace_id,
        where: is_nil(i.session_id) or s.status != ^@archived_status,
        order_by: [desc: i.inserted_at],
        limit: ^limit
      )
      |> Repo.all()

    interactions
    |> Enum.reverse()
    |> conversation_summary()
  end

  defp fetch_conversation_summary(workspace_id, session_id)
       when is_binary(session_id) and session_id != "" do
    limit = recent_conversation_interaction_limit()

    case fetch_active_session(workspace_id, session_id) do
      nil ->
        nil

      %WorkSession{} = session ->
        session
        |> maybe_refresh_session_summary(limit)
        |> session_conversation_summary(limit)
    end
  end

  defp fetch_conversation_summary(workspace_id, _session_id),
    do: fetch_conversation_summary(workspace_id)

  defp fetch_active_session(workspace_id, session_id) do
    from(s in WorkSession,
      where: s.work_id == ^workspace_id and s.id == ^session_id and s.status != ^@archived_status,
      limit: 1
    )
    |> Repo.one()
  end

  defp session_conversation_summary(%WorkSession{} = session, limit) do
    recent =
      from(i in Interaction,
        where: i.workspace_id == ^session.work_id and i.session_id == ^session.id,
        order_by: [desc: i.inserted_at, desc: i.id],
        limit: ^limit
      )
      |> Repo.all()
      |> Enum.reverse()

    [session_summary_as_message(session.summary), conversation_summary(recent)]
    |> Enum.reject(&is_nil/1)
    |> Enum.join("\n")
    |> blank_to_nil()
  end

  defp maybe_refresh_session_summary(%WorkSession{status: status} = session, _limit)
       when status == @archived_status,
       do: session

  defp maybe_refresh_session_summary(%WorkSession{} = session, limit) do
    total = session_interaction_count(session)

    summary =
      if total > limit do
        older_count = total - limit

        older_interactions =
          oldest_session_interactions(session, min(older_count, @session_summary_sample_limit))

        build_session_summary(older_count, older_interactions)
      end

    if normalize_blank(session.summary) == normalize_blank(summary) do
      session
    else
      case WorkSessionRepo.update_summary(session, summary) do
        {:ok, updated} -> updated
        {:error, _reason} -> %{session | summary: summary}
      end
    end
  end

  defp session_interaction_count(%WorkSession{} = session) do
    from(i in Interaction,
      where: i.workspace_id == ^session.work_id and i.session_id == ^session.id
    )
    |> Repo.aggregate(:count)
  end

  defp oldest_session_interactions(%WorkSession{} = session, limit) do
    from(i in Interaction,
      where: i.workspace_id == ^session.work_id and i.session_id == ^session.id,
      order_by: [asc: i.inserted_at, asc: i.id],
      limit: ^limit
    )
    |> Repo.all()
  end

  defp work_snapshot(%Work{} = work) do
    %{
      id: work.id,
      title: work.title,
      genre: work.genre,
      core_selling_point: work.core_selling_point,
      target_reader: work.target_reader,
      tone_preference: work.tone_preference,
      revision: work.revision,
      updated_at: datetime_to_iso8601(work.updated_at)
    }
    |> Enum.reject(fn {_key, value} -> is_nil(value) or value == "" end)
    |> Map.new()
  end

  defp recent_conversation_interaction_limit do
    Application.get_env(
      :novel_persistence,
      :conversation_summary_interaction_limit,
      @default_recent_conversation_interaction_limit
    )
  end

  defp conversation_summary([]), do: nil

  defp conversation_summary(interactions) do
    Enum.map_join(interactions, "\n", fn i -> "#{i.role}: #{interaction_text(i)}" end)
  end

  defp datetime_to_iso8601(%DateTime{} = datetime), do: DateTime.to_iso8601(datetime)
  defp datetime_to_iso8601(_), do: nil

  defp interaction_text(%Interaction{content: content}) when is_map(content) do
    Map.get(content, "text") || Map.get(content, :text) || ""
  end

  defp build_session_summary(older_count, interactions) do
    samples =
      interactions
      |> Enum.map(&summary_fragment/1)
      |> Enum.reject(&is_nil/1)

    cond do
      older_count <= 0 ->
        nil

      samples == [] ->
        "会话早期摘要：#{older_count} 条较早消息已压缩。"

      older_count > length(samples) ->
        "会话早期摘要：#{Enum.join(samples, "；")}；另有 #{older_count - length(samples)} 条较早消息已压缩。"

      true ->
        "会话早期摘要：#{Enum.join(samples, "；")}。"
    end
  end

  defp summary_fragment(%Interaction{role: "user"} = interaction) do
    if text = summary_text(interaction), do: "作者提到「#{text}」"
  end

  defp summary_fragment(%Interaction{role: "assistant"} = interaction) do
    if text = summary_text(interaction), do: "AI 回应「#{text}」"
  end

  defp summary_fragment(%Interaction{} = interaction), do: summary_text(interaction)

  defp summary_text(%Interaction{} = interaction) do
    interaction
    |> interaction_text()
    |> normalize_summary_text()
  end

  defp normalize_summary_text(value) do
    value
    |> to_string()
    |> String.replace(~r/\s+/, " ")
    |> String.trim()
    |> String.slice(0, 48)
    |> blank_to_nil()
  end

  defp session_summary_as_message(summary) do
    case normalize_blank(summary) do
      nil -> nil
      text -> text
    end
  end

  defp normalize_blank(value) when is_binary(value) do
    value
    |> String.trim()
    |> blank_to_nil()
  end

  defp normalize_blank(_), do: nil

  defp blank_to_nil(""), do: nil
  defp blank_to_nil(value), do: value

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
