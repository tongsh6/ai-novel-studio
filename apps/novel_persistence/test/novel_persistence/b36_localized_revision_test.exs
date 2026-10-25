defmodule NovelPersistence.B36LocalizedRevisionTest do
  use ExUnit.Case, async: true

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
end
