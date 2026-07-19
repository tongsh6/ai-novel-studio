defmodule NovelPersistence.ProseSearchRepo do
  @moduledoc """
  CP5 探索内部翼 `prose_search` 读模型：已采纳正文的 FTS5 trigram 全文索引。

  - 索引是机械导出物：按 accepted drafts 水位（`max(updated_at)`）惰性重建，
    采纳写路径零耦合；删索引不失任何真源数据。
  - 正文选取语义与阅读投影一致（每 scene 取最高 revision 的 accepted draft，
    tentative 候选绝不进索引），按章聚合为一行。
  - 查询整形（选型证据 `spikes/fts_chinese_search/`）：≥3 字走 MATCH（bm25
    排序 + snippet 引用片段）；<3 字回退 LIKE（2 字仍走 trigram 索引）。
  """

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene}

  @default_limit 5
  @snippet_tokens 24
  @like_excerpt_chars 36

  @type hit :: %{chapter_id: String.t(), chapter_title: String.t(), snippet: String.t()}

  @spec search(String.t(), String.t(), keyword()) :: {:ok, [hit()]} | {:error, term()}
  def search(work_id, query, opts \\ []) do
    limit = Keyword.get(opts, :limit, @default_limit)
    query = String.trim(query || "")

    with {:ok, work_uuid} <- cast_work_id(work_id),
         :ok <- validate_query(query),
         :ok <- ensure_fresh(work_uuid) do
      if String.length(query) >= 3 do
        match_search(work_uuid, query, limit)
      else
        like_search(work_uuid, query, limit)
      end
    end
  end

  defp cast_work_id(work_id) when is_binary(work_id) do
    case Ecto.UUID.cast(work_id) do
      {:ok, uuid} -> {:ok, uuid}
      :error -> {:error, :invalid_work_id}
    end
  end

  defp cast_work_id(_work_id), do: {:error, :invalid_work_id}

  defp validate_query(""), do: {:error, :empty_query}
  defp validate_query(_query), do: :ok

  # ── 惰性重建（watermark）──

  defp ensure_fresh(work_uuid) do
    current = draft_watermark(work_uuid)

    if current == indexed_watermark(work_uuid) do
      :ok
    else
      rebuild(work_uuid, current)
    end
  end

  defp draft_watermark(work_uuid) do
    accepted = AdoptionStatus.accepted()

    Draft
    |> where([d], d.work_id == ^work_uuid and d.status == ^accepted)
    |> select([d], max(d.updated_at))
    |> Repo.one()
  end

  defp indexed_watermark(work_uuid) do
    case Repo.query!(
           "SELECT draft_watermark FROM prose_search_watermarks WHERE work_id = ?",
           [work_uuid]
         ) do
      %{rows: [[value]]} -> parse_watermark(value)
      _ -> :missing
    end
  end

  defp parse_watermark(nil), do: nil

  defp parse_watermark(value) when is_binary(value) do
    case DateTime.from_iso8601(String.replace(value, " ", "T")) do
      {:ok, dt, _offset} -> dt
      _ -> :unparseable
    end
  end

  defp parse_watermark(_value), do: :unparseable

  defp rebuild(work_uuid, watermark) do
    rows = chapter_rows(work_uuid)

    Repo.transaction(fn ->
      Repo.query!("DELETE FROM prose_search_index WHERE work_id = ?", [work_uuid])

      Enum.each(rows, fn {chapter_id, chapter_title, content} ->
        Repo.query!(
          "INSERT INTO prose_search_index(work_id, chapter_id, chapter_title, content) VALUES (?, ?, ?, ?)",
          [work_uuid, chapter_id, chapter_title || "", content]
        )
      end)

      Repo.query!(
        "INSERT INTO prose_search_watermarks(work_id, indexed_at, draft_watermark) VALUES (?, ?, ?) " <>
          "ON CONFLICT(work_id) DO UPDATE SET indexed_at = excluded.indexed_at, draft_watermark = excluded.draft_watermark",
        [work_uuid, DateTime.utc_now(), watermark]
      )
    end)
    |> case do
      {:ok, _} -> :ok
      {:error, reason} -> {:error, reason}
    end
  end

  # 与 ReadingProjectionRepo 同一选取语义：每 scene 最高 revision 的 accepted
  # draft；按章聚合（chapter seq / scene seq 顺序拼接）。
  defp chapter_rows(work_uuid) do
    accepted = AdoptionStatus.accepted()

    Draft
    |> join(:inner, [d], s in Scene, on: s.id == d.scene_id and s.work_id == d.work_id)
    |> join(:inner, [d, s], c in Chapter, on: c.id == s.chapter_id and c.work_id == d.work_id)
    |> where([d], d.work_id == ^work_uuid and d.status == ^accepted)
    |> order_by([d, s, c], asc: c.seq, asc: s.seq, desc: d.revision, desc: d.updated_at)
    |> select([d, s, c], %{
      chapter_id: c.id,
      chapter_title: c.title,
      scene_id: s.id,
      content: d.content
    })
    |> Repo.all()
    |> Enum.uniq_by(& &1.scene_id)
    |> Enum.group_by(&{&1.chapter_id, &1.chapter_title})
    |> Enum.map(fn {{chapter_id, chapter_title}, scene_rows} ->
      {chapter_id, chapter_title, Enum.map_join(scene_rows, "\n", & &1.content)}
    end)
  end

  # ── 查询整形 ──

  defp match_search(work_uuid, query, limit) do
    %{rows: rows} =
      Repo.query!(
        "SELECT chapter_id, chapter_title, snippet(prose_search_index, 3, '「', '」', '…', ?) " <>
          "FROM prose_search_index WHERE work_id = ? AND prose_search_index MATCH ? ORDER BY rank LIMIT ?",
        [@snippet_tokens, work_uuid, fts_phrase(query), limit]
      )

    {:ok, Enum.map(rows, fn [id, title, snippet] -> hit(id, title, snippet) end)}
  end

  defp like_search(work_uuid, query, limit) do
    pattern = "%" <> String.replace(query, ~r/[%_\\]/, fn c -> "\\" <> c end) <> "%"

    %{rows: rows} =
      Repo.query!(
        "SELECT chapter_id, chapter_title, content FROM prose_search_index " <>
          "WHERE work_id = ? AND content LIKE ? ESCAPE '\\' LIMIT ?",
        [work_uuid, pattern, limit]
      )

    {:ok, Enum.map(rows, fn [id, title, content] -> hit(id, title, excerpt(content, query)) end)}
  end

  # FTS5 查询语法转短语（引号内双引号转义）：trigram 下短语=子串匹配，
  # 同时中和用户输入里的 FTS 运算符。
  defp fts_phrase(query), do: "\"" <> String.replace(query, "\"", "\"\"") <> "\""

  defp excerpt(content, query) do
    case :binary.match(content, query) do
      {start, _len} ->
        from = max(start - @like_excerpt_chars, 0)
        prefix = if from > 0, do: "…", else: ""
        window = binary_part(content, from, min(byte_size(content) - from, @like_excerpt_chars * 3))
        prefix <> sanitize_utf8(window) <> "…"

      :nomatch ->
        String.slice(content, 0, @like_excerpt_chars)
    end
  end

  # binary_part 可能切在多字节中间：丢弃首尾坏字节，保住 UTF-8 合法性。
  defp sanitize_utf8(binary) do
    binary
    |> String.chunk(:valid)
    |> Enum.filter(&String.valid?/1)
    |> Enum.join()
  end

  defp hit(chapter_id, chapter_title, snippet) do
    %{chapter_id: chapter_id, chapter_title: chapter_title, snippet: snippet}
  end
end
