defmodule NovelApplication.AuthoringTaskBuilderTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringTaskBuilder
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask

  defp first_draft_attrs do
    %{
      author_goal: "写第 01 章首稿",
      author_words: "把第一章写出来",
      scope: AuthoringTaskBuilder.scope(["chapter:one"], coverage: :chapter),
      materials: [
        AuthoringTaskBuilder.material(:target_structure, "chapter:one",
          complete?: true,
          version: 2
        )
      ],
      output_contract:
        AuthoringTaskBuilder.output_contract(:json,
          required_keys: ["items"],
          allow_companions: true
        )
    }
  end

  test "new/2 builds and validates a well-formed task with default effect" do
    assert {:ok, %AuthoringTask{} = task} =
             AuthoringTaskBuilder.new(:first_draft, first_draft_attrs())

    assert task.operation_effect == :create_candidate
    assert task.semantic_version == AuthoringSemantics.version()
    assert task.scope.coverage == :chapter
  end

  test "new/2 rejects invalid tasks instead of downgrading guesses" do
    attrs = Map.drop(first_draft_attrs(), [:author_goal, :author_words])

    assert {:error, {:authoring_task_invalid, {:author_source_missing, :first_draft}}} =
             AuthoringTaskBuilder.new(:first_draft, attrs)

    revision_attrs =
      first_draft_attrs()
      |> Map.put(:operation_effect, :revise_candidate)
      |> Map.put(:scope, AuthoringTaskBuilder.scope(["as_1"], coverage: :single))
      |> Map.put(:preserve, ["范围外逐字保留"])

    assert {:error, {:authoring_task_invalid, {:base_ref_required, :revision}}} =
             AuthoringTaskBuilder.new(:revision, revision_attrs)
  end

  test "scope/material helpers only keep real values (no fabricated defaults)" do
    scope = AuthoringTaskBuilder.scope(["as_1"], coverage: :single, base_ref: "as_1")
    assert scope == %{refs: ["as_1"], coverage: :single, base_ref: "as_1"}
    refute Map.has_key?(scope, :base_hash)

    material = AuthoringTaskBuilder.material(:prior_prose, "as_1", complete?: false)
    assert material == %{kind: :prior_prose, ref: "as_1", complete?: false}
    refute Map.has_key?(material, :omission_note)
  end

  test "to_input/from_input roundtrip via JSON-safe map and re-validates" do
    {:ok, task} = AuthoringTaskBuilder.new(:first_draft, first_draft_attrs())
    input = AuthoringTaskBuilder.to_input(task)

    assert %{"authoring_task" => %{"kind" => :first_draft}} = input
    # ToolRequest.input 会经过 JSON 编码/持久化
    decoded = Jason.decode!(Jason.encode!(input))

    assert {:ok, %AuthoringTask{kind: :first_draft} = restored} =
             AuthoringTaskBuilder.from_input(decoded)

    assert restored.author_words == "把第一章写出来"
    assert restored.scope.coverage == :chapter
    assert {:ok, _} = AuthoringSemantics.validate(restored)
  end

  test "from_input returns nil for legacy calls without task (migration compatibility)" do
    assert {:ok, nil} = AuthoringTaskBuilder.from_input(%{"text" => "旧调用"})
    assert {:ok, nil} = AuthoringTaskBuilder.from_input(nil)
  end

  test "from_input rejects malformed task instead of silently dropping it" do
    assert {:error, {:authoring_task_invalid, _}} =
             AuthoringTaskBuilder.from_input(%{"authoring_task" => %{"kind" => :first_draft}})
  end
end

