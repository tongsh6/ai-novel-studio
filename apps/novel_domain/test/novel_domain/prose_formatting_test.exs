defmodule NovelDomain.ProseFormattingTest do
  use ExUnit.Case, async: true
  alias NovelDomain.ProseFormatting

  test "真实分段保持全部非换行字节，包括空格、标点、组合Unicode和标识" do
    for marker <- ["甲乙丙", "nonce_72539", "é👩‍💻"] do
      source = "首句  #{marker}。第二句！第三句。"
      view = ProseFormatting.view(source)
      [first | _] = view.boundaries

      assert {:ok, result} =
               ProseFormatting.apply_plan(source, view.source_hash, [
                 %{boundary_id: first.boundary_id, lines: 2}
               ])

      assert result.text == "首句  #{marker}。\n\n第二句！第三句。"
      assert ProseFormatting.non_newline_text(result.text) == source
      assert result.text =~ marker
      assert length(result.changed_boundaries) == 1
    end
  end

  test "原有换行可显式移除，未选换行保持原字节" do
    source = "甲。\r\n\r\n乙。\n丙。"
    view = ProseFormatting.view(source)
    first = hd(view.boundaries)
    assert first.lines == 2

    assert {:ok, result} =
             ProseFormatting.apply_plan(source, view.source_hash, [
               %{"boundary_id" => first.boundary_id, "lines" => 0}
             ])

    assert result.text == "甲。乙。\n丙。"
    assert ProseFormatting.non_newline_text(result.text) == "甲。乙。丙。"
  end

  test "重复句的边界不同，源变动使旧计划过期" do
    source = "重复句。重复句。末句。"
    view = ProseFormatting.view(source)
    assert length(Enum.uniq_by(view.boundaries, & &1.boundary_id)) == 2

    assert {:error, :stale_base_version} =
             ProseFormatting.apply_plan(source <> "后补。", view.source_hash, [
               %{boundary_id: hd(view.boundaries).boundary_id, lines: 2}
             ])
  end

  test "未知、重复、越界操作与注入正文拒绝；原样无改动不能冒充排版完成" do
    source = "甲。乙。"
    view = ProseFormatting.view(source)
    id = hd(view.boundaries).boundary_id

    for changes <- [
          [%{boundary_id: "unknown", lines: 2}],
          [%{boundary_id: id, lines: -1}],
          [%{boundary_id: id, lines: 3}],
          [%{boundary_id: id, lines: 2}, %{boundary_id: id, lines: 0}],
          [%{boundary_id: id, lines: 2, text: "改字"}]
        ] do
      assert {:error, :invalid_formatting_plan} =
               ProseFormatting.apply_plan(source, view.source_hash, changes)
    end

    assert {:error, :no_formatting_changes} =
             ProseFormatting.apply_plan(source, view.source_hash, [])

    assert {:error, :no_formatting_changes} =
             ProseFormatting.apply_plan(source, view.source_hash, [%{boundary_id: id, lines: 0}])
  end
end
