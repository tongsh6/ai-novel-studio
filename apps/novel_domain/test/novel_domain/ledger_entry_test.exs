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

  # VS00F 刀④：回收是语义判断——机械层不判，落账只经作者裁决（HIDDEN→REVEALED 边）。
  test "information 裁决转移边：HIDDEN/LEAKED 可裁决为 REVEALED，其余目标拒绝" do
    {:ok, hidden} =
      LedgerEntry.new(arc_attrs(%{ledger: "information", status: "HIDDEN", subject_kind: "fact"}))

    assert {:ok, revealed} = LedgerEntry.adjudicate(hidden, "REVEALED", "作者判已回收")
    assert revealed.status == "REVEALED"

    {:ok, leaked} =
      LedgerEntry.new(arc_attrs(%{ledger: "information", status: "LEAKED", subject_kind: "fact"}))

    assert {:ok, _} = LedgerEntry.adjudicate(leaked, "REVEALED", nil)
    assert {:error, _} = LedgerEntry.adjudicate(hidden, "PARTIALLY_REVEALED", nil)
  end

  test "分账目录与状态机校验：目录外值拒绝、五账各走各状态机（CP3 起全落地）" do
    assert {:error, {:unknown_ledger, "budget"}} =
             LedgerEntry.new(arc_attrs(%{ledger: "budget"}))

    assert {:error, {:invalid_status, "arc", "on_track"}} =
             LedgerEntry.new(arc_attrs(%{status: "on_track"}))

    assert {:ok, _} = LedgerEntry.new(arc_attrs(%{ledger: "promise", status: "OPEN"}))
    assert {:ok, _} = LedgerEntry.new(arc_attrs(%{ledger: "information", status: "LEAKED"}))
    assert {:ok, _} = LedgerEntry.new(arc_attrs(%{ledger: "conflict", status: "ACTIVE"}))
    assert {:ok, _} = LedgerEntry.new(arc_attrs(%{ledger: "emotion_curve", status: "DEVIATED"}))

    assert {:error, {:invalid_status, "promise", "SHATTERED"}} =
             LedgerEntry.new(arc_attrs(%{ledger: "promise", status: "SHATTERED"}))

    assert {:error, {:invalid_status, "emotion_curve", "STALLED"}} =
             LedgerEntry.new(arc_attrs(%{ledger: "emotion_curve", status: "STALLED"}))
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

  test "B67：处理旧章不能把最近出场倒回旧章，历史出处仅追加" do
    {:ok, entry} = LedgerEntry.new(arc_attrs())

    current =
      LedgerEntry.arc_sighted(entry, %{
        chapter_ref: "ch-10",
        chapter_seq: 10,
        source_ref: "chapter_summary:ch-10",
        presence_note: "凌渊在第10章现身"
      })

    historical =
      LedgerEntry.arc_sighted(current, %{
        chapter_ref: "ch-3",
        chapter_seq: 3,
        source_ref: "chapter_summary:ch-3",
        presence_note: "旧章补写：凌渊在第3章现身"
      })

    assert historical.payload["last_seen_seq"] == 10
    assert historical.payload["last_seen_chapter"] == "ch-10"
    assert historical.payload["presence_note"] == "凌渊在第10章现身"
    assert historical.last_event_chapter == current.last_event_chapter
    assert hd(historical.source_refs) == "chapter_summary:ch-3"
    assert historical.revision == current.revision + 1

    # 同样输入重复处理：只追加一次，不再涨 revision。
    again =
      LedgerEntry.arc_sighted(historical, %{
        chapter_ref: "ch-3",
        chapter_seq: 3,
        source_ref: "chapter_summary:ch-3",
        presence_note: "旧章补写：凌渊在第3章现身"
      })

    assert again.revision == historical.revision
    assert again.source_refs == historical.source_refs

    # 旧章处理不得让基于当前进度的停滞判定误报。
    assert :unchanged = LedgerEntry.arc_recompute_stall(historical, 12, 8)
  end

  test "B67：处理旧章不能把主线推进倒回旧章" do
    {:ok, entry} =
      LedgerEntry.new(
        arc_attrs(%{ledger: "conflict", subject_kind: "plotline", status: "ACTIVE"})
      )

    current =
      LedgerEntry.conflict_advanced(entry, %{
        chapter_ref: "ch-10",
        chapter_seq: 10,
        source_ref: "chapter_summary:ch-10"
      })

    historical =
      LedgerEntry.conflict_advanced(current, %{
        chapter_ref: "ch-3",
        chapter_seq: 3,
        source_ref: "chapter_summary:ch-3"
      })

    assert historical.payload["last_advanced_seq"] == 10
    assert historical.payload["last_advanced_chapter"] == "ch-10"
    assert hd(historical.source_refs) == "chapter_summary:ch-3"
    assert historical.revision == current.revision + 1
    assert :unchanged = LedgerEntry.conflict_recompute_dormant(historical, 12, 8)
  end

  test "arc_recompute_stall：超阈值 STALLED、条件解除回 ON_TRACK、非机械态不动（I-L4 确定性）" do
    {:ok, entry} = LedgerEntry.new(arc_attrs())

    seen =
      LedgerEntry.arc_sighted(entry, %{
        chapter_ref: "ch-3",
        chapter_seq: 3,
        source_ref: "s",
        presence_note: nil
      })

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
