defmodule NovelApplication.ExplorationServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{ExplorationService, WorkService}
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, ChapterSummary, Draft, MemoryItem, Scene, Volume}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @prose "陈九斤蹲在矿区的出气口边上，把今天的灵气账单摊开在膝盖上。宗门的抽成又涨到了七成。"

  test "catalog 与 prompt 段是同一真源" do
    names = ExplorationService.tool_names()
    assert names == ~w(prose_search chapter_read archive_read session_adoptions memory_recall)

    section = ExplorationService.catalog_section()
    assert section =~ "## 探索目录"
    Enum.each(names, fn name -> assert section =~ name end)
  end

  test "会话候选查询覆盖被摘要省略的对象，分页稳定且拒绝跨作品/会话", do: verify_adoption_exploration()

  defp verify_adoption_exploration do
    {:ok, work} = WorkService.create(%{title: "完整待办"})
    {:ok, session} = NovelPersistence.WorkSessionRepo.ensure_active_for_work(work.id)

    for n <- 1..15 do
      entry = %{
        artifact_id: "item-#{n}",
        artifact_type: "world_setting",
        adoption_status: "TENTATIVE",
        payload: %{items: [%{title: "第#{n}份资料", body: "原文-#{n}"}]}
      }

      {:ok, _} =
        NovelPersistence.MemoryLog.record(%{
          workspace_id: work.id,
          session_id: session.id,
          role: "assistant",
          turn_id: "source-#{n}",
          content: %{
            text: "待采纳",
            turn_result: %{
              turn_id: "source-#{n}",
              adoption_state: %{pending: [entry], resolved: []}
            }
          }
        })
    end

    for n <- 1..85 do
      {:ok, _} =
        NovelPersistence.MemoryLog.record(%{
          workspace_id: work.id,
          session_id: session.id,
          role: "user",
          turn_id: "later-#{n}",
          content: %{text: "闲聊"}
        })
    end

    state = NovelPersistence.InteractionLifecycle.context(work.id, session.id)

    facts =
      state
      |> NovelApplication.TurnInteractionService.context_section()
      |> String.split("\n")
      |> Enum.find_value(fn line ->
        case Jason.decode(line) do
          {:ok, %{"omitted_adoptions" => _} = data} -> data
          _ -> nil
        end
      end)

    assert facts["pending_adoption_count"] == 15
    assert facts["omitted_adoptions"] == 3
    assert length(facts["pending_adoptions"]) == 12
    assert {:ok, first} = ExplorationService.run(work.id, "session_adoptions", "", session.id)
    assert %{"matched_count" => 15, "next_offset" => 3} = Jason.decode!(first.summary)

    refs =
      for offset <- [0, 3, 6, 9, 12], reduce: [] do
        acc ->
          {:ok, page} =
            ExplorationService.run(
              work.id,
              "session_adoptions",
              Jason.encode!(%{query: "", offset: offset}),
              session.id
            )

          acc ++ page.refs
      end

    assert length(Enum.uniq(refs)) == 15

    assert {:ok, found} =
             ExplorationService.run(work.id, "session_adoptions", "第1份资料", session.id)

    assert found.refs == ["item-1"]
    assert found.summary =~ "原文-1"

    assert {:ok, by_ref} =
             ExplorationService.run(work.id, "session_adoptions", "item-1", session.id)

    assert by_ref.refs == ["item-1"]
    {:ok, other} = WorkService.create(%{title: "其它作品"})

    assert {:error, :active_session_not_found} =
             ExplorationService.run(other.id, "session_adoptions", "", session.id)

    assert {:error, :active_session_not_found} =
             ExplorationService.run(work.id, "session_adoptions", "", nil)

    assert {:error, :invalid_adoption_query} =
             ExplorationService.run(
               work.id,
               "session_adoptions",
               ~s({"query":"","offset":-1}),
               session.id
             )

    {:ok, _} = NovelPersistence.WorkSessionRepo.create_active(%{work_id: work.id})

    assert {:error, :active_session_not_found} =
             ExplorationService.run(work.id, "session_adoptions", "", session.id)
  end

  test "prose_search：命中带章出处片段；未命中诚实说明" do
    work_id = seed_work_with_prose()

    assert {:ok, observation} = ExplorationService.run(work_id, "prose_search", "灵气账单")
    assert observation.tool == "prose_search"
    assert observation.summary =~ "灵气账单"
    assert observation.summary =~ "第01章"
    assert [ref | _] = observation.refs
    assert ref =~ "chapter:"

    assert {:ok, miss} = ExplorationService.run(work_id, "prose_search", "剑冢秘藏")
    assert miss.summary =~ "未检索到"
    assert miss.refs == []
  end

  test "chapter_read：三态渲染（设计计划/章摘要/已采纳正文）；找不到时列出现有章节" do
    work_id = seed_work_with_prose()

    assert {:ok, observation} = ExplorationService.run(work_id, "chapter_read", "第01章")
    # 实现态正文
    assert observation.summary =~ "【正文】"
    assert observation.summary =~ "灵气账单"
    assert observation.summary =~ "有效字数"
    # 设计态与压缩层缺席时诚实说明
    assert observation.summary =~ "【计划】（本章尚无设计计划）"
    assert observation.summary =~ "【摘要】（尚无章摘要）"

    assert {:ok, miss} = ExplorationService.run(work_id, "chapter_read", "第99章")
    assert miss.summary =~ "没有找到"
    assert miss.summary =~ "第01章"
  end

  test "chapter_read：结构化章计划与治理摘要在场时按段渲染（CP5b 补面 A/B）" do
    work_id = seed_work_with_prose()

    chapter =
      Chapter
      |> Repo.all()
      |> Enum.find(&(&1.work_id == work_id))

    chapter
    |> Chapter.changeset(%{
      plan_direction: %{
        "chapter_role" => "推进章",
        "plot_progress" => "主角发现灵气带宽被公司暗中抽走",
        "emotion" => "压抑中带爆发",
        "ending_hook" => "灵气账单上浮现出陌生的扣费条目",
        "scene_plans" => [
          %{
            "title" => "对账",
            "goal" => "确认暗扣",
            "agendas" => "主角要证据",
            "emotion" => "压抑",
            "opposition" => "摊主拖延",
            "turn" => "残页暴露",
            "consequence" => "暗扣坐实",
            "reader_learns" => "公司抽走频段",
            "protagonist_learns" => "账单编号",
            "remains_hidden" => "幕后主使",
            "surface_topic" => "对账寒暄",
            "hidden_conflict" => "互相试探",
            "sensory" => "潮湿霉味、风扇噪音"
          },
          %{"title" => "夜巡"}
        ],
        "chapter_mission" => %{
          "mission_id" => "cm_1",
          "statement" => "本章必须让暗扣被确认。",
          "must_advance" => [%{"text" => "确认暗扣"}],
          "must_avoid" => [%{"text" => "不揭示幕后"}],
          "status" => "AUTHOR_EDITED",
          "source" => "author"
        }
      }
    })
    |> Repo.update!()

    %ChapterSummary{}
    |> ChapterSummary.changeset(%{
      work_id: work_id,
      chapter_id: chapter.id,
      status: AdoptionStatus.accepted(),
      summary_text: "主角在矿区核对账单，确认宗门抽成异常。"
    })
    |> Repo.insert!()

    assert {:ok, observation} = ExplorationService.run(work_id, "chapter_read", "第01章")
    assert observation.summary =~ "【计划】功能定位：推进章"
    assert observation.summary =~ "情节推进：主角发现灵气带宽被公司暗中抽走"
    assert observation.summary =~ "章尾断章：灵气账单上浮现出陌生的扣费条目"
    # NEM04 刀③探索面同步律：规划落库的逐场三槽在判断循环内可读。
    # B11C CP1：VS-00E §1 场级结构子槽同批可读（缺子槽不渲染）。
    assert observation.summary =~
             "场次计划：对账（目标：确认暗扣；议程：主角要证据；情绪：压抑；阻力：摊主拖延；转折：残页暴露；后果：暗扣坐实；读者得知：公司抽走频段；主角得知：账单编号；仍隐藏：幕后主使；对白表面：对账寒暄；潜台词：互相试探；感官：潮湿霉味、风扇噪音） / 夜巡"

    # WR01b 探索面同步律：落章计划的本章使命与裁决状态在判断循环内可读。
    assert observation.summary =~ "本章使命：本章必须让暗扣被确认。（作者改写）；必须推进：确认暗扣；不得：不揭示幕后"
    assert observation.summary =~ "【摘要】主角在矿区核对账单，确认宗门抽成异常。"
  end

  test "archive_read：五个档案面可读，未知面诚实报错" do
    work_id = seed_work_with_prose()
    insert_memory(work_id, MemoryType.foreshadowing(), "灵脉泵站的白色管道走向内门")

    assert {:ok, profile} = ExplorationService.run(work_id, "archive_read", "profile")
    assert profile.summary =~ "灵气矿工"

    assert {:ok, foreshadowing} = ExplorationService.run(work_id, "archive_read", "foreshadowing")
    assert foreshadowing.summary =~ "灵脉泵站"

    assert {:ok, stats} = ExplorationService.run(work_id, "archive_read", "stats")
    assert stats.summary =~ "总字数"

    assert {:error, {:unknown_archive_facet, "secret_facet", _facets}} =
             ExplorationService.run(work_id, "archive_read", "secret_facet")
  end

  test "archive_read：记忆类面按类型枚举（CP5b 补面 C）" do
    work_id = seed_work_with_prose()
    insert_memory(work_id, MemoryType.current_state(), "陈九斤当前欠费三个月，被限制进入内门")
    insert_memory(work_id, MemoryType.relationship(), "陈九斤与调频师阿绫是互相试探的盟友")
    insert_memory(work_id, MemoryType.author_preference(), "打斗场面偏好短句与具象动作")

    assert {:ok, state} = ExplorationService.run(work_id, "archive_read", "current_state")
    assert state.summary =~ "欠费三个月"

    assert {:ok, relationship} = ExplorationService.run(work_id, "archive_read", "relationships")
    assert relationship.summary =~ "调频师阿绫"

    assert {:ok, preference} = ExplorationService.run(work_id, "archive_read", "preferences")
    assert preference.summary =~ "短句与具象动作"
  end

  test "memory_recall：检索确认记忆；未知工具诚实报错" do
    work_id = seed_work_with_prose()
    insert_memory(work_id, MemoryType.world_rule(), "灵气按吨计费，欠费者禁入内门")

    assert {:ok, observation} = ExplorationService.run(work_id, "memory_recall", "灵气")
    assert observation.summary =~ "灵气"

    assert {:error, {:unknown_exploration_tool, "time_travel"}} =
             ExplorationService.run(work_id, "time_travel", "任何")
  end

  # ── B24 CP1：chapter_read 观察 v2（chapter_ref 唯一寻址 + 分段预算 + 续读） ──
  # 契约：tasks/slices/B24-exploration-chapter-full-read.md §1.1；
  # 不变量 I-EXPLORE-READ-1..9。

  @long_title "灰烬中的手印"

  test "chapter_read v2：长章两页覆盖——首页 6000 + 续读页余量，首尾相接无重叠无缺口" do
    anchor = "末页独有锚点"
    prose = long_prose(7000 - String.length(anchor)) <> anchor
    {work_id, chapter_id} = seed_work_with_chapter(@long_title, prose)
    chapter_ref = "chapter:#{chapter_id}"

    assert {:ok, page1} = ExplorationService.run(work_id, "chapter_read", @long_title)

    assert page1.refs == [chapter_ref]
    assert page1.chapter_ref == chapter_ref
    assert page1.chapter_seq == 1
    assert page1.prose_total_chars == 7000
    assert page1.next_offset == 6000
    assert page1.prose_range == %{start: 1, end: 6000}
    # 观察首行 = seq + title 双面身份（模型面；ref 在结构字段/索引里）
    assert page1.summary =~ "「#{@long_title}」（第 1 章）"
    assert page1.summary =~ "【正文】第 1–6000 字符 / 共 7000 字符"
    assert page1.summary =~ ~r/（有效字数 \d+）/
    assert String.contains?(page1.summary, String.slice(prose, 0, 6000))
    refute String.contains?(page1.summary, anchor)

    assert page1.summary =~
             ~s(【续读】剩余 1000 字符；用 {"chapter_ref":"#{chapter_ref}","offset":6000} 继续。)

    # I-EXPLORE-READ-2：正文页不被设计态材料挤占；整条观察 ≤7200。
    assert String.length(page1.summary) <= 7200
    assert page1.activity_summary =~ "已阅读章节正文「#{@long_title}」（第 1 章）（有效字数"

    # 续读必须复用同一 chapter_ref（footer 逐字复制）。
    continuation = ~s({"chapter_ref":"#{chapter_ref}","offset":6000})
    assert {:ok, page2} = ExplorationService.run(work_id, "chapter_read", continuation)

    assert page2.next_offset == nil
    assert page2.chapter_ref == chapter_ref
    assert page2.prose_total_chars == 7000
    assert page2.prose_range == %{start: 6001, end: 7000}
    assert page2.summary =~ "「#{@long_title}」（第 1 章）"
    assert page2.summary =~ "【正文】第 6001–7000 字符 / 共 7000 字符"
    assert String.contains?(page2.summary, String.slice(prose, 6000, 1000))
    assert String.contains?(page2.summary, anchor)
    # 续读页不重复计划/摘要，也没有下一页 footer。
    refute page2.summary =~ "【计划】"
    refute page2.summary =~ "【摘要】"
    refute page2.summary =~ "【续读】"
    assert page2.activity_summary == "已阅读章节正文「#{@long_title}」（第 1 章；第 6001–7000 字符 / 共 7000 字符）。"
    # I-EXPLORE-READ-1：页首尾相接 = page1 末字符之后就是 page2 首字符。
    assert page2.prose_range.start == page1.prose_range.end + 1
    assert page2.prose_range.end == page1.prose_total_chars
  end

  test "chapter_read v2：短章一页返回完整正文，无续读 footer" do
    prose = long_prose(1800)
    {work_id, _chapter_id} = seed_work_with_chapter("恐惧体验", prose)

    assert {:ok, observation} = ExplorationService.run(work_id, "chapter_read", "恐惧体验")

    assert observation.next_offset == nil
    assert observation.prose_total_chars == 1800
    assert observation.prose_range == %{start: 1, end: 1800}
    assert observation.summary =~ "「恐惧体验」（第 1 章）"
    assert observation.summary =~ "【正文】第 1–1800 字符 / 共 1800 字符"
    assert String.contains?(observation.summary, prose)
    refute observation.summary =~ "【续读】"
    assert observation.activity_summary =~ "已阅读章节正文「恐惧体验」（第 1 章）（有效字数"
  end

  test "chapter_read v2：chapter_ref 是规范寻址（含 JSON offset），无效/跨作品 ref 诚实报错不 fallback" do
    prose = long_prose(1000)
    {work_id, chapter_id} = seed_work_with_chapter(@long_title, prose)
    chapter_ref = "chapter:#{chapter_id}"

    assert {:ok, by_ref} =
             ExplorationService.run(
               work_id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: chapter_ref, offset: 0})
             )

    assert by_ref.refs == [chapter_ref]
    assert by_ref.chapter_ref == chapter_ref
    assert by_ref.summary =~ "「#{@long_title}」"

    # 格式非法的 ref → 参数错误（不 fallback 到标题/序号）
    for bad_ref <- ["chapter:not-a-uuid", "chapter:", "not-a-ref"] do
      assert {:ok, invalid} =
               ExplorationService.run(
                 work_id,
                 "chapter_read",
                 Jason.encode!(%{chapter_ref: bad_ref, offset: 0})
               )

      assert invalid.summary =~ "章节检索参数无法识别"
      refute invalid.summary =~ "【正文】第"
    end

    # 合法 UUID 但不属于当前 work → 找不到（不泄露其它作品章节）
    other_ref = "chapter:#{Ecto.UUID.generate()}"

    assert {:ok, foreign} =
             ExplorationService.run(
               work_id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: other_ref, offset: 0})
             )

    assert foreign.summary =~ "没有找到"
    refute foreign.summary =~ "【正文】第"
  end

  test "chapter_read v2：chapter_seq 是 work 内唯一序号（CP3 唯一索引），唯一命中可读" do
    prose = long_prose(400)
    {work_id, chapter_id} = seed_work_with_chapter("唯一序号章", prose, seq: 2)

    # B25 CP3（I-CH-3）：seq 在 work 内唯一由 DB 唯一索引兜底（迁移 20261023000001）——
    # 跨卷同 seq 已不可能存在；防御性歧义分支保留在读取服务里（历史迁移前只读场景）。
    volume = Volume |> Repo.all() |> Enum.find(&(&1.work_id == work_id))

    assert {:error, changeset} =
             %Chapter{}
             |> Chapter.changeset(%{
               work_id: work_id,
               volume_id: volume.id,
               title: "撞号章",
               seq: 2
             })
             |> Repo.insert()

    assert Keyword.has_key?(changeset.errors, :seq)

    assert {:ok, by_seq} =
             ExplorationService.run(
               work_id,
               "chapter_read",
               Jason.encode!(%{chapter_seq: 2, offset: 0})
             )

    assert by_seq.refs == ["chapter:#{chapter_id}"]
  end

  test "chapter_read v2：重复标题歧义即错误并列候选 ref（禁止 first-match）" do
    prose = long_prose(300)
    {work_id, first_id} = seed_work_with_chapter("午夜来电", prose, seq: 1)

    {^work_id, second_id} =
      seed_work_with_chapter("午夜来电", prose, work_id: work_id, seq: 2)

    assert {:ok, ambiguous} = ExplorationService.run(work_id, "chapter_read", "午夜来电")
    assert ambiguous.summary =~ "存在歧义"
    assert ambiguous.summary =~ "chapter:#{first_id}"
    assert ambiguous.summary =~ "chapter:#{second_id}"
    refute ambiguous.summary =~ "【正文】第"

    # 标题片段命中多章同样歧义
    assert {:ok, partial} = ExplorationService.run(work_id, "chapter_read", "来电")
    assert partial.summary =~ "存在歧义"

    # 精确标题唯一命中的正常路径不受影响（追加一个不同的标题，精确优先）
    {^work_id, third_id} =
      seed_work_with_chapter("午夜来电·终章", prose, work_id: work_id, seq: 3)

    assert {:ok, exact} = ExplorationService.run(work_id, "chapter_read", "午夜来电·终章")
    assert exact.refs == ["chapter:#{third_id}"]
  end

  test "chapter_read v2：优先在段落边界切页，后一页仍从 next_offset 精确接续" do
    prefix = String.duplicate("风", 5900)
    prose = prefix <> "\n\n" <> String.duplicate("雨", 1100)
    {work_id, chapter_id} = seed_work_with_chapter(@long_title, prose)
    chapter_ref = "chapter:#{chapter_id}"

    assert {:ok, page1} = ExplorationService.run(work_id, "chapter_read", @long_title)
    assert page1.prose_range == %{start: 1, end: 5900}
    assert page1.next_offset == 5900
    assert page1.summary =~ "【正文】第 1–5900 字符 / 共 7002 字符"

    assert {:ok, page2} =
             ExplorationService.run(
               work_id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: chapter_ref, offset: 5900})
             )

    assert page2.prose_range == %{start: 5901, end: 7002}
    assert page2.next_offset == nil
    assert page2.summary =~ String.duplicate("雨", 1100)
    # 无缺口：两页 offsets 直接接续。
    assert page2.prose_range.start == page1.prose_range.end + 1
  end

  test "chapter_read v2：计划/摘要再长，正文单页仍 ≥6000（I-EXPLORE-READ-2 回归守卫）" do
    prose = long_prose(7000)

    {work_id, _chapter_id} =
      seed_work_with_chapter(@long_title, prose,
        plan_direction: %{"plot_progress" => String.duplicate("推进", 400)},
        summary: String.duplicate("摘要", 300)
      )

    assert {:ok, page1} = ExplorationService.run(work_id, "chapter_read", @long_title)

    [_, after_plan] = String.split(page1.summary, "【计划】", parts: 2)
    [plan_text, _] = String.split(after_plan, "\n【摘要】", parts: 2)
    assert String.length(plan_text) <= 500
    assert String.ends_with?(plan_text, "…（略）")

    [_, after_summary] = String.split(page1.summary, "【摘要】", parts: 2)
    [summary_text, _] = String.split(after_summary, "\n【正文】", parts: 2)
    assert String.length(summary_text) <= 400
    assert String.ends_with?(summary_text, "…（略）")

    # 正文页完整 6000 字符（旧 1500 预算下这里只剩 216 字）。
    assert page1.summary =~ "【正文】第 1–6000 字符 / 共 7000 字符"
    assert String.contains?(page1.summary, String.slice(prose, 0, 6000))
    assert String.length(page1.summary) <= 7200
  end

  test "chapter_read v2：offset 越界/末尾/非法参数给诚实观察且不返回伪造正文" do
    prose = long_prose(7000)
    {work_id, chapter_id} = seed_work_with_chapter(@long_title, prose)
    chapter_ref = "chapter:#{chapter_id}"

    assert {:ok, beyond} =
             ExplorationService.run(
               work_id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: chapter_ref, offset: 7001})
             )

    assert beyond.summary =~ "offset 超出正文范围（共 7000 字符）"
    refute beyond.summary =~ "【正文】第"
    refute beyond.summary =~ "【续读】"
    assert beyond.refs == [chapter_ref]

    assert {:ok, at_end} =
             ExplorationService.run(
               work_id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: chapter_ref, offset: 7000})
             )

    assert at_end.summary =~ "offset 到达正文末尾（共 7000 字符）"
    refute at_end.summary =~ "【正文】第"

    for bad <- [
          ~s({"offset":5}),
          ~s({"chapter":""}),
          ~s({"chapter_ref":"#{chapter_ref}","offset":-1}),
          ~s({"chapter_ref":"#{chapter_ref}","offset":"6000"}),
          ~s({"chapter":)
        ] do
      assert {:ok, invalid} = ExplorationService.run(work_id, "chapter_read", bad)
      assert invalid.summary =~ "章节检索参数无法识别"
      refute invalid.summary =~ "【正文】第"
    end
  end

  test "chapter_read v2：JSON offset=0 与纯章节名等价（计划/摘要同返回）" do
    prose = long_prose(1000)
    {work_id, chapter_id} = seed_work_with_chapter("雨夜入江湖", prose)

    assert {:ok, plain} = ExplorationService.run(work_id, "chapter_read", "雨夜入江湖")

    assert {:ok, json} =
             ExplorationService.run(
               work_id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: "chapter:#{chapter_id}", offset: 0})
             )

    assert json.summary == plain.summary
    assert json.next_offset == plain.next_offset
    assert json.prose_range == plain.prose_range
  end

  test "chapter_read v2：只读零写，tentative 草稿不进观察" do
    {work_id, chapter_id} = seed_work_with_chapter("静默的井", long_prose(6400))

    scene = Scene |> Repo.all() |> Enum.find(&(&1.chapter_id == chapter_id))

    %Draft{}
    |> Draft.changeset(%{
      work_id: work_id,
      scene_id: scene.id,
      content: "未采纳草稿正文，不应出现在探索观察里。",
      status: AdoptionStatus.tentative(),
      revision: 2
    })
    |> Repo.insert!()

    counts = fn -> {Repo.aggregate(Draft, :count, :id), Repo.aggregate(Scene, :count, :id)} end
    before = counts.()

    assert {:ok, page1} = ExplorationService.run(work_id, "chapter_read", "静默的井")

    assert {:ok, _page2} =
             ExplorationService.run(
               work_id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: page1.chapter_ref, offset: page1.next_offset})
             )

    assert before == counts.()
    refute page1.summary =~ "未采纳草稿正文"
  end

  test "activity_summary：作者可见文案含 seq+title、集中映射，不含内部 id/ref/UUID/JSON/offset" do
    {work_id, _chapter_id} = seed_work_with_chapter(@long_title, long_prose(1000))

    assert {:ok, chapter} = ExplorationService.run(work_id, "chapter_read", @long_title)
    assert chapter.activity_summary =~ "已阅读章节正文「#{@long_title}」（第 1 章）"
    refute chapter.activity_summary =~ "chapter_read"
    refute chapter.activity_summary =~ "chapter_ref"
    refute chapter.activity_summary =~ "chapter:"
    refute chapter.activity_summary =~ "{"

    assert {:ok, search} = ExplorationService.run(work_id, "prose_search", "灵气账单")
    assert search.activity_summary =~ "已检索正文「灵气账单」"

    assert {:ok, archive} = ExplorationService.run(work_id, "archive_read", "profile")
    assert archive.activity_summary == "已查阅作品档案：作品简介。"

    assert {:ok, memory} = ExplorationService.run(work_id, "memory_recall", "灵气")
    assert memory.activity_summary =~ "已检索记忆「灵气」"

    assert ExplorationService.activity_failure_summary("chapter_read") =~ "章节检索未完成"
    refute ExplorationService.activity_failure_summary("chapter_read") =~ "chapter_read"

    assert ExplorationService.activity_summary(%{
             tool: "chapter_read",
             query: @long_title
           }) =~ "已阅读章节正文「#{@long_title}」"

    assert ExplorationService.activity_summary(%{}) == "已完成一次作品检索。"
  end

  test "章索引（模型面）带 chapter_ref 与 seq/title 双面身份；找不到时列出索引" do
    prose = long_prose(200)
    {work_id, chapter_id} = seed_work_with_chapter(@long_title, prose)

    assert {:ok, miss} = ExplorationService.run(work_id, "chapter_read", "不存在的章名")
    assert miss.summary =~ "现有章索引"
    assert miss.summary =~ "- 第 1 章「#{@long_title}」[chapter_ref=chapter:#{chapter_id}]"

    # 判断/计划共用的章索引行号真源单点（ChapterListBudget.entry_line/1）
    assert NovelApplication.ChapterListBudget.entry_line(%{
             title: @long_title,
             seq: 1,
             id: chapter_id,
             has_prose: false
           }) == "- 第 1 章「#{@long_title}」[chapter_ref=chapter:#{chapter_id}]（计划中）"
  end

  defp long_prose(total) do
    base = "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线，他数着自己的呼吸等回声。"

    String.duplicate(base, div(total, String.length(base)) + 1)
    |> String.slice(0, total)
  end

  defp seed_work_with_chapter(title, prose, opts \\ []) do
    work_id =
      case opts[:work_id] do
        nil ->
          {:ok, work} = WorkService.create(%{"title" => opts[:work_title] || "探索读取验证作品"})
          work.id

        work_id ->
          work_id
      end

    volume =
      if opts[:new_volume] do
        %Volume{}
        |> Volume.changeset(%{
          work_id: work_id,
          title: "卷#{System.unique_integer([:positive])}",
          seq: System.unique_integer([:positive])
        })
        |> Repo.insert!()
      else
        case Volume |> Repo.all() |> Enum.find(&(&1.work_id == work_id)) do
          nil ->
            %Volume{}
            |> Volume.changeset(%{work_id: work_id, title: "卷一", seq: 1})
            |> Repo.insert!()

          volume ->
            volume
        end
      end

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work_id,
        volume_id: volume.id,
        title: title,
        seq: opts[:seq] || 1,
        plan_direction: opts[:plan_direction]
      })
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work_id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work_id,
      scene_id: scene.id,
      content: prose,
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    if summary = opts[:summary] do
      %ChapterSummary{}
      |> ChapterSummary.changeset(%{
        work_id: work_id,
        chapter_id: chapter.id,
        status: AdoptionStatus.accepted(),
        summary_text: summary
      })
      |> Repo.insert!()
    end

    {work_id, chapter.id}
  end

  defp seed_work_with_prose do
    {:ok, work} = WorkService.create(%{"title" => "灵气矿工"})

    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work.id, title: "卷一", seq: 1})
      |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work.id,
        volume_id: volume.id,
        title: "第01章：底层灵气账单",
        seq: 1
      })
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work.id,
      scene_id: scene.id,
      content: @prose,
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    work.id
  end

  # AU08 CP3（08 §8 探索面同步律）：卷划分落地即须同批可达——判断循环里读到的章清单
  # 必须体现实际卷结构，否则规划期只知「预计卷数」而不知已经分成了哪几卷。
  test "chapter_read：章索引单卷/多卷都逐章列出 chapter_ref（模型唯一寻址）" do
    single_work = seed_work_with_prose()

    assert {:ok, miss} = ExplorationService.run(single_work, "chapter_read", "第99章")
    assert miss.summary =~ "现有章索引"
    assert miss.summary =~ ~r/- 第 1 章「第01章：底层灵气账单」\[chapter_ref=chapter:/
    refute miss.summary =~ "卷一："

    multi_work = seed_work_with_two_volumes()

    assert {:ok, multi_miss} = ExplorationService.run(multi_work, "chapter_read", "第99章")
    assert multi_miss.summary =~ ~r/- 第 1 章「第01章：起」\[chapter_ref=chapter:/
    assert multi_miss.summary =~ ~r/- 第 2 章「第02章：承」\[chapter_ref=chapter:/
  end

  # B11A CP4（VS-00J §4 消费面 4 / 08 §8 探索面同步律）：章计划渲染同批暴露所属卷与
  # 当前卷蓝图摘要；卷无设计态蓝图时整段不渲染（I-VOL-4 与今天逐字节一致）。
  test "chapter_read：所属卷与当前卷蓝图摘要同批可读；无蓝图卷不渲染" do
    {:ok, work} = WorkService.create(%{"title" => "卷蓝图探索"})

    first_volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work.id, title: "第一卷·觉醒", seq: 1})
      |> Repo.insert!()

    blueprint = %{
      "goal_conflict" => "夺回矿脉",
      "arc_stage" => "由忍到争",
      "climaxes" => "对账夜",
      "new_maps" => "北境",
      "status" => "CONFIRMED",
      "source_ref" => "artifact:as-1"
    }

    second_volume =
      %Volume{}
      |> Volume.changeset(%{
        work_id: work.id,
        title: "第二卷·裂变",
        seq: 2,
        status: "PLANNED",
        blueprint: blueprint
      })
      |> Repo.insert!()

    %Chapter{}
    |> Chapter.changeset(%{
      work_id: work.id,
      volume_id: first_volume.id,
      title: "第01章：起",
      seq: 1
    })
    |> Repo.insert!()

    %Chapter{}
    |> Chapter.changeset(%{
      work_id: work.id,
      volume_id: second_volume.id,
      title: "第02章：承",
      seq: 2
    })
    |> Repo.insert!()

    # 无蓝图卷：既有探索输出逐字节不变（不渲染所属卷/蓝图摘要）。
    assert {:ok, first} = ExplorationService.run(work.id, "chapter_read", "第01章")
    refute first.summary =~ "当前卷蓝图"
    refute first.summary =~ "所属卷"

    assert {:ok, second} = ExplorationService.run(work.id, "chapter_read", "第02章")
    assert second.summary =~ "所属卷：第二卷·裂变"

    assert second.summary =~
             "当前卷蓝图：目标冲突：夺回矿脉；弧光阶段：由忍到争；高潮与节奏（高潮章：对账夜）；新要素（新地图：北境）"

    # 设计态元数据不进探索观察（不伪造作品事实/不泄露内部 ref）。
    refute second.summary =~ "artifact:as-1"
  end

  defp seed_work_with_two_volumes do
    {:ok, work} = WorkService.create(%{"title" => "分卷书"})

    for {volume_title, seq, chapter_title} <- [
          {"第一卷·觉醒", 1, "第01章：起"},
          {"第二卷·裂变", 2, "第02章：承"}
        ] do
      volume =
        %Volume{}
        |> Volume.changeset(%{work_id: work.id, title: volume_title, seq: seq})
        |> Repo.insert!()

      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work.id,
        volume_id: volume.id,
        title: chapter_title,
        seq: seq
      })
      |> Repo.insert!()
    end

    work.id
  end

  defp insert_memory(work_id, type, content) do
    %MemoryItem{}
    |> MemoryItem.changeset(%{
      id: Ecto.UUID.generate(),
      work_id: work_id,
      content: content,
      type: type,
      scope: "WORK",
      status: MemoryStatus.confirmed(),
      source_type: MemorySourceType.author_confirmed(),
      tags: [],
      recallable: true
    })
    |> Repo.insert!()
  end
end
