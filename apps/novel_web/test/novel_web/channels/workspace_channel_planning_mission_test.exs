defmodule NovelWeb.WorkspaceChannelPlanningMissionTest do
  @moduledoc """
  WR01c（ADR-0024 S9）：规划使命裁决三动作经真实 channel——确认 / 改写 / 作废；
  TOC 投影顶层带 planning_direction 供档案「大纲与结构」工作级块渲染。
  """
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{WorkService, WorkSessionService}
  alias NovelPersistence.{PlanningMissionRepo, Repo}
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint

  setup do
    pid = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(pid) end)
    :ok
  end

  defp join_work do
    {:ok, work} = WorkService.create(%{"title" => "规划使命裁决作品"})
    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)

    {:ok, :stored, _} =
      PlanningMissionRepo.put_tentative(work.id, %{
        "mission_id" => "cm_model_p",
        "statement" => "接下来的章节先给超期伏笔安排回收。",
        "must_advance" => [%{"text" => "安排回收章"}],
        "must_avoid" => []
      })

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session_id
      })

    {work, socket}
  end

  defp author_action(socket, action_type, payload) do
    push(socket, "author_action", %{
      "action" => %{
        "source_turn_ref" => "panel",
        "action_id" => "#{action_type}-1",
        "action_type" => action_type,
        "idempotency_key" => "#{action_type}-1",
        "payload" => payload
      }
    })
  end

  test "TOC 顶层带暂定规划使命；确认→CONFIRMED；改写→AUTHOR_EDITED；作废→删键" do
    {work, socket} = join_work()

    ref = push(socket, "get_toc", %{"work_id" => work.id})
    assert_reply(ref, :ok, %{planning_direction: planning_direction})
    assert planning_direction["planning_mission"]["status"] == "TENTATIVE"

    confirm = author_action(socket, "confirm_planning_mission", %{})
    assert_reply(confirm, :ok, %{action_status: "applied", mission_status: "CONFIRMED"})
    assert PlanningMissionRepo.get_mission(work.id)["source"] == "author"

    rewrite =
      author_action(socket, "rewrite_planning_mission", %{
        "statement" => "先收束当前支线，再开新章。",
        "must_advance" => ["收束支线"],
        "must_avoid" => ["不开新卷"]
      })

    assert_reply(rewrite, :ok, %{
      action_status: "applied",
      mission_status: "AUTHOR_EDITED",
      mission: mission
    })

    assert mission["statement"] == "先收束当前支线，再开新章。"

    discard = author_action(socket, "discard_planning_mission", %{})
    assert_reply(discard, :ok, %{action_status: "applied"})
    assert PlanningMissionRepo.get_mission(work.id) == nil

    again = author_action(socket, "discard_planning_mission", %{})
    assert_reply(again, :error, %{})
  end
end
