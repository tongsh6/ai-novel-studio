defmodule NovelCommon.AuthoringSemanticsTest do
  use ExUnit.Case, async: true

  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask

  defp task(attrs \\ %{}) do
    struct!(
      %AuthoringTask{
        kind: :first_draft,
        author_goal: "写第 01 章首稿",
        author_words: "接着把第一章写出来",
        operation_effect: :create_candidate,
        scope: %{refs: ["chapter:one"], coverage: :chapter, base_ref: nil},
        output_contract: %{kind: :json, required_keys: ["items"], allow_companions: true}
      },
      attrs
    )
  end

  defp revision(attrs \\ %{}) do
    task(
      Map.merge(
        %{
          kind: :revision,
          operation_effect: :revise_candidate,
          scope: %{refs: ["as_1"], coverage: :single, base_ref: "as_1", base_hash: "sha256:abc"},
          preserve: ["修改范围外的正文逐字保留"]
        },
        attrs
      )
    )
  end

  test "version and content hash are stable for identical canonical text" do
    assert AuthoringSemantics.version() == "b27-semantics-v1"
    assert AuthoringSemantics.content_hash() == AuthoringSemantics.content_hash()
    assert String.length(AuthoringSemantics.content_hash()) == 64
  end

  test "all task kinds have effect sets, operation rules and labels" do
    for kind <- AuthoringTask.kinds() do
      effects = AuthoringSemantics.allowed_effects(kind)
      assert is_list(effects) and effects != []
      assert Enum.all?(effects, &is_atom/1)
      assert String.trim(AuthoringSemantics.operation_rules(kind)) != ""
      assert is_binary(AuthoringSemantics.kind_label(kind))
    end
  end

  test "format_only is not promised while no capability/consumer exists (deferred to B28)" do
    refute :format_only in AuthoringTask.kinds()
    refute Map.has_key?(AuthoringSemantics.kind_effects(), :format_only)
    refute AuthoringSemantics.shared_rules() =~ "仅排版"
  end

  test "static block has shared rules + kind operation rules + output contract; stable bytes" do
    task = task()
    block = AuthoringSemantics.static_block(task)

    assert block =~ "创作协作共同规则"
    assert block =~ "作者是唯一裁决者"
    assert block =~ "首稿创作"
    assert block =~ "输出契约纪律"
    assert block =~ "items"
    refute block =~ "接着把第一章写出来"
    refute block =~ "chapter:one"
    assert AuthoringSemantics.static_block(task) == block
  end

  test "dynamic block only carries real business facts; missing fields stay absent" do
    dynamic = AuthoringSemantics.dynamic_block(task())
    assert dynamic =~ "本轮作者目标"
    assert dynamic =~ "接着把第一章写出来"
    assert dynamic =~ "chapter:one"

    empty =
      AuthoringSemantics.dynamic_block(
        task(%{
          kind: :quality_evaluation,
          operation_effect: :evaluate,
          author_goal: nil,
          author_words: nil,
          scope: %{refs: [], coverage: :none}
        })
      )

    refute empty =~ "本轮作者目标"
    refute empty =~ "对象与范围"
  end

  test "full render contains shared rules exactly once" do
    rendered = AuthoringSemantics.render(task())
    assert String.contains?(rendered, AuthoringSemantics.shared_rules())
    assert length(String.split(rendered, "作者是唯一裁决者")) == 2
  end

  test "validate accepts well-formed tasks (first draft and button-driven revision)" do
    assert {:ok, %AuthoringTask{kind: :first_draft}} = AuthoringSemantics.validate(task())
    assert {:ok, %AuthoringTask{kind: :revision}} = AuthoringSemantics.validate(revision())
  end

  test "validate rejects author-driven task without author source" do
    bad = task(%{author_goal: nil, author_words: nil})

    assert {:error, {:authoring_task_invalid, {:author_source_missing, :first_draft}}} =
             AuthoringSemantics.validate(bad)
  end

  test "button-driven revision may use validated author action source instead of words" do
    button = revision(%{author_goal: nil, author_words: nil})
    assert {:error, _} = AuthoringSemantics.validate(button)

    with_action =
      revision(%{
        author_goal: nil,
        author_words: nil,
        source: %{kind: :author_action, ref: "act_1"}
      })

    assert {:ok, _} = AuthoringSemantics.validate(with_action)
  end

  test "validate rejects revision/rewrite without baseline identity" do
    bad = revision(%{scope: %{refs: [], coverage: :none, base_ref: nil}})

    assert {:error, {:authoring_task_invalid, {:scope_required, :revision}}} =
             AuthoringSemantics.validate(bad)

    bad =
      revision(%{
        scope: %{refs: ["as_1"], coverage: :single, base_ref: nil},
        preserve: ["修改范围外逐字保留"]
      })

    assert {:error, {:authoring_task_invalid, {:base_ref_required, :revision}}} =
             AuthoringSemantics.validate(bad)
  end

  test "revision/rewrite require explicit preserve list (scope-fidelity invariant)" do
    bad = revision(%{preserve: []})

    assert {:error, {:authoring_task_invalid, {:preserve_required, :revision}}} =
             AuthoringSemantics.validate(bad)

    rewrite =
      task(%{
        kind: :rewrite,
        operation_effect: :create_candidate,
        scope: %{refs: ["chapter:one"], coverage: :chapter, base_ref: "chapter:one"},
        preserve: ["未覆盖部分逐字保留"]
      })

    assert {:ok, _} = AuthoringSemantics.validate(rewrite)
  end

  test "validate decouples kind and effect via allowlist (role tools may create or revise)" do
    design = task(%{kind: :character_design, operation_effect: :design_object})
    assert {:ok, _} = AuthoringSemantics.validate(design)

    revision_by_role =
      task(%{
        kind: :character_design,
        operation_effect: :revise_candidate,
        scope: %{refs: ["as_char"], coverage: :single, base_ref: "as_char"},
        preserve: ["其他字段逐字保留"]
      })

    assert {:ok, _} = AuthoringSemantics.validate(revision_by_role)

    bad =
      task(%{
        kind: :revision,
        operation_effect: :create_candidate,
        scope: %{refs: ["as_1"], coverage: :single, base_ref: "as_1"},
        preserve: ["x"]
      })

    expected =
      {:authoring_task_invalid,
       {:effect_mismatch, :revision, [:revise_candidate], :create_candidate}}

    assert {:error, ^expected} = AuthoringSemantics.validate(bad)
  end

  test "JSON-safe roundtrip keeps task semantics and validates" do
    task =
      revision(%{
        materials: [%{kind: :prose, ref: "as_1", complete?: false, omission_note: "片段"}]
      })

    map = AuthoringTask.to_map(task)

    assert map["kind"] == :revision
    assert map["scope"][:base_ref] == "as_1"

    restored = AuthoringTask.from_map(map)
    assert restored.kind == :revision
    assert restored.operation_effect == :revise_candidate
    assert restored.scope.base_ref == "as_1"
    assert restored.preserve == ["修改范围外的正文逐字保留"]
    assert {:ok, _} = AuthoringSemantics.validate(restored)

    # string keys 也接受（JSON 解码后）
    string_map = Jason.decode!(Jason.encode!(map))
    assert %AuthoringTask{kind: :revision} = AuthoringTask.from_map(string_map)
  end

  test "validate rejects stale semantic version" do
    bad = task(%{semantic_version: "b27-semantics-v0"})

    expected =
      {:authoring_task_invalid,
       {:semantic_version_mismatch, "b27-semantics-v1", "b27-semantics-v0"}}

    assert {:error, ^expected} = AuthoringSemantics.validate(bad)
  end

  test "quality_evaluation/summary/inventory require real material (no legal empty materials)" do
    eval =
      task(%{
        kind: :quality_evaluation,
        operation_effect: :evaluate,
        author_goal: nil,
        author_words: nil,
        materials: []
      })

    assert {:error,
            {:authoring_task_invalid, {:required_materials_missing, :quality_evaluation, _}}} =
             AuthoringSemantics.validate(eval)

    ok = %{eval | materials: [%{kind: :prose, ref: "as_1", complete?: true}]}
    assert {:ok, _} = AuthoringSemantics.validate(ok)
  end

  test "validate rejects duplicate material refs and invalid complete flag" do
    bad =
      task(%{
        materials: [
          %{kind: :prior_prose, ref: "chapter:one", complete?: true},
          %{kind: :prior_prose, ref: "chapter:one", complete?: false}
        ]
      })

    assert {:error, {:authoring_task_invalid, :material_ref_duplicate}} =
             AuthoringSemantics.validate(bad)

    bad = task(%{materials: [%{kind: :prior_prose, ref: "chapter:one", complete?: "yes"}]})

    assert {:error, {:authoring_task_invalid, :material_complete_flag_invalid}} =
             AuthoringSemantics.validate(bad)
  end

  test "materials and baseline render completeness/omission explicitly" do
    dynamic =
      AuthoringSemantics.dynamic_block(
        revision(%{
          scope: %{refs: ["as_1"], coverage: :single, base_ref: "as_1", base_hash: "sha256:abc"},
          materials: [
            %{
              kind: :prior_prose,
              ref: "chapter:one",
              complete?: false,
              omission_note: "仅末尾 2000 字",
              version: 3
            }
          ]
        })
      )

    assert dynamic =~ "基线对象"
    assert dynamic =~ "基线内容 hash"
    assert dynamic =~ "不完整"
    assert dynamic =~ "仅末尾 2000 字"
    assert dynamic =~ "版本 3"
  end

  test "prior result renders real run status without claiming completion" do
    dynamic =
      AuthoringSemantics.dynamic_block(
        task(%{
          prior_result: %{
            run_ref: "run_1",
            status: :failed,
            summary: "生成失败，无候选",
            pending_refs: ["as_1"]
          }
        })
      )

    assert dynamic =~ "上一轮真实结果"
    assert dynamic =~ "run_1"
    assert dynamic =~ "failed"
    assert dynamic =~ "生成失败，无候选"
    assert dynamic =~ "as_1"
  end

  # ── B28 CP0：章节修订范围/format_only/基线版本 ──────────────

  test "modification_scope enums and format_only rules are mechanically validated" do
    assert AuthoringTask.modification_scopes() == [
             :format_only,
             :target_segments,
             :whole_chapter
           ]

    format_task =
      revision(%{
        scope: %{
          refs: ["draft:1", "draft:2"],
          coverage: :complete,
          target_chapter_ref: "chapter:one",
          modification_scope: :format_only,
          expected_base_versions: [%{ref: "draft:1", version: 2}]
        }
      })

    assert {:ok, _task} = AuthoringSemantics.validate(format_task)

    assert {:error, {:authoring_task_invalid, {:modification_scope_invalid, :bogus}}} =
             AuthoringSemantics.validate(
               revision(%{
                 scope: %{
                   refs: ["as_1"],
                   coverage: :single,
                   base_ref: "as_1",
                   modification_scope: :bogus
                 }
               })
             )

    assert {:error,
            {:authoring_task_invalid,
             {:effect_mismatch, :revision, [:revise_candidate], :create_candidate}}} =
             AuthoringSemantics.validate(
               revision(%{
                 operation_effect: :create_candidate,
                 scope: %{
                   refs: ["as_1"],
                   coverage: :single,
                   base_ref: "as_1",
                   modification_scope: :format_only
                 }
               })
             )

    assert {:error, {:authoring_task_invalid, {:format_only_target_required, :revision}}} =
             AuthoringSemantics.validate(
               revision(%{
                 scope: %{refs: ["as_1"], coverage: :single, modification_scope: :format_only}
               })
             )

    assert {:error, {:authoring_task_invalid, {:whole_chapter_coverage_required, :revision}}} =
             AuthoringSemantics.validate(
               revision(%{
                 scope: %{
                   refs: ["draft:1"],
                   coverage: :partial,
                   base_ref: "as_1",
                   modification_scope: :whole_chapter
                 }
               })
             )

    assert {:error, {:authoring_task_invalid, {:expected_base_versions_invalid, :revision}}} =
             AuthoringSemantics.validate(
               revision(%{
                 scope: %{
                   refs: ["as_1"],
                   coverage: :single,
                   base_ref: "as_1",
                   expected_base_versions: [%{ref: "as_1", version: "two"}]
                 }
               })
             )
  end

  test "scope roundtrip preserves modification_scope/expected_base_versions and renders them" do
    format_task =
      revision(%{
        scope: %{
          refs: ["draft:1", "draft:2"],
          coverage: :complete,
          target_chapter_ref: "chapter:one",
          modification_scope: :format_only,
          expected_base_versions: [%{ref: "draft:1", version: 2}, %{ref: "draft:2", version: 1}]
        }
      })

    map = AuthoringTask.to_map(format_task)
    assert map["scope"][:modification_scope] == :format_only

    assert map["scope"][:expected_base_versions] == [
             %{ref: "draft:1", version: 2},
             %{ref: "draft:2", version: 1}
           ]

    restored = AuthoringTask.from_map(map)
    assert restored.scope.modification_scope == :format_only

    assert restored.scope.expected_base_versions == [
             %{ref: "draft:1", version: 2},
             %{ref: "draft:2", version: 1}
           ]

    dynamic = AuthoringSemantics.dynamic_block(restored)
    assert dynamic =~ "仅排版"
    assert dynamic =~ "期望基线版本"
    assert dynamic =~ "draft:1=v2"
  end

  test "revision error codes are frozen single source" do
    codes = AuthoringSemantics.revision_error_codes()

    assert length(codes) == 8
    assert "format_only_violation" in codes
    assert "incomplete_scope" in codes
    assert "target_missing" in codes
  end
end
