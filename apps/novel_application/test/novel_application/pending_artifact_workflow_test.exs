defmodule NovelApplication.PendingArtifactWorkflowTest do
  use ExUnit.Case, async: false
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution

  alias NovelApplication.{
    AdoptionWorkflow,
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

    # B27 CP3d：world 修订由 AuthoringTask 渲染（共享规则 + 修订 operation + preserve）
    assert prompt =~ "## 创作协作共同规则"
    assert prompt =~ "本轮为修订"
    assert prompt =~ "## 必须保留"
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

  test "ambiguous adopted revision target is rejected without write", c do
    judgment = %{
      capability: "revise_adopted_content",
      adopted_content_ref: nil,
      pending_artifact_ref: nil,
      dialogue_goal: "改一下那个设定",
      narrative: "请说明要修改哪条已保存设定，我不会猜目标。"
    }

    provider = %Execution{
      result_fn: fn _prompt -> flunk("ambiguous target must not call the writer") end
    }

    assert {:error, {:pending_artifact_invalid, :target_not_available}} =
             PendingArtifactWorkflow.run(judgment, %{}, c.run, c.context, provider)

    {:ok, snapshot} = WorkSessionService.show(c.work.id, c.session.id)
    assert [entry] = snapshot.pending_adoptions
    assert entry.artifact_id == c.target
    assert snapshot.resolved_adoptions == []
  end

  test "修订已采纳内容生成 sibling 候选并绑定 revision_of / supersedes_ref", c do
    parent = self()

    {:ok, accepted_artifact} =
      ArtifactAssembler.assemble_author_content(
        "accepted-source",
        "岑舟今年二十五岁，是青云宗宗主。",
        "original"
      )

    accepted_frame = %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-accepted",
      turn_id: "accepted-source",
      workspace_id: c.work.id,
      primary: true,
      frame_type: :capability_gap,
      source_refs: %{author_input_ref: "accepted-source"},
      dialogue_goal: %{summary: "保存设定"},
      tool_need: %{needs_tool: false, reason_code: :capability_gap},
      execution_readiness: :not_applicable,
      author_visible_draft: %{message: "设定待采纳"},
      evidence_summary: %{},
      uncertainty: []
    }

    accepted_source =
      TurnResultBuilder.build(accepted_frame, %{})
      |> TurnResultBuilder.attach_author_artifact(accepted_artifact)

    record(c.work.id, c.session.id, accepted_source)

    writer = fn attrs ->
      assert attrs.artifact_type == :world_setting
      assert attrs.supersedes_ref == nil

      {:ok,
       %{
         mutation_id: "mutation-accepted",
         mutation_status: "APPLIED",
         memory_item_id: "memory-old",
         memory_status: "CONFIRMED",
         source_revision_ref: "mutation:mutation-accepted",
         reading_projection: nil
       }}
    end

    assert {:ok, _action, adopted} =
             AdoptionWorkflow.handle_adopt(
               accepted_source,
               %{"artifact_id" => accepted_artifact.artifact_set_id, "work_id" => c.work.id},
               writer
             )

    record(c.work.id, c.session.id, adopted)
    {:ok, snapshot} = WorkSessionService.show(c.work.id, c.session.id)

    accepted =
      Enum.find(
        snapshot.resolved_adoptions,
        &(&1.artifact_id == accepted_artifact.artifact_set_id)
      )

    assert accepted.adoption_status == "ACCEPTED"
    assert accepted.adopted_state_ref == "memory-old"

    judgment = %{
      capability: "revise_adopted_content",
      adopted_content_ref: accepted.artifact_id,
      pending_artifact_ref: nil,
      dialogue_goal: "把岑舟的年龄从二十五岁改成三十岁，其余保持不变。",
      narrative: "我会生成一份修订候选，你确认后才替代旧版。"
    }

    run = %{
      c.run
      | authority_scope: %{production_write: false, allowed_tools: ["world_building"]},
        goal: %{text: "把年龄改成三十岁，其他不变。", version: 1}
    }

    revised_body = "岑舟今年三十岁，是青云宗宗主。"

    provider = %Execution{
      result_fn: fn prompt ->
        send(parent, {:adopted_revision_prompt, prompt})

        text =
          Jason.encode!([%{item_id: "new-item", title: "岑舟", body: revised_body, rationale: nil}])

        {:ok,
         %NovelAgent.Provider.Result{
           content: text,
           provider_call_ref: "pcall-adopted-new",
           provider_output: %ProviderOutput{
             provider_run_ref: "prun-adopted-new",
             provider_call_ref: "pcall-adopted-new",
             status: :ok,
             content: %{text: text}
           }
         }}
      end
    }

    assert {:ok, result} =
             PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider)

    assert_received {:adopted_revision_prompt, prompt}
    assert prompt =~ "岑舟今年二十五岁"
    assert prompt =~ "把年龄改成三十岁"
    assert prompt =~ "待采纳的修订候选"

    [revised] = result.turn_result.adoption_state.pending
    assert revised.artifact_id != accepted.artifact_id
    assert revised.payload.revision_of == accepted.artifact_id
    assert revised.payload.supersedes_ref == "memory-old"
    assert revised.payload.revision_target_status == "ACCEPTED"

    assert [%{body: ^revised_body, provider_call_ref: "pcall-adopted-new"}] =
             revised.payload.items

    refute result.turn_result.truthfulness.production_write_performed

    # Q1c discard matrix: 放弃修订候选后旧 accepted 仍是当前事实，零生产写入。
    record(c.work.id, c.session.id, result.turn_result)

    discard_judgment = %{
      capability: "discard_pending_artifact",
      pending_artifact_ref: revised.artifact_id,
      dialogue_goal: "放弃这次修订",
      narrative: "我会放弃修订候选，旧版本仍是当前事实。"
    }

    assert {:ok, discarded} =
             PendingArtifactWorkflow.run(discard_judgment, %{}, run, c.context, nil)

    assert [%{artifact_id: discarded_ref, adoption_status: "DISCARDED"}] =
             discarded.turn_result.adoption_state.resolved

    assert discarded_ref == revised.artifact_id
    refute discarded.turn_result.truthfulness.production_write_performed
    record(c.work.id, c.session.id, discarded.turn_result)

    {:ok, snapshot} = WorkSessionService.show(c.work.id, c.session.id)

    assert Enum.any?(
             snapshot.resolved_adoptions,
             &(&1.artifact_id == accepted.artifact_id and &1.adoption_status == "ACCEPTED")
           )

    refute Enum.any?(snapshot.pending_adoptions, &(&1.artifact_id == revised.artifact_id))
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

  test "prose/outline/character pending revisions carry authoring task and shared semantics", c do
    cases = [
      {:prose_fragment, "prose_writing"},
      {:outline_draft, "plot_outline"},
      {:character_seed, "character_design"}
    ]

    for {artifact_type, tool} <- cases do
      {artifact_id, ^tool} =
        record_pending_artifact(c, artifact_type, %{
          item_id: "item-#{artifact_type}",
          title: "候选",
          body: "原候选正文内容",
          rationale: nil
        })

      parent = self()

      provider = %Execution{
        result_fn: fn prompt ->
          send(parent, {:revision_prompt, artifact_type, prompt})

          {:ok,
           %NovelAgent.Provider.Result{
             content:
               Jason.encode!([
                 %{
                   item_id: "revised-#{artifact_type}",
                   title: "修订稿",
                   body: "修订正文",
                   rationale: nil
                 }
               ]),
             provider_call_ref: "pcall-rev-#{artifact_type}"
           }}
        end
      }

      run = %{
        c.run
        | authority_scope: %{production_write: false, allowed_tools: [tool]},
          budget: %{max_tool_calls: 3, max_provider_calls: 6}
      }

      judgment = %{
        judgment(c, "revise_pending_artifact")
        | pending_artifact_ref: artifact_id,
          dialogue_goal: "修订这份候选，其他内容不变"
      }

      assert {:ok, result} = PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider)
      assert_receive {:revision_prompt, ^artifact_type, prompt}, 500

      # 任务语义随请求出站：共享规则 + 修订操作 + 基线/保留 + 作者原话
      assert prompt =~ "## 创作协作共同规则"
      assert prompt =~ "本轮为修订"
      assert prompt =~ "## 必须保留"
      assert prompt =~ "artifact_type：#{artifact_type}"
      assert prompt =~ "作者原话（逐字保留、可追溯）："
      assert prompt =~ "原候选正文内容"

      [revised] = result.turn_result.adoption_state.pending
      assert revised.artifact_type == artifact_type
      assert revised.payload.revision_of == artifact_id
    end
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

  defp record_pending_artifact(c, artifact_type, item) do
    tool = tool_for_artifact(artifact_type)
    turn_id = "turn-pending-#{artifact_type}"

    tool_result = %NovelCommon.Contracts.ToolResult{
      tool_result_id: "tr-#{artifact_type}",
      tool_request_ref: "tq-#{artifact_type}",
      tool_name: tool,
      status: :succeeded,
      output: %{
        artifact_type: artifact_type,
        item_count: 1,
        items: [item],
        companion_item_count: 0,
        companion_artifacts: []
      },
      artifact_refs: [item.item_id],
      state_delta: [],
      usage: %{duration_ms: 0, tool: tool, version: "1.0.0"},
      trace_refs: [],
      completed_at: DateTime.utc_now()
    }

    {:ok, artifact_set} = ArtifactAssembler.assemble(tool_result, turn_id)

    frame = %DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-#{artifact_type}",
      turn_id: turn_id,
      workspace_id: c.work.id,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{author_input_ref: turn_id},
      dialogue_goal: %{summary: "生成候选"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "候选"},
      evidence_summary: %{},
      uncertainty: []
    }

    turn_result =
      TurnResultBuilder.build(
        frame,
        %{trace_ref: "trace-#{artifact_type}"},
        [],
        nil,
        tool_result,
        artifact_set
      )

    record(c.work.id, c.session.id, turn_result)
    [pending] = turn_result.adoption_state.pending
    {pending.artifact_id, tool}
  end

  defp tool_for_artifact(:prose_fragment), do: "prose_writing"
  defp tool_for_artifact(:outline_draft), do: "plot_outline"
  defp tool_for_artifact(:character_seed), do: "character_design"
  defp tool_for_artifact(:world_setting), do: "world_building"
end
