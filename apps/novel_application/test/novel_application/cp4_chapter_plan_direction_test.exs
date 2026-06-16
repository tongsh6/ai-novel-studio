defmodule NovelApplication.CP4ChapterPlanDirectionTest do
  @moduledoc """
  VS-00C CP4：结构化章方向进入 prose_writing L2。

  CP3 已把目标章摘要/卷内位置带入 L2；CP4 把 `chapters.summary` 的自由文本近似升级为
  E18-E22 plan_direction 结构，并在写章 prompt 中优先渲染结构方向。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-cp4"

  test "写章 prompt 优先注入 E18-E22 结构化章方向" do
    {_turn_result, prompt} =
      run(
        action: %{target_chapter: "第02章：旧服务器里的残诀"},
        context: %DialogueContext{
          workspace_id: @work,
          current_chapters: ["第01章：底层灵气账单", "第02章：旧服务器里的残诀"],
          structured_chapters: [
            %{
              title: "第01章：底层灵气账单",
              seq: 1,
              summary: "主角发现灵气账单异常。",
              has_prose: true
            },
            %{
              title: "第02章：旧服务器里的残诀",
              seq: 2,
              summary: "主角进入旧服务器。",
              has_prose: false,
              plan_direction: %{
                "chapter_role" => "转折章",
                "plot_progress" => "主角进入旧服务器并发现残缺功法",
                "character_change" => "主角第一次主动冒险",
                "information_release" => "残诀来源指向公司旧实验",
                "foreshadowing_action" => "残诀尾页缺失",
                "emotion" => "紧张中带兴奋",
                "opening_hook" => "红色账单倒计时",
                "ending_hook" => "服务器里传来妹妹声音",
                "word_count_and_scenes" => "约 3000 字，2 场"
              }
            }
          ],
          assembly_policy: AssemblyPolicy.for_tier(:floor)
        }
      )

    assert prompt =~ "## 目标章结构（写前设计态）"
    assert prompt =~ "目标章：第02章：旧服务器里的残诀（seq=2）"
    assert prompt =~ "章方向：E18-E22 结构化方向"
    assert prompt =~ "章功能定位：转折章"
    assert prompt =~ "目标四件套：情节推进=主角进入旧服务器并发现残缺功法"
    assert prompt =~ "人物变化=主角第一次主动冒险"
    assert prompt =~ "信息释放=残诀来源指向公司旧实验"
    assert prompt =~ "伏笔动作=残诀尾页缺失"
    assert prompt =~ "情绪定位：紧张中带兴奋"
    assert prompt =~ "章首拉力：红色账单倒计时"
    assert prompt =~ "章尾断章：服务器里传来妹妹声音"
    assert prompt =~ "字数与场次：约 3000 字，2 场"
    assert prompt =~ "计划摘要：主角进入旧服务器。"
  end

  defp run(opts) do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "cp4-item", "title" => "正文草稿", "body" => "正文", "rationale" => nil}
           ])
       }}
    end

    {turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(opts[:action]),
        decision: allow_decision(),
        context: opts[:context],
        author_input: %{text: "写第二章首稿"},
        complete_fn: complete
      })

    {turn_result, agent |> Agent.get(& &1) |> Enum.join("\n\n")}
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-cp4",
      turn_id: "turn-cp4",
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "写作"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "写第二章首稿"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan(overrides) do
    action =
      Map.merge(
        %{
          action_id: "act-cp4",
          action_type: :capability_invocation,
          summary: "正文",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: nil
        },
        overrides || %{}
      )

    %MicroPlan{
      plan_id: "plan-cp4",
      turn_id: "turn-cp4",
      frame_ref: "frame-cp4",
      plan_goal: %{summary: "写作"},
      risk_hint: :low,
      proposed_actions: [action]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "decision-cp4",
      turn_id: "turn-cp4",
      frame_ref: "frame-cp4",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end
end
