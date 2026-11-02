defmodule NovelWeb.ProviderActivityControllerTest do
  use NovelWeb.ConnCase, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
  alias NovelPersistence.{AgentRunLog, ProviderRunLog, Repo, WorkSessionRepo}

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "ProviderRun API 作品"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})
    %{work: work, session: session}
  end

  test "GET provider-runs returns scoped author-safe provider activity", %{
    conn: conn,
    work: work,
    session: session
  } do
    seed_provider_activity!(work.id, session.id, "turn-provider-api", "run-provider-api")

    conn =
      get(
        conn,
        "/api/works/#{work.id}/sessions/#{session.id}/turns/turn-provider-api/provider-runs"
      )

    body = json_response(conn, 200)

    assert body["work_id"] == work.id
    assert body["session_id"] == session.id
    assert body["turn_id"] == "turn-provider-api"
    assert body["totals"]["provider_run_count"] == 1
    assert body["totals"]["provider_call_refs"] == ["pcall-api"]
    assert body["totals"]["total_tokens"] == 34
    assert [%{"run_id" => "run-provider-api", "events" => [agent_event]}] = body["agent_runs"]
    assert agent_event["event_id"] == "evt-provider-api-context"
    assert agent_event["payload"]["provider_run_ref"] == "prun-api"
    refute Map.has_key?(agent_event["payload"], "raw_prompt")
    refute Map.has_key?(agent_event["payload"], "turn_result")

    assert [
             %{
               "run_id" => "run-provider-api",
               "provider_run_ref" => "prun-api",
               "provider_call_ref" => "pcall-api",
               "purpose" => "planner",
               "events" => [event],
               "output" => output
             }
           ] = body["provider_runs"]

    assert event["event_type"] == "final_output"
    assert event["payload"]["content_length"] == String.length("raw output must not leak")
    refute inspect(output) =~ "raw output must not leak"
  end

  test "GET provider-runs rejects cross-work session ids", %{conn: conn, work: work} do
    {:ok, other_work} = WorkService.create(%{title: "其他作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id, title: "其他会话"})

    conn =
      get(
        conn,
        "/api/works/#{work.id}/sessions/#{other_session.id}/turns/turn-provider-api/provider-runs"
      )

    assert %{"error" => "session_not_found"} = json_response(conn, 404)
  end

  test "GET agent-run-activity returns the same scoped activity endpoint", %{
    conn: conn,
    work: work,
    session: session
  } do
    seed_provider_activity!(
      work.id,
      session.id,
      "turn-agent-activity-api",
      "run-agent-activity-api"
    )

    conn =
      get(
        conn,
        "/api/works/#{work.id}/sessions/#{session.id}/turns/turn-agent-activity-api/agent-run-activity"
      )

    body = json_response(conn, 200)

    assert body["turn_id"] == "turn-agent-activity-api"
    assert [%{"run_id" => "run-agent-activity-api", "events" => [_event]}] = body["agent_runs"]
    assert [%{"provider_run_ref" => "prun-api"}] = body["provider_runs"]
  end

  # B71 HTTP 出口：两个 alias 端点共用作者 payload 边界，历史 run_resumed 事件里的
  # 私有 checkpoint_data envelope 与 marker 都不得出接口；公开 refs / false / null /
  # 普通字符串必须保持原义，且原 DB 事件不被改写。
  test "run_resumed checkpoint_data stays private on both provider activity endpoints", %{
    conn: conn,
    work: work,
    session: session
  } do
    turn_id = "turn-private-checkpoint-http-api"

    seeded =
      seed_run_resumed_checkpoint_event!(
        work.id,
        session.id,
        turn_id,
        "run-private-checkpoint-http-api",
        "evt-private-checkpoint-http-api"
      )

    run_id = seeded.run_id

    for endpoint <- ["provider-runs", "agent-run-activity"] do
      body =
        conn
        |> get("/api/works/#{work.id}/sessions/#{session.id}/turns/#{turn_id}/#{endpoint}")
        |> json_response(200)

      assert body["turn_id"] == turn_id
      assert [%{"run_id" => ^run_id, "events" => [event]}] = body["agent_runs"]

      payload = event["payload"]

      refute Map.has_key?(payload, "checkpoint_data")
      refute Map.has_key?(payload, "checkpoint-data")
      refute inspect(payload) =~ seeded.marker
      refute inspect(payload) =~ "PROMPT_#{seeded.marker}"

      assert event["refs"] == [seeded.task_ref]
      assert payload["long_run_task_ref"] == seeded.task_ref
      assert payload["runtime_live"] == false
      assert Map.has_key?(payload, "recovery_gate")
      assert payload["recovery_gate"] == nil
      assert payload["note"] == seeded.note
      assert payload["note"] =~ "checkpoint_data"
    end

    persisted =
      AgentRunLog.list_events(seeded.run_id)
      |> Enum.find(&(&1.id == seeded.event_id))

    assert persisted.payload["checkpoint_data"]["private_reasoning"] == seeded.marker
    assert persisted.payload["checkpoint_data"]["private_prompt"] == "PROMPT_#{seeded.marker}"

    assert inspect(persisted.payload["checkpoint_data"]["authoring_transcript"]) =~
             seeded.marker

    assert persisted.payload["runtime_live"] == false
    assert persisted.payload["recovery_gate"] == nil
    assert persisted.payload["note"] == seeded.note
  end

  defp seed_run_resumed_checkpoint_event!(work_id, session_id, turn_id, run_id, event_id) do
    task_ref = "task-private-checkpoint-http-api"

    marker =
      "B71_PRIVATE_CHECKPOINT_HTTP_API_#{System.unique_integer([:positive, :monotonic])}"

    note = "作者可见说明提到 checkpoint_data 字样也应原样保留"

    assert {:ok, _run} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: work_id,
               work_id: work_id,
               session_id: session_id,
               parent_turn_ref: turn_id,
               origin_frame_ref: "frame-private-checkpoint-http-api",
               run_mode: "durable",
               profile_ref: "character_design_with_context_v1",
               status: "running",
               phase: "executing",
               long_run_task_ref: task_ref
             })

    assert {:ok, _event} =
             AgentRunLog.insert_event(%{
               id: event_id,
               run_id: run_id,
               step_id: "step-private-checkpoint-http-api-1",
               sequence: 1,
               event_type: "run_resumed",
               visibility: "author",
               summary: "从检查点恢复",
               reason_codes: ["durable_recovered"],
               refs: [task_ref],
               payload: %{
                 "long_run_task_ref" => task_ref,
                 "runtime_live" => false,
                 "recovery_gate" => nil,
                 "note" => note,
                 "checkpoint_data" => %{
                   "private_reasoning" => marker,
                   "private_prompt" => "PROMPT_#{marker}",
                   "authoring_transcript" => %{"messages" => [%{"content" => marker}]}
                 }
               }
             })

    %{
      run_id: run_id,
      event_id: event_id,
      task_ref: task_ref,
      marker: marker,
      note: note
    }
  end

  defp seed_provider_activity!(work_id, session_id, turn_id, run_id) do
    assert {:ok, _run} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: work_id,
               work_id: work_id,
               session_id: session_id,
               parent_turn_ref: turn_id,
               origin_frame_ref: "frame-provider-api",
               run_mode: "bounded",
               profile_ref: "conversation_turn_v1",
               status: "completed",
               phase: "stopped",
               plan_ref: "ap-provider-api",
               plan_version: 1
             })

    assert {:ok, _event} =
             AgentRunLog.insert_event(%{
               id: "evt-provider-api-context",
               run_id: run_id,
               step_id: "step-provider-api",
               sequence: 1,
               event_type: "provider_progress",
               visibility: "author",
               summary: "模型调用已完成。",
               reason_codes: ["provider_execution_stream"],
               refs: ["provider_run:prun-api", "provider_call:pcall-api"],
               payload: %{
                 "provider_run_ref" => "prun-api",
                 "provider_call_ref" => "pcall-api",
                 "raw_prompt" => "must not leak",
                 "turn_result" => %{"assistant_message" => "must not leak"}
               }
             })

    {:ok, provider_run} =
      ProviderRun.new(%{
        provider_run_id: "prun-api",
        provider_call_ref: "pcall-api",
        purpose: :planner,
        execution_mode: :event_stream,
        status: :completed,
        provider_id: "slice_verify",
        model: "stub-model"
      })

    {:ok, provider_event} =
      ProviderEvent.new(%{
        event_id: "pevt-api-final",
        provider_run_ref: "prun-api",
        sequence: 1,
        event_type: :final_output,
        visibility: :author,
        summary: "Provider final output materialized.",
        payload: %{content_length: String.length("raw output must not leak")},
        refs: ["pcall-api"]
      })

    {:ok, provider_output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun-api",
        provider_call_ref: "pcall-api",
        status: :ok,
        output_type: :text,
        content: %{text: "raw output must not leak"},
        usage: %{total_tokens: 34},
        refs: ["pcall-api"]
      })

    assert :ok =
             ProviderRunLog.record_execution(
               {:ok,
                %{provider_run: provider_run, events: [provider_event], output: provider_output}},
               %{
                 agent_run_id: run_id,
                 workspace_id: work_id,
                 work_id: work_id,
                 session_id: session_id,
                 parent_turn_ref: turn_id,
                 step_id: "step-provider-api",
                 purpose: :planner
               }
             )
  end
end
