defmodule NovelWeb.WorkspaceChannelPlanNextVolumeTest do
  @moduledoc """
  B11A CP3（VS-00J §3.2 形态 A / ADR-0028）：开新卷动作的真 Channel 入口。

  作者在工作台触发「规划下一卷」→ 服务端机械读 TOC 推导 volume_scope（不让模型/前端猜）
  → 复用既有 user_message AgentRun 提交路径 → reply 带 turn_id + volume_scope；
  无卷/未知作品给出明确 reason。只走真实产品链路，不新增 artifact/卡型/写路径。
  """
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelApplication.WorkSessionService
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Volume}
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint
  @run_stopped_events ["run_completed", "awaiting_author", "run_failed", "run_cancelled"]
  @agent_run_timeout 45_000

  setup do
    pid = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(pid) end)
    :ok
  end

  test "已有两卷 → 机械推导下一卷 scope，reply 带 turn_id + volume_scope，并起 AgentRun" do
    {work_id, socket} = join_work_with_volumes()

    ref = push(socket, "plan_next_volume", %{"work_id" => work_id})

    assert_reply(
      ref,
      :ok,
      %{
        turn_id: turn_id,
        volume_scope: %{
          next_seq: 3,
          current_volume_seq: 2,
          current_volume_title: "第二卷·裂变",
          next_chapter_seq: 5,
          existing_volume_count: 2,
          existing_chapter_count: 4
        },
        run_id: run_id
      },
      @agent_run_timeout
    )

    assert is_binary(turn_id)
    assert is_binary(run_id)

    # reply 后 AgentRun 已经在既有提交路径上跑起来（run_started 是既有事件流的证明）。
    assert_broadcast(
      "agent_event",
      %{run_id: ^run_id, event_type: "run_started"},
      @agent_run_timeout
    )

    await_run_stopped(run_id, System.monotonic_time(:millisecond) + @agent_run_timeout)
  end

  test "作品无任何已采纳卷 → 明确 :no_volume_to_extend，不起 run" do
    {:ok, work} = WorkService.create(%{title: "尚无卷的作品"})
    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session_id
      })

    ref = push(socket, "plan_next_volume", %{"work_id" => work.id})

    assert_reply(ref, :error, %{reason: "no_volume_to_extend"})
    refute_broadcast("agent_run_state", _, 50)
  end

  test "未知作品 / 非法 work_id → 明确 :invalid_work" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    for work_id <- [Ecto.UUID.generate(), "lobby", "", nil] do
      ref = push(socket, "plan_next_volume", %{"work_id" => work_id})
      assert_reply(ref, :error, %{reason: "invalid_work"})
    end

    refute_broadcast("agent_run_state", _, 50)
  end

  test "payload 非 map → invalid_payload（不崩）" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    ref = push(socket, "plan_next_volume", ["bad"])
    assert_reply(ref, :error, %{reason: "invalid_payload"})
  end

  defp join_work_with_volumes do
    {:ok, work} = WorkService.create(%{title: "开新卷动作作品"})
    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)

    volume_one = insert_volume(work.id, "第一卷·觉醒", 1)
    volume_two = insert_volume(work.id, "第二卷·裂变", 2)

    insert_chapter(work.id, volume_one.id, "第01章：起", 1)
    insert_chapter(work.id, volume_one.id, "第02章：承", 2)
    insert_chapter(work.id, volume_two.id, "第03章：转", 3)
    insert_chapter(work.id, volume_two.id, "第04章：合", 4)

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session_id
      })

    {work.id, socket}
  end

  defp insert_volume(work_id, title, seq) do
    %Volume{}
    |> Volume.changeset(%{work_id: work_id, title: title, seq: seq})
    |> Repo.insert!()
  end

  defp insert_chapter(work_id, volume_id, title, seq) do
    %Chapter{}
    |> Chapter.changeset(%{work_id: work_id, volume_id: volume_id, title: title, seq: seq})
    |> Repo.insert!()
  end

  defp await_run_stopped(run_id, deadline) do
    remaining = max(deadline - System.monotonic_time(:millisecond), 0)

    receive do
      %Phoenix.Socket.Broadcast{
        event: "agent_event",
        payload: %{run_id: ^run_id, event_type: event_type}
      }
      when event_type in @run_stopped_events ->
        :ok
    after
      remaining -> :timeout
    end
  end
end
