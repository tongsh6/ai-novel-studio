# B25 CP0：章节身份历史数据审计（只读）
#
# 用途：在把「章节身份 = chapter_ref = "chapter:<chapters.id>"」从读取面扩展到写入/采纳链
# 之前，先审计历史数据里的身份冲突候选：
#   1) 同一 work 内重复 title 的 chapters（title 不是唯一键；同名可能是创作事实，也可能是
#      旧 (work_id,title) 身份逻辑合并/误建留下的重复行）；
#   2) 同一 work 内重复 seq 的 chapters（seq 代码意图 work 内唯一，但 DB 无唯一约束）；
#   3) 空/空白 title 的 chapters。
#
# 只读、不修复；修复动作必须显式登记并单独执行（B25 CP3）。
#
# 用法：
#   MIX_ENV=test mix run scripts/chapter_identity_audit.exs [db_path ...]
# 缺省审计 artifacts/novel-output/p1-100k-dogfood/work-snapshot.sqlite3（若存在）。
# 报告：artifacts/chapter-identity/audit.md + audit.json

defmodule B25.ChapterIdentityAudit do
  @moduledoc false

  @default_artifact_dir "artifacts/chapter-identity"
  @default_db "artifacts/novel-output/p1-100k-dogfood/work-snapshot.sqlite3"

  def main(argv) do
    dbs = normalize_dbs(argv)
    results = Enum.map(dbs, &audit_db/1)
    write_report(results)
    enforce(results)
  end

  defp normalize_dbs([]) do
    if File.exists?(@default_db), do: [@default_db], else: []
  end

  defp normalize_dbs(argv), do: Enum.map(argv, &String.trim/1)

  defp audit_db(db_path) do
    if File.exists?(db_path) do
      case Exqlite.Sqlite3.open(db_path, mode: :readonly) do
        {:ok, conn} ->
          try do
            result = %{
              db: db_path,
              exists: true,
              chapters: count(conn, "chapters"),
              works: count(conn, "works"),
              duplicate_titles: query(conn, duplicate_titles_sql()),
              duplicate_seqs: query(conn, duplicate_seqs_sql()),
              blank_titles: query(conn, blank_titles_sql()),
              schema: schema_info(conn)
            }

            result
          after
            Exqlite.Sqlite3.close(conn)
          end

        {:error, reason} ->
          %{db: db_path, exists: true, error: inspect(reason)}
      end
    else
      %{db: db_path, exists: false}
    end
  end

  defp count(conn, table) do
    case run(conn, "SELECT COUNT(*) FROM #{table}", []) do
      {:ok, [[value]]} -> value
      _ -> nil
    end
  end

  defp schema_info(conn) do
    case run(conn, "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'chapters'", []) do
      {:ok, [[sql]]} -> sql
      _ -> nil
    end
  end

  defp duplicate_titles_sql do
    """
    SELECT work_id, title, COUNT(*) AS n, GROUP_CONCAT(id) AS chapter_ids, GROUP_CONCAT(seq) AS seqs
    FROM chapters
    GROUP BY work_id, title
    HAVING n > 1
    ORDER BY n DESC, work_id, title
    """
  end

  defp duplicate_seqs_sql do
    """
    SELECT work_id, seq, COUNT(*) AS n, GROUP_CONCAT(id) AS chapter_ids
    FROM chapters
    GROUP BY work_id, seq
    HAVING n > 1
    ORDER BY n DESC, work_id, seq
    """
  end

  defp blank_titles_sql do
    """
    SELECT id, work_id, title, seq
    FROM chapters
    WHERE TRIM(COALESCE(title, '')) = ''
    ORDER BY work_id, seq
    """
  end

  defp query(conn, sql) do
    case run(conn, sql, []) do
      {:ok, rows} -> rows
      {:error, _reason} -> []
    end
  end

  defp run(conn, sql, params) do
    with {:ok, statement} <- Exqlite.Sqlite3.prepare(conn, sql),
         :ok <- bind_all(conn, statement, params),
         {:ok, rows} <- fetch_rows(conn, statement, []) do
      {:ok, rows}
    end
  end

  defp bind_all(_conn, _statement, []), do: :ok

  defp bind_all(conn, statement, [param | rest]) do
    with :ok <- Exqlite.Sqlite3.bind(statement, [param]) do
      Exqlite.Sqlite3.step(conn, statement)
      bind_all(conn, statement, rest)
    end
  end

  defp fetch_rows(conn, statement, acc) do
    case Exqlite.Sqlite3.step(conn, statement) do
      {:row, row} -> fetch_rows(conn, statement, [row | acc])
      :done -> {:ok, Enum.reverse(acc)}
      :busy -> fetch_rows(conn, statement, acc)
      {:error, reason} -> {:error, reason}
    end
  end

  defp write_report(results) do
    File.mkdir_p!(@default_artifact_dir)
    json_path = Path.join(@default_artifact_dir, "audit.json")
    md_path = Path.join(@default_artifact_dir, "audit.md")

    File.write!(json_path, Jason.encode!(%{generated_at: DateTime.utc_now(), dbs: results}, pretty: true))
    File.write!(md_path, markdown(results))

    IO.puts("[b25-audit] report: #{md_path}")
    IO.puts("[b25-audit] json:   #{json_path}")
  end

  defp markdown(results) do
    header = """
    # B25 CP0 章节身份历史数据审计（只读）

    生成时间：#{DateTime.utc_now() |> DateTime.to_iso8601()}

    口径：`title` 非唯一（同名可能是创作事实，也可能是旧 `(work_id,title)` 身份逻辑的重复行）；
    `seq` 代码意图 work 内唯一但 DB 无唯一约束。本报告只列冲突候选，不做任何修复。

    """

    body =
      results
      |> Enum.map_join("\n---\n\n", &render_db/1)

    header <> body
  end

  defp render_db(%{exists: false, db: db}), do: "## `#{db}`\n\n不存在（跳过）。\n"

  defp render_db(%{db: db, error: error}),
    do: "## `#{db}`\n\n打开失败：`#{error}`\n"

  defp render_db(result) do
    verdict =
      cond do
        result.duplicate_titles != [] -> "**需显式修复/裁决**：存在重复 title"
        result.duplicate_seqs != [] -> "**需显式修复**：存在重复 seq"
        result.blank_titles != [] -> "**需显式修复**：存在空 title"
        true -> "OK：无重复 title / 重复 seq / 空 title"
      end

    """
    ## `#{result.db}`

    - chapters：#{inspect(result.chapters)}；works：#{inspect(result.works)}
    - 结论：#{verdict}
    - 重复 title 组：#{length(result.duplicate_titles)}
    - 重复 seq 组：#{length(result.duplicate_seqs)}
    - 空 title 行：#{length(result.blank_titles)}

    #{table("重复 title（work_id / title / n / chapter_ids / seqs）", ["work_id", "title", "n", "chapter_ids", "seqs"], result.duplicate_titles)}
    #{table("重复 seq（work_id / seq / n / chapter_ids）", ["work_id", "seq", "n", "chapter_ids"], result.duplicate_seqs)}
    #{table("空 title（id / work_id / title / seq）", ["id", "work_id", "title", "seq"], result.blank_titles)}
    """
  end

  defp table(_title, _headers, []), do: ""

  defp table(title, headers, rows) do
    header = "| " <> Enum.join(headers, " | ") <> " |\n"
    separator = "|" <> Enum.map_join(headers, "|", fn _ -> "---" end) <> "|\n"

    body =
      Enum.map_join(rows, "", fn row ->
        "| " <> Enum.map_join(row, " | ", &to_string/1) <> " |\n"
      end)

    "#### #{title}\n\n" <> header <> separator <> body
  end

  defp enforce(results) do
    problems =
      Enum.filter(results, fn
        %{exists: false} -> false
        %{exists: true, error: _} -> true
        result ->
          result.duplicate_titles != [] or result.duplicate_seqs != [] or
            result.blank_titles != []
      end)

    if problems == [] do
      IO.puts("[b25-audit] passed: no chapter identity conflicts in audited DBs")
    else
      IO.puts(
        "[b25-audit] conflicts found in #{length(problems)} db(s) — 修复动作需显式登记（B25 CP3），本脚本只读不修"
      )
    end
  end
end

B25.ChapterIdentityAudit.main(System.argv())
