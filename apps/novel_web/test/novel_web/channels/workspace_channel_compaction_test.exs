defmodule NovelWeb.WorkspaceChannelCompactionTest do
  @moduledoc """
  B71 P2（VS-00L §16.2/§16.4）：显式压缩的真实 web 入口。

  走真实 `agent_command` 通道：作者显式触发 → application 从 canonical 事实派生 →
  先提交后回执。页面证据（Tauri AX）归后续批次，本文件只证明 Channel/持久化接线。
  """

  use ExUnit.Case, async: false

  import Phoenix.ChannelTest

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.RequestIR
  alias NovelApplication.{AgentRunService, AuthoringTranscript, TestAgentRunCleanup}
  alias NovelDomain.AgentNextStepDecision
  alias NovelPersistence.{AgentRunLog, Repo, WorkRepo, WorkSessionRepo}
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
    on_exit(fn -> TestAgentRunCleanup.await_quiescent(2_000) end)
    :ok
  end

  test "作者显式整理：真实 Channel 回执作者安全，canonical 前缀不变且 checkpoint 先提交" do
    parent = self()
    {:ok, work} = WorkRepo.create(%{title: "显式压缩入口"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    run_id = "run_b71_compact_#{System.unique_integer([:positive, :monotonic])}"

    transcript =
      transcript_for(run_id, work.id, session.id)
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block("read_character", %{}, "compact-call")
      ])
      |> AuthoringTranscript.append_observation("compact-call", %{
        status: "ok",
        source_refs: [%{ref: "character:1", version: 2, display_name: "沈砚"}],
        versions: %{"character:1" => 2},
        content: %{summary: "已读取角色"}
      })

    start_awaiting_author_run(work, session, run_id, transcript, parent)

    {:ok, _reply, socket} = join_workspace(work, session)

    before_record = wait_for_record(run_id)
    before_messages = get_in(before_record.authoring_transcript, ["transcript", "messages"])

    ref = push(socket, "agent_command", %{"run_id" => run_id, "command" => "compact_transcript"})

    assert_reply(ref, :ok, %{
      received: true,
      command: "compact_transcript",
      run_id: ^run_id,
      resolved_run_id: ^run_id,
      binding_source: "active_run",
      compaction: %{
        compacted: true,
        covered_exchanges: 1,
        summary: summary,
        omissions: [_ | _],
        sources: ["沈砚"]
      }
    })

    # 回执不暴露内部调用号/引用/版本，也不冒充已读或已采纳事实。
    refute summary =~ "compact-call"
    refute summary =~ "character:1"
    refute summary =~ "采纳"

    after_record =
      wait_for_record(run_id, fn record ->
        messages = get_in(record.authoring_transcript, ["transcript", "messages"])
        is_list(messages) and Enum.any?(messages, &(&1["role"] == "checkpoint"))
      end)

    after_messages = get_in(after_record.authoring_transcript, ["transcript", "messages"])
    assert Enum.take(after_messages, length(before_messages)) == before_messages
    assert Enum.count(after_messages, &(&1["role"] == "checkpoint")) == 1
    assert inspect(before_messages) =~ "compact-call"

    # 派生范围来自真实 canonical：checkpoint 覆盖的正是唯一完整交换。
    checkpoint_block =
      after_messages
      |> Enum.filter(&(&1["role"] == "checkpoint"))
      |> Enum.flat_map(& &1["blocks"])
      |> Enum.find(&(&1["type"] == "checkpoint"))

    assert checkpoint_block["covers"] == %{"call_ids" => ["compact-call"]}

    # 幂等：同一作者动作再次触发是「没有可整理项」，不是报错、不新增 checkpoint。
    ref = push(socket, "agent_command", %{"run_id" => run_id, "command" => "compact_transcript"})

    assert_reply(ref, :ok, %{
      command: "compact_transcript",
      compaction: %{compacted: false, reason: :nothing_to_compact}
    })

    final_record = wait_for_record(run_id)
    final_messages = get_in(final_record.authoring_transcript, ["transcript", "messages"])
    assert Enum.count(final_messages, &(&1["role"] == "checkpoint")) == 1
    assert final_messages == after_messages
  end

  test "执行中拒绝整理；作者仍可看到真实安全点错误且 canonical 不推进" do
    parent = self()
    {:ok, work} = WorkRepo.create(%{title: "执行中拒绝整理"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    run_id = "run_b71_compact_busy_#{System.unique_integer([:positive, :monotonic])}"

    planner = fn run, sequence, _snapshot ->
      send(parent, {:compaction_step_running, self()})

      receive do
        :finish ->
          {:ok, decision} =
            AgentNextStepDecision.new(%{
              decision_id: "and_#{run.run_id}_#{sequence}_compaction_complete",
              run_ref: run.run_id,
              sequence: sequence,
              decision_type: :goal_satisfied,
              summary: "测试 AgentRun 已完成。",
              reason_codes: ["test_goal_satisfied"]
            })

          {:complete, decision, %{provider_call_count: 0}}
      end
    end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(run_attrs(work, session, run_id),
               next_step_planner: planner
             )

    assert_receive {:compaction_step_running, step_pid}, 2_000

    {:ok, _reply, socket} = join_workspace(work, session)

    ref = push(socket, "agent_command", %{"run_id" => run_id, "command" => "compact_transcript"})
    assert_reply(ref, :error, %{reason: "execution_in_progress"})

    assert {:ok, %{current_task?: true}} = AgentRunService.state(run_id)

    send(step_pid, :finish)
    TestAgentRunCleanup.await_quiescent(2_000)
    assert {:ok, %{run: %{status: :completed}}} = AgentRunService.state(run_id)
  end

  test "整理命令沿用 run 归属校验，不跨作品/会话" do
    {:ok, work} = WorkRepo.create(%{title: "压缩归属"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    {:ok, other_work} = WorkRepo.create(%{title: "另一个作品"})
    {:ok, other_session} = WorkSessionRepo.create(%{work_id: other_work.id})
    run_id = "run_b71_compact_scope_#{System.unique_integer([:positive, :monotonic])}"

    transcript =
      transcript_for(run_id, work.id, session.id)
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block("read_character", %{}, "scope-call")
      ])
      |> AuthoringTranscript.append_observation("scope-call", %{
        status: "ok",
        source_refs: [],
        versions: %{},
        content: %{summary: "已读取角色"}
      })

    start_awaiting_author_run(work, session, run_id, transcript, self())
    {:ok, _reply, socket} = join_workspace(other_work, other_session)

    ref = push(socket, "agent_command", %{"run_id" => run_id, "command" => "compact_transcript"})
    assert_reply(ref, :error, %{reason: "run_scope_mismatch"})

    assert {:ok, %{run: %{status: :awaiting_author}}} = AgentRunService.state(run_id)
  end

  test "没有 canonical 会话时如实返回 transcript_not_found，不伪造压缩成功" do
    {:ok, work} = WorkRepo.create(%{title: "无会话压缩"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    run_id = "run_b71_compact_empty_#{System.unique_integer([:positive, :monotonic])}"

    start_awaiting_author_run(work, session, run_id, nil, self())
    {:ok, _reply, socket} = join_workspace(work, session)

    ref = push(socket, "agent_command", %{"run_id" => run_id, "command" => "compact_transcript"})
    assert_reply(ref, :error, %{reason: "transcript_not_found"})
  end

  defp start_awaiting_author_run(work, session, run_id, transcript, parent) do
    planner = fn run, sequence, _snapshot ->
      {:ok, decision} =
        AgentNextStepDecision.new(%{
          decision_id: "and_#{run.run_id}_#{sequence}_await_compaction",
          run_ref: run.run_id,
          sequence: sequence,
          decision_type: :await_author,
          summary: "请补充具体方向。",
          reason_codes: ["test_await_author_compaction"]
        })

      meta =
        if is_nil(transcript),
          do: %{provider_call_count: 0},
          else: %{provider_call_count: 0, judgment_transcript: transcript}

      {:await_author, decision, meta}
    end

    event_sink = fn event -> send(parent, {:agent_event, event.event_type, event.summary}) end

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(run_attrs(work, session, run_id),
               next_step_planner: planner,
               event_sink: event_sink
             )

    assert_receive {:agent_event, :awaiting_author, _}, 2_000
    assert {:ok, %{run: %{status: :awaiting_author}, current_task?: false}} =
             AgentRunService.state(run_id)
  end

  defp join_workspace(work, session) do
    UserSocket
    |> socket("user_id", %{})
    |> subscribe_and_join(WorkspaceChannel, "workspace:#{work.id}", %{
      "work_id" => work.id,
      "session_id" => session.id
    })
  end

  defp run_attrs(work, session, run_id) do
    %{
      run_id: run_id,
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      parent_turn_ref: "turn-#{run_id}",
      origin_frame_ref: "frame-#{run_id}",
      profile_ref: "character_design_with_context_v1",
      goal: %{text: "先看角色阵容，再设计反派", version: 1},
      authority_scope: %{
        production_write: false,
        allowed_tools: ["character_roster", "character_design"]
      }
    }
  end

  defp transcript_for(run_id, work_id, session_id) do
    AuthoringTranscript.new(
      %{
        run_id: run_id,
        workspace_id: work_id,
        work_id: work_id,
        session_id: session_id,
        parent_turn_ref: "turn-#{run_id}"
      },
      base_text: "仅生成待作者审阅的候选",
      author_text: "先看角色阵容，再设计反派",
      tools: [%{name: "read_character", description: "读取角色", input_schema: %{type: "object"}}],
      projection: %{
        target: "chat_completions",
        capability_profile: Map.new(RequestIR.required_capabilities(), &{&1, true})
      }
    )
  end

  defp wait_for_record(run_id, predicate \\ fn _ -> true end) do
    deadline = System.monotonic_time(:millisecond) + 2_000
    do_wait_for_record(run_id, predicate, deadline)
  end

  defp do_wait_for_record(run_id, predicate, deadline) do
    record = AgentRunLog.get_run(run_id)

    cond do
      record && record.authoring_transcript && predicate.(record) ->
        record

      System.monotonic_time(:millisecond) >= deadline ->
        flunk("authoring transcript was not committed before timeout")

      true ->
        Process.sleep(10)
        do_wait_for_record(run_id, predicate, deadline)
    end
  end
end
