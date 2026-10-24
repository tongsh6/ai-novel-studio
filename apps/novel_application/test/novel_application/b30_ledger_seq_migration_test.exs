defmodule NovelApplication.B30LedgerSeqMigrationTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.LedgerMaintenance
  alias NovelDomain.LedgerEntry
  alias NovelPersistence.{AdoptionRepository, LedgerRepository, Repo}
  alias NovelPersistence.Schemas.{Chapter, Volume, Work}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "重编号后账本窗口用 chapter_ref 解析当前 seq（旧 seq 不静默错位）" do
    work = Repo.insert!(%Work{title: "B30 账本"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第二卷", seq: 2})
    c1 = Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: "第11章：甲", seq: 11})
    c2 = Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: "第13章：乙", seq: 13})

    # 采纳时旧账：last_seen chapter=c1, seq=11；随后 c1 被重编号到 seq=2，
    # c2 仍为 13。以旧 seq 计算 gap=2（不会 STALLED）；按 ref 当前 seq gap=11 → STALLED。
    assert {:ok, _} =
             AdoptionRepository.renumber_chapters(
               work.id,
               [%{"chapter_ref" => "chapter:#{c1.id}", "new_seq" => 2}],
               [%{"chapter_ref" => "chapter:#{c1.id}", "expected_seq" => 11}]
             )

    stored =
      LedgerEntry.new(%{
        work_id: work.id,
        ledger: "arc",
        subject_kind: "character",
        subject_ref: "character-1",
        subject_label: "甲",
        status: "ON_TRACK",
        payload: %{"last_seen_chapter" => "chapter:#{c1.id}", "last_seen_seq" => 11},
        source_refs: ["chapter_summary:seed"],
        last_event_chapter: "chapter:#{c1.id}"
      })
      |> case do
        {:ok, entry} -> entry
      end

    stored_map = %{
      work_id: stored.work_id,
      ledger: stored.ledger,
      subject_kind: stored.subject_kind,
      subject_ref: stored.subject_ref,
      subject_label: stored.subject_label,
      status: stored.status,
      payload: stored.payload,
      source_refs: stored.source_refs,
      revision: stored.revision || 1,
      last_event_chapter: stored.last_event_chapter
    }

    parent = self()
    index = LedgerRepository.chapter_index(work.id)

    deps = %{
      roster: fn _work_id -> [] end,
      chapter_index: fn _work_id -> index end,
      repo: %{
        list: fn _work_id -> [stored_map] end,
        upsert: fn entry ->
          send(parent, {:ledger_upsert, entry})
          {:ok, entry}
        end
      }
    }

    assert {:ok, _} =
             LedgerMaintenance.run(
               %{work_id: work.id, chapter_id: c2.id, summary_text: "本章暂无角色出场。"},
               deps
             )

    arc =
      Enum.find_value(1..5, fn _ ->
        receive do
          {:ledger_upsert, entry} -> if entry[:ledger] == "arc", do: entry
        after
          100 -> nil
        end
      end)

    assert arc, "expected arc ledger upsert"
    assert arc[:status] == "STALLED"
    assert arc[:payload]["last_seen_seq"] == 2
  end
end
