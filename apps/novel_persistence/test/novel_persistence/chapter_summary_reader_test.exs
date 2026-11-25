defmodule NovelPersistence.ChapterSummaryReaderTest do
  @moduledoc """
  VS-00C CP2.2：chapter_summary_reader port 按真实 chapter_ref 和派生材料范围读取。
  真实 DB 验证同名、改名、未知和跨作品身份。
  """
  use NovelPersistence.DataCase, async: false

  alias NovelDomain.DialogueContext
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.ID
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.ChapterSummaryRepo
  alias NovelPersistence.WorkspaceContext

  setup do
    work_id = ID.uuid()

    content = """
    第01章：底层灵气账单: 主角发现灵气带宽被公司暗中抽走。
    第02章：旧服务器里的残诀: 主角找到残缺功法并第一次突破。
    第03章：地下链路: 主角进入废弃管网调查。
    第04章：云端审判: 宗门平台开始追索账单。
    """

    {:ok, _persisted} =
      AdoptionRepository.persist(%{
        actor_ref: "author",
        work_id: work_id,
        source_turn_ref: "turn-outline",
        artifact_id: ID.uuid(),
        artifact_type: :outline_draft,
        base_revision: 1,
        content: String.trim(content),
        summary: "章节计划",
        decision_id: ID.uuid()
      })

    chapters =
      work_id
      |> NovelPersistence.ReadingProjectionRepo.toc()
      |> Map.fetch!(:volumes)
      |> Enum.flat_map(&Map.fetch!(&1, :chapters))

    for chapter <- chapters do
      {:ok, row} =
        ChapterSummaryRepo.insert(%{
          work_id: work_id,
          chapter_id: chapter.id,
          status: AdoptionStatus.tentative(),
          summary_text: "摘要：#{chapter.title}",
          material_scope: if(chapter.seq == 1, do: "fragment", else: "chapter"),
          source_ref: "source-turn-#{chapter.seq}",
          revision_base: "draft:base:#{chapter.seq}"
        })

      {:ok, _} = ChapterSummaryRepo.update_status(row, AdoptionStatus.accepted())
    end

    %{work_id: work_id, chapters: chapters}
  end

  test "by_ref 只读本作品真实章节的当前摘要材料", %{work_id: work_id, chapters: [first | _]} do
    reader = WorkspaceContext.chapter_summary_reader()
    ref = "chapter:#{first.id}"
    row = ChapterSummaryRepo.current_accepted(work_id, first.id)

    assert reader.by_ref.(work_id, ref) == %{
             ref: "chapter_summary:#{row.id}",
             chapter_ref: ref,
             chapter_title: first.title,
             summary_text: "摘要：第01章：底层灵气账单",
             source_type: "derived_summary",
             adoption_status: "ACCEPTED",
             material_scope: "fragment",
             content_source_ref: "source-turn-1",
             revision_base: "draft:base:1"
           }

    refute Map.has_key?(reader, :by_title)
    assert reader.by_ref.(work_id, first.title) == nil
    assert reader.by_ref.(work_id, "chapter:#{ID.uuid()}") == nil
    assert reader.by_ref.(ID.uuid(), ref) == nil
  end

  test "context_fetcher 返回 CP3 结构化章节条目", %{work_id: work_id} do
    {:ok, _persisted} =
      AdoptionRepository.persist(%{
        actor_ref: "author",
        work_id: work_id,
        source_turn_ref: "turn-prose",
        artifact_id: ID.uuid(),
        artifact_type: :prose_fragment,
        base_revision: 1,
        content: "第一章正文已经写入。",
        summary: "第01章：底层灵气账单",
        decision_id: ID.uuid()
      })

    fetcher = WorkspaceContext.context_fetcher_with_query()

    assert {:ok,
            %DialogueContext{
              current_chapters: titles,
              structured_chapters: structured,
              interaction_state: %{}
            }} =
             fetcher.(work_id, "", nil)

    assert titles == [
             "第01章：底层灵气账单",
             "第02章：旧服务器里的残诀",
             "第03章：地下链路",
             "第04章：云端审判"
           ]

    assert [
             %{
               title: "第01章：底层灵气账单",
               seq: 1,
               summary: "主角发现灵气带宽被公司暗中抽走。",
               has_prose: true
             },
             %{
               title: "第02章：旧服务器里的残诀",
               seq: 2,
               summary: "主角找到残缺功法并第一次突破。",
               has_prose: false
             }
             | _
           ] = structured
  end

  test "previous 返回目标章之前窗口内的 ACCEPTED 摘要", %{
    work_id: work_id,
    chapters: chapters
  } do
    reader = WorkspaceContext.chapter_summary_reader()
    third = "chapter:#{Enum.at(chapters, 2).id}"

    assert [
             %{chapter_title: "第01章：底层灵气账单", summary_text: "摘要：第01章：底层灵气账单"},
             %{chapter_title: "第02章：旧服务器里的残诀", summary_text: "摘要：第02章：旧服务器里的残诀"}
           ] = reader.previous.(work_id, third, 2)
  end

  test "同名改名只改变显示，前序窗口不取首个标题命中或错误尾窗", %{
    work_id: work_id,
    chapters: [first, second | _]
  } do
    reader = WorkspaceContext.chapter_summary_reader()
    first_ref = "chapter:#{first.id}"
    second_ref = "chapter:#{second.id}"

    Repo.get!(NovelPersistence.Schemas.Chapter, second.id)
    |> Ecto.Changeset.change(title: first.title)
    |> Repo.update!()

    assert reader.by_ref.(work_id, second_ref).summary_text == "摘要：第02章：旧服务器里的残诀"
    assert reader.by_ref.(work_id, second_ref).chapter_title == first.title
    assert [%{chapter_ref: ^first_ref}] = reader.previous.(work_id, second_ref, 4)
    assert reader.previous.(work_id, first.title, 4) == []
    assert reader.previous.(work_id, "chapter:#{ID.uuid()}", 4) == []
    assert reader.previous.(work_id, nil, 4) == []
    assert reader.previous.(ID.uuid(), second_ref, 4) == []
    assert length(reader.previous.(work_id, :latest, 2)) == 2
  end

  test "previous 按窗口截断且不包含目标章及后续章", %{work_id: work_id, chapters: chapters} do
    reader = WorkspaceContext.chapter_summary_reader()
    fourth = "chapter:#{Enum.at(chapters, 3).id}"

    summaries = reader.previous.(work_id, fourth, 2)
    titles = Enum.map(summaries, & &1.chapter_title)

    assert titles == ["第02章：旧服务器里的残诀", "第03章：地下链路"]
    refute "第04章：云端审判" in titles
  end
end
