defmodule NovelApplication.AgentRunPersistenceTest do
  @moduledoc """
  AgentRun snapshot 四种请求语义的行为钉住：同一 builder 投影 run/step/event/
  private checkpoint/durable task，不复制 codec，也不改变各路径的事件策略。
  """

  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunPersistence
  alias NovelCommon.Contracts.AgentEvent
  alias NovelDomain.AgentRun

  test "delivery 保存全部非 stream 事件，并剥离 turn_result payload" do
    run = run()

    events = [
      event(:turn_result_ready, 1),
      event(:provider_progress, 2),
      event(:run_completed, 3)
    ]

    assert {:ok, snapshot} = snapshot(run, events, :delivery)

    assert Enum.map(snapshot.events, & &1.event_type) == ["turn_result_ready", "run_completed"]
    refute Map.has_key?(hd(snapshot.events).payload, "turn_result")
    assert hd(snapshot.events).payload["visible"] == "ok"
  end

  test "普通状态快照只在可持久终态保存事件" do
    events = [event(:run_started, 1), event(:provider_progress, 2)]

    assert {:ok, %{events: []}} = snapshot(%{run() | status: :running}, events, :status_snapshot)

    assert {:ok, %{events: [event]}} =
             snapshot(%{run() | status: :completed}, events, :status_snapshot)

    assert event.event_type == "run_started"
  end

  test "显式压缩默认不写事件，本次新增作者安全事件随 checkpoint 一起提交" do
    assert {:ok, %{events: []}} =
             snapshot(run(), [event(:run_started, 1)], :compaction)

    record = event(:checkpoint_created, 5)

    assert {:ok, %{events: [compacted_event]}} =
             AgentRunPersistence.snapshot(
               run(),
               %{events: [], event_sequence: 4, stage_state: %{}},
               :compaction,
               events: [record]
             )

    assert compacted_event.id == record.event_id
    assert compacted_event.event_type == "checkpoint_created"
    assert compacted_event.visibility == "author"
    assert compacted_event.sequence == 5
    refute Map.has_key?(compacted_event.payload, "turn_result")
  end

  test "问题答复只提交本次新增事件" do
    first = event(:run_started, 1)
    second = event(:plan_adjusted, 2)
    before = %{events: [first]}
    state = %{events: [first, second]}

    assert {:ok, snapshot} =
             AgentRunPersistence.snapshot(run(), state, :question_answer, before: before)

    assert Enum.map(snapshot.events, & &1.id) == [second.event_id]
  end

  test "问题答复的新增 delta 不落 provider_progress" do
    first = event(:run_started, 1)
    progress = event(:provider_progress, 2)
    answer = event(:question_answered, 3)
    before = %{events: [first]}
    state = %{events: [first, progress, answer]}

    assert {:ok, snapshot} =
             AgentRunPersistence.snapshot(run(), state, :question_answer, before: before)

    assert Enum.map(snapshot.events, & &1.event_type) == ["question_answered"]
  end

  test "durable task 投影带同一 checkpoint 版本、进度与步骤标签" do
    run = %{run() | run_mode: :durable, long_run_task_ref: "task_ref", status: :running}
    state = %{events: [], event_sequence: 4, stage_state: %{}}

    assert {:ok, snapshot} = AgentRunPersistence.snapshot(run, state, :delivery)

    assert %{task_ref: "task_ref", attrs: attrs} = snapshot.checkpoint
    header = attrs.checkpoint_data["agent_run"]
    assert header["checkpoint_version"] == AgentRunPersistence.checkpoint_version()
    assert header["run_id"] == run.run_id
    assert attrs.checkpoint_data["progress"] == 0
    assert attrs.checkpoint_data["step"] == "AgentRun 检查点"
  end

  defp snapshot(run, events, mode, opts \\ []) do
    AgentRunPersistence.snapshot(
      run,
      %{events: events, event_sequence: length(events), stage_state: %{}},
      mode,
      opts
    )
  end

  defp run do
    %AgentRun{
      run_id: "run_projection",
      workspace_id: "work_projection",
      work_id: "work_projection",
      session_id: "session_projection",
      parent_turn_ref: "turn_projection",
      origin_frame_ref: "frame_projection",
      profile_ref: "conversation_turn_v1",
      goal: %{text: "投影", version: 1},
      status: :running,
      phase: :executing,
      authority_scope: %{production_write: false, allowed_tools: []}
    }
  end

  defp event(type, sequence) do
    %AgentEvent{
      event_id: "evt_#{sequence}",
      run_ref: "run_projection",
      sequence: sequence,
      event_type: type,
      visibility: :author,
      summary: "摘要",
      reason_codes: [],
      refs: [],
      payload: %{"visible" => "ok", turn_result: %{secret: true}},
      emitted_at: nil
    }
  end
end
