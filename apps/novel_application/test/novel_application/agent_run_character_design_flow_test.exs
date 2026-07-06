defmodule NovelApplication.AgentRunCharacterDesignFlowTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService

  test "bounded roster-to-character-design run executes two re-gated steps and keeps artifact tentative" do
    parent = self()
    {:ok, prompts} = Agent.start_link(fn -> [] end)

    result_fn = agentic_result_fn(parent, prompts)
    provider_execution = %Execution{result_fn: result_fn}

    input = %{
      text: "先看看当前已有角色，再帮我设计一个与主角形成镜像冲突的主要反派。",
      workspace_id: "work-agent-flow",
      work_id: "work-agent-flow",
      session_id: "session-agent-flow",
      turn_id: "turn-agent-flow"
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
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    assert_receive {:agent_event, :plan_drafted, plan_event}, 500
    assert plan_event.refs != []

    assert [
             %{target_tool_ref: "character_roster"},
             %{target_tool_ref: "character_design"}
           ] = plan_event.payload.plan_steps

    assert_receive {:agent_event, :exploration_observed, roster_event}
    assert roster_event.summary =~ "林烬"
    assert_receive {:provider_prompt, provider_prompt}, 500
    assert provider_prompt =~ "已完成观察"
    assert provider_prompt =~ "林烬"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert length(state.run.completed_step_refs) == 2
    assert state.run.consumed_budget.steps == 2
    assert state.run.consumed_budget.tool_calls == 2
    assert state.run.consumed_budget.provider_calls == 3

    assert Enum.any?(state.observations, &(&1.observation_type == :character_roster))
    assert Enum.any?(state.observations, &(&1.observation_type == :artifact_created))

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id
    assert turn_result.tool_result.tool_name == "character_design"
    assert turn_result.truthfulness.artifact_adopted == false
    assert turn_result.truthfulness.production_write_performed == false
    assert [%{adoption_status: :tentative}] = turn_result.adoption_state.pending
  end

  test "steer updates the following character design step input" do
    parent = self()

    result_fn = agentic_result_fn(parent, nil)
    provider_execution = %Execution{result_fn: result_fn}

    input = %{
      text: "先看看当前已有角色，再帮我设计一个主要反派。",
      workspace_id: "work-agent-steer",
      work_id: "work-agent-steer",
      session_id: "session-agent-steer",
      turn_id: "turn-agent-steer"
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
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive :roster_reader_started
    assert :ok = AgentRunService.steer(run_id, "改成政治操盘者，不做武力型反派")
    assert_receive {:agent_event, :plan_adjusted, _}
    assert_receive {:provider_prompt, provider_prompt}, 500
    assert provider_prompt =~ "改成政治操盘者"
    assert provider_prompt =~ "已完成观察"
    assert provider_prompt =~ "林烬"
  end

  defp characters do
    [
      %{name: "林烬", role: "主角", summary: "以底层债务驱动行动"},
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
             content:
               NovelApplication.TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
           }}

        String.contains?(prompt_text, "JSON 数组") ->
          complete_character_design_prompt(parent, prompts, prompt)

        true ->
          {:ok,
           %{
             content:
               NovelApplication.TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
           }}
      end
    end
  end

  defp character_design_plan_draft do
    NovelApplication.TestAgenticLoopFixtures.plan_tool_call_result(
      "先读取角色阵容，再基于阵容设计新的角色候选。",
      [
        NovelApplication.TestAgenticLoopFixtures.plan_step(
          "character_roster",
          "character_roster",
          "读取当前作品已确认角色阵容。",
          success_criteria: ["character_roster_observation_exists"]
        ),
        NovelApplication.TestAgenticLoopFixtures.plan_step(
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
    {:ok, %{content: Jason.encode!([character_seed_item()])}}
  end

  defp next_step_decision(prompt) do
    prompt = prompt_text(prompt)

    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        NovelApplication.TestAgenticLoopFixtures.done_next("已生成待采纳角色候选，本轮目标已经满足。")

      String.contains?(prompt, "/ character_roster:") ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "基于已读取的角色阵容设计新的主要反派。",
          "character_design",
          write_intent: "tentative",
          reason_codes: ["roster_observation_consumed"]
        )

      true ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "先读取当前作品已确认角色阵容。",
          "character_roster",
          reason_codes: ["missing_roster_observation"]
        )
    end
  end

  defp prompt_text(prompt), do: NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)
end
