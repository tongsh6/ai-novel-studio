defmodule NovelApplication.PendingArtifactWorkflowTest do
  use ExUnit.Case, async: false
  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Provider.Projection
  alias NovelCommon.RequestIR

  alias NovelApplication.{
    AdoptionWorkflow,
    ArtifactAssembler,
    AuthoringTranscript,
    PendingArtifactWorkflow,
    TestAgenticLoopFixtures,
    TurnInteractionService,
    TurnResultBuilder,
    WorkService,
    WorkSessionService
  }

  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.AgentRun
  alias NovelDomain.DialogueContext
  alias NovelDomain.DialogueFrame
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.MemoryLog
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.Volume
  alias NovelPersistence.WorkSessionRepo

  import Ecto.Query

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
      consumed_budget: %{
        steps: 0,
        execution_steps: 0,
        tool_calls: 0,
        provider_calls: 0,
        replans: 0
      },
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

        tool_calls =
          TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
            items: [%{item_id: "new-item", title: "旧书铺主人", body: body, rationale: nil}]
          })

        {:ok,
         %NovelAgent.Provider.Result{
           content: "",
           tool_calls: tool_calls,
           provider_call_ref: "pcall-new",
           provider_output: %ProviderOutput{
             provider_run_ref: "prun-new",
             provider_call_ref: "pcall-new",
             status: :ok,
             content: %{text: "", tool_calls: tool_calls}
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
    prompt = NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)
    assert prompt =~ "沈砚经营旧书铺。"
    assert prompt =~ "把沈砚改成林渡"
    assert prompt =~ run.goal.text
    refute run.goal.text =~ "林渡"
    assert prompt =~ "必须输出完整修订稿"

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

    assert {:error, {:pending_artifact_invalid, :target_not_available}, preflight_state} =
             PendingArtifactWorkflow.run(judgment, %{}, c.run, c.context, provider)

    assert preflight_state.tool_call_count == 0 and preflight_state.provider_call_count == 0

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

        tool_calls =
          TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
            items: [%{item_id: "new-item", title: "岑舟", body: revised_body, rationale: nil}]
          })

        {:ok,
         %NovelAgent.Provider.Result{
           content: "",
           tool_calls: tool_calls,
           provider_call_ref: "pcall-adopted-new",
           provider_output: %ProviderOutput{
             provider_run_ref: "prun-adopted-new",
             provider_call_ref: "pcall-adopted-new",
             status: :ok,
             content: %{text: "", tool_calls: tool_calls}
           }
         }}
      end
    }

    assert {:ok, result} =
             PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider)

    assert_received {:adopted_revision_prompt, prompt}
    prompt = NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)
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

    assert {:error, {:pending_artifact_invalid, :target_not_available}, _state} =
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

    assert {:error, {:pending_artifact_invalid, :target_not_available}, _state} =
             PendingArtifactWorkflow.run(bad, %{}, c.run, c.context, nil)

    {:ok, _} = WorkSessionService.create(c.work.id)

    assert {:error, {:pending_artifact_invalid, :target_not_available}, _state} =
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

    assert {:error, {:pending_artifact_invalid, :budget_exhausted}, budget_state} =
             PendingArtifactWorkflow.run(
               judgment(c, "revise_pending_artifact"),
               %{},
               run,
               c.context,
               %Execution{result_fn: fn _ -> flunk("预算耗尽不应调用模型") end}
             )

    assert budget_state.tool_call_count == 0 and budget_state.provider_call_count == 0
  end

  test "判断工具权限不能替代实际创作工具授权", c do
    run = %{c.run | authority_scope: %{production_write: false, allowed_tools: ["judgment"]}}

    assert {:error, {:pending_artifact_invalid, :capability_not_authorized}, authority_state} =
             PendingArtifactWorkflow.run(
               judgment(c, "revise_pending_artifact"),
               %{},
               run,
               c.context,
               %Execution{result_fn: fn _ -> flunk("没有实际工具权限不能调用模型") end}
             )

    assert authority_state.tool_call_count == 0 and authority_state.provider_call_count == 0
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
             content: "",
             tool_calls:
               TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
                 items: [
                   %{
                     item_id: "revised-#{artifact_type}",
                     title: "修订稿",
                     body: "修订正文",
                     rationale: nil
                   }
                 ]
               }),
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
      prompt = NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)
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

    assert {:error, {:pending_artifact_execution_failed, "world_building", trace_ref}, _state} =
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

  defp item_for_prose(body) do
    %{item_id: "item-prose", title: "候选", body: body, rationale: nil}
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

  test "仅排版修订：改字句/增删空行被机械拦截并带指引重试一次", c do
    base = "第一段文字。\n第二段文字。\n\n第三段文字。"

    {artifact_id, "prose_writing"} =
      record_pending_artifact(c, :prose_fragment, item_for_prose(base))

    bodies =
      [
        # 第一次：擅自新增空行（段落数变化）
        "第一段文字。\n\n第二段文字。\n\n第三段文字。",
        # 重试后：只改标点，段落边界不变
        "第一段文字！\n第二段文字。\n\n第三段文字。"
      ]

    parent = self()

    provider = %Execution{
      result_fn: fn prompt ->
        send(
          parent,
          {:layout_prompt, NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)}
        )

        [body | rest] = Process.get(:layout_bodies)
        Process.put(:layout_bodies, rest)

        {:ok,
         %NovelAgent.Provider.Result{
           content: "",
           tool_calls:
             TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
               items: [%{item_id: "rev-layout", title: "修订稿", body: body, rationale: nil}]
             }),
           provider_call_ref: "pcall-layout-#{length(rest)}"
         }}
      end
    }

    Process.put(:layout_bodies, bodies)

    run =
      %{
        c.run
        | authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]},
          budget: %{max_tool_calls: 3, max_provider_calls: 6},
          goal: %{c.run.goal | text: "那就整理一下吧"}
      }

    judgment = %{
      judgment(c, "revise_pending_artifact")
      | pending_artifact_ref: artifact_id,
        dialogue_goal: "整理第01章前两段的排版候选：只调标点和分段，别改字句"
    }

    assert {:ok, result} = PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider)

    assert_received {:layout_prompt, first}
    assert_received {:layout_prompt, second}
    assert second =~ "revision_scope_violation"
    assert second =~ "不得新增或删除段落"
    refute first =~ "revision_scope_violation"

    [pending] = result.turn_result.adoption_state.pending
    assert pending.payload.items |> hd() |> Map.get(:body) == "第一段文字！\n第二段文字。\n\n第三段文字。"
  end

  test "指定段落修订：合并/拆分其它段落被拦截并重试后保留基线", c do
    base = "第一段。\n第二段原文。\n第三段。"

    {artifact_id, "prose_writing"} =
      record_pending_artifact(c, :prose_fragment, item_for_prose(base))

    bodies = [
      # 第一次：把三段合并成两段（结构丢失）
      "第一段。\n第二段原文。\n第三段。",
      # 重试后：只改第二段，其它段落逐字保留
      "第一段。\n第二段改写。\n第三段。"
    ]

    Process.put(:scope_bodies, bodies)
    parent = self()

    provider = %Execution{
      result_fn: fn prompt ->
        send(
          parent,
          {:scope_prompt, NovelApplication.TestAgenticLoopFixtures.prompt_text(prompt)}
        )

        [body | rest] = Process.get(:scope_bodies)
        Process.put(:scope_bodies, rest)

        {:ok,
         %NovelAgent.Provider.Result{
           content: "",
           tool_calls:
             TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
               items: [%{item_id: "rev-scope", title: "修订稿", body: body, rationale: nil}]
             }),
           provider_call_ref: "pcall-scope-#{length(rest)}"
         }}
      end
    }

    run =
      %{
        c.run
        | authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]},
          budget: %{max_tool_calls: 3, max_provider_calls: 6},
          goal: %{c.run.goal | text: "把第二段改一下"}
      }

    judgment = %{
      judgment(c, "revise_pending_artifact")
      | pending_artifact_ref: artifact_id,
        dialogue_goal: "只改第二段，其他段落保留"
    }

    assert {:ok, result} = PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider)

    assert_received {:scope_prompt, first}
    assert_received {:scope_prompt, second}
    assert second =~ "revision_change_not_applied"
    refute first =~ "revision_change_not_applied"

    [pending] = result.turn_result.adoption_state.pending
    assert pending.payload.items |> hd() |> Map.get(:body) == "第一段。\n第二段改写。\n第三段。"
  end

  test "明确数值改动未落实：带指引重试；仍不落实则诚实失败", c do
    base = "他把七成收入交给灯楼。"

    {artifact_id, "prose_writing"} =
      record_pending_artifact(c, :prose_fragment, item_for_prose(base))

    Process.put(:numeric_bodies, [base, base])

    provider = %Execution{
      result_fn: fn prompt ->
        send(self(), {:numeric_prompt, prompt})
        [body | rest] = Process.get(:numeric_bodies)
        Process.put(:numeric_bodies, rest)

        {:ok,
         %NovelAgent.Provider.Result{
           content: "",
           tool_calls:
             TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
               items: [%{item_id: "rev-num", title: "修订稿", body: body, rationale: nil}]
             }),
           provider_call_ref: "pcall-num-#{length(rest)}"
         }}
      end
    }

    run =
      %{
        c.run
        | authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]},
          budget: %{max_tool_calls: 3, max_provider_calls: 6},
          goal: %{c.run.goal | text: "七成改六成"}
      }

    judgment = %{
      judgment(c, "revise_pending_artifact")
      | pending_artifact_ref: artifact_id,
        dialogue_goal: "把七成改成六成"
    }

    assert {:error, {:pending_artifact_invalid, :revision_change_not_applied}, numeric_state} =
             PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider)

    assert_received {:numeric_prompt, _first}
    assert_received {:numeric_prompt, second}
    assert NovelApplication.TestAgenticLoopFixtures.prompt_text(second) =~ "六成"
    assert numeric_state.tool_call_count == 1 and numeric_state.provider_call_count == 2
  end

  test "execution_tool：章级 revise_adopted_content 绑定 prose_writing（不依赖 resolved_adoptions）" do
    judgment = %{
      action: "execute",
      capability: "revise_adopted_content",
      adopted_content_ref: "chapter:11111111-1111-4111-8111-111111111111",
      narrative: "作者要求整理整章正文"
    }

    context = %{interaction_state: %{resolved_adoptions: [], pending_adoptions: []}}

    assert PendingArtifactWorkflow.execution_tool(judgment, context) == "prose_writing"

    pending_judgment = %{
      action: "execute",
      capability: "revise_adopted_content",
      adopted_content_ref: "as_not_in_resolved",
      narrative: "作者要求修订已采纳内容"
    }

    assert is_nil(PendingArtifactWorkflow.execution_tool(pending_judgment, context))
  end

  test "B30 维护分支：trace 完整构造持久化不 crash，产出 change plan 候选且零写入", c do
    volume = Repo.insert!(%Volume{work_id: c.work.id, title: "第二卷", seq: 2})

    for {title, seq} <- [{"第11章：甲", 11}, {"第12章：乙", 12}, {"第13章：丙", 13}] do
      Repo.insert!(%Chapter{work_id: c.work.id, volume_id: volume.id, title: title, seq: seq})
    end

    goal_text = "把第2卷章节编号理顺，内容不要动"
    run = %{c.run | goal: %{text: goal_text, version: 1}}

    judgment = %{
      action: "execute",
      capability: "maintain_chapter_structure",
      dialogue_goal: goal_text,
      narrative: "我会生成第2卷章节重编号的可审阅变更计划。"
    }

    before = chapter_rows(c.work.id)

    assert {:ok, result} = PendingArtifactWorkflow.run(judgment, %{}, run, c.context, nil)

    [pending] = result.turn_result.adoption_state.pending
    assert pending.payload.object_kind == "chapter_structure_change_plan"
    assert pending.payload.change_plan.object_count == 3
    assert pending.payload.change_plan.effects == ["display_number_only"]

    # 只产出候选：章节身份/序号零变化，未生产写入。
    assert chapter_rows(c.work.id) == before
    refute Map.get(result.turn_result.truthfulness || %{}, :production_write_performed, false)
  end

  defp chapter_rows(work_id) do
    from(ch in Chapter, where: ch.work_id == ^work_id, order_by: ch.seq)
    |> Repo.all()
    |> Enum.map(&{&1.id, &1.seq, &1.title, &1.volume_id})
  end

  test "B30 维护负例：越界目标 → 作者可见拒绝（非内部错误）、零写入、无候选", c do
    volume = Repo.insert!(%Volume{work_id: c.work.id, title: "第二卷", seq: 2})

    for {title, seq} <- [{"第11章：甲", 11}, {"第12章：乙", 12}] do
      Repo.insert!(%Chapter{work_id: c.work.id, volume_id: volume.id, title: title, seq: seq})
    end

    goal_text = "把第九卷章节编号理顺，内容不要动"
    run = %{c.run | goal: %{text: goal_text, version: 1}}

    judgment = %{
      action: "execute",
      capability: "maintain_chapter_structure",
      dialogue_goal: goal_text,
      narrative: "作者点名了不存在的卷。"
    }

    before = chapter_rows(c.work.id)

    assert {:ok, result} = PendingArtifactWorkflow.run(judgment, %{}, run, c.context, nil)

    assert %{assistant_message: %{text: text}} = result.turn_result
    assert text =~ "超出当前作品结构"
    assert result.artifact_refs == []
    assert chapter_rows(c.work.id) == before
    assert result.tool_call_count == 0 and result.provider_call_count == 0
  end

  test "B30 维护负例：无目标 → 作者可见拒绝、零写入、无候选", c do
    goal_text = "把第2卷章节编号理顺，内容不要动"
    run = %{c.run | goal: %{text: goal_text, version: 1}}

    judgment = %{
      action: "execute",
      capability: "maintain_chapter_structure",
      dialogue_goal: goal_text,
      narrative: "当前作品没有可维护的卷章结构。"
    }

    assert {:ok, result} = PendingArtifactWorkflow.run(judgment, %{}, run, c.context, nil)

    assert %{assistant_message: %{text: text}} = result.turn_result
    assert text =~ "没有找到要重编号的目标章节"
    assert result.artifact_refs == []
  end

  test "B29 角色修订候选：trace 完整构造持久化不 crash，产出 character_profile_revision 且零写入", c do
    shen =
      Repo.insert!(%Character{
        work_id: c.work.id,
        name: "沈砚",
        aliases: ["老沈"],
        role: "灯楼查账人",
        narrative_role: "ENSEMBLE_POV",
        status: AdoptionStatus.accepted()
      })

    goal_text = "指定老沈为主角"
    run = %{c.run | goal: %{text: goal_text, version: 1}}

    judgment = %{
      action: "execute",
      capability: "revise_character_profile",
      character_ref: "character:#{shen.id}",
      dialogue_goal: goal_text,
      narrative: "我会生成角色主档案叙事身份的修订候选。"
    }

    before = Repo.get!(Character, shen.id)

    assert {:ok, result} = PendingArtifactWorkflow.run(judgment, %{}, run, c.context, nil)

    [pending] = result.turn_result.adoption_state.pending
    assert pending.payload.object_kind == "character_profile_revision"
    assert pending.payload.character_ref == "character:#{shen.id}"
    [change] = pending.payload.changes
    assert change.field == "narrative_role"
    assert change.old == "ENSEMBLE_POV"
    assert change.new == "PROTAGONIST"

    # 只产候选：主档案字段零变化，角色数不变。
    after_row = Repo.get!(Character, shen.id)
    assert after_row.narrative_role == before.narrative_role
    assert after_row.name == before.name
  end

  # ── B71 CP4b：run/6 同一 run snapshot 的候选修订 ─────────────────────────

  test "run/6：带判断观察的 snapshot 修订复用历史，guard 纠正后成功且计数真实", c do
    base = "第一段文字。\n第二段文字。\n\n第三段文字。"
    invalid = "第一段文字。\n\n第二段文字。\n\n第三段文字。"
    valid = "第一段文字！\n第二段文字。\n\n第三段文字。"

    {source_id, "prose_writing"} =
      record_pending_artifact(c, :prose_fragment, item_for_prose(base))

    goal = "整理第01章前两段的排版候选：只调标点和分段，别改字句"
    run = native_run(c, "prose_writing", goal: %{text: goal, version: 1})
    transcript = native_transcript(run, c, source_id)
    snapshot = native_snapshot(run, transcript)
    provider = revision_provider(:revision_guard, [invalid, valid])

    judgment = %{
      judgment(c, "revise_pending_artifact")
      | pending_artifact_ref: source_id,
        dialogue_goal: goal
    }

    assert {:ok, result} =
             PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider, snapshot)

    assert_received {:revision_guard, first}
    assert_received {:revision_guard, second}

    # 作者原话只有一条独立 user；application_base/scope_update 虽投影为 user，
    # 但带显式 provenance 标记，不能把它们算成作者的第二次输入。
    assert_wire_author_identity(first, goal)
    assert_wire_author_identity(second, goal)

    # 第二次真实请求严格承接第一次请求；重试只新增真实 assistant/tool 交换，
    # 不追加 user 纠错，也不改写作者字节。
    assert Enum.take(second.messages, length(first.messages)) == first.messages

    new_wire = Enum.drop(second.messages, length(first.messages))
    assert Enum.map(new_wire, & &1.role) == ["assistant", "tool"]
    refute Enum.any?(new_wire, &(&1.role == "user"))

    # 返回的 canonical 历史必须经真实 IR/投影回到 wire；最后一次真实请求是它的严格前缀，
    # 之后只能追加本次真实 response 与 validation。修订 scope/instructions 也必须在
    # canonical 中，不能只靠旧 base 与调用顺序“看起来正确”。
    canonical_messages =
      assert_revision_canonical_boundary(
        result.stage_state.judgment_transcript,
        second,
        goal,
        base
      )

    assert Enum.map(Enum.drop(canonical_messages, length(second.messages)), & &1.role) == [
             "assistant",
             "tool"
           ]

    # first 只是请求，不含首次 writer 响应；真实 call_id 必须从第二次请求新增的
    # assistant 消息（即首次响应）中取，并核对其紧随的原生 tool 失败结果。
    assert [first_assistant] = Enum.filter(new_wire, &(&1.role == "assistant"))
    assert [first_call] = Enum.filter(first_assistant.blocks, &(&1.type == "tool_call"))
    assert first_call.name == "submit_tentative_artifact"
    first_call_id = first_call.call_id
    assert is_binary(first_call_id) and first_call_id != ""

    assert [first_tool] = Enum.filter(new_wire, &(&1.role == "tool"))
    first_validation = Enum.find(first_tool.blocks, &(&1.type == "validation_result"))
    assert first_validation.call_id == first_call_id
    assert first_validation.reason_code == "revision_scope_violation"
    assert Jason.encode!(first_validation.detail) =~ "不得新增或删除段落"

    assert result.tool_call_count == 1
    assert result.provider_call_count == 2

    stage_transcript = result.stage_state.judgment_transcript

    assert Enum.take(stage_transcript.messages, length(transcript.messages)) ==
             transcript.messages

    assert_canonical_author_invariance(transcript, stage_transcript, goal)
    assert_checkpoint_roundtrip(transcript)
    assert_checkpoint_roundtrip(stage_transcript)

    [revised] = result.turn_result.adoption_state.pending
    assert revised.artifact_id != source_id
    assert revised.payload.revision_of == source_id
    assert revised.payload.items |> hd() |> Map.get(:body) == valid
    refute result.turn_result.truthfulness.production_write_performed

    # 外层 result.stage_state 是内部 canonical；作者可见 TurnResult 不得夹带任何
    # canonical/Provider 私有结构（只查键，不检查作者正文字符串内容）。
    assert is_map(result.stage_state.judgment_transcript)
    refute_private_turn_result_keys(result.turn_result)

    record(c.work.id, c.session.id, result.turn_result)
    {:ok, shown} = WorkSessionService.show(c.work.id, c.session.id)

    assert Enum.any?(shown.pending_adoptions, &(&1.artifact_id == source_id))
    assert Enum.any?(shown.pending_adoptions, &(&1.artifact_id == revised.artifact_id))
    assert shown.resolved_adoptions == []
  end

  # 独立于前缀断言的私有状态边界：即使 canonical 前缀回归再次失败，也能直接看到
  # 作者 TurnResult 是否夹带内部会话。
  test "run/6：作者 TurnResult 不夹带内部会话/IR/Provider 私有状态", c do
    base = "第一段文字。\n第二段文字。\n\n第三段文字。"
    valid = "第一段文字！\n第二段文字。\n\n第三段文字。"
    goal = "整理第01章前两段的排版候选：只调标点和分段，别改字句"

    {source_id, "prose_writing"} =
      record_pending_artifact(c, :prose_fragment, item_for_prose(base))

    run = native_run(c, "prose_writing", goal: %{text: goal, version: 1})
    transcript = native_transcript(run, c, source_id)
    snapshot = native_snapshot(run, transcript)
    provider = revision_provider(:private_state, [valid])

    judgment = %{
      judgment(c, "revise_pending_artifact")
      | pending_artifact_ref: source_id,
        dialogue_goal: goal
    }

    assert {:ok, result} =
             PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider, snapshot)

    assert is_map(result.stage_state.judgment_transcript)
    refute Map.has_key?(result.turn_result, :stage_state)
    refute_private_turn_result_keys(result.turn_result)
  end

  test "run/6：预算仅剩 1 时 guard 拒绝不越界重试，失败会话保留真实 1/1", c do
    base = "第一段文字。\n第二段文字。\n\n第三段文字。"
    invalid = "第一段文字。\n\n第二段文字。\n\n第三段文字。"

    {source_id, "prose_writing"} =
      record_pending_artifact(c, :prose_fragment, item_for_prose(base))

    goal = "整理第01章前两段的排版候选：只调标点和分段，别改字句"

    run =
      native_run(c, "prose_writing",
        goal: %{text: goal, version: 1},
        budget: %{
          max_steps: 5,
          max_tool_calls: 4,
          max_provider_calls: 2,
          max_replans: 1,
          max_pending_artifacts: 3
        },
        consumed_budget: %{
          steps: 1,
          execution_steps: 1,
          tool_calls: 0,
          provider_calls: 1,
          replans: 0
        }
      )

    transcript = native_transcript(run, c, source_id)
    snapshot = native_snapshot(run, transcript)
    provider = revision_provider(:revision_budget, [invalid])

    judgment = %{
      judgment(c, "revise_pending_artifact")
      | pending_artifact_ref: source_id,
        dialogue_goal: goal
    }

    assert {:error, {:pending_artifact_invalid, :revision_scope_violation}, step_state} =
             PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider, snapshot)

    assert_received {:revision_budget, only}
    refute_received {:revision_budget, _extra}
    assert step_state.tool_call_count == 1
    assert step_state.provider_call_count == 1

    failed_transcript = step_state.judgment_transcript

    assert Enum.take(failed_transcript.messages, length(transcript.messages)) ==
             transcript.messages

    assert_canonical_author_invariance(transcript, failed_transcript, goal)

    # 失败修订同样必须让最后一次真实请求成为 canonical 投影的严格前缀；
    # 末尾真实 failed validation 不能被 scope 过滤吞掉。
    canonical_messages =
      assert_revision_canonical_boundary(failed_transcript, only, goal, base)

    assert Enum.map(Enum.drop(canonical_messages, length(only.messages)), & &1.role) == [
             "assistant",
             "tool"
           ]

    new_messages = Enum.drop(failed_transcript.messages, length(transcript.messages))

    # 修订 scope 是模型实际消费过的 canonical 消息，必须原样保留；之后只追加真实
    # assistant/tool 交换，不得混入新的作者 user 纠错。
    assert Enum.map(new_messages, & &1.role) == ["scope_update", "assistant", "tool"]
    refute Enum.any?(new_messages, &(&1.role == "user"))

    # 失败会话是 canonical blocks，不是 wire DTO；按 validation_result 的
    # call_id/status/reason_code 核对原调用已闭合，具体指引在 detail.message。
    assert [submit_call] = submit_tool_calls(new_messages)
    assert [failed_validation] = validation_results(new_messages)
    assert failed_validation.call_id == submit_call.call_id
    assert failed_validation.status == "failed"
    assert failed_validation.reason_code == "revision_scope_violation"
    assert failed_validation.detail["message"] =~ "不得新增或删除段落"

    assert_no_pending_calls(failed_transcript)
    assert_checkpoint_roundtrip(failed_transcript)
  end

  test "run/6：空 items 协议失败后布局越界，末次 guard 原因失败且不发起第三次", c do
    base = "第一段文字。\n第二段文字。\n\n第三段文字。"
    layout_invalid = "第一段文字。\n第二段文字。\n\n第四段文字。"

    {source_id, "prose_writing"} =
      record_pending_artifact(c, :prose_fragment, item_for_prose(base))

    goal = "整理第01章前两段的排版候选：只调标点和分段，别改字句"
    run = native_run(c, "prose_writing", goal: %{text: goal, version: 1})
    transcript = native_transcript(run, c, source_id)
    snapshot = native_snapshot(run, transcript)

    parent = self()
    Process.put(:mixed_revision_calls, 0)

    provider = %Execution{
      result_fn: fn prompt ->
        send(parent, {:mixed_revision, prompt})
        count = Process.get(:mixed_revision_calls) + 1
        Process.put(:mixed_revision_calls, count)

        if count > 2 do
          flunk("空 items 与布局越界合计两次后不得发起第三次 provider 调用")
        end

        arguments =
          case count do
            1 ->
              # 合法单工具调用，但输出契约缺 items。
              %{"items" => []}

            2 ->
              # schema 合法、单 call 合法；正文改了字句，违反“别改字句”。
              %{
                "items" => [
                  %{
                    item_id: "mixed-item",
                    title: "修订稿",
                    body: layout_invalid,
                    rationale: nil
                  }
                ]
              }
          end

        tool_calls =
          TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", arguments)

        {:ok,
         %NovelAgent.Provider.Result{
           content: "",
           tool_calls: tool_calls,
           provider_call_ref: "pcall-mixed-#{count}"
         }}
      end
    }

    judgment = %{
      judgment(c, "revise_pending_artifact")
      | pending_artifact_ref: source_id,
        dialogue_goal: goal
    }

    # 末次真实失败是应用 layout guard，不是首轮协议错误；若外层再发起第 3/4 次，
    # provider 会 flunk，计数也会越过 2。
    assert {:error, {:pending_artifact_invalid, :revision_scope_violation}, step_state} =
             PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider, snapshot)

    assert Process.get(:mixed_revision_calls) == 2
    assert step_state.tool_call_count == 1
    assert step_state.provider_call_count == 2

    assert_received {:mixed_revision, first}
    assert_received {:mixed_revision, second}
    assert_wire_author_identity(first, goal)
    assert_wire_author_identity(second, goal)
    assert Enum.take(second.messages, length(first.messages)) == first.messages

    canonical_messages =
      assert_revision_canonical_boundary(step_state.judgment_transcript, second, goal, base)

    assert Enum.map(Enum.drop(canonical_messages, length(second.messages)), & &1.role) == [
             "assistant",
             "tool"
           ]

    # 首次空 items 已按原 call_id 回流到第二次请求。
    retry_wire = Enum.drop(second.messages, length(first.messages))
    refute Enum.any?(retry_wire, &(&1.role == "user"))
    assert [retry_assistant] = Enum.filter(retry_wire, &(&1.role == "assistant"))
    assert [retry_call] = Enum.filter(retry_assistant.blocks, &(&1.type == "tool_call"))
    assert [retry_tool] = Enum.filter(retry_wire, &(&1.role == "tool"))
    retry_validation = Enum.find(retry_tool.blocks, &(&1.type == "validation_result"))
    assert retry_validation.call_id == retry_call.call_id
    assert retry_validation.reason_code =~ "empty_items"

    failed_transcript = step_state.judgment_transcript

    assert Enum.take(failed_transcript.messages, length(transcript.messages)) ==
             transcript.messages

    assert_canonical_author_invariance(transcript, failed_transcript, goal)

    new_messages = Enum.drop(failed_transcript.messages, length(transcript.messages))

    assert Enum.map(new_messages, & &1.role) == [
             "scope_update",
             "assistant",
             "tool",
             "assistant",
             "tool"
           ]

    refute Enum.any?(new_messages, &(&1.role == "user"))

    assert [first_call, second_call] = submit_tool_calls(new_messages)
    assert [first_validation, second_validation] = validation_results(new_messages)
    assert first_validation.call_id == first_call.call_id
    assert first_validation.status == "failed"
    assert first_validation.reason_code == "empty_items"
    assert is_binary(first_validation.detail["message"])
    assert second_validation.call_id == second_call.call_id
    assert second_validation.status == "failed"
    assert second_validation.reason_code == "revision_scope_violation"
    assert second_validation.detail["message"] =~ "不得改变任何字句内容"

    assert_no_pending_calls(failed_transcript)
    assert_checkpoint_roundtrip(failed_transcript)
  end

  test "run/6：目标不可用或 read-only 的前置拒绝保持 0/0 与 snapshot 历史", c do
    run = native_run(c, "world_building")
    transcript = native_transcript(run, c, c.target)
    snapshot = native_snapshot(run, transcript)
    provider = %Execution{result_fn: fn _ -> flunk("前置拒绝不得调用 provider") end}

    missing = %{
      judgment(c, "revise_pending_artifact")
      | pending_artifact_ref: "artifact-missing"
    }

    assert {:error, {:pending_artifact_invalid, :target_not_available}, unavailable_state} =
             PendingArtifactWorkflow.run(missing, %{}, run, c.context, provider, snapshot)

    assert unavailable_state.tool_call_count == 0
    assert unavailable_state.provider_call_count == 0
    assert unavailable_state.judgment_transcript.messages == transcript.messages

    {:ok, _archived} = WorkSessionRepo.archive(c.session)
    read_only_snapshot = native_snapshot(run, transcript, %{read_only: true})

    assert {:error, {:pending_artifact_invalid, reason}, read_only_state} =
             PendingArtifactWorkflow.run(
               judgment(c, "revise_pending_artifact"),
               %{},
               run,
               c.context,
               provider,
               read_only_snapshot
             )

    assert reason in [:target_not_available, :revision_not_allowed]
    assert read_only_state.tool_call_count == 0
    assert read_only_state.provider_call_count == 0
    assert read_only_state.judgment_transcript.messages == transcript.messages
  end

  test "run/6：归档后的当前只读会话拒绝旧活跃投影，旧 snapshot 不能重新授权", c do
    base = "第一段文字。\n第二段文字。\n\n第三段文字。"
    goal = "整理第01章前两段的排版候选：只调标点和分段，别改字句"

    {source_id, "prose_writing"} =
      record_pending_artifact(c, :prose_fragment, item_for_prose(base))

    run = native_run(c, "prose_writing", goal: %{text: goal, version: 1})
    transcript = native_transcript(run, c, source_id)

    # 先捕获真实活跃投影（read_only:false 且含 pending 候选），再归档会话。
    {:ok, fresh} = WorkSessionService.show(c.work.id, c.session.id)
    assert fresh.read_only == false
    assert Enum.any?(fresh.pending_adoptions, &(&1.artifact_id == source_id))

    stale_snapshot =
      native_snapshot(run, transcript)
      |> Map.merge(
        Map.take(fresh, [
          :work,
          :session,
          :read_only,
          :pending_adoptions,
          :pending_adoption_turn_results,
          :resolved_adoptions
        ])
      )

    {:ok, _archived} = WorkSessionRepo.archive(c.session)

    parent = self()

    provider = %Execution{
      result_fn: fn _prompt ->
        send(parent, :stale_provider_called)
        flunk("归档后的只读会话不得被旧 snapshot 重新开放")
      end
    }

    judgment = %{
      judgment(c, "revise_pending_artifact")
      | pending_artifact_ref: source_id,
        dialogue_goal: goal
    }

    assert {:error, {:pending_artifact_invalid, reason}, state} =
             PendingArtifactWorkflow.run(
               judgment,
               %{},
               run,
               c.context,
               provider,
               stale_snapshot
             )

    assert reason in [:target_not_available, :revision_not_allowed]
    assert state.tool_call_count == 0
    assert state.provider_call_count == 0
    refute_received :stale_provider_called
    assert state.judgment_transcript.messages == transcript.messages
  end

  test "run/6：持久会话查询失败时旧投影不能作为 fallback 授权", c do
    base = "第一段文字。\n第二段文字。\n\n第三段文字。"
    goal = "整理第01章前两段的排版候选：只调标点和分段，别改字句"

    {source_id, "prose_writing"} =
      record_pending_artifact(c, :prose_fragment, item_for_prose(base))

    run = native_run(c, "prose_writing", goal: %{text: goal, version: 1})
    transcript = native_transcript(run, c, source_id)
    missing_run = %{run | session_id: "missing-session"}

    {:ok, fresh} = WorkSessionService.show(c.work.id, c.session.id)

    stale_snapshot =
      native_snapshot(missing_run, transcript)
      |> Map.merge(
        Map.take(fresh, [
          :work,
          :session,
          :read_only,
          :pending_adoptions,
          :pending_adoption_turn_results,
          :resolved_adoptions
        ])
      )

    parent = self()

    provider = %Execution{
      result_fn: fn _prompt ->
        send(parent, :fallback_provider_called)
        flunk("持久会话查询失败时旧投影不得作为 fallback 授权")
      end
    }

    judgment = %{
      judgment(c, "revise_pending_artifact")
      | pending_artifact_ref: source_id,
        dialogue_goal: goal
    }

    assert {:error, {:pending_artifact_invalid, reason}, state} =
             PendingArtifactWorkflow.run(
               judgment,
               %{},
               missing_run,
               c.context,
               provider,
               stale_snapshot
             )

    assert reason in [:target_not_available, :revision_not_allowed]
    assert state.tool_call_count == 0
    assert state.provider_call_count == 0
    refute_received :fallback_provider_called
  end

  test "run/6：已采纳内容修订继承当前 run 历史并保持 revision_of/supersedes_ref", c do
    writer = fn attrs ->
      assert attrs.artifact_type == :world_setting
      assert attrs.supersedes_ref == nil

      {:ok,
       %{
         mutation_id: "mutation-native-revision",
         mutation_status: "APPLIED",
         memory_item_id: "memory-native-revision",
         memory_status: "CONFIRMED",
         source_revision_ref: "mutation:mutation-native-revision",
         reading_projection: nil
       }}
    end

    assert {:ok, _action, adopted} =
             AdoptionWorkflow.handle_adopt(
               c.source,
               %{"artifact_id" => c.target, "work_id" => c.work.id},
               writer
             )

    record(c.work.id, c.session.id, adopted)

    goal = "把沈砚改成林渡，其余不变"
    run = native_run(c, "world_building", goal: %{text: goal, version: 1})
    transcript = native_transcript(run, c, c.target)
    snapshot = native_snapshot(run, transcript)
    body = "林渡经营旧书铺。"
    provider = revision_provider(:adopted_history, [body])

    judgment = %{
      capability: "revise_adopted_content",
      adopted_content_ref: c.target,
      pending_artifact_ref: nil,
      dialogue_goal: "把沈砚改成林渡，其余保持不变。",
      narrative: "我会生成一份修订候选，你确认后才替代旧版。"
    }

    assert {:ok, result} =
             PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider, snapshot)

    assert_received {:adopted_history, prompt}
    assert_wire_author_identity(prompt, goal)
    assert result.tool_call_count == 1
    assert result.provider_call_count == 1

    stage_transcript = result.stage_state.judgment_transcript

    assert Enum.take(stage_transcript.messages, length(transcript.messages)) ==
             transcript.messages

    assert_canonical_author_invariance(transcript, stage_transcript, goal)

    new_messages = Enum.drop(stage_transcript.messages, length(transcript.messages))
    refute Enum.any?(new_messages, &(&1.role == "user"))

    assert_checkpoint_roundtrip(stage_transcript)

    [revised] = result.turn_result.adoption_state.pending
    assert revised.payload.revision_of == c.target
    assert revised.payload.supersedes_ref == "memory-native-revision"
    assert revised.payload.revision_target_status == "ACCEPTED"
    assert revised.payload.items |> hd() |> Map.get(:body) == body
    refute Map.get(revised.payload, :canon_written, false)
    refute result.turn_result.truthfulness.production_write_performed

    record(c.work.id, c.session.id, result.turn_result)
    {:ok, shown} = WorkSessionService.show(c.work.id, c.session.id)

    assert Enum.any?(
             shown.resolved_adoptions,
             &(&1.artifact_id == c.target and &1.adoption_status == "ACCEPTED")
           )

    assert Enum.any?(shown.pending_adoptions, &(&1.artifact_id == revised.artifact_id))
  end

  defp native_run(c, tool, opts \\ []) do
    goal = Keyword.get(opts, :goal, c.run.goal)

    budget =
      Keyword.get(opts, :budget, %{
        max_steps: 5,
        max_tool_calls: 4,
        max_provider_calls: 6,
        max_replans: 1,
        max_pending_artifacts: 3
      })

    consumed_budget =
      Keyword.get(opts, :consumed_budget, %{
        steps: 0,
        execution_steps: 0,
        tool_calls: 0,
        provider_calls: 0,
        replans: 0
      })

    {:ok, run} =
      AgentRun.new(%{
        run_id: c.run.run_id,
        run_mode: :bounded,
        profile_ref: c.run.profile_ref,
        workspace_id: c.work.id,
        work_id: c.work.id,
        session_id: c.session.id,
        parent_turn_ref: c.run.parent_turn_ref,
        origin_frame_ref: "frame-native-revision",
        goal: goal,
        authority_scope: %{production_write: false, allowed_tools: [tool]},
        budget: budget,
        consumed_budget: consumed_budget
      })

    run
  end

  defp native_transcript(run, c, artifact_ref) do
    call_id = "call-judgment-#{System.unique_integer([:positive, :monotonic])}"

    # 复用现役探索面读取真实候选 ref 与来源；不发明 read_candidate 之类的历史工具。
    observation =
      case NovelApplication.ExplorationService.run(
             c.work.id,
             "session_adoptions",
             artifact_ref,
             c.session.id
           ) do
        {:ok, observation} -> observation
        {:error, reason} -> flunk("无法读取真实候选来源: #{inspect(reason)}")
      end

    assert observation.refs != []

    transcript =
      AuthoringTranscript.new(run,
        base_text: "判断阶段只核对候选事实；不写 canon。",
        author_text: run.goal.text,
        author_turn_ref: run.parent_turn_ref,
        tools: NovelApplication.JudgmentToolContract.tools(:judgment)
      )
      |> AuthoringTranscript.append_assistant("", [
        RequestIR.tool_call_block(
          "judgment_decision",
          %{
            "action" => "explore",
            "dialogue_goal" => run.goal.text,
            "reason" => "核对已有候选的真实 ref 与来源",
            "explore_request" => %{
              "tool" => "session_adoptions",
              "query" => artifact_ref
            }
          },
          call_id
        )
      ])

    transcript =
      NovelApplication.JudgmentProtocol.observation_transcript(
        transcript,
        %{tool_call_id: call_id},
        observation
      )

    transcript = AuthoringTranscript.declare_used_refs(transcript, observation.refs)

    assert {:ok, _ir} = AuthoringTranscript.to_request_ir(transcript)

    # 这里直接返回真实 producer 的 fresh canonical 历史作为运行快照：
    # 不预先 JSON 往返、不手工规范化 refs，共享恢复 bug 必须在本测试里真实暴露。
    transcript
  end

  defp native_snapshot(run, transcript, overrides \\ %{}) do
    Map.merge(
      %{run: run, read_only: false, stage_state: %{judgment_transcript: transcript}},
      overrides
    )
  end

  defp revision_provider(tag, bodies) do
    parent = self()
    bodies_key = {tag, :bodies}
    count_key = {tag, :count}
    Process.put(bodies_key, bodies)
    Process.put(count_key, 0)

    %Execution{
      result_fn: fn prompt ->
        send(parent, {tag, prompt})

        case Process.get(bodies_key) do
          [body | rest] ->
            Process.put(bodies_key, rest)
            count = Process.get(count_key) + 1
            Process.put(count_key, count)

            tool_calls =
              TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
                items: [%{item_id: "revised-#{tag}", title: "修订稿", body: body, rationale: nil}]
              })

            {:ok,
             %NovelAgent.Provider.Result{
               content: "",
               tool_calls: tool_calls,
               provider_call_ref: "pcall-#{tag}-#{count}"
             }}

          [] ->
            flunk("unexpected extra provider call: #{tag}")
        end
      end
    }
  end

  @private_turn_result_keys ~w(
    stage_state judgment_transcript request_ir provider_session provider_result
    reasoning_content provider_state raw_arguments call_ids base_refs
    observation_refs used_refs
  )

  defp assert_revision_canonical_boundary(transcript, last_prompt, goal, base_body) do
    assert {:ok, canonical_ir} = AuthoringTranscript.to_request_ir(transcript)
    canonical_messages = canonical_ir.messages

    assert length(canonical_messages) > length(last_prompt.messages)
    assert Enum.take(canonical_messages, length(last_prompt.messages)) == last_prompt.messages

    scope =
      Enum.find(transcript.messages, fn message ->
        Map.get(message, :role) == "scope_update" and
          canonical_message_text(message) =~ "本轮修订已有候选"
      end)

    assert scope, "修订 scope 必须保留在 canonical transcript 中"

    scope_text = canonical_message_text(scope)

    assert scope_text =~ "本轮修订已有候选"
    assert scope_text =~ "以给定原候选为唯一基线"
    assert scope_text =~ "作者要求仅排版/分段/标点"
    assert scope_text =~ goal
    assert scope_text =~ "原候选全文（仅供修订，不是已确认作品事实）：\n" <> base_body

    assert_canonical_arguments_bytes(transcript)

    canonical_messages
  end

  defp assert_canonical_arguments_bytes(transcript) do
    canonical_calls = submit_tool_calls(transcript.messages)
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, body} = Projection.project(ir, "chat_completions")

    wire_calls =
      for message <- body.messages,
          call <- Map.get(message, :tool_calls, []),
          get_in(call, [:function, :name]) == "submit_tentative_artifact",
          do: call

    assert length(wire_calls) == length(canonical_calls)

    Enum.zip(canonical_calls, wire_calls)
    |> Enum.each(fn {block, wire_call} ->
      expected =
        Map.get(block, :raw_arguments) ||
          Jason.encode!(Projection.json_value(Map.get(block, :arguments, %{})))

      assert get_in(wire_call, [:function, :arguments]) == expected
    end)
  end

  defp refute_private_turn_result_keys(value, path \\ []) do
    cond do
      is_map(value) ->
        Enum.each(value, fn {key, child} ->
          key = to_string(key)

          refute key in @private_turn_result_keys,
                 "作者可见 TurnResult 泄露私有键 #{Enum.join(path ++ [key], ".")}"

          refute_private_turn_result_keys(child, path ++ [key])
        end)

      is_list(value) ->
        value
        |> Enum.with_index()
        |> Enum.each(fn {child, index} ->
          refute_private_turn_result_keys(child, path ++ [Integer.to_string(index)])
        end)

      true ->
        :ok
    end
  end

  defp assert_wire_author_identity(prompt, goal) do
    authors =
      prompt.messages
      |> Enum.filter(&(&1.role == "user" and &1.provenance == "author"))
      |> Enum.map(&canonical_message_text/1)

    application_messages =
      Enum.filter(prompt.messages, &(&1.role in ["application_base", "scope_update"]))

    # canonical 上只有一条独立作者原话；应用消息使用自己的 role/provenance，
    # 不能冒充第二条作者 user。
    assert authors == [goal]
    assert application_messages != []
    assert Enum.all?(application_messages, &(&1.provenance == "application"))
  end

  defp assert_canonical_author_invariance(before_transcript, after_transcript, goal) do
    before_authors = canonical_author_messages(before_transcript)

    assert Enum.map(before_authors, &canonical_message_text/1) == [goal]
    assert canonical_author_messages(after_transcript) == before_authors
  end

  defp canonical_author_messages(transcript) do
    Enum.filter(transcript.messages, &(&1.role == "user" and &1.provenance == "author"))
  end

  defp canonical_message_text(%{blocks: blocks}) do
    blocks
    |> Enum.filter(&(&1.type == "text"))
    |> Enum.map_join("", & &1.text)
  end

  defp submit_tool_calls(messages) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) == "tool_call",
        Map.get(block, :name) == "submit_tentative_artifact",
        do: block
  end

  defp validation_results(messages) do
    for message <- messages,
        block <- Map.get(message, :blocks, []),
        Map.get(block, :type) == "validation_result",
        do: block
  end

  defp assert_no_pending_calls(transcript) do
    assert {:ok, ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, []} = RequestIR.pending_call_ids(ir)
  end

  defp assert_checkpoint_roundtrip(transcript) do
    checkpoint =
      transcript
      |> AuthoringTranscript.checkpoint()
      |> Jason.encode!()
      |> Jason.decode!()

    assert {:ok, restored} = AuthoringTranscript.restore(checkpoint)
    assert {:ok, original_ir} = AuthoringTranscript.to_request_ir(transcript)
    assert {:ok, restored_ir} = AuthoringTranscript.to_request_ir(restored)

    assert Projection.project(restored_ir, "chat_completions") ==
             Projection.project(original_ir, "chat_completions")
  end
end
