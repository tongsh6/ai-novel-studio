defmodule NovelWeb.WorkspaceChannelContractTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias NovelWeb.UserSocket
  alias NovelWeb.WorkspaceChannel

  @endpoint NovelWeb.Endpoint
  @agent_run_timeout 45_000
  @agent_run_stopped_events ["run_completed", "awaiting_author", "run_failed", "run_cancelled"]

  @server_turn_result %{
    turn_id: "turn-action-1",
    frame_ref: "frame-chan-1",
    available_actions: [
      %{
        action_id: "act-confirm",
        action_type: "confirm_before_execute",
        # 生产 turn_result 的确认 action 始终带 behavior_ref/target_ref（VS-03 §5）。
        behavior_ref: "bh-chan-1",
        target_ref: "text_analysis",
        enabled: true,
        idempotency_key: "ik-confirm"
      },
      %{
        action_id: "act-cancel",
        action_type: "cancel_pending_behavior",
        behavior_ref: "bh-chan-1",
        target_ref: "text_analysis",
        enabled: true,
        idempotency_key: "ik-cancel"
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

  @creative_turn_result %{
    @server_turn_result
    | plan: %NovelDomain.MicroPlan{
        @server_turn_result.plan
        | proposed_actions: [
            %{
              action_id: "act-creative",
              action_type: :capability_invocation,
              summary: "生成角色设定",
              target_ref: "character_design",
              write_intent: :tentative,
              risk_hint: :low
            }
          ]
      }
  }

  @pending_adoption_turn_result %{
    turn_id: "turn-adopt-source",
    frame_ref: "frame-adopt-source",
    available_actions: [],
    adoption_state: %{
      pending: [
        %{
          artifact_id: "as-adopt-1",
          artifact_type: :character_seed,
          adoption_status: :tentative,
          requires_adoption: true,
          source_tool_result_ref: "tr-adopt-1",
          payload: %{title: "角色设定", content: "主角更果断"}
        }
      ],
      resolved: []
    }
  }

  @candidate_turn_result %{
    turn_id: "turn-candidates-1",
    frame_ref: "frame-candidates-1",
    available_actions: [
      %{
        action_id: "choose_candidate:dir-1",
        action_type: "choose_candidate",
        target_ref: "dir-1",
        candidate_set_ref: "candidate_set:turn-candidates-1",
        candidate_ref: "dir-1",
        enabled: true,
        idempotency_key: "idem:turn-candidates-1:choose_candidate:dir-1"
      }
    ],
    candidate_directions: [
      %{
        direction_id: "dir-1",
        title: "赛博公司垄断流",
        pitch: "底层散修对抗大厂灵气垄断",
        tone_tags: ["反叛"],
        adoption_status: :not_adopted
      }
    ],
    truthfulness: %{
      tool_called: false,
      artifact_adopted: false,
      production_write_performed: false,
      durable_behavior_opened: false
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

      assert_reply(
        ref,
        :ok,
        %{received: true, run_id: run_id, run_mode: "bounded", turn_id: turn_id},
        @agent_run_timeout
      )

      assert is_binary(run_id)

      assert_broadcast(
        "turn_result",
        %{turn_id: ^turn_id, phase: "completed"},
        @agent_run_timeout
      )

      assert_agent_run_stopped(run_id)
    end

    test "broadcasts turn_result after user_message" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref = push(socket, "user_message", %{"text" => "聊聊赛博朋克方向"})
      assert_reply(ref, :ok, %{run_id: run_id, turn_id: turn_id}, @agent_run_timeout)

      assert_broadcast(
        "agent_event",
        %{run_id: ^run_id, event_type: "run_started"},
        @agent_run_timeout
      )

      assert_broadcast(
        "agent_run_state",
        %{run_id: ^run_id, run_mode: "bounded"},
        @agent_run_timeout
      )

      assert_broadcast(
        "turn_result",
        %{turn_id: ^turn_id, phase: _, assistant_message: %{text: _}},
        @agent_run_timeout
      )

      assert is_binary(run_id)
      assert_agent_run_stopped(run_id)
    end

    test "rejects invalid user_message without synthetic fallback turn_result" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref = push(socket, "user_message", %{"text" => ""})
      assert_reply(ref, :error, %{reason: "empty_text"})
      refute_broadcast("turn_result", %{}, 50)
    end

    test "turn_result has required v3 fields" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref = push(socket, "user_message", %{"text" => "你好"})
      assert_reply(ref, :ok, %{run_id: run_id, turn_id: turn_id}, @agent_run_timeout)
      assert_broadcast("turn_result", %{turn_id: ^turn_id} = result, @agent_run_timeout)

      assert result.schema_version == "3.0-draft"
      assert result.turn_id != nil
      assert result.frame_ref != nil
      assert result.assistant_message.text != ""
      assert result.phase in ["completed", "awaiting_author"]
      assert result.status in ["conversational", "needs_clarification", "needs_confirmation"]
      assert_agent_run_stopped(run_id)
    end

    test "turn_result truthfulness — no false claims" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref = push(socket, "user_message", %{"text" => "先聊方向不写正文"})
      assert_reply(ref, :ok, %{run_id: run_id, turn_id: turn_id}, @agent_run_timeout)
      assert_broadcast("turn_result", %{turn_id: ^turn_id} = result, @agent_run_timeout)

      assert result.truthfulness.tool_called == false
      assert result.truthfulness.artifact_adopted == false
      assert result.truthfulness.production_write_performed == false
      assert_agent_run_stopped(run_id)
    end

    test "does not contain forbidden form fields" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref = push(socket, "user_message", %{"text" => "我想写小说但没想好"})
      assert_reply(ref, :ok, %{run_id: run_id, turn_id: turn_id}, @agent_run_timeout)
      assert_broadcast("turn_result", %{turn_id: ^turn_id} = result, @agent_run_timeout)

      refute Map.has_key?(result, :required_slots)
      refute Map.has_key?(result, :missing_slots)
      refute Map.has_key?(result, :slot_form)
      refute Map.has_key?(result, :slot_schema)
      assert_agent_run_stopped(run_id)
    end

    test "candidate continuation validates source turn and stays a normal dialogue turn" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @candidate_turn_result)

      assert {:reply,
              {:ok, %{received: true, run_id: run_id, run_mode: "bounded", turn_id: turn_id}},
              socket} =
               WorkspaceChannel.handle_in(
                 "user_message",
                 %{
                   "text" => "继续聊「赛博公司垄断流」这个方向",
                   "candidate_selection" => %{
                     "source_turn_ref" => "turn-candidates-1",
                     "candidate_set_ref" => "candidate_set:turn-candidates-1",
                     "candidate_ref" => "dir-1"
                   }
                 },
                 socket
               )

      assert is_binary(run_id)
      socket = pump_agent_events_until_turn_result(socket, turn_id)
      assert_broadcast("turn_result", %{turn_id: ^turn_id} = result, @agent_run_timeout)
      assert result.truthfulness.artifact_adopted == false
      assert result.truthfulness.production_write_performed == false
      assert socket.assigns.current_turn_id != "turn-candidates-1"
      _socket = pump_agent_events_until_stopped(socket, run_id)
    end

    test "candidate continuation rejects invented candidate refs" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @candidate_turn_result)

      assert {:reply, {:error, %{reason: "candidate not found in source turn"}}, _socket} =
               WorkspaceChannel.handle_in(
                 "user_message",
                 %{
                   "text" => "继续聊一个不存在的方向",
                   "candidate_selection" => %{
                     "source_turn_ref" => "turn-candidates-1",
                     "candidate_set_ref" => "candidate_set:turn-candidates-1",
                     "candidate_ref" => "dir-missing"
                   }
                 },
                 socket
               )
    end
  end

  # ── VS-07 Proof: generate_micro_plan roundtrip ──

  describe "generate_micro_plan roundtrip" do
    test "responds with turn_result containing phase/status" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref =
        push(socket, "user_message", %{"text" => "帮我创作角色设定", "generate_micro_plan" => true})

      assert_reply(ref, :ok, %{run_id: run_id, turn_id: turn_id}, @agent_run_timeout)
      assert_broadcast("turn_result", %{turn_id: ^turn_id} = result, @agent_run_timeout)

      assert result.turn_id != nil
      assert result.phase != nil
      assert result.status != nil
      assert_agent_run_stopped(run_id)
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

      assert {:reply, {:ok, %{received: true, action_status: "cancelled"}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-action-1",
                     "action_id" => "act-cancel",
                     "action_type" => "cancel_pending_behavior",
                     "target_ref" => "text_analysis",
                     "behavior_ref" => "bh-chan-1",
                     "idempotency_key" => "ik-cancel"
                   }
                 },
                 socket
               )

      assert_broadcast("action_result", %{
        action_id: "act-cancel",
        action_type: "cancel_pending_behavior",
        status: "cancelled"
      })

      assert_broadcast("turn_result", %{
        phase: "cancelled",
        status: "cancelled",
        behavior_state: %{
          active: nil,
          history: [
            %{
              behavior_id: "bh-chan-1",
              status: "CANCELLED",
              closed_at_turn_ref: closed_turn_ref,
              resolution_ref: resolution_ref
            }
          ]
        },
        truthfulness: %{tool_called: false, production_write_performed: false}
      })

      assert closed_turn_ref != nil
      assert resolution_ref == "behavior_resolution:#{closed_turn_ref}"
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

    test "author_action missing behavior_ref cannot close a server-scoped behavior" do
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
                     "action_id" => "act-cancel",
                     "action_type" => "cancel_pending_behavior",
                     "target_ref" => "text_analysis",
                     "idempotency_key" => "ik-cancel"
                   }
                 },
                 socket
               )

      assert String.contains?(reason, "behavior_ref")
      refute_broadcast("action_result", %{}, 20)
    end

    test "author_action idempotency key must match the server-scoped action" do
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
                     "action_id" => "act-cancel",
                     "action_type" => "cancel_pending_behavior",
                     "target_ref" => "text_analysis",
                     "behavior_ref" => "bh-chan-1",
                     "idempotency_key" => "other-key"
                   }
                 },
                 socket
               )

      assert String.contains?(reason, "idempotency_key")
      refute_broadcast("action_result", %{}, 20)
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

    test "confirmation dispatch broadcasts turn_result without synthetic task_state events" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @creative_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-action-1",
                     "action_id" => "act-confirm",
                     "action_type" => "confirm_before_execute",
                     # 前端提交确认时回传 available_action 的 target_ref/behavior_ref。
                     "target_ref" => "text_analysis",
                     "behavior_ref" => "bh-chan-1",
                     "idempotency_key" => "ik-confirm"
                   }
                 },
                 socket
               )

      assert_broadcast("turn_result", %{turn_id: turn_id})
      refute_broadcast("task_state", _payload, 20)
      assert socket.assigns.current_turn_id == turn_id
      assert Map.has_key?(socket.assigns.turn_results_by_id, turn_id)
    end

    test "duplicate confirmation with same idempotency key does not dispatch a second turn" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @creative_turn_result)

      action = %{
        "source_turn_ref" => "turn-action-1",
        "action_id" => "act-confirm",
        "action_type" => "confirm_before_execute",
        "target_ref" => "text_analysis",
        "behavior_ref" => "bh-chan-1",
        "idempotency_key" => "ik-confirm"
      }

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, socket} =
               WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

      assert_broadcast("turn_result", %{turn_id: first_dispatch_turn_id})

      assert {:reply, {:ok, %{received: true, action_status: "accepted", duplicate: true}},
              socket} =
               WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

      assert_broadcast("action_result", %{duplicate: true, idempotency_key: "ik-confirm"})
      refute_broadcast("turn_result", %{}, 50)
      assert socket.assigns.current_turn_id == first_dispatch_turn_id
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

    test "retained old confirmation turn is stale after current turn advances" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @server_turn_result)

      socket =
        assign_server_turn(socket, %{
          turn_id: "turn-action-2",
          frame_ref: "frame-chan-2",
          available_actions: [],
          assistant_message: %{text: "新的上下文已经生成"},
          truthfulness: %{
            tool_called: false,
            artifact_adopted: false,
            production_write_performed: false
          }
        })

      assert Map.has_key?(socket.assigns.turn_results_by_id, "turn-action-1")
      assert socket.assigns.current_turn_id == "turn-action-2"

      assert {:reply, {:error, %{reason: reason}}, socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-action-1",
                     "action_id" => "act-confirm",
                     "action_type" => "confirm_before_execute",
                     "target_ref" => "text_analysis",
                     "behavior_ref" => "bh-chan-1",
                     "idempotency_key" => "ik-confirm"
                   }
                 },
                 socket
               )

      assert String.contains?(reason, "stale")
      assert socket.assigns.current_turn_id == "turn-action-2"
      refute_broadcast("turn_result", %{}, 50)
    end

    test "current confirmation action is rejected after expires_at" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      expired_turn_result =
        put_in(
          @server_turn_result,
          [:available_actions, Access.at(0), :expires_at],
          "2000-01-01T00:00:00Z"
        )

      socket = assign_server_turn(socket, expired_turn_result)

      assert {:reply, {:error, %{reason: reason}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-action-1",
                     "action_id" => "act-confirm",
                     "action_type" => "confirm_before_execute",
                     "target_ref" => "text_analysis",
                     "behavior_ref" => "bh-chan-1",
                     "idempotency_key" => "ik-confirm"
                   }
                 },
                 socket
               )

      assert String.contains?(reason, "expired action")
      refute_broadcast("action_result", %{}, 20)
      refute_broadcast("turn_result", %{}, 50)
    end

    test "candidate adoption action goes through adoption boundary and broadcasts decision turn_result" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @candidate_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-candidates-1",
                     "action_id" => "choose_candidate:dir-1",
                     "action_type" => "choose_candidate",
                     "target_ref" => "dir-1",
                     "candidate_set_ref" => "candidate_set:turn-candidates-1",
                     "candidate_ref" => "dir-1",
                     "idempotency_key" => "idem:turn-candidates-1:choose_candidate:dir-1"
                   }
                 },
                 socket
               )

      assert_broadcast("action_result", %{
        action_type: "choose_candidate",
        candidate_ref: "dir-1",
        adoption_decision: %{decision_type: :adopt_tentative}
      })

      assert_broadcast("turn_result", result)
      assert result.parent_turn_id == "turn-candidates-1"
      assert result.truthfulness.candidate_selected == true
      assert result.truthfulness.candidate_adopted == true
      assert result.truthfulness.production_write_performed == false
      assert result.adoption_decision.decision_type == :adopt_tentative
      assert [%{card_type: "result_card", title: "已设为后续方向"}] = result.ui_cards
      assert socket.assigns.current_turn_id == result.turn_id
      assert Map.has_key?(socket.assigns.turn_results_by_id, result.turn_id)
    end

    test "high risk candidate adoption broadcasts confirmation result without production write" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      high_risk_turn_result =
        put_in(@candidate_turn_result, [:candidate_directions, Access.at(0), :risk_hint], :high)

      socket = assign_server_turn(socket, high_risk_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "needs_confirmation"}}, socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-candidates-1",
                     "action_id" => "choose_candidate:dir-1",
                     "action_type" => "choose_candidate",
                     "target_ref" => "dir-1",
                     "candidate_set_ref" => "candidate_set:turn-candidates-1",
                     "candidate_ref" => "dir-1",
                     "idempotency_key" => "idem:turn-candidates-1:choose_candidate:dir-1"
                   }
                 },
                 socket
               )

      assert_broadcast("action_result", %{
        action_type: "choose_candidate",
        candidate_ref: "dir-1",
        status: "needs_confirmation",
        adoption_decision: %{decision_type: :require_confirmation}
      })

      assert_broadcast("turn_result", result)
      assert result.parent_turn_id == "turn-candidates-1"
      assert result.status == "needs_confirmation"
      assert result.truthfulness.candidate_selected == true
      assert result.truthfulness.candidate_adopted == false
      assert result.truthfulness.production_write_performed == false
      assert "high_risk_candidate" in result.truthfulness.reason_codes
      assert [%{card_type: "result_card", title: "后续方向待确认"}] = result.ui_cards
      assert socket.assigns.current_turn_id == result.turn_id
    end

    test "stale candidate adoption broadcasts rejection result without production write" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      stale_turn_result =
        @candidate_turn_result
        |> put_in([:candidate_directions, Access.at(0), :risk_hint], :low)
        |> Map.put(:candidate_set_stability, "stale")

      socket = assign_server_turn(socket, stale_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "rejected"}}, socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-candidates-1",
                     "action_id" => "choose_candidate:dir-1",
                     "action_type" => "choose_candidate",
                     "target_ref" => "dir-1",
                     "candidate_set_ref" => "candidate_set:turn-candidates-1",
                     "candidate_ref" => "dir-1",
                     "idempotency_key" => "idem:turn-candidates-1:choose_candidate:dir-1"
                   }
                 },
                 socket
               )

      assert_broadcast("action_result", %{
        action_type: "choose_candidate",
        candidate_ref: "dir-1",
        status: "rejected",
        adoption_decision: %{decision_type: :reject}
      })

      assert_broadcast("turn_result", result)
      assert result.parent_turn_id == "turn-candidates-1"
      assert result.status == "cancelled"
      assert result.truthfulness.candidate_selected == true
      assert result.truthfulness.candidate_adopted == false
      assert result.truthfulness.production_write_performed == false
      assert "source_turn_stale" in result.truthfulness.reason_codes
      assert [%{card_type: "result_card", title: "后续方向未设置"}] = result.ui_cards
      assert socket.assigns.current_turn_id == result.turn_id
    end

    test "cross-work candidate adoption broadcasts recovery failure without production write" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      cross_work_turn_result =
        @candidate_turn_result
        |> put_in([:candidate_directions, Access.at(0), :risk_hint], :low)
        |> put_in([:candidate_directions, Access.at(0), :work_id], "foreign-work")
        |> Map.put(:work_id, "foreign-work")

      socket = assign_server_turn(socket, cross_work_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "failed"}}, socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-candidates-1",
                     "action_id" => "choose_candidate:dir-1",
                     "action_type" => "choose_candidate",
                     "target_ref" => "dir-1",
                     "candidate_set_ref" => "candidate_set:turn-candidates-1",
                     "candidate_ref" => "dir-1",
                     "idempotency_key" => "idem:turn-candidates-1:choose_candidate:dir-1"
                   }
                 },
                 socket
               )

      assert_broadcast("action_result", %{
        action_type: "choose_candidate",
        candidate_ref: "dir-1",
        status: "failed",
        adoption_decision: %{decision_type: :fail_with_recovery}
      })

      assert_broadcast("turn_result", result)
      assert result.parent_turn_id == "turn-candidates-1"
      assert result.status == "failed"
      assert result.truthfulness.candidate_selected == true
      assert result.truthfulness.candidate_adopted == false
      assert result.truthfulness.production_write_performed == false
      assert "work_id_mismatch" in result.truthfulness.reason_codes
      assert [%{card_type: "result_card", title: "后续方向设置失败"}] = result.ui_cards
      assert socket.assigns.current_turn_id == result.turn_id
    end

    test "canon conflict candidate adoption broadcasts recovery failure without production write" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      canon_conflict_turn_result =
        @candidate_turn_result
        |> put_in([:candidate_directions, Access.at(0), :risk_hint], :low)
        |> put_in(
          [:candidate_directions, Access.at(0), :adoption_target_ref],
          "canon:role:lin-jin:age"
        )
        |> put_in([:candidate_directions, Access.at(0), :canon_conflicts], [
          %{
            target_ref: "canon:role:lin-jin:age",
            current_value: "林烬十七岁",
            proposed_value: "林烬三十二岁",
            canon_revision: 7
          }
        ])

      socket = assign_server_turn(socket, canon_conflict_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "failed"}}, socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "source_turn_ref" => "turn-candidates-1",
                     "action_id" => "choose_candidate:dir-1",
                     "action_type" => "choose_candidate",
                     "target_ref" => "dir-1",
                     "candidate_set_ref" => "candidate_set:turn-candidates-1",
                     "candidate_ref" => "dir-1",
                     "idempotency_key" => "idem:turn-candidates-1:choose_candidate:dir-1"
                   }
                 },
                 socket
               )

      assert_broadcast("action_result", %{
        action_type: "choose_candidate",
        candidate_ref: "dir-1",
        status: "failed",
        adoption_decision: %{decision_type: :fail_with_recovery}
      })

      assert_broadcast("turn_result", result)
      assert result.parent_turn_id == "turn-candidates-1"
      assert result.status == "failed"
      assert result.truthfulness.candidate_selected == true
      assert result.truthfulness.candidate_adopted == false
      assert result.truthfulness.production_write_performed == false
      assert "canon_conflict_detected" in result.truthfulness.reason_codes
      assert "conflict_recovery_required" in result.truthfulness.reason_codes
      assert [%{card_type: "result_card", title: "后续方向设置失败"}] = result.ui_cards
      assert socket.assigns.current_turn_id == result.turn_id
    end
  end

  describe "artifact adoption roundtrip" do
    test "adopt event goes through backend adoption boundary and broadcasts resolved turn_result" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @pending_adoption_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, socket} =
               WorkspaceChannel.handle_in(
                 "adopt",
                 %{
                   "artifact_id" => "as-adopt-1",
                   "artifact_type" => "character_seed",
                   "payload" => %{"title" => "角色设定"}
                 },
                 socket
               )

      assert_broadcast("action_result", %{
        action_type: "adopt",
        status: "accepted",
        artifact_id: "as-adopt-1",
        decision: %{decision_type: :adopt_tentative}
      })

      assert_broadcast("turn_result", %{
        parent_turn_id: "turn-adopt-source",
        adoption_state: %{
          pending: [],
          resolved: [
            %{
              artifact_id: "as-adopt-1",
              adoption_status: "ACCEPTED",
              requires_adoption: false
            }
          ]
        },
        projection_refs: [],
        truthfulness: %{artifact_adopted: true, production_write_performed: false}
      })

      assert socket.assigns.current_turn_id != "turn-adopt-source"
      assert Map.has_key?(socket.assigns.turn_results_by_id, socket.assigns.current_turn_id)
    end

    test "accept author_action routes through adoption boundary and broadcasts resolved turn_result" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      source_turn =
        Map.put(@pending_adoption_turn_result, :available_actions, [
          %{
            action_id: "accept:as-adopt-1",
            action_type: "accept",
            target_ref: "as-adopt-1",
            enabled: true
          }
        ])

      socket = assign_server_turn(socket, source_turn)

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "action_id" => "accept:as-adopt-1",
                     "action_type" => "accept",
                     "target_ref" => "as-adopt-1",
                     "source_turn_ref" => "turn-adopt-source"
                   }
                 },
                 socket
               )

      assert_broadcast("action_result", %{
        action_type: "adopt",
        status: "accepted",
        artifact_id: "as-adopt-1",
        decision: %{decision_type: :adopt_tentative}
      })

      assert_broadcast("turn_result", %{
        parent_turn_id: "turn-adopt-source",
        adoption_state: %{
          pending: [],
          resolved: [%{artifact_id: "as-adopt-1", adoption_status: "ACCEPTED"}]
        },
        truthfulness: %{artifact_adopted: true, production_write_performed: false}
      })
    end

    test "accept author_action rejects an invented action not in available actions" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      # @pending_adoption_turn_result has available_actions: [] → accept is invented here
      socket = assign_server_turn(socket, @pending_adoption_turn_result)

      assert {:reply, {:error, %{reason: reason}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "action_id" => "accept:as-adopt-1",
                     "action_type" => "accept",
                     "target_ref" => "as-adopt-1",
                     "source_turn_ref" => "turn-adopt-source"
                   }
                 },
                 socket
               )

      assert String.contains?(reason, "invented action")
    end

    test "edit_then_accept author_action adopts the author-edited content" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      source_turn =
        Map.put(@pending_adoption_turn_result, :available_actions, [
          %{
            action_id: "edit:as-adopt-1",
            action_type: "edit_then_accept",
            target_ref: "as-adopt-1",
            enabled: true
          }
        ])

      socket = assign_server_turn(socket, source_turn)

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "action_id" => "edit:as-adopt-1",
                     "action_type" => "edit_then_accept",
                     "target_ref" => "as-adopt-1",
                     "source_turn_ref" => "turn-adopt-source",
                     "payload" => %{"edited_content" => "作者改写后的正文"}
                   }
                 },
                 socket
               )

      assert_broadcast("turn_result", %{
        parent_turn_id: "turn-adopt-source",
        adoption_state: %{
          resolved: [%{artifact_id: "as-adopt-1", adoption_status: "EDITED_ACCEPTED"}]
        },
        truthfulness: %{artifact_adopted: true}
      })
    end

    test "confirm_before_execute on a pending artifact re-gates adoption and adopts" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      source_turn =
        Map.put(@pending_adoption_turn_result, :available_actions, [
          %{
            action_id: "confirm:as-adopt-1",
            action_type: "confirm_before_execute",
            target_ref: "as-adopt-1",
            behavior_ref: "bh_confirm_as-adopt-1",
            enabled: true
          }
        ])

      socket = assign_server_turn(socket, source_turn)

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "action_id" => "confirm:as-adopt-1",
                     "action_type" => "confirm_before_execute",
                     "target_ref" => "as-adopt-1",
                     "source_turn_ref" => "turn-adopt-source",
                     "behavior_ref" => "bh_confirm_as-adopt-1"
                   }
                 },
                 socket
               )

      assert_broadcast("turn_result", %{
        adoption_state: %{resolved: [%{artifact_id: "as-adopt-1", adoption_status: "ACCEPTED"}]},
        behavior_state: %{
          active: nil,
          history: [
            %{
              behavior_id: "bh_confirm_as-adopt-1",
              status: "RESOLVED",
              closed_at_turn_ref: closed_turn_ref,
              resolution_ref: resolution_ref
            }
          ]
        },
        truthfulness: %{artifact_adopted: true}
      })

      assert closed_turn_ref != nil
      assert resolution_ref == "behavior_resolution:#{closed_turn_ref}"
    end

    test "reject_or_cancel_confirmation closes the confirmation without writing" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      source_turn =
        Map.put(@pending_adoption_turn_result, :available_actions, [
          %{
            action_id: "reject:as-adopt-1",
            action_type: "reject_or_cancel_confirmation",
            target_ref: "as-adopt-1",
            behavior_ref: "bh_confirm_as-adopt-1",
            enabled: true
          }
        ])

      socket = assign_server_turn(socket, source_turn)

      assert {:reply, {:ok, %{received: true, action_status: "cancelled"}}, _socket} =
               WorkspaceChannel.handle_in(
                 "author_action",
                 %{
                   "action" => %{
                     "action_id" => "reject:as-adopt-1",
                     "action_type" => "reject_or_cancel_confirmation",
                     "target_ref" => "as-adopt-1",
                     "source_turn_ref" => "turn-adopt-source",
                     "behavior_ref" => "bh_confirm_as-adopt-1"
                   }
                 },
                 socket
               )

      assert_broadcast("turn_result", %{
        phase: "cancelled",
        behavior_state: %{
          active: nil,
          history: [
            %{
              behavior_id: "bh_confirm_as-adopt-1",
              status: "CANCELLED",
              closed_at_turn_ref: closed_turn_ref,
              resolution_ref: resolution_ref
            }
          ]
        },
        truthfulness: %{artifact_adopted: false, production_write_performed: false}
      })

      assert closed_turn_ref != nil
      assert resolution_ref == "behavior_resolution:#{closed_turn_ref}"
    end

    test "adopt event rejects invented artifact that is not pending on server turn" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @pending_adoption_turn_result)

      assert {:reply, {:error, %{reason: "pending artifact not found"}}, _socket} =
               WorkspaceChannel.handle_in(
                 "adopt",
                 %{"artifact_id" => "invented-artifact"},
                 socket
               )
    end

    test "adopt event rejects pending artifact from another work" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:work-b")

      source_turn =
        @pending_adoption_turn_result
        |> Map.put(:work_id, "work-a")
        |> put_in([:adoption_state, :pending], [
          %{
            artifact_id: "as-adopt-1",
            artifact_type: :character_seed,
            adoption_status: :tentative,
            requires_adoption: true,
            source_tool_result_ref: "tr-adopt-1",
            work_id: "work-a",
            payload: %{title: "角色设定", content: "主角更果断"}
          }
        ])

      socket = assign_server_turn(socket, source_turn)

      assert {:reply, {:error, %{reason: "cross-work adoption rejected"}}, _socket} =
               WorkspaceChannel.handle_in(
                 "adopt",
                 %{
                   "artifact_id" => "as-adopt-1",
                   "artifact_type" => "character_seed",
                   "payload" => %{"title" => "角色设定"}
                 },
                 socket
               )
    end

    test "adopt event finds restored pending artifact when current turn is an action turn" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket =
        socket
        |> assign_server_turn(@pending_adoption_turn_result)
        |> assign_server_turn(%{
          turn_id: "turn_adopt_21",
          adoption_state: %{
            pending: [],
            resolved: [
              %{
                artifact_id: "other-artifact",
                artifact_type: "character_seed",
                adoption_status: "ACCEPTED",
                requires_adoption: false
              }
            ]
          }
        })

      assert socket.assigns.current_turn_id == "turn_adopt_21"

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, _socket} =
               WorkspaceChannel.handle_in(
                 "adopt",
                 %{
                   "artifact_id" => "as-adopt-1",
                   "artifact_type" => "character_seed",
                   "payload" => %{"title" => "角色设定"}
                 },
                 socket
               )

      assert_broadcast("turn_result", %{
        parent_turn_id: "turn-adopt-source",
        adoption_state: %{
          resolved: [
            %{
              artifact_id: "as-adopt-1",
              adoption_status: "ACCEPTED"
            }
          ]
        }
      })
    end

    test "artifact actions reject a pending source turn after the artifact is resolved" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @pending_adoption_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, socket} =
               WorkspaceChannel.handle_in(
                 "adopt",
                 %{
                   "artifact_id" => "as-adopt-1",
                   "artifact_type" => "character_seed",
                   "source_turn_ref" => "turn-adopt-source",
                   "payload" => %{"title" => "角色设定"}
                 },
                 socket
               )

      assert {:reply, {:error, %{reason: "artifact already resolved"}}, ^socket} =
               WorkspaceChannel.handle_in(
                 "discard",
                 %{
                   "artifact_id" => "as-adopt-1",
                   "artifact_type" => "character_seed",
                   "source_turn_ref" => "turn-adopt-source"
                 },
                 socket
               )

      assert {:reply, {:error, %{reason: "artifact already resolved"}}, ^socket} =
               WorkspaceChannel.handle_in(
                 "modify_draft",
                 %{
                   "draft_id" => "as-adopt-1",
                   "artifact_type" => "character_seed",
                   "content" => "主角更果断",
                   "instruction" => "增加保护同伴的动机",
                   "source_turn_ref" => "turn-adopt-source"
                 },
                 socket
               )
    end

    test "discard event resolves pending artifact without crashing channel" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @pending_adoption_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "discarded"}}, socket} =
               WorkspaceChannel.handle_in(
                 "discard",
                 %{
                   "artifact_id" => "as-adopt-1",
                   "artifact_type" => "character_seed",
                   "source_turn_ref" => "turn-adopt-source"
                 },
                 socket
               )

      assert_broadcast("action_result", %{
        action_type: "discard",
        status: "discarded",
        artifact_id: "as-adopt-1"
      })

      assert_broadcast("turn_result", %{
        parent_turn_id: "turn-adopt-source",
        adoption_state: %{
          pending: [],
          resolved: [
            %{
              artifact_id: "as-adopt-1",
              adoption_status: "DISCARDED",
              requires_adoption: false
            }
          ]
        },
        projection_refs: [],
        truthfulness: %{artifact_adopted: false, production_write_performed: false}
      })

      assert socket.assigns.current_turn_id != "turn-adopt-source"
      assert Map.has_key?(socket.assigns.turn_results_by_id, socket.assigns.current_turn_id)
    end

    test "modify_draft event resolves pending artifact as edited acceptance" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      socket = assign_server_turn(socket, @pending_adoption_turn_result)

      assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, socket} =
               WorkspaceChannel.handle_in(
                 "modify_draft",
                 %{
                   "draft_id" => "as-adopt-1",
                   "artifact_type" => "character_seed",
                   "content" => "主角更果断",
                   "instruction" => "增加保护同伴的动机",
                   "source_turn_ref" => "turn-adopt-source"
                 },
                 socket
               )

      assert_broadcast("action_result", %{
        action_type: "modify_draft",
        status: "accepted",
        artifact_id: "as-adopt-1"
      })

      assert_broadcast("turn_result", %{
        parent_turn_id: "turn-adopt-source",
        adoption_state: %{
          pending: [],
          resolved: [
            %{
              artifact_id: "as-adopt-1",
              adoption_status: "EDITED_ACCEPTED",
              requires_adoption: false
            }
          ]
        },
        projection_refs: [],
        truthfulness: %{artifact_adopted: true, production_write_performed: false}
      })

      assert socket.assigns.current_turn_id != "turn-adopt-source"
      assert Map.has_key?(socket.assigns.turn_results_by_id, socket.assigns.current_turn_id)
    end
  end

  describe "reading mode data handlers" do
    test "get_toc returns an empty real projection for lobby instead of mock content" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref = push(socket, "get_toc", %{"work_id" => "lobby"})

      assert_reply(ref, :ok, %{work_id: "lobby", volumes: [], audit: audit}, @agent_run_timeout)
      assert audit.stage == :p1
      assert audit.min_chapter_words == 1_000
      assert audit.total_target == 100_000
      assert audit.chapter_count == 0
      assert audit.meets_threshold == false
    end

    test "get_chapter_content rejects missing chapter instead of relying on mock content" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref = push(socket, "get_chapter_content", %{"chapter_id" => "missing"})

      assert_reply(ref, :error, %{reason: "chapter not found"})
    end
  end

  describe "structure panel data handlers" do
    test "placeholder archive reads return empty data instead of fixed examples" do
      {:ok, _, socket} =
        UserSocket
        |> socket("user_id", %{})
        |> subscribe_and_join(WorkspaceChannel, "workspace:lobby")

      ref = push(socket, "get_characters", %{"work_id" => "lobby"})
      assert_reply(ref, :ok, [])

      ref = push(socket, "get_foreshadowing", %{"work_id" => "lobby"})
      assert_reply(ref, :ok, [])

      ref = push(socket, "get_rules", %{"work_id" => "lobby"})
      assert_reply(ref, :ok, [])

      ref = push(socket, "get_work_stats", %{"work_id" => "lobby"})
      assert_reply(ref, :ok, %{characters: 0, memory_items: 0, drafts_total: 0})
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
    turn_results = Map.put(socket.assigns[:turn_results_by_id] || %{}, turn_id, turn_result)

    socket
    |> Phoenix.Socket.assign(:current_turn_id, turn_id)
    |> Phoenix.Socket.assign(:turn_results_by_id, turn_results)
  end

  defp pump_agent_events_until_turn_result(socket, turn_id) do
    deadline = System.monotonic_time(:millisecond) + @agent_run_timeout
    do_pump_agent_events_until_turn_result(socket, turn_id, deadline)
  end

  defp do_pump_agent_events_until_turn_result(socket, turn_id, deadline) do
    remaining = max(deadline - System.monotonic_time(:millisecond), 0)

    receive do
      {:agent_event, event} ->
        {:noreply, socket} = WorkspaceChannel.handle_info({:agent_event, event}, socket)

        if agent_event_turn_id(event) == turn_id do
          socket
        else
          do_pump_agent_events_until_turn_result(socket, turn_id, deadline)
        end
    after
      remaining ->
        flunk("expected AgentRun event stream to emit turn_result #{turn_id}")
    end
  end

  defp agent_event_turn_id(%{payload: payload}) when is_map(payload) do
    case Map.get(payload, :turn_result) || Map.get(payload, "turn_result") do
      %{turn_id: turn_id} -> turn_id
      %{"turn_id" => turn_id} -> turn_id
      _ -> nil
    end
  end

  defp agent_event_turn_id(_event), do: nil

  defp pump_agent_events_until_stopped(socket, run_id) do
    deadline = System.monotonic_time(:millisecond) + @agent_run_timeout
    do_pump_agent_events_until_stopped(socket, run_id, deadline)
  end

  defp do_pump_agent_events_until_stopped(socket, run_id, deadline) do
    remaining = max(deadline - System.monotonic_time(:millisecond), 0)

    receive do
      {:agent_event, event} ->
        {:noreply, socket} = WorkspaceChannel.handle_info({:agent_event, event}, socket)

        if agent_event_stopped?(event, run_id) do
          socket
        else
          do_pump_agent_events_until_stopped(socket, run_id, deadline)
        end
    after
      remaining ->
        flunk("expected AgentRun #{run_id} to stop before the test exits")
    end
  end

  defp agent_event_stopped?(%{run_ref: run_id, event_type: event_type}, run_id),
    do: Atom.to_string(event_type) in @agent_run_stopped_events

  defp agent_event_stopped?(_event, _run_id), do: false

  defp assert_agent_run_stopped(run_id) do
    deadline = System.monotonic_time(:millisecond) + @agent_run_timeout
    do_assert_agent_run_stopped(run_id, deadline)
  end

  defp do_assert_agent_run_stopped(run_id, deadline) do
    remaining = max(deadline - System.monotonic_time(:millisecond), 0)

    receive do
      %Phoenix.Socket.Broadcast{
        event: "agent_event",
        payload: %{run_id: ^run_id, event_type: event_type}
      }
      when event_type in @agent_run_stopped_events ->
        :ok

      %Phoenix.Socket.Message{
        event: "agent_event",
        payload: %{run_id: ^run_id, event_type: event_type}
      }
      when event_type in @agent_run_stopped_events ->
        :ok

      %Phoenix.Socket.Broadcast{
        event: "agent_run_state",
        payload: %{run_id: ^run_id, status: status}
      } ->
        if status in ["completed", "awaiting_author", "failed", "cancelled"] do
          :ok
        else
          do_assert_agent_run_stopped(run_id, deadline)
        end

      %Phoenix.Socket.Message{
        event: "agent_run_state",
        payload: %{run_id: ^run_id, status: status}
      } ->
        if status in ["completed", "awaiting_author", "failed", "cancelled"] do
          :ok
        else
          do_assert_agent_run_stopped(run_id, deadline)
        end

      _other ->
        do_assert_agent_run_stopped(run_id, deadline)
    after
      remaining ->
        flunk("expected AgentRun #{run_id} to stop before the test exits")
    end
  end
end
