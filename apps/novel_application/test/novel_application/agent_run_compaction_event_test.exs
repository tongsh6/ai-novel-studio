defmodule NovelApplication.AgentRunCompactionEventTest do
  @moduledoc """
  B71 阶段 4：压缩整理记录（`checkpoint_created`）的持久化与失败静默。

  整理记录是作者可见面的一手事实：与 canonical checkpoint 同一边界先提交后发布；
  失败不广播、不推进内存。压缩范围派生与回执语义分别由
  `transcript_compaction_test.exs` 与原 runtime 压缩用例覆盖。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AgentRunService
  alias NovelApplication.AuthoringTranscript
  alias NovelApplication.CompactionRecord
  alias NovelApplication.TranscriptCompaction
  alias NovelCommon.RequestIR
  alias NovelPersistence.AgentRunLog
  alias NovelPersistence.AuthoringSessionLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})
    :ok
  end

  test "durable 压缩与 checkpoint 同边界持久化 author-safe 整理记录，幂等不重复" do
    run_id = unique_run_id()
    transcript = compactable_transcript(run_id, "event-call")
    start_failed_run(:durable, run_id, transcript)

    assert {:ok,
            %{
              compacted: true,
              covered_counts: %{tool_exchanges: 1, scope_updates: 0, discussion_messages: 0}
            }} =
             AgentRunService.compact_transcript(run_id)

    # 同一作者动作再次触发是幂等回执，不重复产生整理记录。
    assert {:ok, %{compacted: false, reason: :nothing_to_compact}} =
             AgentRunService.compact_transcript(run_id)

    assert {:ok, state} = AgentRunService.state(run_id)
    assert [record] = checkpoint_events(run_id)
    assert record.visibility == "author"

    assert record.payload["covered_counts"] == %{
             "tool_exchanges" => 1,
             "scope_updates" => 0,
             "discussion_messages" => 0
           }

    refute Map.has_key?(record.payload, "covered_exchanges")
    assert record.payload["history_target"] == %{"session_id" => "sess_1", "turn_id" => "turn_1"}
    assert record.payload["sources"] == []
    refute inspect(record.payload) =~ "event-call"

    assert Enum.any?(
             state.events,
             &(&1.event_type == :checkpoint_created and &1.sequence == record.sequence)
           )
  end

  test "bounded 压缩同样产生整理记录" do
    run_id = unique_run_id()
    transcript = compactable_transcript(run_id, "bounded-event-call")
    start_failed_run(:bounded, run_id, transcript)

    assert {:ok,
            %{
              compacted: true,
              covered_counts: %{tool_exchanges: 1, scope_updates: 0, discussion_messages: 0}
            }} =
             AgentRunService.compact_transcript(run_id)

    assert [record] = checkpoint_events(run_id)

    assert record.payload["covered_counts"] == %{
             "tool_exchanges" => 1,
             "scope_updates" => 0,
             "discussion_messages" => 0
           }

    refute Map.has_key?(record.payload, "covered_exchanges")
    assert record.payload["history_target"] == %{"session_id" => "sess_1", "turn_id" => "turn_1"}
    refute inspect(record.payload) =~ "bounded-event-call"
    assert {:ok, state} = AgentRunService.state(run_id)
    assert Enum.count(state.events, &(&1.event_type == :checkpoint_created)) == 1
  end

  test "零工具的旧范围整理产生可恢复的真实分类计数，原文完整保留" do
    run_id = unique_run_id()

    transcript =
      AuthoringTranscript.new(transcript_identity(run_id),
        base_text: "范围整理记录边界",
        author_text: "先核对已有角色",
        author_turn_ref: "input:scope:#{run_id}"
      )
      |> AuthoringTranscript.append_scope_update(
        %{work_id: "work_1", operation: %{exploration: %{allowed: true}}},
        %{"scope_revision" => 1},
        [],
        []
      )
      |> AuthoringTranscript.append_author_turn("只讨论人物关系", "input:scope:#{run_id}:current")
      |> AuthoringTranscript.append_scope_update(
        %{work_id: "work_1", operation: %{exploration: %{allowed: false}}},
        %{"scope_revision" => 2},
        [],
        []
      )

    start_failed_run(:bounded, run_id, transcript)
    assert {:ok, before_segment} = AuthoringSessionLog.fetch_run_segment(run_id)

    assert {:ok,
            %{
              compacted: true,
              covered_counts: %{tool_exchanges: 0, scope_updates: 1, discussion_messages: 0}
            }} =
             AgentRunService.compact_transcript(run_id)

    assert [record] = checkpoint_events(run_id)

    assert record.payload["covered_counts"] == %{
             "tool_exchanges" => 0,
             "scope_updates" => 1,
             "discussion_messages" => 0
           }

    assert record.summary == "较早的 1 项创作过程已整理"
    assert record.payload["history_target"] == %{"session_id" => "sess_1", "turn_id" => "turn_1"}
    assert {:ok, after_segment} = AuthoringSessionLog.fetch_run_segment(run_id)

    assert Enum.take(after_segment.messages, length(before_segment.messages)) ==
             before_segment.messages

    assert List.last(after_segment.messages)["role"] == "checkpoint"

    assert {:ok, %{compacted: false, reason: :nothing_to_compact}} =
             AgentRunService.compact_transcript(run_id)

    assert [^record] = checkpoint_events(run_id)
    assert {:ok, state} = AgentRunService.state(run_id)
    assert Enum.count(state.events, &(&1.event_type == :checkpoint_created)) == 1
  end

  test "事件构造失败不能单独提交 checkpoint 或广播成功" do
    run_id = unique_run_id()
    transcript = compactable_transcript(run_id, "invalid-event-call")
    start_failed_run(:bounded, run_id, transcript)
    assert {:ok, before_state} = AgentRunService.state(run_id)
    assert {:ok, before_segment} = AuthoringSessionLog.fetch_run_segment(run_id)
    assert {:ok, plan} = TranscriptCompaction.plan(transcript)

    assert {:ok, compacted} =
             AuthoringTranscript.compact(
               transcript,
               plan.covers,
               plan.source_refs,
               plan.versions,
               plan.omissions,
               plan.summary
             )

    invalid_event_state =
      before_state
      |> Map.put(:event_sequence, -1)
      |> Map.put(:stage_state, Map.put(before_state.stage_state, :judgment_transcript, compacted))

    assert {:error, :checkpoint_persistence_failed} =
             CompactionRecord.commit(invalid_event_state, plan, compacted)

    assert AuthoringSessionLog.fetch_run_segment(run_id) == {:ok, before_segment}
    assert {:ok, ^before_state} = AgentRunService.state(run_id)
    assert checkpoint_events(run_id) == []
    refute_receive {:agent_event, :checkpoint_created, _}
  end

  test "持久失败不产生整理记录、不推进内存" do
    run_id = unique_run_id()
    transcript = compactable_transcript(run_id, "event-failure-call")
    start_failed_run(:bounded, run_id, transcript)

    assert {:ok, before_state} = AgentRunService.state(run_id)

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_b71_compaction_record BEFORE INSERT ON authoring_session_messages
    WHEN NEW.role = 'checkpoint'
    BEGIN SELECT RAISE(ABORT, 'private history unavailable'); END
    """)

    try do
      assert {:error, :checkpoint_persistence_failed} =
               AgentRunService.compact_transcript(run_id)

      assert {:ok, after_state} = AgentRunService.state(run_id)
      assert after_state.stage_state == before_state.stage_state
      assert after_state.events == before_state.events
      assert checkpoint_events(run_id) == []
    after
      SQL.query!(Repo, "DROP TRIGGER reject_b71_compaction_record")
    end
  end

  # ── helpers ─────────────────────────────────────────────────────────────

  defp compactable_transcript(run_id, call_id) do
    transcript =
      AuthoringTranscript.new(transcript_identity(run_id),
        base_text: "压缩整理记录边界",
        author_text: "核对角色",
        author_turn_ref: "input:compaction:#{run_id}"
      )
      |> append_exchange(call_id)
      |> AuthoringTranscript.append_author_turn("继续核对关系", "input:compaction:#{run_id}:current")

    # 当前回合与最近四项始终保留；只有较早的完整交换属于整理候选。
    Enum.reduce(1..4, transcript, fn index, acc ->
      append_exchange(acc, "#{call_id}-recent-#{index}")
    end)
  end

  defp append_exchange(transcript, call_id) do
    transcript
    |> AuthoringTranscript.append_assistant("", [
      RequestIR.tool_call_block("read_character", %{}, call_id)
    ])
    |> AuthoringTranscript.append_observation(call_id, %{
      status: "ok",
      source_refs: [],
      content: %{summary: "已读取角色"}
    })
  end

  defp start_failed_run(mode, run_id, transcript) do
    planner = fn _run, _sequence, _snapshot ->
      {:error, :paused_for_compaction, %{judgment_transcript: transcript}}
    end

    start =
      if mode == :durable,
        do: &AgentRunService.start_durable/2,
        else: &AgentRunService.start_bounded/2

    assert {:ok, ^run_id} =
             start.(
               NovelApplication.TestAgentEventRelay.observe(
                 base_run(run_id),
                 event_forward(self())
               ),
               next_step_planner: planner
             )

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive {:agent_event, :run_failed, _}, 2_000
  end

  defp checkpoint_events(run_id) do
    run_id
    |> AgentRunLog.list_author_events()
    |> Enum.filter(&(&1.event_type == "checkpoint_created"))
  end

  defp transcript_identity(run_id) do
    %{
      run_id: run_id,
      workspace_id: "ws_1",
      work_id: "work_1",
      session_id: "sess_1",
      parent_turn_ref: "turn_1"
    }
  end

  defp base_run(run_id) do
    %{
      run_id: run_id,
      workspace_id: "ws_1",
      work_id: "work_1",
      session_id: "sess_1",
      parent_turn_ref: "turn_1",
      origin_frame_ref: "frame_1",
      profile_ref: "character_design_with_context_v1",
      goal: %{text: "先看角色阵容，再设计反派", version: 1},
      authority_scope: %{
        production_write: false,
        allowed_tools: ["character_roster", "character_design"]
      }
    }
  end

  defp event_forward(parent) do
    fn event -> send(parent, {:agent_event, event.event_type, event.summary}) end
  end

  defp unique_run_id do
    "run_test_#{System.unique_integer([:positive, :monotonic])}"
  end
end
