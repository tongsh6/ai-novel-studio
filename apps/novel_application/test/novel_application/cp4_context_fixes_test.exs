defmodule NovelApplication.CP4ContextFixesTest do
  @moduledoc """
  B27 CP4 产品修复批（task-20）：M03 长章续读、M01/M20/M16 作品事实块、
  M17 只读计划收束、M07/M08 待采纳候选投影与空基线诚实失败。
  """
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelApplication.{DialoguePlanningService, PendingArtifactWorkflow, WorkService}
  alias NovelCommon.Contracts.ProviderOutput
  alias NovelDomain.{AgentRun, DialogueContext}
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{MemoryLog, Repo, WorkSessionRepo}
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}
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

    assert %{"allowed" => false, "tools" => [], "catalog" => []} =
             final_scope["operation"]["exploration"]

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

  # ── M01/M20/M16：结构化作品事实块 ──────────────────────────

  test "作品事实块：当前 accepted 版本/段数/字符数/superseded/摘要/全书目标/会话采纳计数" do
    context = %DialogueContext{
      work_id: "w-facts",
      source_status: %{work: :ok, chapters: :ok, interaction: :ok},
      current_work_snapshot: %{
        title: "灯楼夜雨",
        main_goal: "查清灯楼异象",
        target_length: 200_000,
        planned_volumes: 3
      },
      structured_chapters: [
        %{
          id: "chapter-1",
          title: "第01章：灯楼夜雨",
          seq: 1,
          has_prose: true,
          word_count: 900,
          char_count: 950,
          accepted_draft_count: 3,
          scene_count: 3,
          current_draft_refs: ["draft:d1:1", "draft:d2:1", "draft:d3:1"],
          superseded_draft_count: 1,
          chapter_status: "DRAFTING",
          summary_status: "ACCEPTED",
          summary_revision_base: "draft:d3:1",
          plan_direction: %{opening_hook: "第七盏灯自亮", ending_hook: "第三人脚步"}
        },
        %{
          id: "chapter-2",
          title: "第02章：井底回声",
          seq: 2,
          has_prose: false,
          word_count: 0,
          plan_direction: %{plot_progress: "下井"}
        }
      ],
      interaction_state: %{
        pending_adoptions: [],
        resolved_adoptions: [
          %{
            artifact_id: "as_m20",
            adoption_status: "EDITED_ACCEPTED",
            artifact_type: "prose_fragment"
          }
        ]
      }
    }

    scope = DialoguePlanningService.judgment_scope(context, "这一章写完了吗？")

    assert scope.facts.work.target_length == 200_000
    assert scope.facts.work.planned_volumes == 3
    assert scope.facts.work.ref == "work:w-facts"

    assert %{status: "complete", total: 2, returned: 2, written_count: 1, planned_count: 1} =
             scope.coverage.chapters

    assert [written, planned] = scope.facts.chapters
    assert written.ref == "chapter:chapter-1"
    assert written.work_id == "w-facts"
    assert written.has_prose == true
    assert written.char_count == 950
    assert written.word_count == 900
    assert written.accepted_draft_count == 3
    assert written.scene_count == 3
    assert written.current_draft_refs == ["draft:d1:1", "draft:d2:1", "draft:d3:1"]
    assert written.summary_status == "ACCEPTED"
    assert written.superseded_draft_count == 1
    assert written.plan_direction == %{opening_hook: "第七盏灯自亮", ending_hook: "第三人脚步"}
    assert planned.has_prose == false
    assert scope.context.interaction_state.resolved_adoption_count == 1
    assert [%{status: "EDITED_ACCEPTED"}] = scope.context.interaction_state.resolved_adoptions
  end

  test "来源未提供 char_count 时保留有效字数，不伪造字符数" do
    context = %DialogueContext{
      work_id: "w-incomplete-count",
      source_status: %{work: :ok, chapters: :ok},
      current_work_snapshot: %{title: "旧作品"},
      structured_chapters: [
        %{
          id: "c1",
          title: "第01章：旧稿",
          seq: 1,
          has_prose: true,
          word_count: 500,
          accepted_draft_count: 1,
          scene_count: 1,
          current_draft_refs: ["draft:old:1"],
          superseded_draft_count: 0,
          chapter_status: "COMPLETED",
          summary_status: nil,
          plan_direction: %{}
        }
      ]
    }

    scope = DialoguePlanningService.judgment_scope(context, "进度如何？")
    assert [chapter] = scope.facts.chapters
    assert chapter.word_count == 500
    assert chapter.accepted_draft_count == 1
    assert chapter.scene_count == 1
    refute Map.has_key?(chapter, :char_count)
  end

  test "待采纳候选预览保留真实身份、状态、操作和原文；缺失正文不合成预览" do
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

    scope = DialoguePlanningService.judgment_scope(context, "那就整理一下吧。")
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
    assert candidate.body_preview == "雨点落在灯楼上。"
    assert bare.artifact_ref == "as_bare"
    assert bare.body_preview == ""
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

  test "生产 fetch 链把 chapter_facts 带进判断作品事实块（白名单透传回归）" do
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

    scope = DialoguePlanningService.judgment_scope(context, "第01章写完了吗？当前版本是什么？")
    assert [fact] = scope.facts.chapters
    assert fact.accepted_draft_count == 1
    assert fact.scene_count == 1
    assert fact.char_count == String.length("雨从后半夜开始下，陈九斤把最后一盏油灯挪到窗台上。")
    assert fact.word_count == entry.word_count
    assert fact.superseded_draft_count == 1
    assert fact.chapter_status == "COMPLETED"
    assert fact.current_draft_refs == [ref]
    assert fact.work_id == work.id
    assert fact.visible_in_reading == true
  end

  # ── helpers ───────────────────────────────────────────────

  defp run_until_turn_result(spec, run, max_steps) do
    empty = %{
      stage_state: %{},
      observations: [],
      events: [],
      step_results: [],
      stage_sink: fn _ -> :ok end
    }

    Enum.reduce_while(1..max_steps, {empty, nil}, fn seq, {snapshot, _result} ->
      case spec.next_step_planner.(run, seq, snapshot) do
        {:execute, step, _decision, _meta} ->
          {:ok, result} = step.(run, seq, snapshot)
          continue_after_step(result, snapshot)

        {:complete, _decision, _meta} ->
          {:halt, {snapshot, nil}}

        other ->
          flunk("unexpected planner result: #{inspect(other)}")
      end
    end)
  end

  defp continue_after_step(result, snapshot) do
    snapshot = %{
      snapshot
      | stage_state: Map.merge(snapshot.stage_state, result[:stage_state] || %{}),
        observations: snapshot.observations ++ (result[:observations] || []),
        step_results: snapshot.step_results ++ [result]
    }

    if result[:turn_result],
      do: {:halt, {snapshot, result}},
      else: {:cont, {snapshot, nil}}
  end

  defp drain_prompt_maps(acc) do
    receive do
      {:prompt_map, prompt} -> drain_prompt_maps(acc ++ [prompt])
    after
      0 -> acc
    end
  end

  defp has_observation?(prompt_map) do
    Enum.any?(prompt_map.messages, fn
      %{role: "tool", blocks: blocks} -> Enum.any?(blocks, &(&1.type == "observation"))
      _ -> false
    end)
  end

  defp observation_blocks(prompt_map) do
    for %{role: "tool", blocks: blocks} <- prompt_map.messages,
        %{type: "observation"} = block <- blocks,
        do: block
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
        assert %{"facts" => %{"chapters" => [chapter | _]}} =
                 TestProviderPrompt.scope_content(prompt)

        Jason.encode!(%{"chapter_ref" => chapter["ref"], "offset" => 0})

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

  defp scripted_judgment_execution(script) do
    %Execution{
      result_fn: fn prompt ->
        case script.(prompt) do
          {:narrative, narrative} ->
            {:ok,
             %{
               content: narrative,
               tool_calls: [],
               provider_output: provider_output(narrative)
             }}

          {:decision, arguments} ->
            {:ok,
             %{
               content: "先核对作品事实。",
               tool_calls: [
                 %{
                   "name" => "judgment_decision",
                   "arguments" =>
                     Map.put_new(
                       Map.drop(arguments, ["reply_included", "frame_type", "record_only"]),
                       "dialogue_goal",
                       "核对作品事实"
                     )
                 }
               ],
               provider_output: provider_output("先核对作品事实。")
             }}

          {:plan_pair, arguments} ->
            author_reasoning = Map.get(arguments, "author_reasoning") || "先取证再比较。"

            {:ok,
             %{
               content: author_reasoning,
               tool_calls: [
                 %{
                   "name" => "agent_plan_draft",
                   "arguments" =>
                     Map.take(arguments, [
                       "plan",
                       "author_reasoning",
                       "reason_codes",
                       "confidence"
                     ])
                 },
                 %{
                   "name" => "judgment_decision",
                   "arguments" =>
                     arguments
                     |> Map.drop(["plan", "author_reasoning", "reason_codes", "confidence"])
                     |> Map.put_new("dialogue_goal", "比较候选")
                 }
               ],
               provider_output: provider_output(author_reasoning)
             }}
        end
      end
    }
  end

  defp provider_output(text) do
    %ProviderOutput{
      provider_run_ref: "prun-#{System.unique_integer([:positive])}",
      provider_call_ref: "pcall-#{System.unique_integer([:positive])}",
      status: :ok,
      content: %{text: text}
    }
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
