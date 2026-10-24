defmodule NovelApplication.B30ChapterStructureMaintenanceTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution

  alias NovelApplication.{
    CapabilityRegistry,
    ChapterStructureMaintenance,
    PendingArtifactWorkflow
  }

  alias NovelDomain.DialogueContext

  @v1 "volume:11111111-1111-1111-1111-111111111111"
  @v2 "volume:22222222-2222-2222-2222-222222222222"

  defp facts do
    %{
      work_id: "work-1",
      base_revision: 7,
      volume_ref: nil,
      volumes: [
        %{volume_ref: @v1, title: "第一卷：觉醒", seq: 1, blueprint_ref: nil},
        %{volume_ref: @v2, title: "第二卷：裂变", seq: 2, blueprint_ref: nil}
      ],
      chapters: [
        chapter("chapter:aaaa1111-1111-1111-1111-111111111111", @v1, 1, "第01章：初夜"),
        chapter("chapter:bbbb2222-2222-2222-2222-222222222222", @v2, 3, "第11章：外门名册上的空白"),
        chapter("chapter:cccc3333-3333-3333-3333-333333333333", @v2, 4, "第12章：旧钱与旧名"),
        chapter("chapter:dddd4444-4444-4444-4444-444444444444", @v2, 5, "第13章：卷末")
      ]
    }
  end

  defp chapter(ref, volume_ref, seq, title, version \\ 2) do
    %{
      chapter_ref: ref,
      volume_ref: volume_ref,
      seq: seq,
      title: title,
      version: version,
      content_hash: "hash-#{seq}",
      content_chars: 100,
      accepted_draft_refs: ["draft:#{ref}:1"],
      accepted_summary_refs: [],
      status: "PLANNED"
    }
  end

  test "能力注册：maintain_chapter_structure 效果与 plot_outline/prose_writing 严格区分" do
    entry = CapabilityRegistry.get("maintain_chapter_structure")

    assert entry
    assert entry.provider_dependency == :none
    assert entry.write_scopes == ["chapter_structure"]
    assert entry.status == :active
    assert entry.effect_summary =~ "只维护既有章结构"
    assert entry.effect_summary =~ "不生成大纲"
    assert entry.effect_summary =~ "不新建章"
    assert entry.effect_summary =~ "不改 title/正文/归卷/章数"

    assert "maintain_chapter_structure" in CapabilityRegistry.list()

    # 与既有创作能力不是同一条目
    refute CapabilityRegistry.get("maintain_chapter_structure") ==
             CapabilityRegistry.get("plot_outline")

    refute CapabilityRegistry.get("maintain_chapter_structure") ==
             CapabilityRegistry.get("prose_writing")
  end

  test "第2卷编号理顺：按卷内阅读顺序生成连续 seq（3/4/5 → 2/3/4）" do
    assert {:ok, plan} = ChapterStructureMaintenance.change_plan("把第2卷章节编号理顺，内容不要动", facts())

    assert plan.operation == "renumber_chapters"
    assert plan.effects == ["display_number_only"]
    assert plan.object_count == 3

    assert plan.mapping == [
             %{
               chapter_ref: "chapter:bbbb2222-2222-2222-2222-222222222222",
               expected_seq: 3,
               expected_version: 2,
               from_seq: 3,
               to_seq: 2
             },
             %{
               chapter_ref: "chapter:cccc3333-3333-3333-3333-333333333333",
               expected_seq: 4,
               expected_version: 2,
               from_seq: 4,
               to_seq: 3
             },
             %{
               chapter_ref: "chapter:dddd4444-4444-4444-4444-444444444444",
               expected_seq: 5,
               expected_version: 2,
               from_seq: 5,
               to_seq: 4
             }
           ]

    assert plan.base_versions == [
             %{chapter_ref: "chapter:bbbb2222-2222-2222-2222-222222222222", version: 2},
             %{chapter_ref: "chapter:cccc3333-3333-3333-3333-333333333333", version: 2},
             %{chapter_ref: "chapter:dddd4444-4444-4444-4444-444444444444", version: 2}
           ]

    # 标题历史章号与真实 seq 错位 → warning（不重写 title）
    assert Enum.any?(plan.warnings, &String.contains?(&1, "title_number_mismatch"))
    assert Enum.any?(plan.warnings, &String.contains?(&1, "标题章号=11 但 seq=3"))
  end

  test "点名两章对调：只交换指定章的 seq，不重排其它章" do
    assert {:ok, plan} =
             ChapterStructureMaintenance.change_plan(
               "把第二卷的第11章和第12章编号对调，内容不要动",
               facts()
             )

    assert plan.mapping == [
             %{
               chapter_ref: "chapter:bbbb2222-2222-2222-2222-222222222222",
               expected_seq: 3,
               expected_version: 2,
               from_seq: 3,
               to_seq: 4
             },
             %{
               chapter_ref: "chapter:cccc3333-3333-3333-3333-333333333333",
               expected_seq: 4,
               expected_version: 2,
               from_seq: 4,
               to_seq: 3
             }
           ]

    assert plan.object_count == 2
  end

  test "越界卷/无目标给出可解释错误（不猜、不生成大纲）" do
    assert {:error, :out_of_range} =
             ChapterStructureMaintenance.change_plan("把不存在的第九卷章节编号理顺，内容不要动", facts())

    assert {:error, :no_target} =
             ChapterStructureMaintenance.change_plan(
               "把第二卷章节编号理顺，内容不要动",
               %{facts() | chapters: []}
             )
  end

  test "intent? 只识别结构维护原话" do
    assert ChapterStructureMaintenance.intent?("把第2卷章节编号理顺，内容不要动")
    assert ChapterStructureMaintenance.intent?("只修正第二卷的列表编号，不改变章节内容定位")

    refute ChapterStructureMaintenance.intent?("写一段新的正文")
    refute ChapterStructureMaintenance.intent?("帮我生成章节大纲")
  end

  test "未确认零写入：维护判断产出可审阅 change plan 候选（无 provider/无写入）" do
    judgment = %{
      action: "execute",
      capability: "maintain_chapter_structure",
      narrative: "我会先给出第2卷的旧→新编号变更计划，待你确认后再改。",
      dialogue_goal: "把第2卷章节编号理顺，内容不要动",
      reason: "章节结构维护",
      frame_type: "execution_candidate",
      candidate_directions: [],
      pending_artifact_ref: nil,
      adopted_content_ref: nil,
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
    }

    run = %{
      run_id: "run-b30-structure",
      run_mode: :bounded,
      profile_ref: "judgment_loop_v1",
      budget: %{max_tool_calls: 2, max_provider_calls: 2},
      consumed_budget: %{},
      authority_scope: %{production_write: false, allowed_tools: ["judgment"]},
      workspace_id: "work-1",
      work_id: "work-1",
      session_id: "session-1",
      parent_turn_ref: "turn-b30",
      goal: %{text: "把第2卷章节编号理顺，内容不要动", version: 1}
    }

    context = %DialogueContext{workspace_id: "work-1", interaction_state: %{}}

    provider = %Execution{result_fn: fn _ -> flunk("结构维护不得调用 provider") end}

    assert {:ok, result} =
             PendingArtifactWorkflow.run(
               judgment,
               %{"chapter_structure_context" => facts()},
               run,
               context,
               provider
             )

    assert result.provider_call_count == 0
    [pending] = result.turn_result.adoption_state.pending

    assert pending.artifact_type == :chapter_structure_change_plan
    assert pending.adoption_status == NovelDomain.AdoptionStatus.initial()

    payload = pending.payload
    plan = Map.get(payload, :change_plan) || Map.get(payload, "change_plan")

    assert Map.get(payload, :object_kind) == "chapter_structure_change_plan"
    assert Map.get(payload, :title) == "章节重编号变更计划（3 章）"
    assert plan.operation == "renumber_chapters"
    assert plan.effects == ["display_number_only"]
    assert plan.object_count == 3
    assert Enum.map(plan.mapping, &{&1.from_seq, &1.to_seq}) == [{3, 2}, {4, 3}, {5, 4}]
    assert length(plan.base_versions) == 3
    assert Enum.any?(plan.warnings, &String.contains?(&1, "title_number_mismatch"))

    # 候选 body 是作者可审阅的旧→新编号差异，不含正文改写
    [item] = Map.get(payload, :items)
    assert item.body =~ "第3章 → 第2章"
    assert item.body =~ "章节标题/正文/归卷/章数不变" or item.rationale =~ "标题/正文/归卷/章数不变"
  end
end
