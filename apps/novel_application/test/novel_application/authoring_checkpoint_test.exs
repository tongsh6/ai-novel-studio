defmodule NovelApplication.AuthoringCheckpointTest do
  @moduledoc """
  B81 CP1：会话级 canonical 历史读写边界（`AuthoringCheckpoint` +
  `AuthoringSessionLog`）的真实持久回归。

  canonical 作用域是会话：消息在 `authoring_session_messages` 追加，run 只持有
  执行段头（`authoring_run_segments`）；`AuthoringCheckpoint.restore/2` 按 run 重建
  执行段 transcript，`checkpoint_data` 只核对段引用，不复制、不回退旧内嵌副本。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.{AuthoringCheckpoint, AuthoringTranscript}
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelPersistence.{AgentRunLog, AuthoringSessionLog, Repo, WorkRepo, WorkSessionRepo}
  alias NovelPersistence.Schemas.AgentRunRecord

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkRepo.create(%{title: "checkpoint 会话历史"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    %{work: work, session: session}
  end

  defp unique(prefix), do: "#{prefix}_#{System.unique_integer([:positive, :monotonic])}"

  defp run_identity(work, session, overrides \\ %{}) do
    Map.merge(
      %{
        run_id: unique("run-checkpoint"),
        workspace_id: work.id,
        work_id: work.id,
        session_id: session.id,
        parent_turn_ref: unique("turn-checkpoint"),
        profile_ref: "conversation_turn_v1"
      },
      overrides
    )
  end

  defp record(identity) do
    %AgentRunRecord{
      id: identity.run_id,
      workspace_id: identity.workspace_id,
      work_id: identity.work_id,
      session_id: identity.session_id,
      parent_turn_ref: identity.parent_turn_ref,
      origin_frame_ref: "frame-checkpoint",
      run_mode: "bounded",
      profile_ref: identity.profile_ref,
      status: "completed",
      phase: "stopped"
    }
  end

  defp run_attrs(record) do
    %{
      id: record.id,
      workspace_id: record.workspace_id,
      work_id: record.work_id,
      session_id: record.session_id,
      parent_turn_ref: record.parent_turn_ref
    }
  end

  defp transcript(identity) do
    AuthoringTranscript.new(identity, base_text: "作者决定作品事实", author_text: "检查角色")
  end

  # 生产等价 seed：application 写入边界编码 → 会话存储追加。
  defp seed_segment!(record, transcript) do
    {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(record, transcript)
    seed_encoded_segment!(record, segment)
  end

  defp seed_encoded_segment!(record, segment) do
    {:ok, state} = AuthoringSessionLog.append_run(run_attrs(record), segment)
    state
  end

  defp checkpoint(identity) do
    identity
    |> transcript()
    |> AuthoringTranscript.checkpoint()
  end

  defp json_normalize(value), do: value |> Jason.encode!() |> Jason.decode!()

  defp durable_data(record, extra \\ %{}) do
    Map.merge(
      %{
        "agent_run" => %{
          "checkpoint_version" => 3,
          "authoring_segment_ref" => AuthoringCheckpoint.ref(record.id)
        }
      },
      extra
    )
  end

  test "有会话段时按 run 读取 canonical，durable 段引用只核对不复制", %{
    work: work,
    session: session
  } do
    identity = run_identity(work, session)
    record = record(identity)
    seed_segment!(record, transcript(identity))

    assert {:ok, restored, :session_segment} =
             AuthoringCheckpoint.restore(record, durable_data(record))

    assert [%{role: "application_base"}, %{role: "user"}] = restored.messages

    assert {:ok, %{header: header, messages: messages}} =
             AuthoringSessionLog.fetch_run_segment(record.id)

    assert header["version"] == AuthoringCheckpoint.format_version()
    assert length(messages) == 2
  end

  test "bounded run 没有 long-run checkpoint 时直接读会话段，不启动执行", %{
    work: work,
    session: session
  } do
    identity = run_identity(work, session)
    record = record(identity)
    seed_segment!(record, transcript(identity))

    assert {:ok, restored, :session_segment} = AuthoringCheckpoint.restore(record, nil)
    assert [%{role: "application_base"}, %{role: "user"}] = restored.messages
  end

  test "无会话段且无 checkpoint 数据时返回 none，不伪造历史", %{
    work: work,
    session: session
  } do
    record = record(run_identity(work, session))

    assert {:ok, nil, :none} = AuthoringCheckpoint.restore(record, nil)
    assert {:ok, nil, :none} = AuthoringCheckpoint.restore(record, %{})
  end

  test "有 checkpoint 数据但缺版本时报告未知格式 partial，不猜成旧格式", %{
    work: work,
    session: session
  } do
    identity = run_identity(work, session)
    record = record(identity)

    assert {:partial, :checkpoint_version_missing} =
             AuthoringCheckpoint.restore(record, %{
               "agent_run" => %{"run_id" => record.id},
               "authoring_transcript" => checkpoint(identity)
             })
  end

  test "有会话段时 checkpoint_data 内旧内嵌副本被忽略，选择段内容", %{
    work: work,
    session: session
  } do
    identity = run_identity(work, session)
    record = record(identity)
    seed_segment!(record, transcript(identity))

    embedded = %{"version" => "embedded-but-not-read", "transcript" => %{}}

    assert {:ok, restored, :session_segment} =
             AuthoringCheckpoint.restore(
               record,
               durable_data(record, %{"authoring_transcript" => embedded})
             )

    assert [%{role: "application_base"}, %{role: "user"}] = restored.messages
  end

  test "会话段消息缺失时如实报告 inconsistent，不回退 checkpoint_data 内嵌副本", %{
    work: work,
    session: session
  } do
    identity = run_identity(work, session)
    record = record(identity)
    seed_segment!(record, transcript(identity))

    embedded = %{"authoring_transcript" => AuthoringTranscript.checkpoint(transcript(identity))}

    SQL.query!(
      Repo,
      "DELETE FROM authoring_session_messages WHERE run_id = ? AND run_sequence = 2",
      [record.id]
    )

    assert {:error, :authoring_segment_inconsistent} =
             AuthoringCheckpoint.restore(record, durable_data(record, embedded))
  end

  test "会话段消息损坏时 fail-closed，不退回旧内嵌副本", %{work: work, session: session} do
    identity = run_identity(work, session)
    record = record(identity)
    seed_segment!(record, transcript(identity))

    embedded = %{"authoring_transcript" => AuthoringTranscript.checkpoint(transcript(identity))}

    SQL.query!(
      Repo,
      "UPDATE authoring_session_messages SET message = ? WHERE run_id = ? AND run_sequence = 1",
      [Jason.encode!(%{"nope" => true}), record.id]
    )

    assert {:error, _reason} = AuthoringCheckpoint.restore(record, durable_data(record, embedded))
  end

  test "未知段头版本在写入边界被拒绝，不产生可读段", %{work: work, session: session} do
    identity = run_identity(work, session)
    record = record(identity)
    {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(record, transcript(identity))

    bad_segment = %{
      segment
      | header: Map.put(segment.header, "version", "authoring-run-segment/v9")
    }

    other_identity = run_identity(work, session)
    other_record = record(other_identity)

    assert {:error, :authoring_segment_version_unsupported} =
             AuthoringSessionLog.append_run(run_attrs(other_record), bad_segment)
  end

  test "有会话段时 durable 段引用缺失/错绑/版本不符仍按新原子拒绝", %{
    work: work,
    session: session
  } do
    identity = run_identity(work, session)
    record = record(identity)
    seed_segment!(record, transcript(identity))

    assert {:error, :authoring_segment_ref_missing} =
             AuthoringCheckpoint.restore(record, %{"agent_run" => %{"checkpoint_version" => 3}})

    assert {:error, :authoring_segment_ref_mismatch} =
             AuthoringCheckpoint.restore(record, %{
               "agent_run" => %{
                 "checkpoint_version" => 3,
                 "authoring_segment_ref" => %{
                   "run_id" => "other-run",
                   "version" => AuthoringCheckpoint.format_version()
                 }
               }
             })

    assert {:error, :authoring_segment_ref_mismatch} =
             AuthoringCheckpoint.restore(record, %{
               "agent_run" => %{
                 "checkpoint_version" => 3,
                 "authoring_segment_ref" => %{
                   "run_id" => record.id,
                   "version" => "authoring-run-segment/v9"
                 }
               }
             })

    assert {:error, :checkpoint_version_mismatch} =
             AuthoringCheckpoint.restore(record, %{"agent_run" => %{"checkpoint_version" => 2}})
  end

  test "写入边界用共享 codec/IR 拒绝损坏语义，并输出可回读的段形状", %{
    work: work,
    session: session
  } do
    identity = run_identity(work, session)
    record = record(identity)
    transcript = transcript(identity)

    broken = %{transcript | messages: [%{role: "user"}]}

    assert {:error, _reason} = AuthoringCheckpoint.encode_segment_for_write(record, broken)

    assert {:error, :invalid_authoring_segment} =
             AuthoringCheckpoint.validate_segment(record, %{})

    assert {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(record, transcript)
    assert segment.header["version"] == AuthoringCheckpoint.format_version()

    # 编码后的消息与内存 checkpoint 的消息在 JSON 值上逐项一致（map 键序不参与比较）。
    assert json_normalize(segment.messages) ==
             json_normalize(AuthoringTranscript.checkpoint(transcript).transcript.messages)

    {:ok, state} = AuthoringSessionLog.append_run(run_attrs(record), segment)
    assert state.message_count == length(segment.messages)

    assert {:ok, restored, :session_segment} = AuthoringCheckpoint.restore(record, nil)
    assert restored.messages == transcript.messages
  end

  test "写入边界拒绝与 row 身份不符的 canonical", %{work: work, session: session} do
    identity = run_identity(work, session)
    record = record(identity)

    wrong = run_identity(work, session, %{session_id: "other-session"})

    assert {:error, :authoring_segment_identity_mismatch} =
             AuthoringCheckpoint.encode_segment_for_write(record, transcript(wrong))
  end

  test "写入边界按真实 JSON 表示编码，Date/Time/NaiveDateTime 三投影端到端逐字一致", %{
    work: work,
    session: session
  } do
    identity = run_identity(work, session)
    record = record(identity)

    transcript =
      AuthoringTranscript.new(identity,
        base_text: "只记录已有事实",
        author_text: "  检查日期\n"
      )
      |> AuthoringTranscript.append_assistant(
        "",
        [RequestIR.tool_call_block("archive_read", %{}, "json-read")]
      )
      |> AuthoringTranscript.append_observation("json-read", %{
        status: "ok",
        source_refs: [],
        content: %{
          date: ~D[2026-11-02],
          time: ~T[12:30:00],
          at: ~N[2026-11-02 12:30:00],
          original: "  字节\n"
        }
      })

    assert {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(record, transcript)

    assert [%{"blocks" => [%{"content" => content}]}] =
             Enum.filter(segment.messages, &(&1["role"] == "tool"))

    assert content["date"] == "2026-11-02"
    assert content["time"] == "12:30:00"
    assert content["at"] == "2026-11-02T12:30:00"
    assert content["original"] == "  字节\n"

    seed_encoded_segment!(record, segment)

    assert {:ok, restored, :session_segment} = AuthoringCheckpoint.restore(record, nil)
    assert {:ok, before_ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, after_ir} = AuthoringTranscript.to_request_ir(restored)

    for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
      assert {:ok, before_body} = Projection.project(before_ir, target)
      assert {:ok, after_body} = Projection.project(after_ir, target)
      assert before_body == after_body, "projection #{target} changed after persistence"
      assert Jason.encode!(before_body) == Jason.encode!(after_body)
    end
  end

  test "写入边界拒绝不可 JSON 表示的私有值且错误不泄漏内容", %{work: work, session: session} do
    identity = run_identity(work, session)
    record = record(identity)
    marker = "private-payload-marker"

    transcript =
      AuthoringTranscript.new(identity, base_text: "base", author_text: "author")
      |> AuthoringTranscript.append_assistant(
        "",
        [RequestIR.tool_call_block("archive_read", %{}, "bad-value")]
      )
      |> AuthoringTranscript.append_observation("bad-value", %{
        status: "ok",
        content: %{callback: fn -> marker end}
      })

    assert {:error, reason} = AuthoringCheckpoint.encode_segment_for_write(record, transcript)
    assert reason == :authoring_segment_not_json_encodable
    refute inspect(reason) =~ marker
  end

  test "读取端对未知段头版本 fail-closed，不返回历史", %{work: work, session: session} do
    identity = run_identity(work, session)
    record = record(identity)
    seed_segment!(record, transcript(identity))

    {:ok, %{header: header}} = AuthoringSessionLog.fetch_run_segment(record.id)
    tamper_header!(record.id, Map.put(header, "version", "authoring-run-segment/v9"))

    assert {:error, :authoring_segment_version_unsupported} =
             AuthoringCheckpoint.restore(record, nil)
  end

  test "读取端对缺必需键的段头 fail-closed，不返回历史", %{work: work, session: session} do
    identity = run_identity(work, session)
    record = record(identity)
    seed_segment!(record, transcript(identity))

    {:ok, %{header: header}} = AuthoringSessionLog.fetch_run_segment(record.id)
    tamper_header!(record.id, Map.delete(header, "used_refs"))

    assert {:error, :authoring_segment_shape_invalid} = AuthoringCheckpoint.restore(record, nil)
  end

  test "run 行身份被改写后读取端 fail-closed，不回退旧身份段", %{
    work: work,
    session: session
  } do
    identity = run_identity(work, session)
    record = record(identity)

    {:ok, _run} =
      AgentRunLog.upsert_run(
        Map.merge(run_attrs(record), %{
          origin_frame_ref: "frame-checkpoint",
          run_mode: "bounded",
          profile_ref: identity.profile_ref,
          status: "completed",
          phase: "stopped"
        })
      )

    seed_segment!(record, transcript(identity))

    # 直接改写 run 行身份（模拟历史错绑/篡改），会话段头仍记录原身份。
    SQL.query!(Repo, "UPDATE agent_runs SET session_id = ? WHERE id = ?", [
      "other-session",
      record.id
    ])

    updated_run = AgentRunLog.get_run(record.id)
    assert updated_run.session_id == "other-session"

    assert {:error, :authoring_segment_identity_mismatch} =
             AuthoringCheckpoint.restore(updated_run, nil)
  end

  # 读取端负例的故障注入：直接改写段头 JSON（等价于 SQL json_set 修改 header）。
  defp tamper_header!(run_id, header) do
    SQL.query!(Repo, "UPDATE authoring_run_segments SET header = ? WHERE run_id = ?", [
      Jason.encode!(header),
      run_id
    ])
  end
end
