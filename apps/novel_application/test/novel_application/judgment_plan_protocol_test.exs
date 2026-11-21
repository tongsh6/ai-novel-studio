defmodule NovelApplication.JudgmentPlanProtocolTest do
  @moduledoc """
  判断入口的单计划接收协议：作者正文、闭合回执与当前 Scope 读取资格。
  只观察真实请求与响应；计划被接收不等于获准执行或采纳。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution

  alias NovelApplication.{
    AgentNarrativeSource,
    AuthoringTranscript,
    JudgmentProtocol,
    JudgmentToolContract
  }

  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.RequestIR
  alias NovelDomain.AgentRun

  defp response(text, calls, ref \\ "call-1") do
    %{
      content: text,
      tool_calls: calls,
      provider_output: %ProviderOutput{
        provider_run_ref: "run-#{ref}",
        provider_call_ref: ref,
        status: :ok,
        content: %{text: text, tool_calls: calls}
      }
    }
  end

  defp call(name, args), do: %{id: "tool-#{name}", name: name, arguments: args}

  defp input(opts \\ []) do
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-judgment-fixture",
        work_id: "work-judgment-fixture",
        workspace_id: "workspace-judgment-fixture",
        session_id: "session-judgment-fixture",
        parent_turn_ref: "author-turn",
        origin_frame_ref: "frame-judgment-fixture",
        profile_ref: "judgment_plan_v1",
        goal: %{text: "根据本章实际内容判断", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    %{
      author_text: "根据本章实际内容判断",
      scope: %{
        work_id: run.work_id,
        facts: %{
          work: %{ref: "work:#{run.work_id}", work_id: run.work_id, title: "协议测试作品"}
        },
        context: %{},
        coverage: %{}
      },
      source_input_ref: "author-turn",
      supplied_context_refs: ["work:#{run.work_id}"],
      options: Keyword.put_new(opts, :plan_run, run)
    }
  end

  defp plan_args do
    %{
      "plan" => %{
        "steps" => [
          %{
            "step_id" => "s1",
            "kind" => "act",
            "description" => "写正文",
            "success_criteria" => ["done"],
            "target_tool_ref" => "prose_writing",
            "authoring_intent" => nil
          }
        ]
      },
      "author_reasoning" => "先取证再写",
      "reason_codes" => ["planned"],
      "confidence" => 0.9
    }
  end

  defp plan_decision_call do
    call("judgment_decision", %{
      "action" => "plan",
      "dialogue_goal" => "分步执行",
      "author_reasoning" => "需要计划"
    })
  end

  defp plan_pair do
    [call("agent_plan_draft", plan_args()), plan_decision_call()]
  end

  defp execution(results) do
    parent = self()
    ref = make_ref()
    Process.put(ref, results)

    %Execution{
      result_fn: fn prompt ->
        send(parent, {:provider_request, prompt})
        [result | rest] = Process.get(ref)
        Process.put(ref, if(rest == [], do: [result], else: rest))

        case result do
          {:error, _} = error -> error
          _ -> {:ok, result}
        end
      end
    }
  end

  defp blocks(%{messages: messages}, type) do
    for message <- messages,
        block <- message.blocks,
        Map.get(block, :type) == type,
        do: block
  end

  defp validation_blocks(transcript), do: blocks(transcript, "validation_result")

  test "单个完整计划通过校验即闭合，但不授予执行或采纳权限" do
    result = response("", [call("agent_plan_draft", plan_args())])

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([result]), %{}, input())

    assert judgment.action == "plan"
    assert judgment.provider_call_count == 1
    assert judgment.narrative == "先取证再写"
    assert judgment.narrative_source.tool_call_narrative_field == "author_reasoning"

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(judgment.transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)
    assert {:ok, _prompt} = RequestIR.prepare_request(ir)
    assert JudgmentProtocol.complete_validation(judgment.transcript) == judgment.transcript

    assert [receipt] = validation_blocks(judgment.transcript)
    assert receipt.call_id == "tool-agent_plan_draft"
    assert receipt.reason_code == "agent_plan_validated"
    assert receipt.status == "passed"
    assert receipt.detail["execution_authorized"] == false
    assert receipt.detail["canon_written"] == false

    assert :ok =
             AgentNarrativeSource.verify(judgment.narrative, judgment.narrative_source, %{
               "run-call-1" => result.provider_output
             })
  end

  for {label, tools, total, open?, targets, reason_code} <- [
        {"探索已关闭", [], 2, false, ["chapter_read"], "exploration_not_available"},
        {"超过剩余读取额度", ["chapter_read", "archive_read"], 1, true, ["chapter_read", "archive_read"],
         "exploration_budget_exceeded"},
        {"请求未开放工具", ["archive_read"], 0, true, ["chapter_read"], "exploration_not_available"}
      ] do
    test "单个只读计划不能绕过当前 Scope：#{label}" do
      targets = unquote(Macro.escape(targets))

      steps =
        targets
        |> Enum.with_index(1)
        |> Enum.map(fn {target, index} ->
          %{
            "step_id" => "read-#{index}",
            "kind" => "explore",
            "description" => "核对已有作品材料。",
            "success_criteria" => ["source_checked"],
            "target_tool_ref" => target,
            "exploration_query" => if(target == "chapter_read", do: "第一章", else: "profile")
          }
        end)

      args = put_in(plan_args(), ["plan", "steps"], steps)
      bad = response("", [call("agent_plan_draft", args)], "read-plan")
      good = response("现有材料不足以核实整章；本轮先说明已知范围与尚未核实之处。", [], "bounded-reply")

      options = [
        explore: unquote(open?),
        explore_tools: unquote(Macro.escape(tools)),
        exploration_budget: %{
          total: unquote(total),
          open?: unquote(open?),
          normal_open?: unquote(open?),
          continuation_open?: false,
          continuation_only?: false,
          continuation: nil
        }
      ]

      assert :ok = JudgmentToolContract.validate(bad.tool_calls, :judgment)

      assert {:ok, judgment} =
               JudgmentProtocol.request_judgment(execution([bad, good]), %{}, input(options))

      assert judgment.action == "reply"
      assert judgment.provider_call_count == 2
      assert judgment.narrative == good.content

      assert [%{status: "failed", reason_code: reason_code}] =
               validation_blocks(judgment.transcript)

      assert reason_code == unquote(reason_code)
      assert {:ok, ir} = AuthoringTranscript.to_request_ir(judgment.transcript)
      assert {:ok, []} = RequestIR.pending_call_ids(ir)
    end
  end

  test "只读计划不能预支未来观察的续页，纠正后只接受当前真实下一页" do
    chapter_ref = "chapter:00000000-0000-0000-0000-000000000042"
    base_step = hd(plan_args()["plan"]["steps"])

    steps =
      for offset <- [6000, 12_000] do
        Map.merge(base_step, %{
          "step_id" => "page-#{offset}",
          "kind" => "explore",
          "description" => "继续核对章节正文。",
          "target_tool_ref" => "chapter_read",
          "exploration_query" => Jason.encode!(%{chapter_ref: chapter_ref, offset: offset})
        })
      end

    bad_args = put_in(plan_args(), ["plan", "steps"], steps)
    good_args = put_in(bad_args, ["plan", "steps"], [hd(steps)])

    options = [
      explore: true,
      explore_tools: ["chapter_read"],
      exploration_budget: %{
        total: 2,
        open?: true,
        normal_open?: false,
        continuation_open?: true,
        continuation_only?: true,
        continuation: %{tool: "chapter_read", chapter_ref: chapter_ref, next_offset: 6000}
      }
    ]

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [call("agent_plan_draft", bad_args)], "future-page"),
                 response("", [call("agent_plan_draft", good_args)], "observed-page")
               ]),
               %{},
               input(options)
             )

    assert judgment.provider_call_count == 2
    assert [accepted] = judgment.plan_result.plan.steps
    assert accepted.exploration_query == hd(steps)["exploration_query"]

    assert [
             %{status: "failed", reason_code: "exploration_continuation_mismatch"},
             %{status: "passed", reason_code: "agent_plan_validated"}
           ] = validation_blocks(judgment.transcript)

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(judgment.transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)
  end

  test "已准备的上下文和阵容不占用只读计划的实际读取额度" do
    steps =
      for target <- ["context_assemble", "character_roster", "chapter_read", "archive_read"] do
        Map.merge(hd(plan_args()["plan"]["steps"]), %{
          "step_id" => target,
          "kind" => "explore",
          "description" => "按已有材料核对当前范围。",
          "target_tool_ref" => target,
          "exploration_query" => if(target == "chapter_read", do: "第一章", else: "profile")
        })
      end

    args = put_in(plan_args(), ["plan", "steps"], steps)

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               execution([response("", [call("agent_plan_draft", args)])]),
               %{},
               input(
                 explore: true,
                 explore_tools: ["chapter_read", "archive_read"],
                 exploration_budget: %{total: 0, open?: true, continuation_only?: false}
               )
             )

    assert judgment.action == "plan"
    assert judgment.provider_call_count == 1
    assert length(judgment.plan_result.plan.steps) == 4

    assert [%{status: "passed", reason_code: "agent_plan_validated"}] =
             validation_blocks(judgment.transcript)
  end

  test "关闭探索后反复提交同一只读计划必须有界拒绝" do
    step =
      Map.merge(hd(plan_args()["plan"]["steps"]), %{
        "kind" => "explore",
        "target_tool_ref" => "chapter_read",
        "exploration_query" => "第一章"
      })

    args = put_in(plan_args(), ["plan", "steps"], [step])
    result = response("", [call("agent_plan_draft", args)])

    assert {:error, {:judgment_protocol_violation, :exploration_not_available}, meta} =
             JudgmentProtocol.request_judgment(
               execution([result]),
               %{},
               input(
                 explore: false,
                 explore_tools: [],
                 exploration_budget: %{total: 2, open?: false, continuation_only?: false}
               )
             )

    assert meta.provider_call_count == 2
    receipts = validation_blocks(meta.judgment_transcript)
    assert length(receipts) == 2
    assert Enum.map(receipts, & &1.retryable) == [true, false]

    assert Enum.all?(
             receipts,
             &(&1.status == "failed" and &1.reason_code == "exploration_not_available")
           )

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(meta.judgment_transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)

    for _ <- 1..2, do: assert_receive({:provider_request, _})
    refute_receive {:provider_request, _}, 20
  end

  test "判断计划契约只暴露一个完整计划工具，不再要求判断枚举或额外目标字段" do
    prompt = JudgmentProtocol.request_for_production(input())
    content = first_text(prompt)
    guidance = JudgmentToolContract.legal_combination_guidance()

    assert String.split(content, guidance) |> length() == 2
    refute content =~ "judgment_decision.plan"

    plan_tool = Enum.find(prompt.tools, &(&1.name == "agent_plan_draft"))
    assert plan_tool.input_schema == NovelApplication.AgentPlanToolContract.schema()
    refute Map.has_key?(plan_tool.input_schema.properties, :dialogue_goal)
    refute Map.has_key?(plan_tool.input_schema.properties, "dialogue_goal")
    assert JudgmentProtocol.actions() == ["execute", "explore"]
  end

  test "多个合法工具调用也必须纠错，单个计划可在同一请求历史修复" do
    first_call = call("agent_plan_draft", plan_args())
    second_call = %{first_call | id: "tool-second-plan"}
    bad = response("", [first_call, second_call])
    good = response("", [first_call], "corrected-plan")

    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(execution([bad, good]), %{}, input())

    assert judgment.action == "plan"
    assert judgment.provider_call_count == 2

    assert_receive {:provider_request, first}
    assert_receive {:provider_request, second}
    refute_receive {:provider_request, _}, 10

    assert message_text(hd(second.messages)) == message_text(hd(first.messages))
    assert second.tools == first.tools

    failed = validation_blocks(second)
    assert Enum.map(failed, & &1.call_id) == [first_call.id, second_call.id]

    assert Enum.all?(
             failed,
             &(&1.status == "failed" and &1.reason_code == "invalid_tool_combination")
           )

    correction = validation_text(List.last(second.messages))
    assert correction =~ JudgmentToolContract.legal_combination_guidance()
    assert correction =~ "保留同一作者输入、来源、目标、范围与权限"
  end

  test "计划的第二份正文重试后仍存在则拒绝，不选一份继续" do
    bad = response("先给计划。", [call("agent_plan_draft", plan_args())])
    still_bad = response("还是附带另一份说明。", [call("agent_plan_draft", plan_args())])

    assert {:error, {:judgment_protocol_violation, :author_narrative_content_conflict}, state} =
             JudgmentProtocol.request_judgment(execution([bad, still_bad]), %{}, input())

    assert state.provider_call_count == 2
    assert Enum.all?(validation_blocks(state.judgment_transcript), &(&1.status == "failed"))
    assert_receive {:provider_request, _}
    assert_receive {:provider_request, second}
    assert validation_text(List.last(second.messages)) =~ "content 必须为 null 或空字符串"
    refute_receive {:provider_request, _}, 10
  end

  test "单计划、普通回复和执行分别成立，旧计划枚举与双工具协议彻底拒绝" do
    assert {:ok, %{action: "plan", provider_call_count: 1}} =
             JudgmentProtocol.request_judgment(
               execution([response("", [call("agent_plan_draft", plan_args())])]),
               %{},
               input()
             )

    for calls <- [[plan_decision_call()], plan_pair()] do
      assert {:error, {:judgment_protocol_violation, :invalid_tool_arguments}, state} =
               JudgmentProtocol.request_judgment(execution([response("", calls)]), %{}, input())

      assert state.provider_call_count == 2
    end

    assert {:ok, %{action: "reply"}} =
             JudgmentProtocol.request_judgment(execution([response("普通答复", [])]), %{}, input())

    assert {:ok, %{action: "execute"}} =
             JudgmentProtocol.request_judgment(
               execution([
                 response("", [
                   call("judgment_decision", %{
                     "action" => "execute",
                     "capability" => "prose_writing",
                     "dialogue_goal" => "写章",
                     "author_reasoning" => "作者明确要求"
                   })
                 ])
               ]),
               %{},
               input(capabilities: ["prose_writing"])
             )
  end

  defp message_text(%{blocks: _blocks} = message),
    do: NovelApplication.TestAgenticLoopFixtures.message_text(message)

  # 判断规则在 canonical system instructions，应用数据在 native Scope：
  # 文本断言必须读与 provider 同源的完整投影视图，而不是只看第一条消息。
  defp first_text(ir), do: NovelTest.TestProviderPrompt.text(ir)

  # 协议纠错事实既可能是 tool 原生 validation_result，也可能是无 pending call 时的
  # application_notice 文本消息；两种形态都从实际请求消息读取，不合成内容。
  defp validation_text(message) do
    validation =
      for block <- Map.get(message, :blocks, []),
          Map.get(block, :type) == "validation_result",
          into: "",
          do: Jason.encode!(block)

    message_text(message) <> validation
  end
end
