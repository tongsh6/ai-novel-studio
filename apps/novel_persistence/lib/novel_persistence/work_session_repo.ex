defmodule NovelPersistence.WorkSessionRepo do
  @moduledoc """
  WorkSession 持久化入口。会话是作品下 transcript、搜索、恢复和只读历史的边界。
  """

  import Ecto.Query

  alias NovelFoundation.Enums.StructureStatus
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Interaction, WorkSession}

  @archived_status StructureStatus.archived()
  @active_status "ACTIVE"
  @exited_status "EXITED"

  @doc "Create a work session."
  @spec create(map()) :: {:ok, WorkSession.t()} | {:error, Ecto.Changeset.t()}
  def create(attrs) when is_map(attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> default_session_attrs()

    %WorkSession{}
    |> WorkSession.changeset(attrs)
    |> Repo.insert()
  end

  @doc "Create a new active session and mark existing active sessions in the same work as exited."
  @spec create_active(map()) :: {:ok, WorkSession.t()} | {:error, Ecto.Changeset.t() | term()}
  # dialyzer 误报（OTP 28 对不透明类型的 call_without_opaque）：Ecto.Multi 是不透明
  # 类型，Multi.new/0 的返回值直接管道喂给 Multi.update_all/4 会被判类型不匹配。
  # Ecto 自身也用 `@dialyzer :no_opaque` 关闭同类告警（deps/ecto/lib/ecto/repo/transaction.ex）。
  @dialyzer {:no_opaque, create_active: 1}
  def create_active(attrs) when is_map(attrs) do
    attrs =
      attrs
      |> stringify_keys()
      |> default_session_attrs()
      |> Map.put("status", @active_status)

    work_id = Map.get(attrs, "work_id")

    Ecto.Multi.new()
    |> Ecto.Multi.update_all(:exit_existing_active, active_sessions_query(work_id),
      set: [status: @exited_status, updated_at: DateTime.utc_now()]
    )
    |> Ecto.Multi.insert(:session, WorkSession.changeset(%WorkSession{}, attrs))
    |> Repo.transaction()
    |> case do
      {:ok, %{session: session}} -> {:ok, session}
      {:error, _step, reason, _changes} -> {:error, reason}
    end
  end

  @doc "Return the newest active session for a work, creating one when missing."
  @spec ensure_active_for_work(String.t()) ::
          {:ok, WorkSession.t()} | {:error, Ecto.Changeset.t()}
  def ensure_active_for_work(work_id) when is_binary(work_id) do
    case latest_active(work_id) do
      nil -> create(%{work_id: work_id, title: "默认会话"})
      %WorkSession{} = session -> keep_only_active(session)
    end
  end

  @doc "Mark one session as the active session for its work and exit other active sessions."
  @spec activate(String.t(), String.t()) ::
          {:ok, WorkSession.t()}
          | {:error, :session_not_found | :cannot_activate_archived_session | term()}
  def activate(work_id, session_id) when is_binary(work_id) and is_binary(session_id) do
    case get_by_work(work_id, session_id) do
      nil -> {:error, :session_not_found}
      %WorkSession{status: @archived_status} -> {:error, :cannot_activate_archived_session}
      %WorkSession{} = session -> keep_only_active(session)
    end
  end

  @doc "List sessions for one work newest-first. Archived sessions are hidden by default."
  @spec list_by_work(String.t(), keyword()) :: [WorkSession.t()]
  def list_by_work(work_id, opts \\ []) when is_binary(work_id) do
    include_archived? = Keyword.get(opts, :include_archived, false)

    WorkSession
    |> where([s], s.work_id == ^work_id)
    |> maybe_exclude_archived(include_archived?)
    |> order_by([s], desc: s.last_opened_at, desc: s.updated_at)
    |> Repo.all()
  end

  @doc "Get one session scoped to a work."
  @spec get_by_work(String.t(), String.t()) :: WorkSession.t() | nil
  def get_by_work(work_id, session_id) when is_binary(work_id) and is_binary(session_id) do
    WorkSession
    |> where([s], s.work_id == ^work_id and s.id == ^session_id)
    |> Repo.one()
  end

  @doc "Search session title, summary, and transcript inside a work."
  @spec search(String.t(), String.t()) :: [WorkSession.t()]
  def search(work_id, query) when is_binary(work_id) and is_binary(query) do
    needle = query |> String.trim() |> String.downcase()

    if needle == "" do
      list_by_work(work_id)
    else
      work_id
      |> list_by_work(include_archived: true)
      |> Enum.filter(fn session ->
        session_matches?(session, needle) or transcript_matches?(session.id, needle)
      end)
    end
  end

  @doc """
  AU03-SEARCH：work 内 turn 级只读搜索命中（不新建全文平台）。
  query 去空白/大小写后对 user/assistant 文本做子串匹配；结果按更新时间倒序，
  `opts[:limit]` 上限 50；空 query 返回 []。
  """
  @spec search_hits(String.t(), String.t(), keyword()) :: [map()]
  def search_hits(work_id, query, opts \\ []) when is_binary(work_id) and is_binary(query) do
    needle = query |> String.trim() |> String.downcase()
    limit = Keyword.get(opts, :limit, 50) |> min(50) |> max(1)

    if needle == "" do
      []
    else
      Interaction
      |> where([i], i.workspace_id == ^work_id and i.role in ["user", "assistant"])
      |> order_by([i], desc: i.updated_at, desc: i.inserted_at)
      |> Repo.all()
      |> Enum.flat_map(&search_hit_for_row(&1, needle, limit))
      |> Enum.take(limit)
    end
  end

  defp search_hit_for_row(row, needle, limit) do
    text = hit_text(row)

    case :binary.match(String.downcase(text), needle) do
      {offset, _len} -> [hit(row, text, offset, limit)]
      :nomatch -> []
    end
  end

  defp hit_text(row) do
    case row.content do
      %{"text" => text} when is_binary(text) -> text
      %{text: text} when is_binary(text) -> text
      _ -> ""
    end
  end

  defp hit(row, text, offset, _limit) do
    start = max(offset - 40, 0)
    snippet = text |> String.slice(start, 120) |> String.trim()

    %{
      session_id: row.session_id,
      turn_id: row.turn_id,
      role: row.role,
      snippet: snippet,
      inserted_at: row.inserted_at
    }
  end

  @doc "Return full transcript for a session in insertion order."
  @spec transcript(String.t()) :: [NovelPersistence.Schemas.Interaction.t()]
  def transcript(session_id) when is_binary(session_id), do: MemoryLog.transcript(session_id)

  @doc "Return one transcript page for a session in insertion order."
  @spec transcript_page(String.t(), keyword()) :: {:ok, map()} | {:error, :cursor_not_found}
  def transcript_page(session_id, opts \\ []) when is_binary(session_id),
    do: MemoryLog.transcript_page(session_id, opts)

  @doc """
  按真实 work（以及可选 session）读取最后一处明确携带 `turn_result.behavior_state`
  的 assistant Interaction（VS-00L §16.13）。

  查询命中“字段明确存在”，而不是“最近一条 assistant”：后续普通回复没有该字段时
  不会遮住更早的明确快照。显式 session 精确匹配且排除归档；无 session 参数时保留
  旧 work-wide 只读兼容（仍排除归档），该结果不能用于新作者动作授权。
  """
  @spec latest_behavior_interaction(String.t(), String.t() | nil) ::
          NovelPersistence.Schemas.Interaction.t() | nil
  def latest_behavior_interaction(work_id, session_id \\ nil) when is_binary(work_id) do
    Interaction
    |> where([i], i.workspace_id == ^work_id and i.role == "assistant")
    |> where([i], fragment("json_type(?, '$.turn_result.behavior_state') IS NOT NULL", i.content))
    |> scope_behavior_session(session_id)
    |> order_by([i], desc: i.inserted_at, desc: i.id)
    |> limit(1)
    |> Repo.one()
    |> case do
      nil -> nil
      interaction -> MemoryLog.canonical_interaction(interaction)
    end
  end

  defp scope_behavior_session(query, session_id)
       when is_binary(session_id) and session_id != "" do
    from(i in query,
      join: s in WorkSession,
      on: i.session_id == s.id,
      where: i.session_id == ^session_id and s.status != ^@archived_status
    )
  end

  defp scope_behavior_session(query, _session_id) do
    from(i in query,
      left_join: s in WorkSession,
      on: i.session_id == s.id,
      where: is_nil(i.session_id) or s.status != ^@archived_status
    )
  end

  @doc "完整会话采纳投影；只读有采纳状态的回合，不受聊天分页或上下文窗口裁剪。"
  def adoption_state(work_id, session_id) do
    work_id
    |> adoption_rows(session_id)
    |> build_adoption_projection()
  end

  @doc """
  Work-wide 待处理工作箱读模型（B46）。复用 interactions 的 turn_result
  adoption_state，不新增 inbox 表；来源 session 随 pending 条目返回。
  """
  @spec adoption_inbox(String.t()) :: map()
  def adoption_inbox(work_id) do
    work_id
    |> adoption_rows(nil)
    |> build_adoption_projection()
  end

  defp adoption_rows(work_id, session_id) do
    query =
      Interaction
      |> where([i], i.workspace_id == ^work_id and i.role == "assistant")
      |> where(
        [i],
        fragment("json_array_length(?, '$.turn_result.adoption_state.pending') > 0", i.content) or
          fragment("json_array_length(?, '$.turn_result.adoption_state.resolved') > 0", i.content)
      )

    query =
      if is_binary(session_id),
        do: where(query, [i], i.session_id == ^session_id),
        else: query

    query
    |> order_by([i], desc: i.updated_at, desc: i.inserted_at, desc: i.id)
    |> Repo.all()
    |> Enum.map(&MemoryLog.canonical_interaction/1)
  end

  defp build_adoption_projection(rows) do
    resolved = adoption_entries(rows, "resolved")
    resolved_ids = MapSet.new(resolved, & &1["artifact_id"])

    pending =
      rows
      |> adoption_entries("pending")
      |> Enum.reject(fn entry -> MapSet.member?(resolved_ids, entry["artifact_id"]) end)

    source_turns = MapSet.new(pending, & &1["source_turn_ref"])

    %{
      pending_adoptions: pending,
      resolved_adoptions: resolved,
      pending_adoption_turn_results:
        rows
        |> Enum.map(& &1.content["turn_result"])
        |> Enum.filter(&MapSet.member?(source_turns, &1["turn_id"]))
        |> Enum.uniq_by(& &1["turn_id"])
    }
  end

  defp adoption_entries(rows, key) do
    rows
    |> Enum.flat_map(fn row ->
      result = row.content["turn_result"]

      result
      |> get_in(["adoption_state", key])
      |> List.wrap()
      |> Enum.map(fn entry ->
        entry
        |> Map.put(
          "source_turn_ref",
          entry["source_turn_ref"] || result["turn_id"] || row.turn_id
        )
        |> Map.put("source_session_id", row.session_id)
      end)
    end)
    |> Enum.uniq_by(& &1["artifact_id"])
  end

  @doc "全作品历史 TurnResult 是否已有指定动作标签；用于跨会话/扫描的提议去重。"
  @spec available_action_present?(String.t(), String.t()) :: boolean()
  def available_action_present?(work_id, label_key)
      when is_binary(work_id) and is_binary(label_key) do
    Interaction
    |> where([i], i.workspace_id == ^work_id and i.role == "assistant")
    |> where(
      [i],
      fragment(
        "EXISTS (SELECT 1 FROM json_each(?, '$.turn_result.available_actions') AS action WHERE json_extract(action.value, '$.label_key') = ?)",
        i.content,
        ^label_key
      )
    )
    |> Repo.exists?()
  end

  @doc "按 work+turn 读取持久 assistant turn_result（B46 跨会话动作来源；work 隔离）。"
  @spec turn_result(String.t(), String.t()) :: map() | nil
  def turn_result(work_id, turn_id) when is_binary(work_id) and is_binary(turn_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, _uuid} ->
        Interaction
        |> where(
          [i],
          i.workspace_id == ^work_id and i.turn_id == ^turn_id and i.role == "assistant"
        )
        |> order_by([i], desc: i.updated_at, desc: i.inserted_at, desc: i.id)
        |> limit(1)
        |> Repo.one()
        |> case do
          nil ->
            nil

          row ->
            row
            |> MemoryLog.canonical_interaction()
            |> Map.get(:content, %{})
            |> Map.get("turn_result")
        end

      :error ->
        nil
    end
  end

  @doc """
  按 work+session+turn 批量读取完整 assistant Interaction。

  只服务历史定位，不改变 `turn_result/2` 的 B46 work-only 跨会话语义；调用方已在
  work 边界内时用它一次取回同源绑定，避免逐条查询。
  """
  @spec assistant_entries(String.t(), String.t(), [String.t()]) ::
          [NovelPersistence.Schemas.Interaction.t()]
  def assistant_entries(work_id, session_id, turn_ids)
      when is_binary(work_id) and is_binary(session_id) and is_list(turn_ids) do
    ids =
      turn_ids
      |> Enum.filter(&(is_binary(&1) and String.trim(&1) != ""))
      |> Enum.uniq()

    with {:ok, _session} <- Ecto.UUID.cast(session_id),
         [_ | _] <- ids do
      Interaction
      |> where(
        [i],
        i.workspace_id == ^work_id and i.session_id == ^session_id and
          i.role == "assistant" and i.turn_id in ^ids
      )
      |> order_by([i], asc: i.inserted_at, asc: i.id)
      |> Repo.all()
      |> Enum.map(&MemoryLog.canonical_interaction/1)
    else
      _ -> []
    end
  end

  @doc """
  按 work+session+turn 读取单条完整 assistant Interaction。

  与批量读取同作用域，供作者动作受理在同一事务内读取持久 source turn 及其
  `agent_run_id`，不使用 socket 缓存或调用方传入的 source。
  """
  @spec assistant_entry(String.t(), String.t(), String.t()) ::
          NovelPersistence.Schemas.Interaction.t() | nil
  def assistant_entry(work_id, session_id, turn_id)
      when is_binary(work_id) and is_binary(session_id) and is_binary(turn_id) do
    entry(work_id, session_id, turn_id, "assistant")
  end

  @doc """
  按 work+session+turn 读取单条完整 user Interaction（真实作者原字节）。

  作者动作子运行只消费该持久原文，不把按钮文案冒充作者消息。
  """
  @spec user_entry(String.t(), String.t(), String.t()) ::
          NovelPersistence.Schemas.Interaction.t() | nil
  def user_entry(work_id, session_id, turn_id)
      when is_binary(work_id) and is_binary(session_id) and is_binary(turn_id) do
    entry(work_id, session_id, turn_id, "user")
  end

  defp entry(work_id, session_id, turn_id, role) do
    with {:ok, _session} <- Ecto.UUID.cast(session_id),
         true <- String.trim(turn_id) != "" do
      Interaction
      |> where(
        [i],
        i.workspace_id == ^work_id and i.session_id == ^session_id and i.role == ^role and
          i.turn_id == ^turn_id
      )
      |> order_by([i], asc: i.inserted_at, asc: i.id)
      |> limit(1)
      |> Repo.one()
      |> case do
        nil -> nil
        row -> MemoryLog.canonical_interaction(row)
      end
    else
      _ -> nil
    end
  end

  @doc """
  当前作品/会话最后一份明确行为快照（§16.13）。

  `:absent` 表示历史里没有任何明确快照；`{:ok, nil}` 表示最后一份明确快照声明
  “当前没有开放行为”。后续不携带该字段的普通回复不会遮住更早的明确快照。
  """
  @spec latest_behavior_snapshot(String.t(), String.t()) ::
          :absent | {:ok, NovelDomain.BehaviorState.t() | nil}
  def latest_behavior_snapshot(work_id, session_id)
      when is_binary(work_id) and is_binary(session_id) do
    case latest_behavior_interaction(work_id, session_id) do
      nil ->
        :absent

      interaction ->
        interaction
        |> Map.get(:content, %{})
        |> Map.get("turn_result")
        |> NovelDomain.BehaviorState.read_snapshot()
    end
  end

  @doc """
  按 work+session+run 读取已提交 assistant Interaction。

  用于作者动作回执解析该 run 的真实 child 结果；查询带完整作用域并且只按
  Interaction 内已提交的 `agent_run_id` 绑定，不按 parent turn 猜最新 run。
  """
  @spec assistant_entries_by_run(String.t(), String.t(), String.t()) ::
          [NovelPersistence.Schemas.Interaction.t()]
  def assistant_entries_by_run(work_id, session_id, run_id)
      when is_binary(work_id) and is_binary(session_id) and is_binary(run_id) do
    with {:ok, _session} <- Ecto.UUID.cast(session_id),
         true <- String.trim(run_id) != "" do
      Interaction
      |> where(
        [i],
        i.workspace_id == ^work_id and i.session_id == ^session_id and i.role == "assistant" and
          fragment("json_extract(?, '$.agent_run_id') = ?", i.content, ^run_id)
      )
      |> order_by([i], asc: i.inserted_at, asc: i.id)
      |> Repo.all()
      |> Enum.map(&MemoryLog.canonical_interaction/1)
    else
      _ -> []
    end
  end

  @doc "Touch last_opened_at for resume ordering."
  @spec touch(WorkSession.t()) :: {:ok, WorkSession.t()} | {:error, Ecto.Changeset.t()}
  def touch(%WorkSession{} = session) do
    session
    |> WorkSession.changeset(%{last_opened_at: DateTime.utc_now()})
    |> Repo.update()
  end

  @doc "Persist a derived session summary without changing transcript rows."
  @spec update_summary(WorkSession.t(), String.t() | nil) ::
          {:ok, WorkSession.t()} | {:error, Ecto.Changeset.t()}
  def update_summary(%WorkSession{} = session, summary)
      when is_binary(summary) or is_nil(summary) do
    session
    |> WorkSession.changeset(%{summary: summary})
    |> Repo.update()
  end

  @doc "Archive one session without deleting its transcript."
  @spec archive(WorkSession.t()) :: {:ok, WorkSession.t()} | {:error, Ecto.Changeset.t()}
  def archive(%WorkSession{} = session) do
    session
    |> WorkSession.changeset(%{status: @archived_status})
    |> Repo.update()
  end

  defp latest_active(work_id) do
    work_id
    |> active_sessions_query()
    |> order_by([s], desc: s.last_opened_at, desc: s.updated_at, desc: s.inserted_at)
    |> limit(1)
    |> Repo.one()
  end

  defp active_sessions_query(work_id) do
    WorkSession
    |> where([s], s.work_id == ^work_id and s.status == @active_status)
  end

  defp stale_active_sessions_query(work_id, keep_session_id) do
    work_id
    |> active_sessions_query()
    |> where([s], s.id != ^keep_session_id)
  end

  # 同上：keep_only_active/1 的 Ecto.Multi 管道是 dialyzer 对不透明类型的误报。
  @dialyzer {:no_opaque, keep_only_active: 1}
  defp keep_only_active(%WorkSession{} = session) do
    now = DateTime.utc_now()

    Ecto.Multi.new()
    |> Ecto.Multi.update_all(
      :exit_stale_active,
      stale_active_sessions_query(session.work_id, session.id),
      set: [status: @exited_status, updated_at: now]
    )
    |> Ecto.Multi.update(
      :session,
      WorkSession.changeset(session, %{status: @active_status, last_opened_at: now})
    )
    |> Repo.transaction()
    |> case do
      {:ok, %{session: session}} -> {:ok, session}
      {:error, _step, reason, _changes} -> {:error, reason}
    end
  end

  defp maybe_exclude_archived(query, true), do: query
  defp maybe_exclude_archived(query, false), do: where(query, [s], s.status != ^@archived_status)

  defp session_matches?(session, needle) do
    searchable =
      [session.title, session.summary]
      |> Enum.reject(&is_nil/1)
      |> Enum.join("\n")
      |> String.downcase()

    String.contains?(searchable, needle)
  end

  defp transcript_matches?(session_id, needle) do
    session_id
    |> transcript()
    |> Enum.any?(fn interaction ->
      interaction
      |> interaction_text()
      |> String.downcase()
      |> String.contains?(needle)
    end)
  end

  defp interaction_text(%{content: content}) when is_map(content) do
    to_string(content["text"] || content[:text] || "")
  end

  defp stringify_keys(attrs) do
    Map.new(attrs, fn
      {key, value} when is_atom(key) -> {Atom.to_string(key), value}
      {key, value} -> {key, value}
    end)
  end

  defp default_session_attrs(attrs) do
    attrs
    |> Map.put_new("title", "默认会话")
    |> Map.put_new("status", @active_status)
  end
end
