defmodule NovelApplication.ChapterSummarySourceContractTest do
  use ExUnit.Case, async: false

  import NovelApplication.TestChapterReadFixtures

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{ChapterSummaryMaintenance, ExplorationService}
  alias NovelPersistence.{ChapterSummaryRepo, Repo}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "R08 生成范围经真实摘要行到两类工具读取，不被摘要采纳或读取完整性升格" do
    {work_id, chapter_id} = seed_work_with_chapter("范围章", "前文。后文。")
    ref = "chapter:#{chapter_id}"

    repo = %{
      supersede: &ChapterSummaryRepo.supersede_prior_accepted/2,
      insert: &ChapterSummaryRepo.insert/1,
      update_status: &ChapterSummaryRepo.update_status/2
    }

    for {scope, expected} <- [{:fragment, "fragment"}, {:chapter, "chapter"}] do
      input = %{
        work_id: work_id,
        chapter_id: chapter_id,
        prose_text: if(scope == :fragment, do: "后文。", else: "前文。后文。"),
        material_scope: scope,
        source_ref: "turn-source",
        revision_base: "draft:source:1"
      }

      assert {:ok, summary} =
               ChapterSummaryMaintenance.run(input, fn _ -> {:ok, "派生摘要"} end, repo)

      row = ChapterSummaryRepo.current_accepted(work_id, chapter_id)
      assert row.material_scope == expected
      assert summary.material_scope == expected
      assert_sources(work_id, ref, row, expected)
    end
  end

  test "旧摘要缺少生成范围仍是未知，不从采纳状态或文本猜填" do
    {work_id, chapter_id} =
      seed_work_with_chapter("历史章", "正文。", summary: "整章摘要（历史文本）")

    row = ChapterSummaryRepo.current_accepted(work_id, chapter_id)
    assert row.material_scope == nil
    assert_sources(work_id, "chapter:#{chapter_id}", row, "unknown")
  end

  defp assert_sources(work_id, ref, row, expected) do
    assert {:ok, preview} = ExplorationService.run(work_id, "chapter_read", ref)
    preview_source = preview.coverage.chapter_summary
    assert preview_source.status == "partial"
    assert preview_source.representation == "preview"

    query = Jason.encode!(%{facet: "chapters", ref: ref, offset: 0})
    assert {:ok, archive} = ExplorationService.run(work_id, "archive_read", query)
    assert archive.next_offset == nil
    assert archive.coverage.chapter_prose == "not_read"
    source_ref = "chapter_summary:#{row.id}"
    source = Enum.find(archive.coverage.sources, &(&1.ref == source_ref))
    assert source.returned_graphemes == source.total_graphemes

    for metadata <- [preview_source, source] do
      assert metadata.ref == source_ref
      assert metadata.adoption_status == "ACCEPTED"
      assert metadata.source_type == "derived_summary"
      assert metadata.material_scope == expected
      assert metadata.content_source_ref == row.source_ref
      assert metadata.revision_base == row.revision_base
    end

    assert source_ref in preview.refs
    assert source_ref in archive.refs

    assert Jason.encode!(projected_observation(work_id, archive)) =~
             ~s("material_scope":"#{expected}")

    assert Jason.encode!(projected_observation(work_id, preview)) =~
             ~s("material_scope":"#{expected}")
  end
end
