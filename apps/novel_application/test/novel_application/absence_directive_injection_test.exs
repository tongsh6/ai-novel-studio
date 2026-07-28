defmodule NovelApplication.AbsenceDirectiveInjectionTest do
  @moduledoc """
  VS-00G CP1：承重事实缺席守则注入写作上下文（机械准备）。

  prose_writing/plot_outline 轮：roster 无 PROTAGONIST → 注入主角缺席守则（防真空被
  模型想象填补，M3 地基事实真空病例下药）；roster 含 PROTAGONIST → 不注入（诚实在场）。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-absence"

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-absence",
      turn_id: "turn-absence",
      workspace_id: @work,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "创作"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "好的"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan(target_ref) do
    %MicroPlan{
      plan_id: "plan-absence",
      turn_id: "turn-absence",
      frame_ref: "frame-absence",
      plan_goal: %{summary: "创作"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-absence",
          action_type: :capability_invocation,
          summary: "创作",
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
      turn_id: "turn-absence",
      frame_ref: "frame-absence",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed"]
    }
  end

  defp run(target_ref, character_reader) do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "c1", "title" => "第1章", "body" => "正文", "rationale" => nil}
           ])
       }}
    end

    input = %{
      frame: frame(),
      plan: plan(target_ref),
      decision: allow_decision(),
      context: %DialogueContext{
        workspace_id: @work,
        assembly_policy: AssemblyPolicy.for_tier(:floor)
      },
      author_input: %{text: "创作"},
      provider_execution: %Execution{result_fn: complete}
    }

    input =
      if character_reader, do: Map.put(input, :character_reader, character_reader), else: input

    input =
      case Process.get(:assumption_reader) do
        nil -> input
        reader -> Map.put(input, :assumption_reader, reader)
      end

    {_turn_result, _trace} = TurnExecutionService.execute(input)
    agent |> Agent.get(& &1) |> Enum.join("\n\n")
  end

  defp roster(list), do: fn _work -> list end

  defp with_assumptions(list, fun) do
    Process.put(:assumption_reader, fn _work -> list end)
    fun.()
  after
    Process.delete(:assumption_reader)
  end

  defp active_assumption do
    %{
      name: "沈砚",
      narrative_role: "PROTAGONIST",
      summary: "追查灵气账单的核心视角人物。",
      status: "TENTATIVE",
      provisional_source: "AI_ASSUMPTION",
      provisional_active: true
    }
  end

  test "prose_writing：roster 无 PROTAGONIST → 注入主角缺席守则" do
    prompts = run("prose_writing", roster([%{name: "沈砚", narrative_role: "SUPPORTING"}]))
    assert prompts =~ "承重事实缺席提示"
    assert prompts =~ "尚未确立主角档案"
    assert prompts =~ "不得另立新主角"
  end

  test "prose_writing：roster 含 PROTAGONIST → 不注入缺席守则" do
    prompts = run("prose_writing", roster([%{name: "沈砚", narrative_role: "PROTAGONIST"}]))
    refute prompts =~ "承重事实缺席提示"
  end

  test "prose_writing：空 roster → 注入主角缺席守则（M3 地基真空直接病例）" do
    prompts = run("prose_writing", roster([]))
    assert prompts =~ "尚未确立主角档案"
  end

  test "plot_outline：无主角同样注入缺席守则（规划期也守）" do
    prompts = run("plot_outline", roster([%{name: "白露", narrative_role: "MINOR"}]))
    assert prompts =~ "尚未确立主角档案"
  end

  test "未注入 character_reader → 诚实缺席仍注入守则（不假定主角在场）" do
    prompts = run("prose_writing", nil)
    assert prompts =~ "尚未确立主角档案"
  end

  test "未登记能力（world_building）→ 无缺席守则段" do
    prompts = run("world_building", roster([]))
    refute prompts =~ "承重事实缺席提示"
  end

  # ── VS-00G CP5c：激活假定的可标注注入 ──────────────────────

  test "CP5c：激活的主角假定计入在场（缺席守则让位），以【暂定】标注段注入" do
    prompts =
      with_assumptions([active_assumption()], fn -> run("prose_writing", roster([])) end)

    refute prompts =~ "尚未确立主角档案"
    assert prompts =~ "【暂定】主角：沈砚"
    assert prompts =~ "追查灵气账单的核心视角人物"
    assert prompts =~ "依据：设定盘点"
    assert prompts =~ "不得当作已定案设定展开重大转折"
  end

  test "CP5c：未激活的假定（provisional_active=false）不注入也不算在场" do
    inactive = Map.put(active_assumption(), :provisional_active, false)

    prompts = with_assumptions([inactive], fn -> run("prose_writing", roster([])) end)

    assert prompts =~ "尚未确立主角档案"
    refute prompts =~ "【暂定】主角"
  end

  test "CP5c：plot_outline 同样消费激活假定（规划期方向锚）" do
    prompts =
      with_assumptions([active_assumption()], fn -> run("plot_outline", roster([])) end)

    refute prompts =~ "尚未确立主角档案"
    assert prompts =~ "【暂定】主角：沈砚"
  end

  test "CP5c：假定读端口抛错 → 诚实降级回缺席守则（注入通道不阻断创作）" do
    prompts =
      with_assumptions(:raise, fn ->
        Process.put(:assumption_reader, fn _work -> raise "boom" end)
        run("prose_writing", roster([]))
      end)

    assert prompts =~ "尚未确立主角档案"
    refute prompts =~ "【暂定】主角"
  end
end
