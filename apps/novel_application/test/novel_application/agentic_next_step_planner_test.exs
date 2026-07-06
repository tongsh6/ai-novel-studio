defmodule NovelApplication.AgenticNextStepPlannerTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgenticNextStepPlanner
  alias NovelDomain.{AgentObservation, AgentRun}

  test "planner prompt exposes capability options without restoring fixed profile rails" do
    parent = self()

    provider_execution = %Execution{
      result_fn: fn prompt ->
        send(parent, {:planner_prompt, prompt})

        {:ok,
         %{
           content:
             "先读取当前作品上下文。\n" <>
               Jason.encode!(%{
                 evaluation_of_last: %{
                   advanced: false,
                   plan_holds: true,
                   new_constraint: nil
                 },
                 decision: %{type: "continue"},
                 next_action: %{
                   target_tool_ref: "context_assemble",
                   write_intent: "none",
                   risk_hint: "low"
                 },
                 plan_revision: nil,
                 reason_codes: ["agentic_next_step", "context_needed"],
                 confidence: 0.8
               })
         }}
      end
    }

    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-agentic-prompt",
        workspace_id: "ws-agentic-prompt",
        work_id: "work-agentic-prompt",
        session_id: "session-agentic-prompt",
        parent_turn_ref: "turn-agentic-prompt",
        origin_frame_ref: "frame-agentic-prompt",
        profile_ref: "conversation_turn_v1",
        goal: %{text: "聊聊下一章该怎么推进", version: 1},
        authority_scope: %{
          production_write: false,
          allowed_tools: ["character_design", "plot_outline", "prose_writing"]
        }
      })

    assert {:ok, decision} =
             AgenticNextStepPlanner.next_decision(run, 1, [], provider_execution, %{
               stage_sink: fn _event -> :ok end,
               stage_state: %{context: %{refs: []}, frame: %{frame_id: "frame-1"}}
             })

    assert decision.target_tool_ref == "context_assemble"
    assert decision.evaluation_of_last.plan_holds == true
    assert decision.evaluation_of_last.advanced == false
    assert_receive {:planner_prompt, prompt}
    assert prompt =~ "先填写 evaluation_of_last"
    assert prompt =~ "\"evaluation_of_last\""
    assert prompt =~ "\"decision\""
    assert prompt =~ "\"next_action\""
    assert prompt =~ "## 可选下一步能力"
    assert prompt =~ "stage_state_keys: context, frame"
    assert prompt =~ "不要按能力列表顺序机械推进"
    assert prompt =~ "context_assemble | intent=读取当前作品上下文"
    refute prompt =~ "如果还没有创作上下文观察，下一步选择 context_assemble"
    refute prompt =~ "如果已经有创作上下文观察"
  end

  test "planner rejects decisions that skip evaluation_of_last" do
    provider_execution = %Execution{
      result_fn: fn _prompt ->
        {:ok,
         %{
           content:
             "先读取当前作品上下文。\n" <>
               Jason.encode!(%{
                 decision: %{type: "continue"},
                 next_action: %{
                   target_tool_ref: "context_assemble",
                   write_intent: "none",
                   risk_hint: "low"
                 },
                 reason_codes: ["agentic_next_step"],
                 confidence: 0.8
               })
         }}
      end
    }

    {:ok, run} = agent_run("run-agentic-eval-required")

    assert {:error, :evaluation_of_last_required} =
             AgenticNextStepPlanner.next_decision(run, 1, [], provider_execution, %{
               stage_sink: fn _event -> :ok end
             })
  end

  test "planner retries once with failed output when JSON tail is malformed" do
    parent = self()

    provider_execution = %Execution{
      result_fn: fn prompt ->
        call_count = Process.get(:planner_call_count, 0) + 1
        Process.put(:planner_call_count, call_count)
        send(parent, {:planner_prompt, call_count, prompt})

        content =
          if call_count == 1 do
            "先读取当前作品上下文。\n{\"evaluation_of_last\": }"
          else
            "先读取当前作品上下文。\n" <>
              Jason.encode!(%{
                evaluation_of_last: %{
                  advanced: false,
                  plan_holds: true,
                  new_constraint: nil
                },
                decision: %{type: "continue"},
                next_action: %{
                  target_tool_ref: "context_assemble",
                  write_intent: "none",
                  risk_hint: "low"
                },
                plan_revision: nil,
                reason_codes: ["agentic_next_step", "json_tail_retry_recovered"],
                confidence: 0.8
              })
          end

        {:ok, %{content: content}}
      end
    }

    {:ok, run} = agent_run("run-agentic-json-retry")

    assert {:ok, decision, %{provider_call_count: 2}} =
             AgenticNextStepPlanner.next_decision_with_meta(run, 1, [], provider_execution, %{
               stage_sink: fn _event -> :ok end
             })

    assert decision.target_tool_ref == "context_assemble"
    assert "json_tail_retry_recovered" in decision.reason_codes

    assert_receive {:planner_prompt, 1, first_prompt}
    assert_receive {:planner_prompt, 2, retry_prompt}
    assert first_prompt =~ "AgentRun 下一步规划器"
    assert retry_prompt =~ "上一次的 AgentRun 下一步规划输出无法被系统解析"
    assert retry_prompt =~ "{\"evaluation_of_last\": }"
    assert retry_prompt =~ "## 原始任务"
  end

  test "planner prompt includes compact structured payload for recent observations" do
    parent = self()

    provider_execution = %Execution{
      result_fn: fn prompt ->
        send(parent, {:planner_prompt, prompt})

        {:ok,
         %{
           content:
             "已有正文候选，停止本轮。\n" <>
               Jason.encode!(%{
                 evaluation_of_last: %{advanced: true, plan_holds: true, new_constraint: nil},
                 decision: %{type: "done"},
                 next_action: %{
                   target_tool_ref: nil,
                   write_intent: "none",
                   risk_hint: "low"
                 },
                 plan_revision: nil,
                 reason_codes: ["agentic_next_step", "artifact_created"],
                 confidence: 0.9
               })
         }}
      end
    }

    {:ok, run} = agent_run("run-agentic-observation-payload")

    {:ok, observation} =
      AgentObservation.new(%{
        observation_id: "obs-payload-1",
        run_ref: run.run_id,
        step_ref: "step-payload-1",
        observation_type: :artifact_created,
        source_ref: "tool_result:tr-payload-1",
        summary: "已生成 1 个待采纳正文草稿。",
        structured_payload: %{
          artifact_refs: ["as-payload-1"],
          quality_review: %{review_status: "completed", finding_count: 0}
        },
        evidence_refs: ["tool_result:tr-payload-1", "artifact:as-payload-1"]
      })

    assert {:ok, decision} =
             AgenticNextStepPlanner.next_decision(run, 2, [observation], provider_execution, %{
               stage_sink: fn _event -> :ok end
             })

    assert decision.decision_type == :goal_satisfied

    assert_receive {:planner_prompt, prompt}
    assert prompt =~ "obs-payload-1 / artifact_created"
    assert prompt =~ "payload:"
    assert prompt =~ "artifact_refs"
    assert prompt =~ "as-payload-1"
    assert prompt =~ "quality_review"
    assert prompt =~ "finding_count"
  end

  test "planner streams author reasoning with author_reasoning provider purpose" do
    parent = self()
    provider_execution = Execution.dependency(provider: :stub, purpose: :conversation)
    {:ok, run} = agent_run("run-agentic-author-reasoning-purpose")

    assert {:ok, decision} =
             AgenticNextStepPlanner.next_decision(run, 1, [], provider_execution, %{
               stage_sink: fn event -> send(parent, {:stage_event, event}) end
             })

    assert decision.target_tool_ref == "context_assemble"

    stage_events = flush_stage_events([])

    author_delta_event =
      Enum.find(stage_events, fn event ->
        event.event_type == :provider_progress and event.visibility == :author and
          event.payload[:purpose] == "author_reasoning" and
          is_binary(event.payload[:author_narrative_delta])
      end)

    assert author_delta_event
    assert author_delta_event.payload.author_narrative_delta =~ "[stub]"
    refute author_delta_event.payload.author_narrative_delta =~ "evaluation_of_last"
  end

  test "planner requires replan decision when plan_holds is false" do
    provider_execution = %Execution{
      result_fn: fn _prompt ->
        {:ok,
         %{
           content:
             "章节前提已经变化，先重新读取上下文。\n" <>
               Jason.encode!(%{
                 evaluation_of_last: %{
                   advanced: true,
                   plan_holds: false,
                   new_constraint: "章节前提已经变化。"
                 },
                 decision: %{type: "continue"},
                 next_action: %{
                   target_tool_ref: "context_assemble",
                   write_intent: "none",
                   risk_hint: "low"
                 },
                 plan_revision: %{
                   plan_version: 2,
                   revision_reason: "章节前提已经变化。"
                 },
                 reason_codes: ["agentic_next_step"],
                 confidence: 0.8
               })
         }}
      end
    }

    {:ok, run} = agent_run("run-agentic-replan-required")

    assert {:error, :plan_holds_false_requires_replan_decision} =
             AgenticNextStepPlanner.next_decision(run, 1, [], provider_execution, %{
               stage_sink: fn _event -> :ok end
             })
  end

  defp agent_run(run_id) do
    AgentRun.new(%{
      run_id: run_id,
      workspace_id: "ws-#{run_id}",
      work_id: "work-#{run_id}",
      session_id: "session-#{run_id}",
      parent_turn_ref: "turn-#{run_id}",
      origin_frame_ref: "frame-#{run_id}",
      profile_ref: "conversation_turn_v1",
      goal: %{text: "聊聊下一章该怎么推进", version: 1},
      authority_scope: %{
        production_write: false,
        allowed_tools: ["character_design", "plot_outline", "prose_writing"]
      }
    })
  end

  defp flush_stage_events(acc) do
    receive do
      {:stage_event, event} -> flush_stage_events([event | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end

  test "prose profile prompt carries authoring intent rules and chapter list; decision carries writing coordinate fields" do
    parent = self()

    provider_execution = %Execution{
      result_fn: fn prompt ->
        send(parent, {:planner_prompt, prompt})

        {:ok,
         %{
           content:
             "作者要求接着第01章继续写，选择正文写作并按续写处理。\n" <>
               Jason.encode!(%{
                 evaluation_of_last: %{advanced: true, plan_holds: true, new_constraint: nil},
                 decision: %{type: "continue"},
                 next_action: %{
                   target_tool_ref: "prose_writing",
                   write_intent: "tentative",
                   risk_hint: "low",
                   authoring_intent: "continuation",
                   target_chapter: "第01章：底层灵气账单",
                   requested_chapter_raw: "第01章"
                 },
                 plan_revision: nil,
                 reason_codes: ["agentic_next_step"],
                 confidence: 0.9
               })
         }}
      end
    }

    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-prose-authoring",
        workspace_id: "ws-prose-authoring",
        work_id: "work-prose-authoring",
        session_id: "session-prose-authoring",
        parent_turn_ref: "turn-prose-authoring",
        origin_frame_ref: "frame-prose-authoring",
        profile_ref: "prose_drafting_with_quality_v1",
        goal: %{text: "接着第01章往下写一段正文", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    context = %NovelDomain.DialogueContext{
      workspace_id: "ws-prose-authoring",
      current_chapters: ["第01章：底层灵气账单", "第02章：旧服务器里的残诀"]
    }

    assert {:ok, decision} =
             AgenticNextStepPlanner.next_decision(run, 2, [], provider_execution, %{
               stage_sink: fn _event -> :ok end,
               stage_state: %{context: context}
             })

    assert decision.target_tool_ref == "prose_writing"
    assert decision.authoring_intent == :continuation
    assert decision.target_chapter == "第01章：底层灵气账单"
    assert decision.requested_chapter_raw == "第01章"

    assert_receive {:planner_prompt, prompt}
    assert prompt =~ "## 正文写作意图与目标章"
    assert prompt =~ "authoring_intent = \"continuation\""
    assert prompt =~ "### 作品章节"
    assert prompt =~ "- 第01章：底层灵气账单"
    assert prompt =~ "- 第02章：旧服务器里的残诀"
    assert prompt =~ "\"requested_chapter_raw\""
  end

  test "non-prose profile prompt has no authoring intent section and fields default nil" do
    parent = self()

    provider_execution = %Execution{
      result_fn: fn prompt ->
        send(parent, {:planner_prompt, prompt})

        {:ok,
         %{
           content:
             "先读取当前作品上下文。\n" <>
               Jason.encode!(%{
                 evaluation_of_last: %{advanced: false, plan_holds: true, new_constraint: nil},
                 decision: %{type: "continue"},
                 next_action: %{
                   target_tool_ref: "context_assemble",
                   write_intent: "none",
                   risk_hint: "low"
                 },
                 plan_revision: nil,
                 reason_codes: ["agentic_next_step"],
                 confidence: 0.8
               })
         }}
      end
    }

    {:ok, run} = agent_run("conv-no-authoring")

    assert {:ok, decision} =
             AgenticNextStepPlanner.next_decision(run, 1, [], provider_execution, %{
               stage_sink: fn _event -> :ok end
             })

    assert decision.authoring_intent == nil
    assert decision.target_chapter == nil
    assert decision.requested_chapter_raw == nil

    assert_receive {:planner_prompt, prompt}
    refute prompt =~ "## 正文写作意图与目标章"
  end

  test "prose profile prompt without assembled context points planner to context_assemble first" do
    parent = self()

    provider_execution = %Execution{
      result_fn: fn prompt ->
        send(parent, {:planner_prompt, prompt})

        {:ok,
         %{
           content:
             "先读取正文写作上下文。\n" <>
               Jason.encode!(%{
                 evaluation_of_last: %{advanced: false, plan_holds: true, new_constraint: nil},
                 decision: %{type: "continue"},
                 next_action: %{
                   target_tool_ref: "context_assemble",
                   write_intent: "none",
                   risk_hint: "low"
                 },
                 plan_revision: nil,
                 reason_codes: ["agentic_next_step"],
                 confidence: 0.8
               })
         }}
      end
    }

    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-prose-no-context",
        workspace_id: "ws-prose-no-context",
        work_id: "work-prose-no-context",
        session_id: "session-prose-no-context",
        parent_turn_ref: "turn-prose-no-context",
        origin_frame_ref: "frame-prose-no-context",
        profile_ref: "prose_drafting_with_quality_v1",
        goal: %{text: "接着往下写", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]}
      })

    assert {:ok, _decision} =
             AgenticNextStepPlanner.next_decision(run, 1, [], provider_execution, %{
               stage_sink: fn _event -> :ok end
             })

    assert_receive {:planner_prompt, prompt}
    assert prompt =~ "当前尚未读取作品章节列表"
  end
end
