defmodule NovelWeb.WorkspaceChannelV3Test do
  use ExUnit.Case, async: true

  import Phoenix.ChannelTest

  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint

  @server_turn_result %{
    turn_id: "turn-action-1",
    available_actions: [
      %{
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        enabled: true,
        idempotency_key: "ik-confirm"
      },
      %{
        action_id: "act-cancel",
        action_type: "cancel_pending_behavior",
        enabled: true
      }
    ],
    plan: %NovelDomain.MicroPlan{
      plan_id: "plan-chan-1",
      turn_id: "turn-action-1",
      frame_ref: "frame-chan-1",
      plan_goal: %{summary: "channel test plan"},
      risk_hint: :low,
      requires_confirmation_hint: false,
      proposed_actions: [%{action_type: :capability_invocation, target_ref: "text_analysis"}],
      state_changes_requested: [],
      required_capabilities: [],
      fallback_strategy: %{downgrade_message: "fallback"}
    }
  }

  # ── VS-07 Proof: user_message → turn_result roundtrip ──

  describe "user_message roundtrip" do
    test "receives reply acknowledgement" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref = push(socket, "user_message", %{"text" => "你好，我想聊聊创作"})
      assert_reply(ref, :ok, %{received: true})
    end

    test "broadcasts turn_result after user_message" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      push(socket, "user_message", %{"text" => "聊聊赛博朋克方向"})
      assert_broadcast("turn_result", %{phase: _, assistant_message: %{text: _}})
    end

    test "turn_result has required v3 fields" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      push(socket, "user_message", %{"text" => "你好"})
      assert_broadcast("turn_result", result)

      assert result.schema_version == "3.0-draft"
      assert result.turn_id != nil
      assert result.frame_ref != nil
      assert result.assistant_message.text != ""
      assert result.phase in ["completed", "awaiting_author"]
      assert result.status in ["conversational", "needs_clarification", "needs_confirmation"]
    end

    test "turn_result truthfulness — no false claims" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      push(socket, "user_message", %{"text" => "先聊方向不写正文"})
      assert_broadcast("turn_result", result)

      assert result.truthfulness.tool_called == false
      assert result.truthfulness.artifact_adopted == false
      assert result.truthfulness.production_write_performed == false
    end

    test "does not contain forbidden form fields" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      push(socket, "user_message", %{"text" => "我想写小说但没想好"})
      assert_broadcast("turn_result", result)

      refute Map.has_key?(result, :required_slots)
      refute Map.has_key?(result, :missing_slots)
      refute Map.has_key?(result, :slot_form)
      refute Map.has_key?(result, :slot_schema)
    end
  end

  # ── VS-07 Proof: generate_micro_plan roundtrip ──

  describe "generate_micro_plan roundtrip" do
    test "responds with turn_result containing phase/status" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      push(socket, "user_message", %{"text" => "帮我创作角色设定", "generate_micro_plan" => true})
      assert_broadcast("turn_result", result)

      assert result.turn_id != nil
      assert result.phase != nil
      assert result.status != nil
    end
  end

  # ── VS-07 Proof: author_action roundtrip ──

  describe "author_action roundtrip" do
    test "valid action is checked against server-held turn_result" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @server_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-action-1",
                     "action_id" => "act-cancel",
                     "action_type" => "cancel_pending_behavior",
                     "idempotency_key" => "ik-cancel"
                   }
                 },
                 socket
               )
    end

    test "client-provided source_turn_result cannot authorize invented action" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @server_turn_result)

      assert {:reply, {:error, %{reason: reason}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-action-1",
                     "action_id" => "act-forged",
                     "action_type" => "confirm_before_execute",
                     "source_turn_result" => %{
                       "turn_id" => "turn-action-1",
                       "available_actions" => [
                         %{
                           "action_id" => "act-forged",
                           "action_type" => "confirm_before_execute",
                           "enabled" => true
                         }
                       ]
                     }
                   }
                 },
                 socket
               )

      assert String.contains?(reason, "invented")
    end

    test "invented action returns error" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref =
        push(socket, "author_action", %{
          "action" => %{
            "source_turn_ref" => "turn-unknown",
            "action_id" => "act-fake",
            "action_type" => "nonexistent"
          }
        })

      assert_reply(ref, :error, %{reason: reason})
      assert String.contains?(reason, "source_turn_result not available")
    end

    test "action with required fields is processed (not silently dropped)" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref =
        push(socket, "author_action", %{
          "action" => %{
            "source_turn_ref" => "lobby",
            "action_id" => "act-test",
            "action_type" => "confirm_before_execute",
            "behavior_ref" => "bh-test",
            "idempotency_key" => "ik-test"
          }
        })

      # Channel must respond — must not timeout or silently drop the message
      assert_reply(ref, _status, _payload)
    end

    test "stale source_turn_ref rejected" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref =
        push(socket, "author_action", %{
          "action" => %{
            "source_turn_ref" => "turn-from-2-hours-ago",
            "action_id" => "act-1",
            "action_type" => "confirm_before_execute"
          }
        })

      assert_reply(ref, :error, %{reason: reason})

      assert String.contains?(reason, "stale") or
               String.contains?(reason, "source_turn_result not available")
    end
  end

  # ── VS-07 Proof: ping/pong ──

  describe "ping/pong" do
    test "ping returns pong" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref = push(socket, "ping", %{"hello" => "world"})
      assert_reply(ref, :ok, %{event: "pong", echo: %{"hello" => "world"}})
    end
  end

  defp assign_server_turn(socket, %{turn_id: turn_id} = turn_result) do
    socket
    |> Phoenix.Socket.assign(:current_turn_id, turn_id)
    |> Phoenix.Socket.assign(:turn_results_by_id, %{turn_id => turn_result})
  end
end
