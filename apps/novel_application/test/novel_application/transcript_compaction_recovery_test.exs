defmodule NovelApplication.TranscriptCompactionRecoveryTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AgentRunFlows.AuthoringSession

  alias NovelApplication.{
    AgentRunService,
    CompactionRecord,
    TestAgentRunCleanup,
    TranscriptCompactionSummary
  }

  alias NovelApplication.{AgentRunMaintenance, AuthoringTranscript, TestAgenticLoopFixtures}
  alias NovelCommon.Contracts.{ProviderOutput, ProviderRun}
  alias NovelDomain.{AgentNextStepDecision, AgentRun}
  alias NovelPersistence.{AgentRunLog, ProviderRunLog, Repo}

  @author "  先比较，不要执行；风险表还没完成。\r\n"
  @discussion "早期建议仍是暂定方案。稍后我会逐项比较风险。"
  @response " \n" <>
              ~s({"version":"authoring-discussion-summary/v1","entries":[{"source_index":0,"summary":"早期 AI 提出暂定方案，比较风险尚未完成。","retained_obligations":["稍后我会逐项比较风险。"]}]}) <>
              "\r\n"

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})
    old = Application.get_env(:novel_application, :auto_maintenance)
    Application.put_env(:novel_application, :auto_maintenance, %{enabled: true})

    on_exit(fn ->
      if old == nil,
        do: Application.delete_env(:novel_application, :auto_maintenance),
        else: Application.put_env(:novel_application, :auto_maintenance, old)
    end)

    prior = transcript("history", @author) |> AuthoringTranscript.append_assistant(@discussion)
    :ok = TestAgenticLoopFixtures.append_segment!(prior, status: "completed")
    state = state("owner")
    {execution, context} = received_response(state.run)
    %{state: state, prior: prior, execution: execution, context: context}
  end

  test "failed canonical commit retains the original response; retry submits without a provider",
       facts do
    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_recovery_checkpoint BEFORE INSERT ON authoring_session_messages
    WHEN NEW.role = 'checkpoint'
    BEGIN SELECT RAISE(ABORT, 'checkpoint unavailable'); END
    """)

    try do
      assert {:reply, {:error, :checkpoint_persistence_failed}, unchanged} =
               AgentRunMaintenance.start(facts.state, nil, :explicit)

      assert unchanged == facts.state
      assert checkpoints(facts.state.run.run_id) == []
      assert pending_text() == @response
    after
      SQL.query!(Repo, "DROP TRIGGER reject_recovery_checkpoint")
    end

    assert {:reply, {:ok, %{compacted: true}}, recovered} =
             AgentRunMaintenance.start(facts.state, nil, :explicit)

    assert recovered.run.consumed_budget.provider_calls == 0
    assert [event] = checkpoints(facts.state.run.run_id)
    assert event.payload["covered_counts"]["discussion_messages"] == 1
    refute inspect(event) =~ @response
    restored = TestAgenticLoopFixtures.persisted_transcript(facts.state.run.run_id)
    checkpoint = Enum.find(restored.messages, &(&1.role == "checkpoint"))
    assert hd(checkpoint.blocks).discussion.response_text == @response
    assert ProviderRunLog.get_run("prun-recovery").operation_checkpoint == nil

    assert TestAgenticLoopFixtures.persisted_transcript("history").messages ==
             facts.prior.messages

    assert :ok = ProviderRunLog.record_execution(facts.execution, facts.context)
    assert ProviderRunLog.get_run("prun-recovery").operation_checkpoint == nil

    assert {:reply, {:ok, %{compacted: false}}, _} =
             AgentRunMaintenance.start(recovered, nil, :explicit)

    assert length(checkpoints(facts.state.run.run_id)) == 1
    assert length(ProviderRunLog.list_runs(facts.state.run.run_id)) == 1
  end

  test "a later run recovers an ended owner's exact response without pressure or model budget",
       facts do
    assert {:ok, _} = AgentRunLog.upsert_run(%{id: "owner", status: "failed", phase: "stopped"})
    target = state("later")

    target = %{
      target
      | run: %{
          target.run
          | consumed_budget: %{
              target.run.consumed_budget
              | provider_calls: target.run.budget.max_provider_calls
            }
        }
    }

    recovered = AgentRunMaintenance.maybe_start(target)
    assert [_] = checkpoints("later")
    assert recovered.run.consumed_budget == target.run.consumed_budget
    assert ProviderRunLog.list_runs("later") == []
    restored = TestAgenticLoopFixtures.persisted_transcript("later")
    checkpoint = Enum.find(restored.messages, &(&1.role == "checkpoint"))
    assert hd(checkpoint.blocks).discussion.provider_run_ref == "prun-recovery"
    assert hd(checkpoint.blocks).discussion.response_text == @response

    assert TestAgenticLoopFixtures.persisted_transcript("history").messages ==
             facts.prior.messages
  end

  test "another active run, cancellation and changed direction never acquire a pending response",
       facts do
    other = state("other")
    assert AgentRunMaintenance.maybe_start(other) == other

    for attrs <- [
          %{status: "cancelled", phase: "stopped"},
          %{status: "paused", phase: "stopped"},
          %{status: "failed", phase: "stopped", goal_version: 2}
        ] do
      assert {:ok, _} = AgentRunLog.upsert_run(Map.put(attrs, :id, "owner"))
      assert AgentRunMaintenance.maybe_start(other) == other
      assert pending_text() == @response
      assert checkpoints("other") == []
    end

    assert ProviderRunLog.list_runs("other") == []
    assert facts.state.provider_execution == nil
  end

  test "private transfer failure rolls back the checkpoint and author event together", facts do
    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_private_transfer BEFORE UPDATE OF operation_checkpoint ON provider_runs
    WHEN json_type(OLD.operation_checkpoint) = 'object'
      AND (NEW.operation_checkpoint IS NULL OR json_type(NEW.operation_checkpoint) = 'null')
    BEGIN SELECT RAISE(ABORT, 'private transfer unavailable'); END
    """)

    try do
      assert {:reply, {:error, :checkpoint_persistence_failed}, unchanged} =
               AgentRunMaintenance.start(facts.state, nil, :explicit)

      assert unchanged == facts.state
      assert checkpoints("owner") == []

      refute Enum.any?(
               TestAgenticLoopFixtures.persisted_transcript("owner").messages,
               &(&1.role == "checkpoint")
             )

      assert pending_text() == @response
    after
      SQL.query!(Repo, "DROP TRIGGER reject_private_transfer")
    end
  end

  test "corrupt response, source coordinates and unknown selection fields fail closed", facts do
    original = ProviderRunLog.get_run("prun-recovery").operation_checkpoint

    changes = [
      Map.put(original, "response_text", @response <> " "),
      put_in(original, ["plan", "covers", "message_refs", Access.at(0), "run_sequence"], 999),
      put_in(original, ["plan", "covers", "unknown_selection"], true)
    ]

    for changed <- changes do
      SQL.query!(Repo, "UPDATE provider_runs SET operation_checkpoint = ? WHERE id = ?", [
        Jason.encode!(changed),
        "prun-recovery"
      ])

      assert {:reply, {:error, _}, unchanged} =
               AgentRunMaintenance.start(facts.state, nil, :explicit)

      assert unchanged == facts.state
      assert checkpoints("owner") == []
    end

    assert length(ProviderRunLog.list_runs("owner")) == 1
  end

  test "a cancelled consumer cannot apply a different run's pending response", _facts do
    assert {:ok, _} = AgentRunLog.upsert_run(%{id: "owner", status: "failed", phase: "stopped"})
    target = state("cancelled-consumer")
    target = %{target | run: %{target.run | status: :cancelled}}

    assert {:reply, {:ok, %{compacted: false}}, _} =
             AgentRunMaintenance.start(target, nil, :explicit)

    assert checkpoints("cancelled-consumer") == []
    assert pending_text() == @response
  end

  test "a stale snapshot cannot overwrite a newer original direction before validating recovery",
       facts do
    assert {:ok, plan} =
             TranscriptCompactionSummary.pending_plan(facts.state.run)

    assert {:ok, _} =
             AgentRunLog.upsert_run(%{id: "owner", goal_version: 2, goal_text: "作者已改变方向"})

    assert {:ok, compacted} =
             AuthoringSession.compact(
               facts.state.stage_state.judgment_transcript,
               plan
             )

    proposed = put_in(facts.state.stage_state.judgment_transcript, compacted)

    assert {:error, :checkpoint_persistence_failed} =
             CompactionRecord.commit(proposed, plan, compacted)

    assert AgentRunLog.get_run("owner").goal_version == 2
    assert checkpoints("owner") == []
    assert pending_text() == @response
  end

  test "a stale receiving snapshot cannot overwrite a persisted stop or new goal", _facts do
    assert {:ok, _} = AgentRunLog.upsert_run(%{id: "owner", status: "failed", phase: "stopped"})

    for {id, attrs} <- [
          {"cancelled-target", %{status: "cancelled", phase: "stopped"}},
          {"paused-target", %{status: "paused", phase: "stopped"}},
          {"changed-target", %{goal_version: 2, goal_text: "新的作者方向"}}
        ] do
      target = state(id)
      assert {:ok, plan} = TranscriptCompactionSummary.pending_plan(target.run)
      assert {:ok, persisted} = AgentRunLog.upsert_run(Map.put(attrs, :id, id))

      assert {:ok, compacted} =
               AuthoringSession.compact(target.stage_state.judgment_transcript, plan)

      proposed = put_in(target.stage_state.judgment_transcript, compacted)

      assert {:error, :checkpoint_persistence_failed} =
               CompactionRecord.commit(proposed, plan, compacted)

      assert AgentRunLog.get_run(id) == persisted
      assert checkpoints(id) == []
      assert pending_text() == @response
    end
  end

  test "two prepared consumers cannot both publish the same response", _facts do
    assert {:ok, _} = AgentRunLog.upsert_run(%{id: "owner", status: "failed", phase: "stopped"})
    first = state("first-consumer")
    second = state("second-consumer")
    assert {:ok, plan} = TranscriptCompactionSummary.pending_plan(first.run)

    assert {:ok, same_plan} =
             TranscriptCompactionSummary.pending_plan(second.run)

    assert plan == same_plan

    assert {:reply, {:ok, %{compacted: true}}, _} =
             AgentRunMaintenance.start(first, nil, :explicit)

    assert {:ok, compacted} =
             AuthoringSession.compact(
               second.stage_state.judgment_transcript,
               same_plan
             )

    proposed = put_in(second.stage_state.judgment_transcript, compacted)

    assert {:error, :checkpoint_persistence_failed} =
             CompactionRecord.commit(proposed, same_plan, compacted)

    assert checkpoints("second-consumer") == []
    assert length(checkpoints("first-consumer")) == 1
    assert ProviderRunLog.get_run("prun-recovery").operation_checkpoint == nil
  end

  test "the real bounded runtime applies a persisted response at its next safe point", _facts do
    assert {:ok, _} = AgentRunLog.upsert_run(%{id: "owner", status: "failed", phase: "stopped"})
    transcript = transcript("runtime-consumer", "继续之前的待办。")
    parent = self()

    planner = fn run, sequence, _snapshot ->
      {:ok, decision} =
        AgentNextStepDecision.new(%{
          decision_id: "wait-recovery",
          run_ref: run.run_id,
          sequence: sequence,
          decision_type: :await_author,
          summary: "等待作者继续。",
          reason_codes: ["wait"]
        })

      send(parent, :business_planned)
      {:await_author, decision, %{provider_call_count: 0, judgment_transcript: transcript}}
    end

    attrs =
      Map.merge(transcript.run, %{
        origin_frame_ref: "frame-runtime",
        profile_ref: "conversation_turn_v1",
        goal: %{text: "继续讨论", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["read_character"]}
      })

    assert {:ok, id} =
             AgentRunService.start_bounded(attrs, next_step_planner: planner)

    TestAgentRunCleanup.register_run(id)
    assert_receive :business_planned
    await_checkpoint(id, 100)
    assert ProviderRunLog.list_runs(id) == []
    assert ProviderRunLog.get_run("prun-recovery").operation_checkpoint == nil
  end

  defp await_checkpoint(_id, 0), do: flunk("runtime recovery did not commit")

  defp await_checkpoint(id, remaining) do
    if checkpoints(id) == [] do
      Process.sleep(10)
      await_checkpoint(id, remaining - 1)
    else
      :ok
    end
  end

  defp received_response(run) do
    source = %{
      "source_index" => 0,
      "source" => %{"run_id" => "history", "run_sequence" => 3},
      "text" => @discussion,
      "author_text" => @author
    }

    digest =
      {"authoring-discussion-summary/v1", "ws-recovery", "work-recovery", "session-recovery",
       [source]}
      |> :erlang.term_to_binary([:deterministic])
      |> sha()

    plan = %{
      "covers" => %{
        "call_ids" => [],
        "message_refs" => [
          %{
            "run_id" => "history",
            "run_sequence" => 3,
            "role" => "assistant",
            "source_refs" => [],
            "versions" => %{}
          }
        ],
        "turn_range" => "turn-history"
      },
      "source_refs" => [%{"ref" => "session_message:history:3", "version" => 1}],
      "versions" => %{},
      "omissions" => ["原文保留，摘要不代表作者授权。"],
      "summary" => "较早讨论整理",
      "history_target" => %{"session_id" => run.session_id, "turn_id" => "turn-history"}
    }

    context = %{
      agent_run_id: run.run_id,
      workspace_id: run.workspace_id,
      work_id: run.work_id,
      session_id: run.session_id,
      parent_turn_ref: run.parent_turn_ref,
      purpose: :other,
      step_id: nil
    }

    provider = %ProviderRun{
      provider_run_id: "prun-recovery",
      provider_call_ref: "pcall-recovery",
      purpose: :other,
      execution_mode: :event_stream,
      status: :initialized,
      provider_id: "fixture",
      model: "fixture",
      owner_refs:
        Map.merge(context, %{
          operation: "transcript_compaction",
          coverage_key: digest,
          discussion_source_keys: [
            "authoring-session-source/v1:" <>
              Jason.encode!([run.workspace_id, run.work_id, run.session_id, "history", 3])
          ]
        })
    }

    checkpoint = %{
      "version" => "provider-operation-checkpoint/v1",
      "goal_version" => 1,
      "plan" => plan
    }

    assert :ok =
             ProviderRunLog.admit_operation(
               provider,
               Map.put(context, :operation_checkpoint, checkpoint),
               fn -> :ok end
             )

    output = %ProviderOutput{
      provider_run_ref: provider.provider_run_id,
      provider_call_ref: provider.provider_call_ref,
      status: :ok,
      content: %{text: @response}
    }

    execution =
      {:ok, %{provider_run: %{provider | status: :completed}, output: output, events: []}}

    assert :ok = ProviderRunLog.record_execution(execution, context)
    {execution, context}
  end

  defp state(id) do
    transcript = transcript(id, "保持之前的待办，继续讨论。")
    :ok = TestAgenticLoopFixtures.append_segment!(transcript, status: "awaiting_author")

    {:ok, run} =
      AgentRun.new(
        Map.merge(transcript.run, %{
          run_mode: :bounded,
          origin_frame_ref: "frame-" <> id,
          profile_ref: "conversation_turn_v1",
          status: :awaiting_author,
          goal: %{text: "继续讨论", version: 1},
          authority_scope: %{production_write: false, allowed_tools: ["read_character"]}
        })
      )

    %{
      run: run,
      stage_state: %{judgment_transcript: transcript},
      events: [],
      event_sequence: 0,
      current_task_ref: nil,
      current_task_pid: nil,
      current_task_kind: nil,
      provider_execution: nil,
      provider_cancellation_token: nil
    }
  end

  defp transcript(id, author) do
    AuthoringTranscript.new(
      %{
        run_id: id,
        workspace_id: "ws-recovery",
        work_id: "work-recovery",
        session_id: "session-recovery",
        parent_turn_ref: "turn-" <> id
      },
      base_text: "作者保留最终裁决。",
      author_text: author,
      author_turn_ref: "turn-" <> id
    )
  end

  defp checkpoints(id),
    do: Enum.filter(AgentRunLog.list_author_events(id), &(&1.event_type == "checkpoint_created"))

  defp pending_text,
    do: ProviderRunLog.get_run("prun-recovery").operation_checkpoint["response_text"]

  defp sha(text), do: :crypto.hash(:sha256, text) |> Base.encode16(case: :lower)
end
