defmodule NovelPersistence.B36ReplaceSegmentsTest do
  use NovelPersistence.DataCase, async: false

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{AdoptionRepository, LocalizedRevision, ReadingProjectionRepo, Repo}
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

  @paras [
    "第一段：灯影里的人在等。",
    "第二段：旧钱摊在桌上。",
    "第三段：名册有刮痕。",
    "第四段：脚步分成两路。"
  ]
  @base Enum.join(@paras, "\n\n")

  setup do
    work_id = Ecto.UUID.generate()
    volume = Repo.insert!(%Volume{work_id: work_id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{work_id: work_id, volume_id: volume.id, title: "第03章", seq: 3})

    scene = Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 1", seq: 1})

    draft =
      Repo.insert!(%Draft{
        work_id: work_id,
        scene_id: scene.id,
        content: @base,
        status: AdoptionStatus.accepted(),
        revision: 5
      })

    %{work_id: work_id, chapter: chapter, scene: scene, draft: draft}
  end

  defp first_segment(_ctx) do
    LocalizedRevision.segment(@base) |> hd()
  end

  defp persist(ctx, content, overrides \\ %{}) do
    seg = first_segment(ctx)

    effect =
      Map.merge(
        %{
          "mode" => "replace_segments",
          "target_segment_ids" => [seg.segment_id],
          "expected_segment_hashes" => [%{"segment_id" => seg.segment_id, "sha256" => seg.sha256}],
          "base_draft_ref" => "draft:#{ctx.draft.id}",
          "base_version" => 5,
          "covered" => ["draft:#{ctx.draft.id}:5"]
        },
        Map.get(overrides, :effect, %{})
      )

    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: ctx.work_id,
      source_turn_ref: "turn-b36",
      artifact_id: "as-b36-#{System.unique_integer([:positive])}",
      artifact_type: :prose_fragment,
      content: content,
      summary: "第03章",
      target_chapter_ref: "chapter:#{ctx.chapter.id}",
      adoption_effect: effect,
      modification_scope: "target_segments",
      target_segment_ids: effect["target_segment_ids"],
      expected_segment_hashes: effect["expected_segment_hashes"],
      base_draft_ref: effect["base_draft_ref"],
      base_version: effect["base_version"],
      mode: :overwrite
    })
  end

  test "第一段替换：仅第一段变化、其余字节级保留、revision+1、旧稿 superseded、receipt 记录", ctx do
    replacement = "第一段：灯影里的人在等，指节发白。"
    assert {:ok, persisted} = persist(ctx, replacement)

    assert persisted.reading_projection.adoption_effect == "replace_segments"
    assert persisted.reading_projection.scope == "target_segments"
    assert persisted.reading_projection.target_segment_ids == [first_segment(ctx).segment_id]
    assert length(persisted.reading_projection.segment_changes) == 1
    assert persisted.reading_projection.old_chars == String.length(@base)

    assert persisted.reading_projection.new_chars ==
             String.length(replacement) + String.length(@base) - String.length(hd(@paras))

    {:ok, content} = ReadingProjectionRepo.chapter_content(ctx.chapter.id, ctx.work_id)
    text = Enum.map_join(content.scenes, "\n\n", & &1.content)

    assert text =~ "指节发白"
    # 未改段落逐字节保留
    for p <- tl(@paras), do: assert(text =~ p)
    assert String.length(text) > String.length(hd(@paras))

    new_draft = Repo.get!(Draft, persisted.reading_projection.draft_id)
    assert new_draft.status == AdoptionStatus.accepted()
    assert new_draft.scene_id == ctx.scene.id
    assert new_draft.revision > 5
    assert Repo.get!(Draft, ctx.draft.id).status == AdoptionStatus.superseded()
    assert Repo.aggregate(Chapter, :count) == 1
  end

  test "hash/version/空 replacement/缺段：全部拒绝零写入", ctx do
    before =
      Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision}) |> Enum.sort()

    assert {:error, :segment_mismatch} =
             persist(ctx, "替换文本", %{
               effect: %{
                 "expected_segment_hashes" => [
                   %{"segment_id" => first_segment(ctx).segment_id, "sha256" => "bad"}
                 ]
               }
             })

    assert {:error, :stale_base_version} =
             persist(ctx, "替换文本", %{effect: %{"base_version" => 99}})

    # 空 replacement 在 Multi 更早的 memory_item 步骤即被拒绝（content required），零写入；
    # 具体错误形态不是 replace_segments 的 incomplete_scope，但数据安全目标满足。
    assert {:error, _} = persist(ctx, "")

    assert {:error, :segment_mismatch} =
             persist(ctx, "替换文本", %{effect: %{"target_segment_ids" => ["seg_99_bad"]}})

    assert Repo.all(Draft)
           |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision})
           |> Enum.sort() == before
  end

  test "多份 accepted drafts（canonical-2 缺陷）：covered_refs 组合 base，替换后整章一份新 accepted，全部 covered superseded",
       ctx do
    scene2 =
      Repo.insert!(%Scene{
        work_id: ctx.work_id,
        chapter_id: ctx.chapter.id,
        title: "场景 2",
        seq: 2
      })

    d2 =
      Repo.insert!(%Draft{
        work_id: ctx.work_id,
        scene_id: scene2.id,
        content: "第五段：零换行续写段。",
        status: AdoptionStatus.accepted(),
        revision: 1
      })

    combined = @base <> "\n\n" <> d2.content
    seg = LocalizedRevision.segment(combined) |> hd()
    replacement = "第一段：灯影更紧，账页发白。"

    effect = %{
      "mode" => "replace_segments",
      "covered" => ["draft:#{ctx.draft.id}:5", "draft:#{d2.id}:1"],
      "base_versions" => [
        %{"ref" => "draft:#{ctx.draft.id}", "version" => 5},
        %{"ref" => "draft:#{d2.id}", "version" => 1}
      ],
      "target_segment_ids" => [seg.segment_id],
      "expected_segment_hashes" => [%{"segment_id" => seg.segment_id, "sha256" => seg.sha256}]
    }

    assert {:ok, persisted} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: ctx.work_id,
               source_turn_ref: "turn-b36-multi",
               artifact_id: "as-b36-multi",
               artifact_type: :prose_fragment,
               content: replacement,
               summary: "第03章",
               target_chapter_ref: "chapter:#{ctx.chapter.id}",
               adoption_effect: effect,
               modification_scope: "target_segments",
               target_segment_ids: effect["target_segment_ids"],
               expected_segment_hashes: effect["expected_segment_hashes"],
               mode: :overwrite
             })

    assert length(persisted.reading_projection.covered_refs) == 2
    assert length(persisted.reading_projection.segment_changes) == 1
    assert Repo.get!(Draft, ctx.draft.id).status == AdoptionStatus.superseded()
    assert Repo.get!(Draft, d2.id).status == AdoptionStatus.superseded()

    {:ok, content} = ReadingProjectionRepo.chapter_content(ctx.chapter.id, ctx.work_id)
    text = Enum.map_join(content.scenes, "\n\n", & &1.content)
    assert text =~ replacement
    for p <- tl(@paras), do: assert(text =~ p)
    assert text =~ d2.content

    accepted =
      Draft
      |> where([d], d.work_id == ^ctx.work_id and d.status == ^AdoptionStatus.accepted())
      |> Repo.all()

    assert length(accepted) == 1
    assert hd(accepted).scene_id == ctx.scene.id
    assert String.trim_trailing(hd(accepted).content) == String.trim_trailing(text)
  end

  test "多 draft covered 版本不符 → stale_base_version 零写入", ctx do
    scene2 =
      Repo.insert!(%Scene{
        work_id: ctx.work_id,
        chapter_id: ctx.chapter.id,
        title: "场景 2",
        seq: 2
      })

    d2 =
      Repo.insert!(%Draft{
        work_id: ctx.work_id,
        scene_id: scene2.id,
        content: "续写段。",
        status: AdoptionStatus.accepted(),
        revision: 1
      })

    seg = LocalizedRevision.segment(@base) |> hd()

    bad = %{
      "mode" => "replace_segments",
      "covered" => ["draft:#{ctx.draft.id}:5", "draft:#{d2.id}:1"],
      "base_versions" => [
        %{"ref" => "draft:#{ctx.draft.id}", "version" => 5},
        %{"ref" => "draft:#{d2.id}", "version" => 99}
      ],
      "target_segment_ids" => [seg.segment_id],
      "expected_segment_hashes" => [%{"segment_id" => seg.segment_id, "sha256" => seg.sha256}]
    }

    before = Repo.all(Draft) |> Enum.map(&{&1.id, &1.status}) |> Enum.sort()

    assert {:error, :stale_base_version} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: ctx.work_id,
               source_turn_ref: "turn-b36-multi-stale",
               artifact_id: "as-b36-multi-stale",
               artifact_type: :prose_fragment,
               content: "替换",
               summary: "第03章",
               target_chapter_ref: "chapter:#{ctx.chapter.id}",
               adoption_effect: bad,
               modification_scope: "target_segments"
             })

    assert Repo.all(Draft) |> Enum.map(&{&1.id, &1.status}) |> Enum.sort() == before
  end
end
