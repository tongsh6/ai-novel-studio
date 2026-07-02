defmodule NovelApplication.AgenticNextStepPlannerTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgenticNextStepPlanner
  alias NovelDomain.AgentRun

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
end
