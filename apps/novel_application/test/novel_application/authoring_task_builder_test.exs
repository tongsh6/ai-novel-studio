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
