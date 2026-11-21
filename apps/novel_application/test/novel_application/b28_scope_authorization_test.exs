defmodule NovelApplication.B28ScopeAuthorizationTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.{Execution, Result}

  alias NovelApplication.{
    ChapterRevisionScope,
    ExplorationService,
    JudgmentProtocol,
    PendingArtifactWorkflow,
    TestAgenticLoopFixtures,
    WorkService
  }

  alias NovelCommon.Contracts.ProviderOutput
  alias NovelCommon.RequestIR
  alias NovelDomain.AgentRun
  alias NovelDomain.DialogueContext
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{LocalizedRevision, ReadingProjectionRepo, Repo, WorkSessionRepo}
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}
  alias NovelTest.TestProviderPrompt

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
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

    {:ok, calls} = Agent.start_link(fn -> 0 end)

    writer =
      chapter_writer("修订后的重复写法只出现一次。", self(), fn _prompt ->
        Agent.get_and_update(calls, fn count ->
          {if(count == 0, do: ["seg_unknown"], else: [target_id]), count + 1}
        end)
      end)

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               j3,
               %{text: @g2_author},
               g2_run(ctx, @g2_author),
               %DialogueContext{work_id: ctx.work.id, interaction_state: %{}},
               writer
             )

    assert_received {:chapter_writer_prompt, request}
    scope = TestProviderPrompt.scope_content(request)
    assert scope["operation"]["context_text"] =~ target_id
    assert scope["operation"]["context_text"] =~ "本轮局部修订目标段"
    assert scope["authoring_task"]["scope"]["modification_scope"] == "target_segments"
    assert TestProviderPrompt.author_text(request) == @g2_author

    for raw_ids <- [
          [target_id, target_id],
          [String.to_charlist(target_id)],
          [1],
          [nil],
          [" \t"],
          target_id
        ] do
      assert {:error, {:target_segments, :invalid_selection}} =
               ChapterRevisionScope.bind_observed_targets(
                 %{j3 | target_segment_ids: raw_ids},
                 request
               )
    end

    [pending] = result.turn_result.adoption_state.pending

    assert pending.payload.adoption_effect["target_segment_ids"] == [target_id]
    assert pending.payload.scope["target_segment_ids"] == [target_id]
    assert pending.payload.title == "#{ctx.chapter.title}（指定段落修订稿）"
    assert hd(pending.payload.items).target_segment_ids == [target_id]
    assert result.provider_call_count == 2
    assert Agent.get(calls, & &1) == 2
    assert_received {:chapter_writer_prompt, correction}
    blocks = Enum.flat_map(correction.messages, & &1.blocks)
    assert Enum.any?(blocks, &(&1.type == "validation_result" and &1.status == "failed"))

    assert Enum.any?(blocks, fn block ->
             block.type == "tool_call" and
               get_in(RequestIR.json_value(block.arguments), [
                 "items",
                 Access.at(0),
                 "target_segment_ids"
               ]) == ["seg_unknown"]
           end)

    # 作者可见活动只保留既有读证，不投影段 ID/hash/字节坐标。
    refute page1.activity_summary =~ target_id
    refute page1.activity_summary =~ "source_hash"
    unselected = hd(LocalizedRevision.segment(ctx.base)).segment_id

    for {ids, reason} <- [
          {["seg_unknown"], :incomplete_scope},
          {[unselected], :out_of_scope_changes}
        ] do
      assert {:error, {:pending_artifact_invalid, ^reason}, failed} =
               PendingArtifactWorkflow.run(
                 j3,
                 %{text: @g2_author},
                 g2_run(ctx, @g2_author),
                 %DialogueContext{work_id: ctx.work.id, interaction_state: %{}},
                 chapter_writer("不可应用的候选。", self(), ids)
               )

      assert failed.provider_call_count == 2
      assert_received {:chapter_writer_prompt, _first_failure}
      assert_received {:chapter_writer_prompt, _last_failure}

      assert ReadingProjectionRepo.accepted_chapter_prose(ctx.work.id, ctx.chapter_ref) ==
               ctx.base
    end
  end

  test "局部与整章候选再次修订沿用原授权和结构化正文，基线过期时零调用" do
    for {kind, words} <- [
          {"target_segments", @g2_author},
          {"whole_chapter", "请通读并整章修订第02章正文，减少重复，先不要保存。"}
        ] do
      ctx = seed_long_chapter(default_g2_prose())
      %{judgment: judgment} = run_revision_flow(ctx, words, :happy)
      ids = if kind == "target_segments", do: judgment.target_segment_ids
      context = %DialogueContext{work_id: ctx.work.id, interaction_state: %{}}
      original_body = "  原候选的独有句子。\r\n\r\n保留锚句。 "

      assert {:ok, first} =
               PendingArtifactWorkflow.run(
                 judgment,
                 %{text: words},
                 g2_run(ctx, words),
                 context,
                 chapter_writer(original_body, self(), ids)
               )

      assert_received {:chapter_writer_prompt, _initial}
      source = first.turn_result
      refute Enum.any?(source.available_actions, &(&1.action_type == "revise_from_findings"))
      [original] = source.adoption_state.pending

      {:ok, _} =
        NovelPersistence.MemoryLog.record(%{
          workspace_id: ctx.work.id,
          session_id: ctx.session.id,
          turn_id: source.turn_id,
          role: "assistant",
          content: %{text: source.assistant_message.text, turn_result: source},
          source_ref: source.turn_id,
          scope_ref: ctx.work.id
        })

      revise = %{
        judgment
        | capability: "revise_pending_artifact",
          pending_artifact_ref: original.artifact_id,
          adopted_content_ref: nil
      }

      input = %{turn_id: "revise-scoped-" <> kind, text: "把这份候选再写得简练一些。"}
      run = %{g2_run(ctx, input.text) | parent_turn_ref: input.turn_id}
      revised_body = "  新候选保持锚句。\n\n语句收束。\t"

      assert {:ok, revised} =
               PendingArtifactWorkflow.run(
                 revise,
                 input,
                 run,
                 context,
                 chapter_writer(revised_body, self(), ids)
               )

      assert_received {:chapter_writer_prompt, request}
      supplied = TestProviderPrompt.scope_content(request)
      assert supplied["authoring_task"]["scope"]["modification_scope"] == kind
      assert supplied["operation"]["context_text"] =~ ctx.base

      [_baseline, candidate_json] =
        String.split(
          supplied["operation"]["context_text"],
          "\n\n## 待调整的原候选（尚未采纳；保持原授权，针对作者新要求输出完整结构化候选）\n",
          parts: 2
        )

      assert Jason.decode!(candidate_json) == Jason.decode!(Jason.encode!(original.payload.items))
      [candidate] = revised.turn_result.adoption_state.pending

      refute Enum.any?(
               revised.turn_result.available_actions,
               &(&1.action_type == "revise_from_findings")
             )

      # MemoryLog 的真实 JSON 往返会把嵌套 atom key 编码为字符串，完整内容必须相同。
      assert Jason.decode!(Jason.encode!(candidate.payload.scope)) ==
               Jason.decode!(Jason.encode!(original.payload.scope))

      assert Jason.decode!(Jason.encode!(candidate.payload.adoption_effect)) ==
               Jason.decode!(Jason.encode!(original.payload.adoption_effect))

      assert candidate.payload.modification_scope == kind
      assert candidate.payload.revision_of == original.artifact_id
      assert hd(candidate.payload.items).body == revised_body

      assert ReadingProjectionRepo.accepted_chapter_prose(
               ctx.work.id,
               "chapter:#{ctx.chapter.id}"
             ) == ctx.base

      {:ok, session} = NovelApplication.WorkSessionService.show(ctx.work.id, ctx.session.id)
      assert Enum.any?(session.pending_adoptions, &(&1.artifact_id == original.artifact_id))

      incomplete = %{
        original
        | artifact_id: original.artifact_id <> "-incomplete",
          payload: Map.drop(original.payload, [:modification_scope, :adoption_effect])
      }

      invalid_source =
        source
        |> Map.put(:turn_id, source.turn_id <> "-incomplete")
        |> put_in([:adoption_state, :pending], [incomplete])

      {:ok, _} =
        NovelPersistence.MemoryLog.record(%{
          workspace_id: ctx.work.id,
          session_id: ctx.session.id,
          turn_id: invalid_source.turn_id,
          role: "assistant",
          content: %{text: invalid_source.assistant_message.text, turn_result: invalid_source},
          source_ref: invalid_source.turn_id,
          scope_ref: ctx.work.id
        })

      assert {:error, {:pending_artifact_invalid, :author_scope_not_authorized}, invalid_state} =
               PendingArtifactWorkflow.run(
                 %{revise | pending_artifact_ref: incomplete.artifact_id},
                 input,
                 run,
                 context,
                 %Execution{result_fn: fn _ -> flunk("残缺scope声明不得降级调用普通修订") end}
               )

      assert invalid_state.provider_call_count == 0

      Repo.update!(Ecto.Changeset.change(ctx.draft, revision: ctx.draft.revision + 1))

      assert {:error, {:pending_artifact_invalid, :stale_base_version}, state} =
               PendingArtifactWorkflow.run(revise, input, run, context, %Execution{
                 result_fn: fn _ -> flunk("过期原候选不得调用模型") end
               })

      assert state.provider_call_count == 0
    end
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
               %{text: author},
               g2_run(ctx, author),
               %DialogueContext{work_id: ctx.work.id, interaction_state: %{}},
               chapter_writer("起笔：陈九斤在井口停下。", self(), [first_segment.segment_id])
             )

    assert_received {:chapter_writer_prompt, request}
    scope = TestProviderPrompt.scope_content(request)
    assert scope["operation"]["context_text"] =~ first_segment.segment_id
    assert scope["authoring_task"]["scope"]["modification_scope"] == "target_segments"
    assert TestProviderPrompt.author_text(request) == author

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
               %{text: @g2_author},
               g2_run(ctx, @g2_author),
               %DialogueContext{work_id: ctx.work.id, interaction_state: %{}},
               chapter_writer("不会用到的候选。", self())
             )

    refute_received {:chapter_writer_prompt, _prompt}
  end

  # ── G2 真实回归：judgment → 两页真实观察 → Pending → writer ───────────

  defp run_revision_flow(ctx, author, mode) do
    provider = g2_execution(self(), mode)

    {j1, request1} = judge!(ctx, author, nil, provider, "explore")

    scope = TestProviderPrompt.scope_content(request1)
    refute Map.has_key?(scope["operation"], "chapter_revision_targets")
    refute Map.has_key?(scope["facts"], "chapters")

    assert scope["operation"]["adopted_content_targets"] == %{
             ctx.chapter_ref => ["revise_adopted_content"]
           }

    rules = RequestIR.SystemEnvelope.system_text(request1.system)

    for modification_scope <- ["format_only", "target_segments", "whole_chapter"],
        do: assert(rules =~ modification_scope)

    {:ok, page1} = run_chapter_exploration(ctx, j1)
    assert page1.chapter_ref == ctx.chapter_ref
    assert page1.chapter_seq == 2
    assert page1.refs == [ctx.chapter_ref]
    assert page1.summary =~ "灰烬中的手印"
    assert page1.prose_total_chars == String.length(ctx.base)
    assert page1.versions == %{"draft:#{ctx.draft.id}" => 1}

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
    context = %DialogueContext{work_id: ctx.work.id, interaction_state: %{}}
    adopted = PendingArtifactWorkflow.accepted_targets(context)
    capabilities = adopted |> Map.values() |> List.flatten() |> Enum.uniq()

    %{
      author_text: author,
      scope: %{
        work_id: ctx.work.id,
        facts: %{work: %{ref: "work:#{ctx.work.id}", work_id: ctx.work.id, title: ctx.work.title}},
        coverage: %{work: %{status: "complete"}},
        context: %{}
      },
      source_input_ref: "turn-g2-observed-target",
      supplied_context_refs: ["work:#{ctx.work.id}"],
      transcript: transcript,
      options: [
        plan_run: g2_run(ctx, author),
        capabilities: capabilities,
        pending_artifact_targets: %{},
        adopted_content_targets: adopted,
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
    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-g2-observed-target",
        origin_frame_ref: "frame-g2-observed-target",
        status: :running,
        phase: :executing,
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
        parent_turn_ref: "turn-g2-observed-target",
        goal: %{text: author, version: 1}
      })

    run
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
    do: {"", [explore_call(Jason.encode!(%{"chapter_seq" => 2, "offset" => 0}))]}

  defp g2_response(:happy, [page1]),
    do: {"", [explore_call(continuation_query(page1))]}

  defp g2_response(:happy, pages) do
    {"", [execute_call(page_chapter_ref(hd(pages)), cross_page_target(pages), "按刚读到的重复写法修订。")]}
  end

  defp g2_response(:partial, [page1 | _]) do
    {"", [execute_call(page_chapter_ref(page1), cross_page_target([page1]), "按已读内容修订。")]}
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
      "explore_request" => %{"tool" => "chapter_read", "query" => query}
    })
  end

  defp execute_call(chapter_ref, target_id, narrative) do
    call("judgment_decision", %{
      "action" => "execute",
      "capability" => "revise_adopted_content",
      "adopted_content_ref" => chapter_ref,
      "target_segment_ids" => [target_id],
      "dialogue_goal" => "把发现的重复写法改成一段候选",
      "author_reasoning" => narrative
    })
  end

  defp call(name, args) do
    %{
      id: "call-#{name}-#{System.unique_integer([:positive])}",
      name: name,
      arguments: args
    }
  end

  defp chapter_writer(body, test_pid, target_ids \\ nil) do
    %Execution{
      result_fn: fn prompt ->
        send(test_pid, {:chapter_writer_prompt, prompt})

        items = [
          %{
            item_id: "g2-chapter-revision-1",
            title: "#{@g2_title}（指定段落修订稿）",
            body: body,
            rationale: "按作者要求处理。"
          }
        ]

        ids = if is_function(target_ids, 1), do: target_ids.(prompt), else: target_ids

        items =
          if is_list(ids),
            do: Enum.map(items, &Map.put(&1, :target_segment_ids, ids)),
            else: items

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
