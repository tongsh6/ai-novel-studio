defmodule NovelApplication.CP3StructuredContextTest do
  @moduledoc """
  VS-00C CP3：结构对象分层进入 prose_writing 上下文。

  current_chapters 标题列表继续服务 planner；tool 侧额外消费 structured_chapters，
  在 L2 注入目标章计划摘要、顺序与前后章位置。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-cp3"

  test "写第 N 章首稿时 prompt 含目标章计划摘要与卷内位置" do
    {_turn_result, prompt} =
      run(
        action: %{
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: "第二章：旧服务器里的残诀"
        },
        context: %DialogueContext{
          workspace_id: @work,
          current_chapters: [
            "第一章：底层灵气账单",
            "第二章：旧服务器里的残诀",
            "第三章：地下链路"
          ],
          structured_chapters: [
            %{
              title: "第一章：底层灵气账单",
              seq: 1,
              summary: "主角发现灵气账单异常。",
              has_prose: true
            },
            %{
              title: "第二章：旧服务器里的残诀",
              seq: 2,
              summary: "主角进入旧服务器，找到残缺功法，并第一次尝试突破。",
              has_prose: false
            },
            %{
              title: "第三章：地下链路",
              seq: 3,
              summary: "主角顺着功法线索进入地下管网。",
              has_prose: false
            }
          ],
          assembly_policy: AssemblyPolicy.for_tier(:floor)
        }
      )

    assert prompt =~ "## 目标章结构（写前设计态）"
    assert prompt =~ "目标章：第二章：旧服务器里的残诀（seq=2）"
    assert prompt =~ "计划摘要：主角进入旧服务器，找到残缺功法，并第一次尝试突破。"
    assert prompt =~ "上一章=第一章：底层灵气账单"
    assert prompt =~ "下一章=第三章：地下链路"
    assert prompt =~ "正文状态：尚无已采纳正文"
  end

  test "缺 structured_chapters 时不新增 L2 结构段，保持旧行为" do
    {_turn_result, prompt} =
      run(
        action: %{
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: "第二章"
        },
        context: %DialogueContext{
          workspace_id: @work,
          current_chapters: ["第一章", "第二章"],
          assembly_policy: AssemblyPolicy.for_tier(:floor)
        }
      )

    refute prompt =~ "## 目标章结构"
    assert prompt =~ "## 已采纳章节"
    assert prompt =~ "- 第二章"
  end

  test "planner 漏给 target_chapter 时从作者输入命中现有章并注入结构段" do
    {_turn_result, prompt} =
      run(
        action: %{
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: nil
        },
        author_text: "请根据已采纳章节计划生成第02章：旧服务器里的残诀正文草稿",
        context: %DialogueContext{
          workspace_id: @work,
          current_chapters: [
            "第01章：底层灵气账单",
            "第02章：旧服务器里的残诀",
            "第03章：地下链路"
          ],
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
              summary: "主角进入旧服务器，找到残缺功法，并第一次尝试突破。",
              has_prose: false
            },
            %{
              title: "第03章：地下链路",
              seq: 3,
              summary: "主角顺着功法线索进入地下管网。",
              has_prose: false
            }
          ],
          assembly_policy: AssemblyPolicy.for_tier(:floor)
        }
      )

    assert prompt =~ "## 目标章结构（写前设计态）"
    assert prompt =~ "目标章：第02章：旧服务器里的残诀（seq=2）"
    assert prompt =~ "计划摘要：主角进入旧服务器，找到残缺功法，并第一次尝试突破。"
    assert prompt =~ "上一章=第01章：底层灵气账单"
    assert prompt =~ "下一章=第03章：地下链路"
  end

  defp run(opts) do
    {:ok, agent} = Agent.start_link(fn -> [] end)
    author_text = opts[:author_text] || "写第二章首稿"

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "cp3-item", "title" => "正文草稿", "body" => "正文", "rationale" => nil}
           ])
       }}
    end

    {turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(opts[:action]),
        decision: allow_decision(),
        context: opts[:context],
        author_input: %{text: author_text},
        provider_execution: %Execution{complete_fn: complete}
      })

    {turn_result, agent |> Agent.get(& &1) |> Enum.join("\n\n")}
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-cp3",
      turn_id: "turn-cp3",
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
          action_id: "act-cp3",
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
      plan_id: "plan-cp3",
      turn_id: "turn-cp3",
      frame_ref: "frame-cp3",
      plan_goal: %{summary: "写作"},
      risk_hint: :low,
      proposed_actions: [action]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "decision-cp3",
      turn_id: "turn-cp3",
      frame_ref: "frame-cp3",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end
end
