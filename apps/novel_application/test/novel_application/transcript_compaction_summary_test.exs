Code.require_file(Path.expand("../support/transcript_compaction_helper.exs", __DIR__))

defmodule NovelApplication.TranscriptCompactionSummaryTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias NovelAgent.Provider.{AdapterExecution, Execution, Result}
  alias NovelApplication.{AuthoringTranscript, TestAgenticLoopFixtures, TestTranscriptCompaction}
  alias NovelApplication.TranscriptCompactionSummary, as: Summary
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.{Compaction, MessageCoverage}
  alias NovelPersistence.{ProviderRunLog, Repo}

  setup do: TestTranscriptCompaction.setup()

  test "one admitted execution binds exact summary bytes and can be verified on foreign-run history",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, messages} = plan(run)
    response = response_text()
    capture(response)

    assert {:ok, completed, 1} = Summary.prepare(plan, snapshot, dependency)
    assert_received {:summary_dispatched, request, params, ctx}
    assert request.run.run_id == run.run_id
    assert request.tools == []
    assert params.max_tokens == 8192
    assert completed.discussion.response_text == response
    assert completed.discussion.provider_call_ref == ctx.provider_call_ref
    assert completed.discussion.provider_run_ref == ctx.provider_run_id
    assert completed.discussion.response_sha256 == sha256(response)

    assert completed.discussion |> Map.keys() |> Enum.sort() ==
             [:provider_call_ref, :provider_run_ref, :response_sha256, :response_text]

    assert %{status: "ok", content_summary: %{"content_sha256" => hash}} =
             ProviderRunLog.get_output(ctx.provider_run_id)

    assert hash == sha256(response)

    checkpoint = checkpoint(completed, run)
    assert :ok = Summary.validate_history(messages ++ [checkpoint], run)
    other_request_run = %{run | run_id: "run-later", parent_turn_ref: "turn-later"}
    assert :ok = Summary.validate_history(messages ++ [checkpoint], other_request_run)

    assert {:error, :provider_operation_already_owned, 0} =
             Summary.prepare(plan, snapshot, dependency)

    refute_received {:summary_dispatched, _, _, _}

    assert {:error, _} =
             Summary.validate_history(messages ++ [checkpoint], %{run | work_id: "another-work"})

    tampered =
      put_in(checkpoint.blocks, [
        put_in(
          hd(checkpoint.blocks).discussion.response_sha256,
          sha256("different response")
        )
      ])

    assert {:error, :discussion_summary_persistence_mismatch} =
             Summary.validate_history(messages ++ [tampered], run)

    changed_source =
      List.update_at(messages, 1, fn message ->
        %{message | blocks: [RequestIR.text_block("我会确认完全不同的事项。")]}
      end)

    assert {:error, :discussion_summary_history_mismatch} =
             Summary.validate_history(changed_source ++ [checkpoint], run)
  end

  test "a v1-shaped response cannot satisfy a newly frozen v2 request", %{
    run: run,
    snapshot: snapshot,
    dependency: dependency
  } do
    {plan, _messages} = plan(run)

    raw =
      ~s({"version":"authoring-discussion-summary/v1","entries":[{"source_index":0,"summary":"早期建议","retained_obligations":["稍后我会确认动机。"]}]})

    capture(raw)

    assert {:error, :checkpoint_invalid_discussion, 1} =
             Summary.prepare(plan, snapshot, dependency)

    assert_received {:summary_dispatched, _request, _params, ctx}
    persisted = ProviderRunLog.get_run(ctx.provider_run_id)
    assert persisted.operation_checkpoint["version"] == "provider-operation-checkpoint/v2"

    assert persisted.operation_checkpoint["discussion_protocol_version"] ==
             "authoring-discussion-summary/v2"

    assert persisted.operation_checkpoint["response_text"] == raw

    assert {:error, :provider_operation_already_owned, 0} =
             Summary.prepare(plan, snapshot, dependency)

    refute_received {:summary_dispatched, _, _, _}
  end

  test "invalid native response retains the actual provider output and fences a repeated source",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    capture("this is not the required JSON")
    assert {:error, _reason, 1} = Summary.prepare(plan, snapshot, dependency)
    assert_received {:summary_dispatched, _ir, _params, ctx}
    refute Map.has_key?(plan, :discussion)
    assert %{status: "ok"} = ProviderRunLog.get_output(ctx.provider_run_id)

    assert {:error, :provider_operation_already_owned, 0} =
             Summary.prepare(plan, snapshot, dependency)

    refute_received {:summary_dispatched, _, _, _}
  end

  test "source attempts survive unrelated covers and source regrouping without a second call",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    capture("invalid summary leaves an attempted source")
    assert {:error, _reason, 1} = Summary.prepare(plan, snapshot, dependency)
    assert_received {:summary_dispatched, _, _, _}

    changed_covers = put_in(plan.covers.call_ids, ["unrelated-old-tool"])
    assert Summary.coverage_key(changed_covers, run) == Summary.coverage_key(plan, run)

    assert {:error, :provider_operation_already_owned, 0} =
             Summary.prepare(changed_covers, snapshot, dependency)

    [source] = plan.discussion_sources
    reindexed = %{source | source_index: 1}

    changed_bytes = %{plan | discussion_sources: [%{source | text: "同坐标的不同正文"}]}
    refute Summary.coverage_key(changed_bytes, run) == Summary.coverage_key(plan, run)

    assert Compaction.discussion_source_key(reindexed, run) ==
             Compaction.discussion_source_key(source, run)

    new_source = %{
      source
      | source: %{source.source | run_sequence: source.source.run_sequence + 1},
        text: "另一条尚未整理的讨论。"
    }

    grouped = %{plan | discussion_sources: [new_source, reindexed]}
    refute Summary.coverage_key(grouped, run) == Summary.coverage_key(plan, run)

    assert {:error, :discussion_summary_source_mismatch, 0} =
             Summary.prepare(grouped, snapshot, dependency)

    refute_received {:summary_dispatched, _, _, _}
  end

  test "admission persistence failure prevents dispatch without fabricating a call",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    capture(response_text())

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_summary_admission BEFORE INSERT ON provider_runs
    BEGIN SELECT RAISE(ABORT, 'provider admission unavailable'); END
    """)

    try do
      assert {:error, _reason, 0} = Summary.prepare(plan, snapshot, dependency)
      refute_received {:summary_dispatched, _, _, _}
      assert ProviderRunLog.list_runs(run.run_id) == []
    after
      SQL.query!(Repo, "DROP TRIGGER reject_summary_admission")
    end
  end

  test "terminal fact persistence failure never yields a ready discussion or redispatches",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    capture(response_text())

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_summary_output BEFORE INSERT ON provider_outputs
    BEGIN SELECT RAISE(ABORT, 'provider output unavailable'); END
    """)

    try do
      assert {:error, _reason, 1} = Summary.prepare(plan, snapshot, dependency)
      assert_received {:summary_dispatched, _ir, _params, ctx}
      assert ProviderRunLog.get_output(ctx.provider_run_id) == nil

      assert ProviderRunLog.operation_source_keys(run, Summary.operation()) ==
               {:ok,
                MapSet.new(plan.discussion_sources, &Compaction.discussion_source_key(&1, run))}

      assert {:error, :provider_operation_already_owned, 0} =
               Summary.prepare(plan, snapshot, dependency)

      refute_received {:summary_dispatched, _, _, _}
    after
      SQL.query!(Repo, "DROP TRIGGER reject_summary_output")
    end
  end

  test "cancellation before dispatch and during a real execution keep different call facts",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    parent = self()

    Application.put_env(:novel_application, :compaction_summary_test_provider, fn _ir,
                                                                                  _params,
                                                                                  ctx ->
      initial = AdapterExecution.initial_events(ctx)
      AdapterExecution.emit_events(ctx, initial, :running)
      send(parent, {:waiting_summary, self()})

      receive do
        :finish_cancel -> :ok
      end

      AdapterExecution.materialize_cancelled(ctx, initial_events: initial)
    end)

    task = Task.async(fn -> Summary.prepare(plan, snapshot, dependency) end)
    assert_receive {:waiting_summary, worker}, 1000
    assert :ok = Execution.cancel(snapshot.provider_cancellation_token, :author_cancelled)
    send(worker, :finish_cancel)
    assert {:error, %{type: :cancelled}, 1} = Task.await(task)
    assert [%{status: "cancelled"}] = ProviderRunLog.list_runs(run.run_id)

    assert {:error, :cancelled, 0} = Summary.prepare(plan, snapshot, dependency)
    refute_received {:waiting_summary, _}
  end

  test "oversized input and missing execution preserve sources without calling a global provider",
       %{run: run, snapshot: snapshot, dependency: dependency} do
    {plan, _messages} = plan(run)
    capture(response_text())

    oversized =
      update_in(plan.discussion_sources, fn [source] ->
        [%{source | text: String.duplicate("原", 50_000)}]
      end)

    assert {:error, :discussion_summary_input_budget_exceeded, 0} =
             Summary.prepare(oversized, snapshot, dependency)

    assert {:error, :provider_execution_missing, 0} = Summary.prepare(plan, snapshot, nil)
    assert ProviderRunLog.list_runs(run.run_id) == []
    refute_received {:summary_dispatched, _, _, _}
  end

  defp capture(response) do
    parent = self()

    Application.put_env(:novel_application, :compaction_summary_test_provider, fn ir,
                                                                                  params,
                                                                                  ctx ->
      assert %{
               status: "initialized",
               provider_id: "compaction_summary_test",
               model: "summary-model"
             } = ProviderRunLog.get_run(ctx.provider_run_id)

      send(parent, {:summary_dispatched, ir, params, ctx})

      AdapterExecution.materialize_result({:ok, Result.new(response)}, ctx,
        initial_events: AdapterExecution.initial_events(ctx)
      )
    end)
  end

  defp plan(run) do
    source_run = %{run | run_id: "run-earlier", parent_turn_ref: "turn-earlier"}
    source_identity = source_run |> Map.from_struct() |> Map.put(:status, "completed")

    transcript =
      AuthoringTranscript.new(source_identity,
        base_text: "历史讨论的应用来源",
        author_text: "先讨论动机，不要写正文。",
        author_turn_ref: "turn-earlier"
      )
      |> AuthoringTranscript.append_assistant("我建议先对照资料。稍后我会确认动机。")

    TestAgenticLoopFixtures.append_segment!(transcript, status: "completed")

    messages =
      transcript.messages
      |> MessageCoverage.annotate(source_identity)
      |> Enum.reject(&(&1.role == "application_base"))

    selector = MessageCoverage.selector(List.last(messages))
    covers = %{call_ids: [], message_refs: [selector], turn_range: "turn-earlier"}
    {:ok, sources} = Compaction.discussion_sources(messages, covers)

    {%{
       covers: covers,
       discussion_sources: sources,
       source_refs: [MessageCoverage.source_ref(selector)],
       versions: %{},
       omissions: ["模型讨论摘要不是作者授权。"],
       summary: "较早讨论整理"
     }, messages}
  end

  defp checkpoint(plan, run) do
    block =
      RequestIR.checkpoint_block(
        plan.covers,
        plan.source_refs,
        plan.versions,
        plan.omissions,
        plan.summary,
        plan.discussion
      )

    [message] =
      MessageCoverage.annotate(
        [RequestIR.message(:checkpoint, :application, [block])],
        Map.from_struct(run)
      )

    message
  end

  defp response_text do
    ~s({"version":"authoring-discussion-summary/v2","entries":[{"source_index":0,"summary":"早期 AI 建议先对照资料，动机确认尚待处理。","retained_fragment_indices":[0]}]})
  end

  defp sha256(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)
end
