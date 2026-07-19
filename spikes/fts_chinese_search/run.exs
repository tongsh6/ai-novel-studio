# CP5 search_prose 技术选型 spike：SQLite FTS5 中文检索
#
# 验证问题（结论写入 README.md 与 docs/design/tech-stack/verification/）：
#   Q1 exqlite 捆绑的 SQLite 是否编入 FTS5？版本多少？
#   Q2 trigram tokenizer：中文子串匹配质量；≥3 字查询 / 2 字查询 / LIKE 短查询回退各自行为
#   Q3 unigram 字符切分（索引时按字空格分 + unicode61 + 短语查询）：任意长度查询的精确性
#   Q4 snippet()/highlight() 引用输出可用性（探索观察需带出处片段）
#   Q5 写入路径成本形态（采纳时同步 upsert 一行 fts 的量级）
#
# 运行：cd spikes/fts_chinese_search && mix deps.get && mix run run.exs

defmodule FtsSpike do
  alias Exqlite.Sqlite3

  @prose_01 """
  第01章 底层灵气账单。陈九斤蹲在矿区的出气口边上，把今天的灵气账单摊开在膝盖上。\
  账单上的数字比昨天又少了三成，宗门的抽成却涨到了七成。他捏着炭笔，在"上缴"一栏\
  后面重重划了一道。远处的灵脉泵站还在轰鸣，白色的灵气顺着管道流向山上的内门。
  """

  @prose_02 """
  第02章 矿区追击战。夜里的矿区没有灯，只有灵脉泵站的指示灯一明一灭。陈九斤贴着\
  矿车的阴影往前挪，身后的两名执法堂弟子越追越近。他忽然想起白天在账单背面记下的\
  那条旧巷——巷子尽头有一处废弃的出气口，窄得只容一个人侧身钻过。
  """

  @prose_03 """
  第03章 宗门试炼。试炼台上的老者展开名册，念到陈九斤的名字时停顿了一下。台下有人\
  低声笑出来：一个矿区来的杂役，也配站上试炼台。陈九斤没有理会，他在心里默算着这些\
  天偷偷攒下的灵气——不多，但足够撑过第一轮的淬体考核。
  """

  def main do
    {:ok, conn} = Sqlite3.open(":memory:")

    print_header(conn)
    q2_trigram(conn)
    q3_unigram(conn)
    q4_snippet(conn)
    q5_write_shape(conn)

    :ok = Sqlite3.close(conn)
  end

  # ── Q1 ──

  defp print_header(conn) do
    version = one(conn, "select sqlite_version()")

    fts5 =
      case Sqlite3.execute(conn, "create virtual table __probe using fts5(x)") do
        :ok -> "yes"
        {:error, reason} -> "NO (#{inspect(reason)})"
      end

    IO.puts("== Q1 环境")
    IO.puts("  sqlite_version = #{version}")
    IO.puts("  fts5 available = #{fts5}")
  end

  # ── Q2 trigram ──

  defp q2_trigram(conn) do
    IO.puts("\n== Q2 trigram tokenizer")

    case Sqlite3.execute(
           conn,
           "create virtual table prose_tri using fts5(chapter, content, tokenize='trigram')"
         ) do
      :ok ->
        seed(conn, "prose_tri")

        for {label, sql, args} <- [
              {"3字 MATCH 灵气账单(4字)", "select chapter from prose_tri where prose_tri match ?", ["灵气账单"]},
              {"3字 MATCH 执法堂(3字)", "select chapter from prose_tri where prose_tri match ?", ["执法堂"]},
              {"2字 MATCH 矿区(2字)", "select chapter from prose_tri where prose_tri match ?", ["矿区"]},
              {"2字 LIKE %矿区%", "select chapter from prose_tri where content like ?", ["%矿区%"]},
              {"1字 LIKE %巷%", "select chapter from prose_tri where content like ?", ["%巷%"]},
              {"跨词 MATCH 灵脉泵站", "select chapter from prose_tri where prose_tri match ?", ["灵脉泵站"]},
              {"不存在 MATCH 剑冢秘藏", "select chapter from prose_tri where prose_tri match ?", ["剑冢秘藏"]}
            ] do
          report(conn, label, sql, args)
        end

        like_plan = plan(conn, "select chapter from prose_tri where content like '%矿区%'")
        IO.puts("  LIKE 查询计划: #{like_plan}")

      {:error, reason} ->
        IO.puts("  trigram 不可用: #{inspect(reason)}")
    end
  end

  # ── Q3 unigram（索引时按字切分，查询走短语）──

  defp q3_unigram(conn) do
    IO.puts("\n== Q3 unigram 字符切分 + 短语查询")

    :ok =
      Sqlite3.execute(
        conn,
        "create virtual table prose_uni using fts5(chapter, content, tokenize='unicode61')"
      )

    seed(conn, "prose_uni", &to_unigram/1)

    for {label, query} <- [
          {"4字短语 灵气账单", phrase("灵气账单")},
          {"2字短语 矿区", phrase("矿区")},
          {"1字 巷", phrase("巷")},
          {"跨段落连语 账单背面", phrase("账单背面")},
          {"不存在 剑冢秘藏", phrase("剑冢秘藏")}
        ] do
      report(
        conn,
        label,
        "select chapter from prose_uni where prose_uni match ?",
        [query]
      )
    end
  end

  # ── Q4 snippet 引用 ──

  defp q4_snippet(conn) do
    IO.puts("\n== Q4 snippet() 引用输出（trigram 表）")

    case rows(
           conn,
           "select chapter, snippet(prose_tri, 1, '「', '」', '…', 12) " <>
             "from prose_tri where prose_tri match ? order by rank",
           ["灵气账单"]
         ) do
      [] -> IO.puts("  (无结果)")
      rs -> Enum.each(rs, fn [ch, snip] -> IO.puts("  #{ch}: #{snip}") end)
    end
  end

  # ── Q5 写入形态 ──

  defp q5_write_shape(conn) do
    IO.puts("\n== Q5 写入成本形态（1000 章 upsert 到 trigram 表）")
    {us, _} = :timer.tc(fn ->
      :ok = Sqlite3.execute(conn, "begin")

      for i <- 1..1000 do
        exec(conn, "insert into prose_tri(chapter, content) values (?, ?)", [
          "第#{i}章",
          String.duplicate(@prose_01, 2)
        ])
      end

      :ok = Sqlite3.execute(conn, "commit")
    end)

    IO.puts("  1000 章 × ~700 字：#{div(us, 1000)} ms（单章均摊 #{Float.round(us / 1000 / 1000, 2)} ms）")
  end

  # ── helpers ──

  defp seed(conn, table, transform \\ & &1) do
    for {ch, text} <- [{"第01章", @prose_01}, {"第02章", @prose_02}, {"第03章", @prose_03}] do
      exec(conn, "insert into #{table}(chapter, content) values (?, ?)", [ch, transform.(text)])
    end
  end

  defp to_unigram(text) do
    text |> String.replace("\n", "") |> String.graphemes() |> Enum.join(" ")
  end

  defp phrase(query) do
    inner = query |> String.graphemes() |> Enum.join(" ")
    "\"#{inner}\""
  end

  defp report(conn, label, sql, args) do
    result =
      case rows(conn, sql, args) do
        {:error, reason} -> "ERROR #{inspect(reason)}"
        [] -> "(no match)"
        rs -> rs |> Enum.map(&hd/1) |> Enum.uniq() |> Enum.join(", ")
      end

    IO.puts("  #{label} -> #{result}")
  end

  defp one(conn, sql) do
    [[v]] = rows(conn, sql, [])
    v
  end

  defp plan(conn, sql) do
    conn
    |> rows("explain query plan " <> sql, [])
    |> Enum.map(&List.last/1)
    |> Enum.join(" | ")
  end

  defp exec(conn, sql, args) do
    {:ok, stmt} = Sqlite3.prepare(conn, sql)
    :ok = Sqlite3.bind(stmt, args)
    :done = Sqlite3.step(conn, stmt)
    :ok = Sqlite3.release(conn, stmt)
  end

  defp rows(conn, sql, args) do
    with {:ok, stmt} <- Sqlite3.prepare(conn, sql),
         :ok <- Sqlite3.bind(stmt, args),
         {:ok, rs} <- Sqlite3.fetch_all(conn, stmt),
         :ok <- Sqlite3.release(conn, stmt) do
      rs
    end
  end
end

FtsSpike.main()
