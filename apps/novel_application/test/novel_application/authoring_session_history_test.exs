defmodule NovelApplication.AuthoringSessionHistoryTest do
  @moduledoc """
  B81 CP2：会话历史 → 请求派生视图（application 层组装）的机制测试。

  覆盖：无已提交消息 nil、会话行读取（含当前 run，排除 base）、refs 会话累计、
  compose 顺序（当前 base → 已提交行原序 → 当前段未提交尾部）、按归属 strip、
  身份缺失/段头损坏 fail-closed。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution

  alias NovelApplication.AuthoringSessionHistory
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.TestAgenticLoopFixtures
  alias NovelApplication.TranscriptCompactionSummary, as: Summary
  alias NovelCommon.RequestIR
  alias NovelDomain.AgentRun
  alias NovelPersistence.ProviderRunLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  defp identity(run_id, overrides \\ %{}) do
    Map.merge(
      %{
        run_id: run_id,
        workspace_id: "ws-history",
        work_id: "work-history",
        session_id: "sess-history",
        parent_turn_ref: "turn-#{run_id}"
      },
      overrides
    )
  end

  defp transcript(run_id, opts \\ []) do
    AuthoringTranscript.new(identity(run_id),
      base_text: "会话历史测试 Base",
      author_text: Keyword.get(opts, :author_text, "作者原话 #{run_id}"),
      author_turn_ref: identity(run_id).parent_turn_ref,
      base_refs: Keyword.get(opts, :base_refs, [])
    )
  end

  # 本 helper 只播种已完成的历史；活动 run 由各测试显式构造。
  defp seed_transcript!(transcript, run_id) do
    assert transcript.run.run_id == run_id
    :ok = TestAgenticLoopFixtures.append_segment!(transcript, status: "completed")
    transcript
  end

  defp seed_run!(run_id, opts \\ []) do
    transcript(run_id, opts) |> seed_transcript!(run_id)
  end

  defp fetch!(run_id) do
    assert {:ok, history} =
             AuthoringSessionHistory.fetch(identity(run_id))

    history
  end

  defp message_text(%{blocks: blocks}) do
    Enum.map_join(blocks, "", &(Map.get(&1, :text) || ""))
  end

  test "真实来源证明先于执行权：篡改、未知源、活动 run 与跨作品均零派发" do
    source_id = "run-source-proof"
    author = "先讨论动机，不要写正文。"
    reply = "我建议先对照资料。稍后我会确认动机。"

    transcript(source_id, author_text: author)
    |> AuthoringTranscript.append_assistant(reply)
    |> seed_transcript!(source_id)

    {:ok, run} =
      AgentRun.new(
        Map.merge(identity("run-proof-consumer"), %{
          origin_frame_ref: "frame-proof",
          profile_ref: "conversation_turn_v1",
          goal: %{text: "继续讨论", version: 1},
          status: :running,
          authority_scope: %{production_write: false, allowed_tools: ["read_character"]}
        })
      )

    {:ok, token} = Execution.start_cancellation_token(%{run_id: run.run_id})
    parent = self()
    snapshot = %{run: run, provider_cancellation_token: token, stage_sink: fn _ -> :ok end}

    dependency =
      Execution.dependency(
        provider: :stub,
        purpose: :other,
        event_sink: fn facts -> send(parent, {:proof_provider_event, facts}) end
      )

    # 独立 fixture 中 base/author/assistant 对应真实 1/2/3，不从被测读取函数反推。
    source = %{
      source_index: 0,
      source: %{run_id: source_id, run_sequence: 3},
      text: reply,
      author_text: author
    }

    selector = %{
      run_id: source_id,
      run_sequence: 3,
      role: "assistant",
      source_refs: [],
      versions: %{}
    }

    plan = %{
      covers: %{call_ids: [], message_refs: [selector]},
      discussion_sources: [source],
      source_refs: [%{ref: "session_message:#{source_id}:3", version: 1}],
      versions: %{},
      omissions: ["保留原文，摘要不授予执行权。"],
      summary: "来源核验的完整冻结计划"
    }

    assert {:ok, [^source]} = AuthoringSessionHistory.discussion_sources(run, plan.covers)

    for invalid <- [
          %{source | text: "伪造的模型原文"},
          %{source | author_text: "伪造的作者原文"},
          %{source | source: %{source.source | run_sequence: 99}},
          %{source | source_index: 1}
        ] do
      assert {:error, :discussion_summary_source_mismatch, 0} =
               Summary.prepare(%{plan | discussion_sources: [invalid]}, snapshot, dependency)
    end

    missing = %{
      plan
      | covers: %{call_ids: [], message_refs: [%{selector | run_id: "not-persisted"}]},
        discussion_sources: [%{source | source: %{source.source | run_id: "not-persisted"}}]
    }

    assert {:error, :discussion_summary_source_mismatch, 0} =
             Summary.prepare(missing, snapshot, dependency)

    assert {:error, :authoring_session_scope_mismatch, 0} =
             Summary.prepare(plan, %{snapshot | run: %{run | work_id: "other-work"}}, dependency)

    SQL.query!(Repo, "UPDATE agent_runs SET status = 'awaiting_author' WHERE id = ?", [source_id])

    assert {:error, :discussion_summary_source_mismatch, 0} =
             Summary.prepare(plan, snapshot, dependency)

    refute_received {:proof_provider_event, _}
    assert ProviderRunLog.list_runs(run.run_id) == []

    # 正控制：实际已完成来源到达既有 Stub；其非摘要响应不代签模型摘要语义。
    SQL.query!(Repo, "UPDATE agent_runs SET status = 'completed' WHERE id = ?", [source_id])
    assert {:error, _response_rejection, 1} = Summary.prepare(plan, snapshot, dependency)
    assert [%{status: "completed"}] = ProviderRunLog.list_runs(run.run_id)
  end

  test "只有本 run 已提交行时返回 nil（局部已拥有完整顺序）" do
    seed_run!("run-history-first")

    assert {:ok, nil} =
             AuthoringSessionHistory.fetch(identity("run-history-first"))
  end

  test "存在外 run 已提交行时才返回全序 rows（含当前 run）" do
    seed_run!("run-history-1", author_text: "上一轮作者原话")

    assert {:ok, nil} =
             AuthoringSessionHistory.fetch(identity("run-history-1"))

    assert Enum.map(fetch!("run-history-2").rows, & &1.run_id) == ["run-history-1"]

    seed_run!("run-history-2", author_text: "当前 run 作者原话")
    history = fetch!("run-history-2")

    assert Enum.map(history.rows, & &1.run_id) == ["run-history-1", "run-history-2"]
    refute Enum.any?(history.rows, &(&1.role == "application_base"))
    assert Enum.any?(history.rows, &(&1.role == "user"))
  end

  test "refs 按会话累计（历史段头 refs 并集）" do
    seed_run!("run-refs-1", base_refs: [%{ref: "base-1"}])

    history = fetch!("run-refs-2")
    assert history.refs.base_refs == [%{"ref" => "base-1"}]
    assert is_list(history.refs.observation_refs)
    assert is_list(history.refs.used_refs)
  end

  test "compose 保持当前 base 最前、已提交行原序、当前段未提交尾部最后" do
    transcript("run-history-other",
      author_text: "历史作者",
      base_refs: [%{ref: "base-history"}]
    )
    |> AuthoringTranscript.append_assistant("读取历史", [
      RequestIR.tool_call_block("archive_read", %{}, "history-read")
    ])
    |> AuthoringTranscript.append_observation("history-read", %{
      status: "ok",
      source_refs: [%{ref: "obs-history"}],
      content: %{summary: "真实历史观察"}
    })
    |> seed_transcript!("run-history-other")

    history = fetch!("run-compose")
    assert [%{sequence: 2, run_sequence: 2, run_status: "completed"} | _] = history.rows
    assert Enum.all?(history.rows, &(&1.format_version == "authoring-session-message/v1"))

    segment =
      AuthoringTranscript.new(identity("run-compose"),
        base_text: "base",
        author_text: "初始作者",
        author_turn_ref: "turn-run-compose"
      )
      |> AuthoringTranscript.append_author_turn("当前作者", "turn-current-followup")

    view = AuthoringSessionHistory.compose(segment, history)

    assert [%{role: "application_base"} = base | _] = view.messages
    assert Map.delete(base, :canonical_ref) == hd(segment.messages)
    assert %{run_id: "run-compose", run_sequence: 1, work_id: "work-history"} = base.canonical_ref

    assert List.last(view.messages).blocks |> hd() |> Map.get(:text) == "当前作者"
    assert List.last(view.messages).source_refs == [%{ref: "turn-current-followup"}]

    history_message = Enum.find(view.messages, &(message_text(&1) == "历史作者"))
    assert history_message.session_history_run_id == "run-history-other"

    assert history_message.canonical_ref ==
             Map.take(hd(history.rows), [
               :run_id,
               :run_sequence,
               :workspace_id,
               :work_id,
               :session_id,
               :parent_turn_ref,
               :run_status
             ])

    assert %{run_id: "run-compose", run_sequence: 3} = List.last(view.messages).canonical_ref
    refute Map.has_key?(List.last(view.messages), :session_history_run_id)

    assert [%{ref: "base-history"} | _] = view.base_refs
    assert Enum.any?(view.observation_refs, &(&1.ref == "obs-history"))
  end

  test "strip_request_history 按归属剥离外 run 行，恢复当前 run 段" do
    segment =
      transcript("run-strip")
      |> AuthoringTranscript.append_author_turn("当前作者", "turn-current-followup")

    transcript("run-history-other", author_text: "历史1")
    |> AuthoringTranscript.append_assistant("历史2", [])
    |> seed_transcript!("run-history-other")

    history = fetch!("run-strip")
    assert Enum.map(history.rows, & &1.run_sequence) == [2, 3]
    assert Enum.all?(history.rows, &(&1.run_status == "completed"))

    view = AuthoringSessionHistory.compose(segment, history)
    stripped = AuthoringSessionHistory.strip_request_history(view)

    assert stripped.messages == segment.messages
    assert length(stripped.messages) == length(segment.messages)
    assert stripped.call_ids == segment.call_ids
  end

  test "IR 往返不把本段派生坐标写回原文，外 run 来源仍在请求视图中可定位" do
    transcript("run-history-other", author_text: "历史原文\r\n  保留空格  ")
    |> seed_transcript!("run-history-other")

    segment = transcript("run-local", author_text: "当前原文\r\n  不得归一  ")
    view = AuthoringSessionHistory.compose(segment, fetch!("run-local"))
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(view)
    assert {:ok, restored_view} = AuthoringTranscript.from_request_ir(ir)

    assert Enum.reject(restored_view.messages, &AuthoringSessionHistory.session_history_run_id/1) ==
             segment.messages

    assert [external] =
             Enum.filter(
               restored_view.messages,
               &AuthoringSessionHistory.session_history_run_id/1
             )

    assert %{run_id: "run-history-other", run_sequence: 2, run_status: "completed"} =
             external.canonical_ref

    assert external.blocks == [%{type: "text", text: "历史原文\r\n  保留空格  "}]
    assert {:ok, next_ir} = AuthoringTranscript.to_request_ir(restored_view)
    assert next_ir.messages == ir.messages

    assert AuthoringSessionHistory.strip_request_history(restored_view).messages ==
             segment.messages
  end

  test "合法 A 历史不能供应给错绑 A session 的未提交 B run" do
    seed_run!("run-scope-a", author_text: "仅属于作品 A 的原文")
    foreign_work = identity("run-scope-b", %{work_id: "work-other"})
    foreign_workspace = identity("run-scope-b", %{workspace_id: "ws-other"})

    assert {:error, :authoring_session_scope_mismatch} =
             AuthoringSessionHistory.fetch(foreign_work)

    assert {:error, :authoring_session_scope_mismatch} =
             AuthoringSessionHistory.fetch(foreign_workspace)
  end

  test "nil 历史 compose/strip 是恒等变换" do
    segment = transcript("run-nil")
    assert AuthoringSessionHistory.compose(segment, nil) == segment
    assert AuthoringSessionHistory.strip_request_history(segment) == segment
  end

  test "会话身份缺失视为无历史；段头损坏 fail-closed 不静默退化" do
    assert {:ok, nil} = AuthoringSessionHistory.fetch(%{run_id: "run-x", session_id: nil})

    seed_run!("run-broken")

    SQL.query!(
      Repo,
      "UPDATE authoring_run_segments SET header = ? WHERE run_id = ?",
      [Jason.encode!(%{"version" => "authoring-run-segment/v9"}), "run-broken"]
    )

    assert {:error, :authoring_segment_version_unsupported} =
             AuthoringSessionHistory.fetch(identity("run-other"))
  end
end
