defmodule NovelPersistence.ChapterSummaryReaderTest do
  @moduledoc """
  VS-00C CP2.2：chapter_summary_reader port 的 title↔chapter_id 解析（toc 索引）。
  端到端验证 chapter_id 存储/查询口径一致（:string 与 toc id 形态匹配）。
  """
  use NovelPersistence.DataCase, async: true

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
          summary_text: "摘要：#{chapter.title}"
        })

      {:ok, _} = ChapterSummaryRepo.update_status(row, AdoptionStatus.accepted())
    end

    %{work_id: work_id, chapters: chapters}
  end

  test "by_title 按章标题返回当前 ACCEPTED 摘要文本", %{work_id: work_id} do
    reader = WorkspaceContext.chapter_summary_reader()
    assert reader.by_title.(work_id, "第01章：底层灵气账单") == "摘要：第01章：底层灵气账单"
    assert reader.by_title.(work_id, "不存在的章") == nil
  end

  test "previous 返回目标章之前窗口内的 ACCEPTED 摘要", %{
    work_id: work_id,
    chapters: chapters
  } do
    reader = WorkspaceContext.chapter_summary_reader()
    third = Enum.at(chapters, 2).title

    assert [
             %{chapter_title: "第01章：底层灵气账单", summary_text: "摘要：第01章：底层灵气账单"},
             %{chapter_title: "第02章：旧服务器里的残诀", summary_text: "摘要：第02章：旧服务器里的残诀"}
           ] = reader.previous.(work_id, third, 2)
  end

  test "previous 按窗口截断且不包含目标章及后续章", %{work_id: work_id, chapters: chapters} do
    reader = WorkspaceContext.chapter_summary_reader()
    fourth = Enum.at(chapters, 3).title

    summaries = reader.previous.(work_id, fourth, 2)
    titles = Enum.map(summaries, & &1.chapter_title)

    assert titles == ["第02章：旧服务器里的残诀", "第03章：地下链路"]
    refute "第04章：云端审判" in titles
  end
end
