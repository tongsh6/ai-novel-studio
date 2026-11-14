defmodule NovelWeb.WorkspaceChannelActionIdempotencyTest do
  use NovelPersistence.DataCase, async: false

  import Phoenix.ChannelTest

  alias NovelApplication.{WorkService, WorkSessionService}
  alias NovelPersistence.{AgentRunLog, InteractionLifecycle, WorkSessionRepo}
  alias NovelPersistence.Schemas.AuthorActionReceipt
  alias NovelPersistence.TraceRepository
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint

  @author_text "把陆沉舟的人物设定改得更像一个底层散修，保持为待采纳草稿。"

  setup do
    previous = Application.fetch_env(:novel_web, :persistence)
    previous_facts = Application.fetch_env(:novel_application, :agent_run_fact_persistence_enabled)

    Application.put_env(
      :novel_web,
      :persistence,
      Keyword.put(prior_persistence(previous), :inject_real_persistence, true)
    )

    Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, true)

    # 确认交接会启动真实 child AgentRun；每个成功 ACK/receipt 在用例内立即登记，
    # 其 on_exit 晚执行，先收口 run/caller 再恢复配置与 Sandbox owner。
    on_exit(fn ->
      restore_persistence(previous)
      restore_fact_persistence(previous_facts)
    end)
  end

  test "persisted idempotency receipt suppresses duplicate dispatch after channel memory is empty" do
    {work, session_id, socket} = create_work_and_socket("B71 idempotent duplicate")
    source = seed_confirmation_source(work.id, session_id)
    action = action_params(source, source.confirm)

    assert {:reply, {:ok, %{received: true}}, socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    NovelApplication.TestAgentRunCleanup.register_run(receipt.result["run_id"])
    # B58 CP2：确认动作的 approval 投影随 receipt 持久化；缺失字段不伪造。
    assert receipt.result["approval_policy_ref"] == "approval_policy.long_run_budget_gate"
    assert receipt.result["risk_class"] == "HIGH"
    assert receipt.result["decision"] == "CONFIRMED"
    assert receipt.result["decided_by"] == "author"
    assert receipt.result["target_type"] == nil

    # VS-00L §16.14：首次受理必须向 topic 广播本次已提交的作者决定结果（新事实）。
    decision_turn_id = receive_broadcast("turn_result", 10_000) |> payload_turn_id()
    assert decision_turn_id == receipt.result["turn_id"]
    refute decision_turn_id == source.turn_id

    socket = Phoenix.Socket.assign(socket, :action_idempotency_ledger, %{})
    subscriptions_before = subscription_count(work.id, session_id)

    assert {:reply, {:ok, %{received: true, duplicate: true} = duplicate_ack}, _socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    assert subscription_count(work.id, session_id) == subscriptions_before

    expected_key = source.confirm["idempotency_key"]

    assert_broadcast("action_result", %{
      duplicate: true,
      idempotency_key: ^expected_key
    })

    # 重传只回查同一 receipt/run：不新增 topic turn_result 广播，已提交结果只经
    # 回执 facts 回放（前端重连回放另有 join 路径）。
    refute_broadcast("turn_result", %{}, 50)

    assert duplicate_ack.run_id == receipt.result["run_id"]
    assert Enum.any?(duplicate_ack.turn_results, &(payload_turn_id(&1) == decision_turn_id))

    assert Repo.aggregate(AuthorActionReceipt, :count, :behavior_ref) == 1

    assert length(AgentRunLog.list_by_parent_turn(work.id, session_id, source.turn_id)) == 1
  end

  test "persisted same key different payload is rejected without second dispatch" do
    {work, session_id, socket} = create_work_and_socket("B71 idempotent conflict")
    source = seed_confirmation_source(work.id, session_id)

    action =
      Map.put(action_params(source, source.confirm), "payload", %{"edited_content" => "第一次提交"})

    assert {:reply, {:ok, %{received: true}}, socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    NovelApplication.TestAgentRunCleanup.register_run(receipt.result["run_id"])

    changed = Map.put(action, "payload", %{"edited_content" => "同键异内容"})

    assert {:reply, {:error, %{reason: :idempotency_payload_conflict}}, _socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => changed}, socket)

    assert Repo.aggregate(AuthorActionReceipt, :count, :behavior_ref) == 1
  end

  test "confirmation re-gate consumes latest work snapshot after work rename" do
    {work, session_id, socket} = create_work_and_socket("B71 latest context source")
    source = seed_confirmation_source(work.id, session_id)
    action = action_params(source, source.confirm)

    renamed_title = "B71 latest context renamed"

    assert {:ok, renamed_work} =
             WorkService.rename(work.id, %{
               "title" => renamed_title,
               "revision" => work.revision
             })

    assert renamed_work.revision > work.revision

    assert {:reply, {:ok, %{received: true}}, _socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    # 第一个 turn_result 是受理时提交的作者决定；第二个是 child 重新组装上下文并
    # 执行 writer 后提交的真实结果。
    decision_turn_id = receive_broadcast("turn_result", 10_000) |> payload_turn_id()
    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    NovelApplication.TestAgentRunCleanup.register_run(receipt.result["run_id"])
    creative = await_creative_result(receipt.result["run_id"], work.id, session_id)

    assert creative["turn_id"] != decision_turn_id

    assert Enum.any?(
             creative["trace_summary"]["context_refs"],
             &(&1["source_type"] == "current_work" and
                 String.contains?(&1["summary"], renamed_title))
           )

    binding = creative["trace_summary"]["confirmation_binding"]
    assert binding["behavior_ref"] == source.behavior_id
    assert binding["rebased_state_snapshot_ref"] =~ "state_snapshot"

    assert Enum.any?(
             creative["truthfulness"]["reason_codes"],
             &String.starts_with?(&1, "rebased_state_snapshot:")
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

    NovelApplication.TestAgentRunCleanup.register_task_caller(socket.channel_pid)

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
            adoption_status: "TENTATIVE",
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

    {:ok, _} =
      NovelPersistence.MemoryLog.record(%{
        workspace_id: work.id,
        session_id: session_id,
        turn_id: source_turn.turn_id,
        role: "assistant",
        content: %{text: "待采纳正文", turn_result: source_turn},
        source_ref: source_turn.turn_id,
        scope_ref: work.id
      })

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
    {_work, _session_id, socket} = create_work_and_socket("AU07 behavior trace work")
    work_id = socket.assigns[:work_id]
    session_id = socket.assigns[:session_id]
    source = seed_confirmation_source(work_id, session_id)
    reject = action_params(source, source.reject)

    assert {:reply, {:ok, %{received: true}}, _socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => reject}, socket)

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    cancel_turn_id = receipt.result["turn_id"]

    turn_result = WorkSessionRepo.turn_result(work_id, cancel_turn_id)
    assert turn_result["trace_summary"]["trace_ref"] == "trace:#{cancel_turn_id}"

    assert [
             %{
               "behavior_ref" => behavior_ref,
               "event_type" => "close",
               "event_turn_ref" => ^cancel_turn_id,
               "resolution_ref" => resolution_ref,
               "next_status" => "CANCELLED"
             }
           ] = turn_result["trace_summary"]["behavior_trace_refs"]

    assert behavior_ref == source.behavior_id
    assert resolution_ref == "behavior_resolution:#{cancel_turn_id}"

    assert [trace_record] = TraceRepository.list_by_turn(cancel_turn_id)
    assert trace_record.trace_id == "trace:#{cancel_turn_id}"
    assert trace_record.decision_type == "cancel_waiting"
  end

  defp create_work_and_socket(title) do
    {:ok, work} =
      WorkService.create(%{
        "title" => title,
        "genre" => "赛博修仙",
        "core_selling_point" => "作者动作必须形成真实运行事实"
      })

    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)

    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
        "work_id" => work.id,
        "session_id" => session_id
      })

    NovelApplication.TestAgentRunCleanup.register_task_caller(socket.channel_pid)
    {work, session_id, socket}
  end

  defp seed_confirmation_source(work_id, session_id) do
    unique = System.unique_integer([:positive])
    user_turn_id = "message_source_idem_#{unique}"
    turn_id = "#{user_turn_id}:agent:1"
    behavior_id = "bh_source_idem_#{unique}"
    run_id = "run_source_idem_#{unique}"

    plan = %{
      "plan_id" => "mp_source_idem_#{unique}",
      "turn_id" => turn_id,
      "frame_ref" => "frame_source_idem_#{unique}",
      "plan_goal" => %{"summary" => "生成角色设定"},
      "risk_hint" => "high",
      "requires_confirmation_hint" => false,
      "proposed_actions" => [
        %{
          "action_id" => "act_creative_idem_#{unique}",
          "action_type" => "capability_invocation",
          "summary" => "生成角色设定",
          "target_ref" => "character_design",
          "write_intent" => "tentative",
          "risk_hint" => "low"
        }
      ],
      "state_changes_requested" => [],
      "required_capabilities" => ["character_design"],
      "fallback_strategy" => %{"downgrade_message" => "fallback"},
      "stop_after_next_action" => true,
      "primary" => true,
      "schema_version" => "3.0-draft"
    }

    confirm = %{
      "action_id" => "act_confirm_idem_#{unique}",
      "action_type" => "confirm_before_execute",
      "behavior_ref" => behavior_id,
      "target_ref" => "character_design",
      "idempotency_key" => "confirm_idem_#{unique}",
      "trace_ref" => "decision_trace:#{turn_id}"
    }

    reject = %{
      "action_id" => "act_reject_idem_#{unique}",
      "action_type" => "reject_or_cancel_confirmation",
      "behavior_ref" => behavior_id,
      "target_ref" => "character_design",
      "idempotency_key" => "reject_idem_#{unique}",
      "trace_ref" => "decision_trace:#{turn_id}"
    }

    active = %{
      "behavior_id" => behavior_id,
      "behavior_type" => "confirmation",
      "blocking_actor" => "author",
      "opened_at_turn_ref" => turn_id,
      "opened_by_decision_ref" => "decision_source_idem_#{unique}",
      "frame_ref" => "frame_source_idem_#{unique}",
      "plan_ref" => plan["plan_id"],
      "target_ref" => "character_design",
      "required_next_action" => "confirm_before_execute",
      "available_actions" => [confirm, reject],
      "prompt_contract" => %{"question" => "确认生成角色设定？"},
      "constraints" => %{"risk" => "high"},
      "lifecycle_status" => "awaiting_author",
      "status" => "WAITING_USER"
    }

    turn_result = %{
      "schema_version" => "3.0-draft",
      "turn_id" => turn_id,
      "frame_ref" => "frame_source_idem_#{unique}",
      "status" => "needs_confirmation",
      "phase" => "awaiting_author",
      "assistant_message" => %{"text" => "需要作者确认后才能生成角色设定。"},
      "available_actions" => [confirm, reject],
      "behavior_state" => %{"active" => active, "history" => []},
      "plan" => plan,
      "ui_cards" => [],
      "trace_summary" => %{
        "trace_ref" => "trace:#{turn_id}",
        "source_turn_ref" => user_turn_id,
        "decision_type" => "confirmation_required"
      }
    }

    {:ok, _} =
      InteractionLifecycle.call(:receive, %{
        workspace_id: work_id,
        session_id: session_id,
        run_id: run_id,
        turn_id: user_turn_id,
        text: @author_text
      })

    {:ok, _} =
      InteractionLifecycle.call(:result, %{
        workspace_id: work_id,
        session_id: session_id,
        run_id: run_id,
        turn_result: turn_result
      })

    %{
      run_id: run_id,
      turn_id: turn_id,
      behavior_id: behavior_id,
      confirm: confirm,
      reject: reject
    }
  end

  defp action_params(source, action) do
    Map.put(action, "source_turn_ref", source.turn_id)
  end

  defp payload_turn_id(payload), do: payload[:turn_id] || payload["turn_id"]

  defp await_creative_result(run_id, work_id, session_id, attempts \\ 100)
  defp await_creative_result(_run_id, _work_id, _session_id, 0), do: flunk("child result missing")

  defp await_creative_result(run_id, work_id, session_id, attempts) do
    result =
      run_id
      |> then(&WorkSessionRepo.assistant_entries_by_run(work_id, session_id, &1))
      |> Enum.map(& &1.content["turn_result"])
      |> Enum.find(&get_in(&1, ["trace_summary", "confirmation_binding"]))

    if result do
      result
    else
      Process.sleep(50)
      await_creative_result(run_id, work_id, session_id, attempts - 1)
    end
  end

  # 只消费 topic 广播（`%Phoenix.Socket.Broadcast{}`），与 `assert_broadcast/3`、
  # `refute_broadcast/3` 的匹配语义保持一致。
  #
  # 本测试在测试进程内直接调用 `WorkspaceChannel.handle_in/3`，而 join 起的真实
  # channel 进程同样订阅了 topic：一次 `broadcast!/3` 会以 `%Broadcast{}`（测试进程
  # 直接订阅）和 `%Message{}`（channel 进程默认 handle_out 推给 transport）两种形态
  # 同时到达。若这里连 `%Message{}` 一并消费，后续 `refute_broadcast` 会把**同一次**
  # 广播的 `%Broadcast{}` 形态误判成第二次广播。生产客户端只收到一份 Message 帧。
  defp receive_broadcast(event, timeout) do
    receive do
      %Phoenix.Socket.Broadcast{event: ^event, payload: payload} ->
        payload

      {:agent_event, _event} ->
        receive_broadcast(event, timeout)

      {:agent_run_state_snapshot, _run_ref, _result} ->
        receive_broadcast(event, timeout)
    after
      timeout -> flunk("no #{event} broadcast received")
    end
  end

  defp assign_server_turn(socket, %{turn_id: turn_id} = turn_result) do
    turn_results = Map.put(socket.assigns[:turn_results_by_id] || %{}, turn_id, turn_result)

    socket
    |> Phoenix.Socket.assign(:current_turn_id, turn_id)
    |> Phoenix.Socket.assign(:turn_results_by_id, turn_results)
  end

  defp prior_persistence({:ok, value}), do: value
  defp prior_persistence(:error), do: []

  defp restore_persistence({:ok, value}),
    do: Application.put_env(:novel_web, :persistence, value)

  defp restore_persistence(:error), do: Application.delete_env(:novel_web, :persistence)

  defp restore_fact_persistence(:error),
    do: Application.delete_env(:novel_application, :agent_run_fact_persistence_enabled)

  defp restore_fact_persistence({:ok, value}),
    do: Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, value)

  defp subscription_count(work_id, session_id) do
    NovelApplication.AgentEventRegistry
    |> Registry.lookup({work_id, session_id})
    |> length()
  end
end
