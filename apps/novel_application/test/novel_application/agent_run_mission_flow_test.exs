defmodule NovelApplication.AgentRunMissionFlowTest do
  use NovelPersistence.DataCase, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunService
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelCommon.RequestIR

  @prose_work "work-agent-prose-flow"
  @planning_work "work-agent-outline-flow"

  for {correction, response_sequence, expected_statuses, expected_missions, expected_degraded?} <-
        [
          {:accepted, [:rejected, :accepted], ["failed", "passed"], 1, false},
          {:exhausted, [:rejected, :rejected], ["failed", "failed"], 0, true}
        ] do
    test "R06 prose #{correction}: 拒收使命无坏写入或发布，两次封顶后仍可合法写作" do
      correction = unquote(correction)
      response_sequence = unquote(response_sequence)
      expected_missions = unquote(expected_missions)
      expected_degraded? = unquote(expected_degraded?)
      expected_statuses = unquote(expected_statuses)
      parent = self()
      {:ok, attempts} = Agent.start_link(fn -> 0 end)
      reasoning = " \n先让主角兑现选择，再保留房间来历的悬念。Ω\r\n"
      statement = "\t主角主动找到出口。\r\n"
      advance = "  让主角主动寻找出口。\n"
      avoid = "\n暂不解释房间来历。\t"

      writer = fn prompt ->
        cond do
          Enum.any?(RequestIR.Tools.tool_specs(prompt), &(&1.name == "chapter_mission")) ->
            attempt = Agent.get_and_update(attempts, &{&1 + 1, &1 + 1})
            assert attempt <= 2
            response = Enum.fetch!(response_sequence, attempt - 1)

            result =
              TestAgenticLoopFixtures.mission_tool_call_result(
                reasoning,
                Map.fetch!(%{accepted: statement, rejected: "本章先读取 chapter:22660419。"}, response),
                must_advance: [%{"text" => advance, "basis_ref" => "plan:1:plot_progress"}],
                must_avoid: [%{"text" => avoid, "basis_ref" => "plan:1:information_release"}]
              )

            {:ok, Map.put(result, :provider_call_id, "pc-r06-prose-mission-#{attempt}")}

          Enum.any?(RequestIR.Tools.tool_specs(prompt), &(&1.name == "agent_plan_draft")) ->
            {:ok,
             Map.put(
               TestAgenticLoopFixtures.prose_plan_draft(prompt),
               :provider_call_id,
               "pc-r06-prose-plan"
             )}

          TestAgenticLoopFixtures.prompt_text(prompt) =~ "AgentRun 下一步规划器" ->
            {:ok,
             %{
               content:
                 TestAgenticLoopFixtures.reasoning_tail(
                   TestAgenticLoopFixtures.prose_next_step_decision(prompt)
                 )
             }}

          true ->
            send(parent, {:r06_writer_prompt, prompt})

            {:ok,
             TestAgenticLoopFixtures.native_artifact_result(
               [
                 %{
                   item_id: "r06-prose",
                   title: "第01章：开端",
                   body: TestAgenticLoopFixtures.prose_drafting_body(),
                   rationale: nil
                 }
               ],
               provider_call_id: "pc-r06-prose-writer"
             )}
        end
      end

      evaluator = fn _prompt ->
        {:ok,
         %{
           content: "",
           provider_call_id: "pc-r06-prose-quality",
           tool_calls:
             TestAgenticLoopFixtures.native_tool_calls("report_quality_findings", %{findings: []})
         }}
      end

      input =
        TestAgenticLoopFixtures.prose_drafting_input(
          @prose_work,
          %{
            turn_id: "turn-r06-prose-#{correction}",
            ledger_reader: fn _ -> [] end,
            written_progress_reader: fn _ -> nil end,
            quality_provider_execution: %Execution{result_fn: evaluator},
            chapter_mission_writer: fn _, _, mission ->
              send(parent, {:r06_mission_persisted, mission})
              {:ok, :stored, mission}
            end
          }
        )

      planned =
        DialoguePlanningService.run_spec_for_profile(
          :prose_drafting_with_quality,
          input,
          TestAgenticLoopFixtures.prose_drafting_context(@prose_work),
          %Execution{result_fn: writer}
        )

      assert {:ok, run_id} =
               AgentRunService.start_bounded(
                 NovelApplication.TestAgentEventRelay.observe(planned.run_attrs, fn event ->
                   send(parent, {:agent_event, event.event_type, event})
                 end),
                 interaction_input: planned.interaction_input,
                 interaction_store: planned.interaction_store,
                 next_step_planner: planned.next_step_planner
               )

      _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

      events =
        NovelApplication.TestAgentEventRelay.collect_agent_events_until(:run_completed, 5_000)

      assert Agent.get(attempts, & &1) == 2
      assert_received {:r06_writer_prompt, _}
      assert NovelApplication.TestAssertions.find_event!(events, :artifact_created)
      assert {:ok, state} = AgentRunService.state(run_id)
      assert state.run.status == :completed
      assert length(state.final_turn_result.adoption_state.pending) == 1

      mission_events = for {:mission_derived, event} <- events, do: event
      mission = state.stage_state.chapter_mission

      assert length(mission_events) == expected_missions

      for event <- mission_events do
        assert event.payload.author_narrative == reasoning
        assert event.payload.author_narrative_source.provider_call_ref == "pc-r06-prose-mission-2"

        assert event.payload.author_narrative_source.source_type ==
                 "provider_output_tool_narrative"

        assert event.payload.author_narrative_source.source_byte_range == %{
                 start: 0,
                 length: byte_size(reasoning)
               }

        assert_received {:r06_mission_persisted, persisted}
        assert persisted["statement"] == statement
        assert hd(persisted["must_advance"])["text"] == advance
        assert hd(persisted["must_avoid"])["text"] == avoid
        assert state.final_turn_result.trace_summary.chapter_mission["statement"] == statement
      end

      refute_received {:r06_mission_persisted, _}
      assert !!mission["degraded"] == expected_degraded?
      assert mission["statement"] == List.first(Enum.take([statement], expected_missions))

      assert Enum.any?(state.observations, fn observation ->
               observation.structured_payload[:stage] == :mission_degraded
             end) == expected_degraded?

      transcript = state.stage_state.judgment_transcript

      calls =
        for message <- transcript.messages,
            block <- message.blocks,
            block.type == "tool_call" and block.name == "chapter_mission",
            do: block.call_id

      assert length(calls) == 2

      statuses =
        for message <- transcript.messages,
            block <- message.blocks,
            block.type == "validation_result" and block.call_id in calls,
            do: block.status

      assert statuses == expected_statuses

      assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
      assert {:ok, []} = RequestIR.pending_call_ids(ir)
    end
  end

  for {correction, response_sequence, expected_statuses, expected_missions, expected_degraded?} <-
        [
          {:accepted, [:rejected, :accepted], ["failed", "passed"], 1, false},
          {:exhausted, [:rejected, :rejected], ["failed", "failed"], 0, true}
        ] do
    test "R06 planning #{correction}: 拒收使命无坏写入或发布，两次封顶后仍可合法规划" do
      correction = unquote(correction)
      response_sequence = unquote(response_sequence)
      expected_missions = unquote(expected_missions)
      expected_degraded? = unquote(expected_degraded?)
      expected_statuses = unquote(expected_statuses)
      parent = self()
      {:ok, attempts} = Agent.start_link(fn -> 0 end)
      {:ok, observed_events} = Agent.start_link(fn -> [] end)
      reasoning = " \n先收束当前支线，再安排人物承担选择的代价。Ω\r\n"
      statement = "\t本轮先收束既有支线。\r\n"
      advance = "  延续矿区旧债的压力。\n"
      avoid = "\n暂不引入新的主导冲突。\t"

      provider = %Execution{
        result_fn: fn prompt ->
          if Enum.any?(RequestIR.Tools.tool_specs(prompt), &(&1.name == "planning_mission")) do
            attempt = Agent.get_and_update(attempts, &{&1 + 1, &1 + 1})
            assert attempt <= 2
            response = Enum.fetch!(response_sequence, attempt - 1)

            {:ok,
             %{
               content: "",
               provider_call_id: "pc-r06-planning-mission-#{attempt}",
               tool_calls:
                 TestAgenticLoopFixtures.native_tool_calls("planning_mission", %{
                   author_reasoning:
                     Map.fetch!(
                       %{accepted: reasoning, rejected: "先读取 chapter:22660419。"},
                       response
                     ),
                   statement: statement,
                   must_advance: [%{text: advance, basis_ref: "plan:0:summary"}],
                   must_avoid: [%{text: avoid, basis_ref: "plan:0:summary"}],
                   confidence: 0.9
                 })
             }}
          else
            send(parent, {:r06_planning_writer_prompt, prompt})

            {:ok,
             TestAgenticLoopFixtures.native_artifact_result(
               [
                 %{
                   item_id: "r06-outline",
                   title: "第01章：旧债",
                   body: "主角在矿区旧债里承担第一次选择的代价。",
                   rationale: nil
                 }
               ],
               provider_call_id: "pc-r06-planning-writer"
             )}
          end
        end
      }

      input = %{
        text: "请继续规划后续章节。",
        workspace_id: @planning_work,
        work_id: @planning_work,
        session_id: "11111111-1111-4111-8111-111111111118",
        turn_id: "turn-r06-planning-#{correction}",
        ledger_reader: fn _ -> [] end,
        written_progress_reader: fn _ -> nil end,
        character_reader: fn _ -> [] end,
        planning_mission_reader: fn _ -> nil end,
        planning_mission_writer: fn _, mission ->
          send(parent, {:r06_planning_persisted, mission})
          {:ok, :stored, mission}
        end
      }

      planned =
        DialoguePlanningService.run_spec_for_profile(
          :plot_outline_with_context,
          input,
          TestAgenticLoopFixtures.plot_outline_context(@planning_work),
          provider
        )

      assert {:ok, run_id} =
               AgentRunService.start_bounded(
                 NovelApplication.TestAgentEventRelay.observe(planned.run_attrs, fn event ->
                   Agent.update(observed_events, &[event | &1])
                   send(parent, {:r06_planning_event, event.event_type})
                 end),
                 interaction_input: planned.interaction_input,
                 next_step_planner: planned.next_step_planner
               )

      NovelApplication.TestAgentRunCleanup.register_run(run_id)
      assert_receive {:r06_planning_event, :run_completed}, 5_000
      events = Agent.get(observed_events, &Enum.reverse/1)
      assert Agent.get(attempts, & &1) == 2
      assert_received {:r06_planning_writer_prompt, _}
      assert Enum.any?(events, &(&1.event_type == :artifact_created))
      assert {:ok, state} = AgentRunService.state(run_id)
      assert state.run.status == :completed
      assert state.run.consumed_budget.provider_calls == 3
      assert length(state.final_turn_result.adoption_state.pending) == 1

      mission_events = Enum.filter(events, &(&1.event_type == :mission_derived))
      mission = state.stage_state.planning_mission

      assert length(mission_events) == expected_missions

      for event <- mission_events do
        assert event.payload.author_narrative == reasoning

        assert event.payload.author_narrative_source.provider_call_ref ==
                 "pc-r06-planning-mission-2"

        assert event.payload.author_narrative_source.source_type ==
                 "provider_output_tool_narrative"

        assert event.payload.author_narrative_source.source_byte_range == %{
                 start: 0,
                 length: byte_size(reasoning)
               }

        assert_received {:r06_planning_persisted, persisted}
        assert persisted["statement"] == statement
        assert hd(persisted["must_advance"])["text"] == advance
        assert hd(persisted["must_avoid"])["text"] == avoid
        assert state.final_turn_result.trace_summary.planning_mission["statement"] == statement
      end

      refute_received {:r06_planning_persisted, _}
      assert !!mission["degraded"] == expected_degraded?
      assert mission["statement"] == List.first(Enum.take([statement], expected_missions))

      assert Enum.any?(state.observations, fn observation ->
               observation.structured_payload[:stage] == :mission_degraded
             end) == expected_degraded?

      transcript = state.stage_state.judgment_transcript

      calls =
        for message <- transcript.messages,
            block <- message.blocks,
            block.type == "tool_call" and block.name == "planning_mission",
            do: block.call_id

      assert length(calls) == 2

      statuses =
        for message <- transcript.messages,
            block <- message.blocks,
            block.type == "validation_result" and block.call_id in calls,
            do: block.status

      assert statuses == expected_statuses

      assert {:ok, ir} = NovelApplication.AuthoringTranscript.to_request_ir(transcript)
      assert {:ok, []} = RequestIR.pending_call_ids(ir)
    end
  end
end
