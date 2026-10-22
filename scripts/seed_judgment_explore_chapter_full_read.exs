alias NovelApplication.{ReadingProjectionService, WorkService, WorkSessionService}
alias NovelFoundation.Enums.AdoptionStatus
alias NovelDomain.ProseWordCount
alias NovelPersistence.Repo
alias NovelPersistence.Schemas.{Chapter, ChapterSummary, Draft, Scene, Volume}

# B24 CP3：真实 Tauri 场景 `judgment-explore-chapter-full-read` 的确定性种子。
#
# 目标：一章**非编号自定义标题**「灰烬中的手印」（I-EXPLORE-READ-7：章标识不假设
# 「第NN章」格式），已采纳正文**恰好 7000 字符**、不含空行（无 "\n\n"，页切在
# 6000 处硬切，范围确定且可机械断言）：
#
#   chars   1– 6000：首页 —— 含开篇独有锚点
#   chars 6001– 7000：续读页 —— 含末页独有锚点（只在第二页出现）
#
# 同作品再放一章**同名标题**的干扰章：证明探索寻址必须用 DB 唯一
# `chapter_ref = "chapter:<chapters.id>"`，标题在重复时只能得到歧义，不能被
# first-match 静默取用（契约 §1.1(a) / I-EXPLORE-READ-7）：
#
#   章 A（干扰项）seq=1，计划中，无已采纳正文 → 索引行尾带「（计划中）」
#   章 B（目标）  seq=2，正文恰好 7000 字符（本文件构造）→ 索引行无「（计划中）」
#
# 判断章节索引因此渲染两行同名但不同 chapter_ref；替身按「无（计划中）」挑 B。
# 另 seed 超长 plan_direction（>600 字）与 accepted ChapterSummary（>500 字）：
# 观察 v2 把它们段内截断到 ≤500 / ≤400 后，正文单页仍必须完整 6000 字符
# （I-EXPLORE-READ-2 的回归守卫）。
#
# 本脚本只写测试库；由 scripts/tauri_slice_verify.sh 在 reset_test_db 之后以
# `MIX_ENV=test mix run` 运行（与既有 seed 同款）。末尾自校验失败即 raise。

chapter_title = "灰烬中的手印"
opening_anchor = "开篇锚点：灰烬里按出一枚手印"
ending_anchor = "末页锚点：井底浮现第七枚手印"
prose_total_chars = 7000

filler = "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线，他数着自己的呼吸等回声。"
unit = filler <> "\n"
unit_chars = String.length(unit)

# 构造恰好 7000 字符正文：
#   head  = 开篇锚点 + 可选单行填充 + "\n"
#   body  = 整行 filler 重复 + 末行填充（保证以 "\n" 结尾，末页锚点独占一行）
#   tail  = 末页锚点（不带换行，正文最后一个字符即锚点末字）
# 无 "\n\n"，因此探索页切走 6000 硬切分支。
body_target =
  prose_total_chars - String.length(opening_anchor <> "\n") - String.length(ending_anchor)

# 让余数不为 1：余数 1 时无法在不制造空行的前提下补齐，改为把 1 个填充字放进首行。
head_padding_chars = if rem(body_target, unit_chars) == 1, do: 1, else: 0
body_target = body_target - head_padding_chars

head =
  opening_anchor <> String.duplicate("烬", head_padding_chars) <> "\n"

full_units = div(body_target, unit_chars)
rest_chars = body_target - full_units * unit_chars
unit_block = String.duplicate(unit, full_units)

body =
  cond do
    rest_chars == 0 -> unit_block
    rest_chars == 1 -> unit_block <> "\n"
    true -> unit_block <> String.duplicate("烬", rest_chars - 1) <> "\n"
  end

prose = head <> body <> ending_anchor

# ── 种子自校验：任何一条不满足都直接 raise，避免把错误数据写进验收证据 ──
check! = fn condition, message ->
  if condition, do: :ok, else: raise(message)
end

check!.(
  String.length(prose) == prose_total_chars,
  "prose length must be #{prose_total_chars}, got #{String.length(prose)}"
)

check!.(not String.contains?(prose, "\n\n"), "prose must not contain blank lines")
check!.(String.starts_with?(prose, opening_anchor), "prose must start with opening anchor")

{ending_byte_index, _} = :binary.match(prose, ending_anchor)
ending_char_index = String.length(binary_part(prose, 0, ending_byte_index))

check!.(
  ending_char_index >= 6000 and ending_char_index + String.length(ending_anchor) <= 7000,
  "ending anchor must live entirely in chars 6001..7000, got index #{ending_char_index}"
)

page_one = String.slice(prose, 0, 6000)
page_two = String.slice(prose, 6000, 1000)

check!.(
  String.contains?(page_one, opening_anchor) and String.contains?(page_two, ending_anchor),
  "page anchors are not inside their expected pages"
)

check!.(
  not String.contains?(page_one, ending_anchor) and not String.contains?(page_two, opening_anchor),
  "page anchors must be page-unique"
)

prose_word_count = ProseWordCount.count(prose)

# 超长设计态材料：>500 的计划段与 >400 的摘要段（观察 v2 段内截断的回归守卫）。
long_plan_progress = String.duplicate("核对全章重复并保留每处手印的位置线索，", 40)
long_summary = String.duplicate("本章围绕灰烬中的手印展开全章核对与逐段追踪，重复段落逐一比对。", 30)

