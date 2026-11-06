defmodule NovelApplication.ProviderActivityServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelCommon.SystemIdentity
  alias NovelApplication.{ProviderActivityProjector, ProviderActivityService, WorkService}
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
  alias NovelDomain.AgentRun
  alias NovelPersistence.{AgentRunLog, ProviderRunLog, Repo, WorkSessionRepo}

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "ProviderRun 查询作品"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "当前会话"})
    %{work: work, session: session}
  end

  test "returns author-safe provider activity for one scoped turn", %{
    work: work,
    session: session
  } do
    seed_provider_activity!(work.id, session.id, "turn-provider-query", "run-provider-query")

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(
               work.id,
               session.id,
               "turn-provider-query"
             )

    assert activity.work_id == work.id
    assert activity.session_id == session.id
    assert activity.turn_id == "turn-provider-query"
    assert activity.totals.provider_run_count == 1
    assert activity.totals.provider_call_refs == ["pcall-query"]
    assert activity.totals.total_tokens == 21
    assert activity.totals.content_length == String.length("raw model output must not leak")

    assert [
             %{
               run_id: "run-provider-query",
               events: [agent_event]
             }
           ] = activity.agent_runs

    assert agent_event.event_id == "evt-provider-query-context"
    assert agent_event.payload["provider_run_ref"] == "prun-query"
    refute Map.has_key?(agent_event.payload, "raw_prompt")
    refute Map.has_key?(agent_event.payload, "turn_result")

    assert [
             %{
               run_id: "run-provider-query",
               provider_run_ref: "prun-query",
               provider_call_ref: "pcall-query",
               purpose: "conversation",
               status: "ok",
               output_type: "text",
               usage: %{"total_tokens" => 21, "cached_tokens" => 7, "ttft_ms" => 9},
               system_identity_ref: %{
                 "version" => "sys-identity-v1",
                 "content_hash" => "hash-test"
               },
               events: [event],
               output: output
             }
           ] = activity.provider_runs

    refute inspect(activity.provider_runs) =~ String.slice(SystemIdentity.content(), 0, 24)

    assert event.event_type == "final_output"
    assert event.visibility == "author"
    assert event.payload["content_length"] == String.length("raw model output must not leak")
    refute inspect(output) =~ "raw model output must not leak"
  end

  # B23 CP1：judgment_plan / judgment_loop 把 TurnResult 持久化为子 turn
  # （`<parent>:agent:<sequence>`），而 AgentRun.parent_turn_ref 是父消息 id。
  # 回查必须命中该 run 的真实持久 step，不能只凭 parent 猜最新 run。
  test "resolves a child agent turn id to the parent message turn's run", %{
    work: work,
    session: session
  } do
    parent_turn_id = "message_parent_turn_b23"
    child_turn_id = "#{parent_turn_id}:agent:6"
    run_id = "run-parent-turn-b23"
    seed_provider_activity!(work.id, session.id, parent_turn_id, run_id)

    {:ok, _step} =
      AgentRunLog.insert_step(%{
        id: "#{run_id}:step:6",
        run_id: run_id,
        sequence: 6,
        status: "completed",
        goal: "判断计划步骤",
        idempotency_key: "#{run_id}:6"
      })

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, child_turn_id)

    assert activity.turn_id == child_turn_id

    assert [
             %{
               run_id: "run-parent-turn-b23",
               parent_turn_ref: ^parent_turn_id,
               events: [agent_event]
             }
           ] = activity.agent_runs

    assert agent_event.summary == "模型调用已完成。"
    refute Map.has_key?(agent_event.payload, "raw_prompt")
    refute Map.has_key?(agent_event.payload, "turn_result")
    assert activity.totals.provider_run_count == 1
  end

  test "keeps an unknown plain turn id empty instead of failing", %{work: work, session: session} do
    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, "turn-without-run")

    assert activity.agent_runs == []
    assert activity.provider_runs == []
  end

  test "rejects a session from another work", %{work: work} do
    {:ok, other_work} = WorkService.create(%{title: "其他作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id, title: "其他会话"})

    assert {:error, :session_not_found} =
             ProviderActivityService.fetch_turn_activity(
               work.id,
               other_session.id,
               "turn-provider-query"
             )
  end

  test "restores running provider execution facts recorded by the activity projector", %{
    work: work,
    session: session
  } do
    turn_id = "turn-provider-projector"
    run_id = "run-provider-projector"
    step_id = "step-provider-projector"

    assert {:ok, _run_record} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: work.id,
               work_id: work.id,
               session_id: session.id,
               parent_turn_ref: turn_id,
               origin_frame_ref: "frame-provider-projector",
               run_mode: "bounded",
               profile_ref: "conversation_turn_v1",
               status: "running",
               phase: "executing",
               plan_ref: "ap-provider-projector",
               plan_version: 1
             })

    {:ok, run} =
      AgentRun.new(%{
        run_id: run_id,
        workspace_id: work.id,
        work_id: work.id,
        session_id: session.id,
        parent_turn_ref: turn_id,
        origin_frame_ref: "frame-provider-projector",
        profile_ref: "conversation_turn_v1",
        current_step_ref: step_id,
        status: :running,
        phase: :executing,
        goal: %{text: "provider activity", version: 1},
        authority_scope: %{production_write: false, allowed_tools: ["conversation"]}
      })

    provider_execution =
      [provider: :stub, provider_run_id: "prun-projector", provider_call_ref: "pcall-projector"]
      |> Execution.dependency()
      |> ProviderActivityProjector.with_stage_sink(
        %{run: run, stage_sink: fn _event -> :ok end},
        purpose: :conversation
      )

    complete = Execution.result_fn(provider_execution)

    # Gateway.execute/4 只接受 canonical RequestIR（生产请求已统一），测试按真实形状构造。
    prompt =
      NovelTest.TestRequestIR.ir([NovelTest.TestRequestIR.base("hello provider projector")])

    assert {:ok, result} = complete.(prompt)

    assert result.content != ""
    refute result.content =~ "[stub]"

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, turn_id)

    provider_run =
      Enum.find(activity.provider_runs, &(&1.provider_run_ref == "prun-projector"))

    assert provider_run
    assert provider_run.step_ref == step_id
    assert provider_run.provider_call_ref == "pcall-projector"

    event_types = Enum.map(provider_run.events, & &1.event_type)
    assert "started" in event_types
    assert "progress" in event_types
    assert "chunk" in event_types
    assert "final_output" in event_types
  end

  # B71 HTTP 出口：run_resumed 历史事件里持久化了 application 私有的
  # checkpoint_data envelope。作者 payload 边界必须剥离该明确键（含历史事件），
  # 同时保留公开事实与 JSON 标量语义（false / null / 普通字符串）。
  test "keeps private run_resumed checkpoint_data out of the author activity payload", %{
    work: work,
    session: session
  } do
    turn_id = "turn-private-checkpoint-http-service"
    run_id = "run-private-checkpoint-http-service"
    event_id = "evt-private-checkpoint-http-service"
    task_ref = "task-private-checkpoint-http-service"

    marker =
      "B71_PRIVATE_CHECKPOINT_HTTP_SERVICE_#{System.unique_integer([:positive, :monotonic])}"

    note = "作者可见说明提到 checkpoint_data 字样也应原样保留"

    assert {:ok, _run} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: work.id,
               work_id: work.id,
               session_id: session.id,
               parent_turn_ref: turn_id,
               origin_frame_ref: "frame-private-checkpoint-http-service",
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
               step_id: "step-private-checkpoint-http-service-1",
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

    assert {:ok, activity} =
             ProviderActivityService.fetch_turn_activity(work.id, session.id, turn_id)

    assert [%{run_id: ^run_id, events: [event]}] = activity.agent_runs

    payload = event.payload

    refute Map.has_key?(payload, "checkpoint_data")
    refute Map.has_key?(payload, :checkpoint_data)
    refute inspect(payload) =~ marker
    refute inspect(payload) =~ "PROMPT_#{marker}"

    assert event.refs == [task_ref]
    assert payload["long_run_task_ref"] == task_ref
    assert payload["runtime_live"] == false
    assert Map.has_key?(payload, "recovery_gate")
    assert payload["recovery_gate"] == nil
    assert payload["note"] == note
    assert payload["note"] =~ "checkpoint_data"

    persisted =
      AgentRunLog.list_events(run_id)
      |> Enum.find(&(&1.id == event_id))

    assert persisted.payload["checkpoint_data"]["private_reasoning"] == marker
    assert persisted.payload["checkpoint_data"]["private_prompt"] == "PROMPT_#{marker}"

    assert inspect(persisted.payload["checkpoint_data"]["authoring_transcript"]) =~ marker
    assert persisted.payload["runtime_live"] == false
    assert persisted.payload["recovery_gate"] == nil
    assert persisted.payload["note"] == note
  end

  defp seed_provider_activity!(work_id, session_id, turn_id, run_id) do
    assert {:ok, _run} =
             AgentRunLog.upsert_run(%{
               id: run_id,
               workspace_id: work_id,
               work_id: work_id,
               session_id: session_id,
               parent_turn_ref: turn_id,
               origin_frame_ref: "frame-provider-query",
               run_mode: "bounded",
               profile_ref: "conversation_turn_v1",
               status: "completed",
               phase: "stopped",
               plan_ref: "ap-provider-query",
               plan_version: 1
             })

    assert {:ok, _event} =
             AgentRunLog.insert_event(%{
               id: "evt-provider-query-context",
               run_id: run_id,
               step_id: "step-provider-query",
               sequence: 1,
               event_type: "provider_progress",
               visibility: "author",
               summary: "模型调用已完成。",
               reason_codes: ["provider_execution_stream"],
               refs: ["provider_run:prun-query", "provider_call:pcall-query"],
               payload: %{
                 "provider_run_ref" => "prun-query",
                 "provider_call_ref" => "pcall-query",
                 "raw_prompt" => "must not leak",
                 "turn_result" => %{"assistant_message" => "must not leak"}
               }
             })

    {:ok, provider_run} =
      ProviderRun.new(%{
        provider_run_id: "prun-query",
        provider_call_ref: "pcall-query",
        purpose: :conversation,
        execution_mode: :event_stream,
        status: :completed,
        provider_id: "slice_verify",
        model: "stub-model",
        metadata: %{
          "system_identity_ref" => %{
            "version" => "sys-identity-v1",
            "content_hash" => "hash-test"
          }
        }
      })

    {:ok, provider_event} =
      ProviderEvent.new(%{
        event_id: "pevt-query-final",
        provider_run_ref: "prun-query",
        sequence: 1,
        event_type: :final_output,
        visibility: :author,
        summary: "Provider final output materialized.",
        payload: %{content_length: String.length("raw model output must not leak")},
        refs: ["pcall-query"]
      })

    {:ok, provider_output} =
      ProviderOutput.new(%{
        provider_run_ref: "prun-query",
        provider_call_ref: "pcall-query",
        status: :ok,
        output_type: :text,
        content: %{text: "raw model output must not leak"},
        usage: %{total_tokens: 21, cached_tokens: 7, ttft_ms: 9},
        refs: ["pcall-query"]
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
                 step_id: "step-provider-query",
                 purpose: :conversation
               }
             )
  end
end
