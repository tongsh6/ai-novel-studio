defmodule NovelApplication.CP4ContextFixesTest do
  @moduledoc """
  B27 CP4 产品修复批（task-20）：M03 长章续读、M01/M20/M16 作品事实块、
  M07/M08 待采纳候选投影与空基线诚实失败。
  M17 只读计划材料回流的集成验收归 JudgmentPlanMaterialTest。
  """
  use ExUnit.Case, async: false

  import NovelApplication.TestAgenticLoopFixtures,
    only: [
      run_until_turn_result: 3,
      scripted_judgment_execution: 1,
      drain_prompt_maps: 1,
      observation_blocks: 1,
      long_prose: 3,
      seed_chapter_with_prose: 1
    ]

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution

  alias NovelApplication.{
    AuthoringTranscript,
    ContextAssembler,
    DialoguePlanningService,
    ExplorationService,
    JudgmentProtocol,
    PendingArtifactWorkflow,
    WorkService
  }

  alias NovelCommon.RequestIR
  alias NovelDomain.{AgentRun, DialogueContext}
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{MemoryLog, Repo, WorkSessionRepo}
  alias NovelPersistence.Schemas.{Chapter, Character, Draft, Scene, Volume}
  alias NovelTest.TestProviderPrompt

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @first_page_anchor "开篇锚点：陈九斤在这个雨夜第一次数错了灯。"
  @long_tail_anchor "长章末页独有锚点：第七枚手印在灯焰里落定。"

  # ── M03：长章续读覆盖 ───────────────────────────────────────

  test "M03 长章分页续读：34k 字符读到末页后收束，原生观察与 Scope 保留覆盖事实" do
    total = 34_357

    {work_id, chapter_ref} =
      seed_chapter_with_prose(long_prose(total, @first_page_anchor, @long_tail_anchor))

    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work_id)
    provider = long_read_execution(self())

    {:ok, spec} =
      DialoguePlanningService.plan_agent_run(
        %{
          text: "帮我通读一遍第01章，看看前后有没有矛盾。",
          workspace_id: work_id,
          work_id: work_id,
          session_id: session.id,
          turn_id: "turn-long-read"
        },
        NovelPersistence.WorkspaceContext.context_fetcher_with_query(),
        provider
      )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    {_snapshot, result} = run_until_turn_result(spec, run, 20)
    assert result.turn_result.assistant_message.text =~ @long_tail_anchor

    prompts = drain_prompt_maps([])
    assert length(Enum.filter(prompts, &has_observation?/1)) >= 6

    # 普通两轮额度耗尽后，仅开放同章未读页；来源、范围与下一页位置均来自真实观察。
    assert Enum.any?(prompts, fn prompt ->
             budget =
               get_in(TestProviderPrompt.scope_content(prompt), [
                 "operation",
                 "exploration",
                 "budget"
               ])

             budget["continuation_only?"] == true and
               budget["continuation"] == %{
                 "tool" => "chapter_read",
                 "chapter_ref" => chapter_ref,
                 "next_offset" => 12_000,
                 "read_end" => 12_000,
                 "total" => total
               }
           end)

    partial_prompt = Enum.find(prompts, &(length(observation_blocks(&1)) == 5))
    assert partial_prompt
    partial_page = partial_prompt |> observation_blocks() |> List.last()
    assert partial_page.coverage["prose_range"] == %{"start" => 24_001, "end" => 30_000}
    assert partial_page.coverage["prose_total_chars"] == total
    assert partial_page.next_offset == 30_000
    assert partial_page.coverage["coverage_note"] =~ "未读 30001–34357 字符"
    assert partial_page.coverage["coverage_note"] =~ "不得声称已读全章"

    assert get_in(TestProviderPrompt.scope_content(partial_prompt), [
             "operation",
             "exploration",
             "allowed"
           ]) == true

    final_prompt = Enum.find(prompts, &(length(observation_blocks(&1)) == 6))
    assert final_prompt
    final_page = final_prompt |> observation_blocks() |> List.last()
    assert final_page.content["summary"] =~ @long_tail_anchor
    assert final_page.coverage["prose_range"] == %{"start" => 30_001, "end" => total}
    assert final_page.coverage["prose_total_chars"] == total
    assert final_page.coverage["coverage_note"] =~ "已覆盖全章"
    assert final_page.next_offset == nil

    final_scope = TestProviderPrompt.scope_content(final_prompt)

    assert %{"allowed" => false, "tools" => []} = final_scope["operation"]["exploration"]
    refute Map.has_key?(final_scope["operation"]["exploration"], "catalog")

    final_message =
      final_prompt.messages |> Enum.filter(&(&1.role == "scope_update")) |> List.last()

    assert final_message.versions["change_reason"] == "exploration_budget_exhausted"
  end

  @tag :scope_continuation
  test "续读专用额度只允许上一真实章页的精确下一位置，不能换对象或跳页" do
    {work_id, chapter_ref} =
      seed_chapter_with_prose(long_prose(13_000, @first_page_anchor, @long_tail_anchor))

    pages =
      for offset <- [0, 6000] do
        {:ok, page} =
          ExplorationService.run(
            work_id,
            "chapter_read",
            Jason.encode!(%{chapter_ref: chapter_ref, offset: offset})
          )

        page
      end

    input = continuation_protocol(work_id, pages)

    continuation = %{
      "tool" => "chapter_read",
      "chapter_ref" => chapter_ref,
      "next_offset" => 12_000,
      "read_end" => 12_000,
      "total" => 13_000
    }

    assert input.options[:exploration_budget].continuation_only?

    assert {:ok, %{action: "explore"}} =
             JudgmentProtocol.request_judgment(
               continuation_execution(
                 "chapter_read",
                 %{chapter_ref: chapter_ref, offset: 12_000},
                 continuation
               ),
               %{},
               input
             )

    for {tool, selector} <- [
          {"chapter_read", %{chapter_ref: "chapter:#{Ecto.UUID.generate()}", offset: 12_000}},
          {"chapter_read", %{chapter_ref: chapter_ref, offset: 6000}},
          {"chapter_read", %{chapter_ref: chapter_ref, offset: 13_000}},
          {"archive_read", %{facet: "characters", offset: 0}},
          {"session_message_read", %{run_id: "other-run", run_sequence: 3, offset: 12_000}}
        ] do
      assert {:error, {:judgment_protocol_violation, :exploration_continuation_mismatch}, _state} =
               JudgmentProtocol.request_judgment(
                 continuation_execution(tool, selector, continuation),
                 %{},
                 input
               )
    end
  end

  @tag :scope_continuation
  test "真实角色详情后页复用同一续读额度，目录或其它角色不能借用该页坐标" do
    {:ok, work} = WorkService.create(%{title: "角色分页作品"})

    character =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "分页角色",
        summary: String.duplicate("角色档案。", 1400),
        narrative_role: "SUPPORTING",
        status: AdoptionStatus.accepted()
      })

    ref = "character:#{character.id}"
    {:ok, directory} = ExplorationService.run(work.id, "archive_read", "characters")

    {:ok, detail} =
      ExplorationService.run(
        work.id,
        "archive_read",
        Jason.encode!(%{facet: "characters", ref: ref, offset: 0})
      )

    assert detail.next_offset == 6000
    input = continuation_protocol(work.id, [directory, detail])

    continuation = %{
      "tool" => "archive_read",
      "kind" => "detail",
      "facet" => "characters",
      "ref" => ref,
      "next_offset" => 6000,
      "read_end" => 6000,
      "total" => 7000,
      "offset_unit" => "unicode_grapheme"
    }

    assert input.options[:exploration_budget].continuation_only?

    assert {:ok, %{action: "explore"}} =
             JudgmentProtocol.request_judgment(
               continuation_execution(
                 "archive_read",
                 %{facet: "characters", ref: ref, offset: 6000},
                 continuation
               ),
               %{},
               input
             )

    for selector <- [
          %{facet: "characters", ref: "character:#{Ecto.UUID.generate()}", offset: 6000},
          %{facet: "characters", offset: 6000},
          %{facet: "chapters", offset: 6000},
          %{facet: "characters", ref: ref, offset: 0},
          %{facet: "characters", ref: ref, offset: 12_000}
        ] do
      assert {:error, {:judgment_protocol_violation, :exploration_continuation_mismatch}, _state} =
               JudgmentProtocol.request_judgment(
                 continuation_execution("archive_read", selector, continuation),
                 %{},
                 input
               )
    end
  end

  test "默认候选只提供真实定位与状态，原文由现役实际读口消费" do
    context = %DialogueContext{
      work_id: "w-pending",
      source_status: %{interaction: :ok, chapters: :empty},
      interaction_state: %{
        pending_adoptions: [
          %{
            artifact_id: "as_m07",
            artifact_type: "prose_fragment",
            adoption_status: "TENTATIVE",
            payload: %{items: [%{item_id: "i1", title: "仅排版候选", body: "雨点落在灯楼上。"}]}
          },
          %{
            artifact_id: "as_bare",
            artifact_type: "prose_fragment",
            adoption_status: "TENTATIVE",
            payload: nil
          }
        ],
        resolved_adoptions: []
      },
      structured_chapters: []
    }

    scope = DialoguePlanningService.judgment_scope(context)
    assert scope.context.provenance == "application"
    assert scope.coverage.interaction.status == "complete"
    assert [candidate, bare] = scope.context.interaction_state.pending_adoptions
    assert candidate.artifact_ref == "as_m07"
    assert candidate.artifact_type == "prose_fragment"
    assert candidate.status == "TENTATIVE"

    assert candidate.available_operations == [
             "revise_pending_artifact",
             "discard_pending_artifact"
           ]

    assert candidate.title == "仅排版候选"
    refute Map.has_key?(candidate, :body_preview)

    assert NovelApplication.TurnInteractionService.artifact_body(
             hd(context.interaction_state.pending_adoptions)
           ) == "雨点落在灯楼上。"

    assert bare.artifact_ref == "as_bare"
    refute Map.has_key?(bare, :body_preview)
    assert bare.title == nil
  end

  # ── M07/M08：候选正文缺失时诚实失败（不调用模型、不编造） ─────

  test "候选正文投影缺失时修订诚实失败，不调用 provider" do
    {:ok, work} = WorkService.create(%{title: "空基线作品"})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

    bare_turn_result = %{
      turn_id: "turn-bare",
      assistant_message: %{text: "已生成排版候选。"},
      adoption_state: %{
        pending: [
          %{
            artifact_id: "as_bare",
            artifact_type: "prose_fragment",
            adoption_status: "TENTATIVE",
            source_turn_ref: "turn-bare"
          }
        ],
        resolved: []
      }
    }

    {:ok, _} =
      MemoryLog.record(%{
        workspace_id: work.id,
        session_id: session.id,
        turn_id: "turn-bare",
        role: "assistant",
        content: %{text: "已生成排版候选。", turn_result: bare_turn_result},
        source_ref: "turn-bare",
        scope_ref: work.id
      })

    run = %{
      run_id: "run-bare",
      run_mode: :bounded,
      profile_ref: "judgment_loop_v1",
      budget: %{max_tool_calls: 3, max_provider_calls: 6},
      consumed_budget: %{},
      authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]},
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      parent_turn_ref: "turn-current",
      goal: %{text: "把候选整理一下，只调标点和分段。", version: 1}
    }

    judgment = %{
      capability: "revise_pending_artifact",
      pending_artifact_ref: "as_bare",
      dialogue_goal: "整理候选排版",
      narrative: "我会按你的要求整理这份候选，不自动保存。"
    }

    provider = %Execution{result_fn: fn _prompt -> flunk("空基线不得调用 provider") end}
    context = %DialogueContext{work_id: work.id, interaction_state: %{}}

    assert {:error, {:pending_artifact_invalid, :candidate_content_unavailable}, failure_state} =
             PendingArtifactWorkflow.run(judgment, %{}, run, context, provider)

    assert %{tool_call_count: 0, provider_call_count: 0} = failure_state
    refute Map.has_key?(failure_state, :judgment_transcript)
  end

  # ── retest2 根因回归：fetch → ContextAssembler 链保留 chapter_facts ──

  test "完整专业上下文保留真实版本统计，判断仅通过实际 chapter_read 取得正文" do
    {:ok, work} = WorkService.create(%{"title" => "事实链作品"})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

    volume =
      %Volume{} |> Volume.changeset(%{work_id: work.id, title: "卷一", seq: 1}) |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{
        work_id: work.id,
        volume_id: volume.id,
        title: "第01章：灯楼夜雨",
        seq: 1,
        status: "COMPLETED"
      })
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert!()

    old_draft =
      %Draft{}
      |> Draft.changeset(%{
        work_id: work.id,
        scene_id: scene.id,
        content: "旧版本正文（已被替换，不计入当前）。",
        status: AdoptionStatus.accepted(),
        revision: 1
      })
      |> Repo.insert!()

    {:ok, _superseded} = Repo.update(Draft.supersede_changeset(old_draft))

    current_draft =
      %Draft{}
      |> Draft.changeset(%{
        work_id: work.id,
        scene_id: scene.id,
        content: "雨从后半夜开始下，陈九斤把最后一盏油灯挪到窗台上。",
        status: AdoptionStatus.accepted(),
        revision: 2
      })
      |> Repo.insert!()

    fetcher = NovelPersistence.WorkspaceContext.context_fetcher_with_query()

    context =
      NovelApplication.ContextAssembler.assemble_for_input(
        work.id,
        "第01章写完了吗？当前版本是什么？",
        fetcher,
        session_id: session.id
      )

    assert [entry] = context.structured_chapters
    assert entry.accepted_draft_count == 1
    assert entry.scene_count == 1
    assert entry.superseded_draft_count == 1
    assert entry.word_count > 0
    assert entry.chapter_status == "COMPLETED"
    assert [ref] = entry.current_draft_refs
    assert ref =~ "draft:"
    assert entry.char_count == String.length("雨从后半夜开始下，陈九斤把最后一盏油灯挪到窗台上。")
    assert entry.word_count < entry.char_count

    assert entry.visible_in_reading == true
    scope = DialoguePlanningService.judgment_scope(context)
    refute Map.has_key?(scope.facts, :chapters)
    assert scope.coverage.chapters == %{status: "not_read"}

    # 版本 oracle 来自调用前的实际持久源；changeset 乐观锁可能推进传入的 revision。
    source_revision = Repo.get!(Draft, current_draft.id).revision
    expected_versions = %{"draft:#{current_draft.id}" => source_revision}

    {:ok, observation} =
      ExplorationService.run(
        work.id,
        "chapter_read",
        Jason.encode!(%{chapter_ref: "chapter:#{chapter.id}"})
      )

    assert observation.chapter_ref == "chapter:#{chapter.id}"
    assert observation.prose_total_chars == String.length("雨从后半夜开始下，陈九斤把最后一盏油灯挪到窗台上。")
    assert observation.summary =~ "雨从后半夜开始下，陈九斤把最后一盏油灯挪到窗台上。"
    refute observation.summary =~ "旧版本正文"
    assert observation.versions == expected_versions
  end

  # ── helpers ───────────────────────────────────────────────

  defp continuation_execution(tool, selector, continuation) do
    scripted_judgment_execution(fn request ->
      exploration = TestProviderPrompt.scope_content(request)["operation"]["exploration"]
      assert exploration["allowed"] == true
      assert exploration["tools"] == [continuation["tool"]]

      assert exploration["budget"] == %{
               "total" => 2,
               "open?" => true,
               "normal_open?" => false,
               "continuation_open?" => true,
               "continuation_only?" => true,
               "continuation" => continuation
             }

      {:decision,
       %{
         "action" => "explore",
         "author_reasoning" => "继续读取同一来源的后续页。",
         "dialogue_goal" => "继续读取上一页的后续内容",
         "explore_request" => %{"tool" => tool, "query" => Jason.encode!(selector)}
       }}
    end)
  end

  defp continuation_protocol(work_id, observations) do
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work_id)
    text = "继续读取上一页的后续内容。"

    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-continuation-#{work_id}",
        work_id: work_id,
        workspace_id: work_id,
        session_id: session.id,
        parent_turn_ref: "turn-continuation",
        origin_frame_ref: "frame-continuation",
        profile_ref: "judgment_loop_v1",
        authority_scope: %{production_write: false, allowed_tools: ["judgment"]},
        goal: %{text: text, version: 1}
      })

    context =
      ContextAssembler.assemble_for_input(
        work_id,
        text,
        NovelPersistence.WorkspaceContext.context_fetcher_with_query(),
        session_id: session.id
      )

    initial =
      DialoguePlanningService.judgment_protocol_input_for_test(%{text: text}, run, context, [])

    {:ok, transcript} = JudgmentProtocol.transcript_for_production(initial)

    transcript =
      observations
      |> Enum.with_index(1)
      |> Enum.reduce(transcript, fn {observation, index}, current ->
        call_id = "continuation-source-#{index}"

        current
        |> AuthoringTranscript.append_assistant("", [
          RequestIR.tool_call_block(
            "judgment_decision",
            %{
              action: "explore",
              author_reasoning: "读取当前来源的正文。",
              dialogue_goal: text,
              explore_request: %{tool: observation.tool, query: observation.query}
            },
            call_id
          )
        ])
        |> JudgmentProtocol.observation_transcript(%{tool_call_id: call_id}, observation)
      end)

    %{text: text}
    |> DialoguePlanningService.judgment_protocol_input_for_test(run, context, observations)
    |> Map.put(:transcript, transcript)
  end

  defp has_observation?(prompt_map) do
    RequestIR.visible_observations(prompt_map) != []
  end

  # 长章脚本：按观察页数逐页续读；读满 6 页（34357 字符）后收束引用末页锚点。
  defp long_read_execution(test_pid) do
    scripted_judgment_execution(fn prompt ->
      send(test_pid, {:prompt_map, prompt})
      pages = observation_blocks(prompt)

      if Enum.any?(pages, &String.contains?(&1.content["summary"], @long_tail_anchor)) do
        {:narrative, "我读完了全章六页，结论如下：\n\n" <> @long_tail_anchor}
      else
        query = long_read_query(prompt)

        {:decision,
         %{
           "action" => "explore",
           "author_reasoning" => "继续读取完整章节正文。",
           "dialogue_goal" => "完整读取本章正文并核对末页内容",
           "explore_request" => %{"tool" => "chapter_read", "query" => query}
         }}
      end
    end)
  end

  defp long_read_query(prompt) do
    case prompt |> observation_blocks() |> List.last() do
      nil ->
        # 作者明确点名第01章；现役 chapter_read 按真实章序查找并返回 canonical ref。
        Jason.encode!(%{"chapter_seq" => 1, "offset" => 0})

      page ->
        Jason.encode!(%{
          "chapter_ref" => Map.fetch!(page.coverage, "chapter_ref"),
          "offset" => page.next_offset
        })
    end
  end
end
