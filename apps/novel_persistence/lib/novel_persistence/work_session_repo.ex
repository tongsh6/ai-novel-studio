defmodule NovelPersistence.WorkSessionRepo do
  @moduledoc """
  WorkSession 持久化入口。会话是作品下 transcript、搜索、恢复和只读历史的边界。
  """

  import Ecto.Query

  alias NovelFoundation.Enums.StructureStatus
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.WorkSession

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

  @doc "Return full transcript for a session in insertion order."
  @spec transcript(String.t()) :: [NovelPersistence.Schemas.Interaction.t()]
  def transcript(session_id) when is_binary(session_id), do: MemoryLog.transcript(session_id)

  @doc "Return one transcript page for a session in insertion order."
  @spec transcript_page(String.t(), keyword()) :: {:ok, map()} | {:error, :cursor_not_found}
  def transcript_page(session_id, opts \\ []) when is_binary(session_id),
    do: MemoryLog.transcript_page(session_id, opts)

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
