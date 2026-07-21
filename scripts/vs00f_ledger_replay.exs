# VS-00F CP1 验收驱动：对既有作品库重放弧光账维护（M2 75 章书为真实素材）。
#
# 用法（对狗粮库的**副本**跑，不动原库）：
#   cp -r tmp/dogfood-db /path/to/copy
#   NOVEL_TEST_DB_DIR=/path/to/copy MIX_TEST_PARTITION=_dogfood MIX_ENV=test mix ecto.migrate
#   NOVEL_TEST_DB_DIR=/path/to/copy MIX_TEST_PARTITION=_dogfood PHX_SERVER=false \
#     MIX_ENV=test mix run scripts/vs00f_ledger_replay.exs
#
# 语义：按章序对每章 ACCEPTED 摘要跑 LedgerMaintenance（与生产 hook 同一用例、
# 同一确定性提炼），期末打印账面并断言 M2 漂移靶（凌渊类消失角色 STALLED）。
# 注意：M2 狗粮没有采纳过角色（seed 只有作品+章计划），故 roster 以**测试夹具**
# 方式注入主角阵容（生产里 roster 来自角色采纳；此为素材库的已知缺口，如实登记）。
import Ecto.Query

alias NovelPersistence.{LedgerRepository, Repo}
alias NovelPersistence.Schemas.{Chapter, ChapterSummary, Character, Draft, Scene, Work}

roster_fixture = ~w(林浩 凌渊 凌云 沈墨 沈逸 柳烟 韩晟)

work =
  Repo.one!(from(w in Work, where: w.status not in ["DISCARDED", "ARCHIVED"], limit: 1))

work_id = to_string(work.id)
IO.puts("[replay] work=#{work.title} (#{work_id})")

# 夹具 roster：不存在才插（幂等）
existing = Repo.all(from(c in Character, where: c.work_id == ^work.id, select: c.name))

for name <- roster_fixture, name not in existing do
  %Character{}
  |> Character.changeset(%{
    work_id: work_id,
    name: name,
    role: "main",
    narrative_role: "PROTAGONIST",
    summary: "M2 重放 roster 夹具",
    status: "ACCEPTED",
    aliases: []
  })
  |> Repo.insert!()
end

chapters =
  Repo.all(
    from(c in Chapter, where: c.work_id == ^work.id, order_by: [asc: c.seq], select: {c.id, c.seq, c.title})
  )

summaries =
  Repo.all(
    from(s in ChapterSummary,
      where: s.work_id == ^work_id and s.status in ["ACCEPTED", "EDITED_ACCEPTED"],
      select: {s.chapter_id, s.summary_text}
    )
  )
  |> Map.new()

prose_by_chapter =
  Repo.all(
    from(d in Draft,
      join: s in Scene,
      on: s.id == d.scene_id,
      where: d.status in ["ACCEPTED", "EDITED_ACCEPTED"],
      select: {s.chapter_id, d.content}
    )
  )
  |> Enum.group_by(fn {cid, _} -> to_string(cid) end, fn {_, c} -> c end)
  |> Map.new(fn {cid, texts} -> {cid, Enum.join(texts, "\n")} end)

deps = %{
  roster: &NovelPersistence.WorkArchiveRepo.characters/1,
  chapter_index: &LedgerRepository.chapter_index/1,
  profile: &NovelPersistence.WorkArchiveRepo.profile/1,
  repo: %{list: &LedgerRepository.list_all/1, upsert: &LedgerRepository.upsert/1}
}

replayed =
  Enum.reduce(chapters, 0, fn {chapter_id, _seq, _title}, acc ->
    case Map.get(summaries, to_string(chapter_id)) do
      nil ->
        acc

      summary_text ->
        case NovelApplication.LedgerMaintenance.run(
               %{
                 work_id: work_id,
                 chapter_id: to_string(chapter_id),
                 summary_text: summary_text,
                 prose_text: Map.get(prose_by_chapter, to_string(chapter_id))
               },
               deps
             ) do
          {:ok, _} -> acc + 1
          {:degraded, reason} -> IO.puts("[replay] degraded: #{inspect(reason)}"); acc
        end
    end
  end)

entries = LedgerRepository.list(work_id)
all_entries = LedgerRepository.list_all(work_id)

IO.puts("[replay] chapters_replayed=#{replayed} ledger_entries=#{length(entries)}")

for entry <- entries do
  seen = Map.get(entry.payload, "last_seen_seq")
  IO.puts("  #{entry.subject_label}: #{entry.status} last_seen_seq=#{inspect(seen)} sources=#{length(entry.source_refs)}")
end

by_label = Map.new(entries, &{&1.subject_label, &1})
stalled = Enum.filter(entries, &(&1.status == "STALLED"))

# I-L1 断言：全部条目出处非空
il1_ok = Enum.all?(entries, &(&1.source_refs != []))

# M2 漂移靶：凌渊（ch23 后消失）必须 STALLED；后期主导者（沈逸或林浩）不得 STALLED
lingyuan_stalled = match?(%{status: "STALLED"}, by_label["凌渊"])
late_lead_on_track = Enum.any?(["沈逸", "林浩"], &match?(%{status: "ON_TRACK"}, by_label[&1]))

IO.puts(
  "[replay] 判定: I-L1=#{il1_ok} 凌渊STALLED=#{lingyuan_stalled} " <>
    "后期主角ON_TRACK=#{late_lead_on_track} STALLED计数=#{length(stalled)}"
)

