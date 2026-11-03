defmodule NovelPersistence.LedgerRepositoryTest do
  use NovelPersistence.DataCase, async: false

  alias NovelFoundation.ID
  alias NovelPersistence.LedgerRepository

  setup do
    %{work_id: ID.uuid()}
  end

  defp arc_attrs(work_id, overrides \\ %{}) do
    Map.merge(
      %{
        work_id: work_id,
        ledger: "arc",
        subject_kind: "character",
        subject_ref: "char-1",
        subject_label: "凌渊",
        status: "ON_TRACK",
        payload: %{"last_seen_seq" => 3},
        source_refs: ["chapter_summary:ch-3"],
        last_event_chapter: "ch-3",
        revision: 1
      },
      overrides
    )
  end

  # VS00F 刀④ R9：机械进度口径=最大非计划章及其所在卷；无已写章诚实 0/0。
  test "written_progress 取最大非计划章与其卷；无已写章为 0/0" do
    alias NovelFoundation.Enums.StructureStatus
    alias NovelPersistence.Repo
    alias NovelPersistence.Schemas.{Chapter, Volume}

    work_uuid = Ecto.UUID.generate()

    assert LedgerRepository.written_progress(work_uuid) == %{chapter_seq: 0, volume_seq: 0}
    assert LedgerRepository.written_progress("lobby") == %{chapter_seq: 0, volume_seq: 0}

    [v1, v2] =
      for seq <- [1, 2] do
        %Volume{}
        |> Volume.changeset(%{work_id: work_uuid, title: "第#{seq}卷", seq: seq})
        |> Repo.insert!()
      end

    insert_chapter = fn volume, seq, status ->
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work_uuid,
        volume_id: volume.id,
        title: "第#{seq}章",
        seq: seq,
        status: status
      })
      |> Repo.insert!()
    end

    insert_chapter.(v1, 1, StructureStatus.drafting())
    insert_chapter.(v2, 2, StructureStatus.drafting())
    # 计划章不计进度
    insert_chapter.(v2, 3, StructureStatus.planned())

    assert LedgerRepository.written_progress(work_uuid) == %{chapter_seq: 2, volume_seq: 2}
  end

  test "upsert 以 (work, ledger, subject) 幂等：二次写入更新同一行", %{work_id: work_id} do
    assert {:ok, first} = LedgerRepository.upsert(arc_attrs(work_id))
    assert first.adoption_status == "ACCEPTED"

    assert {:ok, second} =
             LedgerRepository.upsert(
               arc_attrs(work_id, %{
                 status: "STALLED",
                 payload: %{"last_seen_seq" => 3},
                 revision: 2
               })
             )

    assert second.id == first.id
    assert [only] = LedgerRepository.list(work_id)
    assert only.status == "STALLED"
    assert only.revision == 2
  end

  test "list 只回已接受采纳态、按主体名排序、work 隔离", %{work_id: work_id} do
    {:ok, _} = LedgerRepository.upsert(arc_attrs(work_id))

    {:ok, _} =
      LedgerRepository.upsert(arc_attrs(work_id, %{subject_ref: "char-2", subject_label: "林浩"}))

    {:ok, _} = LedgerRepository.upsert(arc_attrs(ID.uuid(), %{subject_ref: "char-x"}))

    labels = work_id |> LedgerRepository.list() |> Enum.map(& &1.subject_label)
    assert labels == ["凌渊", "林浩"]
  end

  test "CP2：过期 revision 写入拒绝且不覆盖较新账面", %{work_id: work_id} do
    assert {:ok, first} = LedgerRepository.upsert(arc_attrs(work_id))
    assert first.revision == 1

    assert {:ok, second} =
             LedgerRepository.upsert(arc_attrs(work_id, %{status: "STALLED", revision: 2}))

    assert second.revision == 2

    # 同一个过期 revision=2 再写：期望 current+1=3，必须 stale，不覆盖 second。
    assert {:error, :stale_ledger_revision} =
             LedgerRepository.upsert(arc_attrs(work_id, %{status: "DRIFTED", revision: 2}))

    assert [only] = LedgerRepository.list(work_id)
    assert only.revision == 2
    assert only.status == "STALLED"
  end

  test "CP2：并发同 revision 只有一个提交，另一个 stale", %{work_id: work_id} do
    {:ok, _first} = LedgerRepository.upsert(arc_attrs(work_id))

    results =
      1..2
      |> Task.async_stream(
        fn _ ->
          LedgerRepository.upsert(arc_attrs(work_id, %{status: "STALLED", revision: 2}))
        end,
        max_concurrency: 2,
        timeout: 10_000
      )
      |> Enum.map(fn {:ok, result} -> result end)

    assert Enum.count(results, &match?({:ok, _}, &1)) == 1
    assert Enum.any?(results, &match?({:error, :stale_ledger_revision}, &1))
    assert [only] = LedgerRepository.list(work_id)
    assert only.revision == 2
  end

  test "CP2：旧脚本/种子 attrs 无 revision 时保持兼容更新", %{work_id: work_id} do
    {:ok, _first} = LedgerRepository.upsert(arc_attrs(work_id))
    attrs = arc_attrs(work_id, %{status: "STALLED"}) |> Map.delete(:revision)

    assert {:ok, updated} = LedgerRepository.upsert(attrs)
    assert updated.status == "STALLED"
    assert updated.revision == 2
  end

  test "I-L1 持久化兜底：source_refs 空写入被拒", %{work_id: work_id} do
    assert {:error, changeset} = LedgerRepository.upsert(arc_attrs(work_id, %{source_refs: []}))
    refute changeset.valid?
  end
end
