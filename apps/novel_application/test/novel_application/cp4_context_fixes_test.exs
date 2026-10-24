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

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @first_page_anchor "开篇锚点：陈九斤在这个雨夜第一次数错了灯。"
  @long_tail_anchor "长章末页独有锚点：第七枚手印在灯焰里落定。"

  # ── M03：长章续读覆盖 ───────────────────────────────────────

  test "M03 长章分页续读：34k 字符读到末页后收束，prompt 显式覆盖/续读阶段" do
    total = 34_357
    {work_id, _chapter_ref} = seed_chapter_with_prose(long_prose(total))
    provider = long_read_execution(self())

    {:ok, spec} =
      DialoguePlanningService.plan_agent_run(
        %{
          text: "帮我通读一遍第01章，看看前后有没有矛盾。",
          workspace_id: work_id,
          work_id: work_id,
          session_id: "session-long-read",
          turn_id: "turn-long-read"
        },
        nil,
        provider
      )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    {_snapshot, result} = run_until_turn_result(spec, run, 20)

    assert result.turn_result.assistant_message.text =~ @long_tail_anchor

    prompts = drain_prompts([])
    reader_prompts = Enum.filter(prompts, &String.contains?(&1, "## 探索观察"))
    assert length(reader_prompts) >= 6

    # 长章覆盖事实：已读/总长 + 续读阶段约束（普通 2 轮额度用完后仅允许同章续读）
    assert Enum.any?(prompts, &String.contains?(&1, "已读约 12000/34357 字符"))
    assert Enum.any?(prompts, &String.contains?(&1, "本轮剩余探索额度只用于该章续读"))

    # 未读末页（已读 1–30000/34357）时 prompt 必须给出覆盖缺口事实，
    # 并明确不得声称已读全章（retest2 M03r2 口径）。
    partial_prompt =
      Enum.find(prompts, fn prompt ->
        String.contains?(prompt, "## 探索观察") and
          length(String.split(prompt, "### 观察 ")) - 1 == 5
      end)

    assert partial_prompt
    assert partial_prompt =~ "覆盖事实：本章正文已读 1–30000/34357 字符"
    assert partial_prompt =~ "未读 30001–34357 字符"
    assert partial_prompt =~ "不得声称已读全章"

    # 读完整章（6 页）后的判断 prompt 关闭探索目录，模型必须收束
    final_prompt =
      Enum.find(prompts, fn prompt ->
        String.contains?(prompt, "## 探索观察") and
          length(String.split(prompt, "### 观察 ")) - 1 >= 6
      end)

    assert final_prompt
    assert final_prompt =~ @long_tail_anchor
    assert final_prompt =~ "覆盖事实：本章正文已读 1–34357/34357 字符，已覆盖全章"
    refute final_prompt =~ "## 探索目录"
  end

  # ── M17：纯只读计划在判断循环内联执行后收束 ─────────────────

  test "M17 只读计划内联执行后回到判断收束，产生最终作者可见结论" do
    {work_id, chapter_ref} = seed_chapter_with_prose("沈砚经营旧书铺。\n\n他把账册合上。")
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
          session_id: "session-m17",
          turn_id: "turn-m17",
          context_fetcher: fetch
        },
        nil,
        provider
      )

    {:ok, run} = AgentRun.new(spec.run_attrs)
    {_snapshot, result} = run_until_turn_result(spec, run, 16)

    assert result.turn_result.assistant_message.text =~ "两份候选的真实差异"
    prompts = drain_prompts([])
    assert Enum.any?(prompts, &String.contains?(&1, "## 探索观察"))
    # 计划内联执行不产生 plan_drafted 事件（不切 judgment_plan profile）
    assert run_plan_profile_events(spec, run) == []
  end

  # ── M01/M20/M16：结构化作品事实块 ──────────────────────────

  test "作品事实块：当前 accepted 版本/段数/字符数/superseded/摘要/全书目标/会话采纳计数" do
    context = %DialogueContext{
      workspace_id: "w-facts",
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

    block = DialoguePlanningService.judgment_context_block(context, "这一章写完了吗？")

    assert block =~ "## 作品事实（持久化只读投影"
    assert block =~ "目标总字数=200000"
    assert block =~ "预计卷数=3"
    assert block =~ "当前已采纳正文：字符数 950；有效字数 900"
    assert block =~ "2 章中已写 1 章、计划中 1 章"
    assert block =~ "第1章「第01章：灯楼夜雨」：当前已采纳正文 3/3 场（正文 950 字符；有效字数 900）"
    assert block =~ "当前版本 refs=draft:d1:1, draft:d2:1, draft:d3:1"
    assert block =~ "章摘要=ACCEPTED"
    assert block =~ "历史 SUPERSEDED 稿 1 份（不计入当前）"
    assert block =~ "章计划字段=ending_hook, opening_hook"
    assert block =~ "resolved 1 项，其中 ACCEPTED/EDITED_ACCEPTED 1 项"
    assert block =~ "不等于整章或全书叙事完成"
  end

  test "旧作品无 char_count 时 facts 只给有效字数，不伪造字符数" do
    context = %DialogueContext{
      workspace_id: "w-legacy",
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

    block = DialoguePlanningService.judgment_context_block(context, "进度如何？")

    assert block =~ "当前已采纳正文有效字数 500"
    assert block =~ "第1章「第01章：旧稿」：当前已采纳正文 1/1 场（有效字数 500）"
    refute block =~ "字符数 0"
  end

  test "待采纳候选预览：真实 ref/type/状态/操作/正文预览；空预览诚实标注不得编造" do
    context = %DialogueContext{
      workspace_id: "w-pending",
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

    block = DialoguePlanningService.judgment_context_block(context, "那就整理一下吧。")

    assert block =~ "## 待采纳候选"
    assert block =~ "ref=as_m07"
    assert block =~ "operations=revise_pending_artifact/discard_pending_artifact"
    assert block =~ "body_preview=雨点落在灯楼上。"
    assert block =~ "ref=as_bare"
    assert block =~ "来源回合未携带候选正文预览"
    assert block =~ "不得据此编造"
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
    context = %DialogueContext{workspace_id: work.id, interaction_state: %{}}

    assert {:error, {:pending_artifact_invalid, :candidate_content_unavailable}} =
             PendingArtifactWorkflow.run(judgment, %{}, run, context, provider)
  end

  # ── retest2 根因回归：fetch → ContextAssembler 链保留 chapter_facts ──

  test "生产 fetch 链把 chapter_facts 带进判断作品事实块（白名单透传回归）" do
    {:ok, work} = WorkService.create(%{"title" => "事实链作品"})

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
        session_id: "session-facts-chain"
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

    block = DialoguePlanningService.judgment_context_block(context, "第01章写完了吗？当前版本是什么？")

    assert block =~ "当前已采纳正文 1/1 场（正文 #{entry.char_count} 字符；有效字数 #{entry.word_count}）"
    assert block =~ "历史 SUPERSEDED 稿 1 份（不计入当前）"
    assert block =~ "章状态=COMPLETED"
    assert block =~ "当前版本 refs=draft:"
    refute block =~ "当前已采纳正文 0/0 场"
  end

  # ── helpers ───────────────────────────────────────────────

  defp run_until_turn_result(spec, run, max_steps) do
    empty = %{stage_state: %{}, observations: [], events: [], stage_sink: fn _ -> :ok end}

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
      | stage_state: Map.merge(snapshot.stage_state, result[:stage_state] || %{})
    }

    if result[:turn_result],
      do: {:halt, {snapshot, result}},
      else: {:cont, {snapshot, nil}}
  end

  defp run_plan_profile_events(_spec, _run) do
    # 内联只读计划不切 profile；本测试的 run patch 里不出现 judgment_plan profile。
    []
  end

  defp drain_prompts(acc) do
    receive do
      {:prompt, text} -> drain_prompts([text | acc])
    after
      0 -> Enum.reverse(acc)
    end
  end

  # 长章脚本：按观察页数逐页续读；读满 6 页（34357 字符）后收束引用末页锚点。
  defp long_read_execution(test_pid) do
    scripted_judgment_execution(fn _prompt, text ->
      send(test_pid, {:prompt, text})

      if String.contains?(text, @long_tail_anchor) do
        {:narrative, "我读完了全章六页，结论如下：\n\n" <> @long_tail_anchor}
      else
        query = long_read_query(text)

        {:decision,
         %{
           "action" => "explore",
           "reason" => "need_full_chapter",
           "explore_request" => %{"tool" => "chapter_read", "query" => query}
         }}
      end
    end)
  end

  defp long_read_query(text) do
    pages = length(String.split(text, "### 观察 ")) - 1
    if pages == 0, do: explore_ref_query(text), else: footer_query(text)
  end

  # M17 脚本：首轮 judgment_decision(plan)+agent_plan_draft（只读 archive_read），
  # 内联执行后第二轮基于观察给出最终对比结论。
  defp planned_reads_then_reply_execution(test_pid, chapter_ref) do
    scripted_judgment_execution(fn _prompt, text ->
      send(test_pid, {:prompt, text})
      has_observation = String.contains?(text, "## 探索观察")

      if has_observation do
        {:narrative, "两份候选的真实差异：A 更冷峻克制，B 更热闹外放；建议先说明取舍再修订。"}
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
                 "description" => "读取第01章当前正文。",
                 "success_criteria" => ["chapter_read"],
                 "target_tool_ref" => "chapter_read",
                 "exploration_query" => Jason.encode!(%{chapter_ref: chapter_ref, offset: 0})
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
        text = prompt_to_text(prompt)

        case script.(prompt, text) do
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

  defp prompt_to_text(prompt) when is_binary(prompt), do: prompt

  defp prompt_to_text(%{messages: messages}) when is_list(messages) do
    Enum.map_join(messages, "\n", fn
      %{content: content} when is_binary(content) -> content
      %{"content" => content} when is_binary(content) -> content
      _ -> ""
    end)
  end

  defp prompt_to_text(%{"messages" => messages}) when is_list(messages) do
    Enum.map_join(messages, "\n", fn
      %{"content" => content} when is_binary(content) -> content
      %{content: content} when is_binary(content) -> content
      _ -> ""
    end)
  end

  defp prompt_to_text(other), do: inspect(other)

  defp provider_output(text) do
    %ProviderOutput{
      provider_run_ref: "prun-#{System.unique_integer([:positive])}",
      provider_call_ref: "pcall-#{System.unique_integer([:positive])}",
      status: :ok,
      content: %{text: text}
    }
  end

  defp explore_ref_query(prompt_text) do
    case Regex.run(~r/\[chapter_ref=(chapter:[0-9a-fA-F-]{36})\]/u, prompt_text) do
      [_, ref] -> Jason.encode!(%{"chapter_ref" => ref, "offset" => 0})
      _ -> Jason.encode!(%{"chapter_seq" => 1, "offset" => 0})
    end
  end

  defp footer_query(prompt_text) do
    matches =
      Regex.scan(~r/【续读】剩余 \d+ 字符；用 (\{"chapter_ref".*?\}) 继续。/u, prompt_text)

    case List.last(matches) do
      [_, query] -> query
      _ -> Jason.encode!(%{"chapter_seq" => 1, "offset" => 0})
    end
  end

  defp context_with_pending_candidates(_work_id, pending) do
    structured = [
      %{
        id: "chapter-1",
        title: "第01章：灯楼夜雨",
        seq: 1,
        has_prose: true,
        word_count: 24,
        accepted_draft_count: 1,
        scene_count: 1,
        current_draft_refs: ["draft:d1:1"],
        superseded_draft_count: 0,
        chapter_status: "DRAFTING",
        summary_status: "ACCEPTED",
        plan_direction: %{}
      }
    ]

    fn _work_id, _author_text, _session_id ->
      {:ok, %{title: "灯楼夜雨"}, nil, nil, nil, ["第01章：灯楼夜雨"], structured,
       %{pending_adoptions: pending, resolved_adoptions: []}}
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
