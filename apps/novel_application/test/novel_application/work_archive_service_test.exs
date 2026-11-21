defmodule NovelApplication.WorkArchiveServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{CharacterProfile, ExplorationService, WorkArchiveService, WorkService}
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.Character
  alias NovelPersistence.Schemas.Draft
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Scene
  alias NovelPersistence.Schemas.Volume

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  test "archive reads are scoped to accepted and confirmed facts for one work" do
    {:ok, work} = WorkService.create(%{"title" => "真实档案"})
    {:ok, other_work} = WorkService.create(%{"title" => "其他作品"})

    insert_character(work.id, "林澈", AdoptionStatus.accepted())
    insert_character(work.id, "草稿角色", AdoptionStatus.tentative())
    insert_character(other_work.id, "串线角色", AdoptionStatus.accepted())

    insert_memory(work.id, MemoryType.foreshadowing(), "林澈背后的旧伤", ["主线"])
    insert_memory(work.id, MemoryType.world_rule(), "灵能不能治愈记忆损伤", ["硬规则"])
    insert_memory(work.id, MemoryType.idea(), "未确认灵感", ["草稿"])
    insert_memory(work.id, MemoryType.world_rule(), "已经废弃的规则", ["废弃"], false)
    insert_memory(other_work.id, MemoryType.world_rule(), "其他作品规则", ["串线"])

    %{volume: _volume, chapter: _chapter, scene: scene} = insert_structure(work.id)
    insert_draft(work.id, scene.id, "已采纳正文", AdoptionStatus.accepted())
    insert_draft(work.id, scene.id, "待采纳正文", AdoptionStatus.tentative())

    assert [
             %{
               name: "林澈",
               aliases: [],
               status: "ACCEPTED",
               updated_at: character_updated_at
             }
           ] = WorkArchiveService.characters(work.id)

    assert is_binary(character_updated_at)

    assert [
             %{
               content: "林澈背后的旧伤",
               tags: ["主线"],
               status: "CONFIRMED",
               scope: "WORK",
               source_type: "AUTHOR_CONFIRMED",
               locked: false,
               recallable: true,
               reference_count: 0,
               version: 1,
               weight: weight,
               confidence: confidence,
               updated_at: memory_updated_at
             }
           ] = WorkArchiveService.foreshadowing(work.id)

    assert is_float(weight)
    assert is_float(confidence)
    assert is_binary(memory_updated_at)

    assert [%{content: "灵能不能治愈记忆损伤", tags: ["硬规则"], status: "CONFIRMED"}] =
             WorkArchiveService.rules(work.id)

    assert %{
             volumes: 1,
             chapters: 1,
             characters: 1,
             memory_items: 3,
             drafts_total: 2,
             drafts_accepted: 1,
             words_total: word_count
           } = WorkArchiveService.stats(work.id)

    assert word_count > 0
  end

  test "profile exposes work seed fields without internal ids" do
    {:ok, work} =
      WorkService.create(%{
        "title" => "灵源纪元",
        "genre" => "东方玄幻",
        "core_selling_point" => "灵源矿区真相",
        "target_reader" => "喜欢升级悬疑的读者",
        "tone_preference" => "紧张热血"
      })

    assert %{
             title: "灵源纪元",
             genre: "东方玄幻",
             core_selling_point: "灵源矿区真相",
             target_reader: "喜欢升级悬疑的读者",
             tone_preference: "紧张热血",
             status: "TENTATIVE",
             revision: revision,
             updated_at: updated_at
           } = WorkArchiveService.profile(work.id)

    assert is_integer(revision)
    assert is_binary(updated_at)
    refute Map.has_key?(WorkArchiveService.profile(work.id), :id)
    refute inspect(WorkArchiveService.profile(work.id)) =~ work.id
  end

  test "placeholder work ids return empty archive data instead of examples" do
    assert [] = WorkArchiveService.characters("lobby")
    assert [] = WorkArchiveService.foreshadowing("lobby")
    assert [] = WorkArchiveService.rules("lobby")
    assert WorkArchiveService.profile("lobby") == %{}

    assert %{
             volumes: 0,
             chapters: 0,
             characters: 0,
             memory_items: 0,
             drafts_total: 0,
             drafts_accepted: 0
           } = WorkArchiveService.stats("lobby")
  end

  @tag :scope_archive_index
  test "按需轻量目录一次回答多人主角身份，未标记及未采纳人物不被推定为主角" do
    {:ok, work} = WorkService.create(%{"title" => "多主角身份"})
    {:ok, foreign} = WorkService.create(%{"title" => "他作主角"})

    first =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "林澈",
        narrative_role: "PROTAGONIST",
        status: "ACCEPTED",
        summary: "仅详情可读"
      })

    second =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "顾青",
        narrative_role: "PROTAGONIST",
        status: "EDITED_ACCEPTED"
      })

    unmarked =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "无标记人物",
        role: "传闻中的主角",
        status: "ACCEPTED"
      })

    hidden =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "待采纳主角",
        narrative_role: "PROTAGONIST",
        status: "TENTATIVE"
      })

    outside =
      Repo.insert!(%Character{
        work_id: foreign.id,
        name: "他作主角",
        narrative_role: "PROTAGONIST",
        status: "ACCEPTED"
      })

    assert {:ok, directory} = ExplorationService.run(work.id, "archive_read", "characters")
    rows = directory.facts.characters
    protagonists = Enum.filter(rows, &(&1.narrative_role == "PROTAGONIST"))
    assert Enum.sort(Enum.map(protagonists, & &1.name)) == Enum.sort(["林澈", "顾青"])

    expected_refs = Enum.map([first, second, unmarked], &"character:#{&1.id}")
    assert Enum.sort(Enum.map(rows, & &1.ref)) == Enum.sort(expected_refs)
    assert Enum.sort(directory.refs) == Enum.sort(expected_refs)
    assert directory.facts.total_count == 3
    assert directory.facts.returned_count == 3

    for row <- rows do
      assert Enum.sort(Map.keys(row)) ==
               Enum.sort([:ref, :name, :aliases, :narrative_role, :status])

      refute directory.summary =~ row.ref
    end

    refute directory.summary =~ hidden.id
    refute directory.summary =~ outside.id
    refute directory.summary =~ first.summary
    refute directory.summary =~ "PROTAGONIST"
    refute directory.summary =~ "{"
    assert Enum.all?(rows, &(&1.status in ["ACCEPTED", "EDITED_ACCEPTED"]))
    assert Enum.find(rows, &(&1.ref == "character:#{unmarked.id}")).narrative_role == nil
    assert directory.next_offset == nil
    assert directory.coverage.kind == "directory"

    assert Enum.sort(directory.coverage.complete_fields) ==
             Enum.sort(["ref", "name", "aliases", "narrative_role", "status"])

    refute Map.has_key?(directory.facts, :character)
  end

  @tag :scope_archive
  test "角色目录仅发现同作品已采纳对象，不预装档案正文或取得详情资格" do
    {:ok, work} = WorkService.create(%{"title" => "按需角色"})
    {:ok, other} = WorkService.create(%{"title" => "别的作品"})
    character = profile_character(work.id, "林澈", "不应出现在目录的完整秘密")
    insert_character(work.id, "未采纳人物", AdoptionStatus.tentative())
    insert_character(other.id, "外作品人物", AdoptionStatus.accepted())
    ref = "character:#{character.id}"
    {:ok, current} = NovelPersistence.AdoptionRepository.character_profile_context(work.id, ref)

    assert {:ok, directory} = ExplorationService.run(work.id, "archive_read", "characters")
    assert directory.coverage.kind == "directory"
    assert directory.coverage.facet == "characters"
    assert directory.coverage.work_id == work.id
    assert directory.refs == [ref]
    assert directory.versions == %{ref => current.base_fingerprint}

    assert directory.facts.characters == [
             %{
               ref: ref,
               name: "林澈",
               aliases: ["旧称"],
               narrative_role: "ENSEMBLE_POV",
               status: AdoptionStatus.accepted()
             }
           ]

    assert directory.summary =~ "角色"
    refute directory.summary =~ ref
    refute directory.summary =~ "{"
    refute directory.activity_summary =~ ref
    refute directory.summary =~ character.summary
    refute directory.summary =~ "未采纳人物"
    refute directory.summary =~ "外作品人物"
    refute Map.has_key?(directory.facts, :character)

    assert {:error, :not_observed} =
             CharacterProfile.observed_target(work.id, ref, [canonical_observation(directory)])
  end

  @tag :scope_archive_chapter
  test "同名计划章与正文已有章由真实 has_prose 区分，目录不能把待采纳稿算正文" do
    {:ok, work} = WorkService.create(%{"title" => "同名章可发现"})
    %{volume: volume, chapter: planned, scene: planned_scene} = insert_structure(work.id)
    planned = planned |> Ecto.Changeset.change(title: "同名章") |> Repo.update!()
    written = Repo.insert!(%Chapter{work_id: work.id, volume_id: volume.id, title: "同名章", seq: 2})
    scene = Repo.insert!(%Scene{work_id: work.id, chapter_id: written.id, title: "正文场", seq: 1})
    insert_draft(work.id, planned_scene.id, "A章只有未采纳稿", AdoptionStatus.tentative())
    insert_draft(work.id, scene.id, "B章真实已采纳正文", AdoptionStatus.accepted())
    planned_ref = "chapter:#{planned.id}"
    written_ref = "chapter:#{written.id}"

    assert {:ok, directory} = ExplorationService.run(work.id, "archive_read", "chapters")
    rows = directory.facts.chapters
    by_ref = Map.new(rows, &{&1.ref, &1})

    assert rows == [
             %{ref: planned_ref, seq: 1, title: "同名章", volume: volume.title, has_prose: false},
             %{ref: written_ref, seq: 2, title: "同名章", volume: volume.title, has_prose: true}
           ]

    assert by_ref[planned_ref].has_prose == false
    assert by_ref[written_ref].has_prose == true
    refute directory.summary =~ planned_ref
    refute directory.summary =~ written_ref
    refute directory.summary =~ "{"
    assert "has_prose" in directory.coverage.complete_fields
    refute directory.summary =~ "B章真实已采纳正文"
    refute directory.summary =~ "A章只有未采纳稿"

    [selected] = Enum.filter(rows, & &1.has_prose)
    assert selected.ref == written_ref

    assert {:ok, detail} =
             ExplorationService.run(
               work.id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: selected.ref, offset: 0})
             )

    assert detail.summary =~ "B章真实已采纳正文"
    refute detail.summary =~ "A章只有未采纳稿"
  end

  @tag :scope_archive
  test "显式章节目录可发现真实章坐标，正文仍经同作品 chapter_read 按需读取" do
    {:ok, work} = WorkService.create(%{"title" => "按需章节"})
    {:ok, other} = WorkService.create(%{"title" => "他作章节"})
    %{volume: volume, chapter: chapter, scene: scene} = insert_structure(work.id)
    %{chapter: foreign} = insert_structure(other.id)
    insert_draft(work.id, scene.id, "已经采纳的正文证据", AdoptionStatus.accepted())
    insert_draft(work.id, scene.id, "未采纳秘密正文", AdoptionStatus.tentative())
    ref = "chapter:#{chapter.id}"

    assert {:ok, directory} = ExplorationService.run(work.id, "archive_read", "chapters")
    assert directory.coverage.kind == "directory"
    assert directory.refs == [ref]

    assert directory.facts.chapters == [
             %{ref: ref, seq: 1, title: chapter.title, volume: volume.title, has_prose: true}
           ]

    refute directory.summary =~ ref
    refute directory.summary =~ "{"
    refute directory.activity_summary =~ ref
    refute directory.summary =~ foreign.id
    refute directory.summary =~ "已经采纳的正文证据"
    refute directory.summary =~ "未采纳秘密正文"

    assert {:ok, detail} =
             ExplorationService.run(
               work.id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: ref, offset: 0})
             )

    assert detail.summary =~ "已经采纳的正文证据"
    refute detail.summary =~ "未采纳秘密正文"
  end

  @tag :scope_archive
  test "人物详情保留真实指纹与所需完整字段，长摘要逐页可回查且不冒充全档案" do
    {:ok, work} = WorkService.create(%{"title" => "长档案"})
    body = String.duplicate("山雨👩🏽‍🚀é", 2_500) <> "最后一页独有线索"
    character = profile_character(work.id, "林澈", body)
    ref = "character:#{character.id}"
    {:ok, current} = NovelPersistence.AdoptionRepository.character_profile_context(work.id, ref)
    pages = archive_pages(work.id, ref)
    [first | _] = pages

    assert length(pages) > 1
    assert Enum.map_join(pages, & &1.summary) == body
    assert first.coverage.kind == "detail"
    assert first.coverage.work_id == work.id
    assert first.coverage.ref == ref
    assert first.coverage.summary.offset == 0
    assert first.coverage.summary.total_graphemes == String.length(body)
    assert first.coverage.summary.returned_graphemes == String.length(first.summary)
    assert first.coverage.summary.offset_unit == "unicode_grapheme"
    assert first.next_offset == String.length(first.summary)
    assert first.omissions != []
    refute "summary" in first.coverage.complete_fields
    assert first.facts.character == Map.delete(current, :summary)
    assert Enum.all?(pages, &(&1.versions == %{ref => current.base_fingerprint}))
    leaf = canonical_observation(first)
    assert {:ok, bound, ^leaf} = CharacterProfile.observed_target(work.id, ref, [leaf])
    assert bound.base_fingerprint == current.base_fingerprint

    metadata = ExplorationService.observation_metadata(first)
    assert metadata.source_refs == [ref]
    assert metadata.versions == first.versions
    assert metadata.coverage == first.coverage
    assert metadata.omissions == first.omissions
  end

  @tag :scope_archive
  test "人物详情拒绝跨作品、未采纳与不存在对象，不把猜中身份当已读" do
    {:ok, work} = WorkService.create(%{"title" => "目标范围"})
    {:ok, other} = WorkService.create(%{"title" => "外部范围"})
    accepted = profile_character(work.id, "林澈", "当前事实")
    tentative = insert_character(work.id, "未采纳", AdoptionStatus.tentative())
    foreign = insert_character(other.id, "外部人物", AdoptionStatus.accepted())

    for {ref, reason} <- [
          {"character:#{tentative.id}", :target_missing},
          {"character:#{foreign.id}", :cross_work_scope},
          {"character:#{Ecto.UUID.generate()}", :target_missing}
        ] do
      assert {:error, ^reason} =
               ExplorationService.run(work.id, "archive_read", archive_query(ref, 0))
    end

    assert {:error, :not_observed} =
             CharacterProfile.observed_target(work.id, "character:#{accepted.id}", [])
  end

  @tag :scope_archive
  test "档案详情拒绝负偏移、类型伪造与查询内覆盖 work，越界不返回空的完整基线" do
    {:ok, work} = WorkService.create(%{"title" => "严格查询"})
    character = profile_character(work.id, "林澈", "短摘要")
    query = %{facet: "characters", ref: "character:#{character.id}", offset: 0}

    for invalid <- [
          Map.put(query, :offset, -1),
          Map.put(query, :offset, "0"),
          Map.put(query, :work_id, work.id),
          Map.put(query, :offset, 9_999),
          Map.put(query, :ref, 3),
          Map.put(query, :unexpected, true)
        ] do
      assert {:error, _reason} =
               ExplorationService.run(work.id, "archive_read", Jason.encode!(invalid))
    end
  end

  @tag :scope_archive
  test "已读目标字段不完整或旧指纹均拒绝，不能补上后来读取的新基线" do
    {:ok, work} = WorkService.create(%{"title" => "基线不变"})
    character = profile_character(work.id, "林澈", "原始摘要")
    ref = "character:#{character.id}"

    assert {:ok, observed} =
             ExplorationService.run(work.id, "archive_read", archive_query(ref, 0))

    leaf = canonical_observation(observed)
    assert {:error, :not_observed} = CharacterProfile.observed_target(work.id, ref, [observed])

    incomplete =
      update_in(leaf, [:coverage, "complete_fields"], &List.delete(&1, "narrative_role"))

    assert {:error, :incomplete_observation} =
             CharacterProfile.observed_target(work.id, ref, [incomplete])

    for {bad, reason} <- [
          {Map.put(leaf, :source_refs, []), :incomplete_observation},
          {Map.put(leaf, :status, "unavailable"), :incomplete_observation},
          {put_in(leaf, [:coverage, "work_id"], Ecto.UUID.generate()), :cross_work_scope},
          {Map.put(leaf, :versions, %{ref => "not-the-observed-version"}), :stale_base}
        ] do
      assert {:error, ^reason} = CharacterProfile.observed_target(work.id, ref, [bad])
    end

    character |> Ecto.Changeset.change(summary: "作者已经改写摘要") |> Repo.update!()
    assert {:error, :stale_base} = CharacterProfile.observed_target(work.id, ref, [leaf])
  end

  @tag :scope_archive
  test "长目录按完整结构条目续页，摘要与事实共同计入6000字符预算" do
    {:ok, work} = WorkService.create(%{"title" => "完整目录"})

    characters =
      for index <- 1..55 do
        name = String.pad_leading(Integer.to_string(index), 3, "0") <> String.duplicate("名", 90)
        profile_character(work.id, name, "只能经详情读取的正文")
      end

    pages = directory_pages(work.id)
    assert length(pages) > 1
    expected_refs = Enum.map(characters, &"character:#{&1.id}")
    assert Enum.flat_map(pages, & &1.refs) == expected_refs
    rows = Enum.flat_map(pages, & &1.facts.characters)
    assert Enum.map(rows, & &1.ref) == expected_refs
    assert Enum.map(rows, & &1.name) == Enum.map(characters, & &1.name)
    assert length(Enum.uniq_by(rows, & &1.ref)) == 55

    for {page, index} <- Enum.with_index(pages) do
      material = Jason.encode!(%{summary: page.summary, facts: page.facts})
      assert String.length(material) <= 6_000
      assert page.coverage.offset_unit == "item"
      assert page.coverage.total_items == 55
      assert page.coverage.returned_items == length(page.refs)
      assert page.facts.returned_count == length(page.facts.characters)
      assert page.facts.total_count == 55
      assert Enum.map(page.facts.characters, & &1.ref) == page.refs
      assert Enum.sort(Map.keys(page.versions)) == Enum.sort(page.refs)

      expected_offset =
        pages |> Enum.take(index) |> Enum.reduce(0, &(&1.coverage.returned_items + &2))

      assert page.coverage.offset == expected_offset

      if index < length(pages) - 1 do
        assert page.next_offset == expected_offset + length(page.refs)
      else
        assert page.next_offset == nil
      end

      refute page.summary =~ "只能经详情读取的正文"
      refute page.summary =~ "character:"
      refute page.summary =~ "{"
      assert Enum.all?(page.facts.characters, &(not Map.has_key?(&1, :version)))
    end
  end

  test "空目录仍提供空结构名单和覆盖事实，不冒充对象详情" do
    {:ok, work} = WorkService.create(%{"title" => "空目录"})

    for {facet, key} <- [{"characters", :characters}, {"chapters", :chapters}] do
      assert {:ok, directory} = ExplorationService.run(work.id, "archive_read", facet)
      assert directory.facts == %{key => [], :total_count => 0, :returned_count => 0}
      assert directory.refs == []
      assert directory.versions == %{}
      assert directory.next_offset == nil
      assert directory.coverage.kind == "directory"
      assert directory.coverage.total_items == 0
      assert directory.coverage.returned_items == 0
      refute directory.summary =~ "{"
    end
  end

  @tag :r05_exploration
  test "章节完整设计与accepted摘要经同档案详情逐页可达，预览不授全文资格" do
    {:ok, work} = WorkService.create(%{title: "完整章节设计"})
    %{volume: volume, chapter: chapter, scene: scene} = insert_structure(work.id)
    plan = String.duplicate("逆雨", 3_600) <> "章计划最后一页独有句"
    summary_text = String.duplicate("旧事", 3_500) <> "摘要最后一页独有句"
    chapter |> Ecto.Changeset.change(plan_direction: %{"plot_progress" => plan}) |> Repo.update!()
    volume |> Ecto.Changeset.change(blueprint: %{"goal_conflict" => "当前卷蓝图原文"}) |> Repo.update!()
    insert_draft(work.id, scene.id, "正文只由正文工具读取", AdoptionStatus.accepted())

    accepted =
      Repo.insert!(%NovelPersistence.Schemas.ChapterSummary{
        work_id: work.id,
        chapter_id: chapter.id,
        status: AdoptionStatus.accepted(),
        summary_text: summary_text,
        source_ref: "real-summary-source"
      })

    Repo.insert!(%NovelPersistence.Schemas.ChapterSummary{
      work_id: work.id,
      chapter_id: chapter.id,
      status: AdoptionStatus.tentative(),
      summary_text: "待采纳摘要不得当当前摘要"
    })

    ref = "chapter:#{chapter.id}"
    query = Jason.encode!(%{facet: "chapters", ref: ref, offset: 0})
    pages = material_pages(work.id, "chapters", ref)
    text = Enum.map_join(pages, & &1.summary)
    assert length(pages) >= 3
    assert text =~ plan
    assert text =~ summary_text
    assert text =~ "当前卷蓝图原文"
    refute text =~ "待采纳摘要不得当当前摘要"
    refute text =~ "正文只由正文工具读取"
    assert hd(pages).coverage.kind == "detail"
    assert hd(pages).coverage.ref == ref
    assert hd(pages).next_offset == 6_000
    refute "chapter_summary:#{accepted.id}" in hd(pages).refs
    refs = pages |> Enum.flat_map(& &1.refs) |> Enum.uniq()

    assert Enum.sort(refs) ==
             Enum.sort([ref, "volume:#{volume.id}", "chapter_summary:#{accepted.id}"])

    assert Enum.all?(pages, &(&1.versions == %{}))
    assert List.last(pages).next_offset == nil

    assert {:ok, preview} =
             ExplorationService.run(
               work.id,
               "chapter_read",
               Jason.encode!(%{chapter_ref: ref, offset: 0})
             )

    assert preview.coverage.chapter_plan.status == "partial"
    assert preview.coverage.chapter_summary.status == "partial"
    assert Jason.decode!(preview.coverage.chapter_plan.read_query) == Jason.decode!(query)
    assert Jason.decode!(preview.coverage.chapter_summary.read_query) == Jason.decode!(query)
    refute preview.summary =~ "章计划最后一页独有句"
    refute preview.summary =~ "摘要最后一页独有句"
    assert preview.omissions != []

    for omission <- preview.omissions do
      refute omission =~ ref
      refute omission =~ "archive_read"
      refute omission =~ "{"
    end
  end

  @tag :r05_exploration
  test "章节设计详情拒绝跨作品与混合坐标，无accepted摘要不读取tentative替代" do
    {:ok, work} = WorkService.create(%{title: "当前设计"})
    {:ok, other} = WorkService.create(%{title: "其他设计"})
    %{chapter: chapter} = insert_structure(work.id)
    %{chapter: foreign} = insert_structure(other.id)

    Repo.insert!(%NovelPersistence.Schemas.ChapterSummary{
      work_id: work.id,
      chapter_id: chapter.id,
      status: AdoptionStatus.tentative(),
      summary_text: "禁止偷用的候选摘要"
    })

    assert {:ok, current} =
             ExplorationService.run(
               work.id,
               "archive_read",
               Jason.encode!(%{facet: "chapters", ref: "chapter:#{chapter.id}", offset: 0})
             )

    refute current.summary =~ "禁止偷用的候选摘要"
    refute Enum.any?(current.refs, &String.starts_with?(&1, "chapter_summary:"))
    assert current.coverage.chapter_prose == "not_read"

    assert {:error, :chapter_not_found} =
             ExplorationService.run(
               work.id,
               "archive_read",
               Jason.encode!(%{facet: "chapters", ref: "chapter:#{foreign.id}", offset: 0})
             )

    assert {:error, :invalid_archive_query} =
             ExplorationService.run(
               work.id,
               "archive_read",
               Jason.encode!(%{
                 facet: "chapters",
                 ref: "chapter:#{chapter.id}",
                 offset: 0,
                 work_id: other.id
               })
             )
  end

  @tag :r05_exploration
  test "风格规则和作者偏好分页只绑定页内真实记忆条目及版本" do
    {:ok, work} = WorkService.create(%{title: "真实风格来源"})

    one =
      insert_memory(
        work.id,
        MemoryType.author_preference(),
        String.duplicate("甲", 6_100) <> "偏好尾甲",
        []
      )

    two =
      insert_memory(
        work.id,
        MemoryType.author_preference(),
        String.duplicate("乙", 6_300) <> "偏好尾乙",
        []
      )

    one
    |> Ecto.Changeset.change(version: 7, updated_at: ~U[2025-01-01 00:00:00.000000Z])
    |> Repo.update!()

    two
    |> Ecto.Changeset.change(version: 9, updated_at: ~U[2026-01-01 00:00:00.000000Z])
    |> Repo.update!()

    pages = material_pages(work.id, "preferences", nil)
    expected_versions = %{"memory:#{one.id}" => 7, "memory:#{two.id}" => 9}
    text = Enum.map_join(pages, & &1.summary)
    assert text =~ one.content
    assert text =~ two.content
    assert hd(pages).refs == ["memory:#{two.id}"]
    assert hd(pages).versions == %{"memory:#{two.id}" => 9}
    assert List.last(pages).refs == ["memory:#{one.id}"]
    assert List.last(pages).versions == %{"memory:#{one.id}" => 7}

    for page <- pages do
      assert Enum.sort(Map.keys(page.versions)) == Enum.sort(page.refs)
      assert page.versions == Map.take(expected_versions, page.refs)
      refute "archive:preferences" in page.refs
      assert String.length(page.summary) <= 6_000
    end

    rule = insert_memory(work.id, MemoryType.style_rule(), "：作者确认的短句风格：", [])
    assert {:ok, rules} = ExplorationService.run(work.id, "archive_read", "rules")
    assert rules.refs == ["memory:#{rule.id}"]
    assert rules.versions == %{"memory:#{rule.id}" => 1}
    assert rules.summary == "：作者确认的短句风格："
  end

  defp material_pages(work_id, facet, ref, offset \\ 0, remaining \\ 10) when remaining > 0 do
    selector = %{facet: facet, offset: offset}
    selector = if ref, do: Map.put(selector, :ref, ref), else: selector
    assert {:ok, page} = ExplorationService.run(work_id, "archive_read", Jason.encode!(selector))

    case page.next_offset do
      nil ->
        [page]

      next when is_integer(next) and next > offset ->
        [page | material_pages(work_id, facet, ref, next, remaining - 1)]
    end
  end

  defp directory_pages(work_id, offset \\ 0, remaining \\ 10) when remaining > 0 do
    query = Jason.encode!(%{facet: "characters", offset: offset})
    assert {:ok, page} = ExplorationService.run(work_id, "archive_read", query)

    case page.next_offset do
      nil ->
        [page]

      next when is_integer(next) and next > offset ->
        [page | directory_pages(work_id, next, remaining - 1)]
    end
  end

  defp canonical_observation(raw) do
    %{messages: [%{blocks: [leaf]}]} =
      NovelApplication.JudgmentProtocol.observation_transcript(
        %{messages: [], observation_refs: []},
        %{tool_call_id: "archive-read"},
        raw
      )

    leaf
  end

  defp profile_character(work_id, name, summary) do
    Repo.insert!(%Character{
      work_id: work_id,
      name: name,
      summary: summary,
      aliases: ["旧称"],
      role: "调查员",
      narrative_role: "ENSEMBLE_POV",
      status: AdoptionStatus.accepted()
    })
  end

  defp archive_query(ref, offset),
    do: Jason.encode!(%{facet: "characters", ref: ref, offset: offset})

  defp archive_pages(work_id, ref, offset \\ 0, remaining \\ 10) when remaining > 0 do
    assert {:ok, page} =
             ExplorationService.run(work_id, "archive_read", archive_query(ref, offset))

    assert page.refs == [ref]

    case page.next_offset do
      nil ->
        [page]

      next when is_integer(next) and next > offset ->
        [page | archive_pages(work_id, ref, next, remaining - 1)]
    end
  end

  defp insert_character(work_id, name, status) do
    %Character{}
    |> Character.changeset(%{work_id: work_id, name: name, status: status})
    |> Repo.insert!()
  end

  defp insert_memory(work_id, type, content, tags, recallable \\ true) do
    %MemoryItem{}
    |> MemoryItem.changeset(%{
      id: Ecto.UUID.generate(),
      work_id: work_id,
      content: content,
      type: type,
      scope: "WORK",
      status: MemoryStatus.confirmed(),
      source_type: MemorySourceType.author_confirmed(),
      tags: tags,
      recallable: recallable
    })
    |> Repo.insert!()
  end

  defp insert_structure(work_id) do
    volume =
      %Volume{}
      |> Volume.changeset(%{work_id: work_id, title: "第一卷", seq: 1})
      |> Repo.insert!()

    chapter =
      %Chapter{}
      |> Chapter.changeset(%{work_id: work_id, volume_id: volume.id, title: "第一章", seq: 1})
      |> Repo.insert!()

    scene =
      %Scene{}
      |> Scene.changeset(%{work_id: work_id, chapter_id: chapter.id, title: "第一场", seq: 1})
      |> Repo.insert!()

    %{volume: volume, chapter: chapter, scene: scene}
  end

  defp insert_draft(work_id, scene_id, content, status) do
    %Draft{}
    |> Draft.changeset(%{work_id: work_id, scene_id: scene_id, content: content, status: status})
    |> Repo.insert!()
  end
end
