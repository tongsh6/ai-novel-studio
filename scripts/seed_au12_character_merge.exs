# SC-AU12 身份归并场景 seed：复刻 m4b 标本形状——同名双行「沈洛」（拦截层落地前的
# 存量重复登记）+ 别名行「洛公子」，其中两行同名角色各挂一条弧光账（同 label 不同
# subject_ref，正是「有 roster 就有 arc 条目、同名重复立刻变重复账」的病灶标本）。
# 归并动作由外部 driver 在真实档案页面发起，seed 不预制任何合并结果。
import Ecto.Query

alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.{AdoptionRepository, LedgerRepository, Repo}
alias NovelPersistence.Schemas.Character

{:ok, work} =
  WorkService.create(%{
    "title" => "AU12 身份归并验收作品",
    "genre" => "赛博修仙",
    "core_selling_point" => "同名与别名角色档案行由作者裁决归并",
    "target_reader" => "接手旧稿、档案里堆了重复角色行的作者",
    "tone_preference" => "克制、紧张、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

# 已采纳一章计划与正文（CP3 盘点材料）：盘点只能读 accepted 材料；正文里的
# 「洛公子」正是归并后将进入已在档别名名单的称呼。
{:ok, _plan} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au12_merge_seed_plan",
    artifact_id: "as_au12_merge_seed_plan",
    artifact_type: :outline_draft,
    base_revision: 1,
    content: "第01章：黑市对账夜: 沈洛以洛公子的名号潜入黑市，追查灵气账单的暗扣流向。",
    summary: "AU12 一章章节计划"
  })

{:ok, _prose} =
  AdoptionRepository.persist(%{
    actor_ref: "author",
    work_id: work.id,
    source_turn_ref: "turn_au12_merge_seed_prose",
    artifact_id: "as_au12_merge_seed_prose",
    artifact_type: :prose_fragment,
    base_revision: 1,
    content:
      "黑市只认洛公子这个名号。他把三张灵气账单摊在摊位的冷光下，逐行核对暗扣的流向，" <>
        "摊主压低声音提醒他，公司巡检今晚会来。第二个自称沈洛的人上周也来问过同样的问题，" <>
        "这让他决定当面查个清楚。",
    summary: "第01章：黑市对账夜"
  })

characters = [
  {"沈洛", "核心视角人物，被动觉醒线：从缴费者转为追查者。"},
  {"沈洛", "核心视角人物，重复登记行：领袖式反抗与调频技术线。"},
  {"洛公子", "黑市里对沈洛的称呼，情报线上以此名活动。"}
]

for {name, profile} <- characters do
  {:ok, _} =
    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: work.id,
      source_turn_ref: "turn_au12_merge_seed_#{name}_#{System.unique_integer([:positive])}",
      artifact_id: "as_au12_merge_seed_#{System.unique_integer([:positive])}",
      artifact_type: :character_seed,
      base_revision: 1,
      content: profile,
      summary: name
    })
end

# 弧光账挂真实 character id（归并事务按 subject_ref == character.id 归一）。
shenluo_rows =
  Repo.all(
    from(c in Character,
      where: c.work_id == ^work.id and c.name == "沈洛",
      order_by: [asc: c.inserted_at]
    )
  )

[first_shenluo, second_shenluo] = shenluo_rows

{:ok, _} =
  LedgerRepository.upsert(%{
    work_id: work.id,
    ledger: "arc",
    subject_kind: "character",
    subject_ref: to_string(first_shenluo.id),
    subject_label: first_shenluo.name,
    status: "ON_TRACK",
    payload: %{"last_seen_seq" => 3},
    source_refs: ["chapter_summary:au12_seed_a"]
  })

{:ok, _} =
  LedgerRepository.upsert(%{
    work_id: work.id,
    ledger: "arc",
    subject_kind: "character",
    subject_ref: to_string(second_shenluo.id),
    subject_label: second_shenluo.name,
    status: "STALLED",
    payload: %{"last_seen_seq" => 5},
    source_refs: ["chapter_summary:au12_seed_b"]
  })

IO.puts(
  "[au12-character-merge-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "characters=3 duplicate_name=沈洛 arc_entries=2"
)
