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
alias NovelPersistence.Schemas.{Chapter, ChapterSummary, Character, Work}

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

deps = %{
  roster: &NovelPersistence.WorkArchiveRepo.characters/1,
  chapter_index: &LedgerRepository.chapter_index/1,
  repo: %{list: &LedgerRepository.list/1, upsert: &LedgerRepository.upsert/1}
}

replayed =
  Enum.reduce(chapters, 0, fn {chapter_id, _seq, _title}, acc ->
    case Map.get(summaries, to_string(chapter_id)) do
      nil ->
        acc

      summary_text ->
        case NovelApplication.LedgerMaintenance.run(
               %{work_id: work_id, chapter_id: to_string(chapter_id), summary_text: summary_text},
               deps
             ) do
          {:ok, _} -> acc + 1
          {:degraded, reason} -> IO.puts("[replay] degraded: #{inspect(reason)}"); acc
        end
    end
  end)

entries = LedgerRepository.list(work_id)

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

if replayed > 0 and il1_ok and lingyuan_stalled and late_lead_on_track do
  IO.puts("[replay] PASS —— M2 漂移靶被账面暴露")
else
  IO.puts("[replay] FAIL")
  System.halt(1)
end
