defmodule NovelAgent.ProseQualityEvaluatorTest do
  use ExUnit.Case, async: true

  alias NovelAgent.ProseQualityEvaluator
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.RequestIR
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.QualityEvaluationRequest
  alias NovelCommon.Contracts.QualityEvaluationResult

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

  test "复用其它角色会话进入 evaluator 时完整只读规则和输出契约进入最新 scope" do
    request = request()

    previous =
      RequestIR.new(%{
        run: %{run_id: "real-run", work_id: "real-work"},
        system: RequestIR.system_envelope(),
        projection: %{},
        messages: [
          RequestIR.message(:application_base, :application, [RequestIR.text_block("首阶段只承担计划起草。")]),
          RequestIR.message(:user, :author, [RequestIR.text_block(request.task.author_words)])
        ]
      })

    assert {:ok, evaluator} = ProseQualityEvaluator.request_ir(%{request | request_ir: previous})
    assert Enum.take(evaluator.messages, length(previous.messages)) == previous.messages
    latest = List.last(evaluator.messages).blocks |> Enum.map_join("", & &1.text)
    assert latest =~ AuthoringSemantics.static_block(request.task)
    assert latest =~ "只读评审，不重写正文，不修改作品事实"
    assert latest =~ "输出契约（调用 report_quality_findings"
    assert Enum.count(evaluator.messages, &(&1.role == "user")) == 1
    assert evaluator.run == previous.run
  end

  test "独立质量外观标记有限会话且不伪造作品身份，真实 run 不降级" do
    request = request()
    assert {:ok, standalone} = ProseQualityEvaluator.request_ir(request)
    assert standalone.run == %{run_id: request.request_id}
    assert standalone.projection.finite_mode.name == "standalone_operation"
    assert standalone.projection.finite_mode.durable_recovery == false

    run = %{run_id: "actual-quality-run", work_id: "actual-work"}
    assert {:ok, bound} = ProseQualityEvaluator.request_ir(Map.put(request, :run, run))
    assert bound.run == run
    assert Map.get(bound.projection, :finite_mode) == nil
  end

  defp provider_execution(result_fn),
    do: AuthoringTaskFixtures.provider_execution(result_fn, "report_quality_findings")

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
      assert NovelAgent.Provider.tool_choice(prompt) == "report_quality_findings"

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

  test "prompt is an evaluator prompt (not prose anchors) and never asks to rewrite" do
    test_pid = self()

    complete = fn prompt ->
      send(test_pid, {:prompt, prompt})
      {:ok, %{content: findings_json([])}}
    end

    ProseQualityEvaluator.evaluate(request(), provider_execution(complete))
    assert_receive {:prompt, prompt}
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
    assert_receive {:prompt, prompt}
    assert prompt =~ "任务 A：局部形式候选的语义判定"
    assert prompt =~ "机械重复与刻意排比"
    assert prompt =~ "fc_scope"
    assert prompt =~ "任务 B：章节级叙事节奏独立评审"
    assert prompt =~ "主线推进章"
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

      if prompt =~ "evaluator_invalid_json" do
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

    assert_receive {:prompt, first_prompt}
    assert_receive {:prompt, retry_prompt}
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
    assert_receive {:prompt, prompt}
    assert prompt =~ "本章计划场次"
    assert prompt =~ "scene_1（交锋）"
    assert prompt =~ "scene_2（撤退）"
    assert prompt =~ "brief_field_refs"
    assert prompt =~ "禁止发明不存在的场 id"
  end
end
