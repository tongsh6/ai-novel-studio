# VS-00G R7/R8 百章标本重放验证（标本只验不标定；零写入）
#
# 验证靶：
# 1. 新版对账扫描（含 R7/R8 可选读端口）对标本不回归——R5 主角未物化 + R6 骨架缺位仍产；
# 2. R7 提前收官在骨架未立时诚实跳过（分层：先 R6 催立项，骨架立后 R7 才有进度分母）；
# 3. R8 假定超龄在无激活假定时诚实跳过；
# 4. 域函数对标本真实收官味标题（第12/16/18/20/31/42章）在假想骨架下开火（内存态，不写库）。
#
# 用法：NOVEL_TEST_DB_DIR=tmp/dogfood-db MIX_TEST_PARTITION=_dogfood \
#       PHX_SERVER=false MIX_ENV=test mix run scripts/vs00g_r7_r8_replay.exs <work_id>

alias NovelApplication.LedgerReconciliationService
alias NovelDomain.LedgerReconciliation
alias NovelPersistence.LedgerRepository
alias NovelPersistence.WorkArchiveRepo

work_id = System.argv() |> List.first() || raise "需要 work_id 参数"

{:ok, %{counts: counts}} =
  LedgerReconciliationService.scan(work_id, LedgerReconciliationService.persistence_deps())

IO.puts("== VS-00G R7/R8 百章标本重放 ==")
IO.puts("work_id=#{work_id}")
IO.puts("规则计数=#{inspect(counts)}")

if Map.get(counts, "protagonist_undermaterialized", 0) >= 1 and
     Map.get(counts, "skeleton_missing", 0) >= 1 do
  IO.puts("靶1 PASS：R5+R6 不回归（标本地基真空仍被揪出）")
else
  IO.puts("靶1 FAIL：R5/R6 计数缺失")
  System.halt(1)
end

if Map.get(counts, "premature_finale", 0) == 0 and Map.get(counts, "assumption_overdue", 0) == 0 do
  IO.puts("靶2/3 PASS：骨架未立→R7 跳过；无激活假定→R8 跳过（诚实分层）")
else
  IO.puts("靶2/3 FAIL：R7/R8 在无前提数据时误开火")
  System.halt(1)
end

# 靶4：内存态假想——标本若已立 30 万字骨架，真实收官味章标题（M3 病灶：第12章
# 「第一卷终局」/第31章「全域控制的终局」）应触发 R7。窗口取首个命中强标记章
# 收尾的近 5 章（与规则同款强标记，标记词表为先验设计，非从标本标定）。
chapters =
  work_id
  |> LedgerRepository.chapter_index()
  |> Map.values()
  |> Enum.sort_by(& &1.seq)

markers = ~w(终局 大结局 完结 收官 落幕)

finale_titled =
  Enum.filter(chapters, fn c ->
    Enum.any?(markers, &String.contains?(to_string(c.title), &1))
  end)

IO.puts(
  "标本含强收官标记章标题数=#{length(finale_titled)}（seq=#{inspect(Enum.map(finale_titled, & &1.seq))}）"
)

words_total = work_id |> WorkArchiveRepo.stats() |> Map.get(:words_total, 0)
hypothetical_target = 300_000
progress = words_total / hypothetical_target * 100

sample_window =
  case finale_titled do
    [] -> Enum.take(chapters, -5)
    [first | _] -> chapters |> Enum.filter(&(&1.seq <= first.seq)) |> Enum.take(-5)
  end

finding = LedgerReconciliation.premature_finale_finding(progress, sample_window, 70)

if length(finale_titled) >= 1 and is_map(finding) and finding.rule == "premature_finale" do
  IO.puts("靶4 PASS：假想骨架下真实收官味标题触发 R7（进度 #{round(progress)}%）")
  IO.puts("signal：#{finding.signal}")
else
  IO.puts("靶4 FAIL：标本收官味标题未触发 R7（finale_titled=#{length(finale_titled)}）")
  System.halt(1)
end

IO.puts("== R7/R8 重放全部 PASS（零写入，标本未动） ==")
