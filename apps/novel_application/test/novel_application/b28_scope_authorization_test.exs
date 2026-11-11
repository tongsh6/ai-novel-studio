defmodule NovelApplication.B28ScopeAuthorizationTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.{Execution, Result}

  alias NovelApplication.{
    AdoptionWorkflow,
    ChapterRevisionScope,
    ExplorationService,
    JudgmentProtocol,
    PendingArtifactWorkflow,
    TestAgenticLoopFixtures,
    WorkService
  }

  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.RequestIR
  alias NovelDomain.DialogueContext
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{LocalizedRevision, ReadingProjectionRepo, Repo, WorkSessionRepo}
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  # B28 CP1：scope 表达“作者授权修改的范围”，材料读取不等于修改授权；
  # 否定/局部限制/条件不得被词面扩大；只读拒绝不得生成整章候选。
  @matrix [
    # 否定整章 + 局部限制：局部限制优先，不扩为整章
    {"不要整章重写，只改第一段。", {:ok, :target_segments}},
    # 通读/全文是材料读取，不是修改授权；局部限制仍生效
    {"通读全文后只修第二段。", {:ok, :target_segments}},
    # 只读检查 + 明确不改：不授权任何修改
    {"整章检查一遍，有问题告诉我，别改。", {:error, :author_scope_not_authorized}},
    {"只读一遍第03章，不要改。", {:error, :author_scope_not_authorized}},
    # 条件性整章：条件未判定前保守为局部，不自动授整章
    {"如果第03章有明显问题就整章改一遍，没有问题就告诉我。", {:ok, :target_segments}},
    # 正向整章授权
    {"把第03章整章重写一遍，情节不变。", {:ok, :whole_chapter}},
    {"通读全文后整章润色，保留所有情节。", {:ok, :whole_chapter}},
    {"请通读整章并修订第一章正文。", {:ok, :whole_chapter}},
    # 仅排版正向限制（既有契约保留）
    {"只调整第03章分段和排版，不要改字句。", {:ok, :format_only}},
    {"把第一章正文整理一下，只调整分段和排版，别改字句。", {:ok, :format_only}},
    # 局部授权 / 字面替换默认局部
    {"把第03章第一段改得更紧张，其他段落别动。", {:ok, :target_segments}},
    {"把已保存的第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。", {:ok, :target_segments}},
    # 否定“仅排版”不是排版授权
    {"不是仅排版，需要修改第二段里的指定句子。", {:ok, :target_segments}}
  ]

  test "authorize/1 矩阵：否定/条件/读取/局部/正向授权" do
    for {text, expected} <- @matrix do
      assert ChapterRevisionScope.authorize(text) == expected, "input=#{text}"
    end
  end

  test "空文本/纯读取保守不授权整章" do
    assert ChapterRevisionScope.authorize("") == {:ok, :target_segments}
    assert ChapterRevisionScope.authorize(nil) == {:ok, :target_segments}
    assert ChapterRevisionScope.authorize("把这一章读一遍。") == {:ok, :target_segments}
  end

  test "否定整章但无局部限制 → 不授整章（保守局部，交由目标解析/澄清处理）" do
    assert ChapterRevisionScope.authorize("不要整章重写。") == {:ok, :target_segments}
  end

  test "target_segment_ids/2：段号/字面定位只认唯一命中，未知或越界拒绝" do
    segments =
      for raw <- ~w(一 二 三 四 五 六 七 八 九 十 十一) do
        %{segment_id: "seg_#{raw}", raw: raw}
      end

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第十一段") ==
             {:ok, ["seg_十一"]}

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第十段") == {:ok, ["seg_十"]}
    assert ChapterRevisionScope.target_segment_ids(segments, "开头改一下") == {:ok, ["seg_一"]}

    assert ChapterRevisionScope.target_segment_ids(segments, "把「三」改成「叁」") ==
             {:ok, ["seg_三"]}

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第十二段") ==
             {:error, :target_missing}

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第十十段") ==
             {:error, :target_missing}

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第0段") ==
             {:error, :target_missing}

    assert ChapterRevisionScope.target_segment_ids(segments, "只改第十一段，把「三」改成「叁」") ==
             {:error, :target_ambiguous}
  end

  # B82 G2：作者只给自然原话与阅读发现时，模型只能从本轮真实成功 chapter_read
  # 页里选择既有 B36 段；这里从真实章名/章序进入，走 judgment → 两页真实观察 →
  # Pending → writer 全链路。
  @g2_author "请先读第02章《灰烬中的手印》已经保存的正文，前后都核对一下，再把发现的重复写法改成一段候选给我看，先不要保存。"
  @g2_title "第02章：灰烬中的手印"

  test "G2 原话经真实两页读取后生成局部候选，目标由实际 RequestIR 观察提取" do
    ctx = seed_long_chapter(default_g2_prose())
    %{judgment: j3, pages: [page1, page2]} = run_revision_flow(ctx, @g2_author, :happy)

    assert [target_id] = j3.target_segment_ids
    assert j3.observed_targets.target_segment_ids == [target_id]
    assert j3.observed_targets.source_hash == page1.source_hash
    assert j3.observed_targets.versions == page1.versions

    # 目标是真实跨页段：两页观察都携带同一段，由实际 RequestIR 产物提取。
    assert Enum.any?(page1.target_segments, &(&1.segment_id == target_id))
    assert Enum.any?(page2.target_segments, &(&1.segment_id == target_id))

    writer = chapter_writer("修订后的重复写法只出现一次。", self())

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               j3,
               %{},
               g2_run(ctx, @g2_author),
               %DialogueContext{workspace_id: ctx.work.id, interaction_state: %{}},
               writer
             )

    assert_received {:chapter_writer_prompt, prompt}
    assert prompt =~ target_id
    assert prompt =~ "本轮局部修订目标段"

    [pending] = result.turn_result.adoption_state.pending

    assert pending.payload.adoption_effect["target_segment_ids"] == [target_id]
    assert pending.payload.scope["target_segment_ids"] == [target_id]
    assert pending.payload.title == "#{ctx.chapter.title}（指定段落修订稿）"

    # 作者可见活动只保留既有读证，不投影段 ID/hash/字节坐标。
    refute page1.activity_summary =~ target_id
    refute page1.activity_summary =~ "source_hash"
  end

  test "G2 只读一页就选同一跨页段：有界纠错后拒绝，不生成候选" do
    ctx = seed_long_chapter(default_g2_prose())
    provider = g2_execution(self(), :partial)
    {j1, _request} = judge!(ctx, @g2_author, nil, provider, "explore")
    {:ok, page1} = run_chapter_exploration(ctx, j1)

    assert {:error, {:judgment_protocol_violation, {:target_segments, :incomplete_page_coverage}},
            state} =
             JudgmentProtocol.request_judgment(
               provider,
               %{},
               judgment_input(ctx, @g2_author, transcript(j1, page1))
             )

    assert state.provider_call_count == 2
    assert Repo.all(Draft) |> Enum.map(& &1.content) == [ctx.base]
    refute_received {:chapter_writer_prompt, _prompt}
  end

  test "G2 作者显式段号优先，模型观察选段不覆盖" do
    ctx = seed_long_chapter(explicit_g2_prose())
    author = "只改第一段，把「开篇」改成「起笔」，其余逐字保留。"
    %{judgment: j3} = run_revision_flow(ctx, author, :happy)

    assert j3.target_segment_ids == []
    first_segment = ctx.base |> LocalizedRevision.segment() |> hd()

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               j3,
               %{},
               g2_run(ctx, author),
               %DialogueContext{workspace_id: ctx.work.id, interaction_state: %{}},
               chapter_writer("起笔：陈九斤在井口停下。", self())
             )

    assert_received {:chapter_writer_prompt, prompt}
    assert prompt =~ first_segment.segment_id

    [pending] = result.turn_result.adoption_state.pending
    assert pending.payload.adoption_effect["target_segment_ids"] == [first_segment.segment_id]
  end

  test "G2 观察后基线已变：执行前按当前章事实拒绝，不调用 writer" do
    ctx = seed_long_chapter(default_g2_prose())
    %{judgment: j3} = run_revision_flow(ctx, @g2_author, :happy)

    Repo.update!(
      Ecto.Changeset.change(ctx.draft, content: ctx.base <> "\n\n作者刚补写一段。", revision: 2)
    )

    assert {:error, {:pending_artifact_invalid, :stale_base_version}, _state} =
             PendingArtifactWorkflow.run(
               j3,
               %{},
               g2_run(ctx, @g2_author),
               %DialogueContext{workspace_id: ctx.work.id, interaction_state: %{}},
               chapter_writer("不会用到的候选。", self())
             )

    refute_received {:chapter_writer_prompt, _prompt}
  end

  # ── G2 真实回归：judgment → 两页真实观察 → Pending → writer ───────────

  defp run_revision_flow(ctx, author, mode) do
    provider = g2_execution(self(), mode)

    {j1, request1} = judge!(ctx, author, nil, provider, "explore")

    prompt = TestAgenticLoopFixtures.prompt_text(request1)
    [_, target_section] = String.split(prompt, "## 可选章级修订目标")
    [catalog, _] = String.split(target_section, "\n## ", parts: 2)

    assert catalog =~
             "- #{ctx.chapter_ref}｜#{@g2_title}｜已采纳稿 1 篇｜覆盖 complete（材料覆盖）｜"

    for scope <- ["format_only=仅排版", "target_segments=指定片段", "whole_chapter=整章"],
        do: assert(catalog =~ scope)

    assert catalog |> String.split("\n") |> Enum.count(&String.starts_with?(&1, "- ")) == 1

    {:ok, page1} = run_chapter_exploration(ctx, j1)

    {j2, request2} = judge!(ctx, author, transcript(j1, page1), provider, "explore")
    assert [observed_page1] = g2_pages(request2)
    assert observed_page1.content["source_hash"] == page1.source_hash

    assert Enum.map(observed_page1.content["target_segments"], & &1["segment_id"]) ==
             Enum.map(page1.target_segments, & &1.segment_id)

    assert observed_page1.coverage["prose_byte_range"]["start"] == page1.prose_byte_range.start
    assert observed_page1.coverage["prose_byte_range"]["end"] == page1.prose_byte_range.end

    {:ok, page2} = run_chapter_exploration(ctx, j2)

    {j3, request3} = judge!(ctx, author, transcript(j2, page2), provider, "execute")
    assert length(g2_pages(request3)) == 2

    %{judgment: j3, pages: [page1, page2]}
  end

  defp judge!(ctx, author, transcript, provider, action) do
    assert {:ok, judgment} =
             JudgmentProtocol.request_judgment(
               provider,
               %{},
               judgment_input(ctx, author, transcript)
             )

    assert judgment.action == action
    assert_received {:judgment_request, request}
    {judgment, request}
  end

  defp transcript(judgment, page),
    do: JudgmentProtocol.observation_transcript(judgment.transcript, judgment, page)

  defp default_g2_prose, do: String.duplicate("灰烬里按出一枚手印，", 900)

  defp explicit_g2_prose,
    do: "开篇：陈九斤在井口停下。" <> String.duplicate("灰烬里按出一枚手印，", 850)

  defp seed_long_chapter(prose) do
    {:ok, work} = WorkService.create(%{title: "B82 G2 观察目标"})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

    volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{
        work_id: work.id,
        volume_id: volume.id,
        title: @g2_title,
        seq: 2
      })

    scene = Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 1", seq: 1})

    draft =
      Repo.insert!(%Draft{
        work_id: work.id,
        scene_id: scene.id,
        content: prose,
        status: AdoptionStatus.accepted(),
        revision: 1
      })

    chapter_ref = "chapter:#{chapter.id}"
    base = ReadingProjectionRepo.accepted_chapter_prose(work.id, chapter_ref)
    assert base == prose

    %{
      work: work,
      session: session,
      chapter: chapter,
      draft: draft,
      chapter_ref: chapter_ref,
      base: base
    }
  end

  defp judgment_input(ctx, author, transcript) do
    {:ok, chapter_targets} = AdoptionWorkflow.chapter_revision_targets(ctx.work.id)

    context = %DialogueContext{workspace_id: ctx.work.id, interaction_state: %{}}
    adopted = PendingArtifactWorkflow.accepted_targets(context)
    capabilities = adopted |> Map.values() |> List.flatten() |> Enum.uniq()

    %{
      author_text: author,
      context_block: "作品：#{ctx.work.title}",
      source_input_ref: "turn-g2-observed-target",
      supplied_context_refs: [],
      transcript: transcript,
      options: [
        capabilities: capabilities,
        pending_artifact_targets: %{},
        adopted_content_targets: adopted,
        chapter_revision_targets: chapter_targets,
        character_targets: [],
        readonly_capabilities: [],
        author_content_sources: [],
        explore: true,
        explore_tools: ExplorationService.tool_names()
      ]
    }
  end

  defp run_chapter_exploration(ctx, judgment) do
    %{tool: tool, query: query} = judgment.explore_request
    ExplorationService.run(ctx.work.id, tool, query)
  end

  defp g2_run(ctx, author) do
    %{
      run_id: "run-g2-observed-target",
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
      authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]},
      workspace_id: ctx.work.id,
      work_id: ctx.work.id,
      session_id: ctx.session.id,
      parent_turn_ref: "request",
      goal: %{text: author, version: 1}
    }
  end

  defp g2_execution(test_pid, mode) do
    %Execution{
      result_fn: fn request ->
        send(test_pid, {:judgment_request, request})
        {text, calls} = g2_response(mode, g2_pages(request))
        ref = TestAgenticLoopFixtures.unique_provider_call_id("pcall-g2")

        {:ok,
         %Result{
           content: text,
           tool_calls: calls,
           provider_call_ref: ref,
           provider_output: %ProviderOutput{
             provider_run_ref: "run-#{ref}",
             provider_call_ref: ref,
             status: :ok,
             content: %{text: text, tool_calls: calls}
           }
         }}
      end
    }
  end

  defp g2_response(_mode, []),
    do: {"先读第一页。", [explore_call(Jason.encode!(%{"chapter_seq" => 2, "offset" => 0}))]}

  defp g2_response(:happy, [page1]),
    do: {"继续读第二页。", [explore_call(continuation_query(page1))]}

  defp g2_response(:happy, pages) do
    {"按刚读到的重复写法修订。", [execute_call(page_chapter_ref(hd(pages)), cross_page_target(pages))]}
  end

  defp g2_response(:partial, [page1 | _]) do
    {"按已读内容修订。", [execute_call(page_chapter_ref(page1), cross_page_target([page1]))]}
  end

  # 续页只从实际观察叶取同章 ref 与 next_offset。
  defp continuation_query(page) do
    Jason.encode!(%{
      "chapter_ref" => page_chapter_ref(page),
      "offset" => leaf_field(page, :next_offset)
    })
  end

  defp page_chapter_ref(page), do: leaf_coverage(page)["chapter_ref"]
  defp page_byte_range(page), do: leaf_coverage(page)["prose_byte_range"] || %{}
  defp page_segments(page), do: leaf_content(page)["target_segments"] || []

  # 跨页目标只取真实跨越页边界（byte_start < boundary < byte_end）的既有段；
  # 找不到就失败，不回退到页内第一段。
  defp cross_page_target(pages) do
    first = Enum.min_by(pages, &(page_byte_range(&1)["start"] || 0))
    boundary = Map.fetch!(page_byte_range(first), "end")

    if length(pages) > 1 do
      assert Enum.any?(pages, &(page_byte_range(&1)["start"] == boundary))
    end

    found =
      Enum.find_value(pages, fn page ->
        Enum.find(page_segments(page), fn segment ->
          segment["byte_start"] < boundary and segment["byte_end"] > boundary
        end)
      end)

    case found do
      %{"segment_id" => id} -> id
      nil -> flunk("no observed segment crosses page boundary at byte #{boundary}")
    end
  end

  defp g2_pages(%RequestIR{messages: messages}) do
    for %{blocks: blocks} <- messages,
        %{type: "observation"} = block <- blocks,
        leaf <- RequestIR.observation_payloads(block),
        leaf_field(leaf, :status) == "ok",
        leaf_content(leaf)["tool"] == "chapter_read",
        do: leaf
  end

  defp leaf_field(leaf, key) when is_map(leaf),
    do: Map.get(leaf, key, Map.get(leaf, to_string(key)))

  defp leaf_content(leaf), do: leaf_field(leaf, :content) || %{}
  defp leaf_coverage(leaf), do: leaf_field(leaf, :coverage) || %{}

  defp explore_call(query) do
    call("judgment_decision", %{
      "action" => "explore",
      "dialogue_goal" => "读取章节正文核对",
      "reason" => "核对正文",
      "explore_request" => %{"tool" => "chapter_read", "query" => query}
    })
  end

  defp execute_call(chapter_ref, target_id) do
    call("judgment_decision", %{
      "action" => "execute",
      "capability" => "revise_adopted_content",
      "adopted_content_ref" => chapter_ref,
      "target_segment_ids" => [target_id],
      "dialogue_goal" => "把发现的重复写法改成一段候选",
      "reason" => "按作者要求修订"
    })
  end

  defp call(name, args) do
    %{
      id: "call-#{name}-#{System.unique_integer([:positive])}",
      name: name,
      arguments: args
    }
  end

  defp chapter_writer(body, test_pid) do
    %Execution{
      result_fn: fn prompt ->
        send(test_pid, {:chapter_writer_prompt, TestAgenticLoopFixtures.prompt_text(prompt)})

        items = [
          %{
            item_id: "g2-chapter-revision-1",
            title: "#{@g2_title}（指定段落修订稿）",
            body: body,
            rationale: "按作者要求处理。"
          }
        ]

        tool_calls =
          TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{
            items: items
          })

        {:ok,
         %Result{
           content: "",
           tool_calls: tool_calls,
           provider_call_ref: "pcall-g2-chapter",
           provider_output: %ProviderOutput{
             provider_run_ref: "prun-g2-chapter",
             provider_call_ref: "pcall-g2-chapter",
             status: :ok,
             content: %{text: "", tool_calls: tool_calls}
           }
         }}
      end
    }
  end
end
