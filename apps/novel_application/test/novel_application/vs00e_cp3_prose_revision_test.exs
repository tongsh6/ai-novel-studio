defmodule NovelApplication.VS00ECP3ProseRevisionTest do
  @moduledoc """
  VS-00E CP3：按质量发现重写（revise_from_findings）。

  覆盖：本轮有发现 + 待采纳正文 → 暴露 revise_from_findings 动作；动作经 DialogueGateway
  产出一个新的 tentative 修订草稿（原草稿保留、不自动采纳、不自我递归评估）；修订请求保留
  prose 三锚点；反“凭空发明动作”。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.RequestIR
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.DialogueGateway
  alias NovelApplication.ProseRevisionService
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelApplication.TurnExecutionService
  alias NovelDomain.AgentRun
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
    assert "qf_cp3_uniform" in revise.quality_finding_refs
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

    # B27 CP3b：修订由 revision task 渲染，操作互斥来自共享语义，不再继承基础续写句
    assert prompt =~ "## 创作协作共同规则"
    assert prompt =~ "本轮为修订"
    assert prompt =~ "## 必须保留"
    refute prompt =~ "请在其后自然衔接续写"
    assert prompt =~ "本次修订范围：局部修订"
    assert prompt =~ "命中范围外的文字应尽量逐字保持不变"
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
    assert "qf_cp3_uniform" in card.quality_finding_refs
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
    # ADR-0004 #3：决策 trace 闭合——TurnResult 决策引用与 trace_summary 同源。
    assert revision_turn.orchestrator_decision.decision_trace_ref ==
             revision_turn.trace_summary.trace_ref

    assert String.starts_with?(revision_turn.trace_summary.decision_ref, "decision_")
    assert String.starts_with?(revision_turn.trace_summary.tool_request_id, "tq_rev_")
    assert String.starts_with?(revision_turn.trace_summary.tool_result_id, "tr_")
    assert revision_turn.trace_summary.replay_policy.recall_provider == false
    assert revision_turn.trace_summary.revision_provider_call_ref == "pc-revision"

    # 旧 standalone 外观与新 bound run 共用同一交换边界：允许上限取 NativeToolExchange
    # 的默认/验证边界（2），实际消耗另记 execution_counts。仍只有一次 writer 调用，
    # 没有额外质量或叙述调用。
    assert revision_turn.trace_summary.provider_call_budget.revision_writer == 2
    assert revision_turn.trace_summary.execution_counts == %{provider_calls: 1, tool_calls: 1}

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

  test "execute_revision/6 preserves the prior transcript prefix, original bytes, and real counts" do
    parent = self()
    source = run_prose_turn()
    action = revision_action_input(source, "b71-success")
    {:ok, prepared} = ProseRevisionService.prepare_revision(source, action)
    {:ok, planned} = ProseRevisionService.plan_revision(source, action)
    run = revision_run()
    snapshot = prior_snapshot(run)
    prior = snapshot.stage_state.judgment_transcript

    provider = %Execution{
      result_fn: fn prompt ->
        send(parent, {:revision_prompt, prompt})

        {:ok,
         %{
           provider_call_id: "pc-b71-success",
           content: "",
           tool_calls:
             TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
               items: [
                 %{
                   item_id: "rev-b71-success",
                   title: "第01章（修订）",
                   body: @revised_body,
                   rationale: nil
                 }
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
    }

    assert {:ok, result} =
             ProseRevisionService.execute_revision(
               source,
               action,
               prepared,
               planned,
               provider,
               %{run: run, snapshot: snapshot}
             )

    assert result.provider_call_count == 1
    assert result.tool_call_count == 1

    # 允许上限来自 run 剩余预算 clamp 到交换上限（2），实际消耗来自 session。
    assert result.turn_result.trace_summary.provider_call_budget.revision_writer == 2

    assert result.turn_result.trace_summary.execution_counts == %{
             provider_calls: 1,
             tool_calls: 1
           }

    # 对外 turn_result/action_result 不携带 canonical 会话、IR 或 Provider 私有结构。
    for key <- [
          :stage_state,
          :judgment_transcript,
          :request_ir,
          :provider_result,
          :execution
        ] do
      refute Map.has_key?(result.turn_result, key)
      refute Map.has_key?(result.action_result, key)
      refute Map.has_key?(result.turn_result.trace_summary, key)
    end

    transcript = result.stage_state.judgment_transcript
    assert transcript.run.run_id == run.run_id
    assert Enum.take(transcript.messages, length(prior.messages)) == prior.messages

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)

    assert result.artifact_set.revision_base == action.target_ref
    [revised] = result.artifact_set.items
    assert Map.get(revised, :body) == @revised_body

    assert_receive {:revision_prompt, prompt}
    assert NovelAgent.Provider.prompt_text(prompt) =~ @bad_prose
    assert user_texts(transcript) == ["把这一段改得更有压迫感。"]

    [original] = source.adoption_state.pending
    assert original.payload.items |> hd() |> Map.get(:body) == @bad_prose
  end

  test "execute_revision/6 records a failed native exchange without fabricating an assistant response" do
    parent = self()
    source = run_prose_turn()
    action = revision_action_input(source, "b71-failed-exchange")
    {:ok, prepared} = ProseRevisionService.prepare_revision(source, action)
    {:ok, planned} = ProseRevisionService.plan_revision(source, action)
    run = revision_run(max_provider_calls: 2, consumed_provider_calls: 0)
    snapshot = prior_snapshot(run)
    prior = snapshot.stage_state.judgment_transcript

    attempts = :counters.new(1, [])

    provider = %Execution{
      result_fn: fn prompt ->
        send(parent, {:revision_prompt, prompt})
        attempt = :counters.get(attempts, 1) + 1
        :counters.add(attempts, 1, 1)

        case attempt do
          1 ->
            {:ok,
             %{
               content: "",
               tool_calls:
                 TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{})
             }}

          2 ->
            {:error, :transport_closed}
        end
      end
    }

    assert {:error, _reason, step_state} =
             ProseRevisionService.execute_revision(
               source,
               action,
               prepared,
               planned,
               provider,
               %{run: run, snapshot: snapshot}
             )

    assert step_state.provider_call_count == 2
    assert step_state.tool_call_count == 1

    transcript = step_state.judgment_transcript
    assert transcript.run.run_id == run.run_id
    assert Enum.take(transcript.messages, length(prior.messages)) == prior.messages

    assert_receive {:revision_prompt, first_prompt}
    assert NovelAgent.Provider.prompt_text(first_prompt) =~ @bad_prose

    calls = tool_call_blocks(transcript)
    assert length(calls) == 1
    assert hd(calls).arguments == %{}

    assert [validation] = validation_blocks(transcript)
    assert validation.call_id == hd(calls).call_id
    assert validation.status == "failed"
    assert validation.reason_code == "invalid_items"

    assert Enum.count(transcript.messages, &(&1.role == "assistant")) == 1

    [original] = source.adoption_state.pending
    assert original.payload.items |> hd() |> Map.get(:body) == @bad_prose
  end

  test "execute_revision/6 spends only the remaining single provider call and closes the failed call" do
    parent = self()
    source = run_prose_turn()
    action = revision_action_input(source, "b71-one-budget")
    {:ok, prepared} = ProseRevisionService.prepare_revision(source, action)
    {:ok, planned} = ProseRevisionService.plan_revision(source, action)
    run = revision_run(max_provider_calls: 3, consumed_provider_calls: 2)
    snapshot = prior_snapshot(run)

    provider = %Execution{
      result_fn: fn _prompt ->
        send(parent, :provider_called)

        {:ok,
         %{
           content: "",
           tool_calls: TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{})
         }}
      end
    }

    assert {:error, _reason, step_state} =
             ProseRevisionService.execute_revision(
               source,
               action,
               prepared,
               planned,
               provider,
               %{run: run, snapshot: snapshot}
             )

    assert_received :provider_called
    refute_received :provider_called

    assert step_state.provider_call_count == 1
    assert step_state.tool_call_count == 1

    transcript = step_state.judgment_transcript
    [call] = tool_call_blocks(transcript)
    [validation] = validation_blocks(transcript)
    assert validation.call_id == call.call_id
    assert validation.status == "failed"
    assert validation.reason_code == "invalid_items"

    [original] = source.adoption_state.pending
    assert original.payload.items |> hd() |> Map.get(:body) == @bad_prose
  end

  test "execute_revision/6 reports the clamped allowed budget apart from the actual call" do
    source = run_prose_turn()
    action = revision_action_input(source, "b71-one-budget-success")
    {:ok, prepared} = ProseRevisionService.prepare_revision(source, action)
    {:ok, planned} = ProseRevisionService.plan_revision(source, action)
    run = revision_run(max_provider_calls: 3, consumed_provider_calls: 2)
    snapshot = prior_snapshot(run)

    provider = %Execution{
      result_fn: fn _prompt ->
        {:ok,
         %{
           provider_call_id: "pc-b71-one-budget-success",
           content: "",
           tool_calls:
             TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
               items: [
                 %{
                   item_id: "rev-b71-one-budget-success",
                   title: "第01章（修订）",
                   body: @revised_body,
                   rationale: nil
                 }
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
    }

    assert {:ok, result} =
             ProseRevisionService.execute_revision(
               source,
               action,
               prepared,
               planned,
               provider,
               %{run: run, snapshot: snapshot}
             )

    # 剩余 1 次是本次允许上限；实际也只花 1 次，二者分开记录。
    assert result.provider_call_count == 1
    assert result.tool_call_count == 1
    assert result.turn_result.trace_summary.provider_call_budget.revision_writer == 1

    assert result.turn_result.trace_summary.execution_counts == %{
             provider_calls: 1,
             tool_calls: 1
           }

    [original] = source.adoption_state.pending
    assert original.payload.items |> hd() |> Map.get(:body) == @bad_prose
  end

  test "execute_revision/6 does not call the provider when provider budget is exhausted" do
    source = run_prose_turn()
    action = revision_action_input(source, "b71-zero-budget")
    {:ok, prepared} = ProseRevisionService.prepare_revision(source, action)
    {:ok, planned} = ProseRevisionService.plan_revision(source, action)
    run = revision_run(max_provider_calls: 2, consumed_provider_calls: 2)
    snapshot = prior_snapshot(run)
    prior = snapshot.stage_state.judgment_transcript

    provider = %Execution{
      result_fn: fn _prompt -> flunk("0 剩余 Provider 预算不得调用模型") end
    }

    assert {:error, _reason, step_state} =
             ProseRevisionService.execute_revision(
               source,
               action,
               prepared,
               planned,
               provider,
               %{run: run, snapshot: snapshot}
             )

    # 前置预算拒绝是真实 0/0，已有历史原样保留，不伪造 assistant 或工具调用。
    assert step_state.provider_call_count == 0
    assert step_state.tool_call_count == 0

    transcript = step_state.judgment_transcript
    assert transcript.run.run_id == run.run_id
    assert transcript.messages == prior.messages
    assert tool_call_blocks(transcript) == []

    [original] = source.adoption_state.pending
    assert original.payload.items |> hd() |> Map.get(:body) == @bad_prose
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

    {revision_turn,
     agent |> Agent.get(& &1) |> Enum.map_join("\n\n", &NovelAgent.Provider.prompt_text/1)}
  end

  defp revise_action(turn_result) do
    Enum.find(turn_result.available_actions, &(&1.action_type == "revise_from_findings"))
  end

  defp revise_complete(agent \\ nil) do
    %Execution{
      result_fn: fn prompt ->
        if agent, do: Agent.update(agent, &[prompt | &1])

        {:ok,
         %{
           provider_call_id: "pc-revision",
           content: "",
           tool_calls:
             TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
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
    }
  end

  defp run_prose_turn do
    complete = fn _prompt ->
      {:ok,
       %{
         content: "",
         tool_calls:
           TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
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

    {turn_result, _trace, _transcript} =
      TurnExecutionService.execute(%{
        frame: frame(),
        plan: plan(),
        decision: allow_decision(),
        context: context(),
        author_input: %{text: "写第一章正文首稿"},
        provider_execution: %Execution{result_fn: complete},
        quality_provider_execution: quality_complete()
      })

    turn_result
  end

  defp quality_complete do
    %Execution{
      result_fn: fn _prompt ->
        {:ok,
         %{
           content: "",
           tool_calls:
             TestAgenticLoopFixtures.native_tool_calls("report_quality_findings", %{
               "findings" => [
                 %{
                   "quality_finding_id" => "qf_cp3_uniform",
                   "quality_gate_ref" => "quality_gate.style_fit",
                   "validator_ref" => "validator.sentence_rhythm_uniformity",
                   "severity" => "warn",
                   "action" => "warn",
                   "summary" => "连续动作句式机械重复",
                   "reasoning" => "相同骨架没有形成强度或后果递进。",
                   "confidence" => 0.88,
                   "impact_scope" => "local",
                   "revision_scope" => "local",
                   "evidence_spans" => [
                     %{
                       "text" => @bad_prose,
                       "sentence_start" => 1,
                       "sentence_end" => 4
                     }
                   ],
                   "suggested_revision" => %{"instruction" => "只改第 1–4 句。"}
                 }
               ]
             })
         }}
      end
    }
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

  test "B11D revision prompt carries the selected finding scene scope (candidate still whole chapter)" do
    source = run_prose_turn()

    findings =
      Enum.map(source.quality_review.findings, fn finding ->
        finding
        |> Map.put("scene_index", 2)
        |> Map.put("scene_title", "撤退")
      end)

    source = %{source | quality_review: Map.put(source.quality_review, :findings, findings)}

    {revision_turn, prompt} = revise(source)

    assert prompt =~ "场：第 2 场（撤退）"
    assert prompt =~ "场级作用域：第 2 场（撤退）"
    assert prompt =~ "其他场的正文必须逐字节保留"

    # 场级信息只约束改写范围；候选仍是完整章节草稿（revision_of 原稿保留）。
    assert [revision_pending] = revision_turn.adoption_state.pending
    assert to_string(revision_pending.artifact_type) == "prose_fragment"
    assert revision_turn.truthfulness.artifact_adopted == false
  end

  defp revision_action_input(source, suffix) do
    revise = revise_action(source)

    %AuthorActionInput{
      input_id: "in-#{suffix}",
      source_turn_ref: source.turn_id,
      action_id: revise.action_id,
      action_type: "revise_from_findings",
      target_ref: revise.target_ref,
      payload: %{"quality_finding_refs" => revise.quality_finding_refs},
      idempotency_key: "idem-#{suffix}"
    }
  end

  defp revision_run(opts \\ []) do
    max_provider_calls = Keyword.get(opts, :max_provider_calls, 2)
    consumed_provider_calls = Keyword.get(opts, :consumed_provider_calls, 0)

    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-b71-quality-revision-#{System.unique_integer([:positive])}",
        run_mode: :bounded,
        workspace_id: @work,
        work_id: @work,
        session_id: "session-b71-quality-revision",
        parent_turn_ref: "turn-b71-quality-revision",
        origin_frame_ref: "frame-b71-quality-revision",
        profile_ref: "prose_revision_from_findings_v1",
        status: :running,
        phase: :executing,
        goal: %{text: "按质量发现修订正文", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]},
        budget: %{
          max_steps: 4,
          max_tool_calls: 1,
          max_provider_calls: max_provider_calls,
          max_replans: 0,
          max_pending_artifacts: 1
        },
        consumed_budget: %{
          steps: 0,
          execution_steps: 0,
          tool_calls: 0,
          provider_calls: consumed_provider_calls,
          replans: 0
        }
      })

    run
  end

  defp prior_snapshot(run) do
    transcript =
      AuthoringTranscript.new(run,
        base_text: "角色规则：只提出待作者审阅的候选，不执行采纳。",
        author_text: "把这一段改得更有压迫感。",
        tools: [],
        projection: %{
          target: "chat_completions",
          capability_profile: Map.new(RequestIR.required_capabilities(), &{&1, true})
        }
      )

    %{stage_state: %{judgment_transcript: transcript}}
  end

  defp tool_call_blocks(%{messages: messages}) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) == "tool_call",
        do: block
  end

  defp validation_blocks(%{messages: messages}) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) == "validation_result",
        do: block
  end

  defp message_text(%{blocks: blocks}) do
    blocks
    |> Enum.filter(&(Map.get(&1, :type) == "text"))
    |> Enum.map_join("", &Map.get(&1, :text, ""))
  end

  defp user_texts(transcript) do
    transcript.messages
    |> Enum.filter(&(Map.get(&1, :role) == "user"))
    |> Enum.map(&message_text/1)
  end
end
