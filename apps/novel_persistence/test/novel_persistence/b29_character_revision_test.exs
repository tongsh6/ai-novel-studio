defmodule NovelPersistence.B29CharacterRevisionTest do
  use NovelPersistence.DataCase, async: false

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Character, Draft, Scene, Volume, Work}

  setup do
    work = Repo.insert!(%Work{title: "B29 角色修订"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1})
    chapter = Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: "第1章", seq: 1})
    scene = Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景", seq: 1})

    draft =
      Repo.insert!(%Draft{
        work_id: work.id,
        scene_id: scene.id,
        content: "沈砚在灯楼查账。",
        status: AdoptionStatus.accepted(),
        revision: 1
      })

    shen =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "沈砚",
        aliases: ["老沈"],
        role: "灯楼查账人",
        narrative_role: "ENSEMBLE_POV",
        summary: "主角候选",
        status: AdoptionStatus.accepted()
      })

    gu =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "顾青",
        aliases: [],
        role: "捕快",
        narrative_role: "PROTAGONIST",
        status: AdoptionStatus.accepted()
      })

    dup =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "沈砚",
        aliases: ["小沈"],
        role: "少年",
        narrative_role: "MINOR",
        status: AdoptionStatus.tentative()
      })

    other_work = Repo.insert!(%Work{title: "另一个作品"})

    other =
      Repo.insert!(%Character{
        work_id: other_work.id,
        name: "沈砚",
        aliases: [],
        narrative_role: "SUPPORTING",
        status: AdoptionStatus.accepted()
      })

    %{work: work, shen: shen, gu: gu, dup: dup, other: other, draft: draft}
  end

  test "character_profile_context 列表/单角色/同名分组/fingerprint/错误", ctx do
    assert {:ok, index} = AdoptionRepository.character_profile_context(ctx.work.id)
    assert {:ok, ^index} = AdoptionRepository.character_profile_context(ctx.work.id, nil)
    assert length(index.characters) == 3

    assert index.same_name_groups == [
             %{
               name: "沈砚",
               character_refs: index.same_name_groups |> hd() |> Map.get(:character_refs)
             }
           ]

    shen_fact = Enum.find(index.characters, &(&1.character_ref == "character:#{ctx.shen.id}"))
    assert shen_fact.name == "沈砚"
    assert shen_fact.aliases == ["老沈"]
    assert shen_fact.narrative_role == "ENSEMBLE_POV"
    assert is_binary(shen_fact.base_fingerprint)

    assert {:ok, single} =
             AdoptionRepository.character_profile_context(ctx.work.id, "character:#{ctx.shen.id}")

    assert single.base_fingerprint == shen_fact.base_fingerprint

    assert {:error, :cross_work_scope} =
             AdoptionRepository.character_profile_context(
               ctx.work.id,
               "character:#{ctx.other.id}"
             )

    assert {:error, :target_missing} =
             AdoptionRepository.character_profile_context(
               ctx.work.id,
               "character:#{Ecto.UUID.generate()}"
             )
  end

  test "revise ENSEMBLE_POV→PROTAGONIST：同 id/角色数/其它主角/正文不变；幂等 duplicate", ctx do
    {:ok, fact} =
      AdoptionRepository.character_profile_context(ctx.work.id, "character:#{ctx.shen.id}")

    before_ids = characters_for(ctx.work.id) |> Enum.map(& &1.id) |> Enum.sort()
    body = Repo.get!(Draft, ctx.draft.id).content

    assert {:ok, receipt} =
             AdoptionRepository.revise_character_narrative_role(
               ctx.work.id,
               "character:#{ctx.shen.id}",
               fact.base_fingerprint,
               "PROTAGONIST"
             )

    assert receipt.committed
    assert receipt.duplicate == false
    assert receipt.field == "narrative_role"
    assert receipt.old == "ENSEMBLE_POV"
    assert receipt.new == "PROTAGONIST"
    assert receipt.object_count == 1

    assert Repo.get!(Character, ctx.shen.id).narrative_role == "PROTAGONIST"
    assert Repo.get!(Character, ctx.gu.id).narrative_role == "PROTAGONIST"
    assert Repo.get!(Character, ctx.dup.id).narrative_role == "MINOR"
    # 本作品 3 个角色；另一个作品的角色不计入本作品角色数。
    assert Repo.aggregate(from(ch in Character, where: ch.work_id == ^ctx.work.id), :count) == 3
    assert characters_for(ctx.work.id) |> Enum.map(& &1.id) |> Enum.sort() == before_ids
    assert Repo.get!(Draft, ctx.draft.id).content == body

    # C07=A：成功后用旧基线重放不得仅凭 old_role 命中就冒充同一请求成功；
    # 持久层严格整体 fingerprint，旧基线已过期 → stale，零重复写。
    assert {:error, :stale_base} =
             AdoptionRepository.revise_character_narrative_role(
               ctx.work.id,
               "character:#{ctx.shen.id}",
               fact.base_fingerprint,
               "PROTAGONIST",
               old_role: "ENSEMBLE_POV"
             )

    assert Repo.get!(Character, ctx.shen.id).narrative_role == "PROTAGONIST"
  end

  test "stale/cross-work/invalid role/不存在 拒绝零写入", ctx do
    before = characters_for(ctx.work.id) |> Enum.map(&{&1.id, &1.narrative_role}) |> Enum.sort()

    assert {:error, :stale_base} =
             AdoptionRepository.revise_character_narrative_role(
               ctx.work.id,
               "character:#{ctx.shen.id}",
               "deadbeef",
               "PROTAGONIST"
             )

    assert {:error, :cross_work_scope} =
             AdoptionRepository.revise_character_narrative_role(
               ctx.work.id,
               "character:#{ctx.other.id}",
               "deadbeef",
               "PROTAGONIST"
             )

    assert {:error, :invalid_character_role} =
             AdoptionRepository.revise_character_narrative_role(
               ctx.work.id,
               "character:#{ctx.shen.id}",
               "deadbeef",
               "HERO"
             )

    assert {:error, :target_missing} =
             AdoptionRepository.revise_character_narrative_role(
               ctx.work.id,
               "character:#{Ecto.UUID.generate()}",
               "deadbeef",
               "PROTAGONIST"
             )

    assert characters_for(ctx.work.id) |> Enum.map(&{&1.id, &1.narrative_role}) |> Enum.sort() ==
             before
  end

  test "C07=A：非目标字段变化使整体 fingerprint 过期，即使 old_role 相同也拒绝", ctx do
    {:ok, fact} =
      AdoptionRepository.character_profile_context(ctx.work.id, "character:#{ctx.shen.id}")

    # 只改 summary（非 narrative_role），整体 fingerprint 已变。
    ctx.shen
    |> Character.changeset(%{summary: "主角候选，已补简介"})
    |> Repo.update!()

    assert {:error, :stale_base} =
             AdoptionRepository.revise_character_narrative_role(
               ctx.work.id,
               "character:#{ctx.shen.id}",
               fact.base_fingerprint,
               "PROTAGONIST",
               old_role: "ENSEMBLE_POV"
             )

    assert Repo.get!(Character, ctx.shen.id).narrative_role == "ENSEMBLE_POV"
    assert Repo.get!(Character, ctx.shen.id).summary == "主角候选，已补简介"
  end

  test "C07=A：当前已满足目标角色的 no-op 与旧基线重放分开", ctx do
    {:ok, before_fact} =
      AdoptionRepository.character_profile_context(ctx.work.id, "character:#{ctx.shen.id}")

    # 当前基线就是目标角色：no-op 回执，不写库，标记 noop 而非同一请求重放。
    ctx.shen
    |> Character.changeset(%{narrative_role: "PROTAGONIST"})
    |> Repo.update!()

    {:ok, current_fact} =
      AdoptionRepository.character_profile_context(ctx.work.id, "character:#{ctx.shen.id}")

    assert {:ok, noop} =
             AdoptionRepository.revise_character_narrative_role(
               ctx.work.id,
               "character:#{ctx.shen.id}",
               current_fact.base_fingerprint,
               "PROTAGONIST"
             )

    assert noop.duplicate == true
    assert noop.noop == true
    assert noop.committed == false
    assert Repo.get!(Character, ctx.shen.id).narrative_role == "PROTAGONIST"

    # 旧基线（改前 ENSEMBLE_POV）重放：严格 stale，不是 no-op/duplicate。
    assert {:error, :stale_base} =
             AdoptionRepository.revise_character_narrative_role(
               ctx.work.id,
               "character:#{ctx.shen.id}",
               before_fact.base_fingerprint,
               "PROTAGONIST",
               old_role: "ENSEMBLE_POV"
             )
  end

  test "C07=A：检查后竞争更新只有一个提交，另一个 stale，零重复写", ctx do
    {:ok, fact} =
      AdoptionRepository.character_profile_context(ctx.work.id, "character:#{ctx.shen.id}")

    results =
      1..2
      |> Task.async_stream(
        fn _index ->
          AdoptionRepository.revise_character_narrative_role(
            ctx.work.id,
            "character:#{ctx.shen.id}",
            fact.base_fingerprint,
            "PROTAGONIST"
          )
        end,
        max_concurrency: 2,
        timeout: 10_000
      )
      |> Enum.map(fn {:ok, result} -> result end)

    committed = Enum.count(results, &match?({:ok, %{committed: true}}, &1))
    assert committed == 1
    assert Enum.any?(results, &match?({:error, :stale_base}, &1))
    assert Repo.get!(Character, ctx.shen.id).narrative_role == "PROTAGONIST"
  end

  defp characters_for(work_id) do
    from(ch in Character, where: ch.work_id == ^work_id) |> Repo.all()
  end
end
