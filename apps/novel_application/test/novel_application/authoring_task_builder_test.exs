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
        AuthoringTaskBuilder.material(:target_structure, "chapter:one", complete?: true, version: 2)
      ],
      output_contract:
        AuthoringTaskBuilder.output_contract(:json, required_keys: ["items"], allow_companions: true)
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
