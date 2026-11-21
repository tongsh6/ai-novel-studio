defmodule NovelApplication.B28ChapterRevisionWiringTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Test.Provider.SliceVerify

  alias NovelApplication.{
    AdoptionWorkflow,
    ChapterRevisionScope,
    PendingArtifactWorkflow,
    TestAgenticLoopFixtures,
    WorkService
  }

  alias NovelDomain.AgentRun
  alias NovelDomain.DialogueContext
  alias NovelFoundation.Enums.AdoptionStatus

  alias NovelPersistence.{
    AdoptionRepository,
    LocalizedRevision,
    ReadingProjectionRepo,
    Repo,
    WorkSessionRepo
  }

  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}
  alias NovelTest.TestProviderPrompt

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{title: "B28 章级修订"})
    {:ok, session} = WorkSessionRepo.ensure_active_for_work(work.id)

    volume = Repo.insert!(%Volume{work_id: work.id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: "第01章：灯楼夜雨", seq: 1})

    scene1 = Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 1", seq: 1})
    scene2 = Repo.insert!(%Scene{work_id: work.id, chapter_id: chapter.id, title: "场景 2", seq: 2})

    draft1 =
      Repo.insert!(%Draft{
        work_id: work.id,
        scene_id: scene1.id,
        content: "初稿：陈九斤二十五岁守灯楼，第七盏灯不点自亮。",
        status: AdoptionStatus.accepted(),
        revision: 2
      })

    draft2 =
      Repo.insert!(%Draft{
        work_id: work.id,
        scene_id: scene2.id,
        content: "续写：灯楼九层，每层九盏，他数到第九层时天边泛白。",
        status: AdoptionStatus.accepted(),
        revision: 1
      })

    chapter_ref = "chapter:#{chapter.id}"

    facts = %{
      work: work,
      session: session,
      chapter_ref: chapter_ref,
      chapter_title: chapter.title,
      draft1_ref: "draft:#{draft1.id}",
      draft2_ref: "draft:#{draft2.id}",
      base_text: "初稿：陈九斤二十五岁守灯楼，第七盏灯不点自亮。\n\n续写：灯楼九层，每层九盏，他数到第九层时天边泛白。"
    }

    author_input = %{turn_id: "request", text: "把第一章正文整理一下，只调整分段和排版，别改字句。"}

    {:ok, run} =
      AgentRun.new(%{
        run_id: "run-b28-chapter",
        origin_frame_ref: "frame-b28-chapter",
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
        workspace_id: work.id,
        work_id: work.id,
        session_id: session.id,
        parent_turn_ref: author_input.turn_id,
        goal: %{text: author_input.text, version: 1}
      })

    context = %DialogueContext{work_id: work.id, interaction_state: %{}}

    {:ok, Map.merge(facts, %{run: run, context: context, author_input: author_input})}
  end

  defp judgment(chapter_ref, opts \\ %{modification_scope: "format_only"}) do
    Map.merge(
      %{
        action: "execute",
        capability: "revise_adopted_content",
        adopted_content_ref: chapter_ref,
        pending_artifact_ref: nil,
        dialogue_goal: "整理第01章正文：只调标点和分段，不改字句",
        narrative: "整理第01章正文，只调标点和分段。",
        reason: "revise_adopted_content",
        frame_type: "execution_candidate",
        candidate_directions: [],
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
      },
      opts
    )
  end

  defp provider(body, test_pid, attrs \\ []) do
    %Execution{
      result_fn: fn prompt ->
        send(
          test_pid,
          {:chapter_writer_prompt, prompt}
        )

        items =
          [
            %{
              item_id: "chapter-revision-1",
              title: "第01章：灯楼夜雨（整章修订）",
              body: body,
              rationale: "按作者要求处理。"
            }
            |> Map.merge(Map.new(attrs))
          ]

        tool_calls =
          TestAgenticLoopFixtures.native_tool_calls("submit_tentative_artifact", %{items: items})

        {:ok,
         %NovelAgent.Provider.Result{
           content: "",
           tool_calls: tool_calls,
           provider_call_ref: "pcall-b28-chapter",
           provider_output: %NovelCommon.Contracts.ProviderOutput{
             provider_run_ref: "prun-b28-chapter",
             provider_call_ref: "pcall-b28-chapter",
             status: :ok,
             content: %{text: "", tool_calls: tool_calls}
           }
         }}
      end
    }
  end

  test "章级目标进入 accepted_targets（chapter ref，不只单 artifact）", c do
    targets = PendingArtifactWorkflow.accepted_targets(c.context)

    assert targets[c.chapter_ref] == ["revise_adopted_content"]
  end

  test "format_only：模型计划因果字段保真，完整章预览独立，采纳重算并刷新摘要", c do
    view = NovelDomain.ProseFormatting.view(c.base_text)
    changes = [%{boundary_id: hd(view.boundaries).boundary_id, lines: 1}]
    explanation = "  让两段紧密衔接。\n"

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref),
               c.author_input,
               c.run,
               c.context,
               provider(explanation, self(), line_break_changes: changes)
             )

    assert_received {:chapter_writer_prompt, request}
    scope = TestProviderPrompt.scope_content(request)
    assert TestProviderPrompt.author_text(request) == c.author_input.text

    author = Enum.find(request.messages, &(&1.role == "user" and &1.provenance == "author"))
    current_scope = request.messages |> Enum.filter(&(&1.role == "scope_update")) |> List.last()
    base = Enum.find(request.messages, &(&1.role == "application_base"))

    assert %{ref: c.author_input.turn_id} in author.source_refs
    assert Enum.any?(current_scope.source_refs, &(&1.ref == c.author_input.turn_id))
    assert Enum.map(request.refs.base_refs, & &1.ref) == [c.draft1_ref, c.draft2_ref]
    assert base.source_refs == request.refs.base_refs
    assert request.refs.observation_refs == []

    assert get_in(scope, ["operation", "artifact_type"]) == "prose_formatting_plan"
    prompt = TestProviderPrompt.text(request)
    assert prompt =~ "可选换行边界"
    assert prompt =~ hd(view.boundaries).boundary_id
    assert get_in(scope, ["authoring_task", "scope", "target_chapter_ref"]) == c.chapter_ref
    assert get_in(scope, ["authoring_task", "scope", "refs"]) == [c.draft1_ref, c.draft2_ref]
    assert prompt =~ "只提出换行计划"
    refute prompt =~ "本次你承担小说正文写作助手"

    [pending] = result.turn_result.adoption_state.pending
    payload = pending.payload
    assert pending.artifact_type == :prose_formatting_plan
    assert pending.target_chapter_ref == c.chapter_ref
    assert payload.base_text == c.base_text
    assert hd(payload.items).body == explanation
    assert hd(payload.items).line_break_changes == changes
    assert payload.formatting_preview == String.replace(c.base_text, "\n\n", "\n")
    assert payload.title == "#{c.chapter_title}（分段方案）"
    [card] = Enum.filter(result.turn_result.ui_cards, &(&1.card_type == "candidate_set"))
    assert card.formatting_preview == payload.formatting_preview
    assert hd(card.items).body == explanation

    actions =
      Enum.filter(result.turn_result.available_actions, &(&1.target_ref == pending.artifact_id))

    assert Enum.map(actions, & &1.action_type) == ["accept", "discard"]

    assert PendingArtifactWorkflow.operations(pending) == [
             "revise_pending_artifact",
             "discard_pending_artifact"
           ]

    assert payload.adoption_effect["mode"] == "format_paragraphs"
    assert payload.adoption_effect["covered"] == ["#{c.draft1_ref}:2", "#{c.draft2_ref}:1"]
    assert :ok = AdoptionWorkflow.validate_b28_contract(pending)

    test_pid = self()

    assert {:ok, receipt, _} =
             AdoptionWorkflow.handle_adopt(
               result.turn_result,
               %{"artifact_id" => pending.artifact_id, "work_id" => c.work.id},
               &AdoptionRepository.persist/1,
               nil,
               fn material ->
                 send(test_pid, {:summary_material, material})
                 :ok
               end
             )

    assert receipt.adoption_effect.mode == "format_paragraphs"
    assert_received {:summary_material, summary}
    assert summary.prose_text == payload.formatting_preview
    assert summary.material_scope == :chapter
    assert summary.revision_base =~ "draft:"
    saved = ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref)
    assert saved == payload.formatting_preview
    refute saved =~ explanation
  end

  test "format_only：未知边界与原样计划在候选前拒绝且不改正文", c do
    view = NovelDomain.ProseFormatting.view(c.base_text)

    for {changes, reason} <- [
          {[%{boundary_id: "invented", lines: 2}], :invalid_formatting_plan},
          {[%{boundary_id: hd(view.boundaries).boundary_id, lines: 2}], :no_formatting_changes}
        ] do
      assert {:error, {:pending_artifact_invalid, ^reason}, failure_state} =
               PendingArtifactWorkflow.run(
                 judgment(c.chapter_ref),
                 c.author_input,
                 c.run,
                 c.context,
                 provider("模型方案", self(), line_break_changes: changes)
               )

      assert failure_state.tool_call_count == 1
      assert failure_state.provider_call_count == 2
      assert_native_format_rejection(failure_state.judgment_transcript, reason)

      saved = ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref)
      assert saved == c.base_text
    end
  end

  test "format_only：篡改计划或预览不能采纳", c do
    view = NovelDomain.ProseFormatting.view(c.base_text)
    changes = [%{boundary_id: hd(view.boundaries).boundary_id, lines: 1}]

    {:ok, result} =
      PendingArtifactWorkflow.run(
        judgment(c.chapter_ref),
        c.author_input,
        c.run,
        c.context,
        provider("方案说明", self(), line_break_changes: changes)
      )

    [pending] = result.turn_result.adoption_state.pending
    bad_preview = put_in(pending.payload.formatting_preview, "篡改正文")

    assert {:error, :invalid_formatting_plan} =
             AdoptionWorkflow.validate_b28_contract(bad_preview)

    bad_plan =
      put_in(pending.payload.adoption_effect["line_break_changes"], [
        %{boundary_id: "other", lines: 2}
      ])

    assert {:error, :invalid_formatting_plan} = AdoptionWorkflow.validate_b28_contract(bad_plan)
  end

  test "对话调整分段：原预览不变不得生成新候选；真正变化仍保留原计划", c do
    view = NovelDomain.ProseFormatting.view(c.base_text)
    boundary = hd(view.boundaries).boundary_id
    changes = [%{boundary_id: boundary, lines: 1}]

    {:ok, first} =
      PendingArtifactWorkflow.run(
        judgment(c.chapter_ref),
        c.author_input,
        c.run,
        c.context,
        provider("原方案说明", self(), line_break_changes: changes)
      )

    source = first.turn_result

    {:ok, _} =
      NovelPersistence.MemoryLog.record(%{
        workspace_id: c.work.id,
        session_id: c.session.id,
        turn_id: source.turn_id,
        role: "assistant",
        content: %{text: source.assistant_message.text, turn_result: source},
        source_ref: source.turn_id,
        scope_ref: c.work.id
      })

    [original] = source.adoption_state.pending

    j =
      judgment(c.chapter_ref, %{
        capability: "revise_pending_artifact",
        pending_artifact_ref: original.artifact_id
      })

    input = %{turn_id: "adjust-plan", text: "把这份方案调整为紧凑排版，别改字句。"}

    run = %{
      c.run
      | parent_turn_ref: input.turn_id,
        goal: %{text: input.text, version: 1}
    }

    assert {:error, {:pending_artifact_invalid, :no_formatting_changes}, no_change_state} =
             PendingArtifactWorkflow.run(
               j,
               input,
               run,
               c.context,
               provider("只改说明", self(), line_break_changes: changes)
             )

    assert no_change_state.tool_call_count == 1
    assert no_change_state.provider_call_count == 2
    assert_native_format_rejection(no_change_state.judgment_transcript, :no_formatting_changes)

    assert {:ok, changed} =
             PendingArtifactWorkflow.run(
               j,
               input,
               run,
               c.context,
               provider("取消该处换行", self(),
                 line_break_changes: [%{boundary_id: boundary, lines: 0}]
               )
             )

    prompts =
      for _ <- 1..3 do
        assert_receive {:chapter_writer_prompt, prompt}
        TestProviderPrompt.text(prompt)
      end

    adjustment_prompt = List.last(prompts)
    refute adjustment_prompt =~ "原方案说明"
    assert adjustment_prompt =~ "仍以当前canon为源"
    assert adjustment_prompt =~ run.goal.text
    assert adjustment_prompt =~ boundary
    [candidate] = changed.turn_result.adoption_state.pending
    assert candidate.artifact_id != original.artifact_id
    assert candidate.payload.formatting_preview != original.payload.formatting_preview
    assert candidate.payload.formatting_preview == String.replace(c.base_text, "\n", "")
    assert ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref) == c.base_text
    {:ok, snapshot} = NovelApplication.WorkSessionService.show(c.work.id, c.session.id)
    assert Enum.any?(snapshot.pending_adoptions, &(&1.artifact_id == original.artifact_id))
  end

  test "无 accepted 正文的章给出可解释错误（不猜、不新建）", c do
    chapter =
      Repo.insert!(%Chapter{
        work_id: c.work.id,
        volume_id: hd(Repo.all(Volume)).id,
        title: "第02章：空章",
        seq: 2
      })

    assert {:error, {:pending_artifact_invalid, :incomplete_scope}, incomplete_state} =
             PendingArtifactWorkflow.run(
               judgment("chapter:#{chapter.id}"),
               c.author_input,
               c.run,
               c.context,
               %Execution{result_fn: fn _ -> flunk("无正文不得调用模型") end}
             )

    assert incomplete_state.tool_call_count == 0 and incomplete_state.provider_call_count == 0
  end

  test "read-only 会话修订已采纳章 → 可解释拒绝（不 crash、不调用 writer）", c do
    # B60 CP1 顺带修复：`false <- snapshot.read_only` 失败时 else 收到 true；
    # 修复前该路径会 raise WithClauseError（内部错误），修复后返回可解释拒绝。
    {:ok, archived} = WorkSessionRepo.archive(c.session)
    assert archived.status != "ACTIVE"

    assert {:error, {:pending_artifact_invalid, :revision_not_allowed}, read_only_state} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref),
               c.author_input,
               c.run,
               c.context,
               %Execution{result_fn: fn _ -> flunk("read-only 会话不得调用修订 writer") end}
             )

    assert read_only_state.tool_call_count == 0 and read_only_state.provider_call_count == 0

    # 拒绝路径零写入：原 accepted 正文与 session 状态不变，且没有新的 pending 候选。
    assert ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref) == c.base_text
    assert WorkSessionRepo.get_by_work(c.work.id, c.session.id).status == archived.status
  end

  test "slice_verify fixture：format_only 仅验证计划传递机制", c do
    provider = %Execution{
      result_fn: fn prompt ->
        SliceVerify.complete(nil, nil, prompt, %{})
      end
    }

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref),
               c.author_input,
               c.run,
               c.context,
               provider
             )

    [pending] = result.turn_result.adoption_state.pending
    [item] = pending.payload[:items]

    refute item.body == c.base_text
    assert item.line_break_changes != []
    assert pending.payload.formatting_preview != c.base_text

    assert NovelDomain.ProseFormatting.non_newline_text(pending.payload.formatting_preview) ==
             NovelDomain.ProseFormatting.non_newline_text(c.base_text)

    assert pending.payload[:title] == "#{c.chapter_title}（分段方案）"
    assert :ok = AdoptionWorkflow.validate_b28_contract(pending)
  end

  test "slice_verify 固定内容替换夹具经已绑定范围采纳，其余逐字保留", c do
    input = %{c.author_input | text: "把第一章正文里的二十五岁改成三十岁，其他不变。"}
    run = %{c.run | goal: %{text: input.text, version: 1}}

    judgment =
      observed_judgment(c, input, [hd(LocalizedRevision.segment(c.base_text)).segment_id], %{
        dialogue_goal: "把第一章正文里的二十五岁改成三十岁，其他不变。"
      })

    provider = %Execution{
      result_fn: fn prompt ->
        SliceVerify.complete(nil, nil, prompt, %{})
      end
    }

    assert {:ok, result} =
             PendingArtifactWorkflow.run(judgment, input, run, c.context, provider)

    [pending] = result.turn_result.adoption_state.pending
    [item] = pending.payload[:items]

    assert item.body =~ "三十岁"
    refute item.body =~ "二十五岁"
    refute item.body =~ "灯楼九层，每层九盏"
    assert pending.payload[:title] == "#{c.chapter_title}（指定段落修订稿）"
    assert :ok = AdoptionWorkflow.validate_b28_contract(pending)

    effect = pending.payload.adoption_effect
    assert [_target] = effect["target_segment_ids"]
    assert [%{"sha256" => hash}] = effect["expected_segment_hashes"]
    assert byte_size(hash) == 64

    assert {:ok, persisted} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: c.work.id,
               source_turn_ref: "turn-b28-literal-revision",
               artifact_id: pending.artifact_id,
               artifact_type: :prose_fragment,
               items: [item],
               summary: c.chapter_title,
               target_chapter_ref: c.chapter_ref,
               adoption_effect: effect,
               modification_scope: "target_segments",
               target_segment_ids: effect["target_segment_ids"],
               expected_segment_hashes: effect["expected_segment_hashes"],
               mode: :overwrite
             })

    assert persisted.reading_projection.adoption_effect == "replace_segments"
    assert length(persisted.reading_projection.segment_changes) == 1

    assert ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref) ==
             String.replace(c.base_text, "二十五岁", "三十岁")

    assert Enum.count(Repo.all(Draft), &(&1.status == "SUPERSEDED")) == 2
    assert length(Repo.all(Chapter)) == 1
  end

  test "范围提议缺失、非法或字段冲突时，不调用 writer、不生成候选", c do
    id = hd(LocalizedRevision.segment(c.base_text)).segment_id

    cases = [
      {%{}, {:modification_scope, :required}},
      {%{modification_scope: "paragraphs"}, {:modification_scope, :invalid}},
      {%{modification_scope: "target_segments"}, {:target_segments, :ids_required}},
      {%{modification_scope: "target_segments", target_segment_ids: [id, id]},
       {:target_segments, :invalid_selection}},
      {%{modification_scope: "whole_chapter", target_segment_ids: [id]},
       {:target_segments, :not_allowed}}
    ]

    before = Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision})

    for {fields, reason} <- cases do
      assert {:error, ^reason, state} =
               PendingArtifactWorkflow.run(
                 judgment(c.chapter_ref, fields),
                 c.author_input,
                 c.run,
                 c.context,
                 %Execution{result_fn: fn _ -> flunk("范围提议非法不得调用 writer") end}
               )

      assert state.tool_call_count == 0 and state.provider_call_count == 0
    end

    assert Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision}) == before
  end

  test "真实读证中的第十一源片段经显式选集传递，不回退首项", c do
    draft2 = Repo.get!(Draft, String.replace_prefix(c.draft2_ref, "draft:", ""))
    tail = Enum.map_join(1..10, "\n\n", &"灯楼第#{&1}层，灯焰未灭。")
    Repo.update!(Ecto.Changeset.change(draft2, content: tail))

    segments =
      LocalizedRevision.segment(
        ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref)
      )

    input = %{c.author_input | text: "只改第十一段，其他段逐字保留。"}

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               observed_judgment(c, input, [Enum.at(segments, 10).segment_id], %{
                 dialogue_goal: "只改第十一段"
               }),
               input,
               %{c.run | goal: %{text: input.text, version: 1}},
               c.context,
               provider("灯楼第十层，灯焰骤亮。", self(),
                 target_segment_ids: [Enum.at(segments, 10).segment_id]
               )
             )

    assert [pending] = result.turn_result.adoption_state.pending

    assert pending.payload.adoption_effect["target_segment_ids"] ==
             [Enum.at(segments, 10).segment_id]
  end

  for interpretation <- ["指定片段替换，非整章重写", "整章重写并给出完整替换稿"] do
    test "模型说明#{interpretation}不改变已绑定的固定片段选集", c do
      author = "把已保存的第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。"
      run = %{c.run | goal: %{text: author, version: 1}}
      target_body = "初稿：陈九斤三十岁守灯楼，第七盏灯不点自亮。"
      target_id = hd(LocalizedRevision.segment(c.base_text)).segment_id

      assert {:ok, result} =
               PendingArtifactWorkflow.run(
                 observed_judgment(c, %{c.author_input | text: author}, [target_id], %{
                   dialogue_goal: unquote(interpretation)
                 }),
                 %{c.author_input | text: author},
                 run,
                 c.context,
                 provider(target_body, self(), target_segment_ids: [target_id])
               )

      assert_received {:chapter_writer_prompt, request}
      prompt = TestProviderPrompt.text(request)
      assert prompt =~ "每个 item 以 target_segment_ids 显式绑定一个连续源区间"
      refute prompt =~ "本轮为整章正文修订"
      [pending] = result.turn_result.adoption_state.pending
      assert pending.payload.modification_scope == "target_segments"
      assert pending.payload.adoption_effect["mode"] == "replace_segments"
      assert [_] = pending.payload.adoption_effect["target_segment_ids"]
      assert hd(pending.payload.items).body == target_body
    end
  end

  test "whole_chapter 固定提议不因 goal 文本再次裁剪成单段", c do
    input = %{c.author_input | text: "请通读整章并修订第一章正文。"}
    run = %{c.run | goal: %{text: input.text, version: 1}}

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref, %{
                 dialogue_goal: "只改第一段",
                 modification_scope: "whole_chapter"
               }),
               input,
               run,
               c.context,
               provider(c.base_text, self())
             )

    [pending] = result.turn_result.adoption_state.pending
    assert pending.payload.modification_scope == "whole_chapter"
    assert pending.payload.adoption_effect["mode"] == "replace_scope"
    assert pending.payload.adoption_effect["coverage"] == "complete"
  end

  test "B35 target_segments：prompt 要求目标段替换，候选声明 scope/covered/preserve", c do
    input = %{c.author_input | text: "只把第一章开头一段改得更紧张，其他段落逐字保留。"}
    run = %{c.run | goal: %{text: input.text, version: 1}}

    first = hd(LocalizedRevision.segment(c.base_text))
    {body, _separator} = LocalizedRevision.split_segment_raw(first.raw)

    judgment =
      observed_judgment(c, input, [first.segment_id], %{
        dialogue_goal: "只把第一章开头一段改得更紧张，其他段落逐字保留。"
      })

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment,
               input,
               run,
               c.context,
               provider(body, self(), target_segment_ids: [first.segment_id])
             )

    assert_received {:chapter_writer_prompt, request}
    prompt = TestProviderPrompt.text(request)
    assert prompt =~ "每个 item 以 target_segment_ids 显式绑定一个连续源区间"
    assert prompt =~ "未选区间由系统逐字节保留"

    [pending] = result.turn_result.adoption_state.pending
    payload = pending.payload

    assert payload[:modification_scope] == "target_segments"
    assert payload[:scope]["kind"] == "target_segments"
    assert payload[:scope]["target_chapter_ref"] == c.chapter_ref
    assert payload[:scope]["covered"] != []
    assert payload[:scope]["preserve_unmentioned_verbatim"] == true
    assert payload[:scope]["target_segment_ids"] != []
    assert is_list(payload[:scope]["expected_segment_hashes"])
    assert payload[:scope]["base_draft_ref"] != nil
    assert payload[:adoption_effect]["mode"] == "replace_segments"

    assert payload[:adoption_effect]["target_segment_ids"] ==
             payload[:scope]["target_segment_ids"]
  end

  # 给定结构化判断验证读取、执行与采纳；固定输出不证明模型理解否定或条件。

  test "真实长 CJK 末片段选集经 target_segments 采纳，其他片段逐字节不变", c do
    long = String.duplicate("灰", 1_700)
    draft2 = Repo.get!(Draft, String.replace_prefix(c.draft2_ref, "draft:", ""))
    Repo.update!(Ecto.Changeset.change(draft2, content: long))
    base = ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref)
    last = base |> LocalizedRevision.segment() |> List.last()
    input = %{c.author_input | text: "不要整章重写，只改最后一段。"}
    run = %{c.run | goal: %{text: input.text, version: 1}}
    target_body = "续写：灯楼九层，每层九盏，他数到第九层时，天已经亮了。"

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               observed_judgment(c, input, [last.segment_id], %{dialogue_goal: "只改最后一段"}),
               input,
               run,
               c.context,
               provider(target_body, self(), target_segment_ids: [last.segment_id])
             )

    assert_received {:chapter_writer_prompt, request}
    prompt = TestProviderPrompt.text(request)
    assert prompt =~ "每个 item 以 target_segment_ids 显式绑定一个连续源区间"
    refute prompt =~ "本轮为整章正文修订"

    [pending] = result.turn_result.adoption_state.pending
    payload = pending.payload
    assert payload.modification_scope == "target_segments"
    effect = payload.adoption_effect
    assert effect["mode"] == "replace_segments"

    assert effect["target_segment_ids"] == [last.segment_id]

    [item] = payload.items
    assert item.body == target_body

    assert {:ok, persisted} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: c.work.id,
               source_turn_ref: "turn-b28-cp1-negated-whole",
               artifact_id: pending.artifact_id,
               artifact_type: :prose_fragment,
               items: [item],
               summary: c.chapter_title,
               target_chapter_ref: c.chapter_ref,
               adoption_effect: effect,
               modification_scope: "target_segments",
               target_segment_ids: effect["target_segment_ids"],
               expected_segment_hashes: effect["expected_segment_hashes"],
               mode: :overwrite
             })

    assert persisted.reading_projection.adoption_effect == "replace_segments"
    assert length(persisted.reading_projection.segment_changes) == 1

    assert ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref) ==
             binary_part(base, 0, byte_size(base) - byte_size(last.raw)) <> target_body

    # 非目标长 CJK 前缀逐字节保留
    assert ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref) =~
             String.duplicate("灰", 1_333)
  end

  test "真实完整章页只支持给定的第二片段选集，读取不扩大修改范围", c do
    input = %{c.author_input | text: "通读全文后只修第二段。"}
    run = %{c.run | goal: %{text: input.text, version: 1}}
    target_body = "续写：灯楼九层，每层九盏，他数到第九层时，天已经亮了。"
    second = Enum.at(LocalizedRevision.segment(c.base_text), 1)

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               observed_judgment(c, input, [second.segment_id], %{dialogue_goal: "只修第二段"}),
               input,
               run,
               c.context,
               provider(target_body, self(), target_segment_ids: [second.segment_id])
             )

    [pending] = result.turn_result.adoption_state.pending
    payload = pending.payload
    assert payload.modification_scope == "target_segments"
    [second_id] = payload.adoption_effect["target_segment_ids"]

    assert second_id == second.segment_id
  end

  test "局部选集缺真实读证或偏离绑定时拒绝，零候选零写入", c do
    [first, second] = LocalizedRevision.segment(c.base_text)
    bound = observed_judgment(c, c.author_input, [first.segment_id])
    before = Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision})

    for proposal <- [
          Map.delete(bound, :observed_targets),
          %{bound | target_segment_ids: [second.segment_id]}
        ] do
      assert {:error, {:pending_artifact_invalid, :incomplete_scope}, state} =
               PendingArtifactWorkflow.run(
                 proposal,
                 c.author_input,
                 c.run,
                 c.context,
                 %Execution{result_fn: fn _ -> flunk("缺失或冲突读证不得调用 writer") end}
               )

      assert state.tool_call_count == 0 and state.provider_call_count == 0
    end

    assert Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision}) == before
  end

  test "真实读证绑定后 accepted 版本改变，候选前复核拒绝过期目标", c do
    first = hd(LocalizedRevision.segment(c.base_text))
    bound = observed_judgment(c, c.author_input, [first.segment_id])
    draft = Repo.get!(Draft, String.replace_prefix(c.draft1_ref, "draft:", ""))
    Repo.update!(Ecto.Changeset.change(draft, revision: draft.revision + 1))
    before = Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision})

    assert {:error, {:pending_artifact_invalid, :stale_base_version}, state} =
             PendingArtifactWorkflow.run(
               bound,
               c.author_input,
               c.run,
               c.context,
               %Execution{result_fn: fn _ -> flunk("过期读证不得调用 writer") end}
             )

    assert state.tool_call_count == 0 and state.provider_call_count == 0
    assert Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision}) == before
  end

  defp observed_judgment(c, input, ids, opts \\ %{}) do
    request = TestAgenticLoopFixtures.chapter_read_request(c.run, input, c.chapter_ref)

    proposal =
      judgment(
        c.chapter_ref,
        Map.merge(opts, %{
          modification_scope: "target_segments",
          target_segment_ids: ids
        })
      )

    assert {:ok, bound} = ChapterRevisionScope.bind_observed_targets(proposal, request)
    bound
  end

  defp assert_native_format_rejection(transcript, reason) do
    validations =
      for message <- transcript.messages,
          block <- message.blocks,
          block.type == "validation_result",
          do: block

    assert length(validations) == 2
    assert Enum.all?(validations, &(&1.reason_code == to_string(reason)))

    refute Enum.any?(transcript.messages, fn message ->
             message.role == "user" and
               Enum.any?(message.blocks, fn block ->
                 block.type == "text" and String.contains?(block.text, "修订校验未通过")
               end)
           end)
  end
end
