defmodule NovelApplication.TurnInteractionServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{AgentRunService, ArtifactAssembler, TurnInteractionService}
  alias NovelDomain.{AgentNextStepDecision, AgentStep, DialogueContext}
  alias NovelPersistence.{InteractionLifecycle, MemoryLog, Repo, WorkRepo, WorkSessionRepo}

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})
    {:ok, work} = WorkRepo.create(%{title: "处置入口"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    run_id = "run_#{System.unique_integer([:positive])}"

    attrs = %{
      run_id: run_id,
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      parent_turn_ref: "turn_#{run_id}",
      origin_frame_ref: "frame_#{run_id}",
      profile_ref: "readonly_batch_context_v1",
      goal: %{text: "查看作品档案", version: 1},
      trigger: %{kind: "user_message"},
      authority_scope: %{production_write: false, allowed_tools: ["readonly_batch"]}
    }

    %{attrs: attrs, store: &InteractionLifecycle.call/2}
  end

  test "输入保存失败不启动运行", %{attrs: attrs} do
    parent = self()
    planner = fn _run, _seq, _snapshot -> send(parent, :unexpected_execution) end

    assert {:error, :disk_full} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner,
               interaction_store: fn :receive, _ -> {:error, :disk_full} end
             )

    assert {:error, :not_found} = AgentRunService.state(attrs.run_id)
    refute_receive :unexpected_execution
  end

  test "重发只起一个运行，结果落库早于发布，候选选择元数据保留", %{attrs: attrs, store: store} do
    parent = self()
    input = %{text: "  查看作品档案  ", candidate_selection: %{candidate_ref: "direction-1"}}

    event_sink = fn event ->
      if event.event_type == :turn_result_ready do
        send(parent, {:published, MemoryLog.transcript(attrs.session_id)})
      end
    end

    planner = planner(parent, :success)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner,
               event_sink: event_sink,
               interaction_store: store,
               interaction_input: input
             )

    assert_receive {:executed, ^run_id}, 2000
    assert_receive {:published, [user, assistant]}, 2000
    assert user.content["text"] == input.text
    assert user.content["candidate_selection"] == %{"candidate_ref" => "direction-1"}
    assert assistant.content["text"] == "读取完成，没有写入。"

    assert {:ok, ^run_id} =
             AgentRunService.start_bounded(%{attrs | run_id: run_id <> "-retry"},
               next_step_planner: planner,
               interaction_store: store,
               interaction_input: input
             )

    refute_receive {:executed, _}
    assert length(MemoryLog.transcript(attrs.session_id)) == 2
  end

  test "结果保存失败发布诚实失败而非成功产物", %{attrs: attrs, store: store} do
    parent = self()

    failing_store = fn
      :result, _ -> {:error, :disk_full}
      op, data -> store.(op, data)
    end

    assert {:ok, run_id} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner(parent, :success),
               interaction_store: failing_store,
               event_sink: fn event -> send(parent, {:event, event.event_type, event.payload}) end
             )

    assert_receive {:event, :run_failed, %{turn_result: result}}, 2000
    assert result.assistant_message.text =~ "结果未能保存"
    assert result.truthfulness.production_write_performed == false
    refute_receive {:event, :turn_result_ready, _}
    assert {:ok, %{run: %{status: :failed}}} = AgentRunService.state(run_id)
    assert [user] = MemoryLog.transcript(attrs.session_id)
    assert user.content["message_handling"]["status"] == "failed"
  end

  test "失败终局保留输入和可恢复的回应", %{attrs: attrs, store: store} do
    parent = self()

    assert {:ok, _} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: planner(parent, :failure),
               interaction_store: store,
               event_sink: fn event -> send(parent, {:event, event.event_type}) end
             )

    assert_receive {:event, :run_failed}, 2000
    assert [user, assistant] = MemoryLog.transcript(attrs.session_id)
    assert user.content["text"] == attrs.goal.text

    # B13b BB-4（ADR-0006 #2）：run 失败兜底 TurnResult = failed_recoverable（phase 仍 failed）。
    assert assistant.content["turn_result"]["status"] == "failed_recoverable"
    assert assistant.content["turn_result"]["phase"] == "failed"
  end

  test "作者动作结果不伪造输入，steer 作为独立来源保留", %{attrs: attrs, store: store} do
    {:ok, run} = NovelDomain.AgentRun.new(%{attrs | trigger: %{kind: "author_action"}})
    assert {:ok, _} = TurnInteractionService.receive_input(run, store)
    assert MemoryLog.transcript(attrs.session_id) == []
    run = %{run | goal: %{text: "新方向", version: 2}}
    assert {:ok, _} = TurnInteractionService.record_steer(run, "新方向", store)
    assert {:ok, _} = TurnInteractionService.record_steer(run, "新方向", store)
    assert [entry] = MemoryLog.transcript(attrs.session_id)
    assert entry.turn_id == "#{attrs.parent_turn_ref}:steer:2"
    assert entry.content["agent_run_id"] == run.run_id
  end

  test "业务信号必须是布尔值，未启用分支不消费来源字段" do
    assert {:error, {:author_content_registration_invalid, :invalid_signal}} =
             TurnInteractionService.validate_author_registration(
               %{author_content_registration: "true"},
               []
             )

    assert :ok =
             TurnInteractionService.validate_author_registration(
               %{
                 action: "execute",
                 author_content_registration: false,
                 author_content_source_ref: "foreign"
               },
               []
             )
  end

  test "历史来源只从上下文白名单读取，物化不改原文字节" do
    raw = "  原文\n第二行  "

    context = %DialogueContext{
      workspace_id: "w",
      interaction_state: %{
        author_inputs: [%{turn_ref: "source-1", text: raw}]
      }
    }

    assert TurnInteractionService.current_text(context, "source-1", "已裁剪") == raw

    assert TurnInteractionService.current_text(
             %DialogueContext{workspace_id: "w"},
             "current-2",
             raw
           ) == raw

    assert {:ok, "source-1", ^raw} =
             TurnInteractionService.source_text("source-1", "请存档", context, "current-2")

    assert {:error, {:author_content_registration_invalid, :source_not_available}} =
             TurnInteractionService.source_text("foreign-source", "请存档", context, "current-2")

    assert {:error, {:author_content_registration_invalid, :source_required}} =
             TurnInteractionService.source_text(nil, "把上一条原文存档", context, "current-2")

    assert {:ok, "current-2", ^raw} =
             TurnInteractionService.source_text("current", raw, context, "current-2")

    assert {:ok, artifact} = ArtifactAssembler.assemble_author_content("source-1", raw)
    assert hd(artifact.items).body == raw
    assert artifact.source_tool_result_ref == "author_input:source-1"

    assert {:ok, linked} =
             ArtifactAssembler.assemble_author_content("save-request-2", raw, "source-1")

    assert linked.source_turn_ref == "save-request-2"
    assert linked.source_tool_result_ref == "author_input:source-1"
    assert hd(linked.items).provider_call_ref == "author_input:source-1"
    assert hd(linked.items).body == raw
  end

  test "durable 消息重传不重复创建长任务", %{attrs: attrs, store: store} do
    parent = self()
    opts = [next_step_planner: planner(parent, :success), interaction_store: store]
    assert {:ok, run_id} = AgentRunService.start_durable(attrs, opts)
    assert_receive {:executed, ^run_id}, 2000

    assert {:ok, ^run_id} =
             AgentRunService.start_durable(%{attrs | run_id: run_id <> "-retry"}, opts)

    assert [_] = NovelPersistence.LongRunTaskLog.recent(attrs.workspace_id)
    refute_receive {:executed, _}
    assert {:ok, _} = AgentRunService.state(run_id)
  end

  test "运行取消后收到的输入仍可恢复", %{attrs: attrs, store: store} do
    parent = self()

    waiting = fn _run, _sequence, _snapshot ->
      send(parent, {:waiting_step, self()})

      receive do
        :release -> {:error, :cancelled_work}
      end
    end

    assert {:ok, run_id} =
             AgentRunService.start_bounded(attrs,
               next_step_planner: waiting,
               interaction_store: store
             )

    assert_receive {:waiting_step, pid}, 2000
    assert :ok = AgentRunService.cancel(run_id)
    assert {:ok, %{run: %{status: :cancelling}}} = AgentRunService.state(run_id)
    send(pid, :release)
    wait_stopped(run_id)
    assert [user | _] = MemoryLog.transcript(attrs.session_id)
    assert user.content["text"] == attrs.goal.text
    assert user.content["message_handling"]["status"] == "cancelled"
  end

  defp wait_stopped(run_id, attempts \\ 100)
  defp wait_stopped(_run_id, 0), do: flunk("运行未停止")

  defp wait_stopped(run_id, attempts) do
    case AgentRunService.state(run_id) do
      {:ok, %{run: %{status: :cancelled}}} ->
        :ok

      _ ->
        Process.sleep(10)
        wait_stopped(run_id, attempts - 1)
    end
  end

  test "待采纳和已采纳来源阻止重复物化，放弃后允许重新提出" do
    item = %{provider_call_ref: "author_input:source-1", body: "原文"}

    pending = %{
      artifact_id: "a1",
      source_tool_result_ref: "author_input:source-1",
      payload: %{items: [item]}
    }

    context = %DialogueContext{
      workspace_id: "w",
      interaction_state: %{pending_adoptions: [pending]}
    }

    assert TurnInteractionService.materialized_source?(context, "source-1")
    resolved = %{artifact_id: "a1", adoption_status: "ACCEPTED", payload: %{items: [item]}}
    context = %{context | interaction_state: %{resolved_adoptions: [resolved]}}
    assert TurnInteractionService.materialized_source?(context, "source-1")

    context = %{
      context
      | interaction_state: %{resolved_adoptions: [%{resolved | adoption_status: "DISCARDED"}]}
    }

    refute TurnInteractionService.materialized_source?(context, "source-1")
  end

  test "登记计数沿版本来源汇总，已编辑正文与原文来源分别保留" do
    original = %{
      artifact_id: "a",
      adoption_status: "DISCARDED",
      payload: %{items: [%{body: "原文", provider_call_ref: "author_input:source"}]}
    }

    revision = %{
      artifact_id: "b",
      adoption_status: "TENTATIVE",
      payload: %{
        revision_of: "a",
        registration_source_ref: "author_input:source",
        items: [%{body: "模型修订", provider_call_ref: "pcall-revision"}]
      }
    }

    edited = %{
      artifact_id: "c",
      adoption_status: "EDITED_ACCEPTED",
      payload: %{
        content: "作者最终编辑",
        registration_source_ref: "author_input:source",
        items: [%{body: "编辑前正文", provider_call_ref: "pcall-old"}]
      }
    }

    state = %{
      author_inputs: [%{turn_ref: "source", text: "原文"}],
      pending_adoptions: [revision],
      resolved_adoptions: [original, edited]
    }

    section = TurnInteractionService.context_section(state)
    facts = section |> String.split("\n", trim: true) |> List.last() |> Jason.decode!()

    assert hd(facts["author_inputs"])["registration"] == %{
             "pending_count" => 1,
             "accepted_count" => 1,
             "discarded_count" => 1
           }

    assert TurnInteractionService.artifact_body(edited) == "作者最终编辑"
    assert TurnInteractionService.author_source_ref(revision) == "author_input:source"
    assert TurnInteractionService.registered_sources(%{interaction_state: state}) == ["source"]
  end

  defp planner(parent, outcome) do
    fn run, seq, _snapshot ->
      {:ok, decision} =
        AgentNextStepDecision.new(%{
          decision_id: "decision-#{seq}",
          run_ref: run.run_id,
          sequence: seq,
          decision_type: :execute_step,
          summary: "读取档案",
          target_tool_ref: "readonly_batch",
          write_intent: :none,
          risk_hint: :low
        })

      step = fn run, seq, _snapshot ->
        send(parent, {:executed, run.run_id})
        result(run, seq, outcome)
      end

      {:execute, step, decision}
    end
  end

  defp result(_run, _seq, :failure), do: {:error, :test_failure}

  defp result(run, seq, :success) do
    {:ok, step} =
      AgentStep.new(%{
        step_id: "step-#{seq}",
        run_ref: run.run_id,
        sequence: seq,
        goal: "读取档案",
        status: :completed,
        idempotency_key: "#{run.run_id}:#{seq}"
      })

    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "complete-#{seq}",
        run_ref: run.run_id,
        sequence: seq,
        decision_type: :goal_satisfied,
        summary: "读取结束"
      })

    {:ok,
     %{
       step: step,
       turn_result: %{
         turn_id: run.parent_turn_ref,
         assistant_message: %{text: "读取完成，没有写入。"},
         truthfulness: %{production_write_performed: false}
       },
       loop_status: :completed,
       loop_decision: decision
     }}
  end
end
