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
    assert names == ~w(prose_search chapter_read archive_read memory_recall)

    section = ExplorationService.catalog_section()
    assert section =~ "## 探索目录"
    Enum.each(names, fn name -> assert section =~ name end)
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
        "ending_hook" => "灵气账单上浮现出陌生的扣费条目"
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

  defp seed_work_with_prose do
    {:ok, work} = WorkService.create(%{"title" => "灵气矿工"})

    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work.id, title: "卷一", seq: 1})
      |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{work_id: work.id, volume_id: volume.id, title: "第01章：底层灵气账单", seq: 1})
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
