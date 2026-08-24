defmodule NovelApplication.AgentRunPlotOutlineFlowTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunFlows.PlotOutlineWithContext
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext

  @work "work-agent-outline-flow"

  test "bounded plot outline run uses a model-drafted plan before context and outline execution" do
    parent = self()

    result_fn = fn prompt ->
      cond do
        # WR02：规划前推理步（一条依据在材料内、一条越界必须被丢弃）。
        prompt_contains?(prompt, "规划前推理器") ->
          send(parent, {:planning_mission_prompt, prompt})

          {:ok,
           %{
             provider_call_id: "pc-agent-outline-mission",
             content: "我核对了账面与进度：先给超期伏笔安排回收。",
             tool_calls: [
               %{
                 "name" => "planning_mission",
                 "arguments" => %{
                   "author_reasoning" => "我核对了账面与进度：先给超期伏笔安排回收。",
                   "statement" => "接下来的章节必须给超期伏笔安排回收。",
                   "must_advance" => [
                     %{"text" => "给旧账伏笔安排回收章", "basis_ref" => "ledger:information:foreshadow_a"},
                     %{"text" => "越界依据", "basis_ref" => "ledger:information:foreshadow_unlisted"}
                   ],
                   "must_avoid" => [
                     %{"text" => "先别动第00章既定开局", "basis_ref" => "plan:0:summary"}
                   ],
                   "confidence" => 0.9
                 }
               }
             ]
           }}

        plan_draft_prompt?(prompt) ->
          {:ok, Map.put(plot_outline_plan_draft(), :provider_call_id, "pc-agent-outline-planner")}

        prompt_contains?(prompt, "AgentRun 下一步规划器") ->
          {:ok,
           %{
             content:
               NovelApplication.TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
           }}

        true ->
          send(parent, {:provider_prompt, prompt})

          {:ok,
           %{
             provider_call_id: "pc-agent-outline-writer",
             content:
               Jason.encode!([
                 %{
                   "item_id" => "outline-chapter-01",
                   "title" => "第01章：债务入场",
                   "body" => "林烬在矿区债务纠纷中第一次看见旧秩序的裂缝。",
                   "rationale" => "建立主角压力与世界矛盾。"
                 }
               ])
           }}
      end
    end

    input = %{
      text: "请基于当前作品规划十二章章节大纲。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-outline-flow",
      turn_id: "turn-agent-outline-flow",
      ledger_reader: fn _work_id ->
        [
          %{
            id: "le_a",
            ledger: "information",
            subject_ref: "foreshadow_a",
            subject_label: "伏笔：旧账",
            status: "HIDDEN",
            payload: %{"planned_reveal" => %{"kind" => "chapter", "seq" => 1}}
          }
        ]
      end,
      written_progress_reader: fn _work_id -> %{chapter_seq: 2, volume_seq: 1} end,
      character_reader: fn _work_id -> [] end,
      # WR01c：暂定落库写端口（捕获替身，作者版读端口缺席 → 走模型推导）。
      planning_mission_reader: fn _work_id -> nil end,
      planning_mission_writer: fn work_id, mission_map ->
        send(parent, {:planning_mission_persisted, work_id, mission_map})
        {:ok, :stored, mission_map}
      end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :plot_outline_with_context,
        input,
        context(),
        %Execution{result_fn: result_fn}
      )

    assert planned.run_attrs.profile_ref == PlotOutlineWithContext.profile_ref()

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_started, _}
    # CP2b：机械步序不发 plan_drafted（付费伪计划已消灭），
    # 无计划 run 的轨道 = judgment 事件链。

    assert_receive {:agent_event, :goal_understood, context_event}, 500
    assert context_event.summary =~ "章节大纲规划上下文"
    assert_receive {:agent_event, :exploration_observed, context_observation}, 500
    assert context_observation.summary =~ "已组装章节大纲规划上下文"
    assert_receive {:agent_event, :evaluation_made, context_decision}, 500
    assert "agent_step_evaluated" in context_decision.reason_codes

    # WR02：规划前推理步——模型原话进作者可见事件，依据越界条目被机械丢弃。
    assert_receive {:planning_mission_prompt, mission_prompt}, 1_000
    assert prompt_text(mission_prompt) =~ "本轮规划（按当前进度态推导接下来该规划什么）"
    assert prompt_text(mission_prompt) =~ "[ledger:information:foreshadow_a]"
    assert prompt_text(mission_prompt) =~ "[plan:0:summary]"
    assert_receive {:agent_event, :mission_derived, mission_event}, 1_000
    assert mission_event.payload.author_narrative =~ "先给超期伏笔安排回收"
    assert mission_event.payload.dropped_unbound_count == 1

    assert mission_event.payload.basis_refs == [
             "ledger:information:foreshadow_a",
             "plan:0:summary"
           ]

    assert_receive {:agent_event, :exploration_observed, mission_observation}, 500
    assert mission_observation.summary =~ "已完成规划前推理"
    assert_receive {:agent_event, :evaluation_made, mission_decision}, 500
    assert "agent_step_evaluated" in mission_decision.reason_codes

    assert_receive {:agent_event, :evaluation_made, plan_event}, 500
    assert "agent_step_evaluated" in plan_event.reason_codes
    assert plan_event.payload.target_tool_ref == "plot_outline"
    assert_receive {:agent_event, :gate_decided, gate_event}, 500
    assert gate_event.summary =~ "系统已完成下一步执行裁决"
    assert_receive {:agent_event, :tool_started, tool_started}, 500
    assert tool_started.summary =~ "章节大纲规划能力"
    assert_receive {:provider_prompt, provider_prompt}, 500
    assert provider_prompt =~ "当前 AgentStep"
    assert provider_prompt =~ "章节大纲"
    # WR02：使命结论进规划 prompt（紧跟账面摘要段），越界条目不得出现。
    assert provider_prompt =~ "## 本轮规划使命（写前推理，按账面与进度）"
    assert provider_prompt =~ "本轮规划使命：接下来的章节必须给超期伏笔安排回收。"
    assert provider_prompt =~ "· 必须推进：给旧账伏笔安排回收章"
    refute provider_prompt =~ "越界依据"
    assert_receive {:agent_event, :tool_completed, tool_completed}, 500
    assert tool_completed.summary =~ "章节大纲草稿已生成"
    assert_receive {:agent_event, :exploration_observed, tool_observation}, 500
    assert tool_observation.summary =~ "待采纳大纲草稿"

    assert_receive {:agent_event, :exploration_observed, artifact_observation}, 500
    assert artifact_observation.summary =~ "大纲草稿"
    assert_receive {:agent_event, :artifact_created, artifact_event}, 500
    assert_receive {:agent_event, :evaluation_made, outline_decision}, 500
    assert outline_decision.payload.loop_decision_type == :goal_satisfied
    assert_receive {:agent_event, :run_completed, _}, 500

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed

    # WR02：context + planning_mission + plot_outline 三步；推理 1 调用 + writer 1 调用。
    assert length(state.run.completed_step_refs) == 3
    assert state.run.consumed_budget.steps == 3
    assert state.run.consumed_budget.tool_calls == 1
    assert state.run.consumed_budget.provider_calls == 2
    assert Enum.any?(state.observations, &(&1.observation_type == :artifact_created))

    turn_result = artifact_event.payload.turn_result
    assert turn_result.agent_run.run_id == run_id
    assert turn_result.agent_run.profile_ref == "plot_outline_with_context_v1"
    assert turn_result.tool_result.tool_name == "plot_outline"
    assert turn_result.tool_result.output.artifact_type == :outline_draft
    assert turn_result.truthfulness.artifact_adopted == false
    assert turn_result.truthfulness.production_write_performed == false
    refute Map.has_key?(turn_result, :quality_review)

    assert [%{adoption_status: :tentative, artifact_type: :outline_draft}] =
             turn_result.adoption_state.pending

    assert turn_result.trace_summary.writer_provider_call_ref == "pc-agent-outline-writer"
    assert turn_result.trace_summary.planning_mission_ref =~ "mission:cm_"
    assert turn_result.trace_summary.planning_mission_statement == "接下来的章节必须给超期伏笔安排回收。"

    # WR01c：why 面板结构化 payload（statement+逐条+依据标签，越界条目不出现）。
    payload = turn_result.trace_summary.planning_mission
    assert payload["statement"] == "接下来的章节必须给超期伏笔安排回收。"
    assert [%{"text" => "给旧账伏笔安排回收章"} = advance] = payload["must_advance"]
    assert is_binary(advance["basis_label"])
    refute inspect(payload) =~ "越界依据"

    # WR01c：推理成功即落暂定（写端口收到 persisted_map）。
    assert_receive {:planning_mission_persisted, @work, persisted_map}, 500
    assert persisted_map["statement"] == "接下来的章节必须给超期伏笔安排回收。"
    assert turn_result.trace_summary.provider_call_budget.writer == 1
    assert turn_result.trace_summary.provider_call_budget.evaluator == 0
  end

  test "author-edited planning mission is used directly with zero mission provider calls (WR01c)" do
    parent = self()

    result_fn = fn prompt ->
      cond do
        prompt_contains?(prompt, "规划前推理器") ->
          send(parent, {:planning_mission_prompt, prompt})
          {:error, :must_not_call_mission_model}

        plan_draft_prompt?(prompt) ->
          {:ok, Map.put(plot_outline_plan_draft(), :provider_call_id, "pc-author-outline-planner")}

        prompt_contains?(prompt, "AgentRun 下一步规划器") ->
          {:ok,
           %{
             content:
               NovelApplication.TestAgenticLoopFixtures.reasoning_tail(next_step_decision(prompt))
           }}

        true ->
          send(parent, {:provider_prompt, prompt})

          {:ok,
           %{
             provider_call_id: "pc-author-outline-writer",
             content:
               Jason.encode!([
                 %{
                   "item_id" => "outline-author-01",
                   "title" => "第01章：收束支线",
                   "body" => "按作者要求收束当前支线。",
                   "rationale" => nil
                 }
               ])
           }}
      end
    end

    input = %{
      text: "请继续规划后续章节。",
      workspace_id: @work,
      work_id: @work,
      session_id: "session-agent-outline-author",
      turn_id: "turn-agent-outline-author",
      ledger_reader: fn _work_id -> [] end,
      written_progress_reader: fn _work_id -> %{chapter_seq: 2, volume_seq: 1} end,
      character_reader: fn _work_id -> [] end,
      # WR01c：作者已定版在场 → 直接用，不再调模型（0 调用）。
      planning_mission_reader: fn _work_id ->
        %{
          "mission_id" => "cm_author_p1",
          "statement" => "先收束当前支线，再开新章。",
          "status" => "AUTHOR_EDITED",
          "source" => "author",
          "must_advance" => [%{"text" => "收束当前支线"}],
          "must_avoid" => [%{"text" => "不开新卷"}]
        }
      end,
      planning_mission_writer: fn _work_id, mission_map ->
        send(parent, {:planning_mission_persisted, mission_map})
        {:ok, :stored, mission_map}
      end
    }

    planned =
      DialoguePlanningService.run_spec_for_profile(
        :plot_outline_with_context,
        input,
        context(),
        %Execution{result_fn: result_fn}
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(planned.run_attrs,
               next_step_planner: planned.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :run_completed, _}, 2_000
    refute_received {:planning_mission_prompt, _}
    refute_received {:planning_mission_persisted, _}

    assert_received {:provider_prompt, provider_prompt}
    assert provider_prompt =~ "本轮规划使命（作者已定）：先收束当前支线，再开新章。"
    assert provider_prompt =~ "· 必须推进：收束当前支线"

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    # 作者版 0 调用：三步不变，provider 调用只剩 writer 1 次。
    assert state.run.consumed_budget.steps == 3
    assert state.run.consumed_budget.provider_calls == 1

    assert state.final_turn_result.trace_summary.planning_mission_statement ==
             "先收束当前支线，再开新章。"

    assert state.final_turn_result.trace_summary.planning_mission["status"] == "AUTHOR_EDITED"
  end

  defp plan_draft_prompt?(prompt), do: prompt_contains?(prompt, "AgentRun 计划起草器")

  defp plot_outline_plan_draft do
    NovelApplication.TestAgenticLoopFixtures.plan_tool_call_result(
      "先读取章节大纲规划上下文，再生成章节大纲草稿。",
      [
        NovelApplication.TestAgenticLoopFixtures.plan_step(
          "context_assemble",
          "context_assemble",
          "先读取章节大纲规划上下文。",
          success_criteria: ["outline_context_observation_created"]
        ),
        NovelApplication.TestAgenticLoopFixtures.plan_step(
          "plot_outline",
          "plot_outline",
          "基于已读取的章节上下文生成章节大纲草稿。",
          kind: "act",
          write_intent: "tentative",
          success_criteria: ["tentative_outline_draft_created"]
        )
      ],
      reason_codes: ["agent_plan_drafted", "plot_outline_plan_drafted"]
    )
  end

  defp next_step_decision(prompt) do
    prompt = prompt_text(prompt)

    cond do
      String.contains?(prompt, "/ artifact_created:") ->
        NovelApplication.TestAgenticLoopFixtures.done_next("已生成待采纳大纲候选，本轮目标已经满足。")

      String.contains?(prompt, "outline_context /") ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "基于已读取的章节上下文生成章节大纲草稿。",
          "plot_outline",
          write_intent: "tentative",
          reason_codes: ["agentic_next_step", "outline_context_consumed"]
        )

      true ->
        NovelApplication.TestAgenticLoopFixtures.continue_next(
          "先读取章节大纲规划上下文。",
          "context_assemble",
          reason_codes: ["agentic_next_step", "missing_outline_context"]
        )
    end
  end

  defp prompt_contains?(prompt, pattern), do: prompt_text(prompt) =~ pattern
  defp prompt_text(prompt), do: NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)

  defp context do
    %DialogueContext{
      workspace_id: @work,
      current_chapters: [],
      structured_chapters: [
        %{
          title: "第00章：开局设定",
          seq: 0,
          summary: "矿区旧债与主角压力已经建立。",
          has_prose: false
        }
      ],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
  end
end
