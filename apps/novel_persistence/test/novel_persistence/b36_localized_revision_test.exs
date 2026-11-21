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

  test "五个真实存储片段可合成一段，片段内锚句由替换正文明确保留" do
    base = "开篇锚句。" <> String.duplicate("旧写法。", 1_500) <> "尾灯。"
    segments = LocalizedRevision.segment(base)
    assert length(segments) == 5
    ids = Enum.map(segments, & &1.segment_id)
    body = "开篇锚句。重复写法收束，尾灯仍亮。"
    items = [%{item_id: "merged", target_segment_ids: ids, body: body}]

    assert {:ok, ^body, info} = LocalizedRevision.replace_segments(segments, ids, items)
    assert info.old_chars == String.length(base)
    assert info.new_chars == String.length(body)
    assert info.diff_stats.segment_count == 5
    assert info.diff_stats.changed_segment_count == 5
    assert Enum.map(info.segment_changes, & &1.segment_id) == ids

    [first_change | removed_contributions] = info.segment_changes
    expected_sha = :crypto.hash(:sha256, body) |> Base.encode16(case: :lower)
    assert first_change.new_sha == expected_sha

    assert Enum.all?(
             removed_contributions,
             &(&1.new_sha == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
           )
  end

  test "一个修订片段可拆为多个自然段，区间外原字节不变" do
    [first | _] = segments = LocalizedRevision.segment(@base)
    body = "第一段：灯影更沉。\n\n新自然段：旧钱仍在。"
    items = [%{item_id: "split", target_segment_ids: [first.segment_id], body: body}]

    assert {:ok, text, info} =
             LocalizedRevision.replace_segments(segments, [first.segment_id], items)

    assert text ==
             "第一段：灯影更沉。\n\n新自然段：旧钱仍在。\n\n第二段：旧钱。\n\n第三段：名册。\n\n第四段：脚步。\n\n第五段：安静。\n\n第六段：闸门。"

    assert [change] = info.segment_changes
    assert change.segment_id == first.segment_id
    assert change.old_sha == first.sha256
    assert info.diff_stats.changed_segment_count == 1
  end

  test "非连续区间按显式身份应用：外层调序等效，CRLF/Unicode/中间和首尾空白逐字保留" do
    base = "甲😀\r\n\r\n  夹缝 e\u0301 \r\n\r\n乙𠀀\r\n\r\n尾巴\t "
    [first, gap, third, tail] = segments = LocalizedRevision.segment(base)
    ids = [first.segment_id, third.segment_id]

    items = [
      %{item_id: "first", target_segment_ids: [first.segment_id], body: "  新甲😀\t"},
      %{
        "item_id" => "third",
        "target_segment_ids" => [third.segment_id],
        "body" => "新乙𠀀\n\n拆段e\u0301 "
      }
    ]

    expected = "  新甲😀\t\r\n\r\n  夹缝 e\u0301 \r\n\r\n新乙𠀀\n\n拆段e\u0301 \r\n\r\n尾巴\t "

    assert {:ok, ^expected, info} = LocalizedRevision.replace_segments(segments, ids, items)

    assert {:ok, ^expected, ^info} =
             LocalizedRevision.replace_segments(segments, ids, Enum.reverse(items))

    assert gap.raw == "  夹缝 e\u0301 \r\n\r\n"
    assert tail.raw == "尾巴\t "
    assert Enum.map(info.segment_changes, & &1.segment_id) == ids
    assert info.diff_stats.changed_segment_count == 2
  end

  test "降序 ID 不得因切片起点碰巧命中另一授权区间而改错来源" do
    [first, second, third | _] = segments = LocalizedRevision.segment(@base)

    items = [
      %{
        item_id: "backward",
        target_segment_ids: [second.segment_id, first.segment_id],
        body: "不能把第二和第一片段偷换为第二和第三片段。"
      }
    ]

    assert {:error, :incomplete_scope} =
             LocalizedRevision.replace_segments(
               segments,
               [second.segment_id, third.segment_id],
               items
             )
  end

  test "多片段同字节替换不因贡献归并制造虚假变化" do
    [first, second | _] = segments = LocalizedRevision.segment(@base)
    ids = [first.segment_id, second.segment_id]

    items = [
      %{
        item_id: "unchanged",
        target_segment_ids: ids,
        body: "第一段：灯影。\n\n第二段：旧钱。"
      }
    ]

    assert {:ok, @base, info} = LocalizedRevision.replace_segments(segments, ids, items)
    assert info.segment_changes == []
    assert info.old_chars == info.new_chars
    assert info.diff_stats.changed_segment_count == 0
    assert info.diff_stats.changed_old_chars == 0
    assert info.diff_stats.changed_new_chars == 0
  end

  for invalid_case <- [
        "missing_binding",
        "null_binding",
        "empty_binding",
        "duplicate_authorization",
        "non_string_authorization",
        "unknown_authorization",
        "unknown_item_target",
        "missing_authorized_target",
        "outside_authorization",
        "duplicate_item_target",
        "non_string_item_target",
        "overlapping_items",
        "reversed_region",
        "non_contiguous_region",
        "duplicate_item_id",
        "missing_item_id",
        "null_item_id",
        "non_string_item_id",
        "empty_item_id",
        "whitespace_item_id",
        "empty_items",
        "flat_pieces",
        "empty_body",
        "whitespace_body",
        "non_string_body"
      ] do
    test "区间输入非法即拒绝，不强转或去重：#{invalid_case}" do
      [first, second, third | _] = segments = LocalizedRevision.segment(@base)
      one = %{item_id: "one", target_segment_ids: [first.segment_id], body: "第一处新正文。"}
      two = %{item_id: "two", target_segment_ids: [second.segment_id], body: "第二处新正文。"}

      {ids, items} =
        case unquote(invalid_case) do
          "missing_binding" ->
            {[first.segment_id], [Map.delete(one, :target_segment_ids)]}

          "null_binding" ->
            {[first.segment_id], [%{one | target_segment_ids: nil}]}

          "empty_binding" ->
            {[first.segment_id], [%{one | target_segment_ids: []}]}

          "duplicate_authorization" ->
            {[first.segment_id, first.segment_id], [one]}

          "non_string_authorization" ->
            {[String.to_charlist(first.segment_id)], [one]}

          "unknown_authorization" ->
            {["seg_unknown"], [%{one | target_segment_ids: ["seg_unknown"]}]}

          "unknown_item_target" ->
            {[first.segment_id], [%{one | target_segment_ids: ["seg_unknown"]}]}

          "missing_authorized_target" ->
            {[first.segment_id, second.segment_id], [one]}

          "outside_authorization" ->
            {[first.segment_id], [two]}

          "duplicate_item_target" ->
            {[first.segment_id],
             [%{one | target_segment_ids: [first.segment_id, first.segment_id]}]}

          "non_string_item_target" ->
            {[first.segment_id],
             [%{one | target_segment_ids: [String.to_charlist(first.segment_id)]}]}

          "overlapping_items" ->
            {[first.segment_id, second.segment_id],
             [%{one | target_segment_ids: [first.segment_id, second.segment_id]}, two]}

          "reversed_region" ->
            {[first.segment_id, second.segment_id],
             [%{one | target_segment_ids: [second.segment_id, first.segment_id]}]}

          "non_contiguous_region" ->
            {[first.segment_id, third.segment_id],
             [%{one | target_segment_ids: [first.segment_id, third.segment_id]}]}

          "duplicate_item_id" ->
            {[first.segment_id, second.segment_id], [one, %{two | item_id: one.item_id}]}

          "missing_item_id" ->
            {[first.segment_id], [Map.delete(one, :item_id)]}

          "null_item_id" ->
            {[first.segment_id], [%{one | item_id: nil}]}

          "non_string_item_id" ->
            {[first.segment_id], [%{one | item_id: 123}]}

          "empty_item_id" ->
            {[first.segment_id], [%{one | item_id: ""}]}

          "whitespace_item_id" ->
            {[first.segment_id], [%{one | item_id: " \t\r\n"}]}

          "empty_items" ->
            {[first.segment_id], []}

          "flat_pieces" ->
            {[first.segment_id], ["不能兼容旧平串片段"]}

          "empty_body" ->
            {[first.segment_id], [%{one | body: ""}]}

          "whitespace_body" ->
            {[first.segment_id], [%{one | body: " \r\n\t "}]}

          "non_string_body" ->
            {[first.segment_id], [%{one | body: 123}]}
        end

      assert {:error, _reason} = LocalizedRevision.replace_segments(segments, ids, items)
    end
  end

  test "compose_content 只按原 items 顺序用两个 LF 组合原 body 字节" do
    items = [
      %{item_id: "one", body: "  甲😀\t"},
      %{"item_id" => "two", "body" => "\r\n乙e\u0301  "}
    ]

    assert {:ok, "  甲😀\t\n\n\r\n乙e\u0301  "} = LocalizedRevision.compose_content(items)

    assert {:ok, "\r\n乙e\u0301  \n\n  甲😀\t"} =
             LocalizedRevision.compose_content(Enum.reverse(items))
  end

  test "compose_content 拒绝缺失/非字串/空白正文，不丢项、不用标题或 content 补正文" do
    for items <- [
          nil,
          [],
          ["平串不是 item"],
          [%{body: ""}],
          [%{body: " \t\r\n "}],
          [%{body: 123}],
          [%{content: "另一份正文"}],
          [%{title: "不能补正文"}],
          [%{body: "有效正文"}, %{body: nil}]
        ] do
      assert {:error, :incomplete_scope} = LocalizedRevision.compose_content(items)
    end
  end

  test "whole 允许六片段压缩成一段，按旧 source slots 计算回执" do
    segments = LocalizedRevision.segment(@base)
    body = "灯影下，旧钱与名册留下线索，闸门合拢。"
    items = [%{item_id: "whole", body: body}]
    assert String.length(body) < div(String.length(@base), 2)

    assert {:ok, ^body, info} = LocalizedRevision.replace_scope(segments, items)
    assert info.old_chars == String.length(@base)
    assert info.new_chars == String.length(body)
    assert info.diff_stats.segment_count == 6
    assert info.diff_stats.changed_segment_count == 6
    assert Enum.map(info.segment_changes, & &1.segment_id) == Enum.map(segments, & &1.segment_id)
  end

  test "whole 组合多 items 允许自然段数增加且不附旧尾分隔符" do
    segments = LocalizedRevision.segment("旧章。\r\n\r\n")

    items = [
      %{item_id: "opening", body: "  新开头。\n\n第二自然段。"},
      %{item_id: "ending", body: "新结尾。\t "}
    ]

    assert {:ok, "  新开头。\n\n第二自然段。\n\n新结尾。\t ", info} =
             LocalizedRevision.replace_scope(segments, items)

    assert info.diff_stats.segment_count == 1
    assert info.diff_stats.changed_segment_count == 1
  end

  test "whole 同字节正文无虚假变化；无真实基线或空正文不能应用" do
    segments = LocalizedRevision.segment(@base)
    assert {:ok, @base, info} = LocalizedRevision.replace_scope(segments, [%{body: @base}])
    assert info.segment_changes == []
    assert info.diff_stats.changed_segment_count == 0
    assert info.diff_stats.changed_old_chars == 0
    assert info.diff_stats.changed_new_chars == 0

    assert {:error, :incomplete_scope} = LocalizedRevision.replace_scope([], [%{body: "新正文"}])
    assert {:error, :incomplete_scope} = LocalizedRevision.replace_scope(segments, [%{body: ""}])
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
