defmodule NovelWeb.WorkspaceChannelActionIdempotencyTest do
  use ExUnit.Case, async: false

  import ExUnit.CaptureLog
  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelApplication.WorkSessionService
  alias NovelPersistence.Repo
  alias NovelPersistence.TraceRepository
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

  test "confirmation re-gate consumes latest work snapshot after work rename" do
    {:ok, work} =
      WorkService.create(%{
        "title" => "AU04 latest context source",
        "genre" => "赛博修仙",
        "core_selling_point" => "确认前上下文变化必须被重新读取"
      })

    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{"work_id" => work.id})

    source_turn =
      @creative_turn_result
      |> Map.put(:turn_id, "turn-action-rebase-1")
      |> Map.put(:frame_ref, "frame-action-rebase-1")
      |> Map.put(:work_id, work.id)
      |> Map.put(:session_id, session_id)
      |> Map.put(:workspace_id, work.id)
      |> Map.put(:available_actions, [
        %{
          action_id: "act-confirm-rebase",
          action_type: "confirm_before_execute",
          behavior_ref: "bh-rebase-1",
          target_ref: "character_design",
          enabled: true,
          idempotency_key: "ik-confirm-rebase"
        }
      ])
      |> Map.put(:plan, %{
        @creative_turn_result.plan
        | plan_id: "plan-action-rebase-1",
          turn_id: "turn-action-rebase-1",
          frame_ref: "frame-action-rebase-1",
          plan_goal: %{summary: "latest context rebase test plan"}
      })

    socket = assign_server_turn(socket, source_turn)

    renamed_title = "AU04 latest context renamed"

    assert {:ok, renamed_work} =
             WorkService.rename(work.id, %{
               "title" => renamed_title,
               "revision" => work.revision
             })

    assert renamed_work.revision > work.revision

    action = %{
      "source_turn_ref" => "turn-action-rebase-1",
      "action_id" => "act-confirm-rebase",
      "action_type" => "confirm_before_execute",
      "target_ref" => "character_design",
      "behavior_ref" => "bh-rebase-1",
      "idempotency_key" => "ik-confirm-rebase"
    }

    log =
      capture_log(fn ->
        assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, _socket} =
                 WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)
      end)

    refute log =~ "channel.persist_trace | 失败"

    assert_broadcast("action_result", %{confirmation_binding: binding})

    assert binding.rebased_state_snapshot_ref =~ "state_snapshot:#{work.id}:#{session_id}"
    assert binding.rebased_state_snapshot_ref =~ "revision:#{renamed_work.revision}"
    assert binding.rebased_state_snapshot_ref =~ "turn-action-rebase-1"
    assert binding.rebased_state_snapshot_ref =~ "plan-action-rebase-1"

    assert binding.gate_result_refs == [
             "gate_result:confirmation_re_gate:turn-action-rebase-1:plan-action-rebase-1:act-confirm-rebase"
           ]

    assert_broadcast("turn_result", turn_result)

    assert Enum.any?(
             turn_result.trace_summary.context_refs,
             &(&1.source_type == :current_work and String.contains?(&1.summary, renamed_title))
           )

    assert Enum.any?(
             turn_result.truthfulness.reason_codes,
             &(&1 == "rebased_state_snapshot:#{binding.rebased_state_snapshot_ref}")
           )
  end

  test "persisted adoption action records state trace refs for replay" do
    {:ok, work} =
      WorkService.create(%{
        "title" => "AU07 state trace work",
        "genre" => "悬疑",
        "core_selling_point" => "采纳状态变更必须可回放"
      })

    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session_id
      })

    source_turn = %{
      turn_id: "turn-au07-state-source",
      frame_ref: "frame-au07-state-source",
      work_id: work.id,
      trace_summary: %{trace_ref: "trace-au07-state-source"},
      available_actions: [
        %{
          action_id: "accept:as-au07-state-1",
          action_type: "accept",
          target_ref: "as-au07-state-1",
          enabled: true
        }
      ],
      adoption_state: %{
        pending: [
          %{
            artifact_id: "as-au07-state-1",
            artifact_type: :prose_fragment,
            adoption_status: :tentative,
            requires_adoption: true,
            source_tool_result_ref: "tool-result-au07-state",
            work_id: work.id,
            payload: %{
              title: "第01章：雨夜",
              items: [
                %{
                  title: "第01章：雨夜",
                  body: "雨夜里，旧钟楼的灯忽明忽暗。"
                }
              ]
            }
          }
        ],
        resolved: []
      }
    }

    socket = assign_server_turn(socket, source_turn)

    assert {:reply, {:ok, %{received: true, action_status: "accepted"}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{
                 "action" => %{
                   "action_id" => "accept:as-au07-state-1",
                   "action_type" => "accept",
                   "target_ref" => "as-au07-state-1",
                   "source_turn_ref" => "turn-au07-state-source"
                 }
               },
               socket
             )

    assert_broadcast("turn_result", %{
      turn_id: adopt_turn_id,
      trace_summary: %{
        trace_ref: trace_ref,
        state_trace_refs: [%{state_trace_ref: state_trace_ref}]
      },
      adoption_state: %{
        resolved: [%{state_trace_ref: state_trace_ref}]
      },
      projection_refs: [%{source_state_trace_ref: state_trace_ref}],
      truthfulness: %{artifact_adopted: true, production_write_performed: true}
    })

    assert trace_ref == "trace:#{adopt_turn_id}"

    assert [trace_record] = TraceRepository.list_by_turn(adopt_turn_id)
    assert trace_record.trace_id == trace_ref
    assert trace_record.decision_type == "adopt_tentative"
    assert [%{"state_trace_ref" => ^state_trace_ref}] = trace_record.state_trace_refs
    assert "state_trace_recorded" in trace_record.event_order
    assert "projection_hint_emitted" in trace_record.event_order
  end

  test "persisted cancel waiting action records terminal behavior trace refs for replay" do
    {:ok, work} =
      WorkService.create(%{
        "title" => "AU07 behavior trace work",
        "genre" => "悬疑",
        "core_selling_point" => "行为终态必须可回放"
      })

    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session_id
      })

    source_turn = %{
      turn_id: "turn-au07-behavior-open",
      frame_ref: "frame-au07-behavior-open",
      work_id: work.id,
      workspace_id: work.id,
      session_id: session_id,
      trace_summary: %{trace_ref: "trace-au07-behavior-open"},
      available_actions: [
        %{
          action_id: "act-cancel-au07-behavior",
          action_type: "reject_or_cancel_confirmation",
          target_ref: "prose_writing",
          behavior_ref: "bh-au07-behavior",
          idempotency_key: "ik-cancel-au07-behavior",
          enabled: true
        }
      ],
      behavior_state: %{
        active: %{
          behavior_id: "bh-au07-behavior",
          behavior_type: "confirmation",
          opened_at_turn_ref: "turn-au07-behavior-open",
          opened_by_decision_ref: "decision-au07-behavior-open",
          frame_ref: "frame-au07-behavior-open",
          plan_ref: "plan-au07-behavior-open",
          target_ref: "prose_writing",
          required_next_action: "confirm_before_execute",
          prompt_contract: %{},
          constraints: %{},
          trace_ref: "trace-au07-behavior-open"
        },
        history: []
      }
    }

    socket = assign_server_turn(socket, source_turn)

    assert {:reply, {:ok, %{received: true, action_status: "cancelled"}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{
                 "action" => %{
                   "source_turn_ref" => "turn-au07-behavior-open",
                   "action_id" => "act-cancel-au07-behavior",
                   "action_type" => "reject_or_cancel_confirmation",
                   "target_ref" => "prose_writing",
                   "behavior_ref" => "bh-au07-behavior",
                   "idempotency_key" => "ik-cancel-au07-behavior"
                 }
               },
               socket
             )

    assert_broadcast("turn_result", %{
      turn_id: cancel_turn_id,
      trace_summary: %{
        trace_ref: trace_ref,
        behavior_trace_refs: [
          %{
            behavior_ref: "bh-au07-behavior",
            event_type: :close,
            event_turn_ref: cancel_turn_id,
            resolution_ref: resolution_ref
          }
        ]
      },
      behavior_state: %{
        active: nil,
        history: [%{resolution_ref: resolution_ref}]
      },
      truthfulness: %{tool_called: false, production_write_performed: false}
    })

    assert trace_ref == "trace:#{cancel_turn_id}"
    assert resolution_ref == "behavior_resolution:#{cancel_turn_id}"

    assert [trace_record] = TraceRepository.list_by_turn(cancel_turn_id)
    assert trace_record.trace_id == trace_ref
    assert trace_record.decision_type == "cancel_waiting"

    assert [
             %{
               "behavior_ref" => "bh-au07-behavior",
               "event_type" => "close",
               "event_turn_ref" => ^cancel_turn_id,
               "resolution_ref" => ^resolution_ref,
               "next_status" => "CANCELLED"
             }
           ] = trace_record.behavior_trace_refs

    assert "behavior_trace_recorded" in trace_record.event_order
    assert "behavior_resolution_recorded" in trace_record.event_order
  end

  defp assign_server_turn(socket, %{turn_id: turn_id} = turn_result) do
    turn_results = Map.put(socket.assigns[:turn_results_by_id] || %{}, turn_id, turn_result)

    socket
    |> Phoenix.Socket.assign(:current_turn_id, turn_id)
    |> Phoenix.Socket.assign(:turn_results_by_id, turn_results)
  end
end
