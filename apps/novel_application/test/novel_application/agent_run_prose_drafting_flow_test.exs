defmodule NovelApplication.AgentRunProseDraftingFlowTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.ProseDraftingWithQuality
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext

  @work "work-agent-prose-flow"
  @bad_prose "他走进房间，看了看四周，坐了下来。他拿起书本，翻了翻几页，放了下来。他望向窗外，看了看天色，叹了口气。他端起茶杯，喝了一小口，搁了回去。"

  test "bounded prose run exposes context, strategy, prose quality, and finalization steps" do
    parent = self()

    writer = fn prompt ->
      cond do
        plan_draft_prompt?(prompt) ->
          {:ok, with_provider_call(prose_plan_draft(prompt), "pc-agent-prose-planner")}

        prompt_contains?(prompt, "AgentRun 下一步规划器") ->
          {:ok,
           %{
             content:
               NovelApplication.TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
           }}

        true ->
          send(parent, {:writer_prompt, prompt})

          {:ok,
           %{
             provider_call_id: "pc-agent-prose-writer",
             content:
               Jason.encode!(%{
                 items: [
                   %{
                     item_id: "agent-prose-item",
                     title: "第01章：开端",
                     body: @bad_prose,
                     rationale: "首稿候选。"
                   }
                 ],
                 self_report: %{
                   assumptions: [],
                   intended_reader_effect: "压迫感",
                   used_context_refs: ["prose_execution_brief"],
                   risk_flags: []
                 }
               })
           }}
      end
    end

    evaluator = fn prompt ->
      send(parent, {:evaluator_prompt, prompt})

      {:ok,
       %{
         provider_call_ref: "pc-agent-prose-evaluator",
         content:
           Jason.encode!(%{
             "findings" => [
               %{
                 "quality_gate_ref" => "quality_gate.character_logic",
                 "validator_ref" => "validator.character_agency",
                 "severity" => "warn",
                 "action" => "adoption_review",
                 "summary" => "主角缺乏主动目标"
               }
             ]
           })
       }}
    end

    input = %{
      text: "先写第01章正文草稿，再做质量复核，检查是否有问题。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-prose-flow",
      turn_id: "turn-agent-prose-flow",
      quality_provider_execution: %Execution{result_fn: evaluator},
      chapter_prose_reader: fn _work_id, _chapter -> "" end,
      chapter_summary_reader: %{},
      character_reader: fn _work_id -> [] end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_drafting_with_quality,
        input,
        context(),
        %Execution{result_fn: writer}
      )

    assert planned.run_attrs.profile_ref == ProseDraftingWithQuality.profile_ref()

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    assert_receive {:agent_event, :plan_drafted, context_step}
    assert context_step.summary =~ "读取正文写作上下文"
    assert context_step.payload.target_tool_ref == "context_assemble"
    assert is_list(context_step.payload.plan_steps)

    NovelApplication.TestAssertions.assert_provider_output_narrative_source(
      context_step.payload.author_narrative_source
    )

    assert_receive {:agent_event, :goal_understood, context_event}, 500
    assert context_event.summary =~ "正文写作上下文"
    assert_receive {:agent_event, :exploration_observed, context_observation}, 500
    assert context_observation.summary =~ "已组装正文写作上下文"
    assert_receive {:agent_event, :evaluation_made, context_decision}, 500
    assert "agent_step_evaluated" in context_decision.reason_codes

    assert_receive {:agent_event, :evaluation_made, plan_event}, 500
    assert "agent_step_evaluated" in plan_event.reason_codes
    assert_receive {:agent_event, :gate_decided, gate_event}, 500
    assert gate_event.summary =~ "系统已完成下一步执行裁决"

    assert_receive {:agent_event, :tool_started, tool_started}, 500
    assert tool_started.summary =~ "正文写作能力"
    assert_receive {:writer_prompt, writer_prompt}, 500
    assert writer_prompt =~ "用户创作简述："
    assert writer_prompt =~ "场级执行简述"
    assert_receive {:evaluator_prompt, evaluator_prompt}, 500
    assert evaluator_prompt =~ "质量评审"
    refute evaluator_prompt =~ "用户创作简述："
    assert_receive {:agent_event, :tool_completed, tool_completed}, 500
    assert tool_completed.summary =~ "质量复核已完成"
    assert_receive {:agent_event, :exploration_observed, quality_event}, 500
    assert quality_event.summary =~ "质量复核已完成"
    assert_receive {:agent_event, :exploration_observed, observation_event}, 500
    assert observation_event.summary =~ "正文草稿"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :evaluation_made, prose_decision}, 500
    assert prose_decision.payload.loop_decision_type == :goal_satisfied
    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert length(state.run.completed_step_refs) == 2
    assert state.run.consumed_budget.steps == 2
    assert state.run.consumed_budget.tool_calls == 1
    assert state.run.consumed_budget.provider_calls == 4
    assert Enum.any?(state.observations, &(&1.observation_type == :artifact_created))
    assert Enum.any?(state.observations, &(&1.observation_type == :quality_review))

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id
    assert turn_result.agent_run.profile_ref == "prose_drafting_with_quality_v1"
    assert turn_result.tool_result.tool_name == "prose_writing"
    assert turn_result.truthfulness.artifact_adopted == false
    assert turn_result.truthfulness.production_write_performed == false

    assert [%{adoption_status: :tentative, artifact_type: :prose_fragment}] =
             turn_result.adoption_state.pending

    assert turn_result.quality_review.review_status == "completed"
    assert turn_result.quality_review.findings != []
    assert turn_result.trace_summary.writer_provider_call_ref == "pc-agent-prose-writer"
    assert turn_result.trace_summary.evaluator_provider_call_ref == "pc-agent-prose-evaluator"
    assert turn_result.trace_summary.provider_call_budget.writer == 1
    assert turn_result.trace_summary.provider_call_budget.evaluator == 1
    assert Enum.any?(turn_result.available_actions, &(&1.action_type == "revise_from_findings"))
  end

  test "continuation decision injects prior prose into writer and marks pending artifact for append adoption" do
    parent = self()
    prior_prose = "他在第一夜数清了灵气账单上的每一笔亏空。"

    writer = fn prompt ->
      cond do
        plan_draft_prompt?(prompt) ->
          {:ok, with_provider_call(prose_plan_draft(prompt), "pc-agent-prose-cont-planner")}

        prompt_contains?(prompt, "AgentRun 下一步规划器") ->
          {:ok,
           %{
             content:
               NovelApplication.TestAgenticLoopFixtures.reasoning_tail(
                 continuation_next_step_decision(prompt)
               )
           }}

        true ->
          send(parent, {:writer_prompt, prompt})

          {:ok,
           %{
             provider_call_id: "pc-agent-prose-cont-writer",
             content:
               Jason.encode!(%{
                 items: [
                   %{
                     item_id: "agent-prose-cont-item",
                     title: "第01章：开端",
                     body: "他把亏空的名字一笔一笔誊到旧账页背面。",
                     rationale: "续写候选。"
                   }
                 ],
                 self_report: %{
                   assumptions: [],
                   intended_reader_effect: "压迫感",
                   used_context_refs: ["prose_execution_brief"],
                   risk_flags: []
                 }
               })
           }}
      end
    end

    evaluator = fn _prompt ->
      {:ok,
       %{
         provider_call_ref: "pc-agent-prose-cont-eval",
         content: Jason.encode!(%{"findings" => []})
       }}
    end

    input = %{
      text: "接着第01章：开端往下写一段正文，自然衔接前文。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-prose-cont",
      turn_id: "turn-agent-prose-cont",
      quality_provider_execution: %Execution{result_fn: evaluator},
      chapter_prose_reader: fn _work_id, chapter ->
        if chapter == "第01章：开端", do: prior_prose, else: ""
      end,
      chapter_summary_reader: %{},
      character_reader: fn _work_id -> [] end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_drafting_with_quality,
        input,
        context(),
        %Execution{result_fn: writer}
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:writer_prompt, writer_prompt}, 2_000
    assert writer_prompt =~ prior_prose

    assert_receive {:agent_event, :artifact_created, artifact_event}, 2_000
    assert_receive {:agent_event, :run_completed, _}, 2_000

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id

    assert [pending] = turn_result.adoption_state.pending
    assert pending.artifact_type == :prose_fragment
    assert pending.authoring_intent == :continuation
    assert pending.target_chapter == "第01章：开端"
  end

  test "planner native tool-call retry is charged to AgentRun provider budget" do
    parent = self()
    {:ok, planner_counter} = Agent.start_link(fn -> 0 end)

    writer = fn prompt ->
      cond do
        plan_draft_prompt?(prompt) ->
          attempt = Agent.get_and_update(planner_counter, fn count -> {count + 1, count + 1} end)
          send(parent, {:planner_prompt, attempt, prompt})

          # 两段式：attempt 1 = 流式 reasoning（无 tools，返回 content 合法）；
          # attempt 2 = 结构化 tool call 首次失败（缺 tool_calls）触发纠错重试；
          # attempt 3 = 纠错后返回合法 tool call。
          if attempt <= 2 do
            {:ok, %{content: "先读取正文写作上下文。", tool_calls: []}}
          else
            {:ok,
             Map.put(
               prose_plan_draft(prompt),
               :provider_call_id,
               "pc-agent-prose-retry-planner"
             )}
          end

        prompt_contains?(prompt, "AgentRun 下一步规划器") ->
          {:ok,
           %{
             content:
               NovelApplication.TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
           }}

        true ->
          send(parent, {:writer_prompt, prompt})

          {:ok,
           %{
             provider_call_id: "pc-agent-prose-retry-writer",
             content:
               Jason.encode!(%{
                 items: [
                   %{
                     item_id: "agent-prose-retry-item",
                     title: "第01章：开端",
                     body: @bad_prose,
                     rationale: "首稿候选。"
                   }
                 ],
                 self_report: %{
                   assumptions: [],
                   intended_reader_effect: "压迫感",
                   used_context_refs: ["prose_execution_brief"],
                   risk_flags: []
                 }
               })
           }}
      end
    end

    evaluator = fn _prompt ->
      {:ok,
       %{
         provider_call_ref: "pc-agent-prose-retry-eval",
         content: Jason.encode!(%{"findings" => []})
       }}
    end

    input = %{
      text: "先写第01章正文草稿，再做质量复核。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-prose-retry",
      turn_id: "turn-agent-prose-retry",
      quality_provider_execution: %Execution{result_fn: evaluator},
      chapter_prose_reader: fn _work_id, _chapter -> "" end,
      chapter_summary_reader: %{},
      character_reader: fn _work_id -> [] end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_drafting_with_quality,
        input,
        context(),
        %Execution{result_fn: writer}
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:planner_prompt, 1, reasoning_prompt}, 500
    assert prompt_text(reasoning_prompt) =~ "AgentRun 计划起草器"
    refute NovelAgent.Provider.tool_call_prompt?(reasoning_prompt)
    assert_receive {:planner_prompt, 2, structure_prompt}, 500
    assert NovelAgent.Provider.tool_choice(structure_prompt) == "agent_plan_draft"
    assert prompt_text(structure_prompt) =~ "你已向作者说明的计划 reasoning"
    assert_receive {:planner_prompt, 3, retry_prompt}, 500
    assert prompt_text(retry_prompt) =~ "上一次的 AgentRun 计划 tool call 无法被系统解析"
    assert prompt_text(retry_prompt) =~ "必须调用 agent_plan_draft"
    assert_receive {:writer_prompt, _writer_prompt}, 1_000
    assert_receive {:agent_event, :run_completed, _}, 2_000

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert state.run.consumed_budget.steps == 2
    assert state.run.consumed_budget.tool_calls == 1
    # 规划 3（reasoning + 结构失败 + 纠错）+ writer 1 + evaluator 1
    assert state.run.consumed_budget.provider_calls == 5
    assert Agent.get(planner_counter, & &1) == 3
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

    # 计划已走完 + 旗标在：原本会进判断②（2 次调用）；收束语义下 0 调用直接完成。
    assert {:complete, decision, meta} = spec.next_step_planner.(run, 3, snapshot)
    assert decision.decision_type == :goal_satisfied
    assert "author_adopted_candidate" in decision.reason_codes
    assert meta.provider_call_count == 0
  end

  test "D1 tool failure revises plan before waiting for author" do
    parent = self()

    writer = fn prompt ->
      cond do
        plan_draft_prompt?(prompt) ->
          {:ok, with_provider_call(prose_plan_draft(prompt), "pc-agent-prose-d1-plan")}

        continuation_narrative_prompt?(prompt) ->
          continuation_narrative("写作模型连续故障，我先停下来，等你确认后再继续。")

        continuation_decision_prompt?(prompt) ->
          continuation_decision("await_author", "")

        true ->
          send(parent, {:writer_prompt, prompt})
          {:error, %{type: :provider_error, message: "fixture writer failure"}}
      end
    end

    evaluator = fn _prompt -> flunk("D1 writer failure must not call quality evaluator") end

    run_id =
      start_prose_run!(
        %{
          text: "写下一章正文草稿，但 writer provider 故障。",
          session_id: "session-agent-prose-d1",
          turn_id: "turn-agent-prose-d1",
          quality_provider_execution: %Execution{result_fn: evaluator}
        },
        writer,
        parent
      )

    events = collect_agent_events_until(:awaiting_author, 2_000)
    assert_receive {:writer_prompt, _prompt}, 500

    # CP3a：偏离信号走判断②（观察 + 续行），不再产 plan_revised 伪修订。
    awaiting = find_event!(events, :awaiting_author)
    assert "judgment_continuation" in awaiting.reason_codes
    assert "agentic_deviation:D1" in awaiting.reason_codes
    assert awaiting.summary =~ "停下来"

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :awaiting_author
    # 判断② await 不消耗 replan（无模型计划修订）。
    assert state.run.consumed_budget.replans == 0
    assert state.run.consumed_budget.tool_calls == 1
    # runtime 直连（无判断①入场）：起草 2 + 失败 writer 步 2 + 判断② 2 = 6。
    assert state.run.consumed_budget.provider_calls == 6
  end

  test "D2 actionable quality finding revises plan before waiting for author" do
    parent = self()

    writer = fn prompt ->
      cond do
        plan_draft_prompt?(prompt) ->
          {:ok, with_provider_call(prose_plan_draft(prompt), "pc-agent-prose-d2-plan")}

        continuation_narrative_prompt?(prompt) ->
          continuation_narrative("质量复核发现规则冲突，我会按意见修正后再交给你。")

        continuation_decision_prompt?(prompt) ->
          continuation_decision("continue", "去掉无代价复活，补上规则代价。")

        true ->
          send(parent, :writer_called)

          {:ok,
           %{
             provider_call_id: "pc-agent-prose-d2-writer",
             content:
               Jason.encode!(%{
                 items: [
                   %{
                     item_id: "agent-prose-d2-item",
                     title: "第01章：开端",
                     body: "主角无需代价就复活并推翻既有规则。",
                     rationale: "质量确认演练。"
                   }
                 ],
                 self_report: %{
                   assumptions: [],
                   intended_reader_effect: "规则冲突",
                   used_context_refs: ["prose_execution_brief"],
                   risk_flags: ["rule_conflict"]
                 }
               })
           }}
      end
    end

    {:ok, eval_counter} = Agent.start_link(fn -> 0 end)

    evaluator = fn _prompt ->
      # 首评产 confirm finding（触发 D2 → 判断② continue）；改进稿复评通过。
      count = Agent.get_and_update(eval_counter, fn n -> {n, n + 1} end)

      findings =
        if count == 0 do
          [
            %{
              "quality_gate_ref" => "quality_gate.rule_consistency",
              "validator_ref" => "validator.rule_conflict",
              "severity" => "high",
              "action" => "confirm",
              "summary" => "违反既有规则且需要作者确认"
            }
          ]
        else
          []
        end

      {:ok,
       %{
         provider_call_ref: "pc-agent-prose-d2-eval-#{count}",
         content: Jason.encode!(%{"findings" => findings})
       }}
    end

    run_id =
      start_prose_run!(
        %{
          text: "写第01章正文草稿，刻意制造一个需要确认的规则冲突。",
          session_id: "session-agent-prose-d2",
          turn_id: "turn-agent-prose-d2",
          quality_provider_execution: %Execution{result_fn: evaluator}
        },
        writer,
        parent
      )

    # CP3b：quality confirm finding → 判断② continue（观察 + 修正指引）→ 中间稿被
    # supersede（预算放行 + 作者可见说明）→ writer 重试产改进稿 → 复评通过 → 完成。
    events = collect_agent_events_until(:run_completed, 3_000)

    superseded = find_event!(events, :artifact_superseded)
    assert superseded.refs != []
    assert "judgment_continuation" in superseded.reason_codes

    created_events = Enum.filter(events, fn {type, _event} -> type == :artifact_created end)
    assert length(created_events) == 2

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    # 判断② continue 按修订事实计 1 次 replan。
    assert state.run.consumed_budget.replans == 1
    assert state.run.consumed_budget.tool_calls == 2
    # runtime 直连：起草 2 + prose 步 2 + 判断② 2 + 重试步 2（writer+复评）= 8。
    assert state.run.consumed_budget.provider_calls == 8
    # 改进闭环终局：pending 只剩改进稿（首稿已被替代）。
    assert length(state.run.pending_artifact_refs) == 1
    # 改进稿即最终 TurnResult（completed + 单 pending）。
    assert get_in(state.final_turn_result, [:agent_run, :status]) == :completed
    assert length(get_in(state.final_turn_result, [:adoption_state, :pending]) || []) == 1
    {:artifact_superseded, superseded_event} =
      Enum.find(events, fn {type, _event} -> type == :artifact_superseded end)
    refute Enum.any?(superseded_event.refs, &(&1 in state.run.pending_artifact_refs))
  end

  test "D4 gate deny revises plan without dispatching the prose writer" do
    parent = self()

    writer = fn prompt ->
      cond do
        plan_draft_prompt?(prompt) ->
          {:ok,
           with_provider_call(
             prose_plan_draft(prompt, risk_hint: "high"),
             "pc-agent-prose-d4-plan"
           )}

        continuation_narrative_prompt?(prompt) ->
          continuation_narrative("这一步被系统权限门禁拦下，需要你确认后才能继续。")

        continuation_decision_prompt?(prompt) ->
          continuation_decision("await_author", "")

        true ->
          send(parent, {:unexpected_writer_prompt, prompt})

          {:ok,
           %{provider_call_id: "pc-agent-prose-d4-writer", content: Jason.encode!(%{items: []})}}
      end
    end

    evaluator = fn _prompt -> flunk("D4 gate deny must not call quality evaluator") end

    run_id =
      start_prose_run!(
        %{
          text: "写下一章正文草稿，高风险，需要确认后再执行。",
          session_id: "session-agent-prose-d4",
          turn_id: "turn-agent-prose-d4",
          quality_provider_execution: %Execution{result_fn: evaluator}
        },
        writer,
        parent
      )

    events = collect_agent_events_until(:awaiting_author, 2_000)
    refute_receive {:unexpected_writer_prompt, _prompt}, 200

    gate = find_event!(events, :gate_decided)
    assert gate.payload.decision_type == :require_confirmation
    assert gate.payload.first_blocking_gate == "authority"

    # CP3a：gate deny → 判断②观察（门禁裁决权在作者）→ 停等，不再产伪修订。
    awaiting = find_event!(events, :awaiting_author)
    assert "judgment_continuation" in awaiting.reason_codes
    assert "agentic_deviation:D4" in awaiting.reason_codes

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :awaiting_author
    assert state.run.consumed_budget.replans == 0
    assert state.run.consumed_budget.tool_calls == 0
    # runtime 直连：起草 2 + 判断② 2 = 4（writer 未派发）。
    assert state.run.consumed_budget.provider_calls == 4
  end
  test "D7 deterministic missing chapter gap revises plan without calling writer provider" do
    parent = self()

    writer = fn prompt ->
      cond do
        plan_draft_prompt?(prompt) ->
          {:ok,
           with_provider_call(
             prose_plan_draft(prompt,
               authoring_intent: "continuation",
               requested_chapter_raw: "第99章",
               target_chapter: nil
             ),
             "pc-agent-prose-d7-plan"
           )}

        continuation_narrative_prompt?(prompt) ->
          continuation_narrative("你点名的章节在作品里还不存在，需要你确认目标章后我再继续。")

        continuation_decision_prompt?(prompt) ->
          continuation_decision("await_author", "")

        true ->
          send(parent, {:unexpected_writer_prompt, prompt})

          {:ok,
           %{provider_call_id: "pc-agent-prose-d7-writer", content: Jason.encode!(%{items: []})}}
      end
    end

    evaluator = fn _prompt -> flunk("D7 missing policy must not call quality evaluator") end

    run_id =
      start_prose_run!(
        %{
          text: "续写第99章正文。",
          session_id: "session-agent-prose-d7",
          turn_id: "turn-agent-prose-d7",
          quality_provider_execution: %Execution{result_fn: evaluator}
        },
        writer,
        parent
      )

    events = collect_agent_events_until(:awaiting_author, 2_000)
    refute_receive {:unexpected_writer_prompt, _prompt}, 200

    # CP3a：缺章 gap → 判断②观察（目标章裁决权在作者）→ 停等，不再产伪修订。
    awaiting = find_event!(events, :awaiting_author)
    assert "judgment_continuation" in awaiting.reason_codes
    assert "agentic_deviation:D7" in awaiting.reason_codes

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :awaiting_author
    assert state.run.consumed_budget.replans == 0
    # runtime 直连：起草 2 + 判断② 2 = 4（writer provider 未调用）。
    assert state.run.consumed_budget.provider_calls == 4
  end
  defp plan_draft_prompt?(prompt),
    do: prompt_contains?(prompt, "AgentRun 计划起草器")

  defp plan_revision_prompt?(prompt),
    do: prompt_contains?(prompt, "AgentRun 计划修订器")

  # CP3a 判断②两段式（偏离信号 → 观察 + 续行，替代模型计划修订）。
  defp continuation_narrative_prompt?(prompt),
    do: prompt_contains?(prompt, "你的两种续行方式")

  defp continuation_decision_prompt?(prompt),
    do: prompt_contains?(prompt, "continuation_decision")

  defp continuation_narrative(text) do
    {:ok,
     %{
       content: text,
       provider_output: %NovelCommon.Contracts.ProviderOutput{
         provider_run_ref: "prun-continuation",
         provider_call_ref: "pcall-continuation",
         status: :ok,
         content: %{text: text}
       }
     }}
  end

  defp continuation_decision(action, guidance) do
    {:ok,
     %{
       content: "",
       tool_calls: [
         %{
           "name" => "continuation_decision",
           "arguments" => %{
             "action" => action,
             "guidance" => guidance,
             "reason" => "continuation_#{action}"
           }
         }
       ]
     }}
  end

  defp prompt_contains?(prompt, pattern), do: prompt_text(prompt) =~ pattern

  defp prompt_text(prompt), do: NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)

  defp prose_plan_revision(prompt) do
    prose_plan_draft(prompt,
      reason_codes: ["agent_plan_revised", "prose_plan_revised"],
      tool_name: "agent_plan_revision"
    )
  end

  defp prose_plan_draft(prompt, opts \\ []) do
    prompt = prompt_text(prompt)

    {authoring_intent, target_chapter, requested_chapter_raw, reasoning} =
      # 嗅作者目标短语而非全 prompt（生产指引文案自身含"接着写"枚举说明，全文嗅探会误翻分支）
      if String.contains?(prompt, "接着第01章") do
        {"continuation", "第01章：开端", "第01章", "先读取第01章上下文，再按续写意图生成正文草稿。"}
      else
        {"none", "第01章：开端", "第01章", "先读取正文写作上下文，再生成一份待采纳正文草稿并复核。"}
      end

    authoring_intent = Keyword.get(opts, :authoring_intent, authoring_intent)
    target_chapter = Keyword.get(opts, :target_chapter, target_chapter)
    requested_chapter_raw = Keyword.get(opts, :requested_chapter_raw, requested_chapter_raw)
    risk_hint = Keyword.get(opts, :risk_hint, "low")

    NovelApplication.TestAgenticLoopFixtures.plan_tool_call_result(
      reasoning,
      [
        NovelApplication.TestAgenticLoopFixtures.plan_step(
          "assemble_prose_context",
          "context_assemble",
          "读取正文写作上下文",
          success_criteria: ["prose_context_attached"]
        ),
        NovelApplication.TestAgenticLoopFixtures.plan_step(
          "draft_prose_with_quality",
          "prose_writing",
          "生成正文草稿并触发质量复核",
          kind: "act",
          write_intent: "tentative",
          risk_hint: risk_hint,
          authoring_intent: authoring_intent,
          target_chapter: target_chapter,
          requested_chapter_raw: requested_chapter_raw,
          success_criteria: ["prose_fragment_created", "quality_review_completed"]
        )
      ],
      reason_codes: Keyword.get(opts, :reason_codes, ["agent_plan_drafted"]),
      tool_name: Keyword.get(opts, :tool_name, "agent_plan_draft")
    )
  end

  defp with_provider_call(result, provider_call_id),
    do: Map.put(result, :provider_call_id, provider_call_id)

  defp start_prose_run!(input_overrides, writer, parent) do
    input =
      %{
        text: "先写第01章正文草稿，再做质量复核。",
        workspace_id: @work,
        work_id: @work,
        session_id: "session-agent-prose-deviation",
        turn_id: "turn-agent-prose-deviation",
        chapter_prose_reader: fn _work_id, _chapter -> "" end,
        chapter_summary_reader: %{},
        character_reader: fn _work_id -> [] end
      }
      |> Map.merge(input_overrides)

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :prose_drafting_with_quality,
        input,
        context(),
        %Execution{result_fn: writer}
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    run_id
  end

  defp collect_agent_events_until(type, timeout_ms) do
    deadline = System.monotonic_time(:millisecond) + timeout_ms
    do_collect_agent_events_until(type, deadline, [])
  end

  defp do_collect_agent_events_until(type, deadline, acc) do
    remaining = max(deadline - System.monotonic_time(:millisecond), 0)

    receive do
      {:agent_event, ^type, event} ->
        Enum.reverse([{type, event} | acc])

      {:agent_event, event_type, event} ->
        do_collect_agent_events_until(type, deadline, [{event_type, event} | acc])
    after
      remaining ->
        received =
          acc
          |> Enum.map(fn {event_type, _event} -> event_type end)
          |> Enum.reverse()

        flunk(
          "expected agent event #{inspect(type)} before timeout, received: #{inspect(received)}"
        )
    end
  end

  defp find_event!(events, type) do
    case Enum.find(events, fn {event_type, _event} -> event_type == type end) do
      {^type, event} -> event
      nil -> flunk("expected collected event #{inspect(type)}")
    end
  end

  defp continuation_next_step_decision(prompt) do
    prompt = prompt_text(prompt)

    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        NovelApplication.TestAgenticLoopFixtures.done_next("续写候选已生成并复核，本轮目标已经满足。")

      String.contains?(prompt, "prose_context /") ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "作者要求接着第01章继续写，按续写生成正文并复核。",
          "prose_writing",
          write_intent: "tentative",
          next_action_extra: %{
            "authoring_intent" => "continuation",
            "target_chapter" => "第01章：开端",
            "requested_chapter_raw" => "第01章"
          }
        )

      true ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "先读取正文写作上下文。",
          "context_assemble"
        )
    end
  end

  defp next_step_decision(prompt) do
    prompt = prompt_text(prompt)

    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        NovelApplication.TestAgenticLoopFixtures.done_next("已生成待采纳正文草稿并完成质量复核，本轮目标已经满足。")

      String.contains?(prompt, "prose_context /") ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "基于已读取的正文上下文生成正文草稿并完成质量复核。",
          "prose_writing",
          write_intent: "tentative",
          reason_codes: ["agentic_next_step", "prose_context_consumed"]
        )

      true ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "先读取正文写作上下文。",
          "context_assemble",
          reason_codes: ["agentic_next_step", "missing_prose_context"]
        )
    end
  end

  defp context do
    %DialogueContext{
      workspace_id: @work,
      current_chapters: ["第01章：开端"],
      structured_chapters: [
        %{
          title: "第01章：开端",
          seq: 1,
          summary: "主角第一次进入封闭空间。",
          has_prose: false,
          plan_direction: %{
            "chapter_role" => "开端",
            "plot_progress" => "主角进入异常房间并发现压力来源",
            "character_change" => "从被动观察转向主动寻找出口",
            "information_release" => "房间和旧公司实验有关",
            "foreshadowing_action" => "茶杯上有旧编号",
            "emotion" => "压抑、警觉"
          }
        }
      ],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end
end
