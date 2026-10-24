defmodule NovelPersistence.B30RenumberTest do
  use NovelPersistence.DataCase, async: false

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume, Work}

  setup do
    work = Repo.insert!(%Work{title: "B30 重编号"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第二卷", seq: 2})

    chapters =
      for {title, seq} <- [{"第11章：外门名册上的空白", 11}, {"第12章：旧钱与旧名", 12}, {"第13章：无名", 13}] do
        Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: title, seq: seq})
      end

    Enum.each(chapters, fn chapter ->
      scene =
        Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 1", seq: 1})

      Repo.insert!(%Draft{
        work_id: work.id,
        scene_id: scene.id,
        content: "正文-#{chapter.seq}",
        status: AdoptionStatus.accepted(),
        revision: 1
      })
    end)

    %{work: work, volume: volume, chapters: chapters}
  end

  test "chapter_structure_context 返回章 refs/seq/title/version/hash/summary refs 与同名分组", %{
    work: work,
    volume: volume,
    chapters: [c1 | _]
  } do
    Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: c1.title, seq: 14})

    assert {:ok, ctx} = AdoptionRepository.chapter_structure_context(work.id)
    assert ctx.volume_ref == nil
    assert Enum.map(ctx.volumes, & &1.seq) == [2]
    assert length(ctx.chapters) == 4
    assert Enum.map(ctx.chapters, & &1.seq) == [11, 12, 13, 14]

    ch = Enum.find(ctx.chapters, &(&1.seq == 11))
    assert ch.chapter_ref == "chapter:#{c1.id}"
    assert ch.version == 1
    assert ch.content_hash != nil
    assert ch.accepted_summary_refs == []
    assert length(ctx.same_title_groups) == 1
    assert ctx.same_title_groups |> hd() |> Map.get(:title) == "第11章：外门名册上的空白"

    assert {:ok, scoped} =
             AdoptionRepository.chapter_structure_context(work.id, "volume:#{volume.id}")

    assert scoped.volume_ref == "volume:#{volume.id}"

    assert {:error, :out_of_range} =
             AdoptionRepository.chapter_structure_context(
               work.id,
               "volume:#{Ecto.UUID.generate()}"
             )
  end

  test "renumber 交换 11↔13 原子提交：seq 变化、id/章数/归卷/title/正文 hash 不变", ctx do
    [c1, c2, c3] = ctx.chapters

    before = chapters_for(ctx.work.id) |> Enum.map(&{&1.id, &1.title, &1.volume_id})

    before_hashes =
      Map.new(
        from(d in Draft, where: d.work_id == ^ctx.work.id) |> Repo.all(),
        &{&1.scene_id, :crypto.hash(:sha256, &1.content)}
      )

    mapping = [
      %{"chapter_ref" => "chapter:#{c1.id}", "new_seq" => 13},
      %{"chapter_ref" => "chapter:#{c3.id}", "new_seq" => 11}
    ]

    expected = [
      %{"chapter_ref" => "chapter:#{c1.id}", "expected_seq" => 11},
      %{"chapter_ref" => "chapter:#{c3.id}", "expected_seq" => 13},
      %{"chapter_ref" => "chapter:#{c2.id}", "expected_seq" => 12}
    ]

    assert {:ok, receipt} = AdoptionRepository.renumber_chapters(ctx.work.id, mapping, expected)
    assert receipt.committed
    assert receipt.object_count == 2
    assert receipt.effects == ["display_number_only"]
    assert receipt.duplicate == false

    assert Enum.map(chapters_for(ctx.work.id) |> Enum.sort_by(& &1.seq), & &1.seq) == [11, 12, 13]
    assert Repo.get!(Chapter, c1.id).seq == 13
    assert Repo.get!(Chapter, c3.id).seq == 11
    assert Repo.get!(Chapter, c2.id).seq == 12
    assert chapter_count(ctx.work.id) == 3

    after_rows = chapters_for(ctx.work.id) |> Enum.map(&{&1.id, &1.title, &1.volume_id})
    assert Enum.sort(before) == Enum.sort(after_rows)

    after_hashes =
      Map.new(
        from(d in Draft, where: d.work_id == ^ctx.work.id) |> Repo.all(),
        &{&1.scene_id, :crypto.hash(:sha256, &1.content)}
      )

    assert after_hashes == before_hashes

    # 幂等重放：已提交回执（duplicate）
    assert {:ok, replay} = AdoptionRepository.renumber_chapters(ctx.work.id, mapping, expected)
    assert replay.duplicate == true
    assert replay.object_count == 2
  end

  test "stale/duplicate_seq/cross_work/out_of_range/no_target 拒绝且零写入", ctx do
    [c1, c2, _c3] = ctx.chapters
    mapping = [%{"chapter_ref" => "chapter:#{c1.id}", "new_seq" => 13}]

    before =
      Chapter
      |> where([c], c.work_id == ^ctx.work.id)
      |> Repo.all()
      |> Enum.map(&{&1.id, &1.seq})
      |> Enum.sort()

    assert {:error, :stale_base_version} =
             AdoptionRepository.renumber_chapters(ctx.work.id, mapping, [
               %{"chapter_ref" => "chapter:#{c1.id}", "expected_seq" => 12}
             ])

    assert {:error, :duplicate_seq} =
             AdoptionRepository.renumber_chapters(
               ctx.work.id,
               [
                 %{"chapter_ref" => "chapter:#{c1.id}", "new_seq" => c2.seq}
               ],
               [%{"chapter_ref" => "chapter:#{c1.id}", "expected_seq" => 11}]
             )

    assert {:error, :no_target} =
             AdoptionRepository.renumber_chapters(
               ctx.work.id,
               [
                 %{"chapter_ref" => "chapter:#{Ecto.UUID.generate()}", "new_seq" => 20}
               ],
               []
             )

    assert {:error, :out_of_range} =
             AdoptionRepository.renumber_chapters(
               ctx.work.id,
               [
                 %{"chapter_ref" => "chapter:#{c1.id}", "new_seq" => 0}
               ],
               [%{"chapter_ref" => "chapter:#{c1.id}", "expected_seq" => 11}]
             )

    # cross-work：另一 work 的 chapter
    other_work = Repo.insert!(%Work{title: "另一个作品"})
    other_volume = Repo.insert!(%Volume{work_id: other_work.id, title: "卷一", seq: 1})

    other_chapter =
      Repo.insert!(%Chapter{
        work_id: other_work.id,
        volume_id: other_volume.id,
        title: "第1章",
        seq: 1
      })

    assert {:error, :no_target} =
             AdoptionRepository.renumber_chapters(
               ctx.work.id,
               [
                 %{"chapter_ref" => "chapter:#{other_chapter.id}", "new_seq" => 5}
               ],
               []
             )

    after_rows =
      Chapter
      |> where([c], c.work_id == ^ctx.work.id)
      |> Repo.all()
      |> Enum.map(&{&1.id, &1.seq})
      |> Enum.sort()

    assert after_rows == before
  end

  test "蓝图行 object_kind/title 防护：type_mismatch 拒绝且不建章/不占 seq", ctx do
    before = chapter_count(ctx.work.id)

    assert {:error, :type_mismatch} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: ctx.work.id,
               source_turn_ref: "turn-b30-blueprint",
               artifact_id: "as-b30-blueprint",
               artifact_type: :outline_draft,
               content: "第2卷：卷蓝图\n章功能定位：铺垫章\n",
               summary: "第2卷：卷蓝图"
             })

    assert chapter_count(ctx.work.id) == before
  end

  defp chapter_count(work_id) do
    Repo.aggregate(from(c in Chapter, where: c.work_id == ^work_id), :count)
  end

  defp chapters_for(work_id) do
    from(c in Chapter, where: c.work_id == ^work_id) |> Repo.all()
  end
end
