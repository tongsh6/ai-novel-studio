defmodule NovelApplication.ChapterRevisionScopeTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ChapterRevisionScope
  alias NovelPersistence.LocalizedRevision

  # B28 CP1：scope 表达“作者授权修改的范围”，材料读取不等于修改授权；
  # 否定/局部限制/条件不得被词面扩大；只读拒绝不得生成整章候选。
  @matrix [
    # 否定整章 + 局部限制：局部限制优先，不扩为整章
    {"不要整章重写，只改第一段。", {:ok, :target_segments}},
    # 通读/全文是材料读取，不是修改授权；局部限制仍生效
    {"通读全文后只修第二段。", {:ok, :target_segments}},
    # 只读检查 + 明确不改：不授权任何修改
    {"整章检查一遍，有问题告诉我，别改。", {:error, :author_scope_not_authorized}},
    {"只读一遍第03章，不要改。", {:error, :author_scope_not_authorized}},
    # 条件性整章：条件未判定前保守为局部，不自动授整章
    {"如果第03章有明显问题就整章改一遍，没有问题就告诉我。", {:ok, :target_segments}},
    # 正向整章授权
    {"把第03章整章重写一遍，情节不变。", {:ok, :whole_chapter}},
    {"通读全文后整章润色，保留所有情节。", {:ok, :whole_chapter}},
    {"请通读整章并修订第一章正文。", {:ok, :whole_chapter}},
    # 仅排版正向限制（既有契约保留）
    {"只调整第03章分段和排版，不要改字句。", {:ok, :format_only}},
    {"把第一章正文整理一下，只调整分段和排版，别改字句。", {:ok, :format_only}},
    # 局部授权 / 字面替换默认局部
    {"把第03章第一段改得更紧张，其他段落别动。", {:ok, :target_segments}},
    {"把已保存的第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。", {:ok, :target_segments}},
    # 否定“仅排版”不是排版授权
    {"不是仅排版，需要修改第二段里的指定句子。", {:ok, :target_segments}}
  ]

  test "authorize/1 矩阵：否定/条件/读取/局部/正向授权" do
    for {text, expected} <- @matrix do
      assert ChapterRevisionScope.authorize(text) == expected, "input=#{text}"
    end
  end

  test "空文本/纯读取保守不授权整章" do
    assert ChapterRevisionScope.authorize("") == {:ok, :target_segments}
    assert ChapterRevisionScope.authorize(nil) == {:ok, :target_segments}
    assert ChapterRevisionScope.authorize("把这一章读一遍。") == {:ok, :target_segments}
  end

  test "否定整章但无局部限制 → 不授整章（保守局部，交由目标解析/澄清处理）" do
    assert ChapterRevisionScope.authorize("不要整章重写。") == {:ok, :target_segments}
  end

  test "target_segment_ids/2：段号/字面定位只认唯一命中，未知或越界拒绝" do
    segments =
      for raw <- ~w(一 二 三 四 五 六 七 八 九 十 十一) do
        %{segment_id: "seg_#{raw}", raw: raw}
      end

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第十一段") ==
             {:ok, ["seg_十一"]}

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第十段") == {:ok, ["seg_十"]}
    assert ChapterRevisionScope.target_segment_ids(segments, "开头改一下") == {:ok, ["seg_一"]}

    assert ChapterRevisionScope.target_segment_ids(segments, "把「三」改成「叁」") ==
             {:ok, ["seg_三"]}

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第十二段") ==
             {:error, :target_missing}

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第十十段") ==
             {:error, :target_missing}

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第0段") ==
             {:error, :target_missing}

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第十一段，把「三」改成「叁」") ==
             {:error, :target_ambiguous}
  end

  test "已有局部与整章候选按当前 accepted 事实复核，原 metadata 和正文保持原样" do
    base = "原开篇。\r\n\r\n原结尾。"
    segments = LocalizedRevision.segment(base)
    versions = [%{ref: "draft:scope-base", version: 7}]

    facts = %{
      target_chapter_ref: "chapter:scope",
      base_text: base,
      coverage: :complete,
      covered_refs: ["draft:scope-base"],
      expected_base_versions: versions,
      materials: [%{ref: "draft:scope-base", version: 7, text: base, complete?: true}]
    }

    for kind <- ["target_segments", "whole_chapter"] do
      targets = if kind == "target_segments", do: Enum.take(segments, 1), else: segments
      ids = Enum.map(targets, & &1.segment_id)
      hashes = Enum.map(targets, &%{"segment_id" => &1.segment_id, "sha256" => &1.sha256})

      scope = %{
        "kind" => kind,
        "target_chapter_ref" => facts.target_chapter_ref,
        "covered" => ["draft:scope-base:7"],
        "covered_refs" => ["draft:scope-base:7"],
        "target_segment_ids" => ids,
        "expected_segment_hashes" => hashes,
        "base_draft_ref" => "draft:scope-base",
        "base_version" => 7,
        "base_versions" => if(kind == "target_segments", do: versions)
      }

      effect =
        if kind == "target_segments" do
          Map.take(scope, [
            "covered",
            "target_segment_ids",
            "expected_segment_hashes",
            "base_draft_ref",
            "base_version",
            "base_versions"
          ])
          |> Map.put("mode", "replace_segments")
        else
          %{
            "mode" => "replace_scope",
            "covered" => ["draft:scope-base:7"],
            "expected_base_versions" => versions,
            "coverage" => "complete"
          }
        end

      item = %{item_id: "candidate", title: "修订", body: "  新候选。\r\n\r\n第二段。\t"}
      item = if kind == "target_segments", do: Map.put(item, :target_segment_ids, ids), else: item

      payload = %{
        items: [item],
        scope: scope,
        adoption_effect: effect,
        target_chapter_ref: facts.target_chapter_ref,
        modification_scope: kind
      }

      for original <- [payload, Jason.decode!(Jason.encode!(payload))] do
        assert {:ok, ^original} = ChapterRevisionScope.revalidate_payload(original, facts)
      end

      for stale <- [
            %{facts | base_text: "新字" <> base},
            %{facts | expected_base_versions: [%{ref: "draft:scope-base", version: 8}]},
            %{facts | target_chapter_ref: "chapter:other"},
            %{facts | coverage: :partial},
            %{facts | expected_base_versions: []}
          ] do
        assert {:error, _} = ChapterRevisionScope.revalidate_payload(payload, stale)
      end

      assert {:error, _} =
               ChapterRevisionScope.revalidate_payload(Map.put(payload, :content, "另一正文"), facts)

      assert {:error, _} =
               ChapterRevisionScope.revalidate_payload(
                 %{payload | scope: Map.put(scope, "kind", "other")},
                 facts
               )

      assert {:error, _} =
               ChapterRevisionScope.revalidate_payload(
                 %{payload | items: [%{item | body: " \r\n"}]},
                 facts
               )

      if kind == "target_segments" do
        for bad <- [
              Map.delete(item, :target_segment_ids),
              %{item | target_segment_ids: [List.last(segments).segment_id]},
              %{item | target_segment_ids: ids ++ ids}
            ] do
          assert {:error, _} =
                   ChapterRevisionScope.revalidate_payload(%{payload | items: [bad]}, facts)
        end
      end
    end
  end
end
