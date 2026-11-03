defmodule NovelPersistence.WorkArchiveRepoCreativeFactsTest do
  @moduledoc """
  CA02：`creative_facts/1` 写作事实链读端口——一次取回确认记忆并按创作消费分组；
  world_rules 不含 STYLE_RULE（风格归 style 组）；只回 CONFIRMED/STABILIZED + recallable。
  """
  use NovelPersistence.DataCase, async: false

  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.WorkArchiveRepo

  defp insert_memory!(work_id, type, content, opts \\ []) do
    attrs = %{
      id: Ecto.UUID.generate(),
      work_id: work_id,
      content: content,
      summary: Keyword.get(opts, :summary),
      type: type,
      scope: "WORK",
      status: Keyword.get(opts, :status, MemoryStatus.confirmed()),
      source_type: MemorySourceType.author_confirmed(),
      recallable: Keyword.get(opts, :recallable, true)
    }

    %MemoryItem{} |> MemoryItem.changeset(attrs) |> Repo.insert!()
  end

  test "按创作消费分组；world_rules 不含 STYLE_RULE；style 合并 STYLE_RULE 与 AUTHOR_PREFERENCE" do
    work_id = Ecto.UUID.generate()

    insert_memory!(work_id, MemoryType.foreshadowing(), "灵脉断裂伏笔")
    insert_memory!(work_id, MemoryType.plot_fact(), "主线转向复仇")
    insert_memory!(work_id, MemoryType.world_rule(), "灵气交易需魂契")
    insert_memory!(work_id, MemoryType.constraint(), "不写穿越元素")
    insert_memory!(work_id, MemoryType.current_state(), "沈砚重伤未愈")
    insert_memory!(work_id, MemoryType.character_profile(), "凌渊断臂后改用左手剑")
    insert_memory!(work_id, MemoryType.relationship(), "沈砚与白露敌对")
    insert_memory!(work_id, MemoryType.style_rule(), "对白优先")
    insert_memory!(work_id, MemoryType.author_preference(), "章尾留钩子")

    facts = WorkArchiveRepo.creative_facts(work_id)

    assert Enum.map(facts.foreshadowing, & &1.content) |> Enum.sort() ==
             ["主线转向复仇", "灵脉断裂伏笔"]

    assert Enum.map(facts.world_rules, & &1.content) |> Enum.sort() ==
             ["不写穿越元素", "灵气交易需魂契"]

    assert Enum.map(facts.current_states, & &1.content) == ["沈砚重伤未愈"]
    assert Enum.map(facts.character_profiles, & &1.content) == ["凌渊断臂后改用左手剑"]
    assert Enum.map(facts.relationships, & &1.content) == ["沈砚与白露敌对"]
    assert Enum.map(facts.style, & &1.content) |> Enum.sort() == ["对白优先", "章尾留钩子"]
  end

  test "只回确认态且 recallable 的记忆；未知作品回空分组" do
    work_id = Ecto.UUID.generate()

    insert_memory!(work_id, MemoryType.world_rule(), "草稿规则", status: MemoryStatus.draft())
    insert_memory!(work_id, MemoryType.world_rule(), "不可召回规则", recallable: false)
    insert_memory!(work_id, MemoryType.world_rule(), "稳定规则", status: MemoryStatus.stabilized())

    facts = WorkArchiveRepo.creative_facts(work_id)
    assert Enum.map(facts.world_rules, & &1.content) == ["稳定规则"]

    empty = WorkArchiveRepo.creative_facts(Ecto.UUID.generate())

    assert empty == %{
             foreshadowing: [],
             world_rules: [],
             current_states: [],
             character_profiles: [],
             relationships: [],
             style: []
           }
  end
end

