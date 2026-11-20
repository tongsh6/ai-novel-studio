defmodule NovelApplication.B30ChapterStructureMaintenanceTest do
  use ExUnit.Case, async: false

  import Ecto.Query

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution

  alias NovelApplication.{
    CapabilityRegistry,
    ChapterStructureMaintenance,
    PendingArtifactWorkflow,
    WorkService
  }

  alias NovelDomain.DialogueContext
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Volume
  alias NovelPersistence.WorkSessionRepo

  @v1 "volume:11111111-1111-1111-1111-111111111111"
  @v2 "volume:22222222-2222-2222-2222-222222222222"

  defp facts do
    %{
      work_id: "work-1",
      base_revision: 7,
      volume_ref: nil,
      volumes: [
        %{volume_ref: @v1, title: "第一卷：觉醒", seq: 1, blueprint_ref: nil},
        %{volume_ref: @v2, title: "第二卷：裂变", seq: 2, blueprint_ref: nil}
      ],
      chapters: [
        chapter("chapter:aaaa1111-1111-1111-1111-111111111111", @v1, 1, "第01章：初夜"),
        chapter("chapter:bbbb2222-2222-2222-2222-222222222222", @v2, 3, "第11章：外门名册上的空白"),
        chapter("chapter:cccc3333-3333-3333-3333-333333333333", @v2, 4, "第12章：旧钱与旧名"),
        chapter("chapter:dddd4444-4444-4444-4444-444444444444", @v2, 5, "第13章：卷末")
      ]
    }
  end

  defp chapter(ref, volume_ref, seq, title, version \\ 2) do
    %{
      chapter_ref: ref,
      volume_ref: volume_ref,
      seq: seq,
      title: title,
      version: version,
      content_hash: "hash-#{seq}",
      content_chars: 100,
      accepted_draft_refs: ["draft:#{ref}:1"],
      accepted_summary_refs: [],
      status: "PLANNED"
    }
  end

  test "能力注册：maintain_chapter_structure 效果与 plot_outline/prose_writing 严格区分" do
    entry = CapabilityRegistry.get("maintain_chapter_structure")

    assert entry
    assert entry.provider_dependency == :none
    assert entry.write_scopes == ["chapter_structure"]
    assert entry.status == :active
    assert entry.effect_summary =~ "只维护既有章结构"
    assert entry.effect_summary =~ "不生成大纲"
    assert entry.effect_summary =~ "不新建章"
    assert entry.effect_summary =~ "不改 title/正文/归卷/章数"

    assert "maintain_chapter_structure" in CapabilityRegistry.list()

    # 与既有创作能力不是同一条目
    refute CapabilityRegistry.get("maintain_chapter_structure") ==
             CapabilityRegistry.get("plot_outline")

    refute CapabilityRegistry.get("maintain_chapter_structure") ==
             CapabilityRegistry.get("prose_writing")
  end

  test "第2卷编号理顺：按卷内阅读顺序生成连续 seq（3/4/5 → 2/3/4）" do
    assert {:ok, plan} = ChapterStructureMaintenance.change_plan("把第2卷章节编号理顺，内容不要动", facts())

    assert plan.operation == "renumber_chapters"
    assert plan.effects == ["display_number_only"]
    assert plan.object_count == 3

    assert plan.mapping == [
             %{
               chapter_ref: "chapter:bbbb2222-2222-2222-2222-222222222222",
               expected_seq: 3,
               expected_version: 2,
               from_seq: 3,
               to_seq: 2
             },
             %{
               chapter_ref: "chapter:cccc3333-3333-3333-3333-333333333333",
               expected_seq: 4,
               expected_version: 2,
               from_seq: 4,
               to_seq: 3
             },
             %{
               chapter_ref: "chapter:dddd4444-4444-4444-4444-444444444444",
               expected_seq: 5,
               expected_version: 2,
               from_seq: 5,
               to_seq: 4
             }
           ]

    assert plan.base_versions == [
             %{chapter_ref: "chapter:bbbb2222-2222-2222-2222-222222222222", version: 2},
             %{chapter_ref: "chapter:cccc3333-3333-3333-3333-333333333333", version: 2},
             %{chapter_ref: "chapter:dddd4444-4444-4444-4444-444444444444", version: 2}
           ]

    # 标题历史章号与真实 seq 错位 → warning（不重写 title）
    assert Enum.any?(plan.warnings, &String.contains?(&1, "title_number_mismatch"))
    assert Enum.any?(plan.warnings, &String.contains?(&1, "标题章号=11 但 seq=3"))
  end

  test "点名两章对调：只交换指定章的 seq，不重排其它章" do
    assert {:ok, plan} =
             ChapterStructureMaintenance.change_plan(
               "把第二卷的第11章和第12章编号对调，内容不要动",
               facts()
             )

    assert plan.mapping == [
             %{
               chapter_ref: "chapter:bbbb2222-2222-2222-2222-222222222222",
               expected_seq: 3,
               expected_version: 2,
               from_seq: 3,
               to_seq: 4
             },
             %{
               chapter_ref: "chapter:cccc3333-3333-3333-3333-333333333333",
               expected_seq: 4,
               expected_version: 2,
               from_seq: 4,
               to_seq: 3
             }
           ]

    assert plan.object_count == 2
  end

  test "越界卷/无目标给出可解释错误（不猜、不生成大纲）" do
    assert {:error, :out_of_range} =
             ChapterStructureMaintenance.change_plan("把不存在的第九卷章节编号理顺，内容不要动", facts())

    assert {:error, :no_target} =
             ChapterStructureMaintenance.change_plan(
               "把第二卷章节编号理顺，内容不要动",
               %{facts() | chapters: []}
             )
  end

  test "未确认零写入：维护判断产出可审阅 change plan 候选（无 provider/无写入）" do
    judgment = %{
      action: "execute",
      capability: "maintain_chapter_structure",
      narrative: "我会先给出第2卷的旧→新编号变更计划，待你确认后再改。",
      dialogue_goal: "把第2卷章节编号理顺，内容不要动",
      reason: "章节结构维护",
      frame_type: "execution_candidate",
      candidate_directions: [],
      pending_artifact_ref: nil,
      adopted_content_ref: nil,
      question: nil,
      options: [],
      reason_codes: [],
      guidance: nil,
      missing_effect: nil,
      author_content_source_ref: nil,
      explore_request: nil,
      plan_result: nil,
      tool_call_id: nil,
      model_interpretation_status: "provided"
    }

    run =
      run("work-1", "session-1", %{
        turn_id: "turn-b30",
        text: "把第2卷章节编号理顺，内容不要动"
      })

    context = %DialogueContext{work_id: "work-1", interaction_state: %{}}
    provider = %Execution{result_fn: fn _ -> flunk("结构维护不得调用 provider") end}

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment,
               %{"chapter_structure_context" => facts()},
               run,
               context,
               provider
             )

    assert result.provider_call_count == 0
    [pending] = result.turn_result.adoption_state.pending

    assert pending.artifact_type == :chapter_structure_change_plan
    assert pending.adoption_status == NovelDomain.AdoptionStatus.initial()

    payload = pending.payload
    plan = Map.get(payload, :change_plan) || Map.get(payload, "change_plan")

    assert Map.get(payload, :object_kind) == "chapter_structure_change_plan"
    assert Map.get(payload, :title) == "章节重编号变更计划（3 章）"
    assert plan.operation == "renumber_chapters"
    assert plan.effects == ["display_number_only"]
    assert plan.object_count == 3
    assert Enum.map(plan.mapping, &{&1.from_seq, &1.to_seq}) == [{3, 2}, {4, 3}, {5, 4}]
    assert length(plan.base_versions) == 3
    assert Enum.any?(plan.warnings, &String.contains?(&1, "title_number_mismatch"))

    # 候选 body 是作者可审阅的旧→新编号差异，不含正文改写
    [item] = Map.get(payload, :items)
    assert item.body =~ "第3章 → 第2章"
    assert item.body =~ "章节标题/正文/归卷/章数不变" or item.rationale =~ "标题/正文/归卷/章数不变"
  end

  describe "持久维护候选的 trace 与写入边界" do
    setup do
      :ok = Sandbox.checkout(Repo)
      :ok = Sandbox.mode(Repo, {:shared, self()})
      {:ok, work} = WorkService.create(%{title: "B30 章节维护"})
      {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)
      author_input = %{turn_id: "turn-b30", text: "把第2卷章节编号理顺，内容不要动"}

      %{
        work: work,
        author_input: author_input,
        run: run(work.id, session.id, author_input),
        context: %DialogueContext{work_id: work.id, interaction_state: %{}}
      }
    end

    test "B30 维护分支：trace 完整构造持久化不 crash，产出 change plan 候选且零写入", c do
      volume = Repo.insert!(%Volume{work_id: c.work.id, title: "第二卷", seq: 2})

      for {title, seq} <- [{"第11章：甲", 11}, {"第12章：乙", 12}, {"第13章：丙", 13}] do
        Repo.insert!(%Chapter{work_id: c.work.id, volume_id: volume.id, title: title, seq: seq})
      end

      goal_text = "把第2卷章节编号理顺，内容不要动"
      run = %{c.run | goal: %{text: goal_text, version: 1}}

      narrative = "我会生成第2卷章节重编号的可审阅变更计划。"

      source = %{
        source_type: "provider_output_tool_narrative",
        provider_call_ref: "pcall-structure-candidate",
        provider_run_ref: "prun-structure-candidate",
        provider_output_ref: "prun-structure-candidate",
        tool_call_name: "judgment_decision",
        tool_call_narrative_field: "reason",
        source_byte_range: %{start: 0, length: 61},
        source_hash: "2257d639aa5569cb29a846045c136a86f3ccd0f17904d2fc02cbbc5a1606950d",
        narrative_hash: "2257d639aa5569cb29a846045c136a86f3ccd0f17904d2fc02cbbc5a1606950d"
      }

      judgment = %{
        action: "execute",
        capability: "maintain_chapter_structure",
        dialogue_goal: goal_text,
        narrative: narrative,
        narrative_source: source,
        reply_record: %{author_narrative_source: source, raw_content: narrative}
      }

      before = chapter_rows(c.work.id)

      parent = self()

      provider = %Execution{
        result_fn: fn _request ->
          args =
            judgment
            |> Map.take([:action, :capability, :dialogue_goal])
            |> Map.put(:reason, narrative)

          {:ok,
           %NovelAgent.Provider.Result{
             content: "",
             tool_calls:
               NovelApplication.TestAgenticLoopFixtures.native_tool_calls(
                 "judgment_decision",
                 args
               ),
             provider_call_ref: source.provider_call_ref,
             provider_run_ref: source.provider_run_ref
           }}
        end
      }

      input =
        Map.merge(c.author_input, %{
          text: goal_text,
          workspace_id: c.work.id,
          work_id: c.work.id,
          session_id: run.session_id,
          interaction_store: &NovelPersistence.InteractionLifecycle.call/2
        })

      assert {:ok, spec} =
               NovelApplication.DialoguePlanningService.plan_agent_run(
                 input,
                 NovelPersistence.WorkspaceContext.context_fetcher_with_query(),
                 provider
               )

      attrs =
        NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, fn event ->
          send(parent, {:maintenance_event, event})
        end)

      assert {:ok, run_id} =
               NovelApplication.AgentRunService.start_bounded(attrs,
                 interaction_input: spec.interaction_input,
                 interaction_store: spec.interaction_store,
                 next_step_planner: spec.next_step_planner
               )

      NovelApplication.TestAgentRunCleanup.register_run(run_id)
      assert_receive {:maintenance_event, %{event_type: :run_completed}}, 5_000
      assert {:ok, state} = NovelApplication.AgentRunService.state(run_id)
      result = state.final_turn_result

      assert_receive {:maintenance_event,
                      %{event_type: :artifact_created, payload: %{turn_result: broadcast}}}

      assert broadcast == result
      assert state.run.consumed_budget.provider_calls == 1
      assert state.run.consumed_budget.tool_calls == 0

      [pending] = result.adoption_state.pending
      assert pending.payload.object_kind == "chapter_structure_change_plan"
      assert pending.payload.change_plan.object_count == 3
      assert pending.payload.change_plan.effects == ["display_number_only"]
      assert result.assistant_message.text == narrative

      assert get_in(result, [:trace_summary, :reply_record, :author_narrative_source]) ==
               source

      assert {:ok, shown} = NovelApplication.WorkSessionService.show(c.work.id, run.session_id)
      assert [restored] = Enum.filter(shown.transcript, &(&1.role == "assistant"))
      assert restored.turn_result["assistant_message"]["text"] == narrative

      assert get_in(restored.turn_result, [
               "trace_summary",
               "reply_record",
               "author_narrative_source"
             ]) ==
               Jason.decode!(Jason.encode!(source))

      # 只产出候选：章节身份/序号零变化，未生产写入。
      assert chapter_rows(c.work.id) == before
      refute Map.get(result.truthfulness || %{}, :production_write_performed, false)
    end

    test "B30 维护负例：越界目标 → 作者可见拒绝（非内部错误）、零写入、无候选", c do
      volume = Repo.insert!(%Volume{work_id: c.work.id, title: "第二卷", seq: 2})

      for {title, seq} <- [{"第11章：甲", 11}, {"第12章：乙", 12}] do
        Repo.insert!(%Chapter{work_id: c.work.id, volume_id: volume.id, title: title, seq: seq})
      end

      goal_text = "把第九卷章节编号理顺，内容不要动"
      run = %{c.run | goal: %{text: goal_text, version: 1}}

      narrative = "作者点名了不存在的卷。"

      source = %{
        source_type: "provider_output_tool_narrative",
        provider_call_ref: "pcall-structure-refusal",
        provider_run_ref: "prun-structure-refusal",
        provider_output_ref: "prun-structure-refusal",
        tool_call_name: "judgment_decision",
        tool_call_narrative_field: "reason",
        source_byte_range: %{start: 0, length: 33},
        source_hash: "0a96e43612ec123ff1414c414f7e72fd7cfc8f497fb44b14bfe857d4ccf18605",
        narrative_hash: "0a96e43612ec123ff1414c414f7e72fd7cfc8f497fb44b14bfe857d4ccf18605"
      }

      judgment = %{
        action: "execute",
        capability: "maintain_chapter_structure",
        dialogue_goal: goal_text,
        narrative: narrative,
        narrative_source: source,
        reply_record: %{author_narrative_source: source, raw_content: narrative}
      }

      before = chapter_rows(c.work.id)

      parent = self()

      provider = %Execution{
        result_fn: fn _request ->
          args =
            judgment
            |> Map.take([:action, :capability, :dialogue_goal])
            |> Map.put(:reason, narrative)

          {:ok,
           %NovelAgent.Provider.Result{
             content: "",
             tool_calls:
               NovelApplication.TestAgenticLoopFixtures.native_tool_calls(
                 "judgment_decision",
                 args
               ),
             provider_call_ref: source.provider_call_ref,
             provider_run_ref: source.provider_run_ref
           }}
        end
      }

      input =
        Map.merge(c.author_input, %{
          text: goal_text,
          workspace_id: c.work.id,
          work_id: c.work.id,
          session_id: run.session_id,
          interaction_store: &NovelPersistence.InteractionLifecycle.call/2
        })

      assert {:ok, spec} =
               NovelApplication.DialoguePlanningService.plan_agent_run(
                 input,
                 NovelPersistence.WorkspaceContext.context_fetcher_with_query(),
                 provider
               )

      attrs =
        NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, fn event ->
          send(parent, {:maintenance_event, event})
        end)

      assert {:ok, run_id} =
               NovelApplication.AgentRunService.start_bounded(attrs,
                 interaction_input: spec.interaction_input,
                 interaction_store: spec.interaction_store,
                 next_step_planner: spec.next_step_planner
               )

      NovelApplication.TestAgentRunCleanup.register_run(run_id)
      assert_receive {:maintenance_event, %{event_type: :run_completed}}, 5_000
      assert {:ok, state} = NovelApplication.AgentRunService.state(run_id)
      result = state.final_turn_result

      assert_receive {:maintenance_event,
                      %{event_type: :turn_result_ready, payload: %{turn_result: broadcast}}}

      assert broadcast == result
      assert state.run.consumed_budget.provider_calls == 1
      assert state.run.consumed_budget.tool_calls == 0

      assert %{assistant_message: %{text: text}} = result
      assert text =~ "超出当前作品结构"
      refute text == narrative
      refute Map.has_key?(result.trace_summary, :reply_record)
      assert {:ok, shown} = NovelApplication.WorkSessionService.show(c.work.id, run.session_id)
      assert [restored] = Enum.filter(shown.transcript, &(&1.role == "assistant"))
      assert restored.turn_result["assistant_message"]["text"] =~ "超出当前作品结构"
      refute Map.has_key?(restored.turn_result["trace_summary"], "reply_record")
      assert state.run.pending_artifact_refs == []
      assert chapter_rows(c.work.id) == before
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

      assert {:ok, result} =
               PendingArtifactWorkflow.run(
                 judgment,
                 %{c.author_input | text: goal_text},
                 run,
                 c.context,
                 nil
               )

      assert %{assistant_message: %{text: text}} = result.turn_result
      assert text =~ "没有找到要重编号的目标章节"
      assert result.artifact_refs == []
    end
  end

  defp run(work_id, session_id, author_input) do
    %{
      run_id: "run-b30-structure",
      run_mode: :bounded,
      profile_ref: "judgment_loop_v1",
      budget: %{max_tool_calls: 2, max_provider_calls: 2},
      consumed_budget: %{},
      authority_scope: %{production_write: false, allowed_tools: ["judgment"]},
      workspace_id: work_id,
      work_id: work_id,
      session_id: session_id,
      parent_turn_ref: author_input.turn_id,
      goal: %{text: author_input.text, version: 1}
    }
  end

  defp chapter_rows(work_id) do
    from(ch in Chapter, where: ch.work_id == ^work_id, order_by: ch.seq)
    |> Repo.all()
    |> Enum.map(&{&1.id, &1.seq, &1.title, &1.volume_id})
  end
end
