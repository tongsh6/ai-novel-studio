defmodule NovelApplication.AgentRunProseRevisionFlowTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelCommon.RequestIR
  alias NovelAgent.Provider.Projection
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelApplication.AgentRunFlows.ProseRevisionFromFindings
  alias NovelApplication.AgentRunService
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelApplication.TraceReplayService
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  alias Ecto.Adapters.SQL.Sandbox

  alias NovelPersistence.{
    AgentRunLog,
    InteractionLifecycle,
    MemoryLog,
    Repo,
    TraceRepository,
    WorkRepo,
    WorkSessionRepo
  }

  setup do
    owner = Sandbox.start_owner!(Repo, shared: true)

    on_exit(fn ->
      NovelApplication.TestAgentRunCleanup.await_quiescent()
      Sandbox.stop_owner(owner)
    end)

    :ok
  end

  @work "work-agent-prose-revision-flow"
  @bad_prose "他走进房间，看了看四周，坐了下来。他拿起书本，翻了翻几页，放了下来。他望向窗外，看了看天色，叹了口气。他端起茶杯，喝了一小口，搁了回去。"
  @revised_body "雨水顺着旧窗棂淌下，他攥紧那页残诀，呼吸忽然急促——这一次，他决定不再退。"

  test "bounded revision run exposes source, gate, tool execution, and finalization steps" do
    parent = self()
    source = run_prose_turn()
    revise = revise_action(source)

    action_input = %AuthorActionInput{
      input_id: "in-agent-revise",
      source_turn_ref: source.turn_id,
      action_id: revise.action_id,
      action_type: "revise_from_findings",
      target_ref: revise.target_ref,
      payload: %{"quality_finding_refs" => revise.quality_finding_refs},
      idempotency_key: revise.idempotency_key
    }

    provider = fn prompt ->
      cond do
        agent_plan_draft_prompt?(prompt) ->
          {:ok, revision_plan_draft()}

        agent_next_step_prompt?(prompt) ->
          {:ok,
           %{
             content: TestAgenticLoopFixtures.reasoning_tail(revision_next_step_decision(prompt))
           }}

        true ->
          send(parent, {:revision_prompt, prompt})

          {:ok,
           %{
             provider_call_id: "pc-agent-revision",
             content: "",
             tool_calls:
               TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
                 items: [
                   %{item_id: "agent-rev-item", title: "第01章（修订）", body: @revised_body}
                 ],
                 self_report: %{
                   assumptions: [],
                   intended_reader_effect: nil,
                   used_context_refs: [],
                   risk_flags: []
                 }
               })
           }}
      end
    end

    input = %{
      text: "按质量发现重写正文草稿",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-prose-revision-flow",
      turn_id: source.turn_id,
      source_turn_result: source,
      action_input: action_input,
      interaction_store: fn
        :result, attrs ->
          send(
            parent,
            {:recorded_revision_turn, attrs.workspace_id,
             [%{role: "assistant", content: %{turn_result: attrs.turn_result}}]}
          )

          {:ok, :recorded}

        _operation, _attrs ->
          {:ok, :recorded}
      end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_revision_from_findings,
        input,
        nil,
        %Execution{result_fn: provider}
      )

    assert planned.run_attrs.profile_ref == ProseRevisionFromFindings.profile_ref()
    assert is_function(planned.next_step_planner, 3)
    refute Map.has_key?(planned, :steps)

    planner = fn run, sequence, snapshot ->
      case planned.next_step_planner.(run, sequence, snapshot) do
        {:execute, step_fun, decision, meta} ->
          {:execute, capture_revision_step(step_fun, parent), decision, meta}

        {:execute, step_fun, decision} ->
          {:execute, capture_revision_step(step_fun, parent), decision}

        other ->
          other
      end
    end

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(planned.run_attrs, fn event ->
                 send(parent, {:agent_event, event.event_type, event})
               end),
               next_step_planner: planner,
               interaction_store: planned.interaction_store
             )

    assert_receive {:agent_event, :run_started, _}

    assert_receive {:agent_event, :goal_understood, context_event}, 500
    assert context_event.summary =~ "待修订草稿"
    assert_receive {:agent_event, :exploration_observed, source_observation}, 500
    assert source_observation.summary =~ "已读取待修订草稿"
    assert_receive {:agent_event, :evaluation_made, source_decision}, 500
    assert "agent_step_evaluated" in source_decision.reason_codes

    assert_receive {:agent_event, :evaluation_made, plan_event}, 500
    assert "agent_step_evaluated" in plan_event.reason_codes
    assert_receive {:agent_event, :gate_decided, gate_event}, 500
    assert gate_event.summary =~ "已通过修订工具执行授权"
    assert_receive {:agent_event, :exploration_observed, gate_observation}, 500
    assert gate_observation.summary =~ "重新经过 Orchestrator"

    assert_receive {:agent_event, :tool_started, tool_started}, 500
    assert tool_started.summary =~ "正文写作能力"
    assert_receive {:revision_prompt, revision_prompt}, 500
    revision_prompt = NovelApplication.TestAgenticLoopFixtures.prompt_text(revision_prompt)
    assert revision_prompt =~ "[质量修订要求]"
    assert revision_prompt =~ @bad_prose
    assert_receive {:agent_event, :tool_completed, tool_completed}, 500
    assert tool_completed.summary =~ "修订候选已生成"
    assert_receive {:agent_event, :exploration_observed, execute_observation}, 500
    assert execute_observation.summary =~ "不自动采纳"

    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:recorded_revision_turn, @work, [recorded_entry]}, 500
    assert recorded_entry.role == "assistant"

    assert recorded_entry.content.turn_result.turn_id ==
             artifact_event.payload.turn_result.turn_id

    assert_receive {:agent_event, :run_completed, _}

    # 执行步只返回本步 delta：新 canonical 与 revision_result 完整，但不得把执行开始时
    # 整份 snapshot.stage_state 再写回。prepare 步注入的无关注释状态只由 runtime 合并保留。
    assert_receive {:revision_step_result, 3, {:ok, execute_result}}, 1_000
    execute_delta = execute_result.stage_state
    assert execute_delta.judgment_transcript.run.run_id == run_id
    assert is_map(execute_delta.revision_result.turn_result)
    refute Map.has_key?(execute_delta, :unrelated_runtime_state)
    refute Map.has_key?(execute_delta, :revision_source_turn_result)
    refute Map.has_key?(execute_delta, :revision_action_input)
    refute Map.has_key?(execute_delta, :revision_prepared)
    refute Map.has_key?(execute_delta, :revision_execution)

    # CP3b 尾批：机械步序不发 plan_drafted（无计划 run 的轨道 = judgment 事件链）。
    refute_receive {:agent_event, :plan_drafted, _}, 10, 500

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert length(state.run.completed_step_refs) == 4
    assert state.run.consumed_budget.steps == 4
    assert state.run.consumed_budget.tool_calls == 1
    # CP3b 尾批：机械计划 0 调用，仅修订 writer 1 调用。
    assert state.run.consumed_budget.provider_calls == 1

    # runtime 负责合并：delta 未携带的旧状态仍在，canonical/revision_result 也在。
    assert state.stage_state.unrelated_runtime_state == "preserved"
    assert state.stage_state.agent_plan_cursor == 4
    assert snapshot_transcript(%{stage_state: state.stage_state}).run.run_id == run_id
    assert is_map(state.stage_state.revision_result)

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id
    assert turn_result.agent_run.profile_ref == "prose_revision_from_findings_v1"
    assert turn_result.trace_summary.decision_type == "revise_from_findings"
    assert turn_result.trace_summary.revision_provider_call_ref == "pc-agent-revision"
    assert turn_result.trace_summary.provider_call_budget.revision_writer == 2
    assert turn_result.trace_summary.execution_counts == %{provider_calls: 1, tool_calls: 1}
    refute Map.has_key?(turn_result, :quality_review)
    refute turn_result.truthfulness.artifact_adopted
    refute turn_result.truthfulness.production_write_performed

    assert [%{adoption_status: "TENTATIVE", artifact_type: :prose_fragment}] =
             turn_result.adoption_state.pending
  end

  test "protocol retry keeps both native responses in the new run canonical transcript" do
    parent = self()
    source = run_prose_turn() |> Map.put(:agent_run, %{run_id: "run-source-old"})
    revise = revise_action(source)

    action_input = %AuthorActionInput{
      input_id: "in-agent-revise-protocol-retry",
      source_turn_ref: source.turn_id,
      action_id: revise.action_id,
      action_type: "revise_from_findings",
      target_ref: revise.target_ref,
      payload: %{"quality_finding_refs" => revise.quality_finding_refs},
      idempotency_key: revise.idempotency_key
    }

    attempts = :counters.new(1, [])

    provider = fn prompt ->
      cond do
        agent_plan_draft_prompt?(prompt) ->
          {:ok, revision_plan_draft()}

        agent_next_step_prompt?(prompt) ->
          {:ok,
           %{
             content: TestAgenticLoopFixtures.reasoning_tail(revision_next_step_decision(prompt))
           }}

        true ->
          attempt = :counters.get(attempts, 1) + 1
          :counters.add(attempts, 1, 1)
          send(parent, {:revision_writer_attempt, attempt})

          result =
            case attempt do
              1 ->
                %{
                  provider_call_id: "pc-agent-revision-invalid",
                  content: "",
                  tool_calls:
                    TestAgenticLoopFixtures.native_tool_calls(
                      "submit_tentative_artifact",
                      %{}
                    )
                }

              _ ->
                %{
                  provider_call_id: "pc-agent-revision",
                  content: "",
                  tool_calls:
                    TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
                      items: [
                        %{item_id: "agent-rev-item", title: "第01章（修订）", body: @revised_body}
                      ],
                      self_report: %{
                        assumptions: [],
                        intended_reader_effect: nil,
                        used_context_refs: [],
                        risk_flags: []
                      }
                    })
                }
            end

          {:ok, result}
      end
    end

    input = %{
      text: "按质量发现重写正文草稿",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-prose-revision-protocol-retry",
      turn_id: source.turn_id,
      source_turn_result: source,
      action_input: action_input,
      interaction_store: fn _operation, _attrs -> {:ok, :recorded} end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_revision_from_findings,
        input,
        nil,
        %Execution{result_fn: provider}
      )

    planner = fn run, sequence, snapshot ->
      send(parent, {:revision_planner_snapshot, run.run_id, sequence, snapshot})
      planned.next_step_planner.(run, sequence, snapshot)
    end

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(planned.run_attrs, fn event ->
                 send(parent, {:agent_event, event.event_type, event})
               end),
               next_step_planner: planner,
               interaction_store: planned.interaction_store
             )

    assert_receive {:revision_writer_attempt, 1}, 1_000
    assert_receive {:revision_writer_attempt, 2}, 1_000
    refute_receive {:revision_writer_attempt, _}, 100

    assert_receive {:agent_event, :artifact_created, artifact_event}, 1_000
    assert_receive {:agent_event, :run_completed, _}, 1_000

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id

    # 对外 turn_result 只含作者安全业务结果，不泄漏 canonical/IR/Provider 私有结构。
    for key <- [:stage_state, :judgment_transcript, :request_ir, :provider_result, :execution] do
      refute Map.has_key?(turn_result, key)
      refute Map.has_key?(turn_result.trace_summary, key)
    end

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert length(state.run.completed_step_refs) == 4
    assert state.run.consumed_budget.steps == 4
    assert state.run.consumed_budget.provider_calls == 2
    assert state.run.consumed_budget.tool_calls == 1

    # 两次实际调用共享同一允许上限（2）；消耗来自 session，不能回填预算。
    assert turn_result.trace_summary.provider_call_budget.revision_writer == 2
    assert turn_result.trace_summary.execution_counts == %{provider_calls: 2, tool_calls: 1}

    transcript = snapshot_transcript(%{stage_state: state.stage_state})
    assert is_map(transcript)
    assert transcript.run.run_id == run_id
    refute transcript.run.run_id == source.agent_run.run_id

    app_goal = planned.run_attrs.goal.text
    assert is_binary(app_goal) and app_goal != ""
    refute app_goal in user_texts(transcript)
    assert Enum.any?(transcript.messages, &(&1.role == "application_base"))

    calls = tool_call_blocks(transcript)
    assert length(calls) == 2
    assert Enum.all?(calls, &(&1.name == "submit_tentative_artifact"))
    assert Enum.at(calls, 0).arguments == %{}
    assert is_list(Enum.at(calls, 1).arguments["items"])

    assert [first_validation, second_validation] = validation_blocks(transcript)
    assert first_validation.call_id == Enum.at(calls, 0).call_id
    assert first_validation.status == "failed"
    assert first_validation.reason_code == "invalid_items"
    assert second_validation.call_id == Enum.at(calls, 1).call_id
    assert second_validation.status == "passed"

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)

    # 最终 canonical state 必须可经 JSON 恢复，且恢复后的 Provider 投影与 fresh 严格同源。
    checkpoint =
      transcript
      |> AuthoringTranscript.checkpoint()
      |> Jason.encode!()
      |> Jason.decode!()

    assert {:ok, restored} = AuthoringTranscript.restore(checkpoint)
    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)

    assert Projection.project(restored_ir, "chat_completions") ==
             Projection.project(ir, "chat_completions")

    refute inspect(checkpoint) =~ source.agent_run.run_id

    finalize_snapshot =
      find_planner_snapshot(fn snapshot ->
        is_map(snapshot.stage_state[:revision_result]) and
          is_map(snapshot_transcript(snapshot))
      end)

    assert snapshot_transcript(finalize_snapshot).run.run_id == run_id
    assert snapshot_transcript(finalize_snapshot) == transcript

    [original] = source.adoption_state.pending
    assert original.payload.items |> hd() |> Map.get(:body) == @bad_prose

    [revision] = turn_result.adoption_state.pending
    assert revision.payload.items |> hd() |> Map.get(:body) == @revised_body
    refute turn_result.truthfulness.artifact_adopted
    refute turn_result.truthfulness.production_write_performed
  end

  defp capture_revision_step(step_fun, parent) do
    fn run, sequence, snapshot ->
      result = step_fun.(run, sequence, snapshot)
      send(parent, {:revision_step_result, sequence, result})
      inject_unrelated_runtime_state(result, sequence)
    end
  end

  # 只在 prepare 步注入一个与修订无关的 runtime 状态字段，验证 execute 步 delta 不携带它、
  # 但 runtime 合并后它仍被保留。
  defp inject_unrelated_runtime_state({:ok, result}, 1) when is_map(result) do
    {:ok, Map.update!(result, :stage_state, &Map.put(&1, :unrelated_runtime_state, "preserved"))}
  end

  defp inject_unrelated_runtime_state(result, _sequence), do: result

  defp revise_action(turn_result) do
    Enum.find(turn_result.available_actions, &(&1.action_type == "revise_from_findings"))
  end

  defp agent_next_step_prompt?(prompt),
    do: prompt_contains?(prompt, "AgentRun 下一步规划器")

  defp agent_plan_draft_prompt?(prompt),
    do:
      Enum.any?(
        NovelCommon.RequestIR.Tools.tool_specs(prompt),
        &(&1.name == "agent_plan_draft")
      )

  defp revision_plan_draft do
    TestAgenticLoopFixtures.plan_tool_call_result(
      "先读取待修订草稿和质量发现，再完成授权、生成并汇总修订候选。",
      [
        TestAgenticLoopFixtures.plan_step(
          "revision_prepare",
          "revision_prepare",
          "读取待修订草稿和质量发现。",
          success_criteria: ["revision_source_loaded"]
        ),
        TestAgenticLoopFixtures.plan_step(
          "revision_plan",
          "revision_plan",
          "制定修订执行策略并重新经过系统裁决。",
          success_criteria: ["revision_micro_plan_exists", "allow_tool_decision_exists"]
        ),
        TestAgenticLoopFixtures.plan_step(
          "prose_writing",
          "prose_writing",
          "基于修订计划生成正文修订候选。",
          kind: "act",
          write_intent: "tentative",
          success_criteria: ["tentative_revision_fragment_created"]
        ),
        TestAgenticLoopFixtures.plan_step(
          "revision_finalize",
          "revision_finalize",
          "汇总修订候选给作者确认。",
          success_criteria: ["turn_result_emitted"]
        )
      ],
      reason_codes: ["agent_plan_drafted", "prose_revision_plan_drafted"]
    )
  end

  defp revision_next_step_decision(prompt) do
    observations = existing_observation_section(prompt)

    cond do
      String.contains?(observations, "/ artifact_created:") ->
        TestAgenticLoopFixtures.done_next("已生成待采纳修订草稿，本轮目标已经满足。",
          reason_codes: ["goal_satisfied", "tentative_revision_fragment_created"]
        )

      String.contains?(observations, "已生成新的修订候选") ->
        TestAgenticLoopFixtures.continue_next(
          "汇总修订候选给作者确认。",
          "revision_finalize",
          reason_codes: ["agentic_next_step", "revision_candidate_ready"]
        )

      String.contains?(observations, "重新经过 Orchestrator") ->
        TestAgenticLoopFixtures.continue_next(
          "基于修订计划生成正文修订候选。",
          "prose_writing",
          write_intent: "tentative",
          reason_codes: ["agentic_next_step", "revision_plan_consumed"]
        )

      String.contains?(observations, "已读取待修订草稿") ->
        TestAgenticLoopFixtures.continue_next(
          "制定修订执行策略并重新经过系统裁决。",
          "revision_plan",
          reason_codes: ["agentic_next_step", "revision_source_consumed"]
        )

      true ->
        TestAgenticLoopFixtures.continue_next(
          "读取待修订草稿和质量发现。",
          "revision_prepare",
          reason_codes: ["agentic_next_step", "missing_revision_source"]
        )
    end
  end

  defp existing_observation_section(prompt) do
    prompt
    |> prompt_text()
    |> String.split("## 决策规则", parts: 2)
    |> hd()
  end

  defp prompt_contains?(prompt, pattern), do: prompt_text(prompt) =~ pattern
  defp prompt_text(prompt), do: TestAgenticLoopFixtures.prompt_text(prompt)

  defp run_prose_turn do
    complete = fn _prompt ->
      {:ok,
       %{
         content: "",
         tool_calls:
           TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
             items: [%{item_id: "cp3-item", title: "第01章", body: @bad_prose, rationale: nil}],
             self_report: %{
               assumptions: [],
               intended_reader_effect: nil,
               used_context_refs: [],
               risk_flags: []
             }
           })
       }}
    end

    evaluate = fn _prompt ->
      {:ok,
       %{
         content: "",
         tool_calls:
           TestAgenticLoopFixtures.native_tool_calls("report_quality_findings", %{
             "findings" => [
               %{
                 "quality_finding_id" => "qf_agent_revision_source",
                 "quality_gate_ref" => "quality_gate.style_fit",
                 "validator_ref" => "validator.sentence_rhythm_uniformity",
                 "severity" => "warn",
                 "action" => "warn",
                 "summary" => "连续句式机械重复",
                 "reasoning" => "四句使用相同结构，却没有形成强度、意义或后果递进。",
                 "evidence_spans" => [
                   %{
                     "text" => @bad_prose,
                     "sentence_start" => 1,
                     "sentence_end" => 4
                   }
                 ],
                 "impact_scope" => "local",
                 "revision_scope" => "local",
                 "confidence" => 0.89
               }
             ]
           })
       }}
    end

    {turn_result, _trace, _transcript} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(),
        decision: allow_decision(),
        context: context(),
        author_input: %{text: "写第一章正文首稿"},
        provider_execution: %Execution{result_fn: complete},
        quality_provider_execution: %Execution{result_fn: evaluate}
      })

    turn_result
  end

  defp context do
    %DialogueContext{
      workspace_id: @work,
      current_chapters: ["第01章：开端"],
      structured_chapters: [%{title: "第01章：开端", seq: 1, summary: "主角登场。", has_prose: false}],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-agent-revision-source",
      turn_id: "turn-agent-revision-source",
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      dialogue_goal: %{summary: "写第一章正文首稿"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "准备写正文。"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan do
    %MicroPlan{
      plan_id: "plan-agent-revision-source",
      turn_id: "turn-agent-revision-source",
      frame_ref: "frame-agent-revision-source",
      primary: true,
      plan_goal: %{summary: "写第一章正文首稿"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-agent-revision-source",
          action_type: :capability_invocation,
          summary: "生成正文",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low
        }
      ],
      stop_after_next_action: true
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "decision-agent-revision-source",
      turn_id: "turn-agent-revision-source",
      frame_ref: "frame-agent-revision-source",
      plan_ref: "plan-agent-revision-source",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["all_gates_passed"],
      approved_actions: [],
      rejected_actions: [],
      downgraded_actions: []
    }
  end

  defp tool_call_blocks(%{messages: messages}) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) == "tool_call",
        do: block
  end

  defp validation_blocks(%{messages: messages}) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) == "validation_result",
        do: block
  end

  defp message_text(%{blocks: blocks}) do
    blocks
    |> Enum.filter(&(Map.get(&1, :type) == "text"))
    |> Enum.map_join("", &Map.get(&1, :text, ""))
  end

  defp user_texts(transcript) do
    transcript.messages
    |> Enum.filter(&(Map.get(&1, :role) == "user"))
    |> Enum.map(&message_text/1)
  end

  defp snapshot_transcript(%{stage_state: state}) when is_map(state) do
    state[:judgment_transcript] ||
      case Map.get(state, :revision_result) do
        %{stage_state: %{judgment_transcript: transcript}} -> transcript
        %{judgment_transcript: transcript} -> transcript
        _other -> nil
      end
  end

  defp snapshot_transcript(_snapshot), do: nil

  defp find_planner_snapshot(predicate) do
    receive do
      {:revision_planner_snapshot, _run_id, _sequence, snapshot} ->
        if predicate.(snapshot), do: snapshot, else: find_planner_snapshot(predicate)
    after
      2_000 -> flunk("未捕获到满足条件的运行时 snapshot")
    end
  end

  @quality_revision_retry_env "SLICE_VERIFY_QUALITY_REVISION_RETRY"

  describe "real Gateway + SliceVerify quality finding revision" do
    setup do
      old_extra = Application.get_env(:novel_agent, :extra_providers)
      old_log_dir = Application.get_env(:novel_common, :llm_log_dir)
      old_retry = System.get_env(@quality_revision_retry_env)
      dir = Path.join(System.tmp_dir!(), "slice-verify-quality-revision-#{unique_integer()}")

      Application.put_env(
        :novel_agent,
        :extra_providers,
        Map.put(old_extra || %{}, :slice_verify, SliceVerify)
      )

      Application.put_env(:novel_common, :llm_log_dir, dir)
      System.delete_env(@quality_revision_retry_env)

      on_exit(fn ->
        restore_app_env(:novel_agent, :extra_providers, old_extra)
        restore_app_env(:novel_common, :llm_log_dir, old_log_dir)
        restore_system_env(@quality_revision_retry_env, old_retry)
        File.rm_rf!(dir)
      end)

      {:ok, work} = WorkRepo.create(%{title: "B71 修订 trace 交付"})
      {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "修订 trace 会话"})

      %{dir: dir, work: work, session: session}
    end

    test "local revision only rewrites the finding span and keeps original/revision independent",
         %{dir: dir} do
      source = run_slice_verify_source()
      [source_pending] = source.adoption_state.pending
      original_body = prose_body(source_pending)
      assert String.contains?(original_body, "他猛地侧身。")

      [finding] = source.quality_review.findings
      assert finding["revision_scope"] == "local"
      assert finding["impact_scope"] == "local"
      assert [%{"sentence_start" => 1, "sentence_end" => 3}] = finding["evidence_spans"]

      refute System.get_env(@quality_revision_retry_env)

      {run_id, revision, state} = run_slice_verify_revision(source)
      [revision_pending] = revision.adoption_state.pending
      revised_body = prose_body(revision_pending)

      assert revision_pending.artifact_id != source_pending.artifact_id
      assert revision.trace_summary.revision_base == source_pending.artifact_id

      assert Enum.any?(
               revision.ui_cards,
               &(&1[:card_type] == "candidate_set" and
                   &1[:revision_of] == source_pending.artifact_id)
             )

      assert revised_body != original_body
      # finding 只命中前三句；第三句之后（含 nonce 行）必须逐字节保留。
      assert String.split(original_body, "\n") |> Enum.take(3) == [
               "他猛地侧身。",
               "他一刀劈下。",
               "他反手格挡。"
             ]

      outside = original_body |> String.split("\n") |> Enum.drop(3) |> Enum.join("\n")
      assert outside != ""
      assert String.ends_with?(revised_body, "\n" <> outside)
      assert String.contains?(revised_body, outside)

      # 原稿仍是原字节，修订稿是独立 tentative 候选；没有采纳或作品事实写入。
      assert prose_body(source_pending) == original_body
      refute revision.truthfulness.artifact_adopted
      refute revision.truthfulness.production_write_performed

      assert state.run.status == :completed
      assert state.run.consumed_budget.steps == 4
      assert state.run.consumed_budget.tool_calls == 1
      assert state.run.consumed_budget.provider_calls == 1
      assert revision.trace_summary.execution_counts == %{provider_calls: 1, tool_calls: 1}
      assert revision.trace_summary.provider_call_budget.revision_writer == 2

      revision_records = revision_writer_records(dir)
      assert length(revision_records) == 1
      [record] = revision_records
      assert is_binary(record["provider_call_ref"]) and record["provider_call_ref"] != ""
      assert is_binary(record["provider_run_ref"]) and record["provider_run_ref"] != ""
      assert revision.trace_summary.revision_provider_call_ref == record["provider_call_ref"]

      transcript = snapshot_transcript(%{stage_state: state.stage_state})
      assert transcript.run.run_id == run_id

      assert [assistant] = Enum.filter(transcript.messages, &(&1.role == "assistant"))
      assert assistant.provider_call_ref == record["provider_call_ref"]
      assert assistant.provider_run_ref == record["provider_run_ref"]

      assert [call] = tool_call_blocks(transcript)
      assert call.name == "submit_tentative_artifact"
      assert is_list(call.arguments["items"])
      assert [validation] = validation_blocks(transcript)
      assert validation.call_id == call.call_id
      assert validation.status == "passed"

      # 源 writer/evaluator 也来自真实 Gateway，而非测试手补引用。
      records = llm_records(dir)
      assert is_binary(source.trace_summary.writer_provider_call_ref)
      assert is_binary(source.trace_summary.evaluator_provider_call_ref)

      assert Enum.any?(
               records,
               &(&1["provider_call_ref"] == source.trace_summary.writer_provider_call_ref)
             )

      assert Enum.any?(
               records,
               &(&1["provider_call_ref"] == source.trace_summary.evaluator_provider_call_ref)
             )
    end

    test "bounded revision persists exactly one real child trace and public replay reads it",
         %{dir: dir, work: work, session: session} do
      parent = self()
      source = run_slice_verify_source(work.id)
      [source_pending] = source.adoption_state.pending
      original_body = prose_body(source_pending)

      event_forward = fn event ->
        send(parent, {:agent_event, event.event_type, event})

        if event.event_type == :run_completed do
          send(
            parent,
            {:revision_commit_observation,
             %{
               transaction_open?: Repo.in_transaction?(),
               traces: TraceRepository.list_by_workspace(work.id),
               run: AgentRunLog.get_run(event.run_ref),
               transcript: MemoryLog.transcript(session.id)
             }}
          )
        end
      end

      {run_id, revision, state} =
        run_slice_verify_revision(source,
          work_id: work.id,
          session_id: session.id,
          interaction_store: &InteractionLifecycle.call/2,
          forward: event_forward
        )

      assert_receive {:revision_commit_observation, observed}, 1_000
      assert observed.transaction_open? == false
      assert [trace] = observed.traces

      # source/child 绑定：child run 挂在 source turn 下，trace/turn_result 使用 child 自己的
      # turn 身份，不冒充 source trace，也不把 source turn 当 child 结果。
      assert state.run.parent_turn_ref == source.turn_id
      assert observed.run.parent_turn_ref == source.turn_id
      assert revision.parent_turn_id == source.turn_id
      assert revision.trace_summary.source_turn_ref == source.turn_id
      assert trace.turn_id == revision.turn_id
      assert trace.turn_id != source.turn_id
      assert trace.turn_result_ref == revision.turn_id

      # 完成时 DB 恰一行 child trace，且与广播/持久化 TurnResult 的 trace_ref 同源。
      assert [db_trace] = TraceRepository.list_by_scope(work.id, session.id, revision.turn_id)
      assert [db_trace_by_id] = [TraceRepository.get_by_trace_id(trace.trace_id)]
      assert db_trace.id == trace.id
      assert db_trace_by_id.id == trace.id
      assert trace.trace_id == revision.trace_summary.trace_ref
      assert trace.trace_id == revision.orchestrator_decision.decision_trace_ref

      # frame/plan/decision/tool 作用域逐项来自同一次真实执行。
      assert trace.frame_ref == revision.frame_ref
      assert trace.plan_ref == revision.trace_summary.plan_ref
      assert trace.plan_ref == "plan_#{revision.turn_id}"
      assert trace.decision_type == "tool_dispatched"
      assert String.starts_with?(trace.turn_id, "turn_rev_")
      assert [tool_ref] = trace.tool_trace_refs
      assert tool_ref["tool_name"] == "prose_writing"
      assert tool_ref["tool_status"] == "succeeded"
      assert tool_ref["decision_ref"] == revision.orchestrator_decision.decision_id
      assert is_binary(tool_ref["tool_request_ref"])
      assert is_binary(tool_ref["tool_result_ref"])
      refute trace.replay_policy["recall_provider"]

      # Interaction/run/trace 是同一成功提交：事件广播时已全部可读且不在事务内。
      assert observed.run.id == run_id
      assert observed.run.status == "completed"
      assert observed.run.completed_step_refs != []
      assert observed.run.authoring_transcript["transcript"]["run"]["run_id"] == run_id

      assert Enum.any?(observed.transcript, fn entry ->
               entry.role == "assistant" and entry.turn_id == revision.turn_id and
                 get_in(entry.content, ["turn_result", "trace_summary", "trace_ref"]) ==
                   trace.trace_id
             end)

      # 公开 Replay/Why 读取真实 trace，不额外调 Provider。
      before_replay = length(llm_records(dir))

      assert {:ok, replay} =
               TraceReplayService.fetch_turn_report(work.id, session.id, revision.turn_id)

      assert replay.trace_summary.trace_ref == trace.trace_id
      assert replay.replay_report.provider_called == false
      assert length(llm_records(dir)) == before_replay

      # 作者出口与 trace 都不携带 RequestIR/原始 payload/canonical；原稿/修订稿仍待采纳。
      refute inspect(trace) =~ @bad_prose
      refute inspect(trace) =~ "[质量修订要求]"
      refute inspect(trace) =~ "request_ir"

      for key <- [:stage_state, :judgment_transcript, :request_ir, :provider_result, :execution] do
        refute Map.has_key?(revision, key)
        refute Map.has_key?(revision.trace_summary, key)
      end

      assert prose_body(source_pending) == original_body
      assert source_pending.adoption_status == "TENTATIVE"
      [revision_pending] = revision.adoption_state.pending
      assert revision_pending.adoption_status == "TENTATIVE"
      assert revision_pending.artifact_id != source_pending.artifact_id
      refute revision.truthfulness.artifact_adopted
      refute revision.truthfulness.production_write_performed
    end

    test "child trace 写入被 SQL 拒绝时不发布成功结果，真实 2 调用与 canonical 留在失败事实",
         %{dir: dir, work: work, session: session} do
      System.put_env(@quality_revision_retry_env, "1")
      source = run_slice_verify_source(work.id)
      trigger_name = "reject_revision_trace_#{unique_integer()}"
      parent = self()

      try do
        run_id =
          start_slice_verify_revision(source,
            work_id: work.id,
            session_id: session.id,
            interaction_store: &InteractionLifecycle.call/2,
            forward: fn event -> send(parent, {:agent_event, event.event_type, event}) end,
            planner_hook: fn _run, sequence, _snapshot ->
              if sequence == 1, do: install_decision_trace_trigger!(trigger_name)
            end
          )

        assert_receive {:agent_event, :run_failed, failed}, 5_000
        assert "interaction_persistence_failed" in failed.reason_codes
        refute_received {:agent_event, :artifact_created, _}
        refute_received {:agent_event, :run_completed, _}

        assert {:ok, live} = AgentRunService.state(run_id)
        assert live.run.status == :failed
        assert live.run.consumed_budget.provider_calls == 2
        assert live.run.consumed_budget.tool_calls == 1

        transcript = snapshot_transcript(%{stage_state: live.stage_state})
        assert transcript.run.run_id == run_id
        assert length(tool_call_blocks(transcript)) == 2
        assert [failed_validation, passed_validation] = validation_blocks(transcript)
        assert failed_validation.status == "failed"
        assert passed_validation.status == "passed"

        # 失败事实已提交：run 失败、canonical/真实消耗仍在，没有成功 Interaction 或 trace。
        run = AgentRunLog.get_run(run_id)
        assert run
        assert run.status == "failed"

        # 已完成的 prepare/plan/execute 三步事实保留；失败的 finalize 步不写入完成引用。
        refute Enum.any?(run.completed_step_refs, &String.ends_with?(&1, "_4"))
        assert run.consumed_budget["provider_calls"] == 2
        assert run.consumed_budget["tool_calls"] == 1

        canonical = run.authoring_transcript
        assert canonical
        assert length(canonical["transcript"]["call_ids"]) == 2
        assert {:ok, restored} = AuthoringTranscript.restore(canonical)
        assert length(tool_call_blocks(restored)) == 2

        assert [stored_failed, stored_passed] = validation_blocks(restored)
        assert stored_failed.status == "failed"
        assert stored_failed.reason_code == "invalid_items"
        assert stored_passed.status == "passed"

        assert TraceRepository.list_by_workspace(work.id) == []

        event_types = AgentRunLog.list_events(run_id) |> Enum.map(& &1.event_type)
        assert "run_failed" in event_types
        refute "turn_result_ready" in event_types
        refute "artifact_created" in event_types

        refute Enum.any?(MemoryLog.transcript(session.id), fn entry ->
                 entry.role == "assistant" and
                   (get_in(entry.content, ["turn_result", "trace_summary", "trace_ref"]) != nil or
                      get_in(entry.content, ["turn_result", "adoption_state", "pending"]) not in [
                        nil,
                        []
                      ])
               end)

        # 两次真实原生调用已经发生；拒绝写入后不再调用 Provider。
        assert length(revision_writer_records(dir)) == 2
        Process.sleep(100)
        assert length(revision_writer_records(dir)) == 2
        refute_received {:agent_event, :run_completed, _}
      after
        drop_decision_trace_trigger!(trigger_name)
      end
    end

    test "retry injection exchanges the same native id only after the failed validation",
         %{dir: dir} do
      System.put_env(@quality_revision_retry_env, "1")

      # env 只影响 quality_finding 修订；源 writer/evaluator 仍按原路径成功。
      source = run_slice_verify_source()
      [source_pending] = source.adoption_state.pending
      original_body = prose_body(source_pending)
      assert String.contains?(original_body, "他猛地侧身。")
      assert source.quality_review.review_status == "completed"
      assert length(source.quality_review.findings) == 1

      {run_id, revision, state} = run_slice_verify_revision(source)
      [revision_pending] = revision.adoption_state.pending
      revised_body = prose_body(revision_pending)

      assert state.run.status == :completed
      assert state.run.consumed_budget.provider_calls == 2
      assert state.run.consumed_budget.tool_calls == 1
      assert revision.trace_summary.execution_counts == %{provider_calls: 2, tool_calls: 1}
      assert revision.trace_summary.provider_call_budget.revision_writer == 2

      transcript = snapshot_transcript(%{stage_state: state.stage_state})
      assert transcript.run.run_id == run_id
      calls = tool_call_blocks(transcript)
      assert length(calls) == 2
      assert Enum.all?(calls, &(&1.name == "submit_tentative_artifact"))
      assert Enum.at(calls, 0).arguments == %{}
      assert is_list(Enum.at(calls, 1).arguments["items"])
      # 同一原生 id 复用时，canonical 分配唯一 id，但保留原 id 来源映射。
      assert Enum.at(calls, 0).call_id == "native-submit_tentative_artifact"
      assert Enum.at(calls, 1).provider_call_id == "native-submit_tentative_artifact"
      assert Enum.at(calls, 1).call_id != Enum.at(calls, 0).call_id

      assert [first_validation, second_validation] = validation_blocks(transcript)
      assert first_validation.call_id == Enum.at(calls, 0).call_id
      assert first_validation.status == "failed"
      assert first_validation.reason_code == "invalid_items"
      assert second_validation.call_id == Enum.at(calls, 1).call_id
      assert second_validation.status == "passed"

      revision_records = revision_writer_records(dir)
      assert length(revision_records) == 2
      assert Enum.all?(revision_records, &real_execution_refs?/1)
      [first_record, second_record] = revision_records
      assert first_record["provider_call_ref"] != second_record["provider_call_ref"]
      assert request_text(second_record) =~ "invalid_items"
      assert request_text(second_record) =~ "native-submit_tentative_artifact"

      assert revision.trace_summary.revision_provider_call_ref ==
               second_record["provider_call_ref"]

      [first_assistant, second_assistant] =
        Enum.filter(transcript.messages, &(&1.role == "assistant"))

      assert first_assistant.provider_call_ref == first_record["provider_call_ref"]
      assert second_assistant.provider_call_ref == second_record["provider_call_ref"]
      assert first_assistant.provider_run_ref != second_assistant.provider_run_ref

      outside = original_body |> String.split("\n") |> Enum.drop(3) |> Enum.join("\n")
      assert String.ends_with?(revised_body, "\n" <> outside)
      assert prose_body(source_pending) == original_body
      refute revision.truthfulness.artifact_adopted
      refute revision.truthfulness.production_write_performed
    end
  end

  defp run_slice_verify_source(work_id \\ @work) do
    id = "slice-verify-quality-#{unique_integer()}"

    {turn_result, _trace, _transcript} =
      TurnExecutionService.execute(%{
        frame: slice_verify_frame(work_id, id),
        plan: slice_verify_plan(id),
        decision: slice_verify_decision(id),
        context: slice_verify_context(work_id),
        author_input: %{text: "写第02章：矿区追击战正文草稿，短促动作追击"},
        provider_execution: slice_verify_execution(:writer),
        quality_provider_execution: slice_verify_execution(:evaluator)
      })

    turn_result
  end

  defp run_slice_verify_revision(source, opts \\ []) do
    run_id = start_slice_verify_revision(source, opts)

    assert_receive {:agent_event, :artifact_created, artifact_event}, 5_000
    assert_receive {:agent_event, :run_completed, _}, 5_000
    assert {:ok, state} = AgentRunService.state(run_id)

    {run_id, artifact_event.payload.turn_result, state}
  end

  defp start_slice_verify_revision(source, opts) do
    parent = self()
    revise = revise_action(source)
    work_id = Keyword.get(opts, :work_id, @work)

    session_id =
      Keyword.get(opts, :session_id, "session-slice-verify-revision-#{unique_integer()}")

    action_input = %AuthorActionInput{
      input_id: "in-slice-verify-revision-#{unique_integer()}",
      source_turn_ref: source.turn_id,
      action_id: revise.action_id,
      action_type: "revise_from_findings",
      target_ref: revise.target_ref,
      payload: %{"quality_finding_refs" => revise.quality_finding_refs},
      idempotency_key: revise.idempotency_key
    }

    input = %{
      text: "按质量发现重写正文草稿",
      workspace_id: work_id,
      work_id: work_id,
      session_id: session_id,
      turn_id: source.turn_id,
      source_turn_result: source,
      action_input: action_input
    }

    input =
      case Keyword.get(opts, :interaction_store) do
        nil -> input
        store -> Map.put(input, :interaction_store, store)
      end

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_revision_from_findings,
        input,
        nil,
        slice_verify_execution(:revision)
      )

    planner_hook = Keyword.get(opts, :planner_hook, fn _run, _sequence, _snapshot -> :ok end)

    planner = fn run, sequence, snapshot ->
      send(parent, {:revision_planner_snapshot, run.run_id, sequence, snapshot})
      planner_hook.(run, sequence, snapshot)
      planned.next_step_planner.(run, sequence, snapshot)
    end

    event_forward =
      Keyword.get(opts, :forward, fn event ->
        send(parent, {:agent_event, event.event_type, event})
      end)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(planned.run_attrs, event_forward),
               next_step_planner: planner,
               interaction_store: planned.interaction_store
             )

    run_id
  end

  # TEMP trigger 必须在实际执行提交的 AgentRunServer 进程连接上创建；与既有
  # AgentRunResultCommitTest 的原子拒写方法同形，只拒绝 child revision trace。
  defp install_decision_trace_trigger!(name) do
    Repo.query!("""
    CREATE TEMP TRIGGER #{name} BEFORE INSERT ON decision_traces
    WHEN NEW.turn_id LIKE 'turn_rev_%'
    BEGIN SELECT RAISE(ABORT, 'injected revision decision trace rejection'); END
    """)

    :ok
  end

  defp drop_decision_trace_trigger!(name) do
    Repo.query!("DROP TRIGGER IF EXISTS #{name}")
    :ok
  end

  defp slice_verify_execution(purpose) do
    Execution.dependency(
      provider: :slice_verify,
      model: "fixture-model",
      purpose: purpose
    )
  end

  defp prose_body(pending) do
    pending.payload.items |> hd() |> Map.get(:body)
  end

  defp revision_writer_records(dir) do
    dir
    |> llm_records()
    |> Enum.filter(&String.contains?(request_text(&1), "[质量修订要求]"))
  end

  # canonical IR 请求记录的 `prompt` 字段为 nil：正文材料在 `request_body` 的
  # canonical messages/blocks 中。只读实际落盘的请求字节，不重建旧 prompt。
  defp request_text(record) do
    case Map.get(record, "prompt") do
      text when is_binary(text) -> text
      _ -> record |> Map.get("request_body", %{}) |> Map.get("messages", []) |> Jason.encode!()
    end
  end

  defp llm_records(dir) do
    path = Path.join(dir, "#{NovelCommon.LogFileDate.today_iso8601()}.jsonl")

    path
    |> File.read!()
    |> String.split("\n", trim: true)
    |> Enum.map(fn
      "[" <> _ = line ->
        [_prefix, json] = String.split(line, "] ", parts: 2)
        Jason.decode!(json)

      line ->
        Jason.decode!(line)
    end)
  end

  defp real_execution_refs?(record) do
    is_binary(record["provider_call_ref"]) and record["provider_call_ref"] != "" and
      is_binary(record["provider_run_ref"]) and record["provider_run_ref"] != ""
  end

  defp slice_verify_context(work_id) do
    %DialogueContext{
      workspace_id: work_id,
      current_chapters: ["第02章：矿区追击战"],
      structured_chapters: [
        %{
          title: "第02章：矿区追击战",
          seq: 2,
          summary: "主角在废弃矿区遭遇巡检傀儡，短促的动作追击中且战且退。",
          has_prose: false
        }
      ],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end

  defp slice_verify_frame(work_id, id) do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-#{id}",
      turn_id: "turn-#{id}",
      workspace_id: work_id,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "写第02章：矿区追击战正文草稿"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "写第02章：矿区追击战正文草稿。"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp slice_verify_plan(id) do
    %MicroPlan{
      plan_id: "plan-#{id}",
      turn_id: "turn-#{id}",
      frame_ref: "frame-#{id}",
      primary: true,
      plan_goal: %{summary: "写第02章：矿区追击战正文草稿"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-#{id}",
          action_type: :capability_invocation,
          summary: "生成正文",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: nil,
          requested_chapter_raw: "第02章",
          target_chapter: "第02章：矿区追击战"
        }
      ],
      stop_after_next_action: true
    }
  end

  defp slice_verify_decision(id) do
    %OrchestratorDecision{
      decision_id: "decision-#{id}",
      turn_id: "turn-#{id}",
      frame_ref: "frame-#{id}",
      plan_ref: "plan-#{id}",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["all_gates_passed"],
      approved_actions: [],
      rejected_actions: [],
      downgraded_actions: []
    }
  end

  defp unique_integer, do: System.unique_integer([:positive, :monotonic])

  defp restore_app_env(app, key, nil), do: Application.delete_env(app, key)
  defp restore_app_env(app, key, value), do: Application.put_env(app, key, value)

  defp restore_system_env(key, nil), do: System.delete_env(key)
  defp restore_system_env(key, value), do: System.put_env(key, value)
end
