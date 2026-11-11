defmodule NovelPersistence.B36LocalizedRevisionTest do
  use ExUnit.Case, async: false

  alias NovelPersistence.LocalizedRevision

  @base "第一段：灯影。\n\n第二段：旧钱。\n\n第三段：名册。\n\n第四段：脚步。\n\n第五段：安静。\n\n第六段：闸门。"

  test "分段确定/重建==原文/覆盖无重叠/重复段唯一 id" do
    segs = LocalizedRevision.segment(@base)

    assert Enum.map_join(segs, & &1.raw) == @base
    assert Enum.map(segs, & &1.segment_id) == Enum.uniq(Enum.map(segs, & &1.segment_id))

    assert Enum.map(segs, & &1.byte_start) ==
             Enum.scan(Enum.map(segs, & &1.raw), 0, fn raw, acc -> acc + byte_size(raw) end)
             |> Enum.drop(-1)
             |> then(&([0] ++ &1))

    assert Enum.map(segs, & &1.occurrence) == [1, 1, 1, 1, 1, 1]
    assert Enum.all?(segs, &Regex.match?(~r/^seg_[0-9]+_[0-9a-f]{12}$/, &1.segment_id))
  end

  test "CRLF/连续空行/重复段/超长段：重建保真、id 唯一" do
    dup = "重复段落。"
    long = String.duplicate("长段落内容。", 900)
    text = "甲\r\n\r\n" <> dup <> "\n\n" <> dup <> "\n\n\n" <> long <> "\r\n"

    segs = LocalizedRevision.segment(text)
    assert Enum.map_join(segs, & &1.raw) == text
    assert Enum.map(segs, & &1.segment_id) == Enum.uniq(Enum.map(segs, & &1.segment_id))

    # 重复正文 occurrence 分开
    repeated = Enum.filter(segs, &(&1.raw == dup <> "\n\n"))
    assert repeated != []
    if length(repeated) > 1, do: assert(Enum.map(repeated, & &1.occurrence) == [1, 2])

    # 超长段被切为多段（仍重建一致）
    assert length(segs) >= 4
  end

  test "跨 4000 字节汉字/合成字/emoji：grapheme 完整、JSON round-trip、行边界优先" do
    text = String.duplicate("灰", 1_333) <> "𠀀😀" <> String.duplicate("灰", 400)
    segs = LocalizedRevision.segment(text)

    assert Enum.map_join(segs, & &1.raw) == text
    assert Enum.all?(segs, &String.valid?(&1.raw))
    assert Enum.all?(segs, &(byte_size(&1.raw) <= 4_000))
    assert Enum.flat_map(segs, &String.graphemes(&1.raw)) == String.graphemes(text)

    for seg <- segs do
      assert Jason.decode!(Jason.encode!(%{"text" => seg.raw})) == %{"text" => seg.raw}
    end

    # 行边界优先：同一超长段的两行各 3001 字节，按整行切而非按 4000 字节硬切。
    lines = String.duplicate("灰", 1_000) <> "\n" <> String.duplicate("灰", 1_000) <> "\n"
    assert Enum.map(LocalizedRevision.segment(lines), &byte_size(&1.raw)) == [3_001, 3_001]
  end

  test "单个超过 4000 字节的 grapheme 保持完整、不拆字节" do
    giant = "a" <> String.duplicate("\u0301", 2_000)
    assert String.graphemes(giant) == [giant]
    assert byte_size(giant) > 4_000

    segs = LocalizedRevision.segment(giant <> "\n\n尾段")
    assert hd(segs).raw == giant
    assert Enum.map_join(segs, & &1.raw) == giant <> "\n\n尾段"
    assert Enum.all?(segs, &String.valid?(&1.raw))
  end

  test "diff：target 段内变化接受；集合外变化 out_of_scope；空/截断 incomplete；版本 stale" do
    segs = LocalizedRevision.segment(@base)
    first = List.first(segs).segment_id

    changed_first = String.replace(@base, "第一段：灯影。", "第一段：灯影更沉。")

    assert {:ok, info} =
             LocalizedRevision.validate(@base, changed_first,
               scope: "target_segments",
               target_segment_ids: [first]
             )

    assert info.old_chars == String.length(@base)
    assert info.new_chars == String.length(changed_first)
    assert length(info.segment_changes) == 1
    assert hd(info.segment_changes).segment_id == first
    assert info.segment_changes |> hd() |> Map.has_key?(:old_sha)

    assert {:error, :out_of_scope_changes} =
             LocalizedRevision.validate(@base, String.replace(@base, "第三段：名册。", "第三段：名册被改。"),
               scope: "target_segments",
               target_segment_ids: [first]
             )

    truncated = segs |> Enum.take(3) |> Enum.map_join(& &1.raw)

    assert {:error, :incomplete_scope} =
             LocalizedRevision.validate(@base, truncated,
               scope: "target_segments",
               target_segment_ids: [first]
             )

    # 空候选不 crash
    assert {:error, :incomplete_scope} =
             LocalizedRevision.validate(@base, "",
               scope: "target_segments",
               target_segment_ids: [first]
             )

    # 版本不符
    assert {:error, :stale_base_version} =
             LocalizedRevision.validate(@base, changed_first,
               scope: "target_segments",
               target_segment_ids: [first],
               base_version: 1,
               current_version: 2
             )

    # whole_chapter：整章允许变化
    assert {:ok, _} =
             LocalizedRevision.validate(@base, String.upcase(@base), scope: "whole_chapter")
  end

  test "B82 G2 页坐标：只列实际相交且有正文的段；正文去尾分隔符；页内 1-based 字素闭区间" do
    text = "甲😀\r\n\r\n乙𠀀乙\n\n丙"
    [first_base, second_base, third_base] = LocalizedRevision.segment(text)

    # 页从 "😀" 起、到 "乙" 止：首段部分可见，次段仅首字可见，末段不相交。
    assert [first, second] =
             LocalizedRevision.page_segments(
               text,
               byte_size("甲"),
               byte_size("甲😀\r\n\r\n乙")
             )

    assert first.segment_id == first_base.segment_id
    assert {first.byte_start, first.byte_end} == {0, byte_size("甲😀")}
    assert binary_part(text, first.byte_start, first.byte_end - first.byte_start) == "甲😀"
    assert first.page_range == %{start: 1, end: 1}

    assert second.segment_id == second_base.segment_id
    assert second.byte_start == byte_size("甲😀\r\n\r\n")
    assert second.byte_end == second.byte_start + byte_size("乙𠀀乙")
    assert binary_part(text, second.byte_start, second.byte_end - second.byte_start) == "乙𠀀乙"
    assert second.page_range == %{start: 4, end: 4}

    # 与页不相交或只有分隔符的段不列。
    refute Enum.any?([first, second], &(&1.segment_id == third_base.segment_id))
  end

  test "B82 G2 页坐标：无正文页/非法范围不造段" do
    text = "甲\n\n乙"
    assert LocalizedRevision.page_segments(text, 0, 0) == []
    assert LocalizedRevision.page_segments(text, byte_size(text), byte_size(text) + 3) == []
    assert LocalizedRevision.page_segments(nil, 0, 1) == []
  end
end
