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

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AuthoringCheckpoint
  alias NovelApplication.AuthoringReplay
  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelApplication.TranscriptCompaction
  alias NovelApplication.WorkService
  alias NovelCommon.RequestIR
  alias NovelCommon.RequestIR.Projection
  alias NovelPersistence.{AuthoringSessionLog, Repo, WorkSessionRepo}

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

  defp base_transcript(work, session, run_id, author_text, opts \\ []) do
    AuthoringTranscript.new(
      identity(work, session, run_id),
      Keyword.merge([base_text: "CP4 应用 Base", author_text: author_text], opts)
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

  defp checkpoint_plan(call_ids, summary) do
    %{
      covers: %{call_ids: call_ids},
      source_refs: [%{ref: "chapter:1"}],
      versions: %{},
      omissions: ["较早的已完成操作不再逐字进入后续模型请求；原始记录仍保留在会话历史中。"],
      summary: summary
    }
  end

  defp checkpointed_transcript(work, session, run_id, summary) do
    call_id = "call-" <> run_id

    transcript =
      base_transcript(work, session, run_id, "第一轮作者原话")
      |> append_exchange(call_id)

    {:ok, compacted} =
      AuthoringCheckpoint.append_checkpoint(transcript, checkpoint_plan([call_id], summary))

    compacted
  end

  # 较新 run 的段：作者消息 + 覆盖更早 run 已闭合交换的真实 checkpoint。
  defp seed_checkpoint_covering!(work, session, run_id, author_text, covered_call_id) do
    transcript = base_transcript(work, session, run_id, author_text)

    {:ok, compacted} =
      AuthoringCheckpoint.append_checkpoint(
        transcript,
        checkpoint_plan([covered_call_id], "较新 run 整理更早交换")
      )

    :ok = TestAgenticLoopFixtures.append_segment!(compacted)
    compacted
  end

  defp message_index!(messages, predicate) do
    Enum.find_index(messages, predicate) || flunk("预期消息不存在")
  end

  defp author_text?(%{role: "user", blocks: blocks}, text) do
    Enum.any?(blocks, &(Map.get(&1, :type) == "text" and Map.get(&1, :text) == text))
  end

  defp author_text?(_message, _text), do: false

  defp tool_call?(%{blocks: blocks}, call_id) do
    Enum.any?(
      blocks,
      &(Map.get(&1, :type) == "tool_call" and Map.get(&1, :call_id) == call_id)
    )
  end

  defp tool_call?(_message, _call_id), do: false

  defp projected_call_ids(%{} = body), do: collect_ids(body, [])

  defp collect_ids(%{} = map, acc) do
    acc =
      Enum.reduce([:id, :tool_call_id, :tool_use_id, :call_id], acc, fn key, acc ->
        case Map.get(map, key) do
          id when is_binary(id) -> [id | acc]
          _other -> acc
        end
      end)

    Enum.reduce(map, acc, fn {_key, value}, acc -> collect_ids(value, acc) end)
  end

  defp collect_ids(list, acc) when is_list(list), do: Enum.reduce(list, acc, &collect_ids/2)
  defp collect_ids(_value, acc), do: acc

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

  test "请求读端和会话回查共同拒绝未知版本段", %{work: work, session: session} do
    transcript = seed_checkpointed!(work, session, "run-cp4-corrupt", "已整理")
    assert {:ok, %{header: header}} = AuthoringSessionLog.fetch_run_segment(transcript.run.run_id)

    SQL.query!(
      Repo,
      "UPDATE authoring_run_segments SET header = ? WHERE run_id = ?",
      [
        Jason.encode!(Map.put(header, "version", "authoring-run-segment/v999")),
        transcript.run.run_id
      ]
    )

    assert {:error, :authoring_segment_version_unsupported} =
             AuthoringSessionHistory.fetch(transcript.run)

    assert {:error, :authoring_transcript} = AuthoringReplay.fetch_session(work.id, session.id)
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

    view_before = AuthoringSessionHistory.compose(segment, history)
    assert {:ok, ir_before} = AuthoringTranscript.to_request_ir(view_before)

    # 段编解码往返（恢复路径）：checkpoint 编码 → 段恢复 → 与历史重组视图。
    encoded = AuthoringCheckpoint.checkpoint(segment)
    assert {:ok, restored_segment} = AuthoringCheckpoint.restore_segment(encoded)
    view_after = AuthoringSessionHistory.compose(restored_segment, history)
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

    restored_view = AuthoringSessionHistory.compose(restored, history)
    expected_view = AuthoringSessionHistory.compose(segment, history)

    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored_view)
    assert {:ok, expected_ir} = AuthoringTranscript.to_request_ir(expected_view)

    for format <- @run_formats do
      assert {:ok, restored_body} = Projection.project(restored_ir, format)
      assert {:ok, expected_body} = Projection.project(expected_ir, format)
      assert Jason.encode!(restored_body) == Jason.encode!(expected_body)
    end
  end

  test "恢复旧 run 时较新 run 的 checkpoint 不前置到其已闭合交换之前", %{
    work: work,
    session: session
  } do
    a_author = "A 轮作者原话：先读角色"
    b_author = "B 轮作者原话：继续整理"
    a_call = "call-run-b81-a"

    # A：作者消息 + 已闭合交换（无 checkpoint），先写入会话。
    a_transcript =
      base_transcript(work, session, "run-b81-a", a_author)
      |> append_exchange(a_call)

    :ok = TestAgenticLoopFixtures.append_segment!(a_transcript)

    # B：较新 run 的作者消息 + 真实覆盖 A call ID 的 canonical checkpoint。
    seed_checkpoint_covering!(work, session, "run-b81-b", b_author, a_call)

    # 恢复 A 必须返回 A 的原段：较新 B 的 checkpoint 不得污染返回值。
    assert {:ok, restored, :session_segment} =
             AuthoringCheckpoint.restore(run_record(work, session, "run-b81-a"), nil)

    assert a_call in restored.call_ids
    assert Enum.any?(restored.messages, &author_text?(&1, a_author))
    refute Enum.any?(restored.messages, &(&1.role == "checkpoint"))
    refute Enum.any?(restored.messages, &author_text?(&1, b_author))

    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)
    assert {:ok, original_ir} = AuthoringTranscript.to_request_ir(a_transcript)

    for format <- @run_formats do
      assert {:ok, restored_body} = Projection.project(restored_ir, format)
      assert {:ok, original_body} = Projection.project(original_ir, format)
      assert Jason.encode!(restored_body) == Jason.encode!(original_body)
    end

    # 同一会话的请求视图按真实会话序号排列：A 作者/交换 → B 作者 → checkpoint。
    assert {:ok, history} = AuthoringSessionHistory.fetch(a_transcript.run)
    view = AuthoringSessionHistory.compose(a_transcript, history)

    a_author_at = message_index!(view.messages, &author_text?(&1, a_author))
    a_call_at = message_index!(view.messages, &tool_call?(&1, a_call))
    b_author_at = message_index!(view.messages, &author_text?(&1, b_author))
    checkpoint_at = message_index!(view.messages, &(&1.role == "checkpoint"))

    assert a_author_at < a_call_at
    assert a_call_at < b_author_at
    assert b_author_at < checkpoint_at

    assert Enum.count(view.messages, &(&1.role == "application_base")) == 1
    assert Enum.count(view.messages, &author_text?(&1, a_author)) == 1
    assert Enum.count(view.messages, &author_text?(&1, b_author)) == 1
    assert Enum.count(view.messages, &tool_call?(&1, a_call)) == 1

    assert {:ok, view_ir} = AuthoringTranscript.to_request_ir(view)

    # 被 B checkpoint 覆盖的 A 交换在三类 Provider 投影中折叠，canonical 事实保留。
    for format <- @run_formats do
      assert {:ok, body} = Projection.project(view_ir, format)
      refute a_call in projected_call_ids(body)
    end

    assert Enum.any?(view.messages, &tool_call?(&1, a_call))

    # 当前旧 run 的未提交尾部接在 B checkpoint 之后；按归属剥离后只返回 A 段。
    a_with_tail =
      AuthoringTranscript.append_author_turn(
        a_transcript,
        "A 轮未提交尾部",
        "author_turn:tail"
      )

    tail_view = AuthoringSessionHistory.compose(a_with_tail, history)
    tail_checkpoint_at = message_index!(tail_view.messages, &(&1.role == "checkpoint"))
    tail_at = message_index!(tail_view.messages, &author_text?(&1, "A 轮未提交尾部"))
    assert tail_checkpoint_at < tail_at

    stripped = AuthoringSessionHistory.strip_request_history(tail_view)
    assert stripped.messages == a_with_tail.messages
    refute Enum.any?(stripped.messages, &author_text?(&1, b_author))
    refute Enum.any?(stripped.messages, &(&1.role == "checkpoint"))
    assert a_call in stripped.call_ids
  end

  test "交错 A 作者 → B 作者 → A 调用时，压缩回合范围仍归 A，归属标记不落库", %{
    work: work,
    session: session
  } do
    a_run = "run-b81-interleave-a"
    b_run = "run-b81-interleave-b"
    a_author = "A 轮作者原话：先读角色"
    b_author = "B 轮作者原话：整理旧档"
    a_call = "call-b81-interleave-a"

    # 真实会话顺序：A 作者 → B 作者 → A 调用及结果（A 分两次提交，B 插在中间）。
    a_author_only =
      base_transcript(work, session, a_run, a_author, author_turn_ref: "turn-#{a_run}")

    :ok = TestAgenticLoopFixtures.append_segment!(a_author_only)

    :ok =
      TestAgenticLoopFixtures.append_segment!(
        base_transcript(work, session, b_run, b_author, author_turn_ref: "turn-#{b_run}")
      )

    a_full = append_exchange(a_author_only, a_call)
    :ok = TestAgenticLoopFixtures.append_segment!(a_full)

    assert {:ok, history} =
             AuthoringSessionHistory.fetch(%{run_id: a_run, session_id: session.id})

    view = AuthoringSessionHistory.compose(a_full, history)

    a_author_at = message_index!(view.messages, &author_text?(&1, a_author))
    b_author_at = message_index!(view.messages, &author_text?(&1, b_author))
    a_call_at = message_index!(view.messages, &tool_call?(&1, a_call))

    assert a_author_at < b_author_at
    assert b_author_at < a_call_at

    # 外 run 归属是实际 run_id；本 run 行不带标记。
    assert Enum.find(view.messages, &author_text?(&1, b_author)).session_history_run_id == b_run

    refute Map.has_key?(
             Enum.find(view.messages, &author_text?(&1, a_author)),
             :session_history_run_id
           )

    # A 的调用必须绑定 A 自己的最近作者回合，而不是会话里最后一条作者消息（B）。
    assert {:ok, plan} = TranscriptCompaction.plan(view)
    assert plan.covers.call_ids == [a_call]
    assert plan.covers.turn_range == "turn-#{a_run}"

    # 归属标记只存在于临时请求视图，不进入持久行（DB JSON 落库为 string keys）。
    assert {:ok, %{rows: persisted}} = AuthoringSessionLog.fetch_session(session.id)
    assert persisted != []
    refute Enum.any?(persisted, &Map.has_key?(&1.message, "session_history_run_id"))

    # 三类 Provider 投影都不消费归属标记：标记与去除标记的同一会话视图逐字节一致。
    unmarked = %{
      view
      | messages: Enum.map(view.messages, &Map.delete(&1, :session_history_run_id))
    }

    assert {:ok, marked_ir} = AuthoringTranscript.to_request_ir(view)
    assert {:ok, unmarked_ir} = AuthoringTranscript.to_request_ir(unmarked)

    for format <- @run_formats do
      assert {:ok, marked_body} = Projection.project(marked_ir, format)
      assert {:ok, unmarked_body} = Projection.project(unmarked_ir, format)
      assert Jason.encode!(marked_body) == Jason.encode!(unmarked_body)
    end
  end

  test "B 的作者输入不移动 A 当前回合的保护起点（K=0 安全点不整理 A 调用）", %{
    work: work,
    session: session
  } do
    a_run = "run-b81-current-a"
    a_author = "A 轮作者原话：本轮仍在进行"
    a_call = "call-b81-current-a"
    b_author = "B 轮作者原话：另一路作者输入"

    # A 的当前回合：作者消息后已有闭合调用；随后才是 B 的作者消息。
    a =
      base_transcript(work, session, a_run, a_author, author_turn_ref: "turn-#{a_run}")
      |> append_exchange(a_call)

    :ok = TestAgenticLoopFixtures.append_segment!(a)

    :ok =
      TestAgenticLoopFixtures.append_segment!(
        base_transcript(work, session, "run-b81-current-b", b_author)
      )

    assert {:ok, history} =
             AuthoringSessionHistory.fetch(%{run_id: a_run, session_id: session.id})

    view = AuthoringSessionHistory.compose(a, history)

    a_author_at = message_index!(view.messages, &author_text?(&1, a_author))
    a_call_at = message_index!(view.messages, &tool_call?(&1, a_call))
    b_author_at = message_index!(view.messages, &author_text?(&1, b_author))

    assert a_author_at < a_call_at
    assert a_call_at < b_author_at

    # A 的调用仍在其当前回合内：即使 K=0 也不得被整理（B 的作者消息不能移动起点）。
    assert {:ok, :nothing_to_compact} =
             TranscriptCompaction.plan_maintenance(view, keep_recent_items: 0)
  end

  test "交错完成顺序不产生逆序回合范围（首末按作者消息的会话顺序）", %{
    work: work,
    session: session
  } do
    a_run = "run-b81-range-a"
    b_run = "run-b81-range-b"
    a_author = "A 轮作者原话：先读角色"
    b_author = "B 轮作者原话：后整理旧档"
    a_call = "call-b81-range-a"
    b_call = "call-b81-range-b"

    # 作者顺序 A → B，但调用完成顺序是 B → A（两路 run 交错提交）。
    a_author_only =
      base_transcript(work, session, a_run, a_author, author_turn_ref: "turn-#{a_run}")

    b_author_only =
      base_transcript(work, session, b_run, b_author, author_turn_ref: "turn-#{b_run}")

    :ok = TestAgenticLoopFixtures.append_segment!(a_author_only)
    :ok = TestAgenticLoopFixtures.append_segment!(b_author_only)
    b_full = append_exchange(b_author_only, b_call)
    :ok = TestAgenticLoopFixtures.append_segment!(b_full)
    a_full = append_exchange(a_author_only, a_call)
    :ok = TestAgenticLoopFixtures.append_segment!(a_full)

    assert {:ok, history} =
             AuthoringSessionHistory.fetch(%{run_id: a_run, session_id: session.id})

    view = AuthoringSessionHistory.compose(a_full, history)

    assert message_index!(view.messages, &tool_call?(&1, b_call)) <
             message_index!(view.messages, &tool_call?(&1, a_call))

    assert {:ok, plan} = TranscriptCompaction.plan(view)
    assert plan.covers.call_ids == [b_call, a_call]

    # 首末按作者消息会话顺序 A → B，不因调用先后逆序成 B → A。
    assert plan.covers.turn_range == "turn-#{a_run}..turn-#{b_run}"
  end
end
