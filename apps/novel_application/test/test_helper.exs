ExUnit.start(exclude: [:integration, :real_llm])

Ecto.Adapters.SQL.Sandbox.mode(NovelPersistence.Repo, :manual)

defmodule NovelApplication.TestAssertions do
  @moduledoc false

  import ExUnit.Assertions

  def assert_provider_output_narrative_source(source) when is_map(source) do
    assert source.source_type == "provider_output"
    assert is_binary(source.provider_run_ref)
    assert is_binary(source.provider_call_ref)
    assert is_binary(source.provider_output_ref)
    assert is_binary(source.source_hash)
    assert is_binary(source.narrative_hash)
    assert %{start: start, length: length} = source.source_byte_range
    assert is_integer(start) and start >= 0
    assert is_integer(length) and length > 0
  end
end

defmodule NovelApplication.TestAgenticLoopFixtures do
  @moduledoc false

  def reasoning_tail(packet) when is_map(packet) do
    tail = %{
      "evaluation_of_last" => Map.get(packet, :evaluation_of_last, evaluation_holds()),
      "decision" => Map.fetch!(packet, :decision),
      "next_action" => Map.fetch!(packet, :next_action),
      "plan_revision" => Map.get(packet, :plan_revision),
      "reason_codes" => Map.get(packet, :reason_codes, []),
      "confidence" => Map.get(packet, :confidence, 1.0)
    }

    Map.fetch!(packet, :reasoning) <> "\n" <> Jason.encode!(tail)
  end

  def continue_next(reasoning, target_tool_ref, opts \\ []) do
    %{
      reasoning: reasoning,
      evaluation_of_last: Keyword.get(opts, :evaluation_of_last, evaluation_holds()),
      decision: %{"type" => Keyword.get(opts, :decision_type, "continue")},
      next_action: %{
        "target_tool_ref" => target_tool_ref,
        "write_intent" => Keyword.get(opts, :write_intent, "none"),
        "risk_hint" => Keyword.get(opts, :risk_hint, "low")
      },
      plan_revision: Keyword.get(opts, :plan_revision),
      reason_codes: Keyword.get(opts, :reason_codes, ["agentic_next_step"]),
      confidence: Keyword.get(opts, :confidence, 1.0)
    }
  end

  def done_next(reasoning, opts \\ []) do
    %{
      reasoning: reasoning,
      evaluation_of_last: Keyword.get(opts, :evaluation_of_last, evaluation_holds()),
      decision: %{"type" => "done"},
      next_action: %{"target_tool_ref" => nil, "write_intent" => "none", "risk_hint" => "low"},
      plan_revision: nil,
      reason_codes: Keyword.get(opts, :reason_codes, ["goal_satisfied"]),
      confidence: Keyword.get(opts, :confidence, 1.0)
    }
  end

  def evaluation_holds do
    %{"advanced" => true, "plan_holds" => true, "new_constraint" => nil}
  end
end
