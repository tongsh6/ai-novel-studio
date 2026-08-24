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
      workspace_id: @work,
      assembly_policy: AssemblyPolicy.for_tier(:floor),
      current_work_snapshot: snapshot,
      current_chapters: chapters
    }

    input = %{
      frame: frame(),
      plan: plan(target_ref),
      decision: allow_decision(),
      context: context,
      author_input: %{text: "继续规划后续章节"},
      provider_execution: %Execution{result_fn: complete}
    }

    {_turn_result, _trace} = TurnExecutionService.execute(input)
    agent |> Agent.get(& &1) |> Enum.join("\n\n")
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

  test "未放行能力（character_design）→ 不注入骨架段（登记表门）" do
    snapshot = %{target_length: 140_000}
    prompts = run("character_design", snapshot, Enum.map(1..30, &"第#{&1}章"))
    refute prompts =~ "全书规划（连载参照）"
  end
end
