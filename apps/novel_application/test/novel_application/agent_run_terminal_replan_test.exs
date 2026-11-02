defmodule NovelApplication.AgentRunTerminalReplanTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.{Execution, RequestIR}
  alias NovelApplication.AgentRunFlows.{JudgmentPlan, ReadonlyBatchContext}
  alias NovelApplication.{AgentRunService, AuthoringTranscript, TestAgenticLoopFixtures}
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.AgentPlan
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok = Sandbox.mode(Repo, {:shared, self()})
    :ok
  end

  for {flow, profile, target} <- [
        {JudgmentPlan, "judgment_plan_v1", "context_assemble"},
        {ReadonlyBatchContext, "readonly_batch_context_v1", "readonly_batch"}
      ] do
    test "#{profile} 修订没有剩余步骤时保留计划历史和开销，并诚实等待作者" do
      parent = self()
      run_id = "terminal-replan-#{System.unique_integer([:positive, :monotonic])}"
      attrs = run_attrs(run_id, unquote(profile), unquote(target))
      prior = prior_transcript(attrs)
      execution = revision_provider(parent, unquote(target))
      flow_planner = unquote(flow).next_step_planner(%{planner_provider_execution: execution})

      planner = fn run, sequence, snapshot ->
        snapshot =
          Map.put(snapshot, :stage_state, %{
            agent_plan_cursor: 1,
            judgment_transcript: prior
          })

        result = flow_planner.(run, sequence, snapshot)
        send(parent, {:terminal_plan_result, result})
        result
      end

      assert {:ok, ^run_id} =
               AgentRunService.start_bounded(attrs,
                 next_step_planner: planner,
                 event_sink: fn event -> send(parent, {:run_event, event.event_type, event}) end
               )

      on_exit(fn -> AgentRunService.cancel(run_id) end)
      assert_receive {:revision_request, _prompt}, 2_000
      assert_receive {:terminal_plan_result, {:await_author, decision, meta}}, 2_000
      assert decision.decision_type == :await_author
      assert %{plan_version: 2} = decision.plan_revision
      assert meta.provider_call_count == 1
      assert meta.agent_plan.version == 2

      assert meta.judgment_transcript.messages |> Enum.take(length(prior.messages)) ==
               prior.messages

      assert_receive {:run_event, :awaiting_author, event}, 2_000
      assert "plan_exhausted_without_completion" in event.reason_codes
      refute event.summary =~ "模型内部计划说明"

      assert {:ok, state} = AgentRunService.state(run_id)
      assert state.run.status == :awaiting_author
      assert state.run.plan_version == 2
      assert state.run.plan.version == 2
      assert state.run.consumed_budget.provider_calls == 1
      assert state.run.consumed_budget.replans == 1
      assert state.stage_state.judgment_transcript == meta.judgment_transcript
      assert {:ok, ir} = AuthoringTranscript.to_request_ir(state.stage_state.judgment_transcript)
      assert {:ok, []} = RequestIR.pending_call_ids(ir)
      refute_receive {:revision_request, _}, 20
      refute_receive {:run_event, :run_completed, _}, 20
    end
  end

  defp run_attrs(run_id, profile, target) do
    {:ok, plan} =
      AgentPlan.new(%{
        plan_id: "plan-#{run_id}",
        run_ref: run_id,
        version: 1,
        goal_version: 1,
        steps: [plan_step(target)]
      })

    work_id = Ecto.UUID.generate()

    %{
      run_id: run_id,
      workspace_id: work_id,
      work_id: work_id,
      session_id: Ecto.UUID.generate(),
      parent_turn_ref: "turn-#{run_id}",
      origin_frame_ref: "frame-#{run_id}",
      profile_ref: profile,
      goal: %{text: "已有核查尚未满足目标，请调整计划后继续。", version: 1},
      authority_scope: %{production_write: false, allowed_tools: [target]},
      plan: plan,
      plan_ref: plan.plan_id,
      plan_version: 1,
      completed_step_refs: ["step-1"],
      budget: %{
        max_steps: 5,
        max_provider_calls: 5,
        max_tool_calls: 5,
        max_replans: 1,
        max_pending_artifacts: 3
      }
    }
  end

  defp prior_transcript(attrs) do
    AuthoringTranscript.new(attrs,
      base_text: "计划是建议，实际操作仍需应用逐步授权。",
      author_text: attrs.goal.text,
      author_turn_ref: attrs.parent_turn_ref,
      projection: %{
        target: "chat_completions",
        capability_profile: Map.new(RequestIR.required_capabilities(), &{&1, true})
      }
    )
  end

  defp revision_provider(parent, target) do
    %Execution{
      result_fn: fn prompt ->
        send(parent, {:revision_request, prompt})
        narrative = "模型内部计划说明：当前没有可继续执行的新增步骤。"

        calls =
          TestAgenticLoopFixtures.native_tool_calls("agent_plan_revision", %{
            "plan" => %{"steps" => [plan_step(target)]},
            "author_reasoning" => narrative,
            "reason_codes" => ["agent_plan_revised"],
            "confidence" => 0.9
          })

        {:ok,
         %{
           content: narrative,
           tool_calls: calls,
           provider_output: %ProviderOutput{
             provider_run_ref: "terminal-replan-provider-run",
             provider_call_ref: "terminal-replan-provider-call",
             status: :ok,
             content: %{text: narrative, tool_calls: calls}
           }
         }}
      end
    }
  end

  defp plan_step(target) do
    %{
      "step_id" => "step-1",
      "kind" => "explore",
      "description" => "核对当前范围。",
      "success_criteria" => ["完成核对"],
      "target_tool_ref" => target,
      "write_intent" => "none"
    }
  end
end
