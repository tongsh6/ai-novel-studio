defmodule NovelApplication.ProviderActivityServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{ProviderActivityService, WorkService}
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
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
               provider_run_ref: "prun-query",
               provider_call_ref: "pcall-query",
               purpose: "conversation",
               status: "ok",
               output_type: "text",
               usage: %{"total_tokens" => 21},
               events: [event],
               output: output
             }
           ] = activity.provider_runs

    assert event.event_type == "final_output"
    assert event.visibility == "author"
    assert event.payload["content_length"] == String.length("raw model output must not leak")
    refute inspect(output) =~ "raw model output must not leak"
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

    {:ok, provider_run} =
      ProviderRun.new(%{
        provider_run_id: "prun-query",
        provider_call_ref: "pcall-query",
        purpose: :conversation,
        execution_mode: :event_stream,
        status: :completed,
        provider_id: "slice_verify",
        model: "stub-model"
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
        usage: %{total_tokens: 21},
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
