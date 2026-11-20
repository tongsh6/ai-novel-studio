defmodule NovelApplication.VS00ECP1ProseExecutionBriefTest do
  @moduledoc """
  VS-00E CP1：章级方向展开为场级执行简述 ProseExecutionBriefV1，进入正文生成请求与 trace，
  且不写入作品事实。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision
  alias NovelTest.TestProviderPrompt

  @work "work-vs00e-cp1"

  test "execution brief is projected from chapter direction, enters prompt + trace, not a story fact" do
    {turn_result, prompt} =
      run(
        %DialogueContext{
          work_id: @work,
          current_chapters: ["第02章：旧服务器里的残诀"],
          structured_chapters: [
            %{
              title: "第02章：旧服务器里的残诀",
              seq: 2,
              summary: "主角进入旧服务器。",
              has_prose: false,
              plan_direction: %{
                "chapter_role" => "铺垫章",
                "plot_progress" => "主角进入旧服务器并发现残缺功法",
                "character_change" => "主角第一次主动冒险",
                "information_release" => "残诀来源指向公司旧实验",
                "foreshadowing_action" => "残诀尾页缺失",
                "emotion" => "紧张中带兴奋"
              }
            }
          ],
          assembly_policy: AssemblyPolicy.for_tier(:floor)
        },
        "第02章：旧服务器里的残诀"
      )

    # 1. 场级执行简述由现役原生 Scope 字段传递，材料字符串保留实际换行。
    scope = TestProviderPrompt.scope_content(prompt)
    brief = get_in(scope, ["operation", "execution_brief"])
    assert brief =~ "## 场级执行简述"
    assert brief =~ "目标变化：chapter_projection：主角第一次主动冒险"
    assert brief =~ "终：紧张中带兴奋"
    assert brief =~ "读者得知：残诀来源指向公司旧实验"

    # 2. 专业能力、上下文和原作者输入各自保留所属字段。
    assert get_in(scope, ["operation", "capability"]) == "prose_writing"
    assert get_in(scope, ["operation", "context_text"]) =~ "第02章：旧服务器里的残诀"
    assert TestProviderPrompt.author_text(prompt) == "写正文首稿"

    # 3. brief 来源进入 trace（稳定 ref）
    ref = turn_result.trace_summary[:prose_execution_brief_ref]
    assert is_binary(ref) and String.starts_with?(ref, "brief:")
    assert turn_result.trace_summary[:creative_decision_packet_ref] == "cdp_turn-cp1"
    assert turn_result.trace_summary[:writer_provider_call_ref] == "pc-cp1-writer"
    assert turn_result.trace_summary[:provider_call_budget].writer == 2
    assert turn_result.trace_summary[:provider_call_budget].evaluator == 0

    # 4. brief 不是作品事实：待采纳产物正文是模型内容，不含执行简述结构
    assert [pending] = turn_result.adoption_state.pending
    payload_text = inspect(pending.payload)
    refute payload_text =~ "场级执行简述"
    refute payload_text =~ "chapter_projection"
  end

  test "no structured chapter direction → degraded brief, still enters request without fabricating causal detail" do
    {_turn_result, prompt} =
      run(
        %DialogueContext{
          work_id: @work,
          current_chapters: ["第05章"],
          structured_chapters: [
            %{title: "第05章", seq: 5, summary: "主角与师父对峙。", has_prose: false}
          ],
          assembly_policy: AssemblyPolicy.for_tier(:floor)
        },
        "第05章"
      )

    brief = get_in(TestProviderPrompt.scope_content(prompt), ["operation", "execution_brief"])
    assert brief =~ "## 场级执行简述"
    assert brief =~ "主角与师父对峙"
    # 无结构化方向时不伪造因果脊。
    refute brief =~ "因果"
  end

  defp run(context, target_chapter) do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])

      materials =
        get_in(TestProviderPrompt.scope_content(prompt), ["authoring_task", "materials"])

      assert %{"ref" => brief_ref} = Enum.find(materials, &(&1["kind"] == "execution_brief"))
      assert Enum.any?(prompt.refs.base_refs, &(&1.ref == brief_ref))

      {:ok,
       %{
         provider_call_id: "pc-cp1-writer",
         content: "",
         tool_calls:
           TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
             items: [%{item_id: "cp1-item", title: "第02章", body: "正文", rationale: nil}],
             self_report: %{
               assumptions: [],
               intended_reader_effect: nil,
               used_context_refs: [brief_ref],
               risk_flags: []
             }
           })
       }}
    end

    {turn_result, _trace, _transcript} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(target_chapter),
        decision: allow_decision(),
        context: context,
        author_input: %{text: "写正文首稿"},
        provider_execution: %Execution{result_fn: complete}
      })

    {turn_result, Agent.get(agent, &List.last/1)}
  end

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-cp1",
      turn_id: "turn-cp1",
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "写作"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "写正文首稿"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan(target_chapter) do
    %MicroPlan{
      plan_id: "plan-cp1",
      turn_id: "turn-cp1",
      frame_ref: "frame-cp1",
      plan_goal: %{summary: "写作"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-cp1",
          action_type: :capability_invocation,
          summary: "正文",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: target_chapter
        }
      ]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "decision-cp1",
      turn_id: "turn-cp1",
      frame_ref: "frame-cp1",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end
end
