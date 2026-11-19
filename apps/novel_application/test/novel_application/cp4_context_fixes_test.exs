defmodule NovelApplication.CP4ContextFixesTest do
  @moduledoc """
  B27 CP4 产品修复批（task-20）：M03 长章续读、M01/M20/M16 作品事实块、
  M17 只读计划收束、M07/M08 待采纳候选投影与空基线诚实失败。
  """
  use ExUnit.Case, async: false

  import NovelApplication.TestAgenticLoopFixtures,
    only: [
      run_until_turn_result: 3,
      scripted_judgment_execution: 1,
      drain_prompt_maps: 1,
      observation_blocks: 1
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
    {work_id, chapter_ref} = seed_chapter_with_prose(long_prose(total))
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

  # ── M17：纯只读计划在判断循环内联执行后收束 ─────────────────

  test "M17 只读计划内联执行后回到判断收束，产生最终作者可见结论" do
    {work_id, chapter_ref} = seed_chapter_with_prose(long_prose(7000))
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work_id)
    provider = planned_reads_then_reply_execution(self(), chapter_ref)

    fetch =
      context_with_pending_candidates(work_id, [
        %{
          artifact_id: "as_m17_a",
          artifact_type: "prose_fragment",
          adoption_status: "TENTATIVE",
          source_turn_ref: "turn-prev-a",
          payload: %{items: [%{item_id: "a1", title: "候选A", body: "冷峻克制的开头。"}]}
        },
        %{
          artifact_id: "as_m17_b",
          artifact_type: "prose_fragment",
          adoption_status: "TENTATIVE",
          source_turn_ref: "turn-prev-b",
          payload: %{items: [%{item_id: "b1", title: "候选B", body: "热闹外放的开头。"}]}
        }
      ])

    {:ok, spec} =
      DialoguePlanningService.plan_agent_run(
        %{
          text: "比较一下两个候选再给我建议。",
          workspace_id: work_id,
          work_id: work_id,
          session_id: session.id,
          turn_id: "turn-m17"
        },
        fetch,
        provider
      )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    {snapshot, result} = run_until_turn_result(spec, run, 16)

    assert result.turn_result.assistant_message.text =~ "两份候选的真实差异"
    assert result.turn_result.assistant_message.text =~ @long_tail_anchor
    # 检查实际执行结果，内联只读计划不切到 judgment_plan profile。
    refute Enum.any?(
             snapshot.step_results,
             &(get_in(&1, [:run_patch, :profile_ref]) == "judgment_plan_v1")
           )

    # 下一次 provider 请求：计划内的多次真实读取以**单一**同 call_id 聚合观察回流。
    prompt_maps = drain_prompt_maps([])
    next_prompt_map = Enum.find(prompt_maps, &has_observation?/1)
    assert next_prompt_map
    assert [aggregate] = observation_blocks(next_prompt_map)

    judgment_call =
      next_prompt_map.messages
      |> Enum.flat_map(&Map.get(&1, :blocks, []))
      |> Enum.find(&(&1.type == "tool_call" and &1.name == "judgment_decision"))

    assert judgment_call
    assert aggregate.call_id == judgment_call.call_id
    assert aggregate.content["tool"] == "planned_exploration"

    # 汇总只留简洁说明，不把正文/叶 summary 作为顶层 summary 重复入线。
    refute aggregate.content["summary"] =~ @first_page_anchor

    leaves = aggregate.content["observations"]
    assert is_list(leaves)
    assert length(leaves) == 3
    refute Enum.any?(leaves, &Map.has_key?(&1, "call_id"))

    # 叶观察按执行顺序交还给 run：身份与 next request 的 observation_ref 逐字一致。
    planned_actors =
      Enum.filter(snapshot.observations, &String.starts_with?(&1.source_ref, "explore:"))

    assert length(planned_actors) == length(leaves)

    assert Enum.map(leaves, & &1["content"]["observation_ref"]) ==
             Enum.map(planned_actors, &"observation:#{&1.observation_id}")

    leaf_refs = Enum.map(leaves, & &1["content"]["observation_ref"])
    assert length(Enum.uniq(leaf_refs)) == length(leaf_refs)

    # 同章两页各自保留真实范围、原文与版本；叶子自身是版本/范围真源。
    raw_chapters =
      Enum.filter(snapshot.stage_state.judgment_explorations, &(&1.tool == "chapter_read"))

    chapter_leaves = Enum.filter(leaves, &(&1["content"]["tool"] == "chapter_read"))
    assert length(chapter_leaves) == 2

    raw_ranges =
      Enum.map(raw_chapters, fn observation ->
        Map.new(observation.prose_range, fn {key, value} -> {to_string(key), value} end)
      end)

    assert Enum.map(chapter_leaves, & &1["coverage"]["prose_range"]) == raw_ranges

    assert Enum.map(chapter_leaves, & &1["versions"]) ==
             Enum.map(raw_chapters, & &1.versions)

    assert Enum.all?(chapter_leaves, &(map_size(&1["versions"]) > 0))

    [page1_leaf, page2_leaf] = chapter_leaves
    assert page1_leaf["coverage"]["prose_range"] == %{"start" => 1, "end" => 6000}
    assert page2_leaf["coverage"]["prose_range"] == %{"start" => 6001, "end" => 7000}
    assert page1_leaf["next_offset"] == 6000
    assert page2_leaf["next_offset"] == nil
    assert page1_leaf["content"]["summary"] =~ @first_page_anchor
    assert page2_leaf["content"]["summary"] =~ @long_tail_anchor

    # transcript refs 跟随聚合形状：叶身份与真实底层来源进入 observation_refs。
    assert Enum.all?(leaf_refs, &(&1 in next_prompt_map.refs.observation_refs))
    assert Enum.all?(chapter_leaves, &(chapter_ref in &1["source_refs"]))
  end

  @tag :scope_continuation
  test "续读专用额度只允许上一真实章页的精确下一位置，不能换对象或跳页" do
    {work_id, chapter_ref} = seed_chapter_with_prose(long_prose(13_000))

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
         "reason" => "继续真实来源的后续页",
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
    Enum.any?(prompt_map.messages, fn
      %{role: "tool", blocks: blocks} -> Enum.any?(blocks, &(&1.type == "observation"))
      _ -> false
    end)
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
           "reason" => "need_full_chapter",
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

  # M17 脚本：首轮 judgment_decision(plan)+agent_plan_draft（只读 archive_read +
  # 同章两页 chapter_read），内联执行后第二轮基于观察给出最终对比结论。
  defp planned_reads_then_reply_execution(test_pid, chapter_ref) do
    scripted_judgment_execution(fn prompt ->
      send(test_pid, {:prompt_map, prompt})

      if has_observation?(prompt) do
        {:narrative,
         "两份候选的真实差异：A 更冷峻克制，B 更热闹外放；建议先说明取舍再修订。\n\n" <>
           @long_tail_anchor}
      else
        {:plan_pair,
         %{
           "action" => "plan",
           "dialogue_goal" => "比较两个待采纳候选",
           "reason" => "需要先取证再比较",
           "plan" => %{
             "steps" => [
               %{
                 "step_id" => "s1",
                 "kind" => "explore",
                 "description" => "读取两个候选与作品档案。",
                 "success_criteria" => ["candidates_read"],
                 "target_tool_ref" => "archive_read",
                 "exploration_query" => "profile"
               },
               %{
                 "step_id" => "s2",
                 "kind" => "explore",
                 "description" => "读取第01章当前正文首页。",
                 "success_criteria" => ["chapter_read"],
                 "target_tool_ref" => "chapter_read",
                 "exploration_query" => Jason.encode!(%{chapter_ref: chapter_ref, offset: 0})
               },
               %{
                 "step_id" => "s3",
                 "kind" => "explore",
                 "description" => "续读第01章第二页。",
                 "success_criteria" => ["chapter_read"],
                 "target_tool_ref" => "chapter_read",
                 "exploration_query" => Jason.encode!(%{chapter_ref: chapter_ref, offset: 6000})
               }
             ]
           },
           "author_reasoning" => "先读候选与正文，再给比较建议。",
           "reason_codes" => ["agent_plan_drafted"],
           "confidence" => 0.9
         }}
      end
    end)
  end

  defp context_with_pending_candidates(work_id, pending) do
    fetcher = NovelPersistence.WorkspaceContext.context_fetcher_with_query()

    fn ^work_id, author_text, session_id ->
      {:ok, context} = fetcher.(work_id, author_text, session_id)

      {:ok,
       %{
         context
         | interaction_state: %{pending_adoptions: pending, resolved_adoptions: []},
           source_status: Map.put(context.source_status, :interaction, :ok)
       }}
    end
  end

  defp long_prose(total) do
    base =
      "灰烬从指缝里漏下去，井底的风把纸灰卷成一条细线，他数着自己的呼吸等回声。"

    pad = total - String.length(@first_page_anchor) - String.length(@long_tail_anchor)
    middle = String.duplicate(base, div(pad, String.length(base)) + 1) |> String.slice(0, pad)
    prose = @first_page_anchor <> middle <> @long_tail_anchor
    assert String.length(prose) == total
    prose
  end

  defp seed_chapter_with_prose(prose) do
    {:ok, work} = WorkService.create(%{"title" => "CP4 长章作品"})

    volume =
      %Volume{} |> Volume.changeset(%{work_id: work.id, title: "卷一", seq: 1}) |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{work_id: work.id, volume_id: volume.id, title: "第01章：灯楼夜雨", seq: 1})
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work.id, chapter_id: chapter.id, title: "场1", seq: 1})
      |> Repo.insert!()

    %Draft{}
    |> Draft.changeset(%{
      work_id: work.id,
      scene_id: scene.id,
      content: prose,
      status: AdoptionStatus.accepted(),
      revision: 1
    })
    |> Repo.insert!()

    {work.id, "chapter:#{chapter.id}"}
  end
end
