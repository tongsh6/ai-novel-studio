defmodule NovelApplication.HistoryReadBoundaryTest do
  @moduledoc """
  B71 §16.8 历史读取边界回归（真实持久负例）。

  覆盖：缺版本/旧 v2 事实不得补造，运行时一律拒绝；v3 task 的
  header/run/work/parent 必须完整归属；legacy direct/step 与显式绑定同一 scope 校验；
  显式但畸形绑定不得回退唯一 parent；批量入口必须校验传入 assistant row 的
  work/session 来源。

  项目未发布，不兼容历史数据格式：v2 内嵌 checkpoint 已无运行时读取路径，
  本文件只保留「旧格式被拒绝」负例与 v3 正例，不再构造 v2 只读兼容证据。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.{
    AgentRunHistory,
    AuthoringCheckpoint,
    AuthoringReplay,
    AuthoringTranscript
  }

  alias NovelCommon.RequestIR

  alias NovelPersistence.{
    AgentRunLog,
    AuthoringSessionLog,
    LongRunTaskLog,
    MemoryLog,
    Repo,
    WorkRepo,
    WorkSessionRepo
  }

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkRepo.create(%{title: "历史读取边界"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    %{work: work, session: session}
  end

  test "缺 checkpoint_version 的旧副本是未知事实，不得补造 v2", %{
    work: work,
    session: session
  } do
    turn = unique("turn_missing_version")
    run_id = unique("run_missing_version")

    seed_run!(work, session, run_id, turn, checkpoint_version: :missing)

    record_assistant!(work, session, turn, %{
      text: "回复",
      turn_result: %{turn_id: turn}
    })

    assert {:error, :authoring_transcript} =
             AuthoringReplay.fetch(work.id, session.id, turn)
  end

  test "v3 task 缺 parent_turn_ref 必须拒绝，不能只校验有值时相等", %{
    work: work,
    session: session
  } do
    turn = unique("turn_v3_missing_parent")
    run_id = unique("run_v3_missing_parent")

    seed_run!(work, session, run_id, turn, checkpoint_version: 3, task_parent: nil)

    record_assistant!(work, session, turn, %{
      text: "回复",
      turn_result: %{turn_id: turn}
    })

    assert {:error, :authoring_transcript} =
             AuthoringReplay.fetch(work.id, session.id, turn)
  end

  test "v2 内嵌 checkpoint 已无运行时读取路径，完整 v2 同样拒绝", %{
    work: work,
    session: session
  } do
    # 负例输入：显式构造旧 v2 内嵌格式（含完整 header/checkpoint），证明它被拒绝，
    # 而不是被任何兼容路径读取。
    turn = unique("turn_v2_complete")
    run_id = unique("run_v2_complete")

    seed_run!(work, session, run_id, turn,
      checkpoint_version: 2,
      checkpoint: checkpoint(work, session, run_id, turn, unique("完整 v2 历史"))
    )

    record_assistant!(work, session, turn, %{
      text: "回复",
      turn_result: %{turn_id: turn}
    })

    assert {:error, :authoring_transcript} =
             AuthoringReplay.fetch(work.id, session.id, turn)
  end

  test "legacy direct/step 接受真实非空 workspace 命名空间，但拒绝空串绕过", %{
    work: work,
    session: session
  } do
    direct_turn = unique("turn_legacy_direct_scope")
    step_turn = unique("turn_legacy_step_scope")
    direct_run = unique("run_legacy_direct_scope")
    step_run = unique("run_legacy_step_scope")

    seed_valid_v3!(work, session, direct_run, direct_turn)
    seed_valid_v3!(work, session, step_run, step_turn)
    insert_step!(step_run, 1)

    # Channel topic 命名空间独立于 work；合法不同命名空间不能被当成错绑。
    force_workspace!(direct_run, "lobby")
    force_workspace!(step_run, "lobby")

    assert {:ok, %{id: ^direct_run}, :legacy} =
             AgentRunHistory.resolve(work.id, session.id, direct_turn)

    assert {:ok, %{id: ^step_run}, :legacy} =
             AgentRunHistory.resolve(work.id, session.id, step_turn <> ":agent:1")

    # 缺失/空命名空间不能绕过 scope 校验。
    force_workspace!(direct_run, "")
    force_workspace!(step_run, "")

    assert {:error, :history_scope_mismatch} =
             AgentRunHistory.resolve(work.id, session.id, direct_turn)

    assert {:error, :history_scope_mismatch} =
             AgentRunHistory.resolve(work.id, session.id, step_turn <> ":agent:1")
  end

  test "显式但畸形的 run 绑定不得过滤后回退唯一 parent", %{
    work: work,
    session: session
  } do
    for malformed <- [false, "", 123] do
      turn = unique("turn_malformed_row_run")
      run_id = unique("run_malformed_row")
      seed_valid_v3!(work, session, run_id, turn)

      record_assistant!(work, session, turn, %{
        text: "回复",
        agent_run_id: malformed,
        turn_result: %{turn_id: turn, agent_run: %{run_id: run_id}}
      })

      assert {:error, :history_binding_malformed} =
               AgentRunHistory.resolve(work.id, session.id, turn)

      turn = unique("turn_malformed_result_run")
      run_id = unique("run_malformed_result")
      seed_valid_v3!(work, session, run_id, turn)

      record_assistant!(work, session, turn, %{
        text: "回复",
        agent_run_id: run_id,
        turn_result: %{turn_id: turn, agent_run: %{run_id: malformed}}
      })

      assert {:error, :history_binding_malformed} =
               AgentRunHistory.resolve(work.id, session.id, turn)
    end
  end

  test "显式但畸形的 parent 绑定不得 blank 过滤后回退唯一 parent", %{
    work: work,
    session: session
  } do
    for malformed <- [false, "", 123] do
      turn = unique("turn_malformed_parent")
      run_id = unique("run_malformed_parent")
      seed_valid_v3!(work, session, run_id, turn)

      record_assistant!(work, session, turn, %{
        text: "回复",
        agent_run_id: run_id,
        turn_result: %{
          turn_id: turn,
          parent_turn_id: malformed,
          agent_run: %{run_id: run_id}
        }
      })

      assert {:error, :history_binding_malformed} =
               AgentRunHistory.resolve(work.id, session.id, turn)
    end
  end

  test "批量入口必须校验传入 assistant row 确属给定 work/session", %{
    work: work,
    session: session
  } do
    turn = unique("turn_batch_foreign_row")
    run_id = unique("run_batch_local")

    seed_valid_v3!(work, session, run_id, turn)

    {:ok, other_work} = WorkRepo.create(%{title: "另一个作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id})

    {:ok, foreign_row} =
      MemoryLog.record(%{
        workspace_id: other_work.id,
        session_id: other_session.id,
        turn_id: turn,
        role: "assistant",
        content: %{
          text: "别处回复",
          agent_run_id: run_id,
          turn_result: %{turn_id: turn, agent_run: %{run_id: run_id}}
        },
        source_ref: turn,
        scope_ref: other_work.id
      })

    assert %{^turn => {:error, :history_scope_mismatch}} =
             AgentRunHistory.resolve_transcript_entries(work.id, session.id, [foreign_row])

    {:ok, local_row} =
      MemoryLog.record(%{
        workspace_id: work.id,
        session_id: session.id,
        turn_id: turn,
        role: "assistant",
        content: %{
          text: "本地回复",
          agent_run_id: run_id,
          turn_result: %{turn_id: turn, agent_run: %{run_id: run_id}}
        },
        source_ref: turn,
        scope_ref: work.id
      })

    assert %{^turn => {:error, :history_scope_mismatch}} =
             AgentRunHistory.resolve_transcript_entries(work.id, session.id, [
               local_row,
               foreign_row
             ])
  end

  # v3 正例夹具：canonical transcript 经唯一生产压缩入口 compact/6 生成，
  # durable checkpoint 只引用同一 run 的私有历史（VS-00L §16.8）。
  defp seed_valid_v3!(work, session, run_id, turn) do
    seed_run!(work, session, run_id, turn,
      checkpoint_version: 3,
      checkpoint: checkpoint(work, session, run_id, turn, unique("可回查历史"))
    )
  end

  defp seed_run!(work, session, run_id, parent_turn, opts) do
    version = Keyword.fetch!(opts, :checkpoint_version)
    task_parent = Keyword.get(opts, :task_parent, parent_turn)
    header_run_id = Keyword.get(opts, :header_run_id, run_id)

    checkpoint =
      Keyword.get_lazy(opts, :checkpoint, fn ->
        checkpoint(work, session, run_id, parent_turn, unique("可回查历史"))
      end)

    task_data = task_checkpoint_data(version, header_run_id, checkpoint)

    {:ok, task} =
      LongRunTaskLog.create(%{
        workspace_id: work.id,
        task_type: "agent_run",
        parent_turn_ref: task_parent,
        status: "READY",
        phase: "PLANNED",
        checkpoint_data: task_data
      })

    attrs = %{
      id: run_id,
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      parent_turn_ref: parent_turn,
      origin_frame_ref: "frame-#{run_id}",
      run_mode: "durable",
      profile_ref: "conversation_turn_v1",
      status: "completed",
      phase: "stopped",
      long_run_task_ref: task.id
    }

    {:ok, run} = AgentRunLog.upsert_run(attrs)

    if version == 3 do
      seed_session_segment!(run, checkpoint)
    end

    %{run: run, task: task, checkpoint: checkpoint}
  end

  # v3 正例夹具：canonical 经应用写入边界编码，在同一事务边界追加为会话执行段。
  defp seed_session_segment!(run, checkpoint) do
    {:ok, transcript} = AuthoringTranscript.restore(checkpoint)
    {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(transcript)
    {:ok, _state} = AuthoringSessionLog.append_run(run, segment)
  end

  defp task_checkpoint_data(:missing, header_run_id, checkpoint) do
    %{
      "agent_run" => %{"run_id" => header_run_id},
      "authoring_transcript" => checkpoint
    }
  end

  # 负例输入：旧 v2 内嵌格式。只为证明该事实被拒绝，不提供任何读取兼容。
  defp task_checkpoint_data(2, header_run_id, checkpoint) do
    %{
      "agent_run" => %{
        "run_id" => header_run_id,
        "checkpoint_version" => 2
      },
      "authoring_transcript" => checkpoint
    }
  end

  defp task_checkpoint_data(3, header_run_id, _checkpoint) do
    %{
      "agent_run" => %{
        "run_id" => header_run_id,
        "checkpoint_version" => 3,
        "authoring_segment_ref" => %{
          "run_id" => header_run_id,
          "version" => AuthoringSessionLog.segment_format_version()
        }
      }
    }
  end

  defp checkpoint(work, session, run_id, parent_turn, summary) do
    # 会话级 call_id 唯一（CP3）：同一 session 的多 run 夹具不得复用固定 tool call id。
    call_id = "call-" <> run_id

    {:ok, compacted} =
      %{
        run_id: run_id,
        work_id: work.id,
        workspace_id: work.id,
        session_id: session.id,
        parent_turn_ref: parent_turn,
        profile_ref: "conversation_turn_v1"
      }
      |> AuthoringTranscript.new(base_text: "应用 Base", author_text: "作者原话")
      |> AuthoringTranscript.append_assistant("先读取角色。", [tool_call(call_id)])
      |> AuthoringTranscript.append_observation(call_id, observation())
      |> AuthoringTranscript.compact(
        %{call_ids: [call_id]},
        [],
        %{},
        ["旧细节已省略"],
        summary
      )

    compacted
    |> AuthoringCheckpoint.checkpoint()
    |> Jason.encode!()
    |> Jason.decode!()
  end

  defp tool_call(call_id) do
    RequestIR.tool_call_block(
      "read_character",
      %{"character_ref" => "character:1"},
      call_id
    )
  end

  defp observation do
    %{status: "ok", content: %{summary: "角色"}, source_refs: [], versions: %{}}
  end

  defp record_assistant!(work, session, turn_id, content) do
    {:ok, interaction} =
      MemoryLog.record(%{
        workspace_id: work.id,
        session_id: session.id,
        turn_id: turn_id,
        role: "assistant",
        content: content,
        source_ref: turn_id,
        scope_ref: work.id
      })

    interaction
  end

  defp insert_step!(run_id, sequence) do
    {:ok, _step} =
      AgentRunLog.insert_step(%{
        id: "#{run_id}:step:#{sequence}",
        run_id: run_id,
        sequence: sequence,
        status: "completed",
        goal: "已记录步骤",
        idempotency_key: "#{run_id}:#{sequence}"
      })

    :ok
  end

  defp force_workspace!(run_id, workspace) do
    SQL.query!(Repo, "UPDATE agent_runs SET workspace_id = ? WHERE id = ?", [workspace, run_id])
  end

  defp unique(prefix), do: "#{prefix}_#{System.unique_integer([:positive, :monotonic])}"
end
