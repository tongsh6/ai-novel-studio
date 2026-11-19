defmodule NovelApplication.AgentRunCharacterDesignFlowTest do
  use NovelPersistence.DataCase, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunService
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.DialoguePlanningService
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelCommon.RequestIR
  alias NovelTest.TestProviderPrompt

  test "bounded roster-to-character-design run executes two re-gated steps and keeps artifact tentative" do
    parent = self()
    {:ok, prompts} = Agent.start_link(fn -> [] end)

    result_fn = agentic_result_fn(parent, prompts)
    provider_execution = %Execution{result_fn: result_fn}

    input = %{
      text: "  先看看当前已有角色，再帮我设计一个与主角形成镜像冲突的主要反派。R05ROSTERAUTHOR91\r\n",
      workspace_id: "work-agent-flow",
      work_id: "work-agent-flow",
      session_id: "11111111-1111-4111-8111-111111111118",
      turn_id: "turn-agent-flow",
      # B59 CP1：注入同形 trace persister，证明 AgentRun 内部步 trace 走既有持久化通道。
      trace_persister: fn work, attrs ->
        send(parent, {:step_trace, work, attrs})
        :ok
      end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        input,
        nil,
        provider_execution
      )

    next_step_planner =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        Map.put(input, :character_reader, fn _work_id -> characters() end),
        nil,
        provider_execution
      ).next_step_planner

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(planned.run_attrs, fn event ->
                 send(parent, {:agent_event, event.event_type, event})
               end),
               interaction_input: planned.interaction_input,
               next_step_planner: next_step_planner
             )

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive {:agent_event, :run_started, _}

    assert_receive {:agent_event, :exploration_observed, roster_event}
    assert roster_event.summary =~ "林烬"
    assert_receive {:provider_prompt, provider_prompt}, 500

    assert_roster_request(
      provider_prompt,
      input.work_id,
      "turn-agent-flow",
      input.text,
      "R05ROSTERAUTHOR91"
    )

    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :run_completed, _}, 500

    # B59 CP1：两个内部工具步各持久化一条 DecisionTrace（step turn_id + tool_trace_refs）。
    assert_receive {:step_trace, "work-agent-flow", trace_attrs}, 500
    assert trace_attrs.turn_id =~ ":agent:"
    assert trace_attrs.workspace_id == "work-agent-flow"
    assert trace_attrs.session_id == "11111111-1111-4111-8111-111111111118"
    assert is_list(trace_attrs.tool_trace_refs) and trace_attrs.tool_trace_refs != []
    assert_receive {:step_trace, "work-agent-flow", _}, 500

    # CP2b：机械步序不发 plan_drafted（无计划 run 的轨道 = judgment 事件链）。
    refute_receive {:agent_event, :plan_drafted, _}, 10

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert length(state.run.completed_step_refs) == 2
    assert state.run.consumed_budget.steps == 2
    assert state.run.consumed_budget.tool_calls == 2

    # CP2b：机械计划 0 调用（付费伪计划已消灭），只剩 design writer 1 调用。
    assert state.run.consumed_budget.provider_calls == 1
    TestAgenticLoopFixtures.assert_authoring_transcript(state, run_id)

    assert Enum.any?(state.observations, &(&1.observation_type == :character_roster))
    assert Enum.any?(state.observations, &(&1.observation_type == :artifact_created))

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id
    assert turn_result.tool_result.tool_name == "character_design"
    assert turn_result.truthfulness.artifact_adopted == false
    assert turn_result.truthfulness.production_write_performed == false
    assert [%{adoption_status: "TENTATIVE"}] = turn_result.adoption_state.pending
  end

  test "角色创作调用失败仍计入工具预算并保留原生失败历史" do
    parent = self()

    execution = %Execution{
      result_fn: fn _prompt ->
        {:error, %{type: :provider_error, message: "模型调用未完成"}}
      end
    }

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "先看看当前已有角色，再帮我设计反派。",
          workspace_id: "work-agent-failed-character",
          work_id: "work-agent-failed-character",
          session_id: "11111111-1111-4111-8111-111111111119",
          turn_id: "turn-agent-failed-character",
          character_reader: fn _work_id -> characters() end
        },
        nil,
        execution
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, fn event ->
                 send(parent, {:agent_event, event.event_type, event})
               end),
               interaction_input: spec.interaction_input,
               next_step_planner: spec.next_step_planner
             )

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive {:agent_event, :run_failed, _}, 2000
    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :failed
    assert state.run.consumed_budget.tool_calls == 2
    assert state.run.consumed_budget.provider_calls >= 1
    assert state.stage_state.judgment_transcript
  end

  test "原生候选校验最终失败后每个调用只保留一个拒绝结果" do
    parent = self()

    execution = %Execution{
      result_fn: fn _prompt ->
        {:ok,
         %{
           content: "",
           tool_calls: [
             %{
               id: "invalid-artifact-#{System.unique_integer([:positive])}",
               name: "submit_tentative_artifact",
               arguments: %{"items" => []}
             }
           ]
         }}
      end
    }

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        %{
          text: "先看看当前已有角色，再帮我设计反派。",
          workspace_id: "work-agent-invalid-character",
          work_id: "work-agent-invalid-character",
          session_id: "11111111-1111-4111-8111-111111111120",
          turn_id: "turn-agent-invalid-character",
          character_reader: fn _work_id -> characters() end
        },
        nil,
        execution
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, fn event ->
                 send(parent, {:agent_event, event.event_type, event})
               end),
               interaction_input: spec.interaction_input,
               next_step_planner: spec.next_step_planner
             )

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive {:agent_event, :run_failed, _}, 2000
    assert {:ok, state} = AgentRunService.state(run_id)
    transcript = state.stage_state.judgment_transcript
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert :ok = RequestIR.validate(ir)

    blocks = Enum.flat_map(transcript.messages, & &1.blocks)
    calls = Enum.filter(blocks, &(&1.type == "tool_call"))
    validations = Enum.filter(blocks, &(&1.type == "validation_result"))
    assert length(calls) == 2
    assert length(validations) == length(calls)
    assert Enum.all?(validations, &(&1.status == "failed"))

    assert Enum.sort(Enum.map(calls, & &1.call_id)) ==
             Enum.sort(Enum.map(validations, & &1.call_id))

    assert state.run.consumed_budget.tool_calls == 2
    assert state.run.consumed_budget.provider_calls == 2
  end

  test "steer updates the following character design step input" do
    parent = self()
    {:ok, work} = NovelPersistence.WorkRepo.create(%{title: "角色改向原文"})
    {:ok, session} = NovelPersistence.WorkSessionRepo.create(%{work_id: work.id})

    result_fn = agentic_result_fn(parent, nil)
    provider_execution = %Execution{result_fn: result_fn}

    input = %{
      text: "先看看当前已有角色，再帮我设计一个主要反派。",
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      turn_id: "turn-agent-steer",
      interaction_store: &NovelPersistence.InteractionLifecycle.call/2
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        input,
        nil,
        provider_execution
      )

    next_step_planner =
      DialoguePlanningService.run_spec_for_profile(
        :character_design_with_context,
        Map.put(input, :character_reader, fn _work_id ->
          send(parent, :roster_reader_started)
          Process.sleep(80)
          characters()
        end),
        nil,
        provider_execution
      ).next_step_planner

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(planned.run_attrs, fn event ->
                 send(parent, {:agent_event, event.event_type, event})
               end),
               interaction_input: planned.interaction_input,
               interaction_store: planned.interaction_store,
               next_step_planner: next_step_planner
             )

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive :roster_reader_started
    raw_steer = "  改成政治操盘者，不做武力型反派 Ω R05STEERGOAL91\n  "
    assert {:ok, _} = AgentRunService.steer(run_id, raw_steer)
    assert_receive {:agent_event, :plan_adjusted, _}
    assert_receive {:provider_prompt, provider_prompt}, 500

    assert %{
             source_refs: [%{ref: "turn-agent-steer:steer:2"}],
             blocks: [%{type: "text", text: ^raw_steer}]
           } =
             provider_prompt.messages
             |> Enum.filter(&(&1.role == "user" and &1.provenance == "author"))
             |> List.last()

    assert_roster_request(
      provider_prompt,
      work.id,
      "turn-agent-steer:steer:2",
      raw_steer,
      "R05STEERGOAL91"
    )
  end

  defp assert_roster_request(request, work_id, goal_ref, author_text, author_nonce) do
    assert :ok = RequestIR.validate(request)
    assert TestProviderPrompt.author_text(request) == author_text
    scope = TestProviderPrompt.scope_content(request)
    task = scope["authoring_task"]
    assert task["author_goal"] == %{"source_input_ref" => goal_ref}

    assert scope["operation"]["context_text"] =~
             "- 林烬（主角）：以底层债务驱动行动 R05ROSTERFACT91\n- 白玄（师父）：维持旧秩序的守门人"

    refute scope["operation"]["creative_brief"] =~ "R05ROSTERFACT91"
    refute Jason.encode!(scope) =~ author_nonce
    material_ref = "character_roster:work:" <> work_id

    assert [%{"ref" => ^material_ref}] =
             Enum.filter(task["materials"], &(&1["kind"] == "character_roster"))

    assert Enum.any?(request.refs.base_refs, &(&1.ref == material_ref))
    refute Enum.any?(request.refs.observation_refs, &(&1.ref == material_ref))

    for wire <- ~w(chat_completions responses_api anthropic_messages) do
      assert {:ok, body} = RequestIR.Projection.project(request, wire)
      encoded = Jason.encode!(body)
      assert length(String.split(encoded, "R05ROSTERFACT91")) == 2
      assert length(String.split(encoded, author_nonce)) == 2
    end
  end

  defp characters do
    [
      %{name: "林烬", role: "主角", summary: "以底层债务驱动行动 R05ROSTERFACT91"},
      %{name: "白玄", role: "师父", summary: "维持旧秩序的守门人"}
    ]
  end

  defp character_seed_item do
    %{
      "item_id" => "mirror-antagonist",
      "title" => "谢无衡",
      "body" => "政治操盘者，和林烬形成镜像冲突。",
      "rationale" => "以制度手段压迫主角的反向理想。"
    }
  end

  defp agentic_result_fn(parent, prompts) do
    fn prompt ->
      prompt_text = prompt_text(prompt)

      cond do
        String.contains?(prompt_text, "AgentRun 计划起草器") ->
          {:ok, character_design_plan_draft()}

        String.contains?(prompt_text, "AgentRun 下一步规划器") ->
          {:ok,
           %{
             content: TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
           }}

        Enum.any?(
          RequestIR.Tools.tool_specs(prompt),
          &(&1.name == "submit_tentative_artifact")
        ) ->
          complete_character_design_prompt(parent, prompts, prompt)

        true ->
          {:ok,
           %{
             content: TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
           }}
      end
    end
  end

  defp character_design_plan_draft do
    TestAgenticLoopFixtures.plan_tool_call_result(
      "先读取角色阵容，再基于阵容设计新的角色候选。",
      [
        TestAgenticLoopFixtures.plan_step(
          "character_roster",
          "character_roster",
          "读取当前作品已确认角色阵容。",
          success_criteria: ["character_roster_observation_exists"]
        ),
        TestAgenticLoopFixtures.plan_step(
          "character_design",
          "character_design",
          "基于已读取的角色阵容设计新的主要反派。",
          kind: "act",
          write_intent: "tentative",
          success_criteria: ["tentative_character_seed_created"]
        )
      ],
      reason_codes: ["agent_plan_drafted", "character_design_plan_drafted"]
    )
  end

  defp complete_character_design_prompt(parent, prompts, prompt) do
    if prompts, do: Agent.update(prompts, &[prompt | &1])
    send(parent, {:provider_prompt, prompt})

    {:ok, TestAgenticLoopFixtures.native_artifact_result([character_seed_item()])}
  end

  defp next_step_decision(prompt) do
    prompt = prompt_text(prompt)

    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        TestAgenticLoopFixtures.done_next("已生成待采纳角色候选，本轮目标已经满足。")

      String.contains?(prompt, "/ character_roster:") ->
        TestAgenticLoopFixtures.continue_next(
          "基于已读取的角色阵容设计新的主要反派。",
          "character_design",
          write_intent: "tentative",
          reason_codes: ["roster_observation_consumed"]
        )

      true ->
        TestAgenticLoopFixtures.continue_next(
          "先读取当前作品已确认角色阵容。",
          "character_roster",
          reason_codes: ["missing_roster_observation"]
        )
    end
  end

  defp prompt_text(prompt), do: TestAgenticLoopFixtures.prompt_text(prompt)
end
