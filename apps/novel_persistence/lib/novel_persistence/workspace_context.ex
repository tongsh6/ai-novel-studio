defmodule NovelPersistence.WorkspaceContext do
  @moduledoc """
  提供真实 persistence 层的 context fetcher 和 trace persister 回调。

  这些函数被注入到 NovelApplication，通过回调机制保持 umbrella 依赖方向：
  novel_web → novel_persistence → (callback) → novel_application
  """

  import Ecto.Query, only: [from: 2]

  alias NovelFoundation.Enums.StructureStatus
  alias NovelPersistence.ChapterSummaryRepo
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

  返回 (workspace_id -> {:ok, snapshot, conv_summary, mem_summary, behavior_summary, chapters, structured_chapters})。
  chapters 是当前作品已采纳章节标题（供 Planner 解析续写/重写目标章）；structured_chapters
  是 VS-00C CP3 的 tool 侧结构对象（标题、顺序、计划摘要、是否已有正文）。
  """
  @spec context_fetcher() :: function()
  def context_fetcher do
    fn workspace_id ->
      snapshot = fetch_workspace_info(workspace_id)
      conv_summary = fetch_conversation_summary(workspace_id)

      structured_chapters = fetch_structured_chapters(workspace_id)

      {:ok, snapshot, conv_summary, fetch_memory_summary(workspace_id, nil),
       fetch_behavior_summary(workspace_id), titles_from_structured_chapters(structured_chapters),
       structured_chapters}
    end
  end

  @doc """
  构建带作者输入的 context fetcher 回调，用于当前 turn 的相关记忆召回。

  返回 (workspace_id, author_text, session_id ->
    {:ok, snapshot, conv_summary, mem_summary, behavior_summary, chapters, structured_chapters})。
  """
  @spec context_fetcher_with_query() :: function()
  def context_fetcher_with_query do
    fn workspace_id, author_text, session_id ->
      snapshot = fetch_workspace_info(workspace_id)
      conv_summary = fetch_conversation_summary(workspace_id, session_id)

      structured_chapters = fetch_structured_chapters(workspace_id)

      {:ok, snapshot, conv_summary, fetch_memory_summary(workspace_id, author_text),
       fetch_behavior_summary(workspace_id, session_id),
       titles_from_structured_chapters(structured_chapters), structured_chapters}
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

  # VS-00C CP3：结构化章节条目（按卷/章顺序），供 prose_writing L2 注入目标章计划摘要与卷内位置。
  # 复用阅读投影 TOC：结构章即使尚无正文也会出现，has_prose 用 word_count 判断。
  defp fetch_structured_chapters(workspace_id) when is_binary(workspace_id) do
    workspace_id
    |> ReadingProjectionRepo.toc()
    |> Map.get(:volumes, [])
    |> Enum.flat_map(&Map.get(&1, :chapters, []))
    |> Enum.map(&structured_chapter_entry/1)
    |> Enum.reject(&is_nil/1)
  end

  defp fetch_structured_chapters(_workspace_id), do: []

  defp structured_chapter_entry(chapter) when is_map(chapter) do
    title = chapter |> Map.get(:title) |> normalize_title()

    if title == "" do
      nil
    else
      %{
        title: title,
        seq: Map.get(chapter, :seq),
        summary: chapter |> Map.get(:summary) |> normalize_title(),
        plan_direction: Map.get(chapter, :plan_direction),
        has_prose: Map.get(chapter, :word_count, 0) > 0
      }
    end
  end

  defp structured_chapter_entry(_chapter), do: nil

  defp titles_from_structured_chapters(chapters), do: Enum.map(chapters, & &1.title)

  defp normalize_title(value) when is_binary(value), do: String.trim(value)
  defp normalize_title(_), do: ""

  @doc """
  章节标题 reader port：`(work_id) -> 当前作品章节全名列表（含已规划但还没写正文的章）`。

  供 AgentRun 规划期（AgenticPlanDraftPlanner）注入「作品章节」段：target_chapter 契约
  要求模型从该列表精确复制全名，列表必须由应用层确定性提供（机械准备，不问模型）。
  与 context fetcher 的 chapters 同源（reading projection toc）。
  """
  @spec chapter_titles_reader() :: (String.t() -> [String.t()])
  def chapter_titles_reader do
    fn work_id ->
      work_id
      |> fetch_structured_chapters()
      |> titles_from_structured_chapters()
    end
  end

  @doc """
  章摘要 reader port（VS-00C CP2.2）。返回 `by_title` / `previous` 两个能力，供
  TurnExecutionService 做 L5（截断前文以本章摘要兜底）与 L3a（注入目标章之前最近 N 章摘要的实现态连续性窗口）。

  title↔chapter_id 在应用层用 toc 索引 Map 解析（不做跨类型 DB join，与 work_id `:string`
  口径一致）。注入机制同 `chapter_prose_reader`：novel_web → novel_persistence →（callback）。
  """
  @spec chapter_summary_reader() :: %{
          by_title: (String.t(), String.t() -> String.t() | nil),
          previous: (String.t(), String.t(), pos_integer() ->
                       [%{chapter_title: String.t(), summary_text: String.t()}])
        }
  def chapter_summary_reader do
    %{by_title: &accepted_summary_by_title/2, previous: &previous_accepted_summaries/3}
  end

  defp accepted_summary_by_title(work_id, title) when is_binary(work_id) and is_binary(title) do
    with chapter_id when is_binary(chapter_id) <- chapter_id_for_title(work_id, title),
         %{summary_text: text} <- ChapterSummaryRepo.current_accepted(work_id, chapter_id) do
      text
    else
      _ -> nil
    end
  end

  defp accepted_summary_by_title(_work_id, _title), do: nil

  defp previous_accepted_summaries(work_id, target_title, n)
       when is_binary(work_id) and is_binary(target_title) and is_integer(n) and n > 0 do
    entries = chapter_entries(work_id)

    entries
    |> Enum.take_while(&(Map.get(&1, :title) != target_title))
    |> Enum.take(-n)
    |> Enum.map(&summary_for_entry(work_id, &1))
    |> Enum.reject(&is_nil/1)
  end

  defp previous_accepted_summaries(_work_id, _target_title, _n), do: []

  defp chapter_id_for_title(work_id, title) do
    work_id
    |> chapter_entries()
    |> Enum.find_value(fn ch -> if Map.get(ch, :title) == title, do: Map.get(ch, :id) end)
  end

  defp summary_for_entry(work_id, %{id: chapter_id, title: title})
       when is_binary(chapter_id) and is_binary(title) do
    case ChapterSummaryRepo.current_accepted(work_id, chapter_id) do
      %{summary_text: text} when is_binary(text) and text != "" ->
        %{chapter_title: title, summary_text: text}

      _ ->
        nil
    end
  end

  defp summary_for_entry(_work_id, _entry), do: nil

  defp chapter_entries(workspace_id) when is_binary(workspace_id) do
    workspace_id
    |> ReadingProjectionRepo.toc()
    |> Map.get(:volumes, [])
    |> Enum.flat_map(&Map.get(&1, :chapters, []))
  end

  defp chapter_entries(_workspace_id), do: []

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

  defp fetch_behavior_summary(workspace_id), do: fetch_behavior_summary(workspace_id, nil)

  defp fetch_behavior_summary(workspace_id, session_id)
       when is_binary(session_id) and session_id != "" do
    from(i in Interaction,
      join: s in WorkSession,
      on: i.session_id == s.id,
      where:
        i.workspace_id == ^workspace_id and i.session_id == ^session_id and
          s.status != ^@archived_status and i.role == "assistant",
      order_by: [desc: i.inserted_at, desc: i.id],
      limit: 1
    )
    |> Repo.one()
    |> latest_active_behavior_summary()
  end

  defp fetch_behavior_summary(workspace_id, _session_id) do
    from(i in Interaction,
      left_join: s in WorkSession,
      on: i.session_id == s.id,
      where:
        i.workspace_id == ^workspace_id and i.role == "assistant" and
          (is_nil(i.session_id) or s.status != ^@archived_status),
      order_by: [desc: i.inserted_at, desc: i.id],
      limit: 1
    )
    |> Repo.one()
    |> latest_active_behavior_summary()
  end

  defp latest_active_behavior_summary(%Interaction{content: content}) when is_map(content) do
    content
    |> map_field(:turn_result)
    |> map_field(:behavior_state)
    |> map_field(:active)
    |> active_behavior_summary()
  end

  defp latest_active_behavior_summary(_interaction), do: nil

  defp active_behavior_summary(active) when is_map(active) do
    behavior_type = active |> map_field(:behavior_type) |> normalize_behavior_token()
    target_label = active |> map_field(:target_ref) |> behavior_target_label()

    case behavior_type do
      "confirmation" ->
        "当前有待作者确认的操作#{target_label}；确认或取消前不能执行工具或写入作品事实。"

      "clarification" ->
        "当前有待作者补充信息的追问；收到回答前不能继续执行。"

      "recovery" ->
        "当前有待作者处理的恢复步骤；完成前不要假设系统已继续执行。"

      nil ->
        nil

      _ ->
        "当前有待作者处理的动作#{target_label}；收到下一步前不能视为已完成。"
    end
  end

  defp active_behavior_summary(_active), do: nil

  defp behavior_target_label(value) do
    case normalize_behavior_token(value) do
      "prose_writing" -> "：章节正文草稿"
      "world_building" -> "：作品设定"
      "outline" -> "：大纲"
      "candidate_direction" -> "：候选方向"
      _ -> ""
    end
  end

  defp normalize_behavior_token(value) when is_atom(value), do: Atom.to_string(value)

  defp normalize_behavior_token(value) when is_binary(value) do
    value
    |> String.trim()
    |> blank_to_nil()
  end

  defp normalize_behavior_token(_value), do: nil

  defp map_field(map, field) when is_map(map) do
    Map.get(map, field) || Map.get(map, to_string(field))
  end

  defp map_field(_map, _field), do: nil

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

  # 注意：不要把内部主键 id 放进 snapshot。snapshot 会被 DialogueContext.to_prompt_text
  # 原样 dump 进创作/Planner prompt，而 Work 的 UUID 对创作毫无意义；一旦进入 prompt，
  # 真实 provider 可能把它当成"符文/编号"织进正文（曾把 work id 写进第一章）。
  # 这里只暴露创作相关事实字段。
  defp work_snapshot(%Work{} = work) do
    %{
      title: work.title,
      genre: work.genre,
      core_selling_point: work.core_selling_point,
      premise: work.premise,
      theme: work.theme,
      main_goal: work.main_goal,
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
