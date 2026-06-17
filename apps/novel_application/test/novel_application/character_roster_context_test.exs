defmodule NovelApplication.CharacterRosterContextTest do
  @moduledoc """
  AU09-character-dossier-roundtrip CP1 step2（I-c）：从 Character 主档案注入"现有角色"上下文。

  停掉角色 memory 误路由后，character_design / prose_writing 轮改从 Character 主档案读现有角色，
  让 AI 设计新角色时看得见现有阵容、写作时保持一致；未注入或空列表时无该段（行为不变），
  非角色/正文能力不注入。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-roster"

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-roster",
      turn_id: "turn-roster",
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
      plan_id: "plan-roster",
      turn_id: "turn-roster",
      frame_ref: "frame-roster",
      plan_goal: %{summary: "创作"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-roster",
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
      turn_id: "turn-roster",
      frame_ref: "frame-roster",
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
             %{"item_id" => "c1", "title" => "新角色", "body" => "档案", "rationale" => nil}
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
      complete_fn: complete
    }

    input = if character_reader, do: Map.put(input, :character_reader, character_reader), else: input

    {_turn_result, _trace} = TurnExecutionService.execute(input)
    agent |> Agent.get(& &1) |> Enum.join("\n\n")
  end

  defp roster(list), do: fn _work -> list end

  test "character_design 轮注入现有角色（名/定位/摘要）" do
    prompts =
      run(
        "character_design",
        roster([
          %{name: "沈砚", role: "主角", summary: "灵气交易所稽查官"},
          %{name: "白露", role: "对手", summary: "黑市掮客"}
        ])
      )

    assert prompts =~ "## 现有角色"
    assert prompts =~ "沈砚（主角）：灵气交易所稽查官"
    assert prompts =~ "白露（对手）：黑市掮客"
  end

  test "prose_writing 轮也注入现有角色（写作保持一致；无 role 时省略后缀）" do
    prompts = run("prose_writing", roster([%{name: "沈砚", role: nil, summary: "稽查官"}]))

    assert prompts =~ "## 现有角色"
    assert prompts =~ "沈砚：稽查官"
  end

  test "未注入 character_reader 时无现有角色段（行为不变）" do
    refute run("character_design", nil) =~ "现有角色"
  end

  test "现有角色为空时无现有角色段" do
    refute run("character_design", roster([])) =~ "现有角色"
  end

  test "非角色/正文能力（plot_outline）不注入现有角色" do
    prompts = run("plot_outline", roster([%{name: "沈砚", role: "主角", summary: "x"}]))
    refute prompts =~ "现有角色"
  end
end
