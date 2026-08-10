defmodule NovelPersistence.CharacterMergeRepoTest do
  @moduledoc """
  AU12 归并事务：别名吸收、SUPERSEDED 隐藏、弧光账归一与唯一索引保持。
  标本形状来自 m4b（同名双行各挂一条 arc 账）。
  """
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.CharacterMergeRepo
  alias NovelPersistence.LedgerRepository
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.LedgerEntry
  alias NovelPersistence.WorkArchiveRepo
  alias NovelPersistence.WorkRepo

  defp create_work do
    {:ok, work} = WorkRepo.create(%{title: "归并作品"})
    work
  end

  defp insert_character(work, overrides \\ %{}) do
    attrs =
      Map.merge(
        %{work_id: work.id, name: "沈洛", status: AdoptionStatus.accepted()},
        overrides
      )

    %Character{} |> Character.changeset(attrs) |> Repo.insert!()
  end

  defp insert_arc_entry(work, character, overrides \\ %{}) do
    attrs =
      Map.merge(
        %{
          work_id: work.id,
          ledger: "arc",
          subject_kind: "character",
          subject_ref: to_string(character.id),
          subject_label: character.name,
          status: "ON_TRACK",
          payload: %{"last_seen_seq" => 1},
          source_refs: ["sum-1"],
          adoption_status: AdoptionStatus.accepted()
        },
        overrides
      )

    %LedgerEntry{} |> LedgerEntry.changeset(attrs) |> Repo.insert!()
  end

  defp arc_entries(work) do
    LedgerRepository.list(work.id, "arc")
  end

  test "m4b 标本形状：同名双行各挂 arc 账 → 单行、单条 arc、refs 并集、源行隐藏" do
    work = create_work()
    target = insert_character(work, %{summary: "保留行"})
    source = insert_character(work, %{summary: "重复登记行"})

    insert_arc_entry(work, target, %{
      payload: %{"last_seen_seq" => 3},
      source_refs: ["sum-1", "sum-3"]
    })

    insert_arc_entry(work, source, %{
      status: "STALLED",
      payload: %{"last_seen_seq" => 10},
      last_event_chapter: "ch-10",
      source_refs: ["sum-10"]
    })

    assert {:ok, %{target: merged, superseded_ref: superseded_ref}} =
             CharacterMergeRepo.merge(work.id, to_string(source.id), to_string(target.id))

    assert merged.id == target.id
    assert merged.name == "沈洛"
    assert merged.aliases == []
    assert superseded_ref == to_string(source.id)

    # 源行 SUPERSEDED，档案读端口自动隐藏
    assert Repo.get!(Character, source.id).status == AdoptionStatus.superseded()
    assert [archived] = WorkArchiveRepo.characters(work.id)
    assert archived.id == to_string(target.id)

    # arc 账归一：仅剩 target 条目，进度取更新者，refs 并集
    assert [entry] = arc_entries(work)
    assert entry.subject_ref == to_string(target.id)
    assert entry.status == "STALLED"
    assert entry.payload["last_seen_seq"] == 10
    assert Enum.sort(entry.source_refs) == ["sum-1", "sum-10", "sum-3"]
  end

  test "别名情形：source 主名进 target 别名；改名情形：keep_name=source 换主名" do
    work = create_work()
    target = insert_character(work, %{name: "沈洛"})
    alias_row = insert_character(work, %{name: "洛公子"})

    assert {:ok, %{target: merged}} =
             CharacterMergeRepo.merge(work.id, to_string(alias_row.id), to_string(target.id))

    assert merged.name == "沈洛"
    assert merged.aliases == ["洛公子"]

    rename_row = insert_character(work, %{name: "沈砚"})

    assert {:ok, %{target: renamed}} =
             CharacterMergeRepo.merge(
               work.id,
               to_string(rename_row.id),
               to_string(target.id),
               "source"
             )

    assert renamed.name == "沈砚"
    assert Enum.sort(renamed.aliases) == ["沈洛", "洛公子"]
  end

  test "仅 source 有 arc 条目时整条改挂 target 并换标签" do
    work = create_work()
    target = insert_character(work, %{name: "沈洛"})
    source = insert_character(work, %{name: "洛公子"})
    insert_arc_entry(work, source, %{source_refs: ["sum-7"]})

    assert {:ok, _} =
             CharacterMergeRepo.merge(work.id, to_string(source.id), to_string(target.id))

    assert [entry] = arc_entries(work)
    assert entry.subject_ref == to_string(target.id)
    assert entry.subject_label == "沈洛"
    assert entry.source_refs == ["sum-7"]
  end

  test "改名后仅 target 有 arc 条目时标签跟随新主名" do
    work = create_work()
    target = insert_character(work, %{name: "沈洛"})
    source = insert_character(work, %{name: "沈砚"})
    insert_arc_entry(work, target)

    assert {:ok, _} =
             CharacterMergeRepo.merge(
               work.id,
               to_string(source.id),
               to_string(target.id),
               "source"
             )

    assert [entry] = arc_entries(work)
    assert entry.subject_ref == to_string(target.id)
    assert entry.subject_label == "沈砚"
  end

  test "拒绝：不存在/自并/已并入行再并/暂定行" do
    work = create_work()
    target = insert_character(work)
    source = insert_character(work, %{name: "洛公子"})
    tentative = insert_character(work, %{name: "暂定者", status: AdoptionStatus.tentative()})

    assert {:error, :character_not_found} =
             CharacterMergeRepo.merge(work.id, Ecto.UUID.generate(), to_string(target.id))

    assert {:error, :character_not_found} =
             CharacterMergeRepo.merge(work.id, "not-a-uuid", to_string(target.id))

    assert {:error, :cannot_merge_self} =
             CharacterMergeRepo.merge(work.id, to_string(target.id), to_string(target.id))

    assert {:error, :source_not_mergeable} =
             CharacterMergeRepo.merge(work.id, to_string(tentative.id), to_string(target.id))

    assert {:ok, _} = CharacterMergeRepo.merge(work.id, to_string(source.id), to_string(target.id))

    # 已 SUPERSEDED 的行不能再作为 source 或 target
    assert {:error, :source_not_mergeable} =
             CharacterMergeRepo.merge(work.id, to_string(source.id), to_string(target.id))

    assert {:error, :target_not_mergeable} =
             CharacterMergeRepo.merge(work.id, to_string(tentative.id), to_string(source.id))
  end

  test "跨作品拒绝" do
    work = create_work()
    other = create_work()
    target = insert_character(work)
    outsider = insert_character(other, %{name: "外人"})

    assert {:error, :character_not_found} =
             CharacterMergeRepo.merge(work.id, to_string(outsider.id), to_string(target.id))
  end
end
