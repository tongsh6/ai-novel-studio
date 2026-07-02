defmodule NovelApplication.CP1AssemblyPolicyTest do
  @moduledoc """
  VS-00C CP1：前文 excerpt 预算由组装策略给出（按 provider 档位），裁剪可解释。

  - 地板档（2000）：超预算前文尾部裁剪 + 产 OmissionNote + 进 trace；不超不裁不产。
  - 大窗口档：同样长度的前文不被裁剪（预算放开）。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  defp frame do
    %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-cp1",
      turn_id: "turn-cp1",
      workspace_id: "work-cp1",
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{},
      dialogue_goal: %{summary: "续写"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "好的"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  # 续写命中的已有章（requested 与 matched 同 → 不触发 CP0 block）。
  defp plan do
    action = %{
      action_id: "act-cp1",
      action_type: :capability_invocation,
      summary: "正文",
      target_ref: "prose_writing",
      write_intent: :tentative,
      risk_hint: :low,
      authoring_intent: :continuation,
      requested_chapter_raw: "第一章",
      target_chapter: "第一章"
    }

    %MicroPlan{
      plan_id: "plan-cp1",
      turn_id: "turn-cp1",
      frame_ref: "frame-cp1",
      plan_goal: %{summary: "续写"},
      risk_hint: :low,
      proposed_actions: [action]
    }
  end

  defp allow_decision do
    %OrchestratorDecision{
      decision_id: "d-allow",
      turn_id: "turn-cp1",
      frame_ref: "frame-cp1",
      decision_type: :allow_tool,
      decision_status: :decided,
      reason_codes: ["gates_passed", "tool:prose_writing"]
    }
  end

  defp context(policy) do
    %DialogueContext{
      workspace_id: "work-cp1",
      current_chapters: ["第一章"],
      assembly_policy: policy
    }
  end

  defp run(policy, prose) do
    {:ok, agent} = Agent.start_link(fn -> [] end)
    reader = fn _w, "第一章" -> prose end

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "i1", "title" => "稿", "body" => "续", "rationale" => nil}
           ])
       }}
    end

    {turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(),
        decision: allow_decision(),
        context: context(policy),
        author_input: %{text: "接着第一章往下写正文"},
        provider_execution: %Execution{result_fn: complete},
        chapter_prose_reader: reader
      })

    prompt = agent |> Agent.get(& &1) |> List.first()
    {turn_result, prompt}
  end

  describe "地板档（2000）" do
    test "超预算前文被尾部裁剪 + OmissionNote 进 trace" do
      long = String.duplicate("甲", 3000)
      {turn_result, prompt} = run(AssemblyPolicy.for_tier(:floor), long)

      assert prompt =~ "本章更早的正文已省略"
      # 注入的前文 excerpt 不应包含全部 3000 字（已裁到 ~2000）。
      assert String.length(prompt) < 3000 + 800
      notes = turn_result.trace_summary[:omission_notes]
      assert is_list(notes) and length(notes) == 1
      assert hd(notes) =~ "超出本轮上下文预算"
      assert hd(notes) =~ "第一章"
    end

    test "未超预算不裁剪、不产 OmissionNote" do
      short = String.duplicate("乙", 500)
      {turn_result, prompt} = run(AssemblyPolicy.for_tier(:floor), short)

      refute prompt =~ "本章更早的正文已省略"
      assert prompt =~ short
      refute Map.has_key?(turn_result.trace_summary, :omission_notes)
    end
  end

  describe "大窗口档" do
    test "同样 3000 字前文在 large 档不被裁剪" do
      long = String.duplicate("丙", 3000)
      {turn_result, prompt} = run(AssemblyPolicy.for_tier(:large), long)

      refute prompt =~ "本章更早的正文已省略"
      assert prompt =~ long
      refute Map.has_key?(turn_result.trace_summary, :omission_notes)
    end
  end

  test "context 无 policy（nil）→ 回落地板档（floor 行为不变）" do
    long = String.duplicate("丁", 3000)

    ctx = %DialogueContext{
      workspace_id: "work-cp1",
      current_chapters: ["第一章"],
      assembly_policy: nil
    }

    {:ok, agent} = Agent.start_link(fn -> [] end)
    reader = fn _w, "第一章" -> long end

    complete = fn prompt ->
      Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         content:
           Jason.encode!([
             %{"item_id" => "i1", "title" => "稿", "body" => "续", "rationale" => nil}
           ])
       }}
    end

    TurnExecutionService.execute(%{
      frame: frame(),
      plan: plan(),
      decision: allow_decision(),
      context: ctx,
      author_input: %{text: "接着第一章往下写正文"},
      provider_execution: %Execution{result_fn: complete},
      chapter_prose_reader: reader
    })

    prompt = agent |> Agent.get(& &1) |> List.first()
    assert prompt =~ "本章更早的正文已省略"
  end
end