plan_direction = %{
  "chapter_role" => "推进章",
  "plot_progress" => long_plan_progress,
  "character_change" => "从怀疑重复转为确认手印线索确有呼应",
  "information_release" => "井底手印与灰烬手印之间的呼应关系浮出水面",
  "emotion" => "压抑中带寒意",
  "opening_hook" => "灰烬里按出的第一枚手印",
  "ending_hook" => "井底浮现第七枚手印",
  "word_count_and_scenes" => "约 7000 字符，单场",
  "scene_plans" => [
    %{
      "title" => "灰烬手印",
      "goal" => "核对全章手印细节",
      "emotion" => "压抑",
      "sensory" => "灰烬、井风、湿冷石壁"
    }
  ],
  "chapter_mission" => %{
    "mission_id" => "cm_b24_full_read",
    "statement" => "本章必须让全章手印线索被完整核对。",
    "must_advance" => [%{"text" => "读完 7000 字整章"}],
    "must_avoid" => [%{"text" => "只读开头就下结论"}],
    "status" => "CONFIRMED",
    "source" => "author"
  }
}

{:ok, work} =
  WorkService.create(%{
    "title" => "灰烬手印验证作品",
    "genre" => "悬疑",
    "core_selling_point" => "全章正文可完整读取并允许续读",
    "premise" => "灰烬里的手印与井底的第七枚手印隔着整章正文遥相呼应",
    "theme" => "在灰烬与井底之间寻找被掩埋的痕迹",
    "main_goal" => "作者能核对整章正文里的重复与呼应",
    "target_reader" => "关注全章可读性的作者",
    "tone_preference" => "冷、压抑、具象"
  })

{:ok, snapshot} = WorkSessionService.resume(work.id)
session_id = snapshot.active_session.id

volume =
  %Volume{}
  |> Volume.changeset(%{work_id: work.id, title: "第一卷·灰烬", seq: 1})
  |> Repo.insert!()

# 章 A（干扰项）：同名、seq=1、计划中且无已采纳正文；标题因此不唯一。
distractor_chapter =
  %Chapter{}
  |> Chapter.changeset(%{
    work_id: work.id,
    volume_id: volume.id,
    title: chapter_title,
    seq: 1,
    plan_direction: %{"plot_progress" => "同名的计划中干扰章，用于验证标题歧义与 ref 消歧。"}
  })
  |> Repo.insert!()

# 章 B（目标）：同名、seq=2、有已采纳正文；寻址必须复制它的 chapter_ref。
target_chapter =
  %Chapter{}
  |> Chapter.changeset(%{
    work_id: work.id,
    volume_id: volume.id,
    title: chapter_title,
    seq: 2,
    plan_direction: plan_direction
  })
  |> Repo.insert!()

scene =
  %Scene{}
  |> Scene.changeset(%{work_id: work.id, chapter_id: target_chapter.id, title: "场1", seq: 1})
  |> Repo.insert!()

%ChapterSummary{}
|> ChapterSummary.changeset(%{
  work_id: work.id,
  chapter_id: target_chapter.id,
  status: AdoptionStatus.accepted(),
  summary_text: long_summary
})
|> Repo.insert!()

%Draft{}
|> Draft.changeset(%{
  work_id: work.id,
  scene_id: scene.id,
  content: prose,
  status: AdoptionStatus.accepted(),
  revision: 1
})
|> Repo.insert!()

# 用产品读取投影再校验一次：探索服务读到的正文字符串必须与 seed 字节一致。
{:ok, projection} = ReadingProjectionService.chapter_content(target_chapter.id, work.id)
projected_prose = projection.scenes |> Enum.map_join("\n", & &1.content)

check!.(
  projected_prose == prose,
  "reading projection prose differs from seeded prose"
)

# 章 A（干扰项）没有已采纳正文：其索引行必须带「（计划中）」；目标章 B 不带。
{:ok, distractor_projection} =
  ReadingProjectionService.chapter_content(distractor_chapter.id, work.id)

distractor_prose = distractor_projection.scenes |> Enum.map_join("\n", & &1.content)

check!.(distractor_prose == "", "distractor chapter must have no adopted prose")
check!.(distractor_chapter.seq == 1, "distractor chapter seq must be 1")
check!.(target_chapter.seq == 2, "target chapter seq must be 2")

# 索引行与判断/探索面同源（ChapterListBudget.entry_line），替身与 verifier 都以它为准。
distractor_line =
  NovelApplication.ChapterListBudget.entry_line(%{
    title: chapter_title,
    seq: distractor_chapter.seq,
    id: distractor_chapter.id,
    has_prose: false
  })

target_line =
  NovelApplication.ChapterListBudget.entry_line(%{
    title: chapter_title,
    seq: target_chapter.seq,
    id: target_chapter.id,
    has_prose: true
  })

check!.(
  distractor_line ==
    "- 第 1 章「#{chapter_title}」[chapter_ref=chapter:#{distractor_chapter.id}]（计划中）",
  "unexpected distractor index line: #{distractor_line}"
)

check!.(
  target_line == "- 第 2 章「#{chapter_title}」[chapter_ref=chapter:#{target_chapter.id}]",
  "unexpected target index line: #{target_line}"
)

same_title_count =
  Chapter
  |> Repo.all()
  |> Enum.count(&(&1.work_id == work.id and &1.title == chapter_title))

check!.(
  same_title_count == 2,
  "expected two same-title chapters (ref disambiguation), got #{same_title_count}"
)

IO.puts(
  "[judgment-explore-chapter-full-read-seed] work_id=#{work.id} " <>
    "session_id=#{session_id} chapter_id=#{target_chapter.id} " <>
    "chapter_ref=chapter:#{target_chapter.id} chapter_title=#{chapter_title} " <>
    "chapter_seq=#{target_chapter.seq} prose_chars=#{String.length(prose)} " <>
    "prose_word_count=#{prose_word_count} same_title_chapters=#{same_title_count} " <>
    "opening_anchor=#{opening_anchor} ending_anchor=#{ending_anchor}"
)
