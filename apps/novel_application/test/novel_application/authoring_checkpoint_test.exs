defmodule NovelApplication.AuthoringCheckpointTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelPersistence.Schemas.AgentRunRecord

  defp run_identity(overrides \\ %{}) do
    Map.merge(
      %{
        run_id: "run-checkpoint",
        workspace_id: "work-checkpoint",
        work_id: "work-checkpoint",
        session_id: "session-checkpoint",
        parent_turn_ref: "turn-checkpoint"
      },
      overrides
    )
  end

  defp checkpoint do
    run_identity()
    |> AuthoringTranscript.new(base_text: "作者决定作品事实", author_text: "检查角色")
    |> AuthoringTranscript.checkpoint()
  end

  defp record(overrides \\ %{}) do
    identity = run_identity()

    struct(
      %AgentRunRecord{
        id: identity.run_id,
        workspace_id: identity.workspace_id,
        work_id: identity.work_id,
        session_id: identity.session_id,
        parent_turn_ref: identity.parent_turn_ref,
        origin_frame_ref: "frame-checkpoint",
        run_mode: "bounded",
        profile_ref: "probe_v1",
        status: "completed",
        phase: "stopped",
        authoring_transcript: checkpoint()
      },
      overrides
    )
  end

  test "bounded restore 直接读取私有列，不依赖 long-run checkpoint" do
    assert {:ok, transcript, :private_run} = AuthoringCheckpoint.restore(record(), nil)
    assert [%{role: "application_base"}, %{role: "user"}] = transcript.messages
  end

  test "无私有列且无 checkpoint 数据时返回 none，不启动执行" do
    assert {:ok, nil, :none} =
             AuthoringCheckpoint.restore(record(%{authoring_transcript: nil}), nil)

    assert {:ok, nil, :none} =
             AuthoringCheckpoint.restore(record(%{authoring_transcript: nil}), %{})
  end

  test "有 checkpoint 数据但缺版本时报告未知格式 partial，不猜成 v2" do
    record = record(%{authoring_transcript: nil})

    assert {:partial, :checkpoint_version_missing} =
             AuthoringCheckpoint.restore(record, %{
               "agent_run" => %{"run_id" => record.id},
               "authoring_transcript" => checkpoint()
             })
  end

  test "私有列非 nil 时优先于旧 v2 副本" do
    record = record()
    legacy = legacy_metadata(record.id, record.authoring_transcript, 2)

    assert {:ok, private, :private_run} = AuthoringCheckpoint.restore(record, legacy)
    assert [%{role: "application_base"}, %{role: "user"}] = private.messages
  end

  test "私有列损坏时绝不回退合法旧 v2 副本" do
    record = record(%{run_mode: "durable", authoring_transcript: %{"version" => "broken"}})
    legacy = legacy_metadata(record.id, checkpoint(), 2)

    assert {:error, _reason} = AuthoringCheckpoint.restore(record, legacy)
  end

  test "私有列存在时 v3 引用缺失/错绑仍按契约拒绝" do
    record = record()

    assert {:error, :authoring_transcript_ref_missing} =
             AuthoringCheckpoint.restore(record, %{
               "agent_run" => %{"checkpoint_version" => 3}
             })

    assert {:error, :authoring_transcript_ref_mismatch} =
             AuthoringCheckpoint.restore(record, %{
               "agent_run" => %{
                 "checkpoint_version" => 3,
                 "authoring_transcript_ref" => %{
                   "run_id" => "other-run",
                   "version" => AuthoringCheckpoint.format_version()
                 }
               }
             })
  end

  test "v3 引用指向同一 run 时选择私有列" do
    record = record()

    assert {:ok, _transcript, :private_run} =
             AuthoringCheckpoint.restore(record, %{
               "agent_run" => %{
                 "checkpoint_version" => 3,
                 "authoring_transcript_ref" => AuthoringCheckpoint.ref(record.id)
               }
             })
  end

  test "没有私有列时旧 v2 只读兼容，缺身份报告 partial" do
    record = record(%{authoring_transcript: nil})
    legacy = legacy_metadata(record.id, checkpoint(), 2)

    assert {:ok, transcript, :legacy_checkpoint} =
             AuthoringCheckpoint.restore(record, legacy)

    assert [%{role: "application_base"} | _] = transcript.messages

    partial =
      AuthoringTranscript.new(
        %{run_id: record.id, workspace_id: record.workspace_id},
        base_text: "缺身份旧副本",
        author_text: "不应补造"
      )
      |> AuthoringTranscript.checkpoint()

    assert {:partial, :legacy_checkpoint_identity_missing} =
             AuthoringCheckpoint.restore(
               record,
               legacy_metadata(record.id, partial, 2)
             )
  end

  test "写入边界用共享 codec/IR 拒绝损坏语义，并输出可回读的 string-key checkpoint" do
    record = record(%{authoring_transcript: nil})
    {:ok, transcript} = AuthoringTranscript.restore(checkpoint())

    broken =
      transcript
      |> Map.put(:messages, [%{role: "user"}])
      |> AuthoringTranscript.checkpoint()

    assert {:error, _reason} = AuthoringCheckpoint.validate_for_write(record, broken)
    assert {:error, _reason} = AuthoringCheckpoint.validate_for_write(record, %{})

    assert {:ok, encoded} = AuthoringCheckpoint.encode_for_write(record, transcript)
    assert encoded["version"] == AuthoringCheckpoint.format_version()
    assert {:ok, restored} = AuthoringTranscript.restore(encoded)
    assert restored.messages == transcript.messages
  end

  test "写入边界拒绝与 row 身份不符的 canonical" do
    record = record(%{authoring_transcript: nil})
    wrong = run_identity(%{session_id: "other-session"})

    transcript =
      AuthoringTranscript.new(wrong, base_text: "base", author_text: "author")

    assert {:error, :authoring_transcript_identity_mismatch} =
             AuthoringCheckpoint.encode_for_write(record, transcript)
  end

  test "写入边界按真实 JSON 表示编码，Date/Time/NaiveDateTime 三投影逐字恢复" do
    record = record(%{authoring_transcript: nil})

    transcript =
      run_identity()
      |> AuthoringTranscript.new(
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

    assert {:ok, encoded} = AuthoringCheckpoint.encode_for_write(record, transcript)

    assert [%{"blocks" => [%{"content" => content}]}] =
             Enum.filter(encoded["transcript"]["messages"], &(&1["role"] == "tool"))

    assert content["date"] == "2026-11-02"
    assert content["time"] == "12:30:00"
    assert content["at"] == "2026-11-02T12:30:00"
    assert content["original"] == "  字节\n"

    assert {:ok, restored} = AuthoringTranscript.restore(encoded)
    assert {:ok, before_ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, after_ir} = AuthoringTranscript.to_request_ir(restored)

    for target <- ["chat_completions", "anthropic_messages", "responses_api"] do
      assert {:ok, before_body} = Projection.project(before_ir, target)
      assert {:ok, after_body} = Projection.project(after_ir, target)
      assert before_body == after_body, "projection #{target} changed after persistence"
    end
  end

  test "写入边界拒绝不可 JSON 表示的私有值且错误不泄漏内容" do
    record = record(%{authoring_transcript: nil})
    marker = "private-payload-marker"

    transcript =
      run_identity()
      |> AuthoringTranscript.new(base_text: "base", author_text: "author")
      |> AuthoringTranscript.append_assistant(
        "",
        [RequestIR.tool_call_block("archive_read", %{}, "bad-value")]
      )
      |> AuthoringTranscript.append_observation("bad-value", %{
        status: "ok",
        content: %{callback: fn -> marker end}
      })

    assert {:error, reason} = AuthoringCheckpoint.encode_for_write(record, transcript)
    assert reason == :authoring_transcript_not_json_encodable
    refute inspect(reason) =~ marker
  end

  defp legacy_metadata(run_id, checkpoint, version) do
    %{
      "agent_run" => %{"checkpoint_version" => version, "run_id" => run_id},
      "authoring_transcript" => checkpoint
    }
  end
end
