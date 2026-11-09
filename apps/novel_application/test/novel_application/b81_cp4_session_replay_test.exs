defmodule NovelApplication.B81Cp4SessionReplayTest do
  @moduledoc """
  B81 CP4 机制验收：会话级审计/回查与投影等价。

  覆盖：
  1) 会话级回查：按 work/session 读取跨 run 的 checkpoint 作者安全摘要
     （只含摘要/省略说明/来源显示名与回合/run 计数，不暴露内部标识）；
  2) 会话不存在 fail-closed；空会话返回合法空历史（不伪造）；
  3) 投影等价（S1）：含跨段 checkpoint 的会话视图在「段编解码往返」前后，
     三类 Provider 投影逐字节一致；
  4) 恢复后的段 + 会话历史可重建同一请求视图（恢复不改变投影）。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringReplay
  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelApplication.WorkService
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelPersistence.{Repo, WorkSessionRepo}

  @run_formats ["chat_completions", "responses_api", "anthropic_messages"]

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "CP4 回查作品"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id, title: "CP4 会话"})
    %{work: work, session: session}
  end

  defp identity(work, session, run_id) do
    %{
      run_id: run_id,
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      parent_turn_ref: "turn-" <> run_id
    }
  end

  defp run_record(work, session, run_id) do
    identity = identity(work, session, run_id)

    Map.take(identity, [:run_id, :workspace_id, :work_id, :session_id, :parent_turn_ref])
    |> Map.put(:id, identity.run_id)
  end

  defp base_transcript(work, session, run_id, author_text) do
    AuthoringTranscript.new(identity(work, session, run_id),
      base_text: "CP4 应用 Base",
      author_text: author_text
    )
  end

  defp append_exchange(transcript, call_id) do
    transcript
    |> AuthoringTranscript.append_assistant("读取", [
      RequestIR.tool_call_block("read_character", %{}, call_id)
    ])
    |> AuthoringTranscript.append_observation(call_id, %{
      status: "ok",
      source_refs: [%{ref: "chapter:1"}],
      content: %{summary: "角色"}
    })
  end

  defp checkpointed_transcript(work, session, run_id, summary) do
    call_id = "call-" <> run_id

    transcript =
      base_transcript(work, session, run_id, "第一轮作者原话")
      |> append_exchange(call_id)

    plan = %{
      covers: %{call_ids: [call_id]},
      source_refs: [%{ref: "chapter:1"}],
      versions: %{},
      omissions: ["较早的已完成操作不再逐字进入后续模型请求；原始记录仍保留在会话历史中。"],
      summary: summary
    }

    {:ok, compacted} = AuthoringCheckpoint.append_checkpoint(transcript, plan)
    compacted
  end

  defp seed_checkpointed!(work, session, run_id, summary) do
    transcript = checkpointed_transcript(work, session, run_id, summary)
    :ok = TestAgenticLoopFixtures.append_segment!(transcript)
    transcript
  end

  test "会话级回查返回跨 run 的 checkpoint 作者安全摘要", %{work: work, session: session} do
    seed_checkpointed!(work, session, "run-cp4-1", "第一轮整理")
    seed_checkpointed!(work, session, "run-cp4-2", "第二轮整理")

    assert {:ok, history} = AuthoringReplay.fetch_session(work.id, session.id)
    assert history.status == :ok
    assert history.turn_count == 2
    assert history.run_count == 2
    assert length(history.checkpoints) == 2
    assert Enum.any?(history.checkpoints, &String.contains?(Map.get(&1, :summary), "第一轮整理"))
    assert Enum.any?(history.checkpoints, &String.contains?(Map.get(&1, :summary), "第二轮整理"))

    # 作者安全面：不暴露 call/run/turn/ctx/chapter 内部标识与内部版本号。
    encoded = Jason.encode!(history)
    refute encoded =~ "call-cp4"
    refute encoded =~ "run-cp4"
    refute encoded =~ "chapter:"
    refute encoded =~ "authoring-"
  end

  test "会话不存在 fail-closed；空会话是合法空历史", %{work: work, session: session} do
    assert {:error, :session_not_found} =
             AuthoringReplay.fetch_session(work.id, "missing-session")

    # 同一 work 下真实空会话：无消息 → 合法空历史（不伪造摘要）。
    assert {:ok, empty} = AuthoringReplay.fetch_session(work.id, session.id)
    assert empty.status == :ok
    assert empty.turn_count == 0
    assert empty.run_count == 0
    assert empty.checkpoints == []
  end

  test "含跨段 checkpoint 的会话视图在段编解码往返前后三类投影逐字节一致", %{
    work: work,
    session: session
  } do
    # 更早 run 提供历史；当前段无 checkpoint（历史中已含 checkpoint 消息）。
    seed_checkpointed!(work, session, "run-cp4-3", "更早整理")

    segment =
      base_transcript(work, session, "run-cp4-4", "第二轮作者原话")
      |> append_exchange("call-run-cp4-4")

    assert {:ok, history} =
             AuthoringSessionHistory.fetch(%{
               run_id: "run-cp4-4",
               session_id: session.id
             })

    {view_before, _} = AuthoringSessionHistory.compose(segment, history)
    assert {:ok, ir_before} = AuthoringTranscript.to_request_ir(view_before)

    # 段编解码往返（恢复路径）：checkpoint 编码 → 段恢复 → 与历史重组视图。
    encoded = AuthoringCheckpoint.checkpoint(segment)
    assert {:ok, restored_segment} = AuthoringCheckpoint.restore_segment(encoded)
    {view_after, _} = AuthoringSessionHistory.compose(restored_segment, history)
    assert {:ok, ir_after} = AuthoringTranscript.to_request_ir(view_after)

    for format <- @run_formats do
      assert {:ok, before_body} = Projection.project(ir_before, format)
      assert {:ok, after_body} = Projection.project(ir_after, format)
      assert Jason.encode!(before_body) == Jason.encode!(after_body)
    end
  end

  test "恢复段与会话历史重建的请求视图与写入前视图一致（恢复不改变投影）", %{
    work: work,
    session: session
  } do
    seed_checkpointed!(work, session, "run-cp4-5", "更早整理")

    segment =
      base_transcript(work, session, "run-cp4-6", "作者原话六")
      |> append_exchange("call-run-cp4-6")

    :ok = TestAgenticLoopFixtures.append_segment!(segment)

    assert {:ok, restored, :session_segment} =
             AuthoringCheckpoint.restore(run_record(work, session, "run-cp4-6"), nil)

    assert {:ok, history} =
             AuthoringSessionHistory.fetch(%{
               run_id: "run-cp4-6",
               session_id: session.id
             })

    {restored_view, _} = AuthoringSessionHistory.compose(restored, history)
    {expected_view, _} = AuthoringSessionHistory.compose(segment, history)

    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored_view)
    assert {:ok, expected_ir} = AuthoringTranscript.to_request_ir(expected_view)

    for format <- @run_formats do
      assert {:ok, restored_body} = Projection.project(restored_ir, format)
      assert {:ok, expected_body} = Projection.project(expected_ir, format)
      assert Jason.encode!(restored_body) == Jason.encode!(expected_body)
    end
  end
end
