defmodule NovelApplication.B81Cp3SessionCompactionTest do
  @moduledoc """
  B81 CP3 机制验收：压缩作用域=会话历史。

  真实链路（存储 → 会话视图 → 跨 run 压缩 → 段追加 checkpoint → 会话级校验 → 投影折叠）：
  1) run1 以真实 canonical 形状持久化 5 个已完成交换；
  2) run2 段含 1 个已完成交换与当前作者回合；
  3) 在会话视图上派生维护计划（保留最近 K，跨 run 选择更早交换）；
  4) plan 作为 checkpoint 追加到 run2 段（段内不要求 covers 可见）；
  5) `AuthoringCheckpoint` 在会话视图上完成完整 IR/Compaction 校验（含证据 refs/versions）；
  6) Provider 投影按 call_id 折叠被覆盖的历史交换，原始消息保留；
  7) 段恢复（含跨段 checkpoint）通过，checkpoint 在 canonical 记录中。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.TranscriptCompaction
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelPersistence.{AuthoringSessionLog, Repo}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  defp identity(run_id, overrides \\ %{}) do
    Map.merge(
      %{
        run_id: run_id,
        workspace_id: "ws-cp3",
        work_id: "work-cp3",
        session_id: "sess-cp3",
        parent_turn_ref: "turn-#{run_id}"
      },
      overrides
    )
  end

  defp run_record(run_id) do
    identity = identity(run_id)

    %{
      id: identity.run_id,
      workspace_id: identity.workspace_id,
      work_id: identity.work_id,
      session_id: identity.session_id,
      parent_turn_ref: identity.parent_turn_ref
    }
  end

  defp base_transcript(run_id, author_text) do
    AuthoringTranscript.new(identity(run_id), base_text: "会话压缩测试 Base", author_text: author_text)
  end

  defp append_exchange(transcript, call_id, chapter_ref) do
    transcript
    |> AuthoringTranscript.append_assistant("读取", [
      RequestIR.tool_call_block("chapter_read", %{"chapter" => chapter_ref}, call_id)
    ])
    |> AuthoringTranscript.append_observation(call_id, %{
      status: "ok",
      source_refs: [%{ref: chapter_ref}],
      versions: %{},
      content: %{text: "真实观察"}
    })
  end

  defp seed_run!(transcript) do
    record = run_record(transcript.run.run_id)

    {:ok, segment} = AuthoringCheckpoint.encode_segment_for_write(record, transcript)
    {:ok, _} = Repo.transaction(fn -> AuthoringSessionLog.append_run(record, segment) end)
    :ok
  end

  defp first_round_transcript do
    Enum.reduce(1..5, base_transcript("run-cp3-1", "第一轮作者原话"), fn n, transcript ->
      append_exchange(transcript, "cp3-call-1-#{n}", "chapter:#{n}")
    end)
  end

  defp second_round_segment do
    base_transcript("run-cp3-2", "第二轮作者原话")
    |> append_exchange("cp3-call-2-1", "chapter:9")
  end

  test "跨 run 维护计划 + 段追加 checkpoint + 会话视图校验 + 投影折叠 + 段恢复" do
    seed_run!(first_round_transcript())

    segment = second_round_segment()
    assert {:ok, history} = AuthoringSessionHistory.fetch(segment.run)
    {view, history_count} = AuthoringSessionHistory.compose(segment, history)
    assert history_count > 0

    # 1) 会话视图上派生计划：保留最近 4 项已完成交换，整理 run1 最早 1 项。
    assert {:ok, plan} = TranscriptCompaction.plan_maintenance(view, keep_recent_items: 4)
    assert plan.scope == "earlier_work_turns"
    covered = plan.covers.call_ids
    assert covered != []
    assert Enum.all?(covered, &String.starts_with?(&1, "cp3-call-1-"))

    # 2) checkpoint 追加到本 run 段；段内不要求 covers 可见。
    assert {:ok, compacted_segment} = AuthoringTranscript.append_checkpoint(segment, plan)
    assert {:ok, ^compacted_segment} = AuthoringTranscript.append_checkpoint(compacted_segment, plan)
    assert Enum.any?(compacted_segment.messages, &(&1.role == "checkpoint"))

    # 3) 写入边界在会话视图上完成完整校验（含 Compaction 证据校验）后通过。
    assert {:ok, stored} = AuthoringCheckpoint.encode_segment_for_write(run_record("run-cp3-2"), compacted_segment)
    assert is_map(stored)

    # 4) 压缩后的会话视图投影折叠被覆盖的历史交换；原始消息保留在 canonical 视图。
    {compacted_view, _count} = AuthoringSessionHistory.compose(compacted_segment, history)
    assert {:ok, compacted_ir} = AuthoringTranscript.to_request_ir(compacted_view)
    assert {:ok, body} = Projection.project(compacted_ir, "chat_completions")
    projected_ids = collect_provider_message_ids(body)
    refute Enum.any?(covered, &(&1 in projected_ids))
    assert Enum.any?(view.messages, &canonical_call_id?(&1, hd(covered)))

    # 5) 段恢复：含跨段 checkpoint 的段可在会话视图校验下恢复。
    seed_run!(compacted_segment)
    assert {:ok, restored, :session_segment} = AuthoringCheckpoint.restore(run_record("run-cp3-2"), nil)
    assert Enum.any?(restored.messages, &(&1.role == "checkpoint"))
    assert inspect(restored.messages) =~ hd(covered)
  end

  test "无更早已完成交换时维护计划返回 nothing（不产生空 checkpoint）" do
    seed_run!(base_transcript("run-cp3-only", "只此一轮"))

    assert {:ok, history} =
             AuthoringSessionHistory.fetch(%{run_id: "run-cp3-next", session_id: "sess-cp3"})

    {view, _count} =
      AuthoringSessionHistory.compose(base_transcript("run-cp3-next", "下一轮"), history)

    assert {:ok, :nothing_to_compact} =
             TranscriptCompaction.plan_maintenance(view, keep_recent_items: 4)
  end

  defp collect_provider_message_ids(body) do
    messages = Map.get(body, :messages) || Map.get(body, "messages") || []

    Enum.flat_map(messages, fn message ->
      tool_calls = Map.get(message, :tool_calls) || Map.get(message, "tool_calls") || []

      ids =
        Enum.map(tool_calls, fn call ->
          Map.get(call, :id) || Map.get(call, "id")
        end)

      ids ++ [Map.get(message, :tool_call_id) || Map.get(message, "tool_call_id")]
    end)
    |> Enum.reject(&is_nil/1)
  end

  defp canonical_call_id?(message, call_id) do
    Enum.any?(Map.get(message, :blocks, []), fn block ->
      Map.get(block, :type) == "tool_call" and Map.get(block, :call_id) == call_id
    end)
  end
end
