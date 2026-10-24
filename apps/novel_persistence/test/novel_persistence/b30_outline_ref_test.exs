defmodule NovelPersistence.B30OutlineRefTest do
  use NovelPersistence.DataCase, async: false

  import Ecto.Query

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.AdoptionRepository
  alias NovelPersistence.ChapterPlanParser
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.{Chapter, Draft, Scene, Volume, Work}

  defp seed do
    work = Repo.insert!(%Work{title: "B30 outline ref"})
    volume = Repo.insert!(%Volume{work_id: work.id, title: "第二卷", seq: 2})

    chapters =
      for {title, seq} <- [{"第11章：外门名册", 11}, {"第12章：旧钱与旧名", 12}] do
        Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: title, seq: seq})
      end

    {work, volume, chapters}
  end

  defp persist_outline(work, content) do
    AdoptionRepository.persist(%{
      actor_ref: "author",
      work_id: work.id,
      source_turn_ref: "turn-b30-outline",
      artifact_id: "as-b30-outline-#{System.unique_integer([:positive])}",
      artifact_type: :outline_draft,
      content: content
    })
  end

  test "parser 透传可选 chapter_ref（合法形态）；旧文本无 ref 保持 nil" do
    ref = "chapter:#{Ecto.UUID.generate()}"

    content = """
    第99章：改号标题: 摘要更新
    章节引用: #{ref}
    章功能定位：推进章
    """

    assert [%{title: "第99章：改号标题", chapter_ref: ^ref}] =
             ChapterPlanParser.parse_with_volumes(content).chapters

    assert [%{chapter_ref: nil}] = ChapterPlanParser.parse("第01章：开端: 摘要")
  end

  test "带正确 ref 的过时/改号 title outline：不新建章、更新原章 summary/plan_direction、seq/title/正文不变", _c do
    {work, _volume, [c1, c2]} = seed()
    scene = Repo.insert!(%Scene{work_id: work.id, chapter_id: c1.id, title: "场景 1", seq: 1})

    Repo.insert!(%Draft{
      work_id: work.id,
      scene_id: scene.id,
      content: "原正文",
      status: AdoptionStatus.accepted(),
      revision: 1
    })

    before = chapters_for(work.id) |> Enum.map(&{&1.id, &1.title, &1.seq, &1.volume_id})
    hash = :crypto.hash(:sha256, "原正文")

    content = """
    第99章：完全不同的标题: 新摘要
    章节引用: chapter:#{c1.id}
    章功能定位：推进章
    """

    assert {:ok, _} = persist_outline(work, content)

    after_rows = chapters_for(work.id) |> Enum.map(&{&1.id, &1.title, &1.seq, &1.volume_id})
    assert Enum.sort(before) == Enum.sort(after_rows)
    assert chapter_count(work.id) == 2

    updated = Repo.get!(Chapter, c1.id)
    assert updated.title == "第11章：外门名册"
    assert updated.seq == 11
    assert updated.summary == "新摘要"
    assert updated.plan_direction["chapter_role"] == "推进章"
    assert :crypto.hash(:sha256, "原正文") == hash
    assert Repo.get!(Chapter, c2.id).seq == 12
  end

  test "同 title 多章 + ref 精确命中；无 ref 旧 title 幂等；非法格式回退 title", _c do
    {work, volume, [c1, _c2]} = seed()

    duplicate =
      Repo.insert!(%Chapter{
        work_id: work.id,
        volume_id: volume.id,
        title: c1.title,
        seq: 30
      })

    content = """
    #{c1.title}: 同标题摘要
    章节引用: chapter:#{duplicate.id}
    章功能定位：铺垫章
    """

    assert {:ok, _} = persist_outline(work, content)
    assert chapter_count(work.id) == 3
    assert Repo.get!(Chapter, duplicate.id).summary == "同标题摘要"
    assert Repo.get!(Chapter, c1.id).summary == nil

    # 无 ref：旧 (work_id,title) 幂等，命中原有章不新建
    content_legacy = "#{c1.title}: 旧式摘要\n章功能定位：过渡章"
    assert {:ok, _} = persist_outline(work, content_legacy)
    assert chapter_count(work.id) == 3
    assert Repo.get!(Chapter, c1.id).summary == "旧式摘要"

    # 非法格式 ref：回退旧 title 幂等（不猜、不 crash）
    content_bad_format = """
    第100章：新章标题: 摘要
    章节引用: not-a-chapter-ref
    """

    assert {:ok, _} = persist_outline(work, content_bad_format)
    assert chapter_count(work.id) == 4
  end

  test "合法 ref 不存在/跨作品 → target_missing 零写入", _c do
    {work, volume, [c1, c2]} = seed()
    other_work = Repo.insert!(%Work{title: "另一个作品"})
    other_volume = Repo.insert!(%Volume{work_id: other_work.id, title: "卷一", seq: 1})

    other_chapter =
      Repo.insert!(%Chapter{
        work_id: other_work.id,
        volume_id: other_volume.id,
        title: "第1章",
        seq: 1
      })

    before = Repo.all(Chapter) |> Enum.map(&{&1.id, &1.seq, &1.title})

    content_missing = """
    第101章：不存在: 摘要
    章节引用: chapter:#{Ecto.UUID.generate()}
    """

    assert {:error, :target_missing} = persist_outline(work, content_missing)

    content_cross = """
    第102章：跨作品: 摘要
    章节引用: chapter:#{other_chapter.id}
    """

    assert {:error, :target_missing} = persist_outline(work, content_cross)

    after_rows = Repo.all(Chapter) |> Enum.map(&{&1.id, &1.seq, &1.title})
    assert Enum.sort(after_rows) == Enum.sort(before)
    assert length(Enum.filter(after_rows, fn {id, _, _} -> id in [c1.id, c2.id] end)) == 2
    assert is_binary(volume.id)
    assert is_binary(Repo.get!(Work, work.id).id)
  end

  test "item 级 chapter_refs 按章条目顺序合并：已存在章 ref-first，新章留空新建", _ctx do
    {work, volume, [c1, _c2]} = seed()

    content = """
    第99章：改号标题: 摘要A
    章功能定位：推进章

    第103章：新章: 摘要B
    """

    assert {:ok, _} =
             AdoptionRepository.persist(%{
               actor_ref: "author",
               work_id: work.id,
               source_turn_ref: "turn-b30-item-refs",
               artifact_id: "as-b30-item-refs",
               artifact_type: :outline_draft,
               content: content,
               chapter_refs: ["chapter:#{c1.id}", nil]
             })

    updated = Repo.get!(Chapter, c1.id)
    assert updated.title == "第11章：外门名册"
    assert updated.seq == 11
    assert updated.summary == "摘要A"

    new_chapter =
      Chapter
      |> where([c], c.work_id == ^work.id and c.title == "第103章：新章")
      |> Repo.one()

    assert new_chapter
    assert new_chapter.seq > 12
    assert chapter_count(work.id) == 3
    assert Repo.get!(Volume, volume.id).work_id == work.id
  end

  defp chapter_count(work_id) do
    Repo.aggregate(from(c in Chapter, where: c.work_id == ^work_id), :count)
  end

  defp chapters_for(work_id) do
    from(c in Chapter, where: c.work_id == ^work_id) |> Repo.all()
  end
end
