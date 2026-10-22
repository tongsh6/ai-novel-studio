# B25 CP3：章节身份历史数据显式修复（只读报告 + 显式 --fix-dup-seq）
#
# 背景：`chapters.seq` 代码意图 work 内唯一，但历史 DB 无唯一约束（迁移
# 20261023000001_add_unique_chapter_seq_index 上线前必须确认无重复）。同名 title 是
# 创作事实（两章可同名），本脚本**永不合并/删除/改 title**。
#
# 行为：
#   MIX_ENV=test mix run scripts/chapter_identity_repair.exs --db <sqlite路径>
#     只读报告：重复 (work_id,title) / 重复 (work_id,seq) / 空 title。
#   MIX_ENV=test mix run scripts/chapter_identity_repair.exs --db <路径> --fix-dup-seq
#     显式修复重复 seq：每个 work 内按 (seq, inserted_at, id) 稳定排序后重排为 1..n，
#     其余行相对顺序不变；写前打印 change set，事务内执行，失败整体回滚。
#     修复后再跑审计脚本确认，然后执行唯一索引迁移。
#
# 回滚：修复前先备份 DB 文件；迁移回滚 `mix ecto.rollback`（只删索引，不动数据）。

defmodule B25.ChapterIdentityRepair do
  @moduledoc false

  def main(argv) do
    {opts, _rest} = OptionParser.parse!(argv, strict: [db: :string, fix_dup_seq: :boolean])

    db = Keyword.get(opts, :db)

    if is_nil(db) do
      IO.puts(:stderr, "用法: mix run scripts/chapter_identity_repair.exs --db <sqlite路径> [--fix-dup-seq]")
      System.halt(2)
    end

    unless File.exists?(db) do
      IO.puts(:stderr, "DB 不存在: #{db}")
      System.halt(2)
    end

    {:ok, conn} = Exqlite.Sqlite3.open(db)
    fix? = Keyword.get(opts, :fix_dup_seq, false)

    try do
      report(conn, db)

      if fix? do
        fix_duplicate_seqs(conn, db)
      else
        IO.puts("\n[dry-run] 未修改数据。确认后加 --fix-dup-seq 显式修复重复 seq。")
      end
    after
      Exqlite.Sqlite3.close(conn)
    end
  end

  defp report(conn, db) do
    dup_titles = select(conn, duplicate_titles_sql())
    dup_seqs = select(conn, duplicate_seqs_sql())
    blanks = select(conn, blank_titles_sql())

    IO.puts("[b25-repair] db=#{db}")
    IO.puts("[b25-repair] 重复 title 组: #{length(dup_titles)}（只报告，永不合并）")

    Enum.each(dup_titles, fn [work_id, title, count | _] ->
      IO.puts("  - work=#{work_id} title=#{inspect(title)} x#{count}")
    end)

    IO.puts("[b25-repair] 重复 seq 组: #{length(dup_seqs)}")

    Enum.each(dup_seqs, fn [work_id, seq, count | _] ->
      IO.puts("  - work=#{work_id} seq=#{seq} x#{count}")
    end)

    IO.puts("[b25-repair] 空 title 行: #{length(blanks)}")
    %{titles: dup_titles, seqs: dup_seqs, blanks: blanks}
  end

  defp fix_duplicate_seqs(conn, db) do
    case select(conn, duplicate_seqs_sql()) do
      [] ->
        IO.puts("[b25-repair] 无重复 seq，无需修复。")
        verify_after(conn)

      dup_seqs ->
        work_ids = dup_seqs |> Enum.map(&hd/1) |> Enum.uniq()

        changes =
          Enum.flat_map(work_ids, fn work_id ->
            conn
            |> select(chapters_for_work_sql(), [work_id])
            |> Enum.with_index(1)
            |> Enum.map(fn {[id, old_seq | _], new_seq} -> {id, old_seq, new_seq} end)
          end)

        IO.puts("\n[b25-repair] 将重排 #{length(changes)} 行（每个 work 内 1..n，保持相对顺序）：")

        Enum.each(changes, fn {id, old_seq, new_seq} ->
          IO.puts("  - chapter=#{id} seq #{old_seq} -> #{new_seq}")
        end)

        execute_fix(conn, changes)
        verify_after(conn)
    end
  end

  # 事务内：先全部挪到互不冲突的负序号，再写目标 1..n —— 唯一索引已存在时也能完成。
  defp execute_fix(conn, changes) do
    exec(conn, "BEGIN IMMEDIATE")

    try do
      Enum.each(changes, fn {id, _old_seq, new_seq} ->
        exec(conn, "UPDATE chapters SET seq = ? WHERE id = ?", [-new_seq, id])
      end)

      Enum.each(changes, fn {id, _old_seq, new_seq} ->
        exec(conn, "UPDATE chapters SET seq = ? WHERE id = ?", [new_seq, id])
      end)

      exec(conn, "COMMIT")
      IO.puts("[b25-repair] 已提交 seq 重排。")
    rescue
      error ->
        exec(conn, "ROLLBACK")
        reraise error, __STACKTRACE__
    end
  end

  defp verify_after(conn) do
    case select(conn, duplicate_seqs_sql()) do
      [] ->
        IO.puts("[b25-repair] 校验通过：无重复 seq。下一步可执行唯一索引迁移。")

      remaining ->
        IO.puts("[b25-repair] 仍有 #{length(remaining)} 组重复 seq，需人工核查。")
    end
  end

  defp duplicate_titles_sql do
    """
    SELECT work_id, title, COUNT(*) AS n, GROUP_CONCAT(id) AS chapter_ids
    FROM chapters GROUP BY work_id, title HAVING n > 1 ORDER BY n DESC
    """
  end

  defp duplicate_seqs_sql do
    """
    SELECT work_id, seq, COUNT(*) AS n, GROUP_CONCAT(id) AS chapter_ids
    FROM chapters GROUP BY work_id, seq HAVING n > 1 ORDER BY n DESC
    """
  end

  defp blank_titles_sql do
    "SELECT id, work_id, title, seq FROM chapters WHERE TRIM(COALESCE(title, '')) = ''"
  end

  defp chapters_for_work_sql do
    "SELECT id, seq FROM chapters WHERE work_id = ? ORDER BY seq ASC, inserted_at ASC, id ASC"
  end

  defp select(conn, sql, params \\ []) do
    {:ok, statement} = Exqlite.Sqlite3.prepare(conn, sql)
    :ok = Exqlite.Sqlite3.bind(statement, params)

    fetch_rows(conn, statement, [])
    |> case do
      {:ok, rows} -> rows
      other -> raise "sqlite select failed: #{inspect(other)}"
    end
  end

  defp fetch_rows(conn, statement, acc) do
    case Exqlite.Sqlite3.step(conn, statement) do
      {:row, row} -> fetch_rows(conn, statement, [row | acc])
      :done -> {:ok, Enum.reverse(acc)}
      :busy -> fetch_rows(conn, statement, acc)
      error -> error
    end
  end

  defp exec(conn, sql, params \\ []) do
    case params do
      [] ->
        Exqlite.Sqlite3.execute(conn, sql)

      _ ->
        {:ok, statement} = Exqlite.Sqlite3.prepare(conn, sql)
        :ok = Exqlite.Sqlite3.bind(statement, params)

        case Exqlite.Sqlite3.step(conn, statement) do
          :done -> :ok
          :busy -> exec(conn, sql, params)
          {:error, reason} -> raise "sqlite exec failed: #{inspect(reason)}"
        end
    end
  end
end

B25.ChapterIdentityRepair.main(System.argv())