defmodule NovelApplication.AuthoringTaskBuilderProseTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringTaskBuilder

  defp sections(overrides \\ %{}) do
    Map.merge(
      %{
        target_structure: "## 目标章结构",
        prior_summaries: "## 前文各章摘要",
        character_roster: "## 现有角色",
        creative_facts: "## 作品事实",
        style_guide: "## 写作风格",
        progress_state: "## 账面",
        dialogue_context: "## 当前作者输入",
        execution_brief: "## 场级执行简述"
      },
      overrides
    )
  end

  defp writer_attrs(overrides \\ %{}) do
    Map.merge(
      %{
        action: %{authoring_intent: nil, summary: "写第 01 章首稿"},
        turn_id: "turn_1",
        resolved_chapter: "第01章：灯楼夜雨",
        resolved_chapter_ref: "chapter:one",
        author_input: %{text: "应用拼接", author_goal_text: "把第一章写出来"},
        author_goal: "写第 01 章首稿",
        prior_prose: "",
        omission_notes: [],
        sections: sections(),
        execution_brief: "## 场级执行简述",
        execution_brief_degraded?: false,
        facts_truncated?: false,
        style_truncated?: false,
        source_refs: ["turn:turn_1"]
      },
      overrides
    )
  end

  test "writer kind is derived from verified facts, not prompt keywords" do
    assert {:ok, task} = AuthoringTaskBuilder.for_prose_writing(writer_attrs())
    assert task.kind == :first_draft
    assert task.operation_effect == :create_candidate
    assert task.author_words == "把第一章写出来"
    assert task.author_goal == "写第 01 章首稿"
    assert task.scope.coverage == :chapter
    assert task.scope.refs == ["chapter:one"]

    assert {:ok, %{kind: :continuation}} =
             AuthoringTaskBuilder.for_prose_writing(
               writer_attrs(%{action: %{authoring_intent: "continuation", summary: "续写"}})
             )

    # intent 缺失但目标章已有已采纳前文（产品事实）按续写渲染
    assert {:ok, %{kind: :continuation}} =
             AuthoringTaskBuilder.for_prose_writing(writer_attrs(%{prior_prose: "前文正文"}))
  end

  test "rewrite requires a real base_ref and explicit preserve" do
    attrs =
      writer_attrs(%{
        action: %{authoring_intent: :rewrite, summary: "重写第01章"},
        prior_prose: "旧正文"
      })

    assert {:ok, task} = AuthoringTaskBuilder.for_prose_writing(attrs)
    assert task.kind == :rewrite
    assert task.scope.base_ref == "chapter:one"
    assert task.preserve != []

    # 没有目标章身份时不得伪造 base_ref：返回可解释错误而不是派发
    no_ref =
      attrs
      |> Map.put(:resolved_chapter_ref, nil)
      |> Map.put(:resolved_chapter, nil)

    assert {:error, {:authoring_task_invalid, {:base_ref_required, :rewrite}}} =
             AuthoringTaskBuilder.for_prose_writing(no_ref)
  end

  test "materials carry completeness/omission notes only when sourced" do
    {:ok, task} =
      AuthoringTaskBuilder.for_prose_writing(
        writer_attrs(%{
          prior_prose: "已采纳前文",
          omission_notes: [%{source: "prior_prose:第01章", reason: :budget_limited}],
          facts_truncated?: true
        })
      )

    prior = Enum.find(task.materials, &(&1.kind == :prior_prose))
    assert prior.complete? == false
    assert prior.omission_note =~ "budget_limited"

    facts = Enum.find(task.materials, &(&1.kind == :creative_facts))
    assert facts.complete? == false
    assert facts.omission_note =~ "截断"

    refs = Enum.map(task.materials, & &1.ref)
    assert length(refs) == length(Enum.uniq(refs))
  end

  test "revision task carries source/base_ref/hash/preserve; missing artifact rejected" do
    attrs = %{
      source: %{kind: :quality_finding, ref: "qf_1"},
      artifact_ref: "as_1",
      base_body: "原正文",
      coverage: :single,
      target_chapter_ref: "chapter:one",
      author_goal: "按质量发现修订",
      findings_ref: "quality_findings:turn_1",
      source_refs: ["turn:turn_1"]
    }

    assert {:ok, task} = AuthoringTaskBuilder.for_revision(attrs)
    assert task.kind == :revision
    assert task.operation_effect == :revise_candidate
    assert task.scope.base_ref == "as_1"
    assert String.length(task.scope.base_hash) == 64
    assert task.preserve != []
    assert task.source.kind == :quality_finding
    assert Enum.any?(task.materials, &(&1.kind == :baseline_body))
    assert Enum.any?(task.materials, &(&1.kind == :quality_findings))

    assert {:error, {:authoring_task_invalid, {:scope_required, :revision}}} =
             AuthoringTaskBuilder.for_revision(Map.drop(attrs, [:artifact_ref]))
  end

  test "quality evaluation task always carries real prose material and single-artifact coverage" do
    assert {:ok, task} =
             AuthoringTaskBuilder.for_quality_evaluation(%{
               source_ref: "as_1",
               turn_id: "turn_1",
               coverage: :single,
               target_chapter_ref: "chapter:one",
               execution_brief: "## 场级执行简述",
               facts_context: "## 作品事实"
             })

    assert task.kind == :quality_evaluation
    assert task.operation_effect == :evaluate
    assert task.scope.coverage == :single

    prose = Enum.find(task.materials, &(&1.kind == :prose))
    assert prose.ref == "as_1"
    assert prose.complete? == false
    assert prose.omission_note =~ "非整章"

    assert {:error, {:authoring_task_invalid, :material_ref_required}} =
             AuthoringTaskBuilder.for_quality_evaluation(%{turn_id: nil, source_ref: nil})
  end
end

