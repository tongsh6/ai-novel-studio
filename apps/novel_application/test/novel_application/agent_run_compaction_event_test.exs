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
  alias NovelAgent.Provider.RequestIR
  alias NovelApplication.{AgentRunService, AuthoringTranscript}
  alias NovelPersistence.{AgentRunLog, Repo}

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})
    :ok
  end

  test "durable 压缩与 checkpoint 同边界持久化 author-safe 整理记录，幂等不重复" do
    run_id = unique_run_id()
    transcript = compactable_transcript(run_id, "event-call")
    start_failed_run(:durable, run_id, transcript)

    assert {:ok, %{compacted: true, covered_exchanges: 1}} =
             AgentRunService.compact_transcript(run_id)

    # 同一作者动作再次触发是幂等回执，不重复产生整理记录。
    assert {:ok, %{compacted: false, reason: :nothing_to_compact}} =
             AgentRunService.compact_transcript(run_id)

    assert {:ok, state} = AgentRunService.state(run_id)
    assert [record] = checkpoint_events(run_id)
    assert record.visibility == "author"
    assert record.payload["covered_exchanges"] == 1
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

    assert {:ok, %{compacted: true, covered_exchanges: 1}} =
             AgentRunService.compact_transcript(run_id)

    assert [record] = checkpoint_events(run_id)
    assert record.payload["covered_exchanges"] == 1
    refute inspect(record.payload) =~ "bounded-event-call"
  end

  test "持久失败不产生整理记录、不推进内存" do
    run_id = unique_run_id()
    transcript = compactable_transcript(run_id, "event-failure-call")
    start_failed_run(:bounded, run_id, transcript)

    assert {:ok, before_state} = AgentRunService.state(run_id)

    SQL.query!(Repo, """
    CREATE TEMP TRIGGER reject_b71_compaction_record BEFORE UPDATE OF authoring_transcript
    ON agent_runs BEGIN SELECT RAISE(ABORT, 'private history unavailable'); END
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
    AuthoringTranscript.new(transcript_identity(run_id),
      base_text: "压缩整理记录边界",
      author_text: "核对角色"
    )
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

    start = if mode == :durable, do: &AgentRunService.start_durable/2, else: &AgentRunService.start_bounded/2

    assert {:ok, ^run_id} =
             start.(base_run(run_id), next_step_planner: planner, event_sink: event_sink(self()))

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

  defp event_sink(parent) do
    fn event -> send(parent, {:agent_event, event.event_type, event.summary}) end
  end

  defp unique_run_id do
    "run_test_#{System.unique_integer([:positive, :monotonic])}"
  end
end