defmodule NovelPersistence.WorkArchiveRepoCreativeFactsWindowTest do
  @moduledoc """
  B64 CP0/CP1：creative_facts 必须按目标章有效窗过滤；无目标保持既有行为。
  """
  use NovelPersistence.DataCase, async: false

  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter
  alias NovelPersistence.Schemas.MemoryItem
  alias NovelPersistence.Schemas.Volume
  alias NovelPersistence.WorkArchiveRepo

  defp insert_chapter!(work_id, seq) do
    volume =
      %Volume{} |> Volume.changeset(%{work_id: work_id, title: "卷", seq: 1}) |> Repo.insert!()

    %Chapter{}
    |> Chapter.changeset(%{work_id: work_id, volume_id: volume.id, title: "第#{seq}章", seq: seq})
    |> Repo.insert!()
  end

  defp insert_memory!(work_id, content, opts) do
    attrs =
      Map.merge(
        %{
          id: Ecto.UUID.generate(),
          work_id: work_id,
          content: content,
          type: Keyword.get(opts, :type, MemoryType.world_rule()),
          scope: "WORK",
          status: MemoryStatus.confirmed(),
          source_type: MemorySourceType.author_confirmed(),
          recallable: true
        },
        Map.new(Keyword.take(opts, [:valid_from, :valid_until]))
      )

    %MemoryItem{} |> MemoryItem.changeset(attrs) |> Repo.insert!()
  end

  defp contents(facts), do: Enum.map(facts.world_rules, & &1.content) |> Enum.sort()

  test "目标章在窗口外时排除，窗口内/无窗保留；无目标保持既有行为" do
    work_id = Ecto.UUID.generate()
    ch2 = insert_chapter!(work_id, 2)
    ch4 = insert_chapter!(work_id, 4)
    ch8 = insert_chapter!(work_id, 8)
    ch10 = insert_chapter!(work_id, 10)
    target_ch3 = insert_chapter!(work_id, 3)

    insert_memory!(work_id, "只在早期有效的设定", valid_until: %{"chapter_id" => ch4.id})
    insert_memory!(work_id, "第8章后才生效的设定", valid_from: %{"chapter_id" => ch8.id})
    insert_memory!(work_id, "贯穿全书的设定", [])

    # 第10章（最大已写/目标）下早期设定应排除；目标第3章下未来设定应排除。
    facts_at_10 = WorkArchiveRepo.creative_facts(work_id, at_chapter_id: ch10.id)
    assert contents(facts_at_10) == ["第8章后才生效的设定", "贯穿全书的设定"]

    facts_at_3 = WorkArchiveRepo.creative_facts(work_id, at_chapter_id: target_ch3.id)
    assert contents(facts_at_3) == ["只在早期有效的设定", "贯穿全书的设定"]

    # 未提供目标时保持旧行为（规划/历史消费者不被机械过滤）。
    assert contents(WorkArchiveRepo.creative_facts(work_id)) ==
             ["只在早期有效的设定", "第8章后才生效的设定", "贯穿全书的设定"]

    # 目标未知（不存在章）不伪装确定：窗口不约束。
    facts_unknown = WorkArchiveRepo.creative_facts(work_id, at_chapter_id: Ecto.UUID.generate())
    assert contents(facts_unknown) == ["只在早期有效的设定", "第8章后才生效的设定", "贯穿全书的设定"]

    # 窗口边界引用不存在章节：该侧不可解析 → 不约束该侧。
    missing = Ecto.UUID.generate()
    insert_memory!(work_id, "边界缺失的设定", valid_until: %{"chapter_id" => missing})
    assert "边界缺失的设定" in contents(WorkArchiveRepo.creative_facts(work_id, at_chapter_id: ch2.id))
  end

  test "章序号重编号后窗口按新 seq 重新解析，不按旧快照" do
    work_id = Ecto.UUID.generate()
    target = insert_chapter!(work_id, 3)
    future = insert_chapter!(work_id, 8)

    memory =
      insert_memory!(work_id, "第8章才生效的设定", valid_from: %{"chapter_id" => future.id})

    refute memory.content in contents(
             WorkArchiveRepo.creative_facts(work_id, at_chapter_id: target.id)
           )

    # 把原第8章重编号为第2章：同一 UUID 的有效窗下界随新 seq 解析，目标第3章内应生效。
    future
    |> Ecto.Changeset.change(seq: 2)
    |> Repo.update!()

    assert memory.content in contents(
             WorkArchiveRepo.creative_facts(work_id, at_chapter_id: target.id)
           )
  end

  test "跨作品记忆与无效目标不会串入" do
    work_id = Ecto.UUID.generate()
    other_work = Ecto.UUID.generate()
    target = insert_chapter!(work_id, 3)
    insert_memory!(work_id, "本作品规则", [])
    insert_memory!(other_work, "其它作品规则", [])

    assert contents(WorkArchiveRepo.creative_facts(work_id, at_chapter_id: target.id)) == [
             "本作品规则"
           ]

    assert contents(WorkArchiveRepo.creative_facts(work_id, at_chapter_id: "not-a-uuid")) == [
             "本作品规则"
           ]
  end

  test "记忆有效窗当前值变化后即刻反映，不缓存旧值" do
    work_id = Ecto.UUID.generate()
    target = insert_chapter!(work_id, 3)
    ch8 = insert_chapter!(work_id, 8)

    memory =
      insert_memory!(work_id, "边界可更新的设定", valid_from: %{"chapter_id" => ch8.id})

    refute memory.content in contents(
             WorkArchiveRepo.creative_facts(work_id, at_chapter_id: target.id)
           )

    memory
    |> Ecto.Changeset.change(valid_from: %{"chapter_id" => insert_chapter!(work_id, 2).id})
    |> Repo.update!()

    assert memory.content in contents(
             WorkArchiveRepo.creative_facts(work_id, at_chapter_id: target.id)
           )
  end
end
