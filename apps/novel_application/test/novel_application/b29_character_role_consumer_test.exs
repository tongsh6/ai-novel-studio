defmodule NovelApplication.B29CharacterRoleConsumerTest do
  use ExUnit.Case, async: true

  alias NovelApplication.JudgmentProtocol

  test "判断固定规则保留主档案身份优先级，但不把未请求的角色材料塞入 Scope" do
    request =
      JudgmentProtocol.request_for_production(%{
        author_text: "根据本章实际内容判断",
        scope: %{facts: %{}, context: %{}, coverage: %{}},
        source_input_ref: "author-turn",
        supplied_context_refs: [],
        options: [
          capabilities: ["revise_character_profile"],
          plan_run: %{run_id: "run-b29-character-role"}
        ]
      })

    content = NovelApplication.TestAgenticLoopFixtures.prompt_text(request)
    scope = NovelTest.TestProviderPrompt.scope_content(request)

    refute Map.has_key?(scope["facts"], "characters")
    assert content =~ "Character 主档案 narrative_role 为当前事实"
    assert content =~ "记忆/摘要中的"
    assert content =~ "旧主角描述只是历史参考"
    assert content =~ "多主角照实全列，无主角诚实说明"
  end
end

defmodule NovelApplication.B29CharacterRoleConsumerRefreshTest do
  use NovelPersistence.DataCase, async: false

  alias NovelAgent.Provider.Execution
  alias NovelApplication.{AgentRunService, DialoguePlanningService, TestAgenticLoopFixtures}

  alias NovelApplication.{
    CharacterProfile,
    CharacterRosterNarration,
    ExplorationService,
    WorkService
  }

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{AgentRunLog, Repo, WorkArchiveRepo, WorkSessionRepo}
  alias NovelPersistence.Schemas.{Character, Work}

  @role_narrative "灯笺731：我已核对老沈的身份。\n保留这段说明的原始换行。"

  setup do
    {:ok, work} = WorkService.create(%{title: "B29 角色交付"})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)
    %{work: work, session: session}
  end

  @tag :scope_archive_index
  test "memory_recall 的角色关键词不暗读主档案或塞入无角色来源的当前事实" do
    {:ok, work} = WorkService.create(%{title: "记忆与人物来源分离"})

    character =
      Repo.insert!(%NovelPersistence.Schemas.Character{
        work_id: work.id,
        name: "只能主动查档案才可见的人物",
        narrative_role: "PROTAGONIST",
        status: "ACCEPTED"
      })

    assert {:ok, observation} = ExplorationService.run(work.id, "memory_recall", "谁是主角")
    assert observation.refs == []
    assert observation.outcome == :empty_result
    refute observation.summary =~ character.name
    refute observation.summary =~ "当前角色主档案"
  end

  test "采纳 narrative_role 后：主档案读端口/roster 同批返回新值，旧值不留当前事实" do
    work = Repo.insert!(%Work{title: "B29 消费者一致性"})

    character =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "沈砚",
        aliases: ["老沈"],
        role: "查账人",
        summary: "灯楼查账人",
        narrative_role: "ENSEMBLE_POV",
        status: AdoptionStatus.accepted()
      })

    # 采纳前：判断/写作共用读端口看到旧值
    assert {:ok, [before]} = CharacterProfile.targets(work.id)
    assert before.character_ref == "character:#{character.id}"
    assert before.narrative_role == "ENSEMBLE_POV"
    assert before.base_fingerprint != nil

    # 采纳字段修订（等价 CP2 原子 update；这里只改主档案字段）
    assert {:ok, _updated} =
             character
             |> Ecto.Changeset.change(%{narrative_role: "PROTAGONIST"})
             |> Repo.update()

    # 刷新/重开：同一读端口立即返回新值，角色数/id 不变
    assert {:ok, [after_character]} = CharacterProfile.targets(work.id)
    assert after_character.character_ref == before.character_ref
    assert after_character.narrative_role == "PROTAGONIST"
    assert length(CharacterProfile.targets(work.id) |> elem(1)) == 1

    # 档案/StructurePanel 同源读取（WorkArchiveRepo.characters）也已经是新值
    archive_characters = WorkArchiveRepo.characters(work.id)
    assert [%{narrative_role: "PROTAGONIST", name: "沈砚"}] = archive_characters

    # 花名册叙述以主档案为当前事实
    message = CharacterRosterNarration.message(archive_characters)
    assert message =~ "当前作品的主角是 沈砚"
    refute message =~ "还没有谁被标记为主角"
  end

  @tag :r05_role_handoff
  test "确定性角色候选经 DPS 和真实 runtime 交付，缺省 metadata 不导致失败", c do
    {state, source, before} = run_character_profile(c, "ENSEMBLE_POV")
    assert [pending] = state.final_turn_result.adoption_state.pending
    assert pending.artifact_type == :character_profile_revision
    assert pending.adoption_status == "TENTATIVE"
    assert pending.payload.character_ref == "character:#{source.id}"

    assert pending.payload.changes == [
             %{field: "narrative_role", old: "ENSEMBLE_POV", new: "PROTAGONIST"}
           ]

    assert pending.payload.other_character_changes == []
    assert state.run.pending_artifact_refs == [pending.artifact_id]
    assert {:ok, shown} = NovelApplication.WorkSessionService.show(c.work.id, c.session.id)
    assert [persisted] = shown.pending_adoptions
    assert persisted.artifact_id == pending.artifact_id
    assert persisted.adoption_status == "TENTATIVE"
    assert NovelPersistence.Repo.all(NovelPersistence.Schemas.Character) == before
    refute state.final_turn_result.truthfulness.production_write_performed
    refute state.final_turn_result.truthfulness.artifact_adopted
  end

  @tag :r05_role_handoff
  test "已是主角的确定性 no_change 经 DPS 正常完成且不制造候选", c do
    {state, _source, before} = run_character_profile(c, "PROTAGONIST")
    assert state.run.pending_artifact_refs == []
    refute Map.get(state.final_turn_result, :adoption_state)
    assert state.final_turn_result.available_actions == []
    assert state.final_turn_result.assistant_message.text == @role_narrative
    assert [card] = state.final_turn_result.ui_cards
    assert card.card_type == "result_card"
    assert card.title == "系统核对结果"
    assert card.body =~ "沈砚"
    assert card.body =~ "老沈"
    assert card.body =~ "主角"
    refute card.body =~ "PROTAGONIST"
    refute card.body =~ "character:"

    for _delivery <- 1..2 do
      assert {:ok, shown} = NovelApplication.WorkSessionService.resume(c.work.id)
      assert shown.pending_adoptions == []
      assert [restored] = Enum.filter(shown.transcript, &(&1.role == "assistant"))
      assert restored.turn_result["assistant_message"]["text"] == @role_narrative
      assert restored.turn_result["ui_cards"] == [Jason.decode!(Jason.encode!(card))]
    end

    assert NovelPersistence.Repo.all(NovelPersistence.Schemas.Character) == before
    refute state.final_turn_result.truthfulness.production_write_performed
  end

  defp run_character_profile(c, initial_role) do
    source =
      NovelPersistence.Repo.insert!(%NovelPersistence.Schemas.Character{
        work_id: c.work.id,
        name: "沈砚",
        aliases: ["老沈"],
        role: "灯楼查账人",
        narrative_role: initial_role,
        summary: "熟悉灯楼旧账。",
        status: "ACCEPTED"
      })

    NovelPersistence.Repo.insert!(%NovelPersistence.Schemas.Character{
      work_id: c.work.id,
      name: "沈砚",
      aliases: ["小沈"],
      narrative_role: "MINOR",
      status: "ACCEPTED"
    })

    before = NovelPersistence.Repo.all(NovelPersistence.Schemas.Character)
    ref = "character:#{source.id}"
    parent = self()
    calls = :counters.new(1, [])

    execution = %Execution{
      result_fn: fn request ->
        :counters.add(calls, 1, 1)
        observations = NovelCommon.RequestIR.visible_observations(request)

        args =
          case :counters.get(calls, 1) do
            1 ->
              assert observations == []

              %{
                action: "explore",
                author_reasoning: "我会先查看角色目录，确认老沈对应的人物。",
                explore_request: %{tool: "archive_read", query: "characters"}
              }

            2 ->
              assert [%{coverage: %{"kind" => "directory"}}] = observations

              %{
                action: "explore",
                author_reasoning: "我会查看老沈的角色详情，核对当前设定。",
                explore_request: %{
                  tool: "archive_read",
                  query: Jason.encode!(%{facet: "characters", ref: ref, offset: 0})
                }
              }

            3 ->
              assert [_, detail] = observations
              assert detail.coverage["kind"] == "detail"
              assert detail.content["facts"]["character"]["character_ref"] == ref
              assert detail.content["facts"]["character"]["narrative_role"] == initial_role
              assert detail.content["summary"] == "熟悉灯楼旧账。"

              %{
                action: "execute",
                capability: "revise_character_profile",
                character_ref: ref,
                author_reasoning: @role_narrative
              }

            count ->
              flunk("确定性角色步骤不应追加 provider 调用：#{count}")
          end

        args = Map.put(args, :dialogue_goal, "按作者要求处理老沈的叙事身份")
        call_ref = TestAgenticLoopFixtures.unique_provider_call_id("pcall-role")
        run_ref = TestAgenticLoopFixtures.unique_provider_call_id("prun-role")
        send(parent, {:role_source, :counters.get(calls, 1), call_ref, run_ref})

        {:ok,
         %NovelAgent.Provider.Result{
           content: "",
           tool_calls: TestAgenticLoopFixtures.native_tool_calls("judgment_decision", args),
           provider_call_ref: call_ref,
           provider_run_ref: run_ref
         }}
      end
    }

    input = %{
      text: "指定老沈为主角",
      workspace_id: c.work.id,
      work_id: c.work.id,
      session_id: c.session.id,
      turn_id: "turn-role-handoff",
      interaction_store: &NovelPersistence.InteractionLifecycle.call/2
    }

    fetcher = NovelPersistence.WorkspaceContext.context_fetcher_with_query()
    assert {:ok, spec} = DialoguePlanningService.plan_agent_run(input, fetcher, execution)

    attrs =
      NovelApplication.TestAgentEventRelay.observe(spec.run_attrs, fn event ->
        send(parent, {:role_event, event})
      end)

    assert {:ok, run_id} =
             AgentRunService.start_bounded(attrs,
               interaction_input: spec.interaction_input,
               interaction_store: spec.interaction_store,
               next_step_planner: spec.next_step_planner
             )

    _run_pid = NovelApplication.TestAgentRunCleanup.register_run(run_id)

    assert_receive {:role_event, %{event_type: :run_completed}}, 5_000
    assert {:ok, state} = AgentRunService.state(run_id)
    assert state.run.status == :completed
    assert state.run.consumed_budget.provider_calls == 3
    assert state.run.consumed_budget.tool_calls == 0
    assert :counters.get(calls, 1) == 3
    assert AgentRunLog.get_run(run_id).status == "completed"
    assert state.stage_state.judgment_settled == "completed"
    assert state.stage_state.pending_artifact_request == nil
    assert state.stage_state.pending_artifact_tool == nil

    assert length(
             for message <- state.stage_state.judgment_transcript.messages,
                 block <- message.blocks,
                 Map.get(block, :type) == "tool_call",
                 do: block
           ) == 3

    assert_receive {:role_source, 3, call_ref, run_ref}

    # 来源坐标来自 fixture 生产端；79 字节及 SHA 由上方固定含换行原文独立计算。
    expected_source = %{
      source_type: "provider_output_tool_narrative",
      provider_call_ref: call_ref,
      provider_run_ref: run_ref,
      provider_output_ref: run_ref,
      tool_call_name: "judgment_decision",
      tool_call_narrative_field: "author_reasoning",
      source_byte_range: %{start: 0, length: 79},
      source_hash: "0b2fde1017c4511ef4ad89be64dde0f5ccdcf91d2d0d4f39b9a74f7b1eaa7eab",
      narrative_hash: "0b2fde1017c4511ef4ad89be64dde0f5ccdcf91d2d0d4f39b9a74f7b1eaa7eab"
    }

    assert_receive {:role_event,
                    %{
                      event_type: :judgment_decided,
                      payload: %{author_narrative: "我会先查看角色目录，确认老沈对应的人物。"}
                    }}

    assert_receive {:role_event,
                    %{
                      event_type: :judgment_decided,
                      payload: %{author_narrative: "我会查看老沈的角色详情，核对当前设定。"}
                    }}

    assert_receive {:role_event,
                    %{
                      event_type: :judgment_decided,
                      payload: %{author_narrative_source: ^expected_source}
                    }}

    assert state.final_turn_result.assistant_message.text == @role_narrative

    assert get_in(state.final_turn_result, [
             :trace_summary,
             :reply_record,
             :author_narrative_source
           ]) ==
             expected_source

    assert_receive {:role_event, %{event_type: delivery_type, payload: %{turn_result: delivered}}}
    assert delivery_type in [:artifact_created, :turn_result_ready]
    assert delivered.assistant_message.text == @role_narrative

    assert get_in(delivered, [:trace_summary, :reply_record, :author_narrative_source]) ==
             expected_source

    assert {:ok, shown} = NovelApplication.WorkSessionService.resume(c.work.id)
    assert [restored] = Enum.filter(shown.transcript, &(&1.role == "assistant"))
    assert restored.turn_result["assistant_message"]["text"] == @role_narrative

    assert get_in(restored.turn_result, [
             "trace_summary",
             "reply_record",
             "author_narrative_source"
           ]) ==
             Jason.decode!(Jason.encode!(expected_source))

    {state, source, before}
  end
end
