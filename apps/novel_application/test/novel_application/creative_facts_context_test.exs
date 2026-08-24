defmodule NovelApplication.CreativeFactsContextTest do
  @moduledoc """
  CA02（VS-00C §3.1 L3b/L4 最小形态）：确认记忆机械分组注入写作上下文。

  prose_writing 轮从 memory_reader 注入「作品事实」段（伏笔/规则/状态/关系）与
  「写作风格与作者偏好」段；无记忆或未注入 reader 时诚实缺席；非 prose 能力不注入；
  evaluator 收到与 writer 同源的 facts_context。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-facts"

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-facts",
      turn_id: "turn-facts",
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
      plan_id: "plan-facts",
      turn_id: "turn-facts",
      frame_ref: "frame-facts",
      plan_goal: %{summary: "创作"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-facts",
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
      turn_id: "turn-facts",
      frame_ref: "frame-facts",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed"]
    }
  end

  defp run(target_ref, memory_reader) do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])
      {:ok, %{content: "正文内容。"}}
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

    input = if memory_reader, do: Map.put(input, :memory_reader, memory_reader), else: input

    {_turn_result, _trace} = TurnExecutionService.execute(input)
    agent |> Agent.get(& &1) |> Enum.join("\n\n")
  end

  defp facts_reader(overrides \\ %{}) do
    base = %{
      foreshadowing: [%{summary: "灵脉断裂之谜", content: "第三章埋下的灵脉断裂尚未回收"}],
      world_rules: [%{summary: "灵气交易需契约", content: "任何灵气交易必须签订魂契"}],
      current_states: [%{summary: "沈砚重伤未愈", content: "左臂经脉受损，无法全力出手"}],
      relationships: [%{summary: "沈砚与白露敌对", content: "黑市冲突后势同水火"}],
      style: [%{summary: "对白优先", content: "多用对白推进，少用心理独白"}]
    }

    facts = Map.merge(base, overrides)
    fn _work -> facts end
  end

  test "prose_writing 注入作品事实段与风格段（分组标签+条目行）" do
    prompts = run("prose_writing", facts_reader())

    assert prompts =~ "## 作品事实（作者已确认，写作必须保持一致）"
    assert prompts =~ "伏笔与情节事实：\n- 灵脉断裂之谜：第三章埋下的灵脉断裂尚未回收"
    assert prompts =~ "世界规则与约束：\n- 灵气交易需契约：任何灵气交易必须签订魂契"
    assert prompts =~ "人物当前状态：\n- 沈砚重伤未愈"
    assert prompts =~ "人物关系：\n- 沈砚与白露敌对"
    assert prompts =~ "## 写作风格与作者偏好（作者已确认，写作遵循）"
    assert prompts =~ "- 对白优先：多用对白推进，少用心理独白"
  end

  test "空组不渲染组标签；全空时两段整体缺席" do
    prompts =
      run(
        "prose_writing",
        facts_reader(%{world_rules: [], current_states: [], relationships: [], style: []})
      )

    assert prompts =~ "伏笔与情节事实："
    refute prompts =~ "世界规则与约束："
    refute prompts =~ "## 写作风格与作者偏好"

    empty =
      run(
        "prose_writing",
        facts_reader(%{
          foreshadowing: [],
          world_rules: [],
          current_states: [],
          relationships: [],
          style: []
        })
      )

    refute empty =~ "## 作品事实"
    refute empty =~ "## 写作风格与作者偏好"
  end

  test "未注入 memory_reader 时无两段（行为不变）" do
    prompts = run("prose_writing", nil)
    refute prompts =~ "## 作品事实"
    refute prompts =~ "## 写作风格与作者偏好"
  end

  # CA04 G2：规划与写作对「已确认事实/风格」同源同段（扩章计划不与设定冲突）。
  test "plot_outline 注入作品事实段与风格段（CA04 G2，登记表放行）" do
    prompts = run("plot_outline", facts_reader())
    assert prompts =~ "## 作品事实（作者已确认，写作必须保持一致）"
    assert prompts =~ "伏笔与情节事实：\n- 灵脉断裂之谜"
    assert prompts =~ "## 写作风格与作者偏好（作者已确认，写作遵循）"
  end

  test "未放行能力（character_design）不注入（登记表门）" do
    prompts = run("character_design", facts_reader())
    refute prompts =~ "## 作品事实"
    refute prompts =~ "## 写作风格与作者偏好"
  end

  test "每组按策略 facts_group_limit 截断（floor=8）" do
    many = Enum.map(1..12, &%{summary: "规则#{&1}", content: "内容#{&1}"})
    prompts = run("prose_writing", facts_reader(%{world_rules: many}))

    assert prompts =~ "- 规则8"
    refute prompts =~ "- 规则9"
  end

  test "长 content 裁剪并标注省略" do
    long = String.duplicate("长", 260)
    prompts = run("prose_writing", facts_reader(%{world_rules: [%{summary: "", content: long}]}))

    assert prompts =~ String.duplicate("长", 200) <> "……"
    refute prompts =~ String.duplicate("长", 201)
  end

  test "evaluator 收到与 writer 同源的 facts_context 事实基线" do
    {:ok, seen} = Agent.start_link(fn -> nil end)

    writer = fn _prompt ->
      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "p1", "title" => "第1章：开端", "body" => "正文内容。", "rationale" => nil}
           ])
       }}
    end

    evaluator = fn prompt ->
      Agent.update(seen, fn _ -> prompt end)
      {:ok, %{content: ~s({"findings": []})}}
    end

    input = %{
      frame: frame(),
      plan: plan("prose_writing"),
      decision: allow_decision(),
      context: %DialogueContext{
        workspace_id: @work,
        assembly_policy: AssemblyPolicy.for_tier(:floor)
      },
      author_input: %{text: "创作"},
      provider_execution: %Execution{result_fn: writer},
      quality_provider_execution: %Execution{result_fn: evaluator},
      memory_reader: facts_reader()
    }

    {_turn_result, _trace} = TurnExecutionService.execute(input)
    evaluator_prompt = Agent.get(seen, & &1)

    assert evaluator_prompt =~ "作品事实基线"
    assert evaluator_prompt =~ "灵气交易需契约"
    assert evaluator_prompt =~ "对白优先"
  end
end
