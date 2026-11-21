defmodule NovelPersistence.B35ReplaceScopeIntegrityTest do
  use NovelPersistence.DataCase, async: false

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{AdoptionRepository, LocalizedRevision}
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, MemoryItem, Mutation, Scene, Volume}

  @base_paragraphs [
    "第一段：黑市深处的调频师在灯影里等来了一个不该出现的买主。",
    "第二段：旧钱在桌上摊开，纸页边缘卷起，像某种被反复摩挲的证词。",
    "第三段：外门名册上的空白被人用指甲刮过，留下了极细的刻痕。",
    "第四段：调频师把音量旋钮压到最低，听见门外的脚步分成两路。",
    "第五段：买主没有抬头，只问了一句关于旧名的话，房间忽然安静。",
    "第六段：灯丝闪了一下，像是有人在很远的地方拉下了总闸。"
  ]
  @base_text Enum.join(@base_paragraphs, "\n\n")

  setup do
    work_id = Ecto.UUID.generate()
    volume = Repo.insert!(%Volume{work_id: work_id, title: "第一卷", seq: 1})

    chapter =
      Repo.insert!(%Chapter{work_id: work_id, volume_id: volume.id, title: "第03章：黑市调频师", seq: 3})

    scene = Repo.insert!(%Scene{work_id: work_id, chapter_id: chapter.id, title: "场景 1", seq: 1})

    draft =
      Repo.insert!(%Draft{
        work_id: work_id,
        scene_id: scene.id,
        content: @base_text,
        status: AdoptionStatus.accepted(),
        revision: 5
      })

    %{work_id: work_id, chapter: chapter, scene: scene, draft: draft}
  end

  defp effect(ctx, coverage) do
    %{
      "mode" => "replace_scope",
      "coverage" => coverage,
      "covered" => [%{"draft_ref" => "draft:#{ctx.draft.id}:5"}],
      "expected_base_versions" => [%{"ref" => "draft:#{ctx.draft.id}", "version" => 5}]
    }
  end

  defp target_ids_for(scope) do
    if scope == "target_segments" do
      @base_text
      |> NovelPersistence.LocalizedRevision.segment()
      |> List.first()
      |> Map.get(:segment_id)
      |> List.wrap()
    else
      []
    end
  end

  defp persist(ctx, items, scope, coverage \\ "complete", overrides \\ %{}) do
    target_ids = target_ids_for(scope)

    adoption_effect =
      if scope == "target_segments" do
        [first | _] = LocalizedRevision.segment(@base_text)

        effect(ctx, coverage)
        |> Map.delete("expected_base_versions")
        |> Map.merge(%{
          "mode" => "replace_segments",
          "base_versions" => [%{"ref" => "draft:#{ctx.draft.id}", "version" => 5}],
          "target_segment_ids" => target_ids,
          "expected_segment_hashes" => [
            %{"segment_id" => first.segment_id, "sha256" => first.sha256}
          ]
        })
      else
        effect(ctx, coverage)
      end

    attrs = %{
      actor_ref: "author",
      work_id: ctx.work_id,
      source_turn_ref: "turn-b35",
      artifact_id: "as-b35-#{System.unique_integer([:positive])}",
      artifact_type: :prose_fragment,
      items: items,
      summary: "第03章：黑市调频师",
      target_chapter_ref: "chapter:#{ctx.chapter.id}",
      adoption_effect: adoption_effect,
      modification_scope: scope,
      target_segment_ids: target_ids,
      mode: :overwrite
    }

    AdoptionRepository.persist(Map.merge(attrs, overrides))
  end

  test "局部授权不能借 coverage=complete 与 replace_scope 冒充整章替换（B33 CP4 事故回归）", ctx do
    short = "第一段：黑市深处的调频师在灯影里等来了一个不该出现的买主，他的指节发白。"

    before_status = Repo.get!(Draft, ctx.draft.id).status
    before_count = Repo.aggregate(Draft, :count)

    items = [
      %{item_id: "first", target_segment_ids: target_ids_for("target_segments"), body: short}
    ]

    assert {:error, :incomplete_scope} =
             persist(ctx, items, "target_segments", "complete", %{
               adoption_effect: effect(ctx, "complete")
             })

    assert Repo.aggregate(Draft, :count) == before_count
    assert Repo.get!(Draft, ctx.draft.id).status == before_status

    assert {:ok, content} =
             NovelPersistence.ReadingProjectionRepo.chapter_content(ctx.chapter.id, ctx.work_id)

    assert Enum.map_join(content.scenes, "\n\n", & &1.content) == @base_text
  end

  test "段级修订：整章稿只改第一段，其余段落字节级保留；receipt 带 scope/covered/旧新长度", ctx do
    changed_first = "第一段：黑市深处的调频师攥紧了灯影里的调频旋钮，等来了一个不该出现的买主。"
    full = Enum.join([changed_first | tl(@base_paragraphs)], "\n\n")
    assert full != @base_text
    assert String.length(full) >= div(String.length(@base_text), 2)

    items = [
      %{
        item_id: "first",
        target_segment_ids: target_ids_for("target_segments"),
        body: changed_first
      }
    ]

    assert {:ok, persisted} = persist(ctx, items, "target_segments")

    assert persisted.reading_projection.adoption_effect == "replace_segments"
    assert persisted.reading_projection.scope == "target_segments"
    assert persisted.reading_projection.old_chars == String.length(@base_text)
    assert persisted.reading_projection.new_chars == String.length(full)

    {:ok, content} =
      NovelPersistence.ReadingProjectionRepo.chapter_content(ctx.chapter.id, ctx.work_id)

    accepted_text = Enum.map_join(content.scenes, "\n\n", & &1.content)
    assert accepted_text == full

    # 未改段落逐字保留（原字节子串仍在）
    for p <- tl(@base_paragraphs), do: assert(accepted_text =~ p)
    # 旧稿 supersede，历史保留；章数/seq 不变
    assert Repo.get!(Draft, ctx.draft.id).status == AdoptionStatus.superseded()
    assert Repo.aggregate(from(ch in Chapter, where: ch.work_id == ^ctx.work_id), :count) == 1
    assert Repo.get!(Chapter, ctx.chapter.id).seq == 3
  end

  test "整章完整替换：同长度整章稿接受；失败（stale）整体回滚零写入", ctx do
    full_rewrite = "整章重写：" <> @base_text
    items = [%{item_id: "whole", body: full_rewrite}]
    assert {:ok, persisted} = persist(ctx, items, "whole_chapter")
    assert persisted.reading_projection.scope == "whole_chapter"
    assert Repo.aggregate(Draft, :count) == 2

    # 回滚：expected version 过期 → 零写入（旧 accepted 内容不动）
    ctx2 = %{
      ctx
      | draft:
          Repo.insert!(%Draft{
            work_id: ctx.work_id,
            scene_id:
              Repo.insert!(%Scene{
                work_id: ctx.work_id,
                chapter_id: ctx.chapter.id,
                title: "场景 2",
                seq: 2
              }).id,
            content: "另一份 accepted 正文。",
            status: AdoptionStatus.accepted(),
            revision: 2
          })
    }

    before = Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content}) |> Enum.sort()

    assert {:error, :stale_base_version} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: ctx2.work_id,
               source_turn_ref: "turn-b35-stale",
               artifact_id: "as-b35-stale",
               artifact_type: :prose_fragment,
               items: items,
               summary: "第03章：黑市调频师",
               target_chapter_ref: "chapter:#{ctx2.chapter.id}",
               adoption_effect: %{
                 "mode" => "replace_scope",
                 "coverage" => "complete",
                 "covered" => [%{"draft_ref" => "draft:#{ctx2.draft.id}:2"}],
                 "expected_base_versions" => [
                   %{"ref" => "draft:#{ctx2.draft.id}", "version" => 99}
                 ]
               },
               modification_scope: "whole_chapter"
             })

    assert Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content}) |> Enum.sort() == before
  end

  test "未授权片段被映射 → out_of_scope_changes 零写入（授权只含第一片段）", ctx do
    [_first, second | _] = LocalizedRevision.segment(@base_text)

    items = [
      %{item_id: "outside", target_segment_ids: [second.segment_id], body: "第二段被越界改写了。"}
    ]

    before = Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content}) |> Enum.sort()

    assert {:error, :out_of_scope_changes} = persist(ctx, items, "target_segments")

    assert Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content}) |> Enum.sort() == before
    assert Repo.aggregate(MemoryItem, :count) == 0
    assert Repo.aggregate(Mutation, :count) == 0
  end

  test "整章允许远少于半长且自然段数改变：所有旧稿被覆盖，正文原字节和章身份保留", ctx do
    items = [
      %{item_id: "opening", body: "  灯影留下旧钱的线索。"},
      %{item_id: "ending", body: "闸门合拢，买主留名。\t "}
    ]

    expected = "  灯影留下旧钱的线索。\n\n闸门合拢，买主留名。\t "
    assert String.length(expected) < div(String.length(@base_text), 2)
    assert {:ok, persisted} = persist(ctx, items, "whole_chapter")
    draft = Repo.get!(Draft, persisted.reading_projection.draft_id)
    assert draft.content == expected
    assert draft.scene_id == ctx.scene.id
    assert draft.revision > ctx.draft.revision
    superseded = Repo.get!(Draft, ctx.draft.id)
    assert superseded.status == AdoptionStatus.superseded()
    assert superseded.content == @base_text
    assert superseded.revision > ctx.draft.revision
    assert Repo.get!(Chapter, ctx.chapter.id).seq == 3
    assert Repo.aggregate(Chapter, :count) == 1
    assert Repo.aggregate(Scene, :count) == 1

    projection = persisted.reading_projection
    assert projection.scope == "whole_chapter"
    assert projection.adoption_effect == "replace_scope"
    assert projection.covered_refs == ["draft:#{ctx.draft.id}:5"]
    assert projection.source_revision_ref == "draft:#{draft.id}:#{draft.revision}"
    assert projection.old_chars == String.length(@base_text)
    assert projection.new_chars == String.length(expected)
    assert projection.diff_stats.segment_count == 6
    assert projection.diff_stats.changed_segment_count == 6

    memory = Repo.get!(MemoryItem, persisted.memory_item_id)
    assert memory.content == expected
    assert memory.source_id == persisted.mutation_id
  end

  test "整章允许单源片段拆多自然段，候选不继承旧章尾分隔符", ctx do
    Repo.update!(Ecto.Changeset.change(ctx.draft, content: "旧的一句。\r\n\r\n"))

    items = [
      %{item_id: "opening", body: "  新的开头。\n\n中间新段。"},
      %{item_id: "ending", body: "新结尾。\t "}
    ]

    assert {:ok, persisted} = persist(ctx, items, "whole_chapter")
    draft = Repo.get!(Draft, persisted.reading_projection.draft_id)
    assert draft.content == "  新的开头。\n\n中间新段。\n\n新结尾。\t "
    assert persisted.reading_projection.diff_stats.segment_count == 1
    assert persisted.reading_projection.diff_stats.changed_segment_count == 1
    assert Repo.aggregate(Chapter, :count) == 1
  end

  test "整章同字节采纳回执不因源 slot 归并制造变化", ctx do
    items = [%{item_id: "whole", body: @base_text}]
    assert {:ok, persisted} = persist(ctx, items, "whole_chapter")
    assert Repo.get!(Draft, persisted.reading_projection.draft_id).content == @base_text
    assert persisted.reading_projection.segment_changes == []
    assert persisted.reading_projection.diff_stats.changed_segment_count == 0
    assert persisted.reading_projection.diff_stats.changed_old_chars == 0
    assert persisted.reading_projection.diff_stats.changed_new_chars == 0
    assert persisted.reading_projection.old_chars == persisted.reading_projection.new_chars
  end

  test "whole 拒绝 partial/缺覆盖/跨 work/双正文和错误 item 形状，全部事务零写入", ctx do
    items = [%{item_id: "whole", body: "章尾仍在，重复已经收拢。"}]

    before =
      Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision}) |> Enum.sort()

    bad_effect = Map.put(effect(ctx, "complete"), "covered", [])

    for {input, coverage, overrides} <- [
          {items, "partial", %{}},
          {items, "complete", %{adoption_effect: bad_effect}},
          {items, "complete", %{work_id: Ecto.UUID.generate()}},
          {items, "complete", %{content: hd(items).body}},
          {items, "complete", %{content: "另一份正文"}},
          {items, "complete", %{content: nil}},
          {nil, "complete", %{content: "旧平串不能兼容"}},
          {[], "complete", %{}},
          {[%{item_id: "empty", body: " \r\n\t "}], "complete", %{}},
          {[%{item_id: "missing", title: "标题不能补正文"}], "complete", %{}},
          {[%{item_id: "wrong", body: 123}], "complete", %{}},
          {[%{item_id: "mapped", body: "整章正文", target_segment_ids: []}], "complete", %{}},
          {[%{item_id: "mapped", body: "整章正文", target_segment_ids: nil}], "complete", %{}}
        ] do
      assert {:error, _reason} = persist(ctx, input, "whole_chapter", coverage, overrides)

      assert Repo.all(Draft)
             |> Enum.map(&{&1.id, &1.status, &1.content, &1.revision})
             |> Enum.sort() == before

      assert Repo.aggregate(MemoryItem, :count) == 0
      assert Repo.aggregate(Mutation, :count) == 0
      assert Repo.aggregate(Chapter, :count) == 1
      assert Repo.aggregate(Scene, :count) == 1
    end
  end
end
