defmodule NovelWeb.WorkspaceChannelConfirmationHandoffTest do
  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution

  alias NovelApplication.{
    AuthorActionConfirmation,
    WorkService,
    WorkSessionService
  }

  alias NovelDomain.AuthorActionInput

  alias NovelPersistence.{
    AgentRunLog,
    InteractionLifecycle,
    ProviderRunLog,
    Repo,
    WorkSessionRepo
  }

  alias NovelPersistence.Schemas.AuthorActionReceipt
  alias NovelWeb.{UserSocket, WorkspaceChannel}

  @endpoint NovelWeb.Endpoint

  @author_text "给陆沉舟设计一个底层散修人物设定，保持为待采纳草稿。"

  setup do
    pid = Sandbox.start_owner!(Repo, shared: true)
    previous = Application.get_env(:novel_web, :persistence, [])
    previous_facts = Application.get_env(:novel_application, :agent_run_fact_persistence_enabled)
    Application.put_env(:novel_web, :persistence, inject_real_persistence: true)
    Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, true)

    on_exit(fn ->
      Application.put_env(:novel_web, :persistence, previous)
      restore_fact_persistence(previous_facts)
      Sandbox.stop_owner(pid)
    end)

    {:ok, work} =
      WorkService.create(%{
        "title" => "B71 confirmation handoff",
        "genre" => "赛博修仙",
        "core_selling_point" => "确认必须创建新的作者动作运行"
      })

    {:ok, %{active_session: %{id: session_id}}} = WorkSessionService.resume(work.id)
    %{work: work, session_id: session_id}
  end

  test "confirm creates a new author-action run from persisted source and closes behavior", ctx do
    socket = join_socket(ctx.work.id, ctx.session_id)
    source = seed_source(ctx.work.id, ctx.session_id, "confirm")

    action = action_params(source, "confirm_before_execute")

    assert {:reply, {:ok, %{received: true}}, _socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    child_run_id = receipt.result["run_id"]
    assert is_binary(child_run_id)
    refute child_run_id == source.run_id

    state = await_terminal(child_run_id)
    assert state.run.profile_ref == "tool_confirmation_v1"
    assert state.run.status == :completed

    decision = WorkSessionRepo.turn_result(ctx.work.id, receipt.result["turn_id"])
    assert decision["turn_id"] != source.turn_id
    assert decision["parent_turn_id"] == source.turn_id
    assert decision["behavior_state"]["active"] == nil
    assert [%{"status" => "RESOLVED"}] = decision["behavior_state"]["history"]

    assert ProviderRunLog.list_runs(child_run_id) != []
    assert source_author_bytes(child_run_id) == @author_text

    source_record = AgentRunLog.get_run(source.run_id)
    assert source_record.status == "completed"
    assert get_in(source_record.trigger, ["handoff", "reason"]) == "author_action_handoff"
    assert get_in(source_record.trigger, ["handoff", "successor_run_id"]) == child_run_id
  end

  test "confirm child publishes persisted startup and tool_started before first provider response",
       ctx do
    source = seed_source(ctx.work.id, ctx.session_id, "startup-order")
    parent = self()
    default_execution = Execution.dependency(purpose: :tool)

    provider_execution = %Execution{
      purpose: :tool,
      result_fn: fn prompt ->
        send(parent, {:confirmed_provider_called, self()})

        receive do
          :release_confirmed_provider ->
            Execution.result_fn(default_execution).(prompt)
        after
          10_000 -> Execution.result_fn(default_execution).(prompt)
        end
      end
    }

    NovelApplication.TestAgentEventRelay.subscribe(
      ctx.work.id,
      ctx.session_id,
      nil,
      fn event -> send(parent, {:confirmed_agent_event, event}) end
    )

    assert {:ok, result} =
             AuthorActionConfirmation.handle(
               ctx.work.id,
               ctx.session_id,
               author_action_input(source),
               provider_execution: provider_execution
             )

    child_run_id = result.child_run.run_id

    assert child_run_id != source.run_id
    assert AgentRunLog.list_events(source.run_id) == []

    assert_receive {:confirmed_agent_event, %{event_type: :run_started} = startup_event}, 5_000
    assert startup_event.run_ref == child_run_id
    assert_receive {:confirmed_agent_event, %{event_type: :tool_started} = tool_event}, 5_000
    assert_receive {:confirmed_provider_called, provider_pid}, 5_000

    [persisted_startup] =
      child_run_id
      |> AgentRunLog.list_events()
      |> Enum.filter(&(&1.event_type == "run_started"))

    assert persisted_startup.id == startup_event.event_id
    assert persisted_startup.sequence == startup_event.sequence
    assert persisted_startup.sequence == 1

    assert {:ok, %{events: events}} = NovelApplication.AgentRunService.state(child_run_id)

    assert Enum.find(events, &(&1.event_type == :run_started)) == startup_event
    assert Enum.count(events, &(&1.event_type == :run_started)) == 1

    send(provider_pid, :release_confirmed_provider)

    state = await_terminal(child_run_id)
    assert state.run.status == :completed

    persisted = AgentRunLog.list_events(child_run_id)
    assert Enum.count(persisted, &(&1.event_type == "run_started")) == 1
    assert Enum.count(state.events, &(&1.event_type == :run_started)) == 1
    refute_receive {:confirmed_agent_event, %{event_type: :run_started}}, 100

    assert Enum.any?(
             persisted,
             &(&1.id == tool_event.event_id and &1.sequence == tool_event.sequence and
                 &1.event_type == "tool_started")
           )

    persisted_non_stream =
      persisted
      |> Enum.reject(&(&1.event_type == "provider_progress"))
      |> Enum.map(&{&1.id, &1.event_type, &1.sequence})

    memory_non_stream =
      state.events
      |> Enum.reject(&(&1.event_type == :provider_progress))
      |> Enum.map(&{&1.event_id, Atom.to_string(&1.event_type), &1.sequence})

    assert memory_non_stream == persisted_non_stream
  end

  test "confirm child run_started and tool_started reach the real channel consumer once", ctx do
    socket = join_socket(ctx.work.id, ctx.session_id)
    source = seed_source(ctx.work.id, ctx.session_id, "channel-startup")

    ref =
      push(
        socket,
        "author_action",
        %{"action" => action_params(source, "confirm_before_execute")}
      )

    assert_reply(ref, :ok, %{received: true})

    assert_receive %Phoenix.Socket.Message{
                     event: "agent_event",
                     payload: %{event_type: "run_started"} = startup
                   },
                   5_000

    child_run_id = startup.run_id
    assert startup.sequence == 1

    assert_receive %Phoenix.Socket.Message{
                     event: "agent_event",
                     payload: %{event_type: "tool_started", run_id: ^child_run_id} = tool
                   },
                   5_000

    assert tool.sequence > startup.sequence

    _ = await_terminal(child_run_id)

    persisted = AgentRunLog.list_events(child_run_id)
    startup_row = Enum.find(persisted, &(&1.event_type == "run_started"))
    tool_row = Enum.find(persisted, &(&1.event_type == "tool_started"))

    assert startup_row.id == startup.event_id
    assert startup_row.sequence == startup.sequence
    assert tool_row.id == tool.event_id
    assert tool_row.sequence == tool.sequence

    sequences = Enum.map(persisted, & &1.sequence)
    assert sequences == Enum.uniq(sequences)
  end

  test "reject creates zero-provider child result and cannot later confirm", ctx do
    socket = join_socket(ctx.work.id, ctx.session_id)
    source = seed_source(ctx.work.id, ctx.session_id, "reject")

    reject_action = action_params(source, "reject_or_cancel_confirmation")

    assert {:reply, {:ok, %{received: true}}, socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => reject_action}, socket)

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    child_run_id = receipt.result["run_id"]
    refute child_run_id == source.run_id
    assert ProviderRunLog.list_runs(child_run_id) == []

    decision = WorkSessionRepo.turn_result(ctx.work.id, receipt.result["turn_id"])
    assert decision["status"] == "cancelled"
    assert decision["behavior_state"]["active"] == nil
    assert [%{"status" => "CANCELLED"}] = decision["behavior_state"]["history"]

    confirm_action = action_params(source, "confirm_before_execute")

    assert {:reply, {:error, %{reason: reason}}, _socket} =
             WorkspaceChannel.handle_in(
               "author_action",
               %{"action" => confirm_action},
               socket
             )

    # §16.14/§16.10：拒绝已消费该确认行为；后续相反动作必须由 receipt 唯一事实
    # 判定为行为已消费，而不是依赖“当前行为是否仍打开”的时序校验。
    assert reason == :author_action_behavior_already_consumed

    assert Repo.aggregate(AuthorActionReceipt, :count, :behavior_ref) == 1

    assert length(AgentRunLog.list_by_parent_turn(ctx.work.id, ctx.session_id, source.turn_id)) ==
             1

    assert AgentRunLog.get_run(source.run_id)
  end

  test "duplicate confirm reuses the same run and never executes twice", ctx do
    socket = join_socket(ctx.work.id, ctx.session_id)
    source = seed_source(ctx.work.id, ctx.session_id, "duplicate")
    action = action_params(source, "confirm_before_execute")

    assert {:reply, {:ok, %{received: true}}, socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    receipt = Repo.get_by!(AuthorActionReceipt, behavior_ref: source.behavior_id)
    run_id = receipt.result["run_id"]
    _ = await_terminal(run_id)

    assert {:reply, {:ok, %{received: true, duplicate: true}}, _socket} =
             WorkspaceChannel.handle_in("author_action", %{"action" => action}, socket)

    assert Repo.aggregate(AuthorActionReceipt, :count, :behavior_ref) == 1

    assert length(AgentRunLog.list_by_parent_turn(ctx.work.id, ctx.session_id, source.turn_id)) ==
             1

    assert length(ProviderRunLog.list_runs(run_id)) == 1

    assert AgentRunLog.get_run(source.run_id)
  end

  defp restore_fact_persistence(nil),
    do: Application.delete_env(:novel_application, :agent_run_fact_persistence_enabled)

  defp restore_fact_persistence(previous),
    do: Application.put_env(:novel_application, :agent_run_fact_persistence_enabled, previous)

  defp join_socket(work_id, session_id) do
    {:ok, _, socket} =
      UserSocket
      |> socket("user_id", %{})
      |> subscribe_and_join(WorkspaceChannel, "workspace:#{work_id}", %{
        "work_id" => work_id,
        "session_id" => session_id
      })

    socket
  end

  defp seed_source(work_id, session_id, label) do
    run_id = "run_source_#{label}_#{System.unique_integer([:positive])}"
    user_turn_id = "message_source_#{label}_#{System.unique_integer([:positive])}"
    turn_id = "#{user_turn_id}:agent:1"
    behavior_id = "bh_source_#{label}_#{System.unique_integer([:positive])}"

    plan = %{
      "plan_id" => "mp_source_#{label}",
      "turn_id" => turn_id,
      "frame_ref" => "frame_source_#{label}",
      "plan_goal" => %{"summary" => "生成角色设定"},
      "risk_hint" => "high",
      "requires_confirmation_hint" => false,
      "proposed_actions" => [
        %{
          "action_id" => "act_creative_#{label}",
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
      "action_id" => "act_confirm_#{label}",
      "action_type" => "confirm_before_execute",
      "behavior_ref" => behavior_id,
      "target_ref" => "character_design",
      "idempotency_key" => "confirm_#{label}",
      "trace_ref" => "decision_trace:#{turn_id}"
    }

    reject = %{
      "action_id" => "act_reject_#{label}",
      "action_type" => "reject_or_cancel_confirmation",
      "behavior_ref" => behavior_id,
      "target_ref" => "character_design",
      "idempotency_key" => "reject_#{label}",
      "trace_ref" => "decision_trace:#{turn_id}"
    }

    behavior = %{
      "active" => %{
        "behavior_id" => behavior_id,
        "behavior_type" => "confirmation",
        "blocking_actor" => "author",
        "opened_at_turn_ref" => turn_id,
        "opened_by_decision_ref" => "decision_source_#{label}",
        "frame_ref" => "frame_source_#{label}",
        "plan_ref" => "mp_source_#{label}",
        "target_ref" => "character_design",
        "required_next_action" => "confirm_before_execute",
        "available_actions" => [confirm, reject],
        "prompt_contract" => %{"question" => "确认生成角色设定？"},
        "constraints" => %{"risk" => "high"},
        "lifecycle_status" => "awaiting_author",
        "status" => "WAITING_USER"
      },
      "history" => []
    }

    turn_result = %{
      "schema_version" => "3.0-draft",
      "turn_id" => turn_id,
      "frame_ref" => "frame_source_#{label}",
      "status" => "needs_confirmation",
      "phase" => "awaiting_author",
      "assistant_message" => %{"text" => "需要作者确认后才能生成角色设定。"},
      "available_actions" => [confirm, reject],
      "behavior_state" => behavior,
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
      AgentRunLog.upsert_run(%{
        id: run_id,
        workspace_id: work_id,
        work_id: work_id,
        session_id: session_id,
        parent_turn_ref: user_turn_id,
        origin_frame_ref: "frame_source_#{label}",
        run_mode: "bounded",
        profile_ref: "prose_drafting_with_quality_v1",
        status: "awaiting_author",
        phase: "stopped",
        goal: %{"text" => @author_text, "version" => 1},
        trigger: %{"kind" => "user_message"},
        plan: plan,
        plan_ref: plan["plan_id"],
        plan_version: 1,
        authority_scope: %{},
        run_policy: %{},
        budget: %{},
        consumed_budget: %{}
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
      source_turn_ref: turn_id,
      behavior_id: behavior_id,
      confirm: confirm,
      reject: reject
    }
  end

  defp action_params(source, action_type) do
    action = if action_type == "confirm_before_execute", do: source.confirm, else: source.reject
    Map.put(action, "source_turn_ref", source.turn_id)
  end

  defp author_action_input(source) do
    %AuthorActionInput{
      input_id: source.confirm["action_id"],
      source_turn_ref: source.turn_id,
      action_id: source.confirm["action_id"],
      action_type: "confirm_before_execute",
      target_ref: source.confirm["target_ref"],
      behavior_ref: source.behavior_id,
      idempotency_key: source.confirm["idempotency_key"]
    }
  end

  defp await_terminal(run_id, attempts \\ 100)

  defp await_terminal(run_id, attempts) when attempts > 0 do
    case NovelApplication.AgentRunService.state(run_id) do
      {:ok, %{run: %{status: status}} = state} when status in [:completed, :cancelled, :failed] ->
        state

      _ ->
        Process.sleep(50)
        await_terminal(run_id, attempts - 1)
    end
  end

  defp await_terminal(_run_id, 0), do: flunk("child run did not reach terminal state")

  defp source_author_bytes(run_id) do
    run = AgentRunLog.get_run(run_id)
    {:ok, transcript, :session_segment} = NovelApplication.AuthoringCheckpoint.restore(run, nil)

    transcript.messages
    |> Enum.filter(&(&1.role == "user" and &1.provenance == "author"))
    |> Enum.flat_map(& &1.blocks)
    |> Enum.filter(&(&1.type == "text"))
    |> Enum.map_join("", & &1.text)
  end
end
