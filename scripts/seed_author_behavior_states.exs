alias NovelApplication.{MemoryManagementService, WorkService, WorkSessionService}
alias NovelDomain.ChapterPlanDirection
alias NovelFoundation.Enums.{MemorySourceType, MemoryStatus, MemoryType}
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

# B70 CP1：author-behavior 冻结语料的状态夹具（产品外脚本，仅隔离测试 DB 使用）。
# 只创建合成作品；不含真实作品数据；不预置验收感知字段。
#
# 用法：
#   mix run scripts/seed_author_behavior_states.exs            # 旧行为：构造 S1–S4 四个作品
#   mix run scripts/seed_author_behavior_states.exs -- --state S1-partial-multichapter
#   B70_AUTHOR_BEHAVIOR_STATE=S1-partial-multichapter mix run scripts/seed_author_behavior_states.exs
#
# 指定 state 时只构造该状态并显式建立 active session，输出：
#   [b70-author-behavior-seed] state=… work_id=… work_title=… session_id=…

state_ids = [
  "S1-partial-multichapter",
  "S2-empty-skeleton",
  "S3-pending-candidate-context",
  "S4-same-title-chapters"
]

state_ids_set = MapSet.new(state_ids)

requested =
  case System.argv() do
    ["--state", value | _] ->
      value

    _ ->
      System.get_env("B70_AUTHOR_BEHAVIOR_STATE")
  end

if is_binary(requested) and requested != "" and not MapSet.member?(state_ids_set, requested) do
  IO.puts(:stderr, "[b70-author-behavior-seed] 未知 state: #{requested}（可用: #{Enum.join(state_ids, ", ")}）")
  System.halt(64)
end

# B11：states.yml 声明的 chapter_plans 用产品存储结构写入 chapters.plan_direction
# （与产品同源：NovelDomain.ChapterPlanDirection.to_storage）。
chapter_plan = fn role, progress, change, emotion ->
  ChapterPlanDirection.to_storage(%{
    "chapter_role" => role,
    "plot_progress" => progress,
    "character_change" => change,
    "emotion" => emotion
  })
end

create_memories = fn work, entries ->
  Enum.each(entries, fn attrs ->
    {:ok, _memory} = MemoryManagementService.create(work.id, attrs)
  end)
end

insert_work = fn title, chapters_spec, chapter_plans ->
  {:ok, work} =
    WorkService.create(%{
      "title" => title,
      "genre" => "雨港悬疑",
      "core_selling_point" => "B70 author behavior state fixture",
      "target_reader" => "作者",
      "tone_preference" => "克制",
      "target_length" => 30_000,
      "planned_volumes" => 1,
      "serial_form" => "SERIALIZED"
    })

  volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1, status: "DRAFTING"})

  Enum.each(chapters_spec, fn {seq, chapter_title, status, prose} ->
    chapter =
      Repo.insert!(%Chapter{
        work_id: work.id,
        volume_id: volume.id,
        title: chapter_title,
        seq: seq,
        status: status,
        summary: "B70 state fixture chapter #{seq}",
        plan_direction: Map.get(chapter_plans, seq)
      })

    if is_binary(prose) do
      scene =
        Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 1", seq: 1})

      _draft =
        Repo.insert!(%Draft{
          work_id: work.id,
          scene_id: scene.id,
          content: prose,
          status: "ACCEPTED",
          revision: 1
        })
    end
  end)

  work
end

