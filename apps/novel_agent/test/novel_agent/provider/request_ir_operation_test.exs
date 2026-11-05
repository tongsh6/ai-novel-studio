defmodule NovelAgent.Provider.RequestIR.OperationTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.RequestIR.Operation

  @author "  请先给计划，保留我的原话。\n"
  @run %{run_id: "run-operation", work_id: "work-operation", goal: %{text: "先计划后创作", version: 1}}

  test "首操作用完整规则建立 Base，作者原话独立且字节不变，动态范围单独追加" do
    spec = specification("planner", "完整计划规则", "本轮范围", "agent_plan_draft")
    spec = Map.put(spec, :author_text, @author)
    assert {:ok, ir} = Operation.prepare(nil, @run, spec)
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
    assert scope.role == "scope_update"
    assert scope.blocks == [RequestIR.text_block("本轮范围")]
    assert scope.versions == %{"scope_revision" => 1, "change_reason" => "planner"}
    assert ir.run == RequestIR.run_envelope(@run)
  end

  test "续操作补齐新角色完整规则，保留原历史和观察，只合并新增来源与工具" do
    first = specification("planner", "计划规则", "计划范围", "agent_plan_draft")

    first =
      Map.merge(first, %{author_text: @author, source_refs: [%{ref: "base:one", version: 1}]})

    assert {:ok, previous} = Operation.prepare(nil, @run, first)

    previous = %{
      previous
      | refs:
          Map.merge(previous.refs, %{
            observation_refs: [%{ref: "observed:one", version: 2}],
            used_refs: []
          })
    }

    next = specification("writer", "完整创作规则", "当前材料", "submit_tentative_artifact")

    next =
      Map.merge(next, %{
        author_text: "这是操作目标，不能冒充新增作者消息",
        source_refs: [%{ref: "base:one", version: 1}, %{ref: "source:two", version: 2}],
        versions: %{"goal" => 2, "scope_revision" => 99, "change_reason" => "不能覆盖实际角色"}
      })

    assert {:ok, ir} = Operation.prepare(previous, nil, next)
    assert Enum.take(ir.messages, length(previous.messages)) == previous.messages
    assert List.last(ir.messages).blocks == [RequestIR.text_block("完整创作规则\n\n当前材料")]

    assert List.last(ir.messages).versions == %{
             "goal" => 2,
             "scope_revision" => 2,
             "change_reason" => "writer"
           }

    assert Enum.count(ir.messages, &(&1.role == "user")) == 1
    assert ir.refs.base_refs == [%{ref: "base:one", version: 1}, %{ref: "source:two", version: 2}]
    assert ir.refs.observation_refs == previous.refs.observation_refs
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

  defp specification(
         role \\ "planner",
         instructions \\ "计划规则",
         scope \\ "计划范围",
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