# ── CP3：情绪曲线/冲突账 ──
emotion_entries = Enum.filter(all_entries, &(&1.ledger == "emotion_curve"))
emotion_counts = Enum.frequencies_by(emotion_entries, & &1.status)
main_conflict = Enum.find(all_entries, &(&1.ledger == "conflict" and &1.subject_ref == "main"))

IO.puts(
  "[replay] CP3 情绪曲线: #{inspect(emotion_counts)} 冲突主线: " <>
    "#{main_conflict && main_conflict.status} last_advanced=#{main_conflict && Map.get(main_conflict.payload, "last_advanced_seq")}"
)

cp3_ok =
  (emotion_counts["MATCHED"] || 0) >= 40 and (emotion_counts["DEVIATED"] || 0) >= 5 and
    main_conflict != nil and main_conflict.status == "ACTIVE" and
    Map.get(main_conflict.payload, "last_advanced_seq") >= 70

# ── CP2a：承诺/信息账 + 对账扫描（R1/R3/R4） ──
promise = Enum.find(all_entries, &(&1.ledger == "promise"))
leaks = Enum.filter(all_entries, &(&1.ledger == "information" and &1.status == "LEAKED"))
IO.puts("[replay] promise=#{inspect(promise && promise.subject_label)} leaked_entries=#{length(leaks)}")
for l <- leaks, do: IO.puts("  #{l.subject_label} (#{Map.get(l.payload, "fact")})")

{:ok, %{findings: findings, counts: counts}} =
  NovelApplication.LedgerReconciliationService.scan(
    work_id,
    NovelApplication.LedgerReconciliationService.persistence_deps()
  )

# CP2b：物化报告（TENTATIVE）→ latest 可读 → 探索面 ledgers 呈现
{:ok, report} =
  NovelApplication.LedgerReconciliationService.materialize(
    work_id,
    NovelApplication.LedgerReconciliationService.persistence_deps(),
    NovelApplication.LedgerReconciliationService.persistence_report_repo(),
    75
  )

latest = NovelPersistence.ReconciliationReportRepo.latest(work_id)

report_ok =
  is_map(report) and latest != nil and latest.adoption_status == "TENTATIVE" and
    latest.finding_count == length(findings)

IO.puts("[replay] CP2b 报告: id=#{latest && latest.id} findings=#{latest && latest.finding_count} status=#{latest && latest.adoption_status}")

# CP2c-1：对真实报告逐项裁决——第一条弧光停滞 accept_drift（凌渊类→DRIFTED），
# 前指泄露项 dismiss（结构化证据日志）。
stall_idx = Enum.find_index(latest.findings, &(&1["rule"] == "arc_stalled"))
leak_idx = Enum.find_index(latest.findings, &(&1["rule"] == "planned_info_leak"))

adjudicate = fn idx, disposition ->
  NovelApplication.LedgerAdjudicationService.adjudicate(
    %{work_id: work_id, report_id: latest.id, finding_index: idx,
      disposition: disposition, actor_ref: "replay_author", note: "M2 重放裁决"},
    NovelApplication.LedgerAdjudicationService.persistence_deps()
  )
end

{:ok, %{finding: stall_finding}} = adjudicate.(stall_idx, "accept_drift")
{:ok, _} = adjudicate.(leak_idx, "dismiss")

after_entries = LedgerRepository.list_all(work_id)
drifted = Enum.find(after_entries, &(&1.id == stall_finding["entry_ref"]))
report_after = NovelPersistence.ReconciliationReportRepo.get(work_id, latest.id)

dispositioned =
  report_after.findings
  |> Enum.count(&((&1["disposition"] || "") != ""))

adjudication_ok =
  drifted != nil and drifted.status == "DRIFTED" and dispositioned == 2 and
    report_after.adoption_status == "TENTATIVE"

IO.puts(
  "[replay] CP2c-1 裁决: #{drifted && drifted.subject_label}→#{drifted && drifted.status} " <>
    "已处置=#{dispositioned}/#{report_after.finding_count} 报告=#{report_after.adoption_status}"
)

IO.puts("[replay] reconcile findings=#{length(findings)} rules=#{inspect(counts)}")
for f <- findings, do: IO.puts("  [#{f.severity}] #{f.rule}: #{String.slice(f.signal, 0, 80)}")

genre_fired = Enum.any?(findings, &(&1.rule == "genre_promise_shift"))
leak_fired = Enum.any?(findings, &(&1.rule == "planned_info_leak" and String.contains?(&1.signal, "第60章")))
stall_reported = Enum.any?(findings, &(&1.rule == "arc_stalled"))

IO.puts(
  "[replay] CP2a 判定: genre_BROKEN候选=#{genre_fired} 前指第60章被报告=#{leak_fired} 停滞入报告=#{stall_reported}"
)

if replayed > 0 and il1_ok and lingyuan_stalled and late_lead_on_track and
     genre_fired and leak_fired and stall_reported and report_ok and adjudication_ok and cp3_ok do
  IO.puts("[replay] PASS —— 五本账全链（弧光/承诺/信息/情绪曲线/冲突 + 报告 + 裁决）在 M2 书上端到端成立")
else
  IO.puts("[replay] FAIL")
  System.halt(1)
end
