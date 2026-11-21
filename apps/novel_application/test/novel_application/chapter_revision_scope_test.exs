defmodule NovelApplication.ChapterRevisionScopeTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ChapterRevisionAuthorInput
  alias NovelApplication.ChapterRevisionScope
  alias NovelPersistence.LocalizedRevision

  @style_author "请先查看本作品已经确认的风格规则，并阅读第01章《黑市对账夜》已保存的正文。据此把这一章改写成一份修订候选，突出人物之间的试探；先不要保存。"
  @whole_author "请先把第02章《灰烬中的手印》已保存的正文从头到尾读完，再给我一份整章修订候选，减少重复描写，保留开头和结尾的线索；先不要保存。"

  test "R05 章节直接宾语与唯一阅读先行词授 whole，参考章不冒充修改对象" do
    for words <- [
          @style_author,
          @whole_author,
          "把第01章《黑市对账夜》改写成一份修订候选。",
          "把第1章改写成新的版本。",
          "把第1章改写得更紧张。",
          "请修订第1章正文，让人物的对话更有试探。",
          "请重写第02章正文。",
          "把第1章改写成一份修订候选，不要改情节。",
          "读取第二章后修订整章正文。",
          "先读完第二章全文，再修订整章。",
          "参考第1章重写第2章。",
          "请整章重写。",
          "通读全文后整章润色。",
          "读第1章和第2章，但只改第2章。"
        ] do
      assert ChapterRevisionAuthorInput.authorize(words) == {:ok, :whole_chapter}, words
    end
  end

  test "R05 请求修订结果才授整章，结果的解释或定义不授写入范围" do
    for {words, expected} <- [
          {"先阅读第1章。给我一份整章修订的解释。", {:error, :author_scope_not_authorized}},
          {"先阅读第1章。给我一份整章修订的定义。", {:error, :author_scope_not_authorized}},
          {"先阅读第1章。给我一份整章修订候选的解释。", {:error, :author_scope_not_authorized}},
          {"先阅读第1章。给我一份整章修订稿。", {:ok, :whole_chapter}},
          {@whole_author, {:ok, :whole_chapter}}
        ] do
      assert ChapterRevisionAuthorInput.authorize(words) == expected, words
    end
  end

  test "R05 新章宾语语法保持局部、格式、否定、条件、引文与指代边界" do
    cases = [
      {@style_author <> "只改第一段，其余逐字保留。", {:ok, :target_segments}},
      {@style_author <> "只调整分段和排版，别改字句。", {:ok, :format_only}},
      {"先不要把第01章改写成一份修订候选。", {:error, :author_scope_not_authorized}},
      {"只改第1章第一段。", {:ok, :target_segments}},
      {"先阅读第1章。只改第一段，其余别动。", {:ok, :target_segments}},
      {"先阅读第1章。把「旧词」改为「新词」。", {:ok, :target_segments}},
      {"先阅读第1章。不要改第1章第一段。", {:error, :author_scope_not_authorized}},
      {"先阅读第1章。如果合适，就改第1章第一段。", {:error, :author_scope_not_authorized}},
      {"先阅读第1章。请解释“只改第1章第一段。”这句话。", {:error, :author_scope_not_authorized}},
      {"不要改第一段，只改第二段。", {:error, :author_scope_not_authorized}},
      {"先阅读第1章。不必改第一段。", {:error, :author_scope_not_authorized}},
      {"请把《黑市对账夜》整章重写。", {:error, :author_scope_not_authorized}},
      {"请整章重写第０１章正文。", {:error, :author_scope_not_authorized}},
      {"请把那一章整章重写。", {:error, :author_scope_not_authorized}},
      {"整章改写第1章第一段。", {:ok, :target_segments}},
      {"把第1章的第一段改写得更紧张。", {:ok, :target_segments}},
      {"只改第1章错别字。", {:ok, :target_segments}},
      {"只改第1章开头。", {:ok, :target_segments}},
      {"请重写第1章正文。不要把第1章改写成一份修订候选。", {:error, :author_scope_not_authorized}},
      {"不要重写第1章，请重写第2章正文。", {:error, :author_scope_not_authorized}},
      {"如果合适，把第01章改写成一份修订候选。", {:error, :author_scope_not_authorized}},
      {"若有必要，请重写第01章正文。", {:error, :author_scope_not_authorized}},
      {"如果合适，整章改写第1章。", {:error, :author_scope_not_authorized}},
      {"请解释“整章重写第1章。”这句话。", {:error, :author_scope_not_authorized}},
      {"不要把第1章第一段改写，请整章重写第1章。", {:error, :author_scope_not_authorized}},
      {"请解释“把第01章改写成一份修订候选。”这句话。", {:error, :author_scope_not_authorized}},
      {"他说：\n把第01章改写成一份修订候选。", {:error, :author_scope_not_authorized}},
      {"把第01章改写成一份修订候选？", {:error, :author_scope_not_authorized}},
      {"把第1章改写成新的版本是否合适。", {:error, :author_scope_not_authorized}},
      {"请评估是否把第01章改写成一份修订候选。", {:error, :author_scope_not_authorized}},
      {"把第01章的第一段改写成一份修订候选。", {:ok, :target_segments}},
      {"把这一章改写成一份修订候选。", {:error, :author_scope_not_authorized}},
      {"阅读第1章和第2章。据此把这一章改写成一份修订候选。", {:error, :author_scope_not_authorized}},
      {"阅读第1章。参考第2章。据此把这一章改写成一份修订候选。", {:error, :author_scope_not_authorized}},
      {"阅读第1章。把第2章改写成候选，再把这一章改写成一份修订候选。", {:error, :author_scope_not_authorized}}
    ]

    for {words, expected} <- cases do
      assert ChapterRevisionAuthorInput.authorize(words) == expected, words
    end
  end

  # B28 CP1：scope 表达“作者授权修改的范围”，材料读取不等于修改授权；
  # 否定/局部限制/条件不得被词面扩大；只读拒绝不得生成整章候选。
  @matrix [
    {"把整章正文里的年龄改一下", {:ok, :target_segments}},
    {"阅读第1章后整章改写的依据", {:error, :author_scope_not_authorized}},
    # 否定整章 + 局部限制：局部限制优先，不扩为整章
    {"不要整章重写，只改第一段。", {:ok, :target_segments}},
    # 通读/全文是材料读取，不是修改授权；局部限制仍生效
    {"通读全文后只修第二段。", {:ok, :target_segments}},
    # 只读检查 + 明确不改：不授权任何修改
    {"整章检查一遍，有问题告诉我，别改。", {:error, :author_scope_not_authorized}},
    {"只读一遍第03章，不要改。", {:error, :author_scope_not_authorized}},
    # 条件性整章：条件未判定即拒绝，不降级局部后再由定位恢复。
    {"如果第03章有明显问题就整章改一遍，没有问题就告诉我。", {:error, :author_scope_not_authorized}},
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
      assert ChapterRevisionAuthorInput.authorize(text) == expected, "input=#{text}"
    end
  end

  test "空文本/纯读取保守不授权整章" do
    assert ChapterRevisionAuthorInput.authorize("") == {:ok, :target_segments}
    assert ChapterRevisionAuthorInput.authorize(nil) == {:ok, :target_segments}

    assert ChapterRevisionAuthorInput.authorize("把这一章读一遍。") ==
             {:error, :author_scope_not_authorized}
  end

  test "否定整章但无局部限制 → 不授整章（保守局部，交由目标解析/澄清处理）" do
    assert ChapterRevisionAuthorInput.authorize("不要整章重写。") == {:ok, :target_segments}
  end

  test "target_segment_ids/2：段号/字面定位只认唯一命中，未知或越界拒绝" do
    segments =
      for raw <- ~w(一 二 三 四 五 六 七 八 九 十 十一) do
        %{segment_id: "seg_#{raw}", raw: raw}
      end

    assert ChapterRevisionAuthorInput.target_segment_ids(segments, "只改第十一段") ==
             {:ok, ["seg_十一"]}

    assert ChapterRevisionAuthorInput.target_segment_ids(segments, "只改第十段") == {:ok, ["seg_十"]}
    assert ChapterRevisionAuthorInput.target_segment_ids(segments, "开头改一下") == {:ok, ["seg_一"]}

    assert ChapterRevisionAuthorInput.target_segment_ids(segments, "把「三」改成「叁」") ==
             {:ok, ["seg_三"]}

    assert ChapterRevisionAuthorInput.target_segment_ids(segments, "只改第十二段") ==
             {:error, :target_missing}

    assert ChapterRevisionAuthorInput.target_segment_ids(segments, "只改第十十段") ==
             {:error, :target_missing}

    assert ChapterRevisionAuthorInput.target_segment_ids(segments, "只改第0段") ==
             {:error, :target_missing}

    assert ChapterRevisionAuthorInput.target_segment_ids(segments, "只改第十一段，把「三」改成「叁」") ==
             {:error, :target_ambiguous}

    assert ChapterRevisionAuthorInput.target_segment_ids(
             [%{segment_id: "only", raw: "aaa"}],
             "把「aa」改成「b」"
           ) == {:error, :target_ambiguous}

    assert ChapterRevisionAuthorInput.target_segment_ids(
             [%{segment_id: "first", raw: "ab"}, %{segment_id: "second", raw: "cd"}],
             "把「bc」改成「b」"
           ) == {:error, :target_missing}
  end

  test "R05 被拒绝与多目标原话不能通过段定位或引用式目标恢复" do
    segments = [
      %{segment_id: "seg_first", raw: "第一真实片段。"},
      %{segment_id: "seg_second", raw: "第二真实片段。"},
      %{segment_id: "seg_third", raw: "第三真实片段。"}
    ]

    for words <- [
          "先阅读第1章。不要改第1章第一段。",
          "先阅读第1章。如果合适，就改第1章第一段。",
          "先阅读第1章。请解释“只改第1章第一段。”这句话。",
          "不要改第一段，只改第二段。",
          "先阅读第1章。只改第二段而不是第一段。",
          "先阅读第1章。只改第一段和第二段。",
          "先阅读第1章。只改第二段和第三段。",
          "先阅读第1章。只改开头和第二段。",
          "先阅读第1章。只改第二段和最后一段。"
        ] do
      assert ChapterRevisionAuthorInput.authorize(words) ==
               {:error, :author_scope_not_authorized},
             words

      assert ChapterRevisionAuthorInput.target_segment_ids(segments, words) ==
               {:error, :author_scope_not_authorized},
             words

      refute ChapterRevisionAuthorInput.explicit_target?(words), words
      refute ChapterRevisionAuthorInput.reference_discovery_target?(words), words
      refute ChapterRevisionAuthorInput.local_target_authorized?(words), words
    end
  end

  test "R05 完整引号源中的标点、段号与替换动词只作为唯一字面数据定位" do
    for literal <- [
          "旧词，旧词",
          "第一段",
          "旧词改为新词",
          "旧词改成新词",
          "第一段，改为和改成只是原文"
        ] do
      segments = [
        %{segment_id: "seg_first", raw: "开头必须保留。"},
        %{segment_id: "seg_second", raw: literal <> "。"},
        %{segment_id: "seg_third", raw: "结尾必须保留。"}
      ]

      words = "先阅读第1章。把「#{literal}」改为「新词，第一段改成只是替换文字」。"

      assert ChapterRevisionAuthorInput.authorize(words) == {:ok, :target_segments}, words

      assert ChapterRevisionAuthorInput.target_segment_ids(segments, words) ==
               {:ok, ["seg_second"]},
             words

      assert ChapterRevisionAuthorInput.explicit_target?(words), words
      refute ChapterRevisionAuthorInput.reference_discovery_target?(words), words
    end
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
