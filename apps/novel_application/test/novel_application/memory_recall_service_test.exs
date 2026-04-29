defmodule NovelApplication.MemoryRecallServiceTest do
  use ExUnit.Case, async: false

  alias NovelApplication.MemoryService
  alias NovelApplication.MemoryPolicy.HardFilter
  alias NovelApplication.MemoryPolicy.CandidateSearch
  alias NovelApplication.MemoryPolicy.Reranker
  alias NovelApplication.MemoryPolicy.DiversityFilter
  alias NovelApplication.MemoryPolicy.TokenPacker
  alias NovelApplication.MemoryRecallService
  alias NovelFoundation.Enums.MemoryType
  alias NovelFoundation.Enums.MemoryScope
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.ID

  setup do
    Ecto.Adapters.SQL.Sandbox.checkout(NovelPersistence.Repo)
    Ecto.Adapters.SQL.Sandbox.mode(NovelPersistence.Repo, {:shared, self()})
    work_id = ID.uuid()
    {:ok, work_id: work_id}
  end

  describe "HardFilter" do
    test "separates iron laws from candidates", %{work_id: wid} do
      {:ok, iron} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "世界没有魔法",
            type: MemoryType.world_rule(),
            weight: 0.95,
            status: MemoryStatus.confirmed(),
            locked: true
          })
        )

      {:ok, normal} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "主角叫张三",
            type: MemoryType.character_profile(),
            weight: 0.5
          })
        )

      memories = [iron, normal]
      {irons, candidates} = HardFilter.filter(memories)

      assert length(irons) == 1
      assert hd(irons).id == iron.id
      assert length(candidates) == 1
      assert hd(candidates).id == normal.id
    end

    test "work and global iron laws match narrower task scope", %{work_id: wid} do
      {:ok, iron} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "世界没有魔法",
            type: MemoryType.world_rule(),
            scope: MemoryScope.work(),
            weight: 0.95,
            status: MemoryStatus.confirmed(),
            locked: true
          })
        )

      {irons, _candidates} = HardFilter.filter([iron], scope: MemoryScope.chapter())
      assert Enum.map(irons, & &1.id) == [iron.id]
    end

    test "non-recallable memory is excluded even if iron law", %{work_id: wid} do
      {:ok, memory} =
        MemoryService.create(
          base_attrs(wid, %{
            weight: 0.95,
            status: MemoryStatus.confirmed(),
            locked: true,
            recallable: false
          })
        )

      {irons, candidates} = HardFilter.filter([memory])
      assert irons == []
      assert candidates == []
    end
  end

  describe "CandidateSearch" do
    test "scores candidates by keyword match", %{work_id: wid} do
      {:ok, m1} = MemoryService.create(base_attrs(wid, %{content: "雪山上有古老的龙"}))
      {:ok, m2} = MemoryService.create(base_attrs(wid, %{content: "主角喜欢吃面"}))

      scored = CandidateSearch.search([m1, m2], query: "雪山 龙")
      assert length(scored) >= 1
      {top_m, top_score} = hd(scored)
      assert top_m.id == m1.id
      assert top_score > 0
    end

    test "prefer_types bonus applies", %{work_id: wid} do
      {:ok, m1} =
        MemoryService.create(
          base_attrs(wid, %{
            type: MemoryType.world_rule(),
            content: "规则X"
          })
        )

      {:ok, m2} =
        MemoryService.create(
          base_attrs(wid, %{
            type: MemoryType.character_profile(),
            content: "规则X"
          })
        )

      scored =
        CandidateSearch.search([m1, m2],
          query: "规则",
          prefer_types: [MemoryType.world_rule()]
        )

      assert length(scored) == 2
      {top_m, _} = hd(scored)
      assert top_m.id == m1.id
    end

    test "empty query returns baseline score", %{work_id: wid} do
      {:ok, m} = MemoryService.create(base_attrs(wid, %{}))
      [{^m, score}] = CandidateSearch.search([m], query: "")
      assert score > 0
    end
  end

  describe "Reranker" do
    test "reranks by combined score formula" do
      m1 = build_mem("mem1", %{weight: 0.9, reference_count: 10})
      m2 = build_mem("mem2", %{weight: 0.5, reference_count: 0})

      scored = [{m1, 0.6}, {m2, 0.6}]
      ranked = Reranker.rerank(scored)

      {top_m, _} = hd(ranked)
      assert top_m.id == "mem1"
    end

    test "high relevance can overcome low weight" do
      m1 = build_mem("light", %{weight: 0.3, reference_count: 0})
      m2 = build_mem("heavy", %{weight: 0.8, reference_count: 0})

      scored = [{m1, 0.95}, {m2, 0.1}]
      ranked = Reranker.rerank(scored)

      {top_m, _} = hd(ranked)
      assert top_m.id == "light"
    end
  end

  describe "DiversityFilter" do
    test "removes high-ref low-weight noise" do
      m1 = build_mem("m1", %{reference_count: 60, weight: 0.4})
      m2 = build_mem("m2", %{reference_count: 10, weight: 0.7})

      filtered = DiversityFilter.filter([{m1, 0.5}, {m2, 0.5}])
      assert length(filtered) == 1
      {m, _} = hd(filtered)
      assert m.id == "m2"
    end

    test "deduplicates similar content" do
      m1 = build_mem("m1", %{content: "主角使用火焰魔法攻击敌人"})
      m2 = build_mem("m2", %{content: "主角使用火焰魔法攻击敌人获得了胜利"})

      filtered = DiversityFilter.filter([{m1, 0.9}, {m2, 0.5}])
      assert length(filtered) == 1
      {m, _} = hd(filtered)
      assert m.id == "m1"
    end
  end

  describe "TokenPacker" do
    test "packs iron laws and ranked candidates into blocks" do
      iron = build_mem("i1", %{content: "世界没有魔法", type: MemoryType.world_rule()})
      ranked = [{build_mem("c1", %{content: "主角叫张三", type: MemoryType.character_profile()}), 0.8}]

      result = TokenPacker.pack([iron], ranked, token_budget: 500)
      assert result.iron_law_count == 1
      assert result.candidate_count == 1
      assert result.text =~ "铁律"
      assert result.text =~ "世界没有魔法"
      assert result.text =~ "人物设定"
      assert result.text =~ "主角叫张三"
    end

    test "respects token budget" do
      iron = build_mem("i1", %{content: "铁律", type: MemoryType.world_rule()})

      ranked = [
        {build_mem("c1", %{content: "记忆1"}), 0.9},
        {build_mem("c2", %{content: "记忆2"}), 0.8},
        {build_mem("c3", %{content: "记忆3"}), 0.7}
      ]

      result = TokenPacker.pack([iron], ranked, token_budget: 20)
      assert result.estimated_tokens <= 50
    end
  end

  describe "MemoryRecallService full pipeline" do
    test "recall returns context with iron laws and ranked candidates", %{work_id: wid} do
      {:ok, _iron} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "世界没有魔法，科技水平为蒸汽时代",
            type: MemoryType.world_rule(),
            weight: 0.95,
            status: MemoryStatus.confirmed(),
            locked: true
          })
        )

      {:ok, _char} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "主角艾琳是火系魔法师",
            type: MemoryType.character_profile(),
            weight: 0.7
          })
        )

      {:ok, _plot} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "第3章发生在冰封山脉",
            type: MemoryType.plot_fact(),
            weight: 0.5
          })
        )

      result =
        MemoryRecallService.recall(wid,
          query: "续写第3章 雪山 艾琳",
          scene: "chapter_3_drafting",
          token_budget: 1000
        )

      assert result.iron_law_count >= 1
      assert result.candidate_count >= 1
      assert is_binary(result.text)
      assert String.length(result.text) > 0
      assert result.work_id == wid
    end

    test "excludes non-recallable statuses and expired memories", %{work_id: wid} do
      {:ok, _conflicted} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "冲突事实",
            status: MemoryStatus.conflicted(),
            type: MemoryType.plot_fact(),
            weight: 0.9
          })
        )

      {:ok, _deprecated} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "废弃事实",
            status: MemoryStatus.deprecated(),
            type: MemoryType.plot_fact(),
            weight: 0.9
          })
        )

      {:ok, _expired} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "过期事实",
            type: MemoryType.plot_fact(),
            valid_until: %{"scene_index" => 1}
          })
        )

      {:ok, _active} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "当前有效事实",
            type: MemoryType.plot_fact()
          })
        )

      result =
        MemoryRecallService.recall(wid,
          query: "事实",
          scene_index: 2,
          token_budget: 1000
        )

      assert result.text =~ "当前有效事实"
      refute result.text =~ "冲突事实"
      refute result.text =~ "废弃事实"
      refute result.text =~ "过期事实"
    end

    test "updates reference counters after recall", %{work_id: wid} do
      {:ok, item} =
        MemoryService.create(
          base_attrs(wid, %{
            content: "艾琳住在雪山",
            type: MemoryType.plot_fact()
          })
        )

      MemoryRecallService.recall(wid, query: "艾琳 雪山", token_budget: 1000)

      assert {:ok, updated} = MemoryService.get(item.id)
      assert updated.reference_count == item.reference_count + 1
      assert %DateTime{} = updated.last_referenced_at
    end
  end

  defp base_attrs(work_id, overrides) do
    %{
      work_id: work_id,
      content: Map.get(overrides, :content, "测试内容"),
      type: Map.get(overrides, :type, MemoryType.character_profile()),
      scope: Map.get(overrides, :scope, MemoryScope.work()),
      source_type: MemorySourceType.author_created(),
      status: Map.get(overrides, :status, MemoryStatus.draft()),
      weight: Map.get(overrides, :weight, 0.5),
      locked: Map.get(overrides, :locked, false),
      recallable: Map.get(overrides, :recallable, true),
      valid_until: Map.get(overrides, :valid_until)
    }
  end

  defp build_mem(id, overrides) do
    struct(
      NovelDomain.MemoryItem,
      Map.merge(
        %{
          id: id,
          work_id: "test_work",
          content: "test content",
          type: "WORLD_RULE",
          scope: "GLOBAL",
          status: "DRAFT",
          source_type: "AUTHOR_CONFIRMED",
          reference_count: 0,
          weight: 0.5,
          confidence: 0.5,
          source_confidence: 0.5,
          locked: false,
          recallable: true,
          common_sense: false,
          version: 1,
          created_at: DateTime.utc_now(),
          updated_at: DateTime.utc_now()
        },
        overrides
      )
    )
  end
end
