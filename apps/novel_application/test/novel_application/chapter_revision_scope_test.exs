defmodule NovelApplication.ChapterRevisionScopeTest do
  use ExUnit.Case, async: true

  alias NovelApplication.ChapterRevisionScope
  alias NovelPersistence.LocalizedRevision

  @chapter_judgment %{
    action: "execute",
    capability: "revise_adopted_content",
    adopted_content_ref: "chapter:current"
  }

  test "章修订必须显式提供现有范围，原话和目标文字不能补齐缺项" do
    for judgment <- [
          @chapter_judgment,
          Map.put(@chapter_judgment, :author_input, "请整章重写。"),
          Map.put(@chapter_judgment, :dialogue_goal, "whole_chapter")
        ] do
      assert {:error, {:modification_scope, :required}} =
               ChapterRevisionScope.validate_judgment_scope(judgment)
    end

    for scope <- [:format_only, :whole_chapter],
        value <- [scope, Atom.to_string(scope)] do
      assert {:ok, ^scope} =
               ChapterRevisionScope.validate_judgment_scope(
                 Map.put(@chapter_judgment, :modification_scope, value)
               )
    end

    for value <- ["", "whole", "whole_chapter ", 1, %{}] do
      assert {:error, {:modification_scope, :invalid}} =
               ChapterRevisionScope.validate_judgment_scope(
                 Map.put(@chapter_judgment, :modification_scope, value)
               )
    end
  end

  test "局部范围要求非空唯一片段，整章与排版不接受局部选择或观察证明" do
    targeted = Map.put(@chapter_judgment, :modification_scope, "target_segments")

    for ids <- [nil, []] do
      assert {:error, {:target_segments, :ids_required}} =
               ChapterRevisionScope.validate_judgment_scope(
                 Map.put(targeted, :target_segment_ids, ids)
               )
    end

    for ids <- [["seg_a", "seg_a"], [""], [" \t"], [nil], [1], "seg_a"] do
      assert {:error, {:target_segments, :invalid_selection}} =
               ChapterRevisionScope.validate_judgment_scope(
                 Map.put(targeted, :target_segment_ids, ids)
               )
    end

    # 此处只验证声明形状；真实观察资格由 bind_observed_targets 与执行前基线复核承担。
    assert {:ok, :target_segments} =
             ChapterRevisionScope.validate_judgment_scope(
               Map.put(targeted, :target_segment_ids, ["seg_a", "seg_b"])
             )

    for scope <- ["whole_chapter", "format_only"],
        fields <- [
          %{target_segment_ids: []},
          %{target_segment_ids: ["seg_a"]},
          %{observed_targets: %{target_segment_ids: ["seg_a"]}}
        ] do
      assert {:error, {:target_segments, :not_allowed}} =
               ChapterRevisionScope.validate_judgment_scope(
                 @chapter_judgment
                 |> Map.put(:modification_scope, scope)
                 |> Map.merge(fields)
               )
    end
  end

  test "非章修订动作不接受章范围字段，不静默清除冲突字段后执行" do
    for judgment <- [
          %{@chapter_judgment | adopted_content_ref: "as_saved"},
          %{@chapter_judgment | capability: "prose_writing"},
          %{@chapter_judgment | action: "explore"}
        ] do
      assert {:ok, nil} = ChapterRevisionScope.validate_judgment_scope(judgment)

      assert {:error, {:modification_scope, :not_allowed}} =
               ChapterRevisionScope.validate_judgment_scope(
                 Map.put(judgment, :modification_scope, "whole_chapter")
               )

      for fields <- [
            %{target_segment_ids: []},
            %{target_segment_ids: ["seg_a"]},
            %{observed_targets: %{target_segment_ids: ["seg_a"]}}
          ] do
        assert {:error, {:target_segments, :not_allowed}} =
                 ChapterRevisionScope.validate_judgment_scope(Map.merge(judgment, fields))
      end
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
