defmodule NovelApplication.AuthoringOperationTest do
  use ExUnit.Case, async: true
  alias NovelCommon.RequestIR.Projection

  alias NovelApplication.AuthoringOperation
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR
  alias NovelDomain.AgentRun

  @run %{run_id: "run-operation", work_id: "work-operation", goal: %{text: "应用目标", version: 1}}
  @tool %{name: "plan", description: "提出计划", input_schema: %{type: "object"}}

  defp spec do
    %{
      role: "planning",
      instructions: "只提计划，执行仍需逐步授权。",
      scope: "检查本章尚缺的环节。",
      tool: @tool,
      source_refs: [%{ref: "chapter:one"}],
      versions: %{"chapter:one" => 3}
    }
  end

  defp budget_run(max_provider_calls, provider_calls) do
    %{
      run_id: "run-budget",
      budget: %{max_provider_calls: max_provider_calls},
      consumed_budget: %{provider_calls: provider_calls}
    }
  end

  defp max_provider_calls(options) when is_list(options),
    do: Keyword.fetch!(options, :max_provider_calls)

  defp max_provider_calls(options) when is_map(options),
    do: Map.fetch!(options, :max_provider_calls)

  test "已有会话切换角色仅追加 scope，后续请求保留作者与前序交换" do
    previous =
      AuthoringTranscript.new(@run,
        base_text: "作者主权",
        author_text: "  原始输入\n"
      )

    snapshot = %{stage_state: %{judgment_transcript: previous}}

    assert {:ok, ir} =
             AuthoringOperation.prepare(@run, snapshot, Map.put(spec(), :author_text, "应用改写目标"))

    assert Enum.take(ir.messages, length(previous.messages)) == previous.messages
    assert [%{blocks: [%{text: "  原始输入\n"}]}] = Enum.filter(ir.messages, &(&1.role == "user"))
    assert List.last(ir.messages).role == "scope_update"
    assert List.last(ir.messages).versions["change_reason"] == "planning"
    assert List.last(ir.messages).source_refs == [%{ref: "chapter:one"}]
    assert {:ok, _prepared} = RequestIR.prepare_request(ir, tool_names: ["plan"])
  end

  test "没有明确作者原话时只传应用目标，不伪造 user" do
    assert {:ok, ir} = AuthoringOperation.prepare(@run, %{}, spec())
    refute Enum.any?(ir.messages, &(&1.role == "user"))
    assert ir.run.goal["text"] == "应用目标"
    assert {:ok, _prepared} = RequestIR.prepare_request(ir, tool_names: ["plan"])
  end

  test "阶段 scope 携带当前权限与已消耗预算，不能复活旧许可" do
    run =
      Map.merge(@run, %{
        authority_scope: %{allowed_tools: [], production_write: false},
        budget: %{max_provider_calls: 2},
        consumed_budget: %{provider_calls: 2}
      })

    assert {:ok, ir} = AuthoringOperation.prepare(run, %{}, spec())
    [%{text: scope}] = List.last(ir.messages).blocks
    assert scope =~ ~s("allowed_tools":[])
    assert scope =~ ~s("production_write":false)
    assert scope =~ ~s("max_provider_calls":2)
    assert scope =~ ~s("provider_calls":2)
  end

  test "应用校验闭合后返回可恢复会话，未调用的错误保留零计数" do
    assert {:ok, ir} = AuthoringOperation.prepare(@run, %{}, spec())

    {ir, result} =
      RequestIR.append_assistant_result(ir, %{
        content: "提出计划。",
        tool_calls: [
          %{id: "call-plan", name: "plan", arguments: %{steps: []}}
        ]
      })

    session = %{request_ir: ir, provider_result: result, provider_call_count: 1}
    meta = AuthoringOperation.complete(session, "plan_validated", %{plan_ref: "plan:one"})
    assert meta.provider_call_count == 1
    assert {:ok, completed} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(completed)

    assert {:ok, restored} =
             meta.judgment_transcript
             |> AuthoringTranscript.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)

    assert Projection.project(restored_ir, "chat_completions") ==
             Projection.project(completed, "chat_completions")

    zero =
      AuthoringOperation.metadata(%{
        request_ir: completed,
        provider_result: nil,
        provider_call_count: 0
      })

    assert zero.provider_call_count == 0
    assert zero.judgment_transcript.messages == meta.judgment_transcript.messages
  end

  test "已存在但损坏的 IR 不被当作缺席，complete 与 metadata 固定拒绝" do
    assert {:ok, ir} = AuthoringOperation.prepare(@run, %{}, spec())
    invalid = %{ir | ir_version: "unsupported-authoring-request-ir/v0"}

    session = %{
      request_ir: invalid,
      provider_result: %{tool_calls: []},
      provider_call_count: 0
    }

    assert_raise ArgumentError, "authoring session request IR is invalid", fn ->
      AuthoringOperation.complete(session, "plan_validated", %{plan_ref: "plan:one"})
    end

    assert_raise ArgumentError, "authoring session request IR is invalid", fn ->
      AuthoringOperation.metadata(session)
    end
  end

  describe "tool_execution_options/1" do
    test "0/1/2 剩余 provider 预算逐项成为上限" do
      for {max_calls, used, expected} <- [{2, 2, 0}, {2, 1, 1}, {2, 0, 2}] do
        options = AuthoringOperation.tool_execution_options(budget_run(max_calls, used))
        assert max_provider_calls(options) == expected
      end
    end

    test "剩余超过 2 封顶 2，超预算落为 0" do
      assert max_provider_calls(AuthoringOperation.tool_execution_options(budget_run(5, 1))) == 2
      assert max_provider_calls(AuthoringOperation.tool_execution_options(budget_run(2, 5))) == 0
    end

    test "不可观察的预算按 0 保守处理，不回落到默认 2" do
      assert max_provider_calls(
               AuthoringOperation.tool_execution_options(%{run_id: "run-no-budget"})
             ) ==
               0

      assert max_provider_calls(
               AuthoringOperation.tool_execution_options(%{
                 run_id: "run-partial-budget",
                 budget: %{max_provider_calls: 2}
               })
             ) == 0

      assert max_provider_calls(
               AuthoringOperation.tool_execution_options(%{
                 run_id: "run-consumed-only",
                 consumed_budget: %{provider_calls: 1}
               })
             ) == 0
    end

    test "同时支持既有 atom 与 string budget keys" do
      atom_run = %{
        budget: %{max_provider_calls: 2},
        consumed_budget: %{provider_calls: 1}
      }

      string_run = %{
        budget: %{"max_provider_calls" => 2},
        consumed_budget: %{"provider_calls" => 1}
      }

      assert max_provider_calls(AuthoringOperation.tool_execution_options(atom_run)) == 1
      assert max_provider_calls(AuthoringOperation.tool_execution_options(string_run)) == 1
    end

    test "读取真实 AgentRun 不修改 run 或预算" do
      {:ok, run} =
        AgentRun.new(%{
          run_id: "run-budget-real",
          workspace_id: "workspace-budget",
          work_id: "work-budget",
          session_id: "session-budget",
          parent_turn_ref: "turn-budget",
          origin_frame_ref: "frame-budget",
          profile_ref: "profile-budget",
          goal: %{text: "预算测试", version: 1},
          authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]},
          budget: %{max_provider_calls: 2},
          consumed_budget: %{provider_calls: 1}
        })

      before = run
      options = AuthoringOperation.tool_execution_options(run)

      assert max_provider_calls(options) == 1
      assert run == before
      assert run.budget.max_provider_calls == 2
      assert run.consumed_budget.provider_calls == 1
    end
  end
end
