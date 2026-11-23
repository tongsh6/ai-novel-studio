defmodule NovelAgent.ProseQualityEvaluatorTest do
  use ExUnit.Case, async: true

  alias NovelAgent.ProseQualityEvaluator
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.QualityEvaluationRequest
  alias NovelCommon.Contracts.QualityEvaluationResult
  alias NovelCommon.RequestIR
  alias NovelTest.TestProviderPrompt

  alias NovelAgent.TestSupport.AuthoringTaskFixtures

  defp request(text \\ "他走进房间。") do
    %QualityEvaluationRequest{
      request_id: "qer_1",
      source_turn_ref: "turn_1",
      prose_text: text,
      task: AuthoringTaskFixtures.quality_evaluation_task()
    }
  end

  defp findings_json(findings), do: Jason.encode!(%{"findings" => findings})

  test "首次及续行 evaluator 只把真实材料列入 Base，作者与普通来源仍保持原归属" do
    author_ref = "turn:quality-author"
    raw_author = "  质量评审原话 Ω\n保留全部字节。  "

    material_refs = [
      %{ref: "prose:quality-material", version: 7},
      %{ref: "chapter:quality-material"}
    ]

    run = %{run_id: "real-run", work_id: "real-work", parent_turn_ref: "turn:initial-author"}

    request = %{
      request()
      | source_ref: "prose:quality-material",
        run: run,
        task:
          AuthoringTaskFixtures.quality_evaluation_task(%{
            author_words: raw_author,
            source: %{kind: :author_action, ref: author_ref},
            source_refs: [author_ref, "turn:quality-linked-source"],
            materials: [
              %{kind: :prose, ref: "prose:quality-material", version: 7, complete?: true},
              %{kind: :target_structure, ref: "chapter:quality-material", complete?: true}
            ]
          })
    }

    assert {:ok, initial} = ProseQualityEvaluator.request_ir(request)

    previous =
      RequestIR.new(%{
        run: run,
        system: RequestIR.system_envelope(),
        projection: %{},
        refs: %{base_refs: [], observation_refs: [], used_refs: []},
        messages: [
          RequestIR.message(:application_base, :application, [RequestIR.text_block("首阶段只承担计划起草。")]),
          RequestIR.message(:user, :author, [RequestIR.text_block(raw_author)], %{
            source_refs: [%{ref: author_ref}]
          })
        ]
      })

    assert {:ok, evaluator} = ProseQualityEvaluator.request_ir(%{request | request_ir: previous})
    assert Enum.take(evaluator.messages, length(previous.messages)) == previous.messages
    assert evaluator.system == previous.system

    assert [
             %{
               role: "application_notice",
               provenance: "application",
               blocks: [%{type: "text", text: rules}]
             },
             %{role: "scope_update", provenance: "application"}
           ] = Enum.drop(evaluator.messages, length(previous.messages))

    for ir <- [initial, evaluator] do
      assert ir.refs.base_refs == material_refs
      assert ir.refs.observation_refs == []
      current_scope = Enum.find(Enum.reverse(ir.messages), &(&1.role == "scope_update"))

      assert current_scope.source_refs ==
               material_refs ++
                 [
                   %{ref: request.source_turn_ref},
                   %{ref: author_ref},
                   %{ref: "turn:quality-linked-source"}
                 ]

      assert [%{source_refs: [%{ref: ^author_ref}], blocks: [%{type: "text", text: ^raw_author}]}] =
               Enum.filter(ir.messages, &(&1.role == "user" and &1.provenance == "author"))
    end

    scope = TestProviderPrompt.scope_content(evaluator)
    assert rules =~ AuthoringSemantics.static_block(request.task)
    assert rules =~ "只读评审，不重写正文，不修改作品事实"
    assert rules =~ "输出契约（调用 report_quality_findings"
    assert scope["operation"]["prose_text"] == request.prose_text
    assert TestProviderPrompt.author_text(evaluator) == raw_author
    assert Enum.count(evaluator.messages, &(&1.role == "user")) == 1
    assert evaluator.run == previous.run
  end

  test "质量材料回合、父回合和质量触发来源都不能补作者输入引用" do
    raw_author = "  只评审我的这条原话。\r\nΩ é 雪。  "
    run = %{run_id: "quality-pair", work_id: "quality-work", parent_turn_ref: "turn:old-author"}

    for source <- [nil, %{kind: :quality_finding, ref: "finding:trigger"}] do
      request = %{
        request()
        | run: run,
          source_turn_ref: "turn:prose-material",
          task:
            AuthoringTaskFixtures.quality_evaluation_task(%{
              author_words: raw_author,
              source: source,
              source_refs: ["turn:linked-source"]
            })
      }

      assert {:error, :invalid_author_input} = ProseQualityEvaluator.request_ir(request)
    end

    request = %{
      request()
      | run: run,
        source_turn_ref: "turn:prose-material",
        task:
          AuthoringTaskFixtures.quality_evaluation_task(%{
            author_words: nil,
            source: %{kind: :quality_finding, ref: "finding:trigger"}
          })
    }

    assert {:ok, ir} = ProseQualityEvaluator.request_ir(request)
    refute Enum.any?(ir.messages, &(&1.role == "user"))
  end

  test "独立质量外观不伪造作品身份也不写传输有限模式，真实 run 不降级" do
    request = request()
    assert {:ok, standalone} = ProseQualityEvaluator.request_ir(request)
    assert standalone.run == %{run_id: request.request_id}

    # standalone 是运行归属差异，不是传输能力受限：不得进入 IR.projection.finite_mode
    assert standalone.projection == %{}

    run = %{run_id: "actual-quality-run", work_id: "actual-work"}
    assert {:ok, bound} = ProseQualityEvaluator.request_ir(Map.put(request, :run, run))
    assert bound.run == run
    assert bound.projection == %{}
  end

  defp provider_execution(result_fn) do
    %Execution{
      result_fn: fn ir ->
        native =
          AuthoringTaskFixtures.provider_execution(
            fn _ -> result_fn.(ir) end,
            "report_quality_findings"
          )

        native.result_fn.(ir)
      end
    }
  end

  defp valid_finding(overrides \\ %{}) do
    Map.merge(
      %{
        "quality_finding_id" => "qf_character_agency",
        "quality_gate_ref" => "quality_gate.character_logic",
        "validator_ref" => "validator.character_agency",
        "severity" => "warn",
        "action" => "adoption_review",
        "summary" => "主角缺乏目标",
        "reasoning" => "原句只写了被动移动，没有呈现主角作出的选择。",
        "evidence_spans" => [
          %{"text" => "他走进房间。", "sentence_start" => 1, "sentence_end" => 1}
        ],
        "impact_scope" => "local",
        "revision_scope" => "local",
        "brief_field_refs" => [],
        "confidence" => 0.86,
        "suggested_revision" => %{"instruction" => "补出一个可观察的主动选择。"}
      },
      overrides
    )
  end

  test "G4 evaluator uses native finding tool and preserves the preceding session" do
    assert {:ok, initial_ir} = ProseQualityEvaluator.request_ir(request())
    assert [%{name: "report_quality_findings"}] = initial_ir.tools

    result_fn = fn prompt ->
      assert %RequestIR{} = prompt
      assert prompt.messages == initial_ir.messages
      assert [%{name: "report_quality_findings"}] = prompt.tools
      assert RequestIR.Tools.tool_choice(prompt) == "report_quality_findings"

      {:ok,
       %{
         content: "",
         tool_calls: [
           %{
             id: "quality-call-1",
             name: "report_quality_findings",
             arguments: %{findings: []}
           }
         ]
       }}
    end

    assert {%QualityEvaluationResult{status: :ok, findings: []}, session} =
             ProseQualityEvaluator.evaluate_with_session(request(), %Execution{
               result_fn: result_fn
             })

    assert session.provider_result.tool_calls |> hd() |> Map.get(:id) == "quality-call-1"
    assert List.last(session.request_ir.messages).role == "assistant"
  end

  test "质量并行调用整体失败且所有 call 都留有闭合结果" do
    execution = %Execution{
      result_fn: fn _ ->
        {:ok,
         %{
           content: "",
           tool_calls: [
             %{id: "a", name: "report_quality_findings", arguments: %{findings: []}},
             %{id: "b", name: "report_quality_findings", arguments: %{findings: []}}
           ]
         }}
      end
    }

    assert {%QualityEvaluationResult{status: :error}, session} =
             ProseQualityEvaluator.evaluate_with_session(request(), execution)

    ir = session.request_ir
    assert :ok = RequestIR.validate(ir)

    calls =
      for message <- ir.messages,
          block <- message.blocks,
          block.type == "tool_call",
          do: block.call_id

    results =
      for message <- ir.messages,
          block <- message.blocks,
          block.type in ["observation", "validation_result"],
          do: block.call_id

    assert length(calls) == 4
    assert calls == results
  end

  @standalone_rejection_fact "本次响应未通过接收，未作为任务回复发布；仍在处理原任务。\n"

  defp standalone_request(id) do
    %{
      request()
      | request_id: id,
        source_turn_ref: "turn:quality-material",
        source_ref: "prose:r08-quality",
        task:
          AuthoringTaskFixtures.quality_evaluation_task(%{
            author_words: nil,
            source: nil,
            source_refs: ["prose:r08-quality"],
            scope: %{refs: ["prose:r08-quality"], coverage: :single},
            materials: [
              %{kind: :prose, ref: "prose:r08-quality", version: 7, complete?: true}
            ],
            operation_effect: :evaluate
          })
    }
  end

  @tag :r08_standalone_response_rejection
  test "R08 standalone 质量评审拒收有文响应后以真实工具纠正，不伪造作者" do
    request = standalone_request("qer-r08-standalone-text")
    assert request.request_ir == nil
    assert request.run == nil
    assert request.task.author_words == nil
    assert request.task.source == nil
    original = "  尚未按工具契约返回的质量意见。\r\n保留这次原始响应。  "

    rejected = %{
      content: original,
      tool_calls: [],
      provider_call_ref: "pcall-quality-rejected",
      provider_run_ref: "prun-quality-rejected"
    }

    accepted = %{
      content: "",
      tool_calls: [
        %{
          id: "quality-report-second",
          name: "report_quality_findings",
          arguments: %{findings: []}
        }
      ],
      provider_call_ref: "pcall-quality-corrected",
      provider_run_ref: "prun-quality-corrected"
    }

    test_pid = self()
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    execution = %Execution{
      result_fn: fn prompt ->
        count = Agent.get_and_update(counter, fn n -> {n + 1, n + 1} end)
        send(test_pid, {:standalone_quality_request, count, prompt})

        case count do
          1 -> {:ok, rejected}
          2 -> {:ok, accepted}
          _ -> flunk("standalone 质量纠错不得追加第三次调用")
        end
      end
    }

    assert {%QualityEvaluationResult{status: :ok, findings: []}, session} =
             ProseQualityEvaluator.evaluate_with_session(request, execution)

    assert session.provider_call_count == 2
    assert session.provider_call_budget == 2
    assert Agent.get(counter, & &1) == 2
    assert_receive {:standalone_quality_request, 1, first}
    assert_receive {:standalone_quality_request, 2, retry}
    refute_receive {:standalone_quality_request, _, _}, 10
    assert Enum.take(retry.messages, length(first.messages)) == first.messages
    assert TestProviderPrompt.scope_content(retry) == TestProviderPrompt.scope_content(first)
    assert first.refs.base_refs == [%{ref: "prose:r08-quality", version: 7}]

    scope = Enum.find(first.messages, &(&1.role == "scope_update"))

    assert scope.source_refs == [
             %{ref: "prose:r08-quality", version: 7},
             %{ref: "turn:quality-material"}
           ]

    for ir <- [first, retry, session.request_ir] do
      assert ir.run == %{run_id: "qer-r08-standalone-text"}
      refute Enum.any?(ir.messages, &(&1.role == "user" or &1.provenance == "author"))
    end

    assert [response, notice, corrected] =
             Enum.drop(session.request_ir.messages, length(first.messages))

    assert response.role == "assistant"
    assert response.provenance == "model"
    assert response.blocks == [RequestIR.text_block(original)]
    assert response.provider_call_ref == "pcall-quality-rejected"
    assert response.provider_run_ref == "prun-quality-rejected"
    assert notice.role == "application_notice"
    assert notice.provenance == "application"
    assert notice.provider_call_ref == "pcall-quality-rejected"
    assert notice.provider_run_ref == "prun-quality-rejected"
    assert [receipt] = notice.blocks
    assert receipt.type == "validation_result"
    assert receipt.status == "failed"
    assert receipt.reason_code == "native_tool_call_required"

    assert receipt.detail["message"] ==
             @standalone_rejection_fact <>
               "原生工具响应不符合契约：native_tool_call_required；请只调用 report_quality_findings 一次并满足其参数契约。"

    assert receipt.retryable == true

    assert receipt.budget_after == %{
             "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => 1}
           }

    refute Map.has_key?(receipt, :call_id)
    refute Map.has_key?(receipt, :provider_call_ref)
    refute Map.has_key?(receipt, :provider_run_ref)
    assert Enum.drop(retry.messages, length(first.messages)) == [response, notice]
    assert corrected.role == "assistant"
    assert corrected.provider_call_ref == "pcall-quality-corrected"
    assert corrected.provider_run_ref == "prun-quality-corrected"
    assert RequestIR.call_ids(retry.messages) == []
    assert RequestIR.call_ids(session.request_ir.messages) == ["quality-report-second"]
    assert :ok = RequestIR.validate(session.request_ir)
  end

  @tag :r08_standalone_response_rejection
  test "R08 standalone 质量评审两次空或思考响应有界拒绝，保留无文原件与失败事实" do
    for {label, private_states} <- [
          {"empty", [%{}, %{}]},
          {"thinking",
           [
             %{"reasoning_content" => "第一次真实思考，不是任务回复。"},
             %{"reasoning_content" => "第二次真实思考，也没有可见正文。"}
           ]}
        ] do
      request = standalone_request("qer-r08-standalone-#{label}")
      assert request.request_ir == nil
      assert request.run == nil
      assert request.task.author_words == nil
      test_pid = self()
      {:ok, counter} = Agent.start_link(fn -> 0 end)

      execution = %Execution{
        result_fn: fn prompt ->
          count = Agent.get_and_update(counter, fn n -> {n + 1, n + 1} end)
          send(test_pid, {:standalone_empty_request, label, count, prompt})
          assert count in [1, 2], "standalone 空响应不得追加第三次调用"

          {:ok,
           %{
             content: "",
             tool_calls: [],
             provider_state: Enum.at(private_states, count - 1),
             provider_call_ref: "pcall-quality-#{label}-#{count}",
             provider_run_ref: "prun-quality-#{label}-#{count}"
           }}
        end
      }

      assert {%QualityEvaluationResult{
                status: :error,
                findings: [],
                error: %{code: "native_tool_call_required"}
              }, session} = ProseQualityEvaluator.evaluate_with_session(request, execution)

      assert session.provider_call_count == 2
      assert session.provider_call_budget == 2
      assert Agent.get(counter, & &1) == 2
      assert_receive {:standalone_empty_request, ^label, 1, first}
      assert_receive {:standalone_empty_request, ^label, 2, retry}
      refute_receive {:standalone_empty_request, ^label, _, _}, 10
      assert Enum.take(retry.messages, length(first.messages)) == first.messages
      assert TestProviderPrompt.scope_content(retry) == TestProviderPrompt.scope_content(first)

      for ir <- [first, retry, session.request_ir] do
        assert ir.run == %{run_id: request.request_id}
        refute Enum.any?(ir.messages, &(&1.role == "user" or &1.provenance == "author"))
      end

      assert [
               %{role: "assistant", provenance: "model", blocks: []} = first_response,
               %{role: "application_notice", provenance: "application"} = first_notice,
               %{role: "assistant", provenance: "model", blocks: []} = last_response,
               %{role: "application_notice", provenance: "application"} = last_notice
             ] = Enum.drop(session.request_ir.messages, length(first.messages))

      assert [first_response.provider_state, last_response.provider_state] == private_states

      assert Enum.drop(retry.messages, length(first.messages)) == [
               first_response,
               first_notice
             ]

      for {{response, notice}, count} <-
            Enum.with_index([{first_response, first_notice}, {last_response, last_notice}], 1) do
        assert response.provider_call_ref == "pcall-quality-#{label}-#{count}"
        assert response.provider_run_ref == "prun-quality-#{label}-#{count}"
        assert notice.provider_call_ref == response.provider_call_ref
        assert notice.provider_run_ref == response.provider_run_ref
        assert [receipt] = notice.blocks
        assert receipt.type == "validation_result"
        assert receipt.status == "failed"
        assert receipt.reason_code == "native_tool_call_required"

        assert receipt.detail["message"] ==
                 @standalone_rejection_fact <>
                   "原生工具响应不符合契约：native_tool_call_required；请只调用 report_quality_findings 一次并满足其参数契约。"

        assert receipt.retryable == (count == 1)

        assert receipt.budget_after == %{
                 "exchange" => %{"provider_call_budget" => 2, "provider_call_count" => count}
               }

        refute Map.has_key?(receipt, :call_id)
        refute Map.has_key?(receipt, :provider_call_ref)
        refute Map.has_key?(receipt, :provider_run_ref)
      end

      assert session.provider_result.provider_state == List.last(private_states)
      assert RequestIR.call_ids(session.request_ir.messages) == []
      assert {:ok, []} = RequestIR.pending_call_ids(session.request_ir)
      assert :ok = RequestIR.validate(session.request_ir)
    end
  end

  test "prompt is an evaluator prompt (not prose anchors) and never asks to rewrite" do
    test_pid = self()

    complete = fn prompt ->
      send(test_pid, {:prompt, prompt})
      {:ok, %{content: findings_json([])}}
    end

    ProseQualityEvaluator.evaluate(request(), provider_execution(complete))
    assert_receive {:prompt, ir}
    prompt = AuthoringTaskFixtures.prompt_text(ir)
    assert prompt =~ "质量评审"
    assert prompt =~ "findings"
    refute prompt =~ "用户创作简述："
  end

  test "prompt keeps form adjudication and chapter pacing as two explicit tasks" do
    test_pid = self()

    request = %QualityEvaluationRequest{
      request_id: "qer_scope",
      source_turn_ref: "turn_scope",
      prose_text: "他侧身。他挥刀。他格挡。",
      form_candidates: [
        %{
          "candidate_id" => "fc_scope",
          "sentence_start" => 1,
          "sentence_end" => 3,
          "evidence_spans" => [%{"text" => "他侧身。他挥刀。他格挡。"}]
        }
      ],
      pacing_context: %{
        "chapter_direction" => %{
          "chapter_role" => "主线推进章",
          "plot_progress" => "主角必须夺回证据"
        }
      },
      task: AuthoringTaskFixtures.quality_evaluation_task()
    }

    complete = fn prompt ->
      send(test_pid, {:prompt, prompt})
      {:ok, %{content: findings_json([])}}
    end

    ProseQualityEvaluator.evaluate(request, provider_execution(complete))
    assert_receive {:prompt, ir}
    prompt = AuthoringTaskFixtures.prompt_text(ir)
    assert prompt =~ "任务 A：局部形式候选的语义判定"
    assert prompt =~ "机械重复与刻意排比"

    assert TestProviderPrompt.scope_content(ir)["operation"]["form_candidates"] ==
             request.form_candidates

    assert prompt =~ "任务 B：章节级叙事节奏独立评审"

    assert TestProviderPrompt.scope_content(ir)["operation"]["pacing_context"] ==
             request.pacing_context

    assert prompt =~ "validator.narrative_pacing_fit"
    assert prompt =~ "不是句长、句数、段落长度或对白"
  end

  test "parses findings from JSON object" do
    finding = valid_finding()

    complete = fn _prompt -> {:ok, %{content: findings_json([finding])}} end
    result = ProseQualityEvaluator.evaluate(request(), provider_execution(complete))

    assert %QualityEvaluationResult{status: :ok, findings: [parsed]} = result
    assert parsed["validator_ref"] == "validator.character_agency"
  end

  test "preserves provider_call_ref from unified provider execution result" do
    complete = fn _prompt ->
      {:ok,
       %ProviderResult{content: findings_json([]), provider_call_ref: "pcall-evaluator-execution"}}
    end

    assert %QualityEvaluationResult{status: :ok, provider_call_ref: "pcall-evaluator-execution"} =
             ProseQualityEvaluator.evaluate(request(), provider_execution(complete))
  end

  test "accepts provider execution dependency" do
    provider_execution = %Execution{
      result_fn: fn _prompt ->
        {:ok,
         %ProviderResult{
           content: "",
           tool_calls: [
             %{id: "native-quality", name: "report_quality_findings", arguments: %{findings: []}}
           ],
           provider_call_ref: "pcall-evaluator-dependency"
         }}
      end
    }

    assert %QualityEvaluationResult{
             status: :ok,
             provider_call_ref: "pcall-evaluator-dependency"
           } = ProseQualityEvaluator.evaluate(request(), provider_execution)
  end

  test "缺失证据字段时以原生工具结果纠错" do
    test_pid = self()

    complete = fn prompt ->
      send(test_pid, {:prompt, prompt})

      if AuthoringTaskFixtures.prompt_text(prompt) =~ "evaluator_invalid_json" do
        {:ok, %{content: findings_json([valid_finding()])}}
      else
        {:ok,
         %{
           content:
             findings_json([
               Map.drop(valid_finding(), [
                 "evidence_spans",
                 "reasoning",
                 "impact_scope",
                 "revision_scope",
                 "confidence"
               ])
             ])
         }}
      end
    end

    assert %QualityEvaluationResult{status: :ok, findings: [_]} =
             ProseQualityEvaluator.evaluate(request(), provider_execution(complete))

    assert_receive {:prompt, first_ir}
    assert_receive {:prompt, retry_ir}
    assert Enum.take(retry_ir.messages, length(first_ir.messages)) == first_ir.messages

    assert TestProviderPrompt.scope_content(retry_ir) ==
             TestProviderPrompt.scope_content(first_ir)

    first_prompt = AuthoringTaskFixtures.prompt_text(first_ir)
    retry_prompt = AuthoringTaskFixtures.prompt_text(retry_ir)
    refute first_prompt =~ "上一次的输出"
    assert retry_prompt =~ "evaluator_invalid_json"
    assert retry_prompt =~ "关联：fixture-native-1"
    assert retry_prompt =~ "quality_finding_id"
  end

  test "double incomplete findings JSON degrades honestly" do
    incomplete = findings_json([Map.delete(valid_finding(), "evidence_spans")])
    complete = fn _prompt -> {:ok, %{content: incomplete}} end

    assert %QualityEvaluationResult{status: :error} =
             ProseQualityEvaluator.evaluate(request(), provider_execution(complete))
  end

  test "retries once on invalid JSON then succeeds" do
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    complete = fn _prompt ->
      n = Agent.get_and_update(counter, fn n -> {n, n + 1} end)
      if n == 0, do: {:ok, %{content: "这不是 JSON"}}, else: {:ok, %{content: findings_json([])}}
    end

    assert %QualityEvaluationResult{status: :ok} =
             ProseQualityEvaluator.evaluate(request(), provider_execution(complete))

    assert Agent.get(counter, & &1) == 2
  end

  test "double invalid JSON → honest error (not faked ok)" do
    complete = fn _prompt -> {:ok, %{content: "still not json"}} end

    assert %QualityEvaluationResult{status: :error} =
             ProseQualityEvaluator.evaluate(request(), provider_execution(complete))
  end

  test "provider error → error result" do
    complete = fn _prompt -> {:error, :timeout} end

    assert %QualityEvaluationResult{status: :error} =
             ProseQualityEvaluator.evaluate(request(), provider_execution(complete))
  end

  test "B11D prompt lists legal scene units for scene-attributed findings" do
    test_pid = self()

    request = %QualityEvaluationRequest{
      request_id: "qer_scenes",
      source_turn_ref: "turn_scenes",
      prose_text: "他侧身。他挥刀。他格挡。",
      scene_units: [
        %{"unit_id" => "scene_1", "scene_title" => "交锋"},
        %{"unit_id" => "scene_2", "scene_title" => "撤退"}
      ],
      task: AuthoringTaskFixtures.quality_evaluation_task()
    }

    complete = fn prompt ->
      send(test_pid, {:prompt, prompt})
      {:ok, %{content: findings_json([])}}
    end

    ProseQualityEvaluator.evaluate(request, provider_execution(complete))
    assert_receive {:prompt, ir}
    prompt = AuthoringTaskFixtures.prompt_text(ir)
    assert TestProviderPrompt.scope_content(ir)["operation"]["scene_units"] == request.scene_units
    assert prompt =~ "brief_field_refs"
    assert prompt =~ "operation.scene_units 是合法场次清单，finding 的 brief_field_refs 只能使用其中的 unit_id"
  end
end
