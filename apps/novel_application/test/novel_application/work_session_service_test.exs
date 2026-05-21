defmodule NovelApplication.WorkSessionServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelApplication.WorkSessionService
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Repo
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
  end

  describe "search/2" do
    test "searches sessions within the work", %{work: work} do
      {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "第三章节奏"})
      record(work.id, session.id, "turn-1", "assistant", "妹妹林瑶的伏笔")

      assert [%{id: id}] = WorkSessionService.search(work.id, "林瑶")
      assert id == session.id
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
end
