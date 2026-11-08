defmodule NovelApplication.AgentRunPendingRevisionFlowTest do
  @moduledoc """
  B71 CP4b：真实 AgentRun + DialoguePlanningService 的候选修订接线回归。

  只证明 run snapshot/预算/会话确实进入 pending_artifact_step，且该步返回的
  canonical transcript 不会被 planner 的旧 metadata 覆盖；不冒充真实 UI/实模。
  """

  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Test.Provider.SliceVerify

  alias NovelApplication.{
    ArtifactAssembler,
    AuthoringTranscript,
    DialoguePlanningService,
    TestAgenticLoopFixtures,
    TurnResultBuilder,
    WorkService
  }

  alias NovelApplication.AgentRunService

  alias NovelDomain.DialogueFrame
  alias NovelPersistence.{AgentRunLog, MemoryLog, ProviderRunLog, Repo, WorkSessionRepo}

  setup do
    :ok = Sandbox.checkout(Repo)
    Sandbox.mode(Repo, {:shared, self()})

    {:ok, work} = WorkService.create(%{title: "B71 修订接线"})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

    %{work: work, session: session}
  end

  test "真实 run 将 snapshot 传入修订 step，保留判断历史与真实 3 次预算", c do
    base = "第一段文字。\n第二段文字。\n\n第三段文字。"
    invalid = "第一段文字。\n\n第二段文字。\n\n第三段文字。"
    valid = "第一段文字！\n第二段文字。\n\n第三段文字。"
    goal = "整理第01章前两段的排版候选：只调标点和分段，别改字句"

    artifact_id = record_pending_candidate(c, base)
    parent = self()
    revision_calls = :counters.new(1, [])

    execution = %Execution{
      result_fn: fn prompt ->
        tool_names =
          prompt
          |> Map.get(:tools, [])
          |> Enum.map(&(Map.get(&1, :name) || Map.get(&1, "name")))

        cond do
          "judgment_decision" in tool_names ->
            send(parent, {:provider_call, :judgment})

            {:ok,
             %NovelAgent.Provider.Result{
               content: "我会按你的要求修订候选，不自动保存。",
               tool_calls:
                 TestAgenticLoopFixtures.native_tool_calls("judgment_decision", %{
                   "action" => "execute",
                   "capability" => "revise_pending_artifact",
                   "pending_artifact_ref" => artifact_id,
                   "dialogue_goal" => goal,
                   "reason" => "作者要求修订已有候选。"
                 }),
               provider_call_ref: "pcall-run-judgment"
             }}

          "submit_tentative_artifact" in tool_names ->
            :counters.add(revision_calls, 1, 1)
            count = :counters.get(revision_calls, 1)
            body = if count <= 1, do: invalid, else: valid
            send(parent, {:provider_call, {:revision, count, tool_names}})

            {:ok,
             %NovelAgent.Provider.Result{
               content: "",
               tool_calls:
                 TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
                   items: [
                     %{
                       item_id: "agent-run-revision-#{count}",
                       title: "修订稿",
                       body: body,
                       rationale: nil
                     }
                   ]
                 }),
               provider_call_ref: "pcall-run-revision-#{count}"
             }}

          true ->
            flunk("unexpected provider call tools: #{inspect(tool_names)}")
        end
      end
    }

    context_fetcher = fn _workspace_id ->
      {:ok, shown} = NovelApplication.WorkSessionService.show(c.work.id, c.session.id)

      {:ok, nil, nil, nil, nil, [], [],
       %{
         pending_adoptions: shown.pending_adoptions,
         resolved_adoptions: shown.resolved_adoptions
       }}
    end

    input = %{
      text: goal,
      workspace_id: c.work.id,
      work_id: c.work.id,
      session_id: c.session.id,
      turn_id: "turn-agent-run-pending-revision"
    }

    assert {:ok, spec} = DialoguePlanningService.plan_agent_run(input, context_fetcher, execution)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, fn event ->
                 send(parent, {:agent_event, event.event_type, event})
               end),
               next_step_planner: spec.next_step_planner
             )

    on_exit(fn -> AgentRunService.cancel(run_id) end)

    assert_receive {:provider_call, :judgment}, 3_000
    assert_receive {:provider_call, {:revision, 1, _tools}}, 3_000
    assert_receive {:provider_call, {:revision, 2, _tools}}, 3_000
    assert_receive {:agent_event, :run_completed, _event}, 5_000

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert state.run.consumed_budget.provider_calls == 3

    transcript = state.stage_state.judgment_transcript

    tool_names =
      for message <- transcript.messages,
          block <- message.blocks,
          block.type == "tool_call",
          do: block.name

    assert "judgment_decision" in tool_names
    assert Enum.count(tool_names, &(&1 == "submit_tentative_artifact")) == 2

    revision_scope =
      Enum.find(transcript.messages, fn message ->
        Map.get(message, :role) == "scope_update" and
          canonical_text(message) =~ "本轮修订已有候选"
      end)

    assert revision_scope, "真实 run 的内部 stage_state 必须保留本轮修订 scope"
    scope_text = canonical_text(revision_scope)
    assert scope_text =~ "本轮修订已有候选"
    assert scope_text =~ goal

    validations =
      for message <- transcript.messages,
          block <- message.blocks,
          block.type == "validation_result",
          do: block

    assert Enum.any?(
             validations,
             &(&1.reason_code == "revision_scope_violation" and &1.status == "failed")
           )

    assert Enum.any?(
             validations,
             &(&1.reason_code == "tentative_artifact_validated" and &1.status == "passed")
           )

    assert Map.get(state.stage_state, :pending_artifact_request) == nil
    assert Map.get(state.stage_state, :pending_artifact_tool) == nil
    assert Map.get(state.stage_state, :judgment_settled) == "completed"

    [pending] = state.run.pending_artifact_refs
    assert is_binary(pending)

    # 内部 canonical 留在 stage_state；作者侧最终 TurnResult 不得夹带私有会话。
    assert is_map(state.stage_state.judgment_transcript)
    assert is_map(state.final_turn_result)
    refute_private_keys(state.final_turn_result)
    assert state.run.consumed_budget.provider_calls == 3
  end

  test "判断成功后的候选执行失败保留最新修订会话，预算不重算历史", c do
    base = "第一段文字。\n第二段文字。\n\n第三段文字。"
    invalid = "第一段文字。\n\n第二段文字。\n\n第三段文字。"
    goal = "整理第01章前两段的排版候选：只调标点和分段，别改字句"

    artifact_id = record_pending_candidate(c, base)
    parent = self()

    execution = %Execution{
      result_fn: fn prompt ->
        tool_names =
          prompt
          |> Map.get(:tools, [])
          |> Enum.map(&(Map.get(&1, :name) || Map.get(&1, "name")))

        cond do
          "judgment_decision" in tool_names ->
            send(parent, {:provider_call, :judgment})

            {:ok,
             %NovelAgent.Provider.Result{
               content: "我会按你的要求修订候选，不自动保存。",
               tool_calls:
                 TestAgenticLoopFixtures.native_tool_calls("judgment_decision", %{
                   "action" => "execute",
                   "capability" => "revise_pending_artifact",
                   "pending_artifact_ref" => artifact_id,
                   "dialogue_goal" => goal,
                   "reason" => "作者要求修订已有候选。"
                 }),
               provider_call_ref: "pcall-failure-judgment"
             }}

          "submit_tentative_artifact" in tool_names ->
            send(parent, {:provider_call, {:revision, tool_names}})

            {:ok,
             %NovelAgent.Provider.Result{
               content: "",
               tool_calls:
                 TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
                   items: [
                     %{
                       item_id: "agent-run-failure-revision",
                       title: "修订稿",
                       body: invalid,
                       rationale: nil
                     }
                   ]
                 }),
               provider_call_ref: "pcall-failure-revision-#{System.unique_integer([:positive])}"
             }}

          true ->
            flunk("unexpected provider call tools: #{inspect(tool_names)}")
        end
      end
    }

    context_fetcher = fn _workspace_id ->
      {:ok, shown} = NovelApplication.WorkSessionService.show(c.work.id, c.session.id)

      {:ok, nil, nil, nil, nil, [], [],
       %{
         pending_adoptions: shown.pending_adoptions,
         resolved_adoptions: shown.resolved_adoptions
       }}
    end

    input = %{
      text: goal,
      workspace_id: c.work.id,
      work_id: c.work.id,
      session_id: c.session.id,
      turn_id: "turn-agent-run-pending-failure"
    }

    assert {:ok, spec} = DialoguePlanningService.plan_agent_run(input, context_fetcher, execution)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(
               NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, fn event ->
                 send(parent, {:agent_event, event.event_type, event})
               end),
               next_step_planner: spec.next_step_planner
             )

    on_exit(fn -> AgentRunService.cancel(run_id) end)

    assert_receive {:provider_call, :judgment}, 3_000
    assert_receive {:provider_call, {:revision, _}}, 3_000
    assert_receive {:provider_call, {:revision, _}}, 3_000
    assert_receive {:agent_event, :run_failed, _event}, 5_000
    refute_received {:agent_event, :run_completed, _}

    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :failed
    assert state.run.consumed_budget.provider_calls == 3
    # 失败的工具尝试同样计入真实调用；不是历史重算。
    assert state.run.consumed_budget.tool_calls == 1

    transcript = state.stage_state.judgment_transcript
    tool_names = for call <- transcript_blocks(transcript, "tool_call"), do: call.name
    assert Enum.count(tool_names, &(&1 == "judgment_decision")) == 1
    assert Enum.count(tool_names, &(&1 == "submit_tentative_artifact")) == 2

    validations = transcript_blocks(transcript, "validation_result")
    assert Enum.any?(validations, &(&1.status == "failed"))

    assert Enum.any?(
             validations,
             &(&1.reason_code == "judgment_validated" and &1.status == "passed")
           )

    # 最新修订会话没有被较旧的判断会话覆盖。
    assert length(Enum.filter(transcript.messages, &(&1.role == "assistant"))) == 3

    assert is_map(state.final_turn_result)
    refute_private_keys(state.final_turn_result)
  end

  describe "真实 Gateway 判断负例" do
    setup do
      old_extra = Application.get_env(:novel_agent, :extra_providers)
      old_log_dir = Application.get_env(:novel_telemetry, :llm_log_dir)
      old_invalid_ref = System.get_env("SLICE_VERIFY_PENDING_INVALID_REF")

      dir =
        Path.join(
          System.tmp_dir!(),
          "b71-judgment-failure-#{System.unique_integer([:positive, :monotonic])}"
        )

      Application.put_env(
        :novel_agent,
        :extra_providers,
        Map.put(old_extra || %{}, :slice_verify, SliceVerify)
      )

      Application.put_env(:novel_telemetry, :llm_log_dir, dir)
      System.put_env("SLICE_VERIFY_PENDING_INVALID_REF", "1")

      on_exit(fn ->
        restore_app_env(:novel_agent, :extra_providers, old_extra)
        restore_app_env(:novel_telemetry, :llm_log_dir, old_log_dir)
        restore_env("SLICE_VERIFY_PENDING_INVALID_REF", old_invalid_ref)
        File.rm_rf(dir)
      end)

      %{dir: dir}
    end

    test "两次非法 pending ref 的真实 run 失败后 DB/ProviderRun/同次日志保留同一会话", c do
      base = "第一段文字。\n第二段文字。"
      goal = "请修改现有候选 B71_INVALID_PENDING_REF：保留其余内容。"
      artifact_id = record_pending_candidate(c, base)
      parent = self()

      execution =
        Execution.dependency(
          provider: :slice_verify,
          model: "fixture-model",
          purpose: :planner
        )

      context_fetcher = fn _workspace_id ->
        {:ok, shown} = NovelApplication.WorkSessionService.show(c.work.id, c.session.id)

        {:ok, nil, nil, nil, nil, [], [],
         %{
           pending_adoptions: shown.pending_adoptions,
           resolved_adoptions: shown.resolved_adoptions
         }}
      end

      input = %{
        text: goal,
        workspace_id: c.work.id,
        work_id: c.work.id,
        session_id: c.session.id,
        turn_id: "turn-b71-judgment-failure"
      }

      assert {:ok, spec} =
               DialoguePlanningService.plan_agent_run(input, context_fetcher, execution)

      assert {:ok, run_id} =
               AgentRunService.start_bounded(
                 NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, fn event ->
                   send(parent, {:agent_event, event.event_type, event})
                 end),
                 next_step_planner: spec.next_step_planner
               )

      on_exit(fn -> AgentRunService.cancel(run_id) end)

      assert_receive {:agent_event, :run_failed, failed}, 5_000
      refute_received {:agent_event, :artifact_created, _}
      refute_received {:agent_event, :run_completed, _}

      NovelApplication.TestAgentRunCleanup.await_quiescent()
      assert {:ok, state} = AgentRunService.state(run_id)
      assert state.run.status == :failed
      assert state.run.consumed_budget.provider_calls == 2
      assert state.run.consumed_budget.tool_calls == 0
      assert state.run.pending_artifact_refs == []

      # 真实 DB 私有列不是 null；canonical 与 ProviderRun/同次日志引用同一批调用。
      run = AgentRunLog.get_run(run_id)
      assert run.status == "failed"
      assert is_map(run.authoring_transcript)
      assert {:ok, transcript} = AuthoringTranscript.restore(run.authoring_transcript)
      assert transcript.run.run_id == run_id

      assistants =
        Enum.filter(transcript.messages, &(Map.get(&1, :role) == "assistant"))

      assert length(assistants) == 2

      calls = transcript_blocks(transcript, "tool_call")
      assert length(calls) == 2
      assert Enum.all?(calls, &(&1.name == "judgment_decision"))

      # 显式受控注入：目标目录里存在合法候选，provider 在 env+标记下返回一个
      # 非空但不在真实 targets 中的 ref。这样失败仍来自产品 ref 校验，而不是
      # 旧 fixture 的误路由/null target。
      invalid_refs = Enum.map(calls, & &1.arguments["pending_artifact_ref"])
      assert Enum.all?(invalid_refs, &is_binary/1)
      assert Enum.all?(invalid_refs, &(&1 != artifact_id))
      assert length(Enum.uniq(invalid_refs)) == 1

      refute Enum.any?(calls, &(&1.name == "submit_tentative_artifact"))

      validations = transcript_blocks(transcript, "validation_result")
      assert length(validations) == 2
      assert Enum.all?(validations, &(&1.status == "failed"))
      assert Enum.all?(validations, &(&1.reason_code == "target_not_available"))
      assert Enum.map(validations, & &1.call_id) == Enum.map(calls, & &1.call_id)

      provider_runs = ProviderRunLog.list_runs(run_id)
      assert length(provider_runs) == 2
      assert Enum.all?(provider_runs, &(&1.purpose == "planner" and &1.status == "completed"))

      provider_refs = Enum.map(provider_runs, & &1.provider_call_ref)
      assert Enum.sort(provider_refs) == Enum.sort(Enum.map(assistants, & &1.provider_call_ref))

      records = llm_records(c.dir)
      assert length(records) == 2
      assert Enum.all?(records, &(&1["provider"] == "slice_verify"))
      assert Enum.sort(Enum.map(records, & &1["provider_call_ref"])) == Enum.sort(provider_refs)

      # 作者可见事件/TurnResult 不含私有会话或私有marker；零 writer/canon。
      assert failed.reason_codes == ["step_failed"]
      refute inspect(failed.payload) =~ "B71_INVALID_PENDING_REF"
      refute inspect(failed.payload) =~ "judgment_transcript"
      assert is_map(state.final_turn_result)
      refute inspect(state.final_turn_result) =~ "B71_INVALID_PENDING_REF"
      refute inspect(state.final_turn_result) =~ "judgment_transcript"

      truthfulness = failed.payload.turn_result.truthfulness
      refute truthfulness.tool_called
      refute truthfulness.artifact_adopted
      refute truthfulness.production_write_performed

      assert {:ok, shown} = NovelApplication.WorkSessionService.show(c.work.id, c.session.id)
      assert Enum.any?(shown.pending_adoptions, &(&1[:adoption_status] == "TENTATIVE"))
    end
  end

  defp transcript_blocks(%{messages: messages}, type) do
    for message <- messages,
        block <- message.blocks,
        Map.get(block, :type) == type,
        do: block
  end

  defp llm_records(dir) do
    path = Path.join(dir, "#{NovelTelemetry.LogFileDate.today_iso8601()}.jsonl")

    if File.exists?(path) do
      path
      |> File.stream!()
      |> Enum.map(&Jason.decode!/1)
    else
      []
    end
  end

  defp restore_app_env(app, key, nil), do: Application.delete_env(app, key)
  defp restore_app_env(app, key, value), do: Application.put_env(app, key, value)

  defp restore_env(name, nil), do: System.delete_env(name)
  defp restore_env(name, value), do: System.put_env(name, value)

  @private_turn_result_keys ~w(
    stage_state judgment_transcript request_ir provider_session provider_result
    reasoning_content provider_state raw_arguments call_ids base_refs
    observation_refs used_refs
  )

  defp canonical_text(%{blocks: blocks}) do
    blocks
    |> Enum.filter(&(Map.get(&1, :type) == "text"))
    |> Enum.map_join("", &Map.get(&1, :text, ""))
  end

  defp refute_private_keys(value, path \\ []) do
    cond do
      is_map(value) ->
        Enum.each(value, fn {key, child} ->
          key = to_string(key)

          refute key in @private_turn_result_keys,
                 "作者可见 TurnResult 泄露私有键 #{Enum.join(path ++ [key], ".")}"

          refute_private_keys(child, path ++ [key])
        end)

      is_list(value) ->
        value
        |> Enum.with_index()
        |> Enum.each(fn {child, index} ->
          refute_private_keys(child, path ++ [Integer.to_string(index)])
        end)

      true ->
        :ok
    end
  end

  defp record_pending_candidate(c, body) do
    item = %{item_id: "item-agent-run-revision", title: "候选", body: body, rationale: nil}
    turn_id = "turn-pending-agent-run-revision"

    tool_result = %NovelCommon.Contracts.ToolResult{
      tool_result_id: "tr-agent-run-revision",
      tool_request_ref: "tq-agent-run-revision",
      tool_name: "prose_writing",
      status: :succeeded,
      output: %{
        artifact_type: :prose_fragment,
        item_count: 1,
        items: [item],
        companion_item_count: 0,
        companion_artifacts: []
      },
      artifact_refs: [item.item_id],
      state_delta: [],
      usage: %{duration_ms: 0, tool: "prose_writing", version: "1.0.0"},
      trace_refs: [],
      completed_at: DateTime.utc_now()
    }

    {:ok, artifact_set} = ArtifactAssembler.assemble(tool_result, turn_id)

    frame = %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-agent-run-revision",
      turn_id: turn_id,
      workspace_id: c.work.id,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{author_input_ref: turn_id},
      dialogue_goal: %{summary: "生成候选"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "候选待采纳"},
      evidence_summary: %{},
      uncertainty: []
    }

    result = TurnResultBuilder.build(frame, %{}, [], nil, nil, artifact_set)

    {:ok, _} =
      MemoryLog.record(%{
        workspace_id: c.work.id,
        session_id: c.session.id,
        turn_id: result.turn_id,
        role: "assistant",
        content: %{text: result.assistant_message.text, turn_result: result},
        source_ref: result.turn_id,
        scope_ref: c.work.id
      })

    [pending] = result.adoption_state.pending
    pending.artifact_id
  end
end
