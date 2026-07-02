defmodule NovelAgent.Provider.ExecutionTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.AdapterExecution
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.RuntimeConfig

  setup do
    RuntimeConfig.reset()

    on_exit(fn ->
      RuntimeConfig.reset()
    end)
  end

  test "dependency completion delegates through the unified provider execution gateway" do
    dependency = Execution.dependency(purpose: :writer, provider_call_ref: "pcall_execution_test")
    complete = Execution.result_fn(dependency)

    assert {:ok, result} = complete.("hello from execution")
    assert %Result{} = result
    assert result.content =~ "[stub]"
    assert result.provider_call_ref == "pcall_execution_test"
    assert result.provider_run_ref =~ "prun_"
    assert result.provider_output.status == :ok

    event_types = Enum.map(result.provider_events, & &1.event_type)
    assert Enum.take(event_types, 3) == [:started, :progress, :progress]
    assert :chunk in event_types
    assert List.last(event_types) == :final_output

    assert result.provider_events
           |> Enum.filter(&(&1.event_type == :progress))
           |> Enum.map(& &1.payload[:phase]) == [
             :request_prepared,
             :request_dispatched,
             :response_received
           ]

    chunk_event = Enum.find(result.provider_events, &(&1.event_type == :chunk))
    assert chunk_event.payload[:chunk_index] == 1
    assert is_integer(chunk_event.payload[:content_length])
    refute Map.has_key?(chunk_event.payload, :text_delta)
  end

  test "dependency exposes the same unified provider execution completion" do
    dependency = Execution.dependency(purpose: :tool, provider_call_ref: "pcall_dependency_test")
    complete = Execution.result_fn(dependency)

    assert %Execution{purpose: :tool} = dependency
    assert is_function(complete, 1)
    assert {:ok, result} = complete.("hello from execution dependency")
    assert result.provider_call_ref == "pcall_dependency_test"
    assert result.provider_run_ref =~ "prun_"
    assert result.provider_output.status == :ok
  end

  test "with_purpose updates gateway execution purpose" do
    dependency =
      Execution.dependency(
        provider: :stub,
        purpose: :conversation,
        provider_call_ref: "pcall_with_purpose_test"
      )

    updated = Execution.with_purpose(dependency, :author_reasoning)

    assert updated.purpose == :author_reasoning
    assert Keyword.fetch!(updated.gateway_opts, :purpose) == :author_reasoning

    complete = Execution.result_fn(updated)

    assert {:ok, result} =
             complete.(
               "AgentRun 下一步规划器\nprofile_ref: conversation_turn_v1\n## 已有观察\n- none\n## 决策规则\n"
             )

    chunk_event = Enum.find(result.provider_events, &(&1.event_type == :chunk))
    assert chunk_event.payload[:author_narrative_delta] =~ "[stub]"
  end

  test "raw completion functions are not provider execution dependencies" do
    raw_result_fn = fn _prompt -> {:ok, %{content: "legacy"}} end

    assert Execution.result_fn(raw_result_fn) == nil
  end

  test "execute exposes the unified provider execution result" do
    assert {:ok, %{provider_run: run, output: output, result: result, events: events}} =
             Execution.execute("hello execution stream",
               purpose: :evaluator,
               provider_call_ref: "pcall_execution_stream_test"
             )

    assert run.execution_mode == :event_stream
    assert run.provider_call_ref == "pcall_execution_stream_test"
    assert output.provider_call_ref == "pcall_execution_stream_test"
    assert result.content =~ "[stub]"

    event_types = Enum.map(events, & &1.event_type)
    assert Enum.take(event_types, 3) == [:started, :progress, :progress]
    assert :chunk in event_types
    assert List.last(event_types) == :final_output
  end

  test "author reasoning chunks expose only JSON-prefix narrative deltas" do
    content = "模型正在判断下一步。\n{\"evaluation_of_last\":{\"advanced\":true}}"

    author_events =
      AdapterExecution.text_chunk_events(provider_ctx(:author_reasoning), content, 4)

    author_deltas =
      author_events
      |> Enum.map(& &1.payload[:author_narrative_delta])
      |> Enum.reject(&is_nil/1)

    author_delta = Enum.join(author_deltas)

    assert length(author_deltas) >= 2
    assert author_delta == "模型正在判断下一步。\n"
    refute author_delta =~ "evaluation_of_last"
    refute Enum.any?(author_events, &Map.has_key?(&1.payload, :text_delta))
    refute Enum.any?(author_events, &Map.has_key?(&1.payload, :content))

    telemetry_events = AdapterExecution.text_chunk_events(provider_ctx(:conversation), content, 4)

    refute Enum.any?(telemetry_events, &Map.has_key?(&1.payload, :author_narrative_delta))
  end

  test "cancelled token materializes provider cancellation facts" do
    {:ok, token} = Execution.start_cancellation_token(%{run_id: "run_execution_cancel_test"})
    assert :ok = Execution.cancel(token, :author_cancelled)

    assert {:error, %{provider_run: run, output: output, error: error, events: events}} =
             Execution.execute("hello cancelled execution",
               purpose: :writer,
               provider_call_ref: "pcall_execution_cancel_test",
               provider_run_id: "prun_execution_cancel_test",
               cancellation_token: token
             )

    assert run.status == :cancelled
    assert run.provider_call_ref == "pcall_execution_cancel_test"
    assert output.status == :cancelled
    assert output.output_type == :empty
    assert error.type == :cancelled
    assert error.reason == "author_cancelled"

    assert Enum.map(events, & &1.event_type) == [
             :started,
             :cancel_requested,
             :cancelled
           ]
  end

  test "complete returns provider errors from gateway execution" do
    assert {:error, error} =
             Execution.complete("hello", provider: :missing_provider, purpose: :conversation)

    assert error.type == :provider_internal
  end

  defp provider_ctx(purpose) do
    %{
      provider_name: :stub,
      model_name: "stub-model",
      provider_call_ref: "pcall_#{purpose}",
      provider_run_id: "prun_#{purpose}",
      purpose: purpose,
      owner_refs: %{}
    }
  end
end
