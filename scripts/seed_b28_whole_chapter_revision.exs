alias NovelApplication.{WorkService, WorkSessionService}
alias NovelPersistence.AdoptionRepository
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.Chapter
import Ecto.Query

# B28 CP0：整章修订隔离复现种子。
# - 一部合成样书，已采纳两章章节计划；第01章「夜潮」用于真实页面生成/编辑采纳两段
#   正文（初稿 2517 字符 + 零换行续写 1075 字符，由 driver 通过真实 edit_then_accept
#   写入，不由 seed 伪造 accepted prose）。
# - 额外插入一章与第01章**同名**的 planned 干扰章，验证既有章修订不得按标题错绑/合并
#   （B25 chapter_ref 唯一寻址）。
# 本脚本只写测试库；由 tauri_slice_verify.sh 在 reset_test_db 后以 MIX_ENV=test mix run 执行。
chapter_plan =
  Enum.join(
    [
      "第01章：夜潮: 沈砚在雨港旧书铺打烊前听见井底传来第七次灯焰爆响，决定当夜下井核对旧账。",
      "章功能定位：推进章",
      "情节推进：沈砚发现灯楼旧账与井底黑泉相连，决意下井",
      "人物变化：从旁观者转为主动查账者",
      "信息释放：灯楼只在子时后点灯，灯油出自井底黑泉",
      "伏笔动作：埋下第七盏灯与点灯人禁忌",
      "情绪定位：潮气与压抑",
      "章首拉力：灯焰爆响的倒计时",
      "章尾断章：井口浮起一枚不属于任何人的灯芯",
      "字数与场次：约 3600 字，两场（对账/下井）",
      "第02章：灯塔之下: 沈砚在井底灯塔遇见守夜人，得知灯油与旧账的来历。",
      "章功能定位：转折章",
      "情节推进：沈砚下井并在井底灯塔遇见守夜人，核对旧账来源",
      "人物变化：从孤身查账转为与守夜人形成脆弱合作",
      "信息释放：灯油确来自井底黑泉，灯楼以灯焰记账",
      "伏笔动作：守夜人提到点灯人不能回头看灯焰",
      "情绪定位：湿冷中的微光",
      "章首拉力：井底灯焰突然全部转蓝",
      "章尾断章：守夜人递来一张写有沈砚名字的旧账页",
      "字数与场次：约 3200 字，两场（下井/对峙）"
    ],
    "\n"
  )

create_work = fn title, selling, premise ->
  {:ok, work} =
    WorkService.create(%{
      "title" => title,
      "genre" => "雨港悬疑",
      "core_selling_point" => selling,
      "premise" => premise,
      "theme" => "旧账与无法回头的选择",
      "main_goal" => "沈砚查清灯楼旧账并决定是否点灯",
      "target_reader" => "关注悬疑与制度压迫的读者",
      "tone_preference" => "潮湿、克制、阴冷"
    })

  {:ok, snapshot} = WorkSessionService.resume(work.id)
  session_id = snapshot.active_session.id

  {:ok, persisted} =
    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: work.id,
      source_turn_ref: "turn_b28_chapter_plan_seed",
      artifact_id: "as_b28_chapter_plan_seed_#{work.id}",
      artifact_type: :outline_draft,
      base_revision: 1,
      content: chapter_plan,
      summary: "B28 两章章节计划"
    })

  chapters =
    Repo.all(
      from(c in Chapter,
        where: c.work_id == ^work.id,
        order_by: [asc: c.seq]
      )
    )

  [chapter_a | _] = chapters

  %{
    work: work,
    session_id: session_id,
    chapter_a: chapter_a,
    chapters: chapters,
    memory: persisted
  }
end

# 隔离作品：同名两章（第01章与新增 planned 章同标题）→ 验证同标题身份不按 title 合并/错绑。
isolation =
  create_work.(
    "B28 同标题章隔离作品",
    "同标题两章身份隔离",
    "同标题两章不得按标题合并"
  )

{:ok, duplicate} =
  %Chapter{}
  |> Chapter.changeset(%{
    work_id: isolation.work.id,
    volume_id: isolation.chapter_a.volume_id,
    title: isolation.chapter_a.title,
    seq: 99,
    status: "PLANNED"
  })
  |> Repo.insert()

# 主作品最后创建/恢复：真实工作台 lastOpened 自动恢复它；章节标题唯一。
main =
  create_work.(
    "B28 整章修订复现作品",
    "整章修订覆盖与同章采纳身份",
    "雨港灯楼以灯焰记账，沈砚追查井底黑泉与旧账"
  )

work = main.work
session_id = main.session_id
chapter_a = main.chapter_a
chapters = main.chapters
persisted = main.memory
duplicate_chapter_id = duplicate.id

IO.puts(
  "[b28-whole-chapter-revision-seed] work_id=#{work.id} session_id=#{session_id} " <>
    "chapter_a_id=#{chapter_a.id} chapter_a_title=#{chapter_a.title} " <>
    "isolation_work_id=#{isolation.work.id} isolation_session_id=#{isolation.session_id} " <>
    "isolation_chapter_a_id=#{isolation.chapter_a.id} " <>
    "isolation_duplicate_chapter_id=#{duplicate_chapter_id} " <>
    "chapter_count=#{length(chapters)} memory_item_id=#{persisted.memory_item_id}"
)
