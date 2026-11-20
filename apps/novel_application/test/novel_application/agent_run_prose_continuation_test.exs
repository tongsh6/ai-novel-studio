defmodule NovelApplication.AgentRunProseContinuationTest do
  use NovelPersistence.DataCase, async: false

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.JudgmentProtocol
  alias NovelApplication.JudgmentToolContract
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.RequestIR
  alias NovelTest.TestProviderPrompt

  @work "work-agent-prose-flow"

  test "续行替身消费当前回复与真实失败事实，分别提问、重试和报告缺口" do
    for {goal, tool, phrase} <- [
          {"写下一章正文", "ask_author", "还没有可采纳的正文草稿"},
          {"  先按原目标重试一次。  ", "continuation_decision", "保持原范围再执行一次"},
          {"写下一章正文，然后同步到发布平台", "report_capability_gap", "没有同步到发布平台的能力"}
        ] do
      # 生产请求入口已统一为 canonical IR；续行请求保留真实续行工具目录与 tool_choice。
      prompt =
        JudgmentProtocol.request_for_production(
          %{
            author_text: goal,
            source_input_ref: "continuation-author",
            deviation_summary: "工具 prose_writing 执行失败",
            options: [
              plan_run: %{
                run_id: "run-continuation-fixture",
                goal: %{text: goal, source_ref: "continuation-author", version: 1}
              }
            ]
          },
          :continuation
        )

      {:ok, result} = SliceVerify.complete(nil, nil, prompt, %{})
      assert [%{name: ^tool, arguments: arguments}] = result.tool_calls

      assert result.content == ""

      if tool == "ask_author" do
        assert arguments.question =~ phrase
      else
        assert arguments.author_reasoning =~ phrase
      end

      assert :ok = JudgmentToolContract.validate(result.tool_calls, :continuation)
    end
  end

  test "作者已采纳旗标在迭代边界机械收束（0 调用，不再进判断②/改进步）（M0）" do
    {:ok, plan} =
      NovelDomain.AgentPlan.new(%{
        plan_id: "ap_author_settle",
        run_ref: "run_author_settle",
        steps: [
          %{
            step_id: "s1",
            kind: :explore,
            status: :completed,
            description: "读取正文写作上下文",
            target_tool_ref: "context_assemble"
          },
          %{
            step_id: "s2",
            kind: :act,
            status: :completed,
            description: "生成正文草稿并触发质量复核",
            target_tool_ref: "prose_writing",
            write_intent: :tentative,
            authoring_intent: :continuation,
            target_chapter: "第01章：开端"
          }
        ]
      })

    {:ok, run} =
      NovelDomain.AgentRun.new(%{
        run_id: "run_author_settle",
        workspace_id: "ws-author-settle",
        work_id: "work-author-settle",
        session_id: "session-author-settle",
        parent_turn_ref: "turn-author-settle",
        origin_frame_ref: "frame-author-settle",
        profile_ref: "prose_drafting_with_quality_v1",
        goal: %{text: "接着第01章往下写一段正文", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]},
        plan: plan
      })

    flunk_provider = %Execution{
      result_fn: fn _prompt -> flunk("settled run must not call any provider") end
    }

    spec =
      NovelApplication.DialoguePlanningService.run_spec_for_profile(
        :prose_drafting_with_quality,
        %{
          text: "接着第01章往下写一段正文",
          workspace_id: "ws-author-settle",
          work_id: "work-author-settle",
          session_id: "session-author-settle",
          turn_id: "turn-author-settle"
        },
        nil,
        flunk_provider
      )

    snapshot = %{
      stage_state: %{
        agent_plan_cursor: 2,
        author_adopted_refs: ["as_settled"]
      },
      observations: [],
      events: [],
      stage_sink: fn _event -> :ok end
    }

    # 计划已走完 + 旗标在：原本会进判断②（1 次调用）；收束语义下 0 调用直接完成。
    assert {:complete, decision, meta} = spec.next_step_planner.(run, 3, snapshot)
    assert decision.decision_type == :goal_satisfied
    assert "author_adopted_candidate" in decision.reason_codes
    assert meta.provider_call_count == 0
  end

  test "continuation keeps supplied facts separate from linked plan and observation evidence" do
    parent = self()
    author_text = "继续完成当前章正文。"

    execution = %Execution{
      result_fn: fn request ->
        assert Enum.any?(
                 RequestIR.Tools.tool_specs(request),
                 &(&1.name == "continuation_decision")
               )

        send(parent, {:continuation_lineage_request, request})
        text = "我先停下来，需要作者确认后继续。"

        calls =
          TestAgenticLoopFixtures.native_tool_calls("ask_author", %{
            "question" => text,
            "options" => []
          })

        {:ok,
         %{
           content: "",
           tool_calls: calls,
           provider_output: %ProviderOutput{
             provider_run_ref:
               TestAgenticLoopFixtures.unique_provider_call_id("prun-continuation"),
             provider_call_ref:
               TestAgenticLoopFixtures.unique_provider_call_id("pcall-continuation"),
             status: :ok,
             content: %{text: "", tool_calls: calls}
           }
         }}
      end
    }

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :prose_drafting_with_quality,
        %{
          text: author_text,
          workspace_id: "workspace-continuation-lineage",
          work_id: @work,
          session_id: "session-continuation-lineage",
          turn_id: "turn-continuation-lineage"
        },
        TestAgenticLoopFixtures.prose_drafting_context(@work),
        execution
      )

    {:ok, plan} =
      NovelDomain.AgentPlan.new(%{
        plan_id: "plan-continuation-lineage",
        run_ref: spec.run_id,
        steps: [
          %{
            step_id: "context-completed",
            kind: :explore,
            status: :completed,
            description: "读取正文写作上下文",
            target_tool_ref: "context_assemble"
          }
        ]
      })

    {:ok, run} =
      spec.run_attrs
      |> Map.merge(%{plan: plan, plan_ref: plan.plan_id, plan_version: 1})
      |> NovelDomain.AgentRun.new()

    previous =
      AuthoringTranscript.new(run,
        base_text: "已实际提供的作品背景。",
        base_refs: [%{ref: "work:supplied-base", version: 3}],
        author_text: author_text,
        author_turn_ref: "turn-continuation-lineage",
        tools: NovelApplication.JudgmentToolContract.tools(:judgment)
      )
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block(
          "judgment_decision",
          %{
            "action" => "explore",
            "dialogue_goal" => author_text,
            "author_reasoning" => "读取第一章正文，核对已写内容。",
            "explore_request" => %{"tool" => "chapter_read", "query" => "第01章"}
          },
          "call-actually-read"
        )
      ])
      |> AuthoringTranscript.append_observation("call-actually-read", %{
        status: "ok",
        source_refs: [%{ref: "chapter:actually-read", version: 2}],
        content: %{text: "正文中已读到的真实事实。"}
      })

    assert {:ok, previous_ir} = AuthoringTranscript.to_request_ir(previous)

    observations =
      Enum.map(1..8, fn index ->
        {:ok, observation} =
          NovelDomain.AgentObservation.new(%{
            observation_id: "obs-linked-#{index}",
            run_ref: run.run_id,
            step_ref: "step-linked-#{index}",
            observation_type: :custom,
            source_ref: "source:linked-#{index}",
            summary: "观察摘要 #{index}",
            evidence_refs: ["evidence:unread-#{index}"]
          })

        observation
      end)

    snapshot = %{
      stage_state: %{agent_plan_cursor: 1, judgment_transcript: previous},
      observations: observations,
      events: [],
      stage_sink: fn _event -> :ok end
    }

    assert {:await_author, decision, meta} = spec.next_step_planner.(run, 2, snapshot)
    assert "judgment_continuation" in decision.reason_codes
    assert meta.provider_call_count == 1
    assert_receive {:continuation_lineage_request, request}
    refute_receive {:continuation_lineage_request, _}, 10

    assert request.refs.base_refs == previous_ir.refs.base_refs
    assert request.refs.observation_refs == previous_ir.refs.observation_refs
    assert Enum.take(request.messages, length(previous_ir.messages)) == previous_ir.messages

    scope = TestProviderPrompt.scope_content(request)

    assert scope["context"]["observation_summary"] ==
             Enum.map_join(3..8, "\n", &"观察摘要 #{&1}")

    scope_message = request.messages |> Enum.filter(&(&1.role == "scope_update")) |> List.last()
    scope_refs = Enum.map(scope_message.source_refs, & &1.ref)
    base_refs = Enum.map(request.refs.base_refs, & &1.ref)
    observed_refs = Enum.map(request.refs.observation_refs, & &1.ref)

    linked_refs =
      [run.plan_ref | Enum.flat_map(observations, &[&1.observation_id | &1.evidence_refs])]

    for ref <- linked_refs do
      assert ref in scope_refs
      refute ref in base_refs
      refute ref in observed_refs
    end

    transcript = meta.stage_state.judgment_transcript

    assert {:ok, _} =
             transcript
             |> AuthoringTranscript.declare_used_refs([
               "work:supplied-base",
               "chapter:actually-read"
             ])
             |> AuthoringTranscript.to_request_ir()

    assert {:error, {:used_refs_out_of_scope, ["plan-continuation-lineage", "evidence:unread-1"]}} =
             transcript
             |> AuthoringTranscript.declare_used_refs([run.plan_ref, "evidence:unread-1"])
             |> AuthoringTranscript.to_request_ir()
  end
end
