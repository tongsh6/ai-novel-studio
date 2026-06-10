defmodule NovelWeb.WorkspaceChannelActionIdempotencyTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelPersistence.Repo
  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint

  @creative_turn_result %{
    turn_id: "turn-action-persisted-1",
    frame_ref: "frame-action-persisted-1",
    available_actions: [
      %{
        action_id: "act-confirm-persisted",
        action_type: "confirm_before_execute",
        # 生产 turn_result 的确认 action 始终带 behavior_ref/target_ref（VS-03 §5）。
        behavior_ref: "bh-persisted-1",
        target_ref: "character_design",
        enabled: true,
        idempotency_key: "ik-confirm-persisted"
      }
    ],
    plan: %NovelDomain.MicroPlan{
      plan_id: "plan-action-persisted-1",
      turn_id: "turn-action-persisted-1",
      frame_ref: "frame-action-persisted-1",
      plan_goal: %{summary: "persisted idempotency test plan"},
      risk_hint: :low,
      requires_confirmation_hint: false,
      proposed_actions: [
        %{
          action_id: "act-creative",
          action_type: :capability_invocation,
          summary: "生成角色设定",
          target_ref: "character_design",
          write_intent: :tentative,
          risk_hint: :low
        }
      ],
      state_changes_requested: [],
      required_capabilities: [],
      fallback_strategy: %{downgrade_message: "fallback"}
    }
  }

  setup do
    pid = Sandbox.start_owner!(Repo, shared: true)
    previous = Application.get_env(:novel_web, :persistence, [])
    Application.put_env(:novel_web, :persistence, inject_real_persistence: true)

    on_exit(fn ->
      Application.put_env(:novel_web, :persistence, previous)
      Sandbox.stop_owner(pid)
    end)
  end

  test "persisted idempotency receipt suppresses duplicate dispatch after channel memory is empty" do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

    socket = assign_server_turn(socket, @creative_turn_result)

    action = %{
      "source_turn_ref" => "turn-action-persisted-1",
      "action_id" => "act-confirm-persisted",
      "action_type" => "confirm_before_execute",
      # 前端提交确认时回传 available_action 的 target_ref/behavior_ref。
      "target_ref" => "character_design",
      "behavior_ref" => "bh-persisted-1",
      "idempotency_key" => "ik-confirm-persisted"
    }

    assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    assert_broadcast("turn_result", %{turn_id: first_dispatch_turn_id})

    socket = Phoenix.Socket.assign(socket, :action_idempotency_ledger, %{})

    assert {:reply, {:ok, %{received: true, action_status: "accepted", duplicate: true}}, socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    assert_broadcast("action_result", %{
      duplicate: true,
      idempotency_key: "ik-confirm-persisted"
    })

    refute_broadcast("turn_result", %{}, 50)
    assert socket.assigns.current_turn_id == first_dispatch_turn_id
  end

  defp assign_server_turn(socket, %{turn_id: turn_id} = turn_result) do
    turn_results = Map.put(socket.assigns[:turn_results_by_id] || %{}, turn_id, turn_result)

    socket
    |> Phoenix.Socket.assign(:current_turn_id, turn_id)
    |> Phoenix.Socket.assign(:turn_results_by_id, turn_results)
  end
end