defmodule NovelApplication.AuthoringTaskBuilderCreativeRolesTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringTaskBuilder

  defp sections(overrides \\ %{}) do
    Map.merge(
      %{
        character_roster: "## 现有角色\n- 白露（对手）",
        prior_summaries: "## 前文各章摘要",
        creative_facts: "## 作品事实",
        style_guide: "## 写作风格",
        work_skeleton: "## 全书进度",
        planning_mission: "## 本轮规划使命",
        dialogue_context: "## 当前作者输入"
      },
      overrides
    )
  end

  defp attrs(overrides \\ %{}) do
    Map.merge(
      %{
        action: %{summary: "按作者请求生成候选"},
        turn_id: "turn_1",
        workspace_id: "work_1",
        author_input: %{author_goal_text: "作者原话 NONCE1"},
        author_goal: "按作者请求生成候选",
        sections: sections(),
        source_refs: ["turn:turn_1"]
      },
      overrides
    )
  end

  test "outline creation task keeps domain artifact_type and work scope" do
    assert {:ok, task} = AuthoringTaskBuilder.for_outline(attrs())
    assert task.kind == :outline
    assert task.operation_effect == :create_candidate
    assert task.output_contract.artifact_type == :outline_draft
    assert task.scope.object_kind == :outline
    assert task.scope.coverage == :multi
    assert task.author_words == "作者原话 NONCE1"
    assert Enum.any?(task.materials, &(&1.kind == :planning_mission))
  end

  test "character design/evolution creation tasks use role effects and schemas" do
    assert {:ok, design} = AuthoringTaskBuilder.for_character_design(attrs())
    assert design.kind == :character_design
    assert design.operation_effect == :design_object
    assert design.output_contract.artifact_type == :character_seed
    assert design.scope.object_kind == :character

    assert {:ok, evolution} = AuthoringTaskBuilder.for_character_evolution(attrs())
    assert evolution.kind == :character_evolution
    assert evolution.operation_effect == :create_candidate
    assert evolution.output_contract.artifact_type == :character_evolution_seed
    assert evolution.scope.object_kind == :character_memory
  end

  test "world building artifact_type comes from author intent deterministically" do
    cases = [
      {"设计一个跨三卷回收的伏笔线索", :foreshadowing_seed},
      {"制定一条后续写作规则，约束战斗段落文风", :style_rule_seed},
      {"制定一个会持续制造选择压力的世界规则", :world_rule_seed},
      {"禁止提前揭示矿区旧账谜底", :constraint_seed},
      {"写一个关于灯楼九层天气的世界设定", :world_setting}
    ]

    for {words, artifact_type} <- cases do
      {:ok, task} =
        AuthoringTaskBuilder.for_world_building(
          attrs(%{author_input: %{author_goal_text: words}, author_goal: "生成世界设定草稿"})
        )

      assert task.output_contract.artifact_type == artifact_type
    end

    # 显式 artifact_type 优先于分类
    {:ok, explicit} =
      AuthoringTaskBuilder.for_world_building(attrs(%{artifact_type: :constraint_seed}))

    assert explicit.output_contract.artifact_type == :constraint_seed
  end

  test "role revisions carry artifact_type, base_ref/hash and preserve" do
    for {artifact_type, role} <- [
          {:prose_fragment, :prose},
          {:outline_draft, :outline},
          {:character_seed, :character_design},
          {:world_setting, :world_building}
        ] do
      attrs = %{
        source: %{kind: :author_action, ref: "turn:rev"},
        artifact_ref: "as_1",
        artifact_type: artifact_type,
        base_body: "原候选正文",
        coverage: :single,
        target_chapter_ref: "chapter:one",
        author_goal: "按作者要求修订",
        author_words: "改一下",
        source_refs: ["turn:rev"]
      }

      assert {:ok, task} = AuthoringTaskBuilder.for_revision(attrs)
      assert task.kind == :revision
      assert task.operation_effect == :revise_candidate
      assert task.scope.base_ref == "as_1"
      assert String.length(task.scope.base_hash) == 64
      assert task.preserve != []
      assert task.output_contract.artifact_type == artifact_type
      assert task.scope.object_kind == expected_object_kind(role)
    end
  end

  test "role revision without base_ref is rejected" do
    assert {:error, {:authoring_task_invalid, {:scope_required, :revision}}} =
             AuthoringTaskBuilder.for_revision(%{
               artifact_type: :outline_draft,
               base_body: "x",
               author_goal: "修订"
             })
  end

  defp expected_object_kind(:prose), do: :prose_fragment
  defp expected_object_kind(:outline), do: :outline
  defp expected_object_kind(:character_design), do: :character
  defp expected_object_kind(:world_building), do: :world_setting
end