build = fn state ->
  case state do
    "S1-partial-multichapter" ->
      work =
        insert_work.(
          "B70 S1 部分多章",
          [
            {1, "第01章：灯楼夜话", "DRAFTING", "第01章正文：雨港的灯楼立在旧码头尽头，陈九斤守着旧账。"},
            {2, "第02章：井底回声", "DRAFTING", "第02章正文：井底回声落下来时，陈九斤没有睁眼。"},
            {3, "第03章：潮汐账页", "PLANNED", nil}
          ],
          %{
            1 => chapter_plan.("建置章", "灯楼旧账被发现", "陈九斤决定查账", "悬疑"),
            2 => chapter_plan.("推进章", "井底回声指向上一笔欠款", "陈九斤开始怀疑账房", "紧张"),
            3 => chapter_plan.("铺垫章", "潮汐账页浮现", "陈九斤找到新线索", "期待")
          }
        )

      create_memories.(work, [
        %{
          "content" => "陈九斤守着雨港旧灯楼，账页上记着一笔不能公开的旧账。",
          "summary" => "灯楼旧账",
          "type" => MemoryType.world_rule(),
          "scope" => "WORK",
          "status" => MemoryStatus.confirmed(),
          "source_type" => MemorySourceType.author_created()
        },
        %{
          "content" => "井底回声在雷雨夜出现，与上一笔欠款有关。",
          "summary" => "井底回声线索",
          "type" => MemoryType.foreshadowing(),
          "scope" => "WORK",
          "status" => MemoryStatus.confirmed(),
          "source_type" => MemorySourceType.author_created()
        }
      ])

      work

    "S2-empty-skeleton" ->
      insert_work.("B70 S2 空骨架", [], %{})

    "S3-pending-candidate-context" ->
      # B11：pending_candidates=1 无法用产品 API 在 seed 中真实构造（pending 候选来自
      # 工具产物/turn_result 持久化链路）；如实登记差异，不伪造 turn_result。
      work =
        insert_work.(
          "B70 S3 待采纳候选",
          [
            {1, "第01章：灯楼旧账", "DRAFTING", "第01章正文：灯楼旧账翻到第七页，账页上的水痕还没有干。"},
            {2, "第02章：潮汐账页", "PLANNED", nil}
          ],
          %{
            1 => chapter_plan.("建置章", "旧账翻到第七页", "陈九斤意识到水痕是新的", "悬疑"),
            2 => chapter_plan.("铺垫章", "潮汐账页出现", "陈九斤准备核对旧账", "期待")
          }
        )

      create_memories.(work, [
        %{
          "content" => "灯楼旧账翻到第七页时，账页上的水痕还没有干。",
          "summary" => "灯楼旧账水痕",
          "type" => MemoryType.foreshadowing(),
          "scope" => "WORK",
          "status" => MemoryStatus.confirmed(),
          "source_type" => MemorySourceType.author_created()
        },
        %{
          "content" => "潮汐账页记录了旧账的结算周期。",
          "summary" => "潮汐账页规则",
          "type" => MemoryType.world_rule(),
          "scope" => "WORK",
          "status" => MemoryStatus.confirmed(),
          "source_type" => MemorySourceType.author_created()
        }
      ])

      work

    "S4-same-title-chapters" ->
      insert_work.("B73 S4 同名章", [
        {1, "第01章：潮汐回声", "DRAFTING", "甲线正文：潮汐回声穿过空仓库，甲线守门人没有回头。"},
        {2, "第02章：潮汐回声", "DRAFTING", "乙线正文：潮汐回声停在旧船舱，乙线记录者合上账页。"}
      ], %{})
  end
end

session_for = fn work ->
  case WorkSessionService.resume(work.id) do
    {:ok, snapshot} -> snapshot.active_session.id
    _other -> nil
  end
end

if is_binary(requested) and requested != "" do
  work = build.(requested)
  session_id = session_for.(work)
  IO.puts("[b70-author-behavior-seed] state=#{requested} work_id=#{work.id} work_title=#{work.title} session_id=#{session_id}")
else
  s1 = build.("S1-partial-multichapter")
  s2 = build.("S2-empty-skeleton")
  s3 = build.("S3-pending-candidate-context")
  s4 = build.("S4-same-title-chapters")

  IO.puts(
    "[b70-author-behavior-seed] s1_work_id=#{s1.id} s2_work_id=#{s2.id} s3_work_id=#{s3.id} s4_work_id=#{s4.id} " <>
      "s1_title=B70 S1 部分多章 s2_title=B70 S2 空骨架 s3_title=B70 S3 待采纳候选 s4_title=B73 S4 同名章"
  )
end
