defmodule NovelApplication.B28ChapterRevisionWiringTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelAgent.Provider.Execution
  alias NovelAgent.Test.Provider.SliceVerify
  alias NovelApplication.{AdoptionWorkflow, PendingArtifactWorkflow, WorkService}
  alias NovelDomain.DialogueContext
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{Repo, WorkSessionRepo}
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

  defp provider(body, test_pid) do
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

  test "format_only 章级修订：writer 含两片段全文 + chapter task + 候选 payload/base_text", c do
    # 保留源基线（行尾空白/CRLF 归一后等价），验证采纳守卫接受
    body = "初稿：陈九斤二十五岁守灯楼，第七盏灯不点自亮。  \r\n\r\n续写：灯楼九层，每层九盏，他数到第九层时天边泛白。\r\n"

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref),
               %{},
               c.run,
               c.context,
               provider(body, self())
             )

    assert_received {:chapter_writer_prompt, prompt}

    # 全章覆盖顺序正文（两片段都进 prompt，含顺序/片段说明）
    assert prompt =~ "初稿：陈九斤二十五岁守灯楼，第七盏灯不点自亮。"
    assert prompt =~ "续写：灯楼九层，每层九盏，他数到第九层时天边泛白。"
    assert prompt =~ "覆盖顺序"
    assert prompt =~ "2 个已采纳片段"
    assert prompt =~ "仅排版"
    assert prompt =~ "目标章 ref：#{c.chapter_ref}"
    assert prompt =~ "修订范围：仅排版"
    assert prompt =~ "## 必须保留"

    [pending] = result.turn_result.adoption_state.pending
    payload = pending.payload

    assert pending.target_chapter_ref == c.chapter_ref
    assert Map.get(payload, :modification_scope) == "format_only"
    assert Map.get(payload, :target_chapter_ref) == c.chapter_ref
    assert Map.get(payload, :base_text) == c.base_text
    assert Map.get(payload, :title) == "#{c.chapter_title}（整章排版修订稿）"

    # application 生成候选可见标题（candidate_set 卡片），不依赖模型 title
    [candidate_card] =
      Enum.filter(result.turn_result.ui_cards, &(&1.card_type == "candidate_set"))

    assert candidate_card.title == "#{c.chapter_title}（整章排版修订稿）"

    effect = Map.get(payload, :adoption_effect)
    assert effect["mode"] == "replace_scope"
    assert effect["coverage"] == "complete"
    assert effect["covered"] == ["#{c.draft1_ref}:2", "#{c.draft2_ref}:1"]

    assert effect["expected_base_versions"] == [
             %{ref: c.draft1_ref, version: 2},
             %{ref: c.draft2_ref, version: 1}
           ]

    # 采纳守卫：format_only 归一化等价 → 接受；候选 payload 原样传给 AdoptionWorkflow
    assert :ok = AdoptionWorkflow.validate_b28_contract(pending)
  end

  test "format_only 章级修订：候选改字句时采纳守卫拒绝（format_only_violation）", c do
    body = "初稿：陈九斤二十五岁守灯楼，第七盏灯不点自亮。\n\n续写：灯楼九层，每层九盏，他数到第九层时天光大亮。"

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment(c.chapter_ref),
               %{},
               c.run,
               c.context,
               provider(body, self())
             )

    [pending] = result.turn_result.adoption_state.pending

    assert {:error, {:format_only_violation, %{offset: _, line: _}}} =
             AdoptionWorkflow.validate_b28_contract(pending)
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

  test "slice_verify fixture：format_only 返回覆盖顺序完整基线稿（守卫接受）", c do
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

    assert item.body == c.base_text
    assert pending.payload[:title] == "#{c.chapter_title}（整章排版修订稿）"
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
    assert item.body =~ "灯楼九层，每层九盏"
    assert pending.payload[:title] == "#{c.chapter_title}（整章内容修订稿）"
    assert :ok = AdoptionWorkflow.validate_b28_contract(pending)
  end

  test "B35 target_segments：prompt 要求整章完整替换稿，候选 payload 声明 scope/covered/preserve", c do
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
end
