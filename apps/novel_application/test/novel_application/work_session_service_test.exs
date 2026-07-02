defmodule NovelApplication.WorkSessionServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelApplication.WorkSessionService
  alias NovelCommon.Contracts.{ProviderEvent, ProviderOutput, ProviderRun}
  alias NovelPersistence.{AgentRunLog, MemoryLog, ProviderRunLog, Repo}
  alias NovelPersistence.WorkSessionRepo

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "灵源纪元"})
    %{work: work}
  end

  describe "resume/1" do
    test "creates and returns the last active session for a work", %{work: work} do
      assert {:ok, snapshot} = WorkSessionService.resume(work.id)

      assert snapshot.work.id == work.id
      assert snapshot.active_session.work_id == work.id
      assert snapshot.active_session.status == "ACTIVE"
      assert snapshot.transcript == []
      assert snapshot.pending_adoptions == []
    end

    test "returns full transcript in session order", %{work: work} do
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

      record(work.id, session.id, "turn-1", "user", "第一句")
      record(work.id, session.id, "turn-1", "assistant", "第二句")

      assert {:ok, snapshot} = WorkSessionService.resume(work.id)
      assert Enum.map(snapshot.transcript, & &1.text) == ["第一句", "第二句"]
      assert Enum.map(snapshot.transcript, & &1.role) == ["user", "assistant"]
    end

    test "returns only the latest transcript page for long sessions", %{work: work} do
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

      for index <- 1..35 do
        record(work.id, session.id, "turn-#{index}", "user", "第#{index}句")
      end

      assert {:ok, snapshot} = WorkSessionService.resume(work.id)

      assert length(snapshot.transcript) == 30
      assert Enum.map(snapshot.transcript, & &1.text) == Enum.map(6..35, &"第#{&1}句")
      assert snapshot.transcript_page.returned_count == 30
      assert snapshot.transcript_page.has_more_before == true

      assert {:ok, older} =
               WorkSessionService.transcript_page(work.id, session.id,
                 before_id: snapshot.transcript_page.before_id,
                 limit: 30
               )

      assert Enum.map(older.transcript, & &1.text) == Enum.map(1..5, &"第#{&1}句")
      assert older.transcript_page.has_more_before == false
    end

    test "extracts pending adoption from persisted assistant turn_result", %{work: work} do
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

      turn_result = %{
        turn_id: "turn-pending",
        assistant_message: %{text: "这里有一个设定"},
        adoption_state: %{
          pending: [
            %{
              artifact_id: "artifact-1",
              artifact_type: "plot_direction",
              adoption_status: "PENDING",
              requires_adoption: true,
              payload: %{title: "林瑶伏笔"}
            }
          ],
          resolved: []
        }
      }

      record(work.id, session.id, "turn-pending", "assistant", "这里有一个设定", turn_result)

      assert {:ok, snapshot} = WorkSessionService.resume(work.id)

      assert [%{artifact_id: "artifact-1", source_turn_ref: "turn-pending"}] =
               snapshot.pending_adoptions
    end

    test "does not return pending adoption after it is resolved", %{work: work} do
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

      pending_result = %{
        turn_id: "turn-pending",
        adoption_state: %{
          pending: [%{artifact_id: "artifact-1", artifact_type: "plot_direction", payload: %{}}],
          resolved: []
        }
      }

      resolved_result = %{
        turn_id: "turn-adopt",
        adoption_state: %{
          pending: [],
          resolved: [%{artifact_id: "artifact-1", artifact_type: "plot_direction", payload: %{}}]
        }
      }

      record(work.id, session.id, "turn-pending", "assistant", "待采纳", pending_result)
      record(work.id, session.id, "turn-adopt", "assistant", "已采纳", resolved_result)

      assert {:ok, snapshot} = WorkSessionService.resume(work.id)
      assert snapshot.pending_adoptions == []
      assert [%{artifact_id: "artifact-1"}] = snapshot.resolved_adoptions
    end

    test "returns canonical and legacy trace refs from persisted turn results", %{work: work} do
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

      record(work.id, session.id, "turn-canonical", "assistant", "新 trace", %{
        turn_id: "turn-canonical",
        trace_summary: %{trace_ref: "trace-canonical"}
      })

      record(work.id, session.id, "turn-legacy", "assistant", "旧 trace", %{
        turn_id: "turn-legacy",
        trace_summary: %{"trace_id" => "trace-legacy"}
      })

      assert {:ok, snapshot} = WorkSessionService.resume(work.id)
      assert snapshot.resume_trace_refs == ["trace-canonical", "trace-legacy"]
    end

    test "restores author-safe AgentRun provider activity into persisted assistant turn_result",
         %{work: work} do
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)
      run_id = "run-provider-restore-#{System.unique_integer([:positive, :monotonic])}"

      record(work.id, session.id, "turn-provider", "assistant", "模型结果已整理", %{
        turn_id: "turn-provider",
        assistant_message: %{text: "模型结果已整理"},
        agent_run: %{run_id: run_id}
      })

      assert {:ok, _run} =
               AgentRunLog.upsert_run(%{
                 id: run_id,
                 workspace_id: work.id,
                 work_id: work.id,
                 session_id: session.id,
                 parent_turn_ref: "turn-provider",
                 origin_frame_ref: "frame-provider",
                 run_mode: "bounded",
                 profile_ref: "conversation_turn_v1",
                 status: "completed",
                 phase: "stopped",
                 plan_ref: "ap-provider",
                 plan_version: 1
               })

      assert {:ok, _event} =
               AgentRunLog.insert_event(%{
                 id: "evt-provider-restored-started",
                 run_id: run_id,
                 step_id: "step-provider",
                 sequence: 1,
                 event_type: "provider_progress",
                 visibility: "developer",
                 summary: "provider_event:started",
                 reason_codes: ["provider_execution_stream", "provider_started"],
                 refs: ["provider_run:prun-restored", "provider_call:pcall-restored"],
                 payload: %{
                   "stage" => "provider_execution_recorded",
                   "provider_run_ref" => "prun-restored",
                   "provider_call_ref" => "pcall-restored",
                   "raw_prompt" => "must not be restored",
                   "turn_result" => %{"assistant_message" => "must not be restored"}
                 }
               })

      assert {:ok, _event} =
               AgentRunLog.insert_event(%{
                 id: "evt-provider-restored-internal",
                 run_id: run_id,
                 step_id: "step-provider",
                 sequence: 2,
                 event_type: "provider_progress",
                 visibility: "internal",
                 summary: "internal provider payload",
                 reason_codes: ["provider_internal"],
                 refs: [],
                 payload: %{"raw_prompt" => "must not be restored"}
               })

      {:ok, provider_run} =
        ProviderRun.new(%{
          provider_run_id: "prun-restored",
          provider_call_ref: "pcall-restored",
          purpose: :conversation,
          execution_mode: :event_stream,
          status: :completed,
          provider_id: "slice_verify",
          model: "stub-model"
        })

      {:ok, provider_event} =
        ProviderEvent.new(%{
          event_id: "pevt-restored-final",
          provider_run_ref: "prun-restored",
          sequence: 2,
          event_type: :final_output,
          visibility: :developer,
          summary: "Provider final output materialized.",
          payload: %{content_length: 18, raw_prompt: "must not be restored"},
          refs: ["pcall-restored"]
        })

      {:ok, provider_output} =
        ProviderOutput.new(%{
          provider_run_ref: "prun-restored",
          provider_call_ref: "pcall-restored",
          status: :ok,
          output_type: :text,
          content: %{text: "raw output must not be restored"},
          usage: %{total_tokens: 18},
          refs: ["pcall-restored"]
        })

      assert :ok =
               ProviderRunLog.record_execution(
                 {:ok,
                  %{provider_run: provider_run, events: [provider_event], output: provider_output}},
                 %{
                   agent_run_id: run_id,
                   workspace_id: work.id,
                   work_id: work.id,
                   session_id: session.id,
                   parent_turn_ref: "turn-provider",
                   step_id: "step-provider",
                   purpose: :conversation
                 }
               )

      assert {:ok, snapshot} = WorkSessionService.resume(work.id)
      [entry] = snapshot.transcript
      agent_run = entry.turn_result[:agent_run]

      assert agent_run.run_id == run_id
      assert agent_run.profile_ref == "conversation_turn_v1"
      assert agent_run.activity_loaded == false
      refute Map.has_key?(agent_run, :events)
      refute Map.has_key?(agent_run, :provider_runs)
    end

    test "restores AgentRun summaries for multiple transcript turns without hydrating events",
         %{work: work} do
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

      record(work.id, session.id, "turn-one", "assistant", "第一轮完成", %{
        turn_id: "turn-one",
        assistant_message: %{text: "第一轮完成"},
        agent_run: %{run_id: "run-resume-one"}
      })

      record(work.id, session.id, "turn-two", "assistant", "第二轮完成", %{
        turn_id: "turn-two",
        assistant_message: %{text: "第二轮完成"},
        agent_run: %{run_id: "run-resume-two"}
      })

      for {run_id, turn_id, event_id, summary} <- [
            {"run-resume-one", "turn-one", "evt-resume-one", "第一轮上下文已读取。"},
            {"run-resume-two", "turn-two", "evt-resume-two", "第二轮上下文已读取。"}
          ] do
        assert {:ok, _run} =
                 AgentRunLog.upsert_run(%{
                   id: run_id,
                   workspace_id: work.id,
                   work_id: work.id,
                   session_id: session.id,
                   parent_turn_ref: turn_id,
                   origin_frame_ref: "frame-#{turn_id}",
                   run_mode: "bounded",
                   profile_ref: "conversation_turn_v1",
                   status: "completed",
                   phase: "stopped",
                   plan_ref: "ap-#{turn_id}",
                   plan_version: 1
                 })

        assert {:ok, _event} =
                 AgentRunLog.insert_event(%{
                   id: event_id,
                   run_id: run_id,
                   step_id: "step-#{turn_id}",
                   sequence: 1,
                   event_type: "exploration_observed",
                   visibility: "author",
                   summary: summary,
                   reason_codes: ["context_restored"],
                   refs: [],
                   payload: %{"turn_id" => turn_id}
                 })
      end

      assert {:ok, snapshot} = WorkSessionService.resume(work.id)

      agent_runs_by_turn =
        snapshot.transcript
        |> Map.new(fn entry ->
          {entry.turn_id, entry.turn_result[:agent_run]}
        end)

      assert agent_runs_by_turn["turn-one"].run_id == "run-resume-one"
      assert agent_runs_by_turn["turn-one"].profile_ref == "conversation_turn_v1"
      assert agent_runs_by_turn["turn-one"].activity_loaded == false
      refute Map.has_key?(agent_runs_by_turn["turn-one"], :events)

      assert agent_runs_by_turn["turn-two"].run_id == "run-resume-two"
      assert agent_runs_by_turn["turn-two"].profile_ref == "conversation_turn_v1"
      assert agent_runs_by_turn["turn-two"].activity_loaded == false
      refute Map.has_key?(agent_runs_by_turn["turn-two"], :events)
    end

    test "does not include archived sessions in the default resume list", %{work: work} do
      {:ok, active} = WorkSessionRepo.ensure_active_for_work(work.id)

      {:ok, _archived} =
        WorkSessionRepo.create(%{work_id: work.id, title: "旧会话", status: "ARCHIVED"})

      assert {:ok, snapshot} = WorkSessionService.resume(work.id)
      assert Enum.map(snapshot.sessions, & &1.id) == [active.id]
    end
  end

  describe "restore_channel_turn_results/2" do
    test "restores socket action state without hydrating AgentRun activity", %{work: work} do
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)
      run_id = "run-channel-restore-#{System.unique_integer([:positive, :monotonic])}"

      record(work.id, session.id, "turn-channel", "assistant", "可采纳的设定", %{
        turn_id: "turn-channel",
        assistant_message: %{text: "可采纳的设定"},
        agent_run: %{run_id: run_id},
        adoption_state: %{
          pending: [
            %{artifact_id: "artifact-channel", artifact_type: "plot_direction", payload: %{}}
          ],
          resolved: []
        }
      })

      assert {:ok, _run} =
               AgentRunLog.upsert_run(%{
                 id: run_id,
                 workspace_id: work.id,
                 work_id: work.id,
                 session_id: session.id,
                 parent_turn_ref: "turn-channel",
                 origin_frame_ref: "frame-channel",
                 run_mode: "bounded",
                 profile_ref: "conversation_turn_v1",
                 status: "completed",
                 phase: "stopped",
                 plan_ref: "ap-channel",
                 plan_version: 1
               })

      assert {:ok, _event} =
               AgentRunLog.insert_event(%{
                 id: "evt-channel-restore-started",
                 run_id: run_id,
                 step_id: "step-channel",
                 sequence: 1,
                 event_type: "provider_progress",
                 visibility: "developer",
                 summary: "provider_event:started",
                 reason_codes: ["provider_execution_stream", "provider_started"],
                 refs: ["provider_run:prun-channel", "provider_call:pcall-channel"],
                 payload: %{"provider_run_ref" => "prun-channel"}
               })

      assert {:ok, state} = WorkSessionService.restore_channel_turn_results(work.id, session.id)
      assert state.session.id == session.id
      assert state.read_only == false
      assert [turn_result] = state.turn_results
      agent_run = map_field(turn_result, :agent_run)

      assert map_field(agent_run, :run_id) == run_id
      refute map_has_key?(agent_run, :events)
      refute map_has_key?(agent_run, :provider_runs)

      assert {:ok, snapshot} = WorkSessionService.resume(work.id)
      [entry] = snapshot.transcript
      summary_agent_run = map_field(entry.turn_result, :agent_run)
      assert summary_agent_run[:activity_loaded] == false
      refute map_has_key?(summary_agent_run, :events)
      refute map_has_key?(summary_agent_run, :provider_runs)
    end
  end

  describe "search/2" do
    test "searches sessions within the work", %{work: work} do
      {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "第三章节奏"})
      record(work.id, session.id, "turn-1", "assistant", "妹妹林瑶的伏笔")

      assert [%{id: id}] = WorkSessionService.search(work.id, "林瑶")
      assert id == session.id
    end

    test "search can find archived sessions", %{work: work} do
      {:ok, session} =
        WorkSessionRepo.create(%{
          work_id: work.id,
          title: "归档会话",
          summary: "妹妹林瑶的旧讨论",
          status: "ARCHIVED"
        })

      assert [%{id: id, status: "ARCHIVED"}] = WorkSessionService.search(work.id, "林瑶")
      assert id == session.id
    end
  end

  describe "create/2" do
    test "creates a new active session and exits the previous active session", %{work: work} do
      {:ok, previous} = WorkSessionRepo.ensure_active_for_work(work.id)
      record(work.id, previous.id, "turn-old", "user", "旧会话内容")

      assert {:ok, created} =
               WorkSessionService.create(work.id, %{"title" => "新会话"})

      assert created.status == "ACTIVE"
      assert created.title == "新会话"
      assert WorkSessionRepo.get_by_work(work.id, previous.id).status == "EXITED"

      assert {:ok, previous_snapshot} = WorkSessionService.show(work.id, previous.id)
      assert previous_snapshot.read_only == true
      assert Enum.map(previous_snapshot.transcript, & &1.text) == ["旧会话内容"]

      assert {:ok, active_snapshot} = WorkSessionService.resume(work.id)
      assert active_snapshot.active_session.id == created.id
      assert active_snapshot.transcript == []
    end

    test "rejects missing work ids" do
      assert {:error, :work_not_found} =
               WorkSessionService.create(Ecto.UUID.generate(), %{"title" => "孤儿会话"})
    end
  end

  describe "archive/2" do
    test "archives an exited session", %{work: work} do
      {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "旧会话", status: "EXITED"})

      assert {:ok, archived} = WorkSessionService.archive(work.id, session.id)
      assert archived.id == session.id
      assert archived.status == "ARCHIVED"
    end

    test "does not archive the active session", %{work: work} do
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

      assert {:error, :cannot_archive_active_session} =
               WorkSessionService.archive(work.id, session.id)
    end
  end

  describe "show/2" do
    test "returns a read-only snapshot for exited history and does not restore pending actions",
         %{
           work: work
         } do
      {:ok, session} =
        WorkSessionRepo.create(%{
          work_id: work.id,
          title: "第三章节奏",
          status: "EXITED"
        })

      turn_result = %{
        turn_id: "turn-pending",
        adoption_state: %{
          pending: [
            %{
              artifact_id: "artifact-1",
              artifact_type: "plot_direction",
              adoption_status: "PENDING",
              requires_adoption: true,
              payload: %{title: "林瑶伏笔"}
            }
          ],
          resolved: []
        }
      }

      record(work.id, session.id, "turn-1", "user", "我想回收妹妹林瑶的伏笔")
      record(work.id, session.id, "turn-pending", "assistant", "可以这样设计", turn_result)

      assert {:ok, snapshot} = WorkSessionService.show(work.id, session.id)
      assert snapshot.session.id == session.id
      assert snapshot.read_only == true
      assert Enum.map(snapshot.transcript, & &1.text) == ["我想回收妹妹林瑶的伏笔", "可以这样设计"]
      assert snapshot.pending_adoptions == []
    end

    test "keeps active session pending actions available", %{work: work} do
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

      turn_result = %{
        turn_id: "turn-pending",
        adoption_state: %{
          pending: [%{artifact_id: "artifact-1", artifact_type: "plot_direction", payload: %{}}],
          resolved: []
        }
      }

      record(work.id, session.id, "turn-pending", "assistant", "待采纳", turn_result)

      assert {:ok, snapshot} = WorkSessionService.show(work.id, session.id)
      assert snapshot.read_only == false
      assert [%{artifact_id: "artifact-1"}] = snapshot.pending_adoptions
    end

    test "does not expose a session from another work", %{work: work} do
      {:ok, other_work} = WorkService.create(%{title: "另一部作品"})
      {:ok, session} = WorkSessionRepo.create(%{work_id: other_work.id, title: "其他会话"})

      assert {:error, :session_not_found} = WorkSessionService.show(work.id, session.id)
    end
  end

  defp record(work_id, session_id, turn_id, role, text, turn_result \\ nil) do
    content =
      %{text: text}
      |> maybe_put_turn_result(turn_result)

    {:ok, _} =
      MemoryLog.record(%{
        workspace_id: work_id,
        session_id: session_id,
        turn_id: turn_id,
        role: role,
        content: content,
        source_ref: turn_id,
        scope_ref: work_id
      })
  end

  defp maybe_put_turn_result(content, nil), do: content

  defp maybe_put_turn_result(content, turn_result),
    do: Map.put(content, :turn_result, turn_result)

  defp map_field(map, key) when is_map(map),
    do: Map.get(map, key) || Map.get(map, Atom.to_string(key))

  defp map_field(_, _key), do: nil

  defp map_has_key?(map, key) when is_map(map),
    do: Map.has_key?(map, key) or Map.has_key?(map, Atom.to_string(key))

  defp map_has_key?(_, _key), do: false
end
