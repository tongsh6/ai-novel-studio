defmodule NovelApplication.B28ChapterRevisionWiringTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelApplication.{AdoptionWorkflow, PendingArtifactWorkflow, WorkService}
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

    run = %{
      run_id: "run-b28-chapter",
      run_mode: :bounded,
      profile_ref: "judgment_loop_v1",
      budget: %{max_tool_calls: 3, max_provider_calls: 6},
      consumed_budget: %{},
      authority_scope: %{production_write: false, allowed_tools: ["prose_writing"]},
      workspace_id: work.id,
      work_id: work.id,
      session_id: session.id,
      parent_turn_ref: "request",
      goal: %{text: "把第一章正文整理一下，只调整分段和排版，别改字句。", version: 1}
    }

    context = %DialogueContext{workspace_id: work.id, interaction_state: %{}}

    {:ok, Map.merge(facts, %{run: run, context: context})}
  end

  defp judgment(chapter_ref, opts \\ %{}) do
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

  defp provider(body, test_pid, changes \\ nil) do
    %Execution{
      result_fn: fn prompt ->
        send(test_pid, {:chapter_writer_prompt, prompt})

        content =
          Jason.encode!([
            %{
              item_id: "chapter-revision-1",
              title: "第01章：灯楼夜雨（整章修订）",
              body: body,
              rationale: "按作者要求处理。"
            }
            |> then(fn item ->
              if changes, do: Map.put(item, :line_break_changes, changes), else: item
            end)
          ])

        {:ok,
         %NovelAgent.Provider.Result{
           content: content,
           provider_call_ref: "pcall-b28-chapter",
           provider_output: %NovelCommon.Contracts.ProviderOutput{
             provider_run_ref: "prun-b28-chapter",
             provider_call_ref: "pcall-b28-chapter",
             status: :ok,
             content: %{text: content}
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
               %{},
               c.run,
               c.context,
               provider(explanation, self(), changes)
             )

    assert_received {:chapter_writer_prompt, prompt}
    assert prompt =~ "可选换行边界"
    assert prompt =~ hd(view.boundaries).boundary_id
    assert prompt =~ "artifact_type：prose_formatting_plan"
    assert prompt =~ "目标章 ref：#{c.chapter_ref}"
    assert prompt =~ "2 个已采纳片段"
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
      assert {:error, {:pending_artifact_invalid, ^reason}} =
               PendingArtifactWorkflow.run(
                 judgment(c.chapter_ref),
                 %{},
                 c.run,
                 c.context,
                 provider("模型方案", self(), changes)
               )

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
        %{},
        c.run,
        c.context,
        provider("方案说明", self(), changes)
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
        %{},
        c.run,
        c.context,
        provider("原方案说明", self(), changes)
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

    run = %{
      c.run
      | parent_turn_ref: "adjust-plan",
        goal: %{text: "把这份方案调整为紧凑排版，别改字句。", version: 1}
    }

    assert {:error, {:pending_artifact_invalid, :no_formatting_changes}} =
             PendingArtifactWorkflow.run(
               j,
               %{},
               run,
               c.context,
               provider("只改说明", self(), changes)
             )

    assert {:ok, changed} =
             PendingArtifactWorkflow.run(
               j,
               %{},
               run,
               c.context,
               provider("取消该处换行", self(), [%{boundary_id: boundary, lines: 0}])
             )

    prompts =
      for _ <- 1..3 do
        assert_receive {:chapter_writer_prompt, prompt}
        prompt
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

    assert {:error, {:pending_artifact_invalid, :incomplete_scope}} =
             PendingArtifactWorkflow.run(
               judgment("chapter:#{chapter.id}"),
               %{},
               c.run,
               c.context,
               %Execution{result_fn: fn _ -> flunk("无正文不得调用模型") end}
             )
  end

  test "read-only 会话修订已采纳章 → 可解释拒绝（不 crash、不调用 writer）", c do
    # B60 CP1 顺带修复：`false <- snapshot.read_only` 失败时 else 收到 true；
    # 修复前该路径会 raise WithClauseError（内部错误），修复后返回可解释拒绝。
    {:ok, archived} = WorkSessionRepo.archive(c.session)
    assert archived.status != "ACTIVE"

    assert {:error, {:pending_artifact_invalid, :revision_not_allowed}} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref),
               %{},
               c.run,
               c.context,
               %Execution{result_fn: fn _ -> flunk("read-only 会话不得调用修订 writer") end}
             )

    # 拒绝路径零写入：原 accepted 正文与 session 状态不变，且没有新的 pending 候选。
    assert ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref) == c.base_text
    assert WorkSessionRepo.get_by_work(c.work.id, c.session.id).status == archived.status
  end

  test "旧单 artifact 修订路径 payload 不含 B28 字段（legacy 兼容）", c do
    # 给 pending 候选做 B27 单 artifact 修订（不涉及章级），payload 保持旧字段。
    {:ok, artifact} =
      NovelApplication.ArtifactAssembler.assemble(
        %NovelCommon.Contracts.ToolResult{
          tool_result_id: "tr-legacy",
          tool_request_ref: "tq-legacy",
          tool_name: "world_building",
          status: :succeeded,
          output: %{
            artifact_type: "world_setting",
            item_count: 1,
            items: [%{item_id: "legacy-1", title: "旧设定", body: "旧书铺。", rationale: nil}]
          },
          artifact_refs: ["legacy-1"],
          state_delta: [],
          usage: %{},
          trace_refs: [],
          completed_at: DateTime.utc_now()
        },
        "turn-legacy"
      )

    frame = %NovelDomain.DialogueFrame{
      schema_version: "3.0-draft",
      frame_id: "frame-legacy",
      turn_id: "turn-legacy",
      workspace_id: c.work.id,
      primary: true,
      frame_type: :execution_candidate,
      source_refs: %{author_input_ref: "turn-legacy"},
      dialogue_goal: %{summary: "生成候选"},
      tool_need: %{needs_tool: true, reason_code: :tool_needed},
      execution_readiness: :ready,
      author_visible_draft: %{message: "候选"},
      evidence_summary: %{},
      uncertainty: []
    }

    result = NovelApplication.TurnResultBuilder.build(frame, %{}, [], nil, nil, artifact)
    [pending] = result.adoption_state.pending

    refute Map.has_key?(pending.payload, "modification_scope")
    refute Map.has_key?(pending.payload, "adoption_effect")
    refute Map.has_key?(pending.payload, "base_text")
    assert :ok = AdoptionWorkflow.validate_b28_contract(pending)
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
               %{},
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

  test "slice_verify fixture：content_revision 只落实作者明确改动，其余逐字", c do
    run = %{
      c.run
      | goal: %{text: "把第一章正文里的二十五岁改成三十岁，其他不变。", version: 1}
    }

    judgment =
      judgment(c.chapter_ref, %{
        dialogue_goal: "把第一章正文里的二十五岁改成三十岁，其他不变。"
      })

    provider = %Execution{
      result_fn: fn prompt ->
        SliceVerify.complete(nil, nil, prompt, %{})
      end
    }

    assert {:ok, result} =
             PendingArtifactWorkflow.run(judgment, %{}, run, c.context, provider)

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
               content: item.body,
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

  test "文字目标缺失、重复或与指定段冲突时，不调用writer、不生成候选", c do
    inputs = [
      "把第一章正文里的四十五岁改成三十岁，其他不变。",
      "把第一章正文里的「灯楼」改成「灯塔」，其他不变。",
      "只改第二段，把「二十五岁」改成「三十岁」，其他不变。",
      "只改第0段，把「二十五岁」改成「三十岁」，其他不变。",
      "只改第99段，把「二十五岁」改成「三十岁」，其他不变。"
    ]

    before = Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision})

    for text <- inputs do
      run = %{c.run | goal: %{text: text, version: 1}}

      assert {:error, {:pending_artifact_invalid, reason}} =
               PendingArtifactWorkflow.run(
                 judgment(c.chapter_ref, %{dialogue_goal: text}),
                 %{},
                 run,
                 c.context,
                 %Execution{result_fn: fn _ -> flunk("范围不唯一不得调用writer") end}
               )

      assert reason in [:target_missing, :target_ambiguous, :incomplete_scope]
    end

    assert Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision}) == before
  end

  for interpretation <- ["指定片段替换，非整章重写", "整章重写并给出完整替换稿"] do
    test "模型说明#{interpretation}不能扩大作者的字词替换范围", c do
      author = "把已保存的第一章正文里的年龄改一下，二十五岁改成三十岁，其余逐字不变。"
      run = %{c.run | goal: %{text: author, version: 1}}
      target_body = "初稿：陈九斤三十岁守灯楼，第七盏灯不点自亮。"

      assert {:ok, result} =
               PendingArtifactWorkflow.run(
                 judgment(c.chapter_ref, %{dialogue_goal: unquote(interpretation)}),
                 %{},
                 run,
                 c.context,
                 provider(target_body, self())
               )

      assert_received {:chapter_writer_prompt, prompt}
      assert prompt =~ "只输出**目标段落的替换文本**"
      refute prompt =~ "本轮为整章正文修订"
      [pending] = result.turn_result.adoption_state.pending
      assert pending.payload.modification_scope == "target_segments"
      assert pending.payload.adoption_effect["mode"] == "replace_segments"
      assert [_] = pending.payload.adoption_effect["target_segment_ids"]
      assert hd(pending.payload.items).body == target_body
    end
  end

  test "作者明确整章修订时，模型说明不能擅自缩成单段", c do
    run = %{c.run | goal: %{text: "请通读整章并修订第一章正文。", version: 1}}

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref, %{dialogue_goal: "只改第一段"}),
               %{},
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
    run = %{
      c.run
      | goal: %{text: "只把第一章开头一段改得更紧张，其他段落逐字保留。", version: 1}
    }

    judgment =
      judgment(c.chapter_ref, %{
        dialogue_goal: "只把第一章开头一段改得更紧张，其他段落逐字保留。"
      })

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment,
               %{},
               run,
               c.context,
               provider(c.base_text, self())
             )

    assert_received {:chapter_writer_prompt, prompt}
    assert prompt =~ "只输出**目标段落的替换文本**"
    assert prompt =~ "未改段落由系统逐字节保留"

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

  # ── B28 §元原则整改 CP1：作者授权范围（否定/条件/读取不授整章）────────────────

  test "CP1 否定整章+局部限制 → target_segments 首段，采纳后其他段逐字不变", c do
    run = %{c.run | goal: %{text: "不要整章重写，只改第一段。", version: 1}}
    target_body = "初稿：陈九斤二十五岁守着灯楼，第七盏灯不点自亮。"

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref, %{dialogue_goal: "只改第一段"}),
               %{},
               run,
               c.context,
               provider(target_body, self())
             )

    assert_received {:chapter_writer_prompt, prompt}
    assert prompt =~ "只输出**目标段落的替换文本**"
    refute prompt =~ "本轮为整章正文修订"

    [pending] = result.turn_result.adoption_state.pending
    payload = pending.payload
    assert payload.modification_scope == "target_segments"
    effect = payload.adoption_effect
    assert effect["mode"] == "replace_segments"

    [first_id] = effect["target_segment_ids"]

    assert first_id ==
             c.base_text |> LocalizedRevision.segment() |> hd() |> Map.fetch!(:segment_id)

    [item] = payload.items
    assert item.body == target_body

    assert {:ok, persisted} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: c.work.id,
               source_turn_ref: "turn-b28-cp1-negated-whole",
               artifact_id: pending.artifact_id,
               artifact_type: :prose_fragment,
               content: item.body,
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
             target_body <> "\n\n续写：灯楼九层，每层九盏，他数到第九层时天边泛白。"

    # 第二段逐字节保留
    assert ReadingProjectionRepo.accepted_chapter_prose(c.work.id, c.chapter_ref) =~
             "续写：灯楼九层，每层九盏，他数到第九层时天边泛白。"
  end

  test "CP1 通读全文后只修第二段 → target_segments 第二段（读取不等于修改授权）", c do
    run = %{c.run | goal: %{text: "通读全文后只修第二段。", version: 1}}
    target_body = "续写：灯楼九层，每层九盏，他数到第九层时，天已经亮了。"

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref, %{dialogue_goal: "只修第二段"}),
               %{},
               run,
               c.context,
               provider(target_body, self())
             )

    [pending] = result.turn_result.adoption_state.pending
    payload = pending.payload
    assert payload.modification_scope == "target_segments"
    [second_id] = payload.adoption_effect["target_segment_ids"]

    assert second_id ==
             c.base_text |> LocalizedRevision.segment() |> Enum.at(1) |> Map.fetch!(:segment_id)
  end

  test "CP1 只读检查+明确不改 → 拒绝且不调用 writer、零候选零写入", c do
    inputs = ["整章检查一遍，有问题告诉我，别改。", "只读一遍第03章，不要改。"]

    before = Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision})

    for text <- inputs do
      run = %{c.run | goal: %{text: text, version: 1}}

      assert {:error, {:pending_artifact_invalid, :author_scope_not_authorized}} =
               PendingArtifactWorkflow.run(
                 judgment(c.chapter_ref, %{dialogue_goal: text}),
                 %{},
                 run,
                 c.context,
                 %Execution{result_fn: fn _ -> flunk("未授权修改不得调用 writer") end}
               )
    end

    assert Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision}) == before
  end

  test "CP1 条件性整章未判定 → 保守不授整章（无目标解析时拒绝，不猜整章）", c do
    run = %{
      c.run
      | goal: %{text: "如果第03章有明显问题就整章改一遍，没有问题就告诉我。", version: 1}
    }

    before = Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision})

    assert {:error, {:pending_artifact_invalid, :incomplete_scope}} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref, %{dialogue_goal: "按条件处理"}),
               %{},
               run,
               c.context,
               %Execution{result_fn: fn _ -> flunk("条件未判定不得自动生成整章候选") end}
             )

    assert Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision}) == before
  end
end
