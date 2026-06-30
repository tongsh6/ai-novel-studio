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

  test "prompt is an evaluator prompt (not prose anchors) and never asks to rewrite" do
    test_pid = self()

    complete = fn prompt ->
      send(test_pid, {:prompt, prompt})
      {:ok, %{content: findings_json([])}}
    end

    ProseQualityEvaluator.evaluate(request(), complete)
    assert_receive {:prompt, prompt}
    assert prompt =~ "质量评审"
    assert prompt =~ "findings"
    refute prompt =~ "用户创作简述："
  end

  test "parses findings from JSON object" do
    finding = %{
      "quality_gate_ref" => "quality_gate.character_logic",
      "validator_ref" => "validator.character_agency",
      "severity" => "warn",
      "action" => "adoption_review",
      "summary" => "主角缺乏目标"
    }

    complete = fn _prompt -> {:ok, %{content: findings_json([finding])}} end
    result = ProseQualityEvaluator.evaluate(request(), complete)

    assert %QualityEvaluationResult{status: :ok, findings: [parsed]} = result
    assert parsed["validator_ref"] == "validator.character_agency"
  end

  test "preserves provider_call_ref from unified provider execution result" do
    complete = fn _prompt ->
      {:ok,
       %ProviderResult{content: findings_json([]), provider_call_ref: "pcall-evaluator-execution"}}
    end

    assert %QualityEvaluationResult{status: :ok, provider_call_ref: "pcall-evaluator-execution"} =
             ProseQualityEvaluator.evaluate(request(), complete)
  end

  test "accepts provider execution dependency" do
    provider_execution = %Execution{
      complete_fn: fn _prompt ->
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
    complete = fn _prompt -> {:ok, %{content: Jason.encode!([%{"validator_ref" => "v"}])}} end

    assert %QualityEvaluationResult{status: :ok, findings: [_]} =
             ProseQualityEvaluator.evaluate(request(), complete)
  end

  test "retries once on invalid JSON then succeeds" do
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    complete = fn _prompt ->
      n = Agent.get_and_update(counter, fn n -> {n, n + 1} end)
      if n == 0, do: {:ok, %{content: "这不是 JSON"}}, else: {:ok, %{content: findings_json([])}}
    end

    assert %QualityEvaluationResult{status: :ok} =
             ProseQualityEvaluator.evaluate(request(), complete)

    assert Agent.get(counter, & &1) == 2
  end

  test "double invalid JSON → honest error (not faked ok)" do
    complete = fn _prompt -> {:ok, %{content: "still not json"}} end

    assert %QualityEvaluationResult{status: :error} =
             ProseQualityEvaluator.evaluate(request(), complete)
  end

  test "provider error → error result" do
    complete = fn _prompt -> {:error, :timeout} end

    assert %QualityEvaluationResult{status: :error} =
             ProseQualityEvaluator.evaluate(request(), complete)
  end
end
