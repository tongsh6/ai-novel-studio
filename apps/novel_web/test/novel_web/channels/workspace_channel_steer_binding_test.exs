defmodule NovelWeb.WorkspaceChannelSteerBindingTest do
  @moduledoc "B31 CP1 Q03/Q05：steer expected_goal_version 校验与 additive ack 绑定字段。"
  use NovelPersistence.DataCase, async: false

  import Phoenix.ChannelTest

  alias NovelApplication.AgentRunService
  alias NovelDomain.AgentNextStepDecision
  alias NovelPersistence.{WorkRepo, WorkSessionRepo}
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint

  setup do
    previous = Application.fetch_env(:novel_web, :persistence)

    Application.put_env(
      :novel_web,
      :persistence,
      Keyword.put(prior_persistence(previous), :inject_real_persistence, true)
    )

    on_exit(fn -> restore_persistence(previous) end)
    :ok
  end

  test "steer expected_goal_version 冲突返回可解释错误，不推进 goal；正常 ack 携带绑定字段" do
    parent = self()
    {:ok, work} = WorkRepo.create(%{title: "steer 绑定"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})

    run_id = "run_b31_steer_#{System.unique_integer([:positive, :monotonic])}"

    attrs = %{
      run_id: run_id,
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      parent_turn_ref: "turn-b31-steer",
      origin_frame_ref: "frame-b31-steer",
      profile_ref: "character_design_with_context_v1",
      goal: %{text: "先看角色阵容，再设计反派", version: 1},
      authority_scope: %{
        production_write: false,
        allowed_tools: ["character_roster", "character_design"]
      }
    }

    planner = fn run, sequence, _snapshot ->
      send(parent, {:b31_steer_running, self()})

      receive do
        :release -> complete_step(run, sequence)
      end
    end

    assert {:ok, ^run_id} = AgentRunService.start_bounded(attrs, next_step_planner: planner)
    NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive {:b31_steer_running, step_pid}, 1_000
    # 晚于 register_run 登记，因此先释放 step latch，run 再走取消/安全点。
    on_exit(fn -> send(step_pid, :release) end)

    {:ok, _reply, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session.id
      })

    NovelApplication.TestAgentRunCleanup.register_task_caller(socket.channel_pid)

    base = %{
      "command" => "steer",
      "run_id" => run_id,
      "turn_id" => "turn-b31-steer-1",
      "text" => "保留结构，补充心理描写",
      "work_id" => work.id,
      "session_id" => session.id
    }

    # 版本冲突：可解释错误 + 不推进 goal
    ref = push(socket, "agent_command", Map.put(base, "expected_goal_version", 99))

    assert_reply(ref, :error, %{
      reason: "goal_version_conflict",
      current_goal_version: 1,
      expected_goal_version: 99
    })

    assert {:ok, %{run: %{goal: %{version: 1}}}} = AgentRunService.state(run_id)

    # 非法 expected 类型
    ref = push(socket, "agent_command", Map.put(base, "expected_goal_version", "1"))
    assert_reply(ref, :error, %{reason: "invalid_expected_goal_version"})

    # 正常 steer：goal 1→2，ack additive 绑定字段
    ref = push(socket, "agent_command", Map.put(base, "expected_goal_version", 1))

    assert_reply(ref, :ok, %{
      received: true,
      command: "steer",
      resolved_run_id: ^run_id,
      binding_source: "explicit_steer",
      goal_version: 2
    })

    assert {:ok, %{run: %{goal: %{version: 2}}}} = AgentRunService.state(run_id)

    # 旧 payload（无 expected）兼容：goal 2→3
    ref =
      push(
        socket,
        "agent_command",
        Map.delete(base, "expected_goal_version") |> Map.put("turn_id", "turn-b31-steer-2")
      )

    assert_reply(ref, :ok, %{goal_version: 3, resolved_run_id: ^run_id})
  end

  test "steer work/session 域不匹配沿用既有拒绝" do
    {:ok, work} = WorkRepo.create(%{title: "域校验"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    {:ok, other_work} = WorkRepo.create(%{title: "另一个作品"})

    {:ok, _reply, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session.id
      })

    NovelApplication.TestAgentRunCleanup.register_task_caller(socket.channel_pid)

    ref =
      push(socket, "agent_command", %{
        "command" => "steer",
        "run_id" => "run_missing",
        "turn_id" => "turn-b31-domain",
        "text" => "补充方向",
        "work_id" => other_work.id
      })

    assert_reply(ref, :error, %{reason: "message_scope_mismatch"})
  end

  defp complete_step(run, sequence) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "decision_#{run.run_id}_#{sequence}",
        run_ref: run.run_id,
        sequence: sequence,
        decision_type: :goal_satisfied,
        summary: "latch released",
        reason_codes: ["goal_satisfied"]
      })

    {:complete, decision, %{provider_call_count: 0}}
  end

  defp prior_persistence({:ok, value}), do: value
  defp prior_persistence(:error), do: []

  defp restore_persistence({:ok, value}),
    do: Application.put_env(:novel_web, :persistence, value)

  defp restore_persistence(:error), do: Application.delete_env(:novel_web, :persistence)
end
