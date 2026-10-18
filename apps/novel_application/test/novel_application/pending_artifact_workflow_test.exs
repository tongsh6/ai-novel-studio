defmodule NovelApplication.PendingArtifactWorkflowTest do
  use ExUnit.Case, async: false
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution

  alias NovelApplication.{
    ArtifactAssembler,
    PendingArtifactWorkflow,
    TurnInteractionService,
    TurnResultBuilder,
    WorkService,
    WorkSessionService
  }

  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.{DialogueContext, DialogueFrame}
  alias NovelPersistence.{MemoryLog, Repo, WorkSessionRepo}

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "雨港"})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

    {:ok, artifact} =
      ArtifactAssembler.assemble_author_content("source-turn", "沈砚经营旧书铺。", "original")

    frame = %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-source",
      turn_id: "source-turn",
      workspace_id: work.id,
      primary: true,
      frame_type: :capability_gap,
      source_refs: %{author_input_ref: "source-turn"},
      dialogue_goal: %{summary: "保存原文"},
      tool_need: %{needs_tool: false, reason_code: :capability_gap},
      execution_readiness: :not_applicable,
      author_visible_draft: %{message: "原文待采纳"},
      evidence_summary: %{},
      uncertainty: []
    }

    source =
      TurnResultBuilder.build(frame, %{}) |> TurnResultBuilder.attach_author_artifact(artifact)

    record(work.id, session.id, source)

    run = %{
      run_id: "run-test",
      run_mode: :bounded,
      profile_ref: "judgment_loop_v1",
      budget: %{max_tool_calls: 3, max_provider_calls: 6},
      consumed_budget: %{},
      authority_scope: %{production_write: false, allowed_tools: ["world_building"]},
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      parent_turn_ref: "request",
      goal: %{text: "把沈砚改成林渡，其余不变，暂不保存。", version: 1}
    }

    context = %DialogueContext{workspace_id: work.id, interaction_state: %{}}

    %{
      work: work,
      session: session,
      source: source,
      target: artifact.artifact_set_id,
      run: run,
      context: context
    }
  end

  test "修订传递已消解指代的目标与原稿全文，原稿保留且新稿来自 Provider", c do
    pid = self()
    body = "林渡经营旧书铺。"
    run = %{c.run | goal: %{text: "请按刚才讨论的名字修改这份候选，其他不变。", version: 1}}
    judgment = %{judgment(c, "revise_pending_artifact") | dialogue_goal: "把沈砚改成林渡，其余内容保持不变。"}

    provider = %Execution{
      result_fn: fn prompt ->
        send(pid, {:revision_prompt, prompt})
        text = Jason.encode!([%{item_id: "new-item", title: "旧书铺主人", body: body, rationale: nil}])

        {:ok,
         %NovelAgent.Provider.Result{
           content: text,
           provider_call_ref: "pcall-new",
           provider_output: %ProviderOutput{
             provider_run_ref: "prun-new",
             provider_call_ref: "pcall-new",
             status: :ok,
             content: %{text: text}
           }
         }}
      end
    }

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment,
               %{},
               run,
               c.context,
               provider
             )

    assert_received {:revision_prompt, prompt}
    assert prompt =~ "沈砚经营旧书铺。"
    assert prompt =~ "把沈砚改成林渡"
    assert prompt =~ run.goal.text
    refute run.goal.text =~ "林渡"
    assert prompt =~ "body 只放完整的新版本"
    refute prompt =~ "逐行包含：设定内容"
    [revised] = result.turn_result.adoption_state.pending
    assert result.artifact_refs == [revised.artifact_id]
    assert revised.artifact_id != c.target
    assert revised.payload.revision_of == c.target
    assert revised.payload.registration_source_ref == "author_input:original"
    assert [%{body: ^body, provider_call_ref: "pcall-new"}] = revised.payload.items
    refute result.turn_result.truthfulness.production_write_performed
    record(c.work.id, c.session.id, result.turn_result)
    {:ok, snapshot} = WorkSessionService.show(c.work.id, c.session.id)
    assert length(snapshot.pending_adoptions) == 2
    assert snapshot.resolved_adoptions == []
  end

  test "放弃实际目标，刷新读取终态，原文可重新提出；重复放弃被拒绝", c do
    judgment = %{judgment(c, "discard_pending_artifact") | narrative: "当前还未执行，不能声称已经放弃。"}

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment,
               %{},
               c.run,
               c.context,
               nil
             )

    assert [%{artifact_id: target, adoption_status: "DISCARDED"}] =
             result.turn_result.adoption_state.resolved

    assert target == c.target
    assert result.artifact_refs == []
    assert result.turn_result.assistant_message.text == "已放弃该待采纳内容。"
    refute result.turn_result.truthfulness.production_write_performed
    record(c.work.id, c.session.id, result.turn_result)
    {:ok, snapshot} = WorkSessionService.show(c.work.id, c.session.id)
    assert snapshot.pending_adoptions == []
    refute TurnInteractionService.materialized_source?(%{interaction_state: snapshot}, "original")

    assert {:error, {:pending_artifact_invalid, :target_not_available}} =
             PendingArtifactWorkflow.run(
               judgment(c, "discard_pending_artifact"),
               %{},
               c.run,
               c.context,
               nil
             )
  end

  test "越界与历史会话目标不可执行，不能猜最新对象", c do
    bad = %{judgment(c, "discard_pending_artifact") | pending_artifact_ref: "foreign"}

    assert {:error, {:pending_artifact_invalid, :target_not_available}} =
             PendingArtifactWorkflow.run(bad, %{}, c.run, c.context, nil)

    {:ok, _} = WorkSessionService.create(c.work.id)

    assert {:error, {:pending_artifact_invalid, :target_not_available}} =
             PendingArtifactWorkflow.run(
               judgment(c, "discard_pending_artifact"),
               %{},
               c.run,
               c.context,
               nil
             )
  end

  test "对话放弃后，旧页面的保存和编辑动作不能复活该候选", c do
    {:ok, result} =
      PendingArtifactWorkflow.run(
        judgment(c, "discard_pending_artifact"),
        %{},
        c.run,
        c.context,
        nil
      )

    record(c.work.id, c.session.id, result.turn_result)
    params = %{"artifact_id" => c.target, "work_id" => c.work.id, "session_id" => c.session.id}
    writer = fn _ -> flunk("已放弃对象不能被旧页面写入") end

    assert {:error, "pending artifact is no longer available"} =
             NovelApplication.AdoptionWorkflow.handle_adopt(c.source, params, writer)

    assert {:error, "pending artifact is no longer available"} =
             NovelApplication.AdoptionWorkflow.handle_modify_draft(
               c.source,
               Map.put(params, "edited_content", "过期编辑"),
               writer
             )
  end

  test "模型判断之后仍检查实际执行预算，不额外调用修订模型", c do
    run = %{c.run | budget: %{max_provider_calls: 0, max_tool_calls: 0}}

    assert {:error, {:pending_artifact_invalid, :budget_exhausted}} =
             PendingArtifactWorkflow.run(
               judgment(c, "revise_pending_artifact"),
               %{},
               run,
               c.context,
               %Execution{result_fn: fn _ -> flunk("预算耗尽不应调用模型") end}
             )
  end

  test "判断工具权限不能替代实际创作工具授权", c do
    run = %{c.run | authority_scope: %{production_write: false, allowed_tools: ["judgment"]}}

    assert {:error, {:pending_artifact_invalid, :capability_not_authorized}} =
             PendingArtifactWorkflow.run(
               judgment(c, "revise_pending_artifact"),
               %{},
               run,
               c.context,
               %Execution{result_fn: fn _ -> flunk("没有实际工具权限不能调用模型") end}
             )
  end

  test "修订模型失败不关闭原稿，也不把修改要求当成新正文", c do
    parent = self()

    input = %{
      trace_persister: fn _work, attrs ->
        send(parent, {:failed_trace, attrs})
        :ok
      end
    }

    assert {:error, {:pending_artifact_execution_failed, "world_building", trace_ref}} =
             PendingArtifactWorkflow.run(
               judgment(c, "revise_pending_artifact"),
               input,
               c.run,
               c.context,
               %Execution{result_fn: fn _ -> {:error, :provider_unavailable} end}
             )

    assert_received {:failed_trace, trace}
    assert trace.trace_id == trace_ref
    assert [tool_trace] = trace.tool_trace_refs
    assert to_string(tool_trace.tool_status) == "failed"
    assert tool_trace.tool_name == "world_building"

    {:ok, snapshot} = WorkSessionService.show(c.work.id, c.session.id)
    assert [entry] = snapshot.pending_adoptions
    assert entry.artifact_id == c.target
    assert TurnInteractionService.artifact_body(entry) == "沈砚经营旧书铺。"
    assert snapshot.resolved_adoptions == []
  end

  defp judgment(c, capability),
    do: %{
      capability: capability,
      pending_artifact_ref: c.target,
      dialogue_goal: "处理已有候选",
      narrative: "我会按你的要求处理这份候选，不自动保存。"
    }

  defp record(work, session, result) do
    {:ok, _} =
      MemoryLog.record(%{
        workspace_id: work,
        session_id: session,
        turn_id: result.turn_id,
        role: "assistant",
        content: %{text: result.assistant_message.text, turn_result: result},
        source_ref: result.turn_id,
        scope_ref: work
      })
  end
end
