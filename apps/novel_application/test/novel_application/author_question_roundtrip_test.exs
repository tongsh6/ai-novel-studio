defmodule NovelApplication.AuthorQuestionRoundtripTest do
  use ExUnit.Case, async: false
  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.{
    AgentRunService,
    AuthorQuestion,
    AuthorQuestionService,
    WorkSessionService
  }

  alias NovelDomain.{AgentNextStepDecision, AuthorActionInput}

  alias NovelPersistence.{
    AgentRunLog,
    AuthorQuestionRepo,
    InteractionLifecycle,
    LongRunTaskLog,
    Repo,
    WorkRepo,
    WorkSessionRepo
  }

  setup do
    owner = Sandbox.start_owner!(Repo, shared: true)
    on_exit(fn -> Sandbox.stop_owner(owner) end)
    prior = Application.get_env(:novel_web, :persistence, [])

    Application.put_env(
      :novel_web,
      :persistence,
      Keyword.put(prior, :inject_real_persistence, true)
    )

    on_exit(fn -> Application.put_env(:novel_web, :persistence, prior) end)
    {:ok, work} = WorkRepo.create(%{title: "提问回传验证"})
    {:ok, session} = WorkSessionRepo.create(%{work_id: work.id})
    %{work: work.id, session: session.id}
  end

  defp start_question(scope, options \\ [], opts \\ []) do
    parent = self()
    id = "run_question_#{System.unique_integer([:positive])}"

    attrs = %{
      run_id: id,
      workspace_id: scope.work,
      work_id: scope.work,
      session_id: scope.session,
      parent_turn_ref: "turn_#{id}",
      origin_frame_ref: "frame_#{id}",
      profile_ref: "conversation_turn_v1",
      trigger: %{kind: "user_message"},
      goal: %{text: "讨论结尾", version: 1},
      authority_scope: %{production_write: false, allowed_tools: ["judgment"]}
    }

    context = %{
      id: id,
      parent: parent,
      options: options,
      hold: opts[:hold],
      hold_continuation: opts[:hold_continuation]
    }

    planner = fn run, sequence, _snapshot -> question_plan(run, sequence, context) end

    starter =
      if opts[:durable],
        do: &AgentRunService.start_durable/2,
        else: &AgentRunService.start_bounded/2

    fail_delivery = opts[:fail_delivery] == true

    store = fn
      :question_delivery, _attrs when fail_delivery -> {:error, :injected_delivery_failure}
      operation, data -> InteractionLifecycle.call(operation, data)
    end

    assert {:ok, ^id} =
             starter.(attrs,
               next_step_planner: planner,
               interaction_store: opts[:store] || store,
               event_sink:
                 opts[:event_sink] ||
                   fn event ->
                     send(parent, {:question_event, event.event_type, event})
                   end
             )

    on_exit(fn ->
      case Registry.lookup(NovelApplication.AgentRunRegistry, id) do
        [{pid, _}] -> DynamicSupervisor.terminate_child(NovelApplication.AgentRunSupervisor, pid)
        _ -> :ok
      end
    end)

    if opts[:hold] == true or opts[:fail_delivery] == true or opts[:silent_delivery] == true do
      {id, nil}
    else
      assert_receive {:question_event, :awaiting_author, _}, 3000

      source =
        Enum.find(
          AuthorQuestionRepo.results(scope.work, scope.session),
          &(&1["author_question"]["run_id"] == id)
        )

      {id, source}
    end
  end

  defp question_plan(run, sequence, context) do
    {:ok, decision} =
      AgentNextStepDecision.new(%{
        decision_id: "decision_#{context.id}_#{sequence}",
        run_ref: context.id,
        sequence: sequence,
        decision_type: :execute_step,
        summary: "判断",
        target_tool_ref: "judgment",
        write_intent: :none,
        risk_hint: :low,
        reason_codes: ["question_test"]
      })

    if run.goal.version == 1 do
      step = fn current, _ -> question_result(current, context) end
      {:execute, step, decision, %{provider_call_count: 0, suppress_plan_event: true}}
    else
      continue_after_answer(run, decision, context)
    end
  end

  defp continue_after_answer(_run, decision, %{hold_continuation: true} = context) do
    step = fn _, _ ->
      send(context.parent, {:continuation_held, self()})
      receive do: (:release -> {:ok, %{provider_call_count: 0}})
    end

    {:execute, step, decision, %{provider_call_count: 0, suppress_plan_event: true}}
  end

  defp continue_after_answer(run, decision, context) do
    send(context.parent, {:continued, run.goal, run.consumed_budget})
    {:complete, decision, %{provider_call_count: 0, suppress_plan_event: true}}
  end

  defp question_result(run, context) do
    if context.hold do
      send(context.parent, {:question_held, self()})

      receive do
        :release -> :ok
      end
    end

    judgment = %{
      question: "  结尾保留悬念吗？\n",
      options: context.options,
      tool_call_id: "question-call",
      narrative_source: %{provider_call_ref: "provider-question-#{context.id}"}
    }

    result =
      %{
        turn_id: AuthorQuestion.turn_id(run, judgment),
        schema_version: "3.0-draft",
        assistant_message: %{text: judgment.question},
        available_actions: [],
        agent_run: %{
          run_id: context.id,
          run_mode: to_string(run.run_mode),
          status: "awaiting_author"
        }
      }
      |> AuthorQuestion.attach(judgment, run)

    {:ok, %{turn_result: result, provider_call_count: 1}}
  end

  defp input(source, text, submission \\ "submission_1", option \\ nil) do
    action = Enum.find(source["available_actions"], &(&1["candidate_ref"] == option))
    q = source["author_question"]

    %AuthorActionInput{
      input_id: "input",
      action_type: "author_choice",
      action_id: action["action_id"],
      source_turn_ref: source["turn_id"],
      target_ref: action["target_ref"],
      candidate_ref: action["candidate_ref"],
      idempotency_key: action["idempotency_key"],
      payload: %{
        "submission_id" => submission,
        "question_ref" => q["question_ref"],
        "expected_goal_version" => q["goal_version"],
        "text" => text
      }
    }
  end

  test "空选项有真实回复动作，问题在事件发布前持久化，恢复不依赖最近一页", scope do
    {id, source} = start_question(scope)
    assert source["author_question"]["options"] == []

    assert [%{"response_kind" => "free_text", "action_type" => "author_choice"}] =
             source["available_actions"]

    assert {:ok, snapshot} = WorkSessionService.resume(scope.work)
    assert [%{author_question: q}] = snapshot.open_author_question_turn_results
    assert q["question"] == "  结尾保留悬念吗？\n"
    assert q.status == "open"
    assert {:ok, %{run: run}} = AgentRunService.state(id)
    assert run.status == :awaiting_author
    assert run.consumed_budget.provider_calls == 1
  end

  test "自由回复保留原话，重传/失去 ack 不加第二次 goal，异内容冲突", scope do
    {id, source} = start_question(scope)
    text = "  保留悬念\n别改动前半章。  "
    request = input(source, text)
    assert {:ok, ack} = AuthorQuestionService.reply(scope.work, scope.session, request)
    assert ack.goal_version == 2
    assert ack.status == "accepted"
    assert_receive {:continued, %{text: ^text, version: 2}, _}, 2000
    assert {:ok, duplicate} = AuthorQuestionService.reply(scope.work, scope.session, request)
    assert duplicate.duplicate

    assert {:error, :submission_conflict} =
             AuthorQuestionService.reply(scope.work, scope.session, %{
               request
               | payload: Map.put(request.payload, "text", "改变内容")
             })

    refute_receive {:continued, _, _}
    stored = InteractionLifecycle.submission_input(scope.work, scope.session, "submission_1")
    assert stored.content["text"] == text
    assert stored.content["author_question_ref"] == source["author_question"]["question_ref"]
    assert {:ok, %{run: %{goal: %{version: 2}}}} = AgentRunService.state(id)
    assert AuthorQuestionService.open_results(scope.work, scope.session) == []
  end

  test "选项使用持久 label，不采用客户端替代文字；同一问题第二份提交被拒绝", scope do
    {_id, source} = start_question(scope, [%{value: "keep", label: "保留悬念", recommended: true}])

    assert {:ok, _} =
             AuthorQuestionService.reply(
               scope.work,
               scope.session,
               input(source, "客户端伪造", "choice_1", "keep")
             )

    assert_receive {:continued, %{text: "保留悬念", version: 2}, _}, 2000
    saved = InteractionLifecycle.submission_input(scope.work, scope.session, "choice_1")
    assert saved.content["author_choice_value"] == "keep"
    assert saved.content["source_question_turn_ref"] == source["turn_id"]

    assert {:error, :stale_author_question} =
             AuthorQuestionService.reply(
               scope.work,
               scope.session,
               input(source, "新的回复", "choice_2")
             )
  end

  test "空白、错版本、跨 scope、取消后的回复均不能推进", scope do
    {id, source} = start_question(scope)
    request = input(source, " \n ")

    assert {:error, :author_reply_text_required} =
             AuthorQuestionService.reply(scope.work, scope.session, request)

    request = input(source, "保留")

    assert {:error, :goal_version_mismatch} =
             AuthorQuestionService.reply(scope.work, scope.session, %{
               request
               | payload: Map.put(request.payload, "expected_goal_version", 9)
             })

    assert {:error, _} = AuthorQuestionService.reply(Ecto.UUID.generate(), scope.session, request)
    :ok = AgentRunService.cancel(id)
    assert_receive {:question_event, :run_cancelled, _}, 2000

    assert {:error, :stale_author_question} =
             AuthorQuestionService.reply(scope.work, scope.session, request)

    assert AuthorQuestionService.open_results(scope.work, scope.session) == []
  end

  test "并发提交同一问题只有一个被接受，另一份不重复推进", scope do
    {id, source} = start_question(scope)

    results =
      [input(source, "保留", "parallel_1"), input(source, "收束", "parallel_2")]
      |> Task.async_stream(&AuthorQuestionService.reply(scope.work, scope.session, &1),
        ordered: false
      )
      |> Enum.map(fn {:ok, result} -> result end)

    assert Enum.count(results, &match?({:ok, _}, &1)) == 1
    assert Enum.count(results, &match?({:error, :stale_author_question}, &1)) == 1
    assert {:ok, %{run: %{goal: %{version: 2}}}} = AgentRunService.state(id)
  end

  test "取消先于迟到模型问题提交时，不留下可回复问题", scope do
    {id, _} = start_question(scope, [], hold: true)
    assert_receive {:question_held, pid}, 2000
    :ok = AgentRunService.cancel(id)
    assert_receive {:question_event, :interrupt_requested, _}, 2000
    send(pid, :release)
    assert_receive {:question_event, :run_cancelled, _}, 2000
    assert AuthorQuestionRepo.results(scope.work, scope.session) == []
    refute_receive {:question_event, :awaiting_author, _}
  end

  test "问题事务失败不广播成功或回复动作，原输入仍可查", scope do
    {id, _} = start_question(scope, [], fail_delivery: true)
    assert_receive {:question_event, :run_failed, _}, 2000
    assert AuthorQuestionRepo.results(scope.work, scope.session) == []
    refute_receive {:question_event, :awaiting_author, _}
    assert {:ok, _} = InteractionLifecycle.receipt_input(scope.work, scope.session, id)
  end

  test "多个运行的问题独立恢复，bounded 失活关闭，durable 未就绪禁用", scope do
    {bounded, _} = start_question(scope)
    {durable, _} = start_question(scope, [], durable: true)
    assert length(AuthorQuestionService.open_results(scope.work, scope.session)) == 2

    for id <- [bounded, durable] do
      [{pid, _}] = Registry.lookup(NovelApplication.AgentRunRegistry, id)
      :ok = DynamicSupervisor.terminate_child(NovelApplication.AgentRunSupervisor, pid)
    end

    assert [%{author_question: q, available_actions: actions}] =
             AuthorQuestionService.open_results(scope.work, scope.session)

    assert q["run_id"] == durable
    assert q.status == "open"
    assert Enum.all?(actions, &(&1.enabled == false))
  end

  test "缺失或伪造动作身份诚实拒绝，不使 Channel 查询崩溃", scope do
    {_id, source} = start_question(scope)
    request = input(source, "继续")

    assert {:error, :invalid_author_question_input} =
             AuthorQuestionService.reply(scope.work, scope.session, %{
               request
               | source_turn_ref: nil
             })

    assert {:error, _} =
             AuthorQuestionService.reply(scope.work, scope.session, %{
               request
               | action_id: "invented"
             })
  end

  test "历史会话只回看，仍存活问题也不恢复可提交动作", scope do
    {_id, source} = start_question(scope)
    session = WorkSessionRepo.get_by_work(scope.work, scope.session)
    assert {:ok, _} = WorkSessionRepo.archive(session)
    result = AuthorQuestionService.project(source, scope.work, scope.session)
    assert Enum.all?(result.available_actions, &(&1.enabled == false))

    assert {:error, :author_question_source_unavailable} =
             AuthorQuestionService.reply(scope.work, scope.session, input(source, "继续"))
  end

  test "源动作的绑定键必须逐字匹配，不能用首尾空白制造另一回执", scope do
    {_id, source} = start_question(scope)
    request = input(source, "继续")

    assert {:error, :source_action_binding_mismatch} =
             AuthorQuestionService.reply(scope.work, scope.session, %{
               request
               | idempotency_key: " " <> request.idempotency_key
             })
  end

  test "问题交付事务在写入源结果后失败，回滚问题与待答事件", scope do
    store = fn
      :question_delivery, attrs ->
        attrs =
          Map.put(attrs, :checkpoint, %{task_ref: "missing-delivery-checkpoint", attrs: %{}})

        InteractionLifecycle.call(:question_delivery, attrs)

      operation, attrs ->
        InteractionLifecycle.call(operation, attrs)
    end

    {id, _} = start_question(scope, [], store: store, silent_delivery: true)
    assert_receive {:question_event, :run_failed, _}, 2000
    assert AuthorQuestionRepo.results(scope.work, scope.session) == []
    refute Enum.any?(AgentRunLog.list_events(id), &(&1.event_type == "awaiting_author"))
    refute_receive {:question_event, :awaiting_author, _}
    assert {:ok, %{run: %{status: :failed}}} = AgentRunService.state(id)
    assert {:ok, _} = InteractionLifecycle.receipt_input(scope.work, scope.session, id)
  end

  test "回复事务晚期失败回滚输入、问题、run、事件与回执，同身份可重新提交", scope do
    {:ok, fault} = Agent.start_link(fn -> true end)

    store = fn
      :question_answer, attrs ->
        attrs =
          if Agent.get(fault, & &1),
            do: Map.put(attrs, :checkpoint, %{task_ref: "missing-checkpoint", attrs: %{}}),
            else: attrs

        InteractionLifecycle.call(:question_answer, attrs)

      operation, attrs ->
        InteractionLifecycle.call(operation, attrs)
    end

    {id, source} = start_question(scope, [], store: store)
    request = input(source, "  保留悬念\n  ", "transaction_retry")
    before_events = AgentRunLog.list_events(id)

    assert {:error, :checkpoint_task_missing} =
             AuthorQuestionService.reply(scope.work, scope.session, request)

    assert {:ok, %{run: %{goal: %{version: 1}, status: :awaiting_author}}} =
             AgentRunService.state(id)

    assert AgentRunLog.get_run(id).goal_version == 1

    assert AuthorQuestionRepo.source(scope.work, scope.session, source["turn_id"]).content[
             "turn_result"
           ]["author_question"]["status"] == "open"

    assert InteractionLifecycle.submission_input(scope.work, scope.session, "transaction_retry") ==
             nil

    assert AgentRunLog.list_events(id) == before_events
    refute_receive {:question_event, :plan_adjusted, _}
    refute_receive {:continued, _, _}

    Agent.update(fault, fn _ -> false end)

    assert {:ok, %{goal_version: 2, duplicate: false}} =
             AuthorQuestionService.reply(scope.work, scope.session, request)

    assert_receive {:continued, %{version: 2}, _}

    assert {:ok, %{duplicate: true}} =
             AuthorQuestionService.reply(scope.work, scope.session, request)
  end

  test "提交后事件发布失败仍可恢复同一问题，回复不会重新生成问题", scope do
    parent = self()

    sink = fn event ->
      send(parent, {:question_event, event.event_type, event})

      if event.event_type in [:awaiting_author, :plan_adjusted],
        do: raise("injected publication loss")
    end

    {id, source} = start_question(scope, [], event_sink: sink)
    assert {:ok, %{run: %{status: :awaiting_author}}} = AgentRunService.state(id)

    assert [%{author_question: %{status: "open"}}] =
             AuthorQuestionService.open_results(scope.work, scope.session)

    request = input(source, "继续原方向", "publish_retry")

    assert {:ok, %{goal_version: 2}} =
             AuthorQuestionService.reply(scope.work, scope.session, request)

    assert_receive {:continued, %{version: 2}, _}
    assert_receive {:question_event, :run_completed, _}

    assert {:ok, %{duplicate: true, agent_run_state: %{status: "completed"}}} =
             AuthorQuestionService.reply(scope.work, scope.session, request)

    assert length(AuthorQuestionRepo.results(scope.work, scope.session)) == 1
    assert Enum.count(AgentRunLog.list_events(id), &(&1.event_type == "plan_adjusted")) == 1
  end

  test "回答先提交再取消后续执行，输入和 accepted 回执不被抹去", scope do
    {id, source} = start_question(scope, [], hold_continuation: true)
    request = input(source, "  保留  ", "answer_before_cancel")

    assert {:ok, %{goal_version: 2}} =
             AuthorQuestionService.reply(scope.work, scope.session, request)

    assert_receive {:continuation_held, worker}
    :ok = AgentRunService.cancel(id)
    assert_receive {:question_event, :interrupt_requested, _}
    send(worker, :release)
    assert_receive {:question_event, :run_cancelled, _}

    assert {:ok, %{duplicate: true, agent_run_state: %{status: "cancelled"}}} =
             AuthorQuestionService.reply(scope.work, scope.session, request)

    assert InteractionLifecycle.submission_input(
             scope.work,
             scope.session,
             "answer_before_cancel"
           ).content["text"] == "  保留  "

    assert AuthorQuestionService.project(source_after(scope, source), scope.work, scope.session).author_question.status ==
             "answered"
  end

  test "已提交答案在 bounded runtime 消失后仍按原回执重放，不创建新运行", scope do
    {id, source} = start_question(scope)
    request = input(source, "保留", "lost_runtime_receipt")
    assert {:ok, _} = AuthorQuestionService.reply(scope.work, scope.session, request)
    assert_receive {:question_event, :run_completed, _}
    stop_runtime(id)

    assert {:ok, %{duplicate: true, runtime_live: false, goal_version: 2}} =
             AuthorQuestionService.reply(scope.work, scope.session, request)

    assert Registry.lookup(NovelApplication.AgentRunRegistry, id) == []
  end

  test "答复已提交而 bounded 后续步骤中途失活，回执保留但运行诚实失败", scope do
    {id, source} = start_question(scope, [], hold_continuation: true)
    request = input(source, "  原目标只重试一次  ", "accepted_before_runtime_loss")

    assert {:ok, %{goal_version: 2}} =
             AuthorQuestionService.reply(scope.work, scope.session, request)

    assert_receive {:continuation_held, worker}
    stop_runtime(id)
    send(worker, :release)

    assert {:ok, [%{run: %{run_id: ^id, status: :failed}}]} =
             AgentRunService.list_dead_bounded(scope.work, scope.session)

    assert {:ok,
            %{
              duplicate: true,
              runtime_live: false,
              goal_version: 2,
              agent_run_state: %{status: "failed"}
            }} = AuthorQuestionService.reply(scope.work, scope.session, request)

    assert AuthorQuestionService.project(source_after(scope, source), scope.work, scope.session).author_question.status ==
             "answered"

    assert InteractionLifecycle.submission_input(
             scope.work,
             scope.session,
             "accepted_before_runtime_loss"
           ).content["text"] == "  原目标只重试一次  "

    assert Registry.lookup(NovelApplication.AgentRunRegistry, id) == []
  end

  test "durable live 重连校验就绪后仍用原问题答复，checkpoint 同步答案版本", scope do
    {id, source} = start_question(scope, [], durable: true)
    assert {:ok, [recovered]} = AgentRunService.recover_durable(scope.work, scope.session)
    assert recovered.runtime_live?
    assert recovered.run.goal.version == 1

    assert [%{available_actions: actions}] =
             AuthorQuestionService.open_results(scope.work, scope.session)

    assert Enum.all?(actions, & &1.enabled)

    assert {:ok, %{goal_version: 2}} =
             AuthorQuestionService.reply(
               scope.work,
               scope.session,
               input(source, "继续", "durable_answer")
             )

    assert_receive {:question_event, :run_completed, _}
    record = AgentRunLog.get_run(id)
    task = LongRunTaskLog.get(record.long_run_task_ref)
    assert task.checkpoint_data["agent_run"]["goal_version"] == 2
    assert AuthorQuestionService.open_results(scope.work, scope.session) == []
  end

  test "durable 死 runtime 的恢复投影不冒充执行就绪，不接受问题回复", scope do
    {id, source} = start_question(scope, [], durable: true)
    stop_runtime(id)
    assert {:ok, [recovered]} = AgentRunService.recover_durable(scope.work, scope.session)
    refute recovered.runtime_live?

    assert [%{author_question: %{status: "open"}, available_actions: actions}] =
             AuthorQuestionService.open_results(scope.work, scope.session)

    assert Enum.all?(actions, &(!&1.enabled))

    assert {:error, :author_question_runtime_unavailable} =
             AuthorQuestionService.reply(scope.work, scope.session, input(source, "继续"))

    assert AgentRunLog.get_run(id).goal_version == 1
  end

  test "仍活着但正在运行或暂停时，问题保持原身份但动作不可用", scope do
    {id, source} = start_question(scope)
    {:ok, %{run: run}} = AgentRunService.state(id)

    for status <- [:running, :paused, :pausing, :cancelling] do
      projected = AuthorQuestion.project(source, %{run | status: status}, true)
      assert projected.author_question.status == "open"
      assert Enum.all?(projected.available_actions, &(!&1.enabled))
    end
  end

  test "续行能力缺口保持能力缺口认知锚点，不伪装为可回复问题", scope do
    {id, _} = start_question(scope)
    {:ok, %{run: run}} = AgentRunService.state(id)

    judgment = %{
      action: "capability_gap",
      dialogue_goal: "同步发布",
      narrative: "当前没有发布同步能力。",
      reply_record: %{},
      narrative_source: %{provider_call_ref: "pc-gap"},
      tool_call_id: "gap-call"
    }

    {result, _trace} = AuthorQuestion.turn_result(run, judgment)
    assert result.frame_summary.frame_type == :capability_gap
    assert result.outcome == "goal_unfulfilled"
    assert result.agent_run.status == :completed
    refute Map.has_key?(result, :author_question)
    assert result.available_actions == []
    refute result.truthfulness.production_write_performed
  end

  defp source_after(scope, source),
    do:
      AuthorQuestionRepo.source(scope.work, scope.session, source["turn_id"]).content[
        "turn_result"
      ]

  defp stop_runtime(id) do
    assert {:ok, _} = AgentRunService.state(id)
    [{pid, _}] = Registry.lookup(NovelApplication.AgentRunRegistry, id)
    :ok = DynamicSupervisor.terminate_child(NovelApplication.AgentRunSupervisor, pid)
  end
end
