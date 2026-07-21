defmodule NovelPersistence.WorkArchiveRepoCreativeFactsTest do
  @moduledoc """
  CA02：`creative_facts/1` 写作事实链读端口——一次取回确认记忆并按创作消费分组；
  world_rules 不含 STYLE_RULE（风格归 style 组）；只回 CONFIRMED/STABILIZED + recallable。
  """
  use NovelPersistence.DataCase, async: true

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
    insert_memory!(work_id, MemoryType.relationship(), "沈砚与白露敌对")
    insert_memory!(work_id, MemoryType.style_rule(), "对白优先")
    insert_memory!(work_id, MemoryType.author_preference(), "章尾留钩子")

    facts = WorkArchiveRepo.creative_facts(work_id)

    assert Enum.map(facts.foreshadowing, & &1.content) |> Enum.sort() ==
             ["主线转向复仇", "灵脉断裂伏笔"]

    assert Enum.map(facts.world_rules, & &1.content) |> Enum.sort() ==
             ["不写穿越元素", "灵气交易需魂契"]

    assert Enum.map(facts.current_states, & &1.content) == ["沈砚重伤未愈"]
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
    assert empty == %{foreshadowing: [], world_rules: [], current_states: [], relationships: [], style: []}
  end
end
