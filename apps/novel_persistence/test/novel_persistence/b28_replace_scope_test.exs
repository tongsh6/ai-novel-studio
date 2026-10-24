defmodule NovelPersistence.B28ReplaceScopeTest do
  use NovelPersistence.DataCase, async: false

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.{ReadingProjectionRepo, Repo}
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

  setup do
    work_id = Ecto.UUID.generate()
    volume = Repo.insert!(%Volume{work_id: work_id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{
        work_id: work_id,
        volume_id: volume.id,
        title: "第01章：开端",
        seq: 1
      })

    scene1 = Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 1", seq: 1})
    scene2 = Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 2", seq: 2})

    d1 =
      Repo.insert!(%Draft{
        work_id: work_id,
        scene_id: scene1.id,
        content: "初稿正文。",
        status: AdoptionStatus.accepted(),
        revision: 1
      })

    d2 =
      Repo.insert!(%Draft{
        work_id: work_id,
        scene_id: scene2.id,
        content: "零换行续写正文。",
        status: AdoptionStatus.accepted(),
        revision: 1
      })

    %{work_id: work_id, chapter: chapter, scene1: scene1, scene2: scene2, d1: d1, d2: d2}
  end

  test "replace_scope 原子替代：旧 accepted 全部 supersede、新稿 accepted、章身份/章数/seq 不变", c do
    effect = %{
      "mode" => "replace_scope",
      "coverage" => "complete",
      "covered" => [
        %{"draft_ref" => "draft:#{c.d1.id}:1"},
        %{"draft_ref" => "draft:#{c.d2.id}:1"}
      ],
      "expected_base_versions" => [
        %{"ref" => "draft:#{c.d1.id}", "version" => 1},
        %{"ref" => "draft:#{c.d2.id}", "version" => 1}
      ]
    }

    assert {:ok, persisted} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: c.work_id,
               source_turn_ref: "turn-b28-replace",
               artifact_id: "as-b28-replace",
               artifact_type: :prose_fragment,
               content: "初稿正文。\n\n零换行续写正文。",
               summary: "第01章：开端",
               target_chapter_ref: "chapter:#{c.chapter.id}",
               adoption_effect: effect,
               mode: :overwrite
             })

    assert persisted.reading_projection.adoption_effect == "replace_scope"
    assert length(persisted.reading_projection.superseded_draft_refs) == 2

    # B28 CP1.5-A2：顶层 additive 结果回显（WS/回执可断言）
    assert persisted.adoption_effect.mode == "replace_scope"
    assert persisted.adoption_effect.coverage == "complete"
    assert length(persisted.adoption_effect.covered) == 2
    assert length(persisted.adoption_effect.expected_base_versions) == 2
    assert length(persisted.superseded_draft_refs) == 2
    assert Enum.all?(persisted.superseded_draft_refs, &Regex.match?(~r/^draft:[0-9a-f-]+:1$/, &1))

    # 章数不变、seq 不变
    assert Repo.aggregate(from(ch in Chapter, where: ch.work_id == ^c.work_id), :count) == 1
    assert Repo.get!(Chapter, c.chapter.id).seq == 1

    # 旧 drafts 全部 supersede（历史保留），新 accepted 在第一章
    statuses =
      Draft
      |> where([d], d.work_id == ^c.work_id)
      |> order_by([d], asc: d.inserted_at)
      |> Repo.all()
      |> Enum.map(&{&1.id, &1.status})

    assert {c.d1.id, AdoptionStatus.superseded()} in statuses
    assert {c.d2.id, AdoptionStatus.superseded()} in statuses

    {:ok, content} = ReadingProjectionRepo.chapter_content(c.chapter.id, c.work_id)
    assert Enum.map_join(content.scenes, "\n", & &1.content) =~ "零换行续写正文。"
  end

  test "stale_base_version：期望版本不符 → 拒绝且零写入", c do
    effect = %{
      "mode" => "replace_scope",
      "coverage" => "complete",
      "covered" => [
        %{"draft_ref" => "draft:#{c.d1.id}:1"},
        %{"draft_ref" => "draft:#{c.d2.id}:1"}
      ],
      "expected_base_versions" => [%{"ref" => "draft:#{c.d1.id}", "version" => 99}]
    }

    before = Repo.aggregate(Draft, :count)

    assert {:error, :stale_base_version} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: c.work_id,
               source_turn_ref: "turn-b28-stale",
               artifact_id: "as-b28-stale",
               artifact_type: :prose_fragment,
               content: "不应写入",
               summary: "第01章：开端",
               target_chapter_ref: "chapter:#{c.chapter.id}",
               adoption_effect: effect
             })

    assert Repo.aggregate(Draft, :count) == before
    assert Repo.get!(Chapter, c.chapter.id).id == c.chapter.id
  end

  test "target_missing / incomplete_scope：拒绝且零写入", c do
    effect = %{
      "mode" => "replace_scope",
      "coverage" => "complete",
      "covered" => [%{"draft_ref" => "draft:#{c.d1.id}:1"}]
    }

    before = Repo.aggregate(Draft, :count)

    assert {:error, :target_missing} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: c.work_id,
               source_turn_ref: "turn-b28-missing",
               artifact_id: "as-b28-missing",
               artifact_type: :prose_fragment,
               content: "不应写入",
               summary: "第01章：开端",
               adoption_effect: effect
             })

    assert {:error, :incomplete_scope} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: c.work_id,
               source_turn_ref: "turn-b28-incomplete",
               artifact_id: "as-b28-incomplete",
               artifact_type: :prose_fragment,
               content: "不应写入",
               summary: "第01章：开端",
               target_chapter_ref: "chapter:#{c.chapter.id}",
               adoption_effect: effect
             })

    assert Repo.aggregate(Draft, :count) == before
  end

  test "append 回显 adoption_effect(mode) 且无 superseded；legacy 无 effect 字段兼容" do
    work_id = Ecto.UUID.generate()
    volume = Repo.insert!(%Volume{work_id: work_id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{work_id: work_id, volume_id: volume.id, title: "第01章：开端", seq: 1})

    scene = Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 1", seq: 1})

    Repo.insert!(%Draft{
      work_id: work_id,
      scene_id: scene.id,
      content: "初稿",
      status: AdoptionStatus.accepted(),
      revision: 1
    })

    assert {:ok, appended} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: work_id,
               source_turn_ref: "turn-b28-append",
               artifact_id: "as-b28-append",
               artifact_type: :prose_fragment,
               content: "续写片段",
               summary: "第01章：开端",
               target_chapter_ref: "chapter:#{chapter.id}",
               mode: :append,
               adoption_effect: %{"mode" => "append"}
             })

    assert appended.adoption_effect.mode == "append"
    refute Map.has_key?(appended, :superseded_draft_refs)

    # legacy（无 adoption_effect）：保持旧字段，不新增 effect 回显
    assert {:ok, legacy} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: work_id,
               source_turn_ref: "turn-b28-legacy",
               artifact_id: "as-b28-legacy",
               artifact_type: :plot_direction,
               content: "剧情方向",
               summary: "方向"
             })

    refute Map.has_key?(legacy, :adoption_effect)
    refute Map.has_key?(legacy, :superseded_draft_refs)
  end
end
