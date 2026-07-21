defmodule NovelDomain.LedgerEntryTest do
  @moduledoc """
  五本账信封与弧光机械规则单测（VS-00F §2 / ADR-0026 / 00c 不变量 #19）。
  """
  use ExUnit.Case, async: true

  alias NovelDomain.LedgerEntry

  defp arc_attrs(overrides \\ %{}) do
    Map.merge(
      %{
        work_id: "work-1",
        ledger: "arc",
        subject_kind: "character",
        subject_ref: "char-1",
        subject_label: "凌渊",
        status: "ON_TRACK",
        source_refs: ["chapter_summary:ch-1"]
      },
      overrides
    )
  end

  test "I-L1 出处锚定：source_refs 空/含空串拒绝构造" do
    assert {:error, :source_refs_required} = LedgerEntry.new(arc_attrs(%{source_refs: []}))
    assert {:error, :source_refs_required} = LedgerEntry.new(arc_attrs(%{source_refs: [""]}))
    assert {:ok, _} = LedgerEntry.new(arc_attrs())
  end

  test "分账目录与状态机校验：未落地账拒绝构造、目录外值拒绝、已落地账各走各状态机" do
    assert {:error, {:ledger_not_implemented, "emotion_curve"}} =
             LedgerEntry.new(arc_attrs(%{ledger: "emotion_curve", status: "MATCHED"}))

    assert {:error, {:unknown_ledger, "budget"}} =
             LedgerEntry.new(arc_attrs(%{ledger: "budget"}))

    assert {:error, {:invalid_status, "arc", "on_track"}} =
             LedgerEntry.new(arc_attrs(%{status: "on_track"}))

    # CP2a：promise/information 状态机已落地
    assert {:ok, _} = LedgerEntry.new(arc_attrs(%{ledger: "promise", status: "OPEN"}))
    assert {:ok, _} = LedgerEntry.new(arc_attrs(%{ledger: "information", status: "LEAKED"}))
    assert {:error, {:invalid_status, "promise", "SHATTERED"}} =
             LedgerEntry.new(arc_attrs(%{ledger: "promise", status: "SHATTERED"}))
  end

  test "arc_sighted：出场记账更新最近出场/出处/事件章，STALLED 机械回 ON_TRACK" do
    {:ok, entry} = LedgerEntry.new(arc_attrs(%{status: "STALLED"}))

    sighted =
      LedgerEntry.arc_sighted(entry, %{
        chapter_ref: "ch-9",
        chapter_seq: 9,
        source_ref: "chapter_summary:ch-9",
        presence_note: "凌渊在祭坛现身"
      })

    assert sighted.status == "ON_TRACK"
    assert sighted.payload["last_seen_seq"] == 9
    assert sighted.payload["presence_note"] == "凌渊在祭坛现身"
    assert sighted.last_event_chapter == "ch-9"
    assert hd(sighted.source_refs) == "chapter_summary:ch-9"
    assert sighted.revision == entry.revision + 1
  end

  test "arc_sighted：裁决态/终态不被机械改写" do
    for status <- ~w(DRIFTED RESUMED COMPLETED RETIRED) do
      {:ok, entry} = LedgerEntry.new(arc_attrs(%{status: status}))

      sighted =
        LedgerEntry.arc_sighted(entry, %{
          chapter_ref: "ch-9",
          chapter_seq: 9,
          source_ref: "s",
          presence_note: nil
        })

      assert sighted.status == status
    end
  end

  test "arc_recompute_stall：超阈值 STALLED、条件解除回 ON_TRACK、非机械态不动（I-L4 确定性）" do
    {:ok, entry} = LedgerEntry.new(arc_attrs())
    seen = LedgerEntry.arc_sighted(entry, %{chapter_ref: "ch-3", chapter_seq: 3, source_ref: "s", presence_note: nil})

    # 3 + 8 阈值：第 11 章仍在窗口内，第 12 章越界
    assert :unchanged = LedgerEntry.arc_recompute_stall(seen, 11, 8)
    assert {:changed, stalled} = LedgerEntry.arc_recompute_stall(seen, 12, 8)
    assert stalled.status == "STALLED"

    # 同输入重算幂等（确定性）
    assert :unchanged = LedgerEntry.arc_recompute_stall(stalled, 12, 8)

    # 条件解除（如阈值调宽）机械回 ON_TRACK
    assert {:changed, back} = LedgerEntry.arc_recompute_stall(stalled, 12, 20)
    assert back.status == "ON_TRACK"

    # 裁决态不参与机械翻转
    {:ok, drifted} = LedgerEntry.new(arc_attrs(%{status: "DRIFTED"}))
    assert :unchanged = LedgerEntry.arc_recompute_stall(drifted, 99, 8)
  end
end
