defmodule NovelAgent.ProseQualityEvaluatorTest do
  use ExUnit.Case, async: true

  alias NovelAgent.ProseQualityEvaluator
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result, as: ProviderResult
  alias NovelCommon.Contracts.QualityEvaluationRequest
  alias NovelCommon.Contracts.QualityEvaluationResult

  defp request(text \\ "他走进房间。") do
    %QualityEvaluationRequest{request_id: "qer_1", source_turn_ref: "turn_1", prose_text: text}
  end

  defp findings_json(findings), do: Jason.encode!(%{"findings" => findings})
  defp provider_execution(result_fn), do: %Execution{result_fn: result_fn}

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
      }
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
           content: findings_json([]),
           provider_call_ref: "pcall-evaluator-dependency"
         }}
      end
    }

    assert %QualityEvaluationResult{
             status: :ok,
             provider_call_ref: "pcall-evaluator-dependency"
           } = ProseQualityEvaluator.evaluate(request(), provider_execution)
  end

  test "accepts bare JSON array of findings" do
    complete = fn _prompt -> {:ok, %{content: Jason.encode!([valid_finding()])}} end

    assert %QualityEvaluationResult{status: :ok, findings: [_]} =
             ProseQualityEvaluator.evaluate(request(), provider_execution(complete))
  end

  test "retries when a finding omits author-verifiable evidence fields" do
    test_pid = self()

    complete = fn prompt ->
      send(test_pid, {:prompt, prompt})

      if prompt =~ "上一次的输出" do
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
    assert retry_prompt =~ "字段完整"
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
end
