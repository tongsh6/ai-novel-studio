defmodule NovelWeb.WorkspaceChannelSteerBindingTest do
  @moduledoc "B31 CP1 Q03/Q05：steer expected_goal_version 校验与 additive ack 绑定字段。"
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.AgentRunService
  alias NovelPersistence.{Repo, WorkRepo, WorkSessionRepo}
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint

  setup do
    pid = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(pid) end)

    prior = Application.get_env(:novel_web, :persistence, [])

    Application.put_env(
      :novel_web,
      :persistence,
      Keyword.put(prior, :inject_real_persistence, true)
    )

    on_exit(fn -> Application.put_env(:novel_web, :persistence, prior) end)
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

    planner = fn _run, _sequence, _snapshot ->
      send(parent, :b31_steer_running)

      receive do
        :never -> :ok
      end
    end

    assert {:ok, ^run_id} = AgentRunService.start_bounded(attrs, next_step_planner: planner)
    assert_receive :b31_steer_running

    {:ok, _reply, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session.id
      })

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
end
