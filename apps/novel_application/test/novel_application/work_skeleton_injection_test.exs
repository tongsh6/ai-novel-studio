defmodule NovelApplication.WorkSkeletonInjectionTest do
  @moduledoc """
  VS-00G CP3：全书骨架+收官守则注入 plot_outline 规划 prompt（治 M3 收官循环）。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-skeleton"

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-skeleton",
      turn_id: "turn-skeleton",
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "规划"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "好的"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan(target_ref) do
    %MicroPlan{
      plan_id: "plan-skeleton",
      turn_id: "turn-skeleton",
      frame_ref: "frame-skeleton",
      plan_goal: %{summary: "规划"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-skeleton",
          action_type: :capability_invocation,
          summary: "规划",
          target_ref: target_ref,
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: nil
        }
      ]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "d-allow",
      turn_id: "turn-skeleton",
      frame_ref: "frame-skeleton",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed"]
    }
  end

  defp run(target_ref, snapshot, chapters) do
    structured = Enum.map(chapters, &%{title: &1, has_prose: true})
    run(target_ref, snapshot, chapters, structured)
  end

  defp run(target_ref, snapshot, chapters, structured) do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "c1", "title" => "第1章", "body" => "章方向", "rationale" => nil}
           ])
       }}
    end

    context = %DialogueContext{
      work_id: @work,
      assembly_policy: AssemblyPolicy.for_tier(:floor),
      current_work_snapshot: snapshot,
      current_chapters: chapters,
      structured_chapters: structured
    }

    input = %{
      frame: frame(),
      plan: plan(target_ref),
      decision: allow_decision(),
      context: context,
      author_input: %{text: "继续规划后续章节"},
      provider_execution: %Execution{result_fn: complete}
    }

    {_turn_result, _trace, _transcript} = TurnExecutionService.execute(input)

    agent
    |> Agent.get(& &1)
    |> Enum.map_join("\n\n", &NovelApplication.TestAgenticLoopFixtures.prompt_text/1)
  end

  test "plot_outline + 骨架已立 + 进度尚远 → 注入骨架段与禁终局守则" do
    snapshot = %{target_length: 140_000, planned_volumes: 5, serial_form: "连载"}
    chapters = Enum.map(1..30, &"第#{&1}章")
    prompts = run("plot_outline", snapshot, chapters)

    assert prompts =~ "全书规划（连载参照）"
    assert prompts =~ "目标体量：约 140000 字"
    assert prompts =~ "当前进度：已写 30 章"
    assert prompts =~ "不得规划终局/收官/大结局/完结章"
  end

  test "plot_outline + 骨架未立（无 target_length）→ 无骨架段（诚实缺席）" do
    prompts = run("plot_outline", %{genre: "赛博修仙"}, ["第1章"])
    refute prompts =~ "全书规划（连载参照）"
  end

  # CA04 G1：写章也带全书进度与收官守则；分卷守则是规划指令，不进正文。
  test "prose_writing + 骨架已立 → 注入正文向骨架段（含收官守则，不含分卷守则）" do
    snapshot = %{target_length: 140_000, planned_volumes: 5, serial_form: "连载"}
    prompts = run("prose_writing", snapshot, Enum.map(1..30, &"第#{&1}章"))

    assert prompts =~ "全书规划（连载参照）"
    assert prompts =~ "目标体量：约 140000 字"
    assert prompts =~ "当前进度：已写 30 章"
    assert prompts =~ "不得规划终局/收官/大结局/完结章"
    refute prompts =~ "分卷规划要求"
  end

  test "prose_writing + 骨架未立 → 无骨架段（诚实缺席）" do
    prompts = run("prose_writing", %{genre: "赛博修仙"}, ["第1章"])
    refute prompts =~ "全书规划（连载参照）"
  end

  test "正文与规划只计真实正文，不把第四个空章当成已写" do
    chapters = ["已写甲", "已写乙", "已写丙", "第07章：空章待写"]

    structured = [
      %{title: "已写甲", has_prose: true},
      %{title: "已写乙", has_prose: true},
      %{title: "已写丙", has_prose: true},
      %{title: "第07章：空章待写", has_prose: false}
    ]

    for capability <- ["prose_writing", "plot_outline"] do
      prompts = run(capability, %{target_length: 140_000}, chapters, structured)
      assert prompts =~ "当前进度：已写 3 章"
      refute prompts =~ "当前进度：已写 4 章"
    end
  end

  test "显示标题及缺失或非真正文标记都不能证明已写" do
    chapters = ["有标题甲", "有标题乙", "有标题丙", "有标题丁"]

    structured = [
      %{title: "有标题甲", has_prose: false},
      %{title: "有标题乙", has_prose: nil},
      %{title: "有标题丙", has_prose: "true"},
      %{title: "有标题丁"}
    ]

    for facts <- [structured, [], nil] do
      prompts = run("prose_writing", %{target_length: 140_000}, chapters, facts)
      assert prompts =~ "当前进度：已写 0 章"
    end
  end

  test "大量空计划章不能把正文进度推过收官阈值" do
    chapters = Enum.map(1..30, &"第#{&1}章")
    structured = Enum.map(chapters, &%{title: &1, has_prose: false})

    for capability <- ["prose_writing", "plot_outline"] do
      prompts = run(capability, %{target_length: 28_000}, chapters, structured)
      assert prompts =~ "当前进度：已写 0 章"
      assert prompts =~ "不得规划终局/收官/大结局/完结章"
      refute prompts =~ "已接近目标体量，可开始安排收束章"
    end
  end

  test "未放行能力（character_design）→ 不注入骨架段（登记表门）" do
    snapshot = %{target_length: 140_000}
    prompts = run("character_design", snapshot, Enum.map(1..30, &"第#{&1}章"))
    refute prompts =~ "全书规划（连载参照）"
  end
end
