defmodule NovelApplication.AgentRunStartupTest do
  use ExUnit.Case, async: true

  alias NovelApplication.AgentRunStartup
  alias NovelDomain.AgentRun

  # B80 CP4：启动恢复域抽查发现 AgentRunStartup 是「一次运行的启动事实唯一
  # 构造点」（普通启动/作者动作受理/确认子 run 共用），但此前只有流程级间接
  # 覆盖。这里直接锁定契约：事件/游标/stage_state 同一数据单元、起始序列为 1、
  # payload 只来自 run 权威字段。

  defp run(overrides \\ %{}) do
    struct(
      %AgentRun{
        run_id: "run_startup_test",
        workspace_id: "ws-1",
        work_id: "work-1",
        session_id: "session-1",
        profile_ref: "profile:writer",
        current_step_ref: "step-1",
        trigger: %{kind: :author_message, ref: "turn-1"},
        authority_scope: %{
          production_write: false,
          allowed_tools: ["read_character"],
          profile_selection: %{primary: :writer}
        }
      },
      overrides
    )
  end

  test "唯一构造点：初始 run + run_started 事件 + 游标 + 空 stage_state 同一数据单元" do
    run = run()
    startup = AgentRunStartup.new(run)

    assert startup.run == run
    assert [event] = startup.events
    assert startup.event_sequence == event.sequence
    assert startup.event_sequence == 1
    assert startup.stage_state == %{}

    assert event.event_id == "evt_run_startup_test_1"
    assert event.run_ref == "run_startup_test"
    assert event.step_ref == "step-1"
    assert event.sequence == 1
    assert event.event_type == :run_started
    assert event.visibility == :author
    assert event.summary == "AgentRun 已启动。"
    assert event.reason_codes == ["agent_run_started", "profile_selected"]
    assert event.refs == []

    assert event.payload[:profile_ref] == "profile:writer"
    assert event.payload[:trigger] == %{kind: :author_message, ref: "turn-1"}
    assert event.payload[:allowed_tools] == ["read_character"]
    assert event.payload[:profile_selection] == %{primary: :writer}
  end

  test "作者动作/确认子 run 共用同一工厂：起始序列仍为 1，不继承父 run 状态" do
    parent = run(%{run_id: "run_parent"})
    child = run(%{run_id: "run_child", run_mode: :bounded, parent_turn_ref: "turn-parent"})

    startup = AgentRunStartup.new(child)

    assert startup.event_sequence == 1
    assert [event] = startup.events
    assert event.event_id == "evt_run_child_1"
    assert event.run_ref == "run_child"
    assert startup.stage_state == %{}

    # 父 run 的标识不出现在子 run 启动事实中（只经 parent_turn_ref 关联）。
    assert parent.run_id == "run_parent"
    refute inspect(startup) =~ "run_parent"
  end

  test "authority_scope 缺省：payload 用空默认，不伪造 profile_selection" do
    run = %AgentRun{
      run_id: "run_minimal",
      workspace_id: "ws-1",
      work_id: "work-1",
      session_id: "session-1",
      profile_ref: nil,
      current_step_ref: nil,
      trigger: nil,
      authority_scope: nil
    }

    startup = AgentRunStartup.new(run)
    assert [event] = startup.events

    assert event.payload[:profile_ref] == nil
    assert event.payload[:trigger] == %{}
    assert event.payload[:allowed_tools] == []
    assert event.payload[:profile_selection] == %{}
  end
end
