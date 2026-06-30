defmodule NovelAgent.Provider.ExecutionTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Result
  alias NovelAgent.Provider.RuntimeConfig

  setup do
    RuntimeConfig.reset()

    on_exit(fn ->
      RuntimeConfig.reset()
    end)
  end

  test "complete_fn delegates through the unified provider execution gateway" do
    complete = Execution.complete_fn(purpose: :writer, provider_call_ref: "pcall_execution_test")

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
    complete = Execution.complete_fn(dependency)

    assert %Execution{purpose: :tool} = dependency
    assert is_function(complete, 1)
    assert {:ok, result} = complete.("hello from execution dependency")
    assert result.provider_call_ref == "pcall_dependency_test"
    assert result.provider_run_ref =~ "prun_"
    assert result.provider_output.status == :ok
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
end
