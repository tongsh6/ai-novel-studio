defmodule NovelPersistence.B35ReplaceScopeIntegrityTest do
  use NovelPersistence.DataCase, async: false

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume}

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

  defp persist(ctx, content, scope, coverage \\ "complete") do
    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: ctx.work_id,
      source_turn_ref: "turn-b35",
      artifact_id: "as-b35-#{System.unique_integer([:positive])}",
      artifact_type: :prose_fragment,
      content: content,
      summary: "第03章：黑市调频师",
      target_chapter_ref: "chapter:#{ctx.chapter.id}",
      adoption_effect: effect(ctx, coverage),
      modification_scope: scope,
      target_segment_ids: target_ids_for(scope),
      mode: :overwrite
    })
  end

  test "局部分段候选(126 chars)+coverage=complete → incomplete_scope 拒绝零写入（B33 CP4 事故回归）", ctx do
    short = "第一段：黑市深处的调频师在灯影里等来了一个不该出现的买主，他的指节发白。"

    before_status = Repo.get!(Draft, ctx.draft.id).status
    before_count = Repo.aggregate(Draft, :count)

    assert {:error, :incomplete_scope} = persist(ctx, short, "target_segments")

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

    assert {:ok, persisted} = persist(ctx, full, "target_segments")

    assert persisted.reading_projection.adoption_effect == "replace_scope"
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
    assert {:ok, persisted} = persist(ctx, full_rewrite, "whole_chapter")
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
               content: full_rewrite,
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

  test "未改段被改 → out_of_scope_changes 零写入（target ids 只含第一段）", ctx do
    # 改第二段（非 target），第一段保持原样：段落数/长度均正常，只有 diff 范围校验能抓。
    bad =
      @base_paragraphs
      |> List.replace_at(1, "第二段被越界改写了。")
      |> Enum.join("\n\n")

    before = Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content}) |> Enum.sort()

    assert {:error, :out_of_scope_changes} = persist(ctx, bad, "target_segments")

    assert Repo.all(Draft) |> Enum.map(&{&1.id, &1.status, &1.content}) |> Enum.sort() == before
  end
end
