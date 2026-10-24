defmodule NovelAgent.ProseQualityEvaluatorTaskTest do
  use ExUnit.Case, async: true

  alias NovelAgent.ProseQualityEvaluator
  alias NovelAgent.Provider.Execution
  alias NovelCommon.AuthoringSemantics
  alias NovelCommon.Contracts.AuthoringTask
  alias NovelCommon.Contracts.QualityEvaluationRequest

  @valid_findings Jason.encode!(%{
                    "findings" => [
                      %{
                        "quality_finding_id" => "qf_1",
                        "quality_gate_ref" => "quality_gate.pacing",
                        "validator_ref" => "validator.narrative_pacing_fit",
                        "summary" => "节奏拖沓",
                        "reasoning" => "环境描写连续三段没有事件推进",
                        "evidence_spans" => [
                          %{"text" => "夜色压在账单上", "sentence_start" => 1, "sentence_end" => 1}
                        ],
                        "impact_scope" => "local",
                        "revision_scope" => "local",
                        "confidence" => 0.6
                      }
                    ]
                  })

  defp evaluation_task do
    %AuthoringTask{
      kind: :quality_evaluation,
      author_goal: "评审本轮生成的正文候选",
      scope: %{refs: ["as_1"], coverage: :single, target_chapter_ref: "chapter:one"},
      materials: [
        %{
          kind: :prose,
          ref: "as_1",
          complete?: false,
          omission_note: "仅本轮生成的正文候选，非整章已采纳全文"
        },
        %{kind: :execution_brief, ref: "execution_brief:turn_1"}
      ],
      preserve: [],
      operation_effect: :evaluate,
      output_contract: %{
        kind: :json,
        schema_ref: "quality_evaluation_v1",
        required_keys: ["findings"],
        allow_companions: false
      },
      source_refs: ["turn:turn_1"],
      semantic_version: AuthoringSemantics.version()
    }
  end

  defp request(task) do
    %QualityEvaluationRequest{
      request_id: "qer_task",
      source_turn_ref: "turn_1",
      source_ref: "as_1",
      source_type: :prose_fragment,
      prose_text: "夜色压在账单上。",
      execution_brief: "本章执行简述",
      facts_context: "作品事实基线",
      task: task
    }
  end

  defp execution(agent, contents) do
    %Execution{
      result_fn: fn prompt ->
        Agent.update(agent, fn _ -> prompt end)
        {:ok, %{content: contents}}
      end
    }
  end

  test "task-aware evaluator renders shared semantics, coverage statement, and findings contract" do
    {:ok, agent} = Agent.start_link(fn -> nil end)
    task = evaluation_task()

    result = ProseQualityEvaluator.evaluate(request(task), execution(agent, @valid_findings))
    assert result.status == :ok
    assert length(result.findings) == 1

    prompt = Agent.get(agent, & &1)

    assert String.split(prompt, AuthoringSemantics.static_block(task)) |> length() == 2
    assert String.split(prompt, "## 创作协作共同规则") |> length() == 2
    assert prompt =~ "评审范围：单对象/片段"
    assert prompt =~ "不得据此声称整章"
    assert prompt =~ "本章执行简述"
    assert prompt =~ "作品事实基线"
    assert prompt =~ "quality_gate_ref"
    assert prompt =~ "evidence_spans"
    assert prompt =~ "impact_scope"
    assert prompt =~ "revision_scope"
    assert prompt =~ "confidence"

    # 死输入 reader_effect 段已删除（不再声明但没有材料）
    refute prompt =~ "读者效果目标（评审对照）"
  end

  test "correction re-renders the full contract, not a partial restatement" do
    {:ok, agent} = Agent.start_link(fn -> [] end)

    result_fn = fn prompt ->
      calls = Agent.get_and_update(agent, &{&1, &1 ++ [prompt]})

      if calls == [] do
        {:ok, %{content: "not-json"}}
      else
        {:ok, %{content: @valid_findings}}
      end
    end

    result =
      ProseQualityEvaluator.evaluate(request(evaluation_task()), %Execution{
        result_fn: result_fn
      })

    assert result.status == :ok
    [_original, correction] = Agent.get(agent, & &1)

    assert correction =~ "结构必须与首次请求完全一致"
    assert correction =~ "quality_finding_id"
    assert correction =~ "evidence_spans"
    refute correction =~ "每个 finding 必须包含原句证据、句子位置、判断理由、影响范围、修订\n    范围和 0~1 置信度"
  end

  test "evaluator request without task fails instead of using legacy template" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    legacy = %QualityEvaluationRequest{
      request_id: "qer_legacy",
      source_turn_ref: "turn_1",
      source_ref: "as_1",
      source_type: :prose_fragment,
      prose_text: "夜色压在账单上。",
      execution_brief: "本章执行简述"
    }

    result = ProseQualityEvaluator.evaluate(legacy, execution(agent, @valid_findings))
    assert result.status == :error
    assert result.error.code == "authoring_task_required"
    assert Agent.get(agent, & &1) == nil
  end
end
