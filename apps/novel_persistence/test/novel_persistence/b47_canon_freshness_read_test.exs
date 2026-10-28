defmodule NovelPersistence.B47CanonFreshnessReadTest do
  use NovelPersistence.DataCase, async: false

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Character, Draft, Scene, Volume}

  # B47 CP1：persistence 提供当前 canon/版本读取（只读；复用既有表，不建第二事实源）。

  setup do
    work = Repo.insert!(%NovelPersistence.Schemas.Work{title: "B47 canon freshness"})

    volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: "第01章", seq: 1})

    scene1 = Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 1", seq: 1})

    scene2 = Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 2", seq: 2})

    draft1 =
      Repo.insert!(%Draft{
        work_id: work.id,
        scene_id: scene1.id,
        content: "第一段：灯影里的人在等。",
        status: AdoptionStatus.accepted(),
        revision: 2
      })

    draft2 =
      Repo.insert!(%Draft{
        work_id: work.id,
        scene_id: scene2.id,
        content: "第二段：旧钱摊在桌上。",
        status: AdoptionStatus.accepted(),
        revision: 7
      })

    # 历史稿不得进入当前 canon 快照。
    superseded =
      Repo.insert!(%Draft{
        work_id: work.id,
        scene_id: scene1.id,
        content: "历史旧稿：灯影里的人在等。",
        status: AdoptionStatus.superseded(),
        revision: 1
      })

    shen =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "沈砚",
        aliases: ["老沈"],
        role: "灯楼查账人",
        narrative_role: "ENSEMBLE_POV",
        status: AdoptionStatus.accepted()
      })

    %{
      work: work,
      chapter: chapter,
      scene1: scene1,
      draft1: draft1,
      draft2: draft2,
      superseded: superseded,
      shen: shen
    }
  end

  describe "canon_snapshot({:chapter_prose, chapter_ref})" do
    test "返回当前 accepted 片段 ref/version 与 base 正文内容 hash（排除历史稿）", ctx do
      chapter_ref = "chapter:#{ctx.chapter.id}"

      assert {:ok, snapshot} =
               AdoptionRepository.canon_snapshot(ctx.work.id, {:chapter_prose, chapter_ref})

      assert snapshot.object == :chapter_prose
      assert snapshot.ref == chapter_ref

      assert snapshot.versions == %{
               "draft:#{ctx.draft1.id}" => 2,
               "draft:#{ctx.draft2.id}" => 7
             }

      base_text = "第一段：灯影里的人在等。\n\n第二段：旧钱摊在桌上。"
      assert snapshot.digest == NovelDomain.ProseFormatting.source_hash(base_text)
      refute String.contains?(inspect(snapshot), "历史旧稿")
    end

    test "章不存在返回 target_missing；非法 work/target 返回可解释错误", ctx do
      missing_ref = "chapter:#{Ecto.UUID.generate()}"

      assert {:error, :target_missing} =
               AdoptionRepository.canon_snapshot(ctx.work.id, {:chapter_prose, missing_ref})

      assert {:error, :target_missing} =
               AdoptionRepository.canon_snapshot("not-a-uuid", {:chapter_prose, missing_ref})

      assert {:error, :unsupported_canon_object} =
               AdoptionRepository.canon_snapshot(ctx.work.id, {:unknown_object, "x"})
    end
  end

  describe "canon_snapshot({:character_profile, character_ref})" do
    test "返回当前角色 fingerprint 与 narrative_role；字段更新后 fingerprint 变化", ctx do
      character_ref = "character:#{ctx.shen.id}"

      assert {:ok, snapshot} =
               AdoptionRepository.canon_snapshot(
                 ctx.work.id,
                 {:character_profile, character_ref}
               )

      assert snapshot.object == :character_profile
      assert snapshot.ref == character_ref
      assert snapshot.value == "ENSEMBLE_POV"

      assert {:ok, fact} =
               AdoptionRepository.character_profile_context(ctx.work.id, character_ref)

      assert snapshot.fingerprint == fact.base_fingerprint

      ctx.shen
      |> Character.changeset(%{narrative_role: "PROTAGONIST"})
      |> Repo.update!()

      assert {:ok, changed} =
               AdoptionRepository.canon_snapshot(
                 ctx.work.id,
                 {:character_profile, character_ref}
               )

      assert changed.value == "PROTAGONIST"
      assert changed.fingerprint != snapshot.fingerprint
    end

    test "角色不存在/跨作品返回可解释错误", ctx do
      assert {:error, :target_missing} =
               AdoptionRepository.canon_snapshot(
                 ctx.work.id,
                 {:character_profile, "character:#{Ecto.UUID.generate()}"}
               )

      other_work = Repo.insert!(%NovelPersistence.Schemas.Work{title: "另一个作品"})

      other =
        Repo.insert!(%Character{
          work_id: other_work.id,
          name: "顾青",
          narrative_role: "PROTAGONIST",
          status: AdoptionStatus.accepted()
        })

      assert {:error, :cross_work_scope} =
               AdoptionRepository.canon_snapshot(
                 ctx.work.id,
                 {:character_profile, "character:#{other.id}"}
               )
    end
  end
end
