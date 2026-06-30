defmodule NovelApplication.VS00ECP3ProseRevisionTest do
  @moduledoc """
  VS-00E CP3：按质量发现重写（revise_from_findings）。

  覆盖：本轮有发现 + 待采纳正文 → 暴露 revise_from_findings 动作；动作经 DialogueGateway
  产出一个新的 tentative 修订草稿（原草稿保留、不自动采纳、不自我递归评估）；修订请求保留
  prose 三锚点；反“凭空发明动作”。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.DialogueGateway
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AssemblyPolicy
  alias NovelDomain.AuthorActionInput
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelDomain.MicroPlan
  alias NovelDomain.OrchestratorDecision

  @work "work-vs00e-cp3"
  @bad_prose "他走进房间，看了看四周，坐了下来。他拿起书本，翻了翻几页，放了下来。他望向窗外，看了看天色，叹了口气。他端起茶杯，喝了一小口，搁了回去。"
  @revised_body "雨水顺着旧窗棂淌下，他攥紧那页残诀，呼吸忽然急促——这一次，他决定不再退。"

  test "finding-bearing prose turn exposes a revise_from_findings action targeting the prose draft" do
    turn_result = run_prose_turn()

    assert turn_result.quality_review.findings != []
    [pending] = turn_result.adoption_state.pending

    revise = revise_action(turn_result)
    assert revise.action_type == "revise_from_findings"
    assert revise.target_ref == pending.artifact_id
    assert revise.action_id == "revise_from_findings:#{pending.artifact_id}"
    assert revise.enabled == true
    # 携带本轮发现引用，供前端/服务知道要处理哪些问题
    assert "validator.prose_pattern_repetition" in revise.quality_finding_refs
  end

  test "revise_from_findings produces a new tentative revision draft; original retained; not auto-adopted" do
    source = run_prose_turn()
    [original_pending] = source.adoption_state.pending
    {revision_turn, prompt} = revise(source)

    # 1. 修订请求保留 prose 三锚点（stub/slice_verify 仍可解析），并带上原正文 + 修订要求
    assert prompt =~ "用户创作简述："
    assert prompt =~ "上下文："
    assert prompt =~ "重要："
    assert prompt =~ "[质量修订要求]"
    assert prompt =~ @bad_prose
    assert prompt =~ "行结构" or prompt =~ "重复" or prompt =~ "句"

    # 2. 产出一个新的 tentative 修订草稿，正文是模型新内容（区别于原草稿）
    assert [revision_pending] = revision_turn.adoption_state.pending
    revised = revision_pending.payload.items |> hd() |> Map.get(:body)
    assert revised == @revised_body
    refute revised == @bad_prose

    # 3. 修订草稿 provenance：指向被修订原草稿 + 修订原因 + 质量发现引用
    card = Enum.find(revision_turn.ui_cards, &(&1.card_type == "candidate_set"))
    assert card.revision_of == original_pending.artifact_id
    assert is_binary(card.revision_reason) and card.revision_reason != ""
    assert "validator.prose_pattern_repetition" in card.quality_finding_refs
    assert card.title =~ "修订草稿"

    # 4. 修订草稿是 tentative、不自动采纳：照常给出 accept/discard 动作
    action_types = Enum.map(revision_turn.available_actions, & &1.action_type)
    assert "accept" in action_types
    assert "discard" in action_types
    refute revision_turn.truthfulness.artifact_adopted
    refute revision_turn.truthfulness.production_write_performed

    # 5. 不自我递归：修订轮自身不再触发质量评估
    refute Map.has_key?(revision_turn, :quality_review)

    # 6. 修订动作必须有真实 OrchestratorDecision / ToolRequest trace，replay 不重调 provider
    assert revision_turn.trace_summary.decision_type == "revise_from_findings"
    assert revision_turn.trace_summary.orchestrator_decision == :allow_tool
    assert String.starts_with?(revision_turn.trace_summary.decision_ref, "decision_")
    assert String.starts_with?(revision_turn.trace_summary.tool_request_id, "tq_rev_")
    assert String.starts_with?(revision_turn.trace_summary.tool_result_id, "tr_")
    assert revision_turn.trace_summary.replay_policy.recall_provider == false
    assert revision_turn.trace_summary.revision_provider_call_ref == "pc-revision"
    assert revision_turn.trace_summary.provider_call_budget.revision_writer == 1

    # 7. 原草稿保留：source turn 未被修订动作改写
    assert hd(source.adoption_state.pending).payload.items |> hd() |> Map.get(:body) == @bad_prose
  end

  test "exactly one revision candidate per action" do
    source = run_prose_turn()
    {revision_turn, _prompt} = revise(source)
    assert length(revision_turn.adoption_state.pending) == 1
  end

  test "fabricated revise action is rejected (anti-invention)" do
    source = run_prose_turn()

    invented = %AuthorActionInput{
      input_id: "in-x",
      source_turn_ref: source.turn_id,
      action_id: "revise_from_findings:made-up-artifact",
      action_type: "revise_from_findings",
      target_ref: "made-up-artifact",
      idempotency_key: "idem-x"
    }

    assert {:error, reason} = DialogueGateway.handle_action(invented, source, revise_complete())
    assert reason =~ "invented action"
  end

  test "revise without a provider connection is an honest error" do
    source = run_prose_turn()
    revise = revise_action(source)

    input = %AuthorActionInput{
      input_id: "in-y",
      source_turn_ref: source.turn_id,
      action_id: revise.action_id,
      action_type: "revise_from_findings",
      target_ref: revise.target_ref,
      idempotency_key: "idem-y"
    }

    assert {:error, reason} = DialogueGateway.handle_action(input, source, nil)
    assert reason =~ "provider"
  end

  # ── helpers ─────────────────────────────────────────────

  defp revise(source) do
    {:ok, agent} = Agent.start_link(fn -> [] end)
    revise = revise_action(source)

    input = %AuthorActionInput{
      input_id: "in-revise",
      source_turn_ref: source.turn_id,
      action_id: revise.action_id,
      action_type: "revise_from_findings",
      target_ref: revise.target_ref,
      payload: %{"quality_finding_refs" => revise.quality_finding_refs},
      idempotency_key: revise.idempotency_key
    }

    {:ok, _action_result, revision_turn} =
      DialogueGateway.handle_action(input, source, revise_complete(agent))

    {revision_turn, agent |> Agent.get(& &1) |> Enum.join("\n\n")}
  end

  defp revise_action(turn_result) do
    Enum.find(turn_result.available_actions, &(&1.action_type == "revise_from_findings"))
  end

  defp revise_complete(agent \\ nil) do
    fn prompt ->
      if agent, do: Agent.update(agent, &[prompt | &1])

      {:ok,
       %{
         provider_call_id: "pc-revision",
         content:
           Jason.encode!(%{
             items: [
               %{item_id: "rev-item", title: "第01章（修订）", body: @revised_body, rationale: nil}
             ],
             self_report: %{
               assumptions: [],
               intended_reader_effect: nil,
               used_context_refs: [],
               risk_flags: []
             }
           })
       }}
    end
  end

  defp run_prose_turn do
    complete = fn _prompt ->
      {:ok,
       %{
         content:
           Jason.encode!(%{
             items: [%{item_id: "cp3-item", title: "第01章", body: @bad_prose, rationale: nil}],
             self_report: %{
               assumptions: [],
               intended_reader_effect: nil,
               used_context_refs: [],
               risk_flags: []
             }
           })
       }}
    end

    {turn_result, _trace} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(),
        decision: allow_decision(),
        context: context(),
        author_input: %{text: "写第一章正文首稿"},
        provider_execution: %Execution{complete_fn: complete}
      })

    turn_result
  end

  defp context do
    %DialogueContext{
      workspace_id: @work,
      current_chapters: ["第01章：开端"],
      structured_chapters: [%{title: "第01章：开端", seq: 1, summary: "主角登场。", has_prose: false}],
      assembly_policy: AssemblyPolicy.for_tier(:floor)
    }
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
      author_visible_draft: %{message: "写第一章正文首稿"},
      evidence_summary: %{},
      uncertainty: []
    }
  end

  defp plan do
    %MicroPlan{
      plan_id: "plan-cp3",
      turn_id: "turn-cp3",
      frame_ref: "frame-cp3",
      plan_goal: %{summary: "写作"},
      risk_hint: :low,
      proposed_actions: [
        %{
          action_id: "act-cp3",
          action_type: :capability_invocation,
          summary: "正文",
          target_ref: "prose_writing",
          write_intent: :tentative,
          risk_hint: :low,
          authoring_intent: nil,
          requested_chapter_raw: nil,
          target_chapter: "第01章：开端"
        }
      ]
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
