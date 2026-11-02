defmodule NovelPersistence.ProviderRunLogTest do
  # 事务写意图测试需要观察真实 SQLite 连接回调，避免与其他 async 用例的
  # 连接事件交叉，故本模块串行执行。
  use ExUnit.Case, async: false

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

  test "persists native tool call count and names without arguments" do
    agent_run_id = "run-provider-tool-call-#{System.unique_integer([:positive, :monotonic])}"
    provider_run_id = "prun-provider-tool-call"
    provider_call_ref = "pcall-provider-tool-call"

    {:ok, run} =
      ProviderRun.new(%{
        provider_run_id: provider_run_id,
        provider_call_ref: provider_call_ref,
        purpose: :author_reasoning,
        execution_mode: :event_stream,
        status: :completed,
        provider_id: "slice_verify",
        model: "stub-model"
      })

    {:ok, final} =
      ProviderEvent.new(%{
        event_id: "pevt-provider-tool-call-final",
        provider_run_ref: provider_run_id,
        sequence: 1,
        event_type: :final_output,
        visibility: :developer,
        summary: "Provider final output materialized.",
        payload: %{content_length: 12},
        refs: [provider_call_ref]
      })

    {:ok, output} =
      ProviderOutput.new(%{
        provider_run_ref: provider_run_id,
        provider_call_ref: provider_call_ref,
        status: :ok,
        output_type: :text,
        content: %{
          text: "计划说明",
          tool_calls: [
            %{
              name: "agent_plan_draft",
              arguments: %{
                plan: %{steps: [%{target_tool_ref: "context_assemble"}]},
                reason_codes: ["agent_plan_drafted"]
              }
            }
          ]
        },
        refs: [provider_call_ref]
      })

    assert :ok =
             ProviderRunLog.record_execution(
               {:ok, %{provider_run: run, events: [final], output: output}},
               %{agent_run_id: agent_run_id}
             )

    assert %{
             content_summary: %{
               "native_tool_call_count" => 1,
               "native_tool_call_names" => ["agent_plan_draft"]
             }
           } = ProviderRunLog.get_output(provider_run_id)

    summary_json =
      provider_run_id
      |> ProviderRunLog.get_output()
      |> Map.fetch!(:content_summary)
      |> Jason.encode!()

    refute summary_json =~ "target_tool_ref"
    refute summary_json =~ "context_assemble"
    refute summary_json =~ "reason_codes"
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

  describe "ordered provider fact commits" do
    test "replays a late earlier event without rolling back a terminal run or clearing its output" do
      suffix = unique("order")
      run_id = "prun-#{suffix}"
      call_ref = "pcall-#{suffix}"
      agent_run_id = "run-#{suffix}"

      completed = fact_run(run_id, call_ref, :completed)
      output = fact_output(run_id, call_ref)
      final = fact_event(run_id, call_ref, "#{run_id}:final", 8, :final_output)

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: completed, events: [final], output: output}},
                 fact_context(agent_run_id)
               )

      late = fact_event(run_id, call_ref, "#{run_id}:chunk", 5, :chunk)

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: %{completed | status: :running}, events: [late]}},
                 fact_context(agent_run_id)
               )

      assert [%{status: "completed"}] = ProviderRunLog.list_runs(agent_run_id)
      assert %{status: "ok"} = ProviderRunLog.get_output(run_id)
      assert Enum.map(ProviderRunLog.list_events(run_id), & &1.sequence) == [5, 8]
    end

    test "declares SQLite write ownership before reading the committed fact" do
      suffix = unique("write-owner")
      parent = self()
      run = fact_run("prun-#{suffix}", "pcall-#{suffix}", :running)

      # 直接观察当前 Ecto consumer 实际调用的 SQLite 连接回调选项。Sandbox 会为
      # 测试事务在最外层补 `mode: :savepoint`，因此这里核对 :immediate 已被本次
      # ProviderRunLog 事务显式传入，而不是只验证 SQL 文本或临时机制。
      child =
        spawn_link(fn ->
          receive do
            :go -> :ok
          end

          result =
            ProviderRunLog.record_execution(
              {:ok, %{provider_run: run}},
              fact_context("run-#{suffix}")
            )

          send(parent, {:provider_fact_result, result})

          receive do
            :finish -> :ok
          end
        end)

      :ok = Sandbox.allow(Repo, self(), child)
      :erlang.trace_pattern({Exqlite.Connection, :handle_begin, 2}, true, [:global])
      :erlang.trace(child, true, [:call, {:tracer, parent}])
      send(child, :go)

      try do
        assert_receive {:provider_fact_result, :ok}, 1_000
      after
        :erlang.trace(child, false, [:call])
        :erlang.trace_pattern({Exqlite.Connection, :handle_begin, 2}, false, [:global])
        send(child, :finish)
      end

      assert_receive {:trace, ^child, :call,
                      {Exqlite.Connection, :handle_begin, [options, _state]}},
                     1_000

      assert :immediate in Keyword.get_values(options, :mode)
    end

    test "treats atom and JSON string error facts as the same committed fact" do
      suffix = unique("error-normalization")
      run_id = "prun-#{suffix}"
      call_ref = "pcall-#{suffix}"
      agent_run_id = "run-#{suffix}"
      event_id = "#{run_id}:error"
      raw_detail = "不得落库的原始错误细节"

      run = fact_run(run_id, call_ref, :failed)

      atom_event =
        fact_event(run_id, call_ref, event_id, 1, :error, %{
          payload: %{reason_code: :timeout, message: raw_detail}
        })

      atom_output =
        fact_output(run_id, call_ref, %{
          status: :error,
          output_type: :empty,
          content: %{},
          error: %{type: :timeout, message: raw_detail}
        })

      assert :ok =
               ProviderRunLog.record_execution(
                 {:error, %{provider_run: run, events: [atom_event], output: atom_output}},
                 fact_context(agent_run_id)
               )

      [event_before] = ProviderRunLog.list_events(run_id)
      output_before = ProviderRunLog.get_output(run_id)

      string_event =
        fact_event(run_id, call_ref, event_id, 1, :error, %{
          payload: %{"reason_code" => "timeout"}
        })

      string_output =
        fact_output(run_id, call_ref, %{
          status: :error,
          output_type: :empty,
          content: %{},
          error: %{"type" => "timeout"}
        })

      assert :ok =
               ProviderRunLog.record_execution(
                 {:error, %{provider_run: run, events: [string_event], output: string_output}},
                 fact_context(agent_run_id)
               )

      [event_after] = ProviderRunLog.list_events(run_id)
      output_after = ProviderRunLog.get_output(run_id)

      assert :ok =
               ProviderRunLog.record_execution(
                 {:error, %{provider_run: run, events: [atom_event], output: atom_output}},
                 fact_context(agent_run_id)
               )

      [event_replayed] = ProviderRunLog.list_events(run_id)
      output_replayed = ProviderRunLog.get_output(run_id)

      assert event_after.payload == %{"reason_code" => "timeout"}
      assert output_after.error_summary == %{"type" => "timeout"}
      assert event_replayed.updated_at == event_before.updated_at
      assert output_replayed.updated_at == output_before.updated_at
      refute inspect(event_replayed.payload) =~ raw_detail
      refute inspect(output_replayed.error_summary) =~ raw_detail
    end

    test "rejects a genuinely different normalized error fact and rolls back the batch" do
      suffix = unique("error-conflict")
      run_id = "prun-#{suffix}"
      call_ref = "pcall-#{suffix}"
      agent_run_id = "run-#{suffix}"
      event_id = "#{run_id}:error"

      run = fact_run(run_id, call_ref, :failed)

      original_event =
        fact_event(run_id, call_ref, event_id, 1, :error, %{
          payload: %{reason_code: :provider_error}
        })

      original_output =
        fact_output(run_id, call_ref, %{
          status: :error,
          output_type: :empty,
          content: %{},
          error: %{type: :provider_error}
        })

      assert :ok =
               ProviderRunLog.record_execution(
                 {:error,
                  %{provider_run: run, events: [original_event], output: original_output}},
                 fact_context(agent_run_id)
               )

      conflicting_event =
        fact_event(run_id, call_ref, event_id, 1, :error, %{
          payload: %{"reason_code" => "timeout"}
        })

      assert {:error, {:provider_event_content_conflict, ^event_id}} =
               ProviderRunLog.record_execution(
                 {:error, %{provider_run: run, events: [conflicting_event]}},
                 fact_context(agent_run_id)
               )

      conflicting_output =
        fact_output(run_id, call_ref, %{
          status: :error,
          output_type: :empty,
          content: %{},
          error: %{"type" => "timeout"}
        })

      assert {:error, {:provider_output_content_conflict, ^run_id}} =
               ProviderRunLog.record_execution(
                 {:error, %{provider_run: run, output: conflicting_output}},
                 fact_context(agent_run_id)
               )

      assert [%{payload: %{"reason_code" => "provider_error"}}] =
               ProviderRunLog.list_events(run_id)

      assert %{error_summary: %{"type" => "provider_error"}} =
               ProviderRunLog.get_output(run_id)
    end

    test "treats an identical replay as idempotent instead of rewriting committed facts" do
      suffix = unique("duplicate")
      run_id = "prun-#{suffix}"
      call_ref = "pcall-#{suffix}"
      agent_run_id = "run-#{suffix}"

      run = fact_run(run_id, call_ref, :completed)
      event = fact_event(run_id, call_ref, "#{run_id}:final", 1, :final_output)
      output = fact_output(run_id, call_ref)
      facts = {:ok, %{provider_run: run, events: [event], output: output}}

      assert :ok = ProviderRunLog.record_execution(facts, fact_context(agent_run_id))
      [run_before] = ProviderRunLog.list_runs(agent_run_id)
      output_before = ProviderRunLog.get_output(run_id)
      [event_before] = ProviderRunLog.list_events(run_id)

      assert :ok = ProviderRunLog.record_execution(facts, fact_context(agent_run_id))

      [run_after] = ProviderRunLog.list_runs(agent_run_id)
      [event_after] = ProviderRunLog.list_events(run_id)
      output_after = ProviderRunLog.get_output(run_id)

      assert run_after.updated_at == run_before.updated_at
      assert event_after.updated_at == event_before.updated_at
      assert output_after.updated_at == output_before.updated_at
      assert length(ProviderRunLog.list_events(run_id)) == 1
    end

    test "rejects a different event id on the same run sequence and rolls back the batch" do
      suffix = unique("sequence")
      run_id = "prun-#{suffix}"
      call_ref = "pcall-#{suffix}"
      agent_run_id = "run-#{suffix}"

      running = fact_run(run_id, call_ref, :running)
      first = fact_event(run_id, call_ref, "#{run_id}:started", 1, :started)

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: running, events: [first]}},
                 fact_context(agent_run_id)
               )

      next_event = fact_event(run_id, call_ref, "#{run_id}:final", 2, :final_output)
      conflicting = fact_event(run_id, call_ref, "#{run_id}:other", 1, :chunk)

      batch =
        {:ok,
         %{
           provider_run: %{running | status: :completed},
           events: [next_event, conflicting],
           output: fact_output(run_id, call_ref)
         }}

      assert {:error, {:provider_event_sequence_conflict, 1}} =
               ProviderRunLog.record_execution(batch, fact_context(agent_run_id))

      assert [%{status: "running"}] = ProviderRunLog.list_runs(agent_run_id)
      assert [%{id: first_id}] = ProviderRunLog.list_events(run_id)
      assert first_id == first.event_id
      assert ProviderRunLog.get_output(run_id) == nil
    end

    test "rejects an event id reused with conflicting content or sequence" do
      suffix = unique("event-conflict")
      run_id = "prun-#{suffix}"
      call_ref = "pcall-#{suffix}"
      agent_run_id = "run-#{suffix}"
      event_id = "#{run_id}:chunk"

      running = fact_run(run_id, call_ref, :running)
      original = fact_event(run_id, call_ref, event_id, 1, :chunk, %{summary: "旧事实"})

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: running, events: [original]}},
                 fact_context(agent_run_id)
               )

      conflicting = fact_event(run_id, call_ref, event_id, 1, :chunk, %{summary: "新事实"})

      assert {:error, {:provider_event_content_conflict, ^event_id}} =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: running, events: [conflicting]}},
                 fact_context(agent_run_id)
               )

      assert [%{summary: "旧事实"}] = ProviderRunLog.list_events(run_id)

      moved = fact_event(run_id, call_ref, event_id, 2, :chunk)

      assert {:error, {:provider_event_identity_conflict, :sequence}} =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: running, events: [moved]}},
                 fact_context(agent_run_id)
               )

      assert [%{sequence: 1, summary: "旧事实"}] = ProviderRunLog.list_events(run_id)
    end

    test "rejects run, call, work and session rebinding and leaves the original facts intact" do
      for field <- [:provider_call_ref, :agent_run_id, :work_id, :session_id] do
        suffix = unique("rebind")
        run_id = "prun-#{suffix}"
        call_ref = "pcall-#{suffix}"
        agent_run_id = "run-#{suffix}"
        context = fact_context(agent_run_id)
        run = fact_run(run_id, call_ref, :running)

        assert :ok = ProviderRunLog.record_execution({:ok, %{provider_run: run}}, context)

        {incoming_run, incoming_context, expected} =
          case field do
            :provider_call_ref ->
              {fact_run(run_id, "pcall-other-#{suffix}", :running), context,
               {:provider_run_identity_conflict, :provider_call_ref}}

            :agent_run_id ->
              {fact_run(run_id, call_ref, :running), fact_context("run-other-#{suffix}"),
               {:provider_run_attribution_conflict, :agent_run_id}}

            :work_id ->
              {fact_run(run_id, call_ref, :running),
               fact_context(agent_run_id, %{work_id: "work-other-#{suffix}"}),
               {:provider_run_attribution_conflict, :work_id}}

            :session_id ->
              {fact_run(run_id, call_ref, :running),
               fact_context(agent_run_id, %{session_id: "session-other-#{suffix}"}),
               {:provider_run_attribution_conflict, :session_id}}
          end

        event = fact_event(run_id, call_ref, "#{run_id}:#{field}", 2, :chunk)

        assert {:error, ^expected} =
                 ProviderRunLog.record_execution(
                   {:ok, %{provider_run: incoming_run, events: [event]}},
                   incoming_context
                 )

        assert [%{id: ^run_id, status: "running"}] = ProviderRunLog.list_runs(agent_run_id)
        assert ProviderRunLog.list_events(run_id) == []
      end
    end

    test "rejects a different run id claiming the same provider call identity" do
      suffix = unique("call-owner")
      call_ref = "pcall-#{suffix}"
      agent_run_id = "run-#{suffix}"
      first_run_id = "prun-#{suffix}-first"
      second_run_id = "prun-#{suffix}-second"

      first = fact_run(first_run_id, call_ref, :running)
      second = fact_run(second_run_id, call_ref, :running)
      context = fact_context(agent_run_id)

      assert :ok = ProviderRunLog.record_execution({:ok, %{provider_run: first}}, context)

      assert {:error, {:provider_run_call_ref_conflict, ^call_ref}} =
               ProviderRunLog.record_execution({:ok, %{provider_run: second}}, context)

      assert [%{id: ^first_run_id}] = ProviderRunLog.list_runs(agent_run_id)
    end

    test "does not interchange failed and cancelled terminal states" do
      failed_suffix = unique("failed-terminal")
      failed_run_id = "prun-#{failed_suffix}"
      failed_call_ref = "pcall-#{failed_suffix}"
      failed_agent_run_id = "run-#{failed_suffix}"

      failed_run = fact_run(failed_run_id, failed_call_ref, :failed)

      error_event =
        fact_event(failed_run_id, failed_call_ref, "#{failed_run_id}:error", 1, :error, %{
          payload: %{reason_code: :provider_error}
        })

      error_output =
        fact_output(failed_run_id, failed_call_ref, %{
          status: :error,
          output_type: :empty,
          content: %{},
          error: %{type: :provider_error}
        })

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: failed_run, events: [error_event], output: error_output}},
                 fact_context(failed_agent_run_id)
               )

      completed_final =
        fact_event(failed_run_id, failed_call_ref, "#{failed_run_id}:final", 2, :final_output)

      assert {:error, {:provider_run_terminal_conflict, "failed", "completed"}} =
               ProviderRunLog.record_execution(
                 {:ok,
                  %{
                    provider_run: %{failed_run | status: :completed},
                    events: [completed_final],
                    output: fact_output(failed_run_id, failed_call_ref)
                  }},
                 fact_context(failed_agent_run_id)
               )

      assert [%{status: "failed"}] = ProviderRunLog.list_runs(failed_agent_run_id)
      assert [%{event_type: "error"}] = ProviderRunLog.list_events(failed_run_id)
      assert %{status: "error"} = ProviderRunLog.get_output(failed_run_id)

      cancelled_suffix = unique("cancelled-terminal")
      cancelled_run_id = "prun-#{cancelled_suffix}"
      cancelled_call_ref = "pcall-#{cancelled_suffix}"
      cancelled_agent_run_id = "run-#{cancelled_suffix}"

      cancelled_run = fact_run(cancelled_run_id, cancelled_call_ref, :cancelled)

      cancelled_event =
        fact_event(
          cancelled_run_id,
          cancelled_call_ref,
          "#{cancelled_run_id}:cancelled",
          1,
          :cancelled
        )

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: cancelled_run, events: [cancelled_event]}},
                 fact_context(cancelled_agent_run_id)
               )

      failed_event =
        fact_event(cancelled_run_id, cancelled_call_ref, "#{cancelled_run_id}:error", 2, :error)

      assert {:error, {:provider_run_terminal_conflict, "cancelled", "failed"}} =
               ProviderRunLog.record_execution(
                 {:ok,
                  %{provider_run: %{cancelled_run | status: :failed}, events: [failed_event]}},
                 fact_context(cancelled_agent_run_id)
               )

      assert [%{status: "cancelled"}] = ProviderRunLog.list_runs(cancelled_agent_run_id)
      assert [%{event_type: "cancelled"}] = ProviderRunLog.list_events(cancelled_run_id)
    end

    test "keeps running and cancel_requested progression, terminal order and late cancellation facts" do
      suffix = unique("lifecycle")
      run_id = "prun-#{suffix}"
      call_ref = "pcall-#{suffix}"
      agent_run_id = "run-#{suffix}"

      initialized = fact_run(run_id, call_ref, :initialized)
      started = fact_event(run_id, call_ref, "#{run_id}:started", 1, :started)

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: initialized, events: [started]}},
                 fact_context(agent_run_id)
               )

      running = %{initialized | status: :running}
      progress = fact_event(run_id, call_ref, "#{run_id}:progress", 2, :progress)

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: running, events: [progress]}},
                 fact_context(agent_run_id)
               )

      cancel_requested = %{initialized | status: :cancel_requested}

      cancel_event =
        fact_event(run_id, call_ref, "#{run_id}:cancel-requested", 3, :cancel_requested)

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: cancel_requested, events: [cancel_event]}},
                 fact_context(agent_run_id)
               )

      cancelled = %{initialized | status: :cancelled}
      cancelled_event = fact_event(run_id, call_ref, "#{run_id}:cancelled", 4, :cancelled)

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: cancelled, events: [cancelled_event]}},
                 fact_context(agent_run_id)
               )

      assert [%{status: "cancelled"}] = ProviderRunLog.list_runs(agent_run_id)

      late = fact_event(run_id, call_ref, "#{run_id}:late-chunk", 5, :chunk)

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: running, events: [late]}},
                 fact_context(agent_run_id)
               )

      assert [%{status: "cancelled"}] = ProviderRunLog.list_runs(agent_run_id)
      assert Enum.map(ProviderRunLog.list_events(run_id), & &1.sequence) == [1, 2, 3, 4, 5]

      completed_suffix = unique("cancel-completed")
      completed_run_id = "prun-#{completed_suffix}"
      completed_call_ref = "pcall-#{completed_suffix}"
      completed_agent_run_id = "run-#{completed_suffix}"

      requested = fact_run(completed_run_id, completed_call_ref, :cancel_requested)

      requested_event =
        fact_event(
          completed_run_id,
          completed_call_ref,
          "#{completed_run_id}:cancel-requested",
          1,
          :cancel_requested
        )

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: requested, events: [requested_event]}},
                 fact_context(completed_agent_run_id)
               )

      completed = %{requested | status: :completed}

      final =
        fact_event(
          completed_run_id,
          completed_call_ref,
          "#{completed_run_id}:final",
          2,
          :final_output
        )

      output = fact_output(completed_run_id, completed_call_ref)

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: completed, events: [final], output: output}},
                 fact_context(completed_agent_run_id)
               )

      assert [%{status: "completed"}] = ProviderRunLog.list_runs(completed_agent_run_id)
      assert %{status: "ok"} = ProviderRunLog.get_output(completed_run_id)
    end

    test "rolls back the whole batch when a later write fails" do
      suffix = unique("rollback")
      run_id = "prun-#{suffix}"
      call_ref = "pcall-#{suffix}"
      agent_run_id = "run-#{suffix}"

      run = fact_run(run_id, call_ref, :completed)
      event = fact_event(run_id, call_ref, "#{run_id}:final", 1, :final_output)
      invalid_output = %{fact_output(run_id, call_ref) | output_type: nil}

      assert {:error, {:provider_output_write_failed, fields}} =
               ProviderRunLog.record_execution(
                 {:ok, %{provider_run: run, events: [event], output: invalid_output}},
                 fact_context(agent_run_id)
               )

      assert :output_type in fields
      assert ProviderRunLog.list_runs(agent_run_id) == []
      assert ProviderRunLog.list_events(run_id) == []
      assert ProviderRunLog.get_output(run_id) == nil
    end
  end

  defp unique(prefix), do: "#{prefix}-#{System.unique_integer([:positive, :monotonic])}"

  defp fact_run(id, call_ref, status, attrs \\ %{}) do
    {:ok, run} =
      ProviderRun.new(
        Map.merge(
          %{
            provider_run_id: id,
            provider_call_ref: call_ref,
            purpose: :planner,
            execution_mode: :event_stream,
            status: status
          },
          attrs
        )
      )

    run
  end

  defp fact_event(run_id, call_ref, event_id, sequence, type, attrs \\ %{}) do
    {:ok, event} =
      ProviderEvent.new(
        Map.merge(
          %{
            event_id: event_id,
            provider_run_ref: run_id,
            sequence: sequence,
            event_type: type,
            visibility: :developer,
            summary: "provider fact",
            payload: %{},
            refs: [call_ref]
          },
          attrs
        )
      )

    event
  end

  defp fact_output(run_id, call_ref, attrs \\ %{}) do
    {:ok, output} =
      ProviderOutput.new(
        Map.merge(
          %{
            provider_run_ref: run_id,
            provider_call_ref: call_ref,
            status: :ok,
            output_type: :text,
            content: %{text: "真实响应"},
            refs: [call_ref]
          },
          attrs
        )
      )

    output
  end

  defp fact_context(agent_run_id, overrides \\ %{}) do
    Map.merge(
      %{
        agent_run_id: agent_run_id,
        workspace_id: "ws-provider-fact",
        work_id: "work-provider-fact",
        session_id: "session-provider-fact",
        parent_turn_ref: "turn-provider-fact",
        step_id: "step-provider-fact",
        purpose: :planner
      },
      overrides
    )
  end
end
