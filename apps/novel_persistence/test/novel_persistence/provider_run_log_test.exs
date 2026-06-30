defmodule NovelPersistence.ProviderRunLogTest do
  use ExUnit.Case, async: true

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
  alias NovelPersistence.ProviderRunLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
  end

  test "persists provider execution facts as author-safe usage summaries" do
    agent_run_id = "run-provider-log-#{System.unique_integer([:positive, :monotonic])}"
    provider_run_id = "prun-provider-log"
    provider_call_ref = "pcall-provider-log"

    {:ok, run} =
      ProviderRun.new(%{
        provider_run_id: provider_run_id,
        provider_call_ref: provider_call_ref,
        purpose: :planner,
        execution_mode: :event_stream,
        status: :completed,
        provider_id: "slice_verify",
        model: "stub-model",
        owner_refs: %{"raw_prompt" => "must not persist", "work_id" => "work-provider-log"},
        metadata: %{system_prompt: "must not persist", safe_note: "kept"}
      })

    {:ok, started} =
      ProviderEvent.new(%{
        event_id: "pevt-provider-started",
        provider_run_ref: provider_run_id,
        sequence: 1,
        event_type: :started,
        visibility: :developer,
        summary: "Provider execution started.",
        payload: %{model: "stub-model", raw_prompt: "must not persist"},
        refs: [provider_call_ref]
      })

    {:ok, final} =
      ProviderEvent.new(%{
        event_id: "pevt-provider-final",
        provider_run_ref: provider_run_id,
        sequence: 2,
        event_type: :final_output,
        visibility: :developer,
        summary: "Provider final output materialized.",
        payload: %{content_length: 12, text: "must not persist"},
        refs: [provider_call_ref]
      })

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: provider_run_id,
        provider_call_ref: provider_call_ref,
        status: :ok,
        output_type: :text,
        content: %{text: "作者可见正文也不在 ProviderRunLog 存原文"},
        usage: %{total_tokens: 42, input_tokens: 24, output_tokens: 18},
        refs: [provider_call_ref]
      })

    assert :ok =
             ProviderRunLog.record_execution(
               {:ok, %{provider_run: run, events: [started, final], output: output}},
               %{
                 agent_run_id: agent_run_id,
                 workspace_id: "ws-provider-log",
                 work_id: "work-provider-log",
                 session_id: "session-provider-log",
                 parent_turn_ref: "turn-provider-log",
                 step_id: "step-provider-log",
                 purpose: :planner
               }
             )

    assert [%{purpose: "planner", provider_call_ref: ^provider_call_ref} = record] =
             ProviderRunLog.list_runs(agent_run_id)

    assert record.owner_refs == %{"work_id" => "work-provider-log"}
    assert record.metadata == %{"safe_note" => "kept"}

    assert [%{payload: %{"model" => "stub-model"}}, %{payload: %{"content_length" => 12}}] =
             ProviderRunLog.list_events(provider_run_id)

    assert %{content_length: length, content_summary: %{"content_length" => length}} =
             ProviderRunLog.get_output(provider_run_id)

    assert [
             %{
               provider_run_ref: ^provider_run_id,
               provider_call_ref: ^provider_call_ref,
               purpose: "planner",
               status: "ok",
               output_type: "text",
               usage: %{"total_tokens" => 42}
             } = summary
           ] = ProviderRunLog.list_usage_summaries(agent_run_id)

    refute Map.has_key?(summary, :content)
  end

  test "sanitizes provider error details before persistence" do
    agent_run_id = "run-provider-error-#{System.unique_integer([:positive, :monotonic])}"
    provider_run_id = "prun-provider-error"
    provider_call_ref = "pcall-provider-error"

    {:ok, run} =
      ProviderRun.new(%{
        provider_run_id: provider_run_id,
        provider_call_ref: provider_call_ref,
        purpose: :conversation,
        execution_mode: :event_stream,
        status: :failed
      })

    {:ok, error_event} =
      ProviderEvent.new(%{
        event_id: "pevt-provider-error",
        provider_run_ref: provider_run_id,
        sequence: 2,
        event_type: :error,
        visibility: :developer,
        summary: "Provider execution failed.",
        payload: %{reason_code: :provider_error, message: "raw provider payload"},
        refs: [provider_call_ref]
      })

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: provider_run_id,
        provider_call_ref: provider_call_ref,
        status: :error,
        output_type: :empty,
        error: %{type: :provider_error, message: "raw provider payload"},
        refs: [provider_call_ref]
      })

    assert :ok =
             ProviderRunLog.record_execution(
               {:error, %{provider_run: run, events: [error_event], output: output}},
               %{agent_run_id: agent_run_id}
             )

    assert [%{payload: %{"reason_code" => "provider_error"}}] =
             ProviderRunLog.list_events(provider_run_id)

    assert %{error_summary: %{"type" => "provider_error"}} =
             ProviderRunLog.get_output(provider_run_id)
  end
end