defmodule NovelApplication.AuthoringTaskBuilderChapterRevisionTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringTaskBuilder

  defp attrs(overrides \\ %{}) do
    Map.merge(
      %{
        target_chapter_ref: "chapter:ch01",
        covered_refs: ["draft:d1", "draft:d2", "scene:s1"],
        modification_scope: :format_only,
        expected_base_versions: [
          %{ref: "draft:d1", version: 2},
          %{ref: "draft:d2", version: 1}
        ],
        coverage: :complete,
        materials: [
          AuthoringTaskBuilder.material(:draft, "draft:d1", version: 2, complete?: true),
          AuthoringTaskBuilder.material(:draft, "draft:d2", version: 1, complete?: true)
        ],
        author_goal: "把第一章正文按作者要求整理",
        author_words: "把第一章正文整理一下，只调整分段和排版",
        source: %{kind: :author_action, ref: "turn:t1"},
        source_refs: ["turn:t1"]
      },
      overrides
    )
  end

  test "format_only chapter revision builds chapter-scoped task with complete coverage" do
    assert {:ok, task} = AuthoringTaskBuilder.for_chapter_revision(attrs())

    assert task.kind == :revision
    assert task.operation_effect == :revise_candidate
    assert task.scope.target_chapter_ref == "chapter:ch01"
    assert task.scope.modification_scope == :format_only
    assert task.scope.object_kind == :chapter_prose
    assert task.scope.coverage == :complete
    assert task.scope.refs == ["draft:d1", "draft:d2", "scene:s1"]
    assert Map.get(task.scope, :base_ref) == nil

    assert task.scope.expected_base_versions == [
             %{ref: "draft:d1", version: 2},
             %{ref: "draft:d2", version: 1}
           ]

    assert length(task.materials) == 2
    assert "未要求修改的内容逐字保留" in task.preserve
  end

  test "whole_chapter revision forces complete coverage and supports version expectations" do
    assert {:ok, task} =
             AuthoringTaskBuilder.for_chapter_revision(
               attrs(%{
                 modification_scope: :whole_chapter,
                 coverage: :complete,
                 expected_base_versions: [%{ref: "draft:d1", version: 3}]
               })
             )

    assert task.scope.modification_scope == :whole_chapter
    assert task.scope.coverage == :complete
    assert task.scope.expected_base_versions == [%{ref: "draft:d1", version: 3}]
    assert task.output_contract.allow_companions == false
  end

  test "chapter revision requires chapter target / scope / covered refs (explainable errors)" do
    assert {:error, {:authoring_task_invalid, {:target_chapter_ref_required, :revision}}} =
             AuthoringTaskBuilder.for_chapter_revision(attrs(%{target_chapter_ref: nil}))

    assert {:error, {:authoring_task_invalid, {:modification_scope_required, :revision}}} =
             AuthoringTaskBuilder.for_chapter_revision(attrs(%{modification_scope: nil}))

    assert {:error, {:authoring_task_invalid, {:modification_scope_required, :revision}}} =
             AuthoringTaskBuilder.for_chapter_revision(
               attrs(%{modification_scope: :invalid_scope})
             )

    assert {:error, {:authoring_task_invalid, {:covered_refs_required, :revision}}} =
             AuthoringTaskBuilder.for_chapter_revision(attrs(%{covered_refs: []}))

    assert {:error, {:authoring_task_invalid, {:covered_refs_duplicated, :revision}}} =
             AuthoringTaskBuilder.for_chapter_revision(
               attrs(%{covered_refs: ["draft:d1", "draft:d1"]})
             )
  end

  test "whole_chapter rejects partial coverage; invalid expected versions rejected" do
    assert {:error, {:authoring_task_invalid, {:whole_chapter_coverage_required, :revision}}} =
             AuthoringTaskBuilder.for_chapter_revision(
               attrs(%{modification_scope: :whole_chapter, coverage: :partial})
             )

    assert {:error, {:authoring_task_invalid, {:expected_base_versions_invalid, :revision}}} =
             AuthoringTaskBuilder.for_chapter_revision(
               attrs(%{expected_base_versions: [%{ref: "draft:d1", version: 0}]})
             )

    assert {:error, {:authoring_task_invalid, {:expected_base_versions_invalid, :revision}}} =
             AuthoringTaskBuilder.for_chapter_revision(
               attrs(%{expected_base_versions: [%{"ref" => "", "version" => 2}]})
             )
  end

  test "chapter revision task round-trips to_input/from_input and passes semantics" do
    {:ok, task} = AuthoringTaskBuilder.for_chapter_revision(attrs())

    input = AuthoringTaskBuilder.to_input(task)
    assert {:ok, restored} = AuthoringTaskBuilder.from_input(input)
    assert restored.scope.modification_scope == :format_only
    assert restored.scope.target_chapter_ref == "chapter:ch01"

    assert restored.scope.expected_base_versions == [
             %{ref: "draft:d1", version: 2},
             %{ref: "draft:d2", version: 1}
           ]
  end
end
