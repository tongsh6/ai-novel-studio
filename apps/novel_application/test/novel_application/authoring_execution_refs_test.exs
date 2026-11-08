defmodule NovelApplication.AuthoringExecutionRefsTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox

  alias NovelAgent.Provider.Result
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelPersistence.{AuthoringSessionLog, Repo}
  alias NovelPersistence.Schemas.AgentRunRecord

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @author_text "作者原话：保留 provider_call_ref 字样。"
  @targets ["chat_completions", "anthropic_messages", "responses_api"]
  @expected_refs [{"pcall-json-1", "prun-json-1"}, {"pcall-json-2", "prun-json-2"}]

  defp run_identity do
    %{
      run_id: "run-execution-refs",
      work_id: "work-execution-refs",
      workspace_id: "workspace-execution-refs",
      session_id: "session-execution-refs",
      parent_turn_ref: "turn-execution-refs"
    }
  end

  defp base_transcript do
    AuthoringTranscript.new(run_identity(),
      base_text: "run goal: 读取角色后回复",
      author_text: @author_text,
      author_turn_ref: "author_turn:execution-refs",
      tools: [%{name: "read_character", input_schema: %{type: "object"}}]
    )
  end

  defp transcript_with_assistant_refs do
    base_transcript()
    |> AuthoringTranscript.append_provider_result(%Result{
      content: "先读取角色。",
      tool_calls: [
        %{id: "read-1", name: "read_character", arguments: %{"character_ref" => "character:1"}}
      ],
      provider_call_ref: "pcall-json-1",
      provider_run_ref: "prun-json-1"
    })
    |> AuthoringTranscript.append_validation("read-1", "passed", "input_validated")
    |> AuthoringTranscript.append_provider_result(%Result{
      content: "读取完成，没有更多工具。",
      tool_calls: [],
      provider_call_ref: "pcall-json-2",
      provider_run_ref: "prun-json-2"
    })
  end

  defp assistant_refs(transcript) do
    for %{role: "assistant"} = message <- transcript.messages do
      {Map.get(message, :provider_call_ref), Map.get(message, :provider_run_ref)}
    end
  end

  defp assert_projections_equal(before_transcript, after_transcript) do
    for target <- @targets do
      assert {:ok, before_ir} = AuthoringTranscript.to_request_ir(before_transcript)

      assert {:ok, after_ir} = AuthoringTranscript.to_request_ir(after_transcript)

      assert {:ok, before_body} = Projection.project(before_ir, target)
      assert {:ok, after_body} = Projection.project(after_ir, target)
      assert before_body == after_body, "投影 #{target} 在恢复后变化"
      assert Jason.encode!(before_body) == Jason.encode!(after_body)
    end
  end

  defp assert_run_identity(run) do
    assert %{
             run_id: "run-execution-refs",
             work_id: "work-execution-refs",
             workspace_id: "workspace-execution-refs",
             session_id: "session-execution-refs",
             parent_turn_ref: "turn-execution-refs"
           } = run
  end

  defp record do
    identity = run_identity()

    %AgentRunRecord{
      id: identity.run_id,
      workspace_id: identity.workspace_id,
      work_id: identity.work_id,
      session_id: identity.session_id,
      parent_turn_ref: identity.parent_turn_ref,
      origin_frame_ref: "frame-execution-refs",
      run_mode: "bounded",
      profile_ref: "probe_v1",
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

  test "JSON checkpoint 恢复每条 assistant 执行引用、完整身份，三种投影字节不变" do
    original = transcript_with_assistant_refs()

    assert {:ok, restored} =
             original
             |> AuthoringTranscript.checkpoint()
             |> Jason.encode!()
             |> Jason.decode!()
             |> AuthoringTranscript.restore()

    assert assistant_refs(restored) == @expected_refs
    assert_run_identity(restored.run)
    assert_projections_equal(original, restored)
  end

  test "写入边界编码后恢复每条 assistant 执行引用、完整身份，三种投影字节不变" do
    original = transcript_with_assistant_refs()
    record = record()

    assert {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(record, original)
    assert segment.header["version"] == AuthoringCheckpoint.format_version()

    {:ok, _state} = AuthoringSessionLog.append_run(run_attrs(record), segment)

    assert {:ok, restored, :session_segment} = AuthoringCheckpoint.restore(record, nil)

    assert assistant_refs(restored) == @expected_refs
    assert_run_identity(restored.run)
    assert_projections_equal(original, restored)
  end
end

defmodule NovelApplication.AuthoringExecutionRefsBoundaryTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Result
  alias NovelApplication.AuthoringTranscript
  alias NovelCommon.RequestIR

  @author_text "作者原话：旧历史不得回填 provider_call_ref。"

  defp run_identity do
    %{
      run_id: "run-execution-refs-boundary",
      work_id: "work-execution-refs-boundary",
      workspace_id: "workspace-execution-refs-boundary",
      session_id: "session-execution-refs-boundary",
      parent_turn_ref: "turn-execution-refs-boundary"
    }
  end

  defp transcript do
    AuthoringTranscript.new(run_identity(),
      base_text: "run goal: 旧历史恢复",
      author_text: @author_text,
      author_turn_ref: "author_turn:execution-refs-boundary",
      tools: [%{name: "read_character", input_schema: %{type: "object"}}]
    )
  end

  defp roundtrip(transcript) do
    transcript
    |> AuthoringTranscript.checkpoint()
    |> Jason.encode!()
    |> Jason.decode!()
    |> AuthoringTranscript.restore()
  end

  defp assistants(transcript), do: Enum.filter(transcript.messages, &(&1.role == "assistant"))

  test "旧 v1 checkpoint 没有执行引用时恢复不补造，也不写入内部 key" do
    original =
      AuthoringTranscript.append_provider_result(transcript(), %Result{
        content: "旧历史文本",
        tool_calls: []
      })

    assert {:ok, restored} = roundtrip(original)

    assert [assistant] = assistants(restored)
    assert assistant.blocks == [%{type: "text", text: "旧历史文本"}]
    refute Map.has_key?(assistant, :provider_call_ref)
    refute Map.has_key?(assistant, :provider_run_ref)
  end

  test "JSON 恢复保留独立存在的单个引用，另一侧保持缺失" do
    original =
      AuthoringTranscript.append_provider_result(transcript(), %Result{
        content: "只有调用引用",
        tool_calls: [],
        provider_call_ref: "pcall-only"
      })

    assert {:ok, restored} = roundtrip(original)

    assert [assistant] = assistants(restored)
    assert assistant.provider_call_ref == "pcall-only"
    refute Map.has_key?(assistant, :provider_run_ref)

    assert {:ok, ir} = AuthoringTranscript.to_request_ir(restored)
    assert :ok = RequestIR.validate(ir)
  end

  test "checkpoint 中的非法执行引用在恢复边界被拒绝且不回显 payload" do
    original =
      AuthoringTranscript.append_provider_result(transcript(), %Result{
        content: "非法引用",
        tool_calls: [],
        provider_call_ref: "pcall-valid",
        provider_run_ref: "prun-valid"
      })

    sentinel = "SENTINEL_CHECKPOINT_EXECUTION_REFS_DO_NOT_LOG"

    for invalid <- ["", "   ", "\t\n", %{private: sentinel}] do
      invalid_transcript = %{
        original
        | messages:
            Enum.map(original.messages, fn
              %{role: "assistant"} = assistant ->
                Map.put(assistant, :provider_call_ref, invalid)

              message ->
                message
            end)
      }

      assert {:error, {:invalid_execution_ref, :provider_call_ref}} =
               invalid_transcript
               |> AuthoringTranscript.checkpoint()
               |> Jason.encode!()
               |> Jason.decode!()
               |> AuthoringTranscript.restore()
    end
  end
end
