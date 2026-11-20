defmodule NovelCommon.RequestIR.OperationTest do
  use ExUnit.Case, async: true

  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Operation

  @author "  请先给计划，保留我的原话。\r\nΩ é 雪。\n"
  @run %{run_id: "run-operation", work_id: "work-operation", goal: %{text: "先计划后创作", version: 1}}

  test "首操作用完整规则建立 Base，作者原话独立且字节不变，动态范围单独追加" do
    spec =
      specification("planner", "完整计划规则", %{operation: %{material: "本轮范围"}}, "agent_plan_draft")

    material = %{ref: "chapter:one", version: 3}
    author_source = %{ref: "turn:current-receipt"}

    spec =
      Map.merge(spec, %{
        author_text: @author,
        source_input_ref: author_source.ref,
        source_refs: [author_source, material],
        base_refs: [material]
      })

    run = Map.put(@run, :parent_turn_ref, "turn:initial-receipt")
    assert {:ok, ir} = Operation.prepare(nil, run, spec)
    assert :ok = RequestIR.validate(ir)

    assert [
             %{role: "application_base", blocks: [base]},
             %{role: "user", provenance: "author", blocks: [author]},
             scope
           ] = ir.messages

    # 2026-11-06 裁决 A：完整角色规则进入 canonical system 前缀；application_base 只声明
    # 应用数据职责与来源边界。
    assert base.text == RequestIR.application_base_text()
    assert ir.system.instructions == "完整计划规则"
    assert author.text == @author

    assert Enum.find(ir.messages, &(&1.role == "user")).source_refs == [
             %{ref: "turn:current-receipt"}
           ]

    assert scope.role == "scope_update"
    assert scope.source_refs == [author_source, material]
    assert hd(ir.messages).source_refs == [material]
    assert hd(ir.messages).base_refs == []
    assert scope.base_refs == [material]
    assert RequestIR.usable_base_refs(ir) == [material]
    assert ir.refs.base_refs == [material]
    assert ir.refs.observation_refs == []

    assert :ok = RequestIR.validate(%{ir | refs: %{ir.refs | used_refs: [material.ref]}})

    assert {:error, {:used_refs_out_of_scope, ["turn:current-receipt"]}} =
             RequestIR.validate(%{ir | refs: %{ir.refs | used_refs: [author_source.ref]}})

    assert {:ok, source_only} = Operation.prepare(nil, run, Map.delete(spec, :base_refs))
    assert source_only.refs.base_refs == []
    assert List.last(source_only.messages).base_refs == []
    assert RequestIR.usable_base_refs(source_only) == []
    assert hd(source_only.messages).source_refs == []
    assert List.last(source_only.messages).source_refs == spec.source_refs

    assert scope.blocks == [
             RequestIR.scope_block(%{work_id: @run.work_id, operation: %{material: "本轮范围"}})
           ]

    assert scope.versions == %{"scope_revision" => 1, "change_reason" => "planner"}
    assert ir.run == RequestIR.run_envelope(run)

    assert {:error, :invalid_author_input} =
             Operation.prepare(nil, run, Map.delete(spec, :source_input_ref))
  end

  test "续操作补齐新角色完整规则，保留原历史和观察，只合并新增来源与工具" do
    first =
      specification("planner", "计划规则", %{operation: %{material: "计划范围"}}, "agent_plan_draft")

    first =
      Map.merge(first, %{
        author_text: @author,
        source_input_ref: "turn:first-author",
        source_refs: [%{ref: "turn:first-author"}, %{ref: "base:one", version: 1}],
        base_refs: [%{ref: "base:one", version: 1}]
      })

    assert {:ok, previous} = Operation.prepare(nil, @run, first)

    previous = %{
      previous
      | refs:
          Map.merge(previous.refs, %{
            observation_refs: [%{ref: "observed:one", version: 2}],
            used_refs: []
          })
    }

    next =
      specification(
        "writer",
        "完整创作规则",
        %{operation: %{material: "  当前材料\n"}},
        "submit_tentative_artifact"
      )

    next =
      Map.merge(next, %{
        author_text: "这是操作目标，不能冒充新增作者消息",
        source_input_ref: "turn:must-not-replace-history",
        source_refs: [
          %{ref: "base:one", version: 1},
          %{ref: "source:two", version: 2},
          %{ref: "turn:must-not-replace-history"}
        ],
        base_refs: [%{ref: "source:two", version: 2}],
        versions: %{"goal" => 2, "scope_revision" => 99, "change_reason" => "不能覆盖实际角色"}
      })

    assert {:ok, ir} = Operation.prepare(previous, nil, next)
    assert Enum.take(ir.messages, length(previous.messages)) == previous.messages

    assert Enum.at(ir.messages, -2) ==
             RequestIR.message(:application_notice, :application, [RequestIR.text_block("完整创作规则")])

    assert List.last(ir.messages).blocks == [
             RequestIR.scope_block(%{work_id: @run.work_id, operation: %{material: "  当前材料\n"}})
           ]

    assert ir.system == previous.system

    assert List.last(ir.messages).versions == %{
             "goal" => 2,
             "scope_revision" => 2,
             "change_reason" => "writer"
           }

    assert Enum.count(ir.messages, &(&1.role == "user")) == 1
    assert ir.refs.base_refs == [%{ref: "base:one", version: 1}, %{ref: "source:two", version: 2}]
    assert ir.refs.observation_refs == previous.refs.observation_refs
    assert List.last(ir.messages).source_refs == next.source_refs
    assert List.last(ir.messages).base_refs == next.base_refs
    assert RequestIR.usable_base_refs(ir) == ir.refs.base_refs
    assert Enum.map(ir.tools, & &1.name) == ["agent_plan_draft", "submit_tentative_artifact"]
  end

  test "没有 run envelope 的首操作拒绝，不从目标或作者文字猜身份" do
    for run <- [nil, %{}] do
      assert {:error, :missing_run_envelope} = Operation.prepare(nil, run, specification())
    end
  end

  test "不能将其它 run 的历史装到当前 run；同一 run 的目标修订可更新 envelope" do
    assert {:ok, previous} = Operation.prepare(nil, @run, specification())

    assert {:error, :authoring_run_mismatch} =
             Operation.prepare(previous, %{@run | run_id: "other-run"}, specification())

    updated = %{@run | goal: %{text: "目标修订", version: 2}}
    assert {:ok, ir} = Operation.prepare(previous, updated, specification())
    assert ir.run == RequestIR.run_envelope(updated)
    assert Enum.take(ir.messages, length(previous.messages)) == previous.messages
  end

  test "投影模式可显式提供并在续阶段保留，没有作者时不伪造 user" do
    projection = %{
      tool_choice: "auto",
      finite_mode: %{name: "no_streaming"}
    }

    first = Map.put(specification(), :projection, projection)
    assert {:ok, previous} = Operation.prepare(nil, @run, first)
    assert {:ok, ir} = Operation.prepare(previous, nil, specification())
    assert ir.projection == projection
    refute Enum.any?(ir.messages, &(&1.role == "user"))
  end

  test "未完成的工具交换不能被新的阶段规则越过" do
    assert {:ok, previous} = Operation.prepare(nil, @run, specification())

    {pending, _} =
      RequestIR.append_assistant_result(previous, %{
        content: "正在提出计划",
        tool_calls: [%{id: "pending", name: "agent_plan_draft", arguments: %{}}]
      })

    assert {:error, :interrupted_tool_exchange} = Operation.prepare(pending, nil, specification())
  end

  test "standalone 操作没有作品事实时不伪造 work_id" do
    run = %{run_id: "standalone-review"}

    spec =
      Map.merge(specification(), %{author_text: @author, source_input_ref: "input:standalone"})

    assert {:ok, ir} = Operation.prepare(nil, run, spec)

    assert :ok = RequestIR.validate(ir)

    assert Enum.find(ir.messages, &(&1.role == "user")).source_refs == [
             %{ref: "input:standalone"}
           ]

    refute Map.has_key?(ir.run, :work_id)
    refute Map.has_key?(hd(List.last(ir.messages).blocks).content, "work_id")
  end

  test "显式错绑作品不能被操作构造器覆盖；旧文本生产 API 拒绝" do
    wrong_work = Map.put(specification().scope, :work_id, "work-other")

    assert {:error, :scope_work_mismatch} =
             Operation.prepare(nil, @run, %{specification() | scope: wrong_work})

    assert {:error, :invalid_authoring_operation} =
             Operation.prepare(nil, @run, %{specification() | scope: "旧的拼串 Scope"})

    source_only_fact =
      Map.merge(specification(), %{
        scope: %{facts: %{chapters: [%{ref: "chapter:one", title: "实际读取的章"}]}},
        source_refs: [%{ref: "chapter:one"}]
      })

    assert {:error, :scope_source_not_supplied} =
             Operation.prepare(nil, @run, source_only_fact)

    assert {:ok, _} =
             Operation.prepare(
               nil,
               @run,
               Map.put(source_only_fact, :base_refs, [%{ref: "chapter:one"}])
             )

    for base_refs <- [nil, %{}, "chapter:one"] do
      assert {:error, :invalid_authoring_operation} =
               Operation.prepare(nil, @run, Map.put(specification(), :base_refs, base_refs))
    end
  end

  test "首操作及续操作都拒绝不完整的作者配对，父回合和已有历史不能补原文或来源" do
    run = Map.put(@run, :parent_turn_ref, "turn:old-parent")
    valid = Map.merge(specification(), %{author_text: @author, source_input_ref: "input:current"})
    assert {:ok, previous} = Operation.prepare(nil, run, valid)

    invalid_pairs = [
      {@author, nil},
      {nil, "input:current"},
      {"", "input:current"},
      {" \r\n ", "input:current"},
      {@author, ""},
      {@author, " \r\n "},
      {123, "input:current"},
      {@author, 123},
      {[], "input:current"},
      {@author, %{}}
    ]

    for {text, ref} <- invalid_pairs, history <- [nil, previous] do
      spec =
        Map.merge(specification(), %{
          author_text: text,
          source_input_ref: ref,
          source_refs: [%{ref: "input:current"}]
        })

      assert {:error, :invalid_author_input} = Operation.prepare(history, run, spec)
    end
  end

  defp specification(
         role \\ "planner",
         instructions \\ "计划规则",
         scope \\ %{operation: %{material: "计划范围"}},
         tool \\ "agent_plan_draft"
       ) do
    %{
      role: role,
      instructions: instructions,
      scope: scope,
      tool: %{name: tool, input_schema: %{type: "object"}},
      source_refs: [],
      versions: %{}
    }
  end
end
