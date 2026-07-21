defmodule NovelPersistence.LedgerRepositoryTest do
  use NovelPersistence.DataCase, async: true

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

  test "upsert 以 (work, ledger, subject) 幂等：二次写入更新同一行", %{work_id: work_id} do
    assert {:ok, first} = LedgerRepository.upsert(arc_attrs(work_id))
    assert first.adoption_status == "ACCEPTED"

    assert {:ok, second} =
             LedgerRepository.upsert(
               arc_attrs(work_id, %{status: "STALLED", payload: %{"last_seen_seq" => 3}, revision: 2})
             )

    assert second.id == first.id
    assert [only] = LedgerRepository.list(work_id)
    assert only.status == "STALLED"
    assert only.revision == 2
  end

  test "list 只回已接受采纳态、按主体名排序、work 隔离", %{work_id: work_id} do
    {:ok, _} = LedgerRepository.upsert(arc_attrs(work_id))

    {:ok, _} =
      LedgerRepository.upsert(
        arc_attrs(work_id, %{subject_ref: "char-2", subject_label: "林浩"})
      )

    {:ok, _} = LedgerRepository.upsert(arc_attrs(ID.uuid(), %{subject_ref: "char-x"}))

    labels = work_id |> LedgerRepository.list() |> Enum.map(& &1.subject_label)
    assert labels == ["凌渊", "林浩"]
  end

  test "I-L1 持久化兜底：source_refs 空写入被拒", %{work_id: work_id} do
    assert {:error, changeset} = LedgerRepository.upsert(arc_attrs(work_id, %{source_refs: []}))
    refute changeset.valid?
  end
end
