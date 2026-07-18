defmodule NovelApplication.AgentRunJudgmentPlanFlowTest do
  @moduledoc """
  CP4（ADR-0025 决策 2 计划按需）：跨能力真计划执行 flow 的 focused runtime 证明。

  计划由模型基于能力目录制定（plan_drafted 照发——真计划）；机械 cursor 逐步、
  每步过 Orchestrator gate；多产物逐个进待采纳区；完成收束停 S1/S2。
  外部页面级验收由场景 `judgment-plan-multi-step` 驱动。
  """
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.AgentRunService
  alias NovelApplication.DialoguePlanningService

  test "judgment plan run drafts a model plan and executes capability steps into pending artifacts" do
    parent = self()

    result_fn = fn prompt ->
      text = prompt_text(prompt)

      if plan_draft_prompt?(text) do
        send(parent, :plan_draft_called)

          {:ok,
         %{
           content: "先读取上下文，再完成大纲与正文两步产出。",
           provider_call_id: "pc-jp-plan",
           tool_calls: [
             %{
               "name" => "agent_plan_draft",
               "arguments" => %{
                 "plan" => %{
                   "steps" => [
                     plan_step("s1", "context_assemble", "explore", "读取当前作品上下文。"),
                     plan_step("s2", "plot_outline", "act", "调整章节大纲。"),
                     plan_step("s3", "prose_writing", "act", "重写目标章节正文。")
                   ]
                 },
                 "reason_codes" => ["agent_plan_drafted", "judgment_plan_drafted"],
                 "confidence" => 1.0
               }
             }
           ]
         }}

      else
        send(parent, {:tool_prompt, text})

          {:ok,
         %{
           provider_call_id: "pc-jp-tool",
           content:
             Jason.encode!(%{
               items: [
                 %{
                   item_id: "jp-item-#{System.unique_integer([:positive])}",
                   title: "计划步骤产出",
                   body: "按计划步骤生成的候选内容。",
                   rationale: "多步计划产出。"
                 }
               ]
             })
         }}
      end
    end

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :judgment_plan,
        %{
          text: "把前两章的伏笔梳理一遍，按结果调整大纲并重写第02章结尾。",
          workspace_id: "ws-jp",
          work_id: "work-jp",
          session_id: "session-jp",
          turn_id: "turn-jp",
          chapter_prose_reader: fn _work_id, _chapter -> "" end,
          chapter_summary_reader: %{},
          character_reader: fn _work_id -> [] end
        },
        nil,
        %Execution{result_fn: result_fn}
      )

    assert spec.run_attrs.profile_ref == "judgment_plan_v1"

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive :plan_draft_called, 500

    # 真计划：plan_drafted 照发（模型自产步序，非 app 预制轨道）。
    assert_receive {:agent_event, :plan_drafted, plan_event}, 500

    assert [
             %{target_tool_ref: "context_assemble"},
             %{target_tool_ref: "plot_outline"},
             %{target_tool_ref: "prose_writing"}
           ] = plan_event.payload.plan_steps

    assert_receive {:agent_event, :run_completed, _}, 3_000

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    # 多产物：两个 act 步各产一个待采纳候选。
    assert length(state.run.pending_artifact_refs) == 2
    assert state.run.consumed_budget.steps == 3
    assert state.run.consumed_budget.tool_calls == 2
    # 起草 2（reasoning+结构）+ 两个 act 步各 1 = 4（runtime 直连，无判断①入场）。
    assert state.run.consumed_budget.provider_calls == 4
  end

  test "judgment plan revises its own plan when exhausted before the goal is met" do
    parent = self()

    result_fn = fn prompt ->
      text = prompt_text(prompt)

      cond do
        revision_prompt?(text) ->
          send(parent, :plan_revision_called)

          {:ok,
           %{
             content: "计划走完但正文还没产出，我补上正文步继续完成。",
             provider_call_id: "pc-jp-revise",
             tool_calls: [
               %{
                 "name" => "agent_plan_revision",
                 "arguments" => %{
                   "plan" => %{
                     "steps" => [
                       plan_step("s1", "context_assemble", "explore", "读取当前作品上下文。"),
                       plan_step("s2", "prose_writing", "act", "补写目标章节正文。")
                     ]
                   },
                   "reason_codes" => ["agent_plan_revised"],
                   "confidence" => 1.0
                 }
               }
             ]
           }}

        plan_draft_prompt?(text) ->
          # CP4b 诱导：起草短计划（只读上下文，漏产出步）。
          {:ok,
           %{
             content: "先读取上下文再看下一步。",
             provider_call_id: "pc-jp-short-plan",
             tool_calls: [
               %{
                 "name" => "agent_plan_draft",
                 "arguments" => %{
                   "plan" => %{
                     "steps" => [
                       plan_step("s1", "context_assemble", "explore", "读取当前作品上下文。")
                     ]
                   },
                   "reason_codes" => ["agent_plan_drafted"],
                   "confidence" => 1.0
                 }
               }
             ]
           }}

        true ->
          {:ok,
           %{
             provider_call_id: "pc-jp-tool2",
             content:
               Jason.encode!(%{
                 items: [
                   %{
                     item_id: "jp-rev-item-#{System.unique_integer([:positive])}",
                     title: "修订后计划产出",
                     body: "按修订后计划生成的正文候选。",
                     rationale: "真计划修订闭环。"
                   }
                 ]
               })
           }}
      end
    end

    spec =
      DialoguePlanningService.run_spec_for_profile(
        :judgment_plan,
        %{
          text: "把伏笔梳理后重写第02章结尾。",
          workspace_id: "ws-jp2",
          work_id: "work-jp2",
          session_id: "session-jp2",
          turn_id: "turn-jp2",
          chapter_prose_reader: fn _work_id, _chapter -> "" end,
          chapter_summary_reader: %{},
          character_reader: fn _work_id -> [] end
        },
        nil,
        %Execution{result_fn: result_fn}
      )

    assert {:ok, run_id} =
             AgentRunService.start_bounded(spec.run_attrs,
               next_step_planner: spec.next_step_planner,
               event_sink: fn event -> send(parent, {:agent_event, event.event_type, event}) end
             )

    assert_receive {:agent_event, :plan_drafted, _}, 500
    assert_receive :plan_revision_called, 2_000

    # 真计划修订：plan_revised 照发（模型修订自己的计划——D 系真计划形态）。
    assert_receive {:agent_event, :plan_revised, revised_event}, 500

    assert Enum.any?(
             revised_event.payload.plan_steps,
             &(&1.target_tool_ref == "prose_writing")
           )

    assert_receive {:agent_event, :run_completed, _}, 3_000

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert state.run.consumed_budget.replans == 1
    assert length(state.run.pending_artifact_refs) == 1
  end

  defp plan_step(id, target, kind, description) do
    %{
      "step_id" => id,
      "kind" => kind,
      "description" => description,
      "success_criteria" => ["step_completed"],
      "depends_on" => [],
      "target_tool_ref" => target,
      "write_intent" => if(kind == "act", do: "tentative", else: "none"),
      "risk_hint" => "low"
    }
  end

  defp plan_draft_prompt?(text), do: String.contains?(text, "agent_plan_draft")

  defp revision_prompt?(text), do: String.contains?(text, "计划修订器")

  defp prompt_text(prompt), do: NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)
end
