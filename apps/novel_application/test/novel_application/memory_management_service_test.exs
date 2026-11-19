defmodule NovelApplication.MemoryManagementServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{ExplorationService, MemoryManagementService, WorkService}
  alias NovelFoundation.Enums.MemorySourceType
  alias NovelFoundation.Enums.MemoryStatus
  alias NovelFoundation.Enums.MemoryType
  alias NovelPersistence.MemoryReferenceLog
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    {:ok, work} = WorkService.create(%{"title" => "记忆管理作品"})
    {:ok, other_work} = WorkService.create(%{"title" => "隔离作品"})
    %{work: work, other_work: other_work}
  end

  test "create and list are scoped to the current work", %{work: work, other_work: other_work} do
    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "林瑶失踪与灵源矿区有关",
        "summary" => "林瑶矿区线索",
        "type" => MemoryType.foreshadowing(),
        "scope" => "WORK",
        "status" => MemoryStatus.confirmed(),
        "source_type" => MemorySourceType.author_created(),
        "tags" => ["主线"]
      })

    {:ok, _other} =
      MemoryManagementService.create(other_work.id, %{
        "content" => "其他作品设定",
        "type" => MemoryType.world_rule(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    assert memory.work_id == work.id
    assert memory.status == MemoryStatus.draft()

    assert {:ok, %{items: [listed], count: 1}} =
             MemoryManagementService.list(work.id, %{"keyword" => "灵源"})

    assert listed.id == memory.id
  end

  test "lifecycle actions consume schema/domain guard side effects", %{work: work} do
    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "灵源矿区不能公开进入",
        "type" => MemoryType.world_rule(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    {:ok, confirmed} = MemoryManagementService.confirm(work.id, memory.id)
    assert confirmed.status == MemoryStatus.confirmed()
    assert confirmed.source_type == MemorySourceType.author_confirmed()

    {:ok, locked} = MemoryManagementService.lock(work.id, memory.id)
    assert locked.locked == true

    assert {:error, %Ecto.Changeset{} = changeset} =
             MemoryManagementService.deprecate(work.id, memory.id)

    assert {"cannot move locked memory item to terminal status", _} =
             Keyword.fetch!(changeset.errors, :status)

    {:ok, unlocked} = MemoryManagementService.unlock(work.id, memory.id)
    assert unlocked.locked == false

    {:ok, deprecated} = MemoryManagementService.deprecate(work.id, memory.id)
    assert deprecated.status == MemoryStatus.deprecated()
    assert deprecated.locked == false
    assert deprecated.recallable == false

    {:ok, references} = MemoryManagementService.references(work.id, memory.id)
    reasons = Enum.map(references, & &1.reference_reason)

    assert Enum.any?(reasons, &String.contains?(&1, "作者创建记忆草稿"))
    assert Enum.any?(reasons, &String.contains?(&1, "作者确认"))
    assert Enum.any?(reasons, &String.contains?(&1, "作者锁定"))
    assert Enum.any?(reasons, &String.contains?(&1, "系统已阻止"))
    assert Enum.any?(reasons, &String.contains?(&1, "作者解锁"))
    assert Enum.any?(reasons, &String.contains?(&1, "作者废弃"))

    # 治理动作文案作者可见：状态/类型/作用域用 displayName，不回显内部枚举。
    assert Enum.any?(reasons, &String.contains?(&1, "状态 草稿"))
    assert Enum.any?(reasons, &String.contains?(&1, "状态 已确认"))
    refute Enum.any?(reasons, &String.contains?(&1, "DRAFT"))
    refute Enum.any?(reasons, &String.contains?(&1, "CONFIRMED"))
    refute Enum.any?(reasons, &String.contains?(&1, "作用域 WORK"))
  end

  test "invalid governance metadata is rejected by the schema boundary", %{work: work} do
    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "尚未确认的设定",
        "type" => MemoryType.world_rule(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    assert {:error, %Ecto.Changeset{} = changeset} =
             MemoryManagementService.update_weight(work.id, memory.id, 1.5)

    assert Keyword.has_key?(changeset.errors, :weight)
  end

  test "references are scoped by work", %{work: work, other_work: other_work} do
    {:ok, memory} =
      MemoryManagementService.create(work.id, %{
        "content" => "林烬记得矿区路线",
        "type" => MemoryType.plot_fact(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    {:ok, _} =
      MemoryReferenceLog.write(%{
        memory_id: memory.id,
        work_id: work.id,
        reference_scene: "recall",
        reference_reason: "作者询问矿区"
      })

    {:ok, _} =
      MemoryReferenceLog.write(%{
        memory_id: memory.id,
        work_id: other_work.id,
        reference_scene: "recall",
        reference_reason: "串线记录"
      })

    assert {:ok, references} = MemoryManagementService.references(work.id, memory.id)
    assert Enum.all?(references, &(&1.work_id == work.id))
    assert Enum.any?(references, &(&1.reference_reason == "作者询问矿区"))
  end

  @tag :r05_exploration
  test "召回保留真实记忆身份和版本，有界摘要不冒充正文", %{work: work} do
    first = recall_memory(work.id, %{content: "铜灯的正文事实", summary: "铜灯检索摘要", version: 7})
    second = recall_memory(work.id, %{content: "青石的另一条事实", summary: "青石检索摘要", version: 11})
    first_ref = "memory:#{first.id}"
    second_ref = "memory:#{second.id}"

    assert {:ok, recalled} = MemoryManagementService.recall(work.id, %{"query" => "铜灯"})
    assert [%{id: first_id, work_id: source_work, version: 7}] = recalled.items
    assert first_id == first.id
    assert source_work == work.id
    assert recalled.text =~ "铜灯检索摘要"
    assert recalled.candidate_count == 1

    assert {:ok, first_page} = ExplorationService.run(work.id, "memory_recall", "铜灯")
    assert {:ok, second_page} = ExplorationService.run(work.id, "memory_recall", "青石")
    assert first_page.refs == [first_ref]
    assert second_page.refs == [second_ref]
    assert first_page.versions == %{first_ref => 7}
    assert second_page.versions == %{second_ref => 11}
    refute first_page.refs == second_page.refs
    assert first_page.coverage.kind == "recall"
    assert first_page.coverage.exhaustive == false
    assert first_page.next_offset == nil
    assert first_page.omissions != []
    refute first_page.summary =~ first.content
    assert ExplorationService.observation_metadata(first_page).versions == %{first_ref => 7}
  end

  @tag :r05_exploration
  test "长记忆正文按真实ref完整分页，读取间新版本不能变成旧页的完整续章", %{work: work} do
    body = String.duplicate("忆👩🏽‍🚀é", 2_300) <> "记忆最后一页原文"
    item = recall_memory(work.id, %{content: body, summary: "仅为索引摘要", version: 4})
    before_read = Repo.get!(NovelPersistence.Schemas.MemoryItem, item.id)
    ref = "memory:#{item.id}"

    pages =
      for offset <- [0, 6_000] do
        assert {:ok, page} =
                 ExplorationService.run(
                   work.id,
                   "memory_recall",
                   Jason.encode!(%{memory_ref: ref, offset: offset})
                 )

        assert page.refs == [ref]
        assert page.versions == %{ref => 4}
        assert page.coverage.kind == "detail"
        assert page.coverage.memory_ref == ref
        assert page.coverage.summary.offset == offset
        assert page.coverage.summary.total_graphemes == String.length(body)
        assert page.facts.memory.work_id == work.id
        assert page.facts.memory.status == MemoryStatus.confirmed()
        page
      end

    assert Enum.map_join(pages, & &1.summary) == body
    assert hd(pages).next_offset == 6_000
    assert List.last(pages).next_offset == nil
    assert List.last(pages).outcome == :partial
    assert Repo.get!(NovelPersistence.Schemas.MemoryItem, item.id) == before_read

    item |> Ecto.Changeset.change(content: body <> "新版追加", version: 5) |> Repo.update!()

    assert {:ok, changed} =
             ExplorationService.run(
               work.id,
               "memory_recall",
               Jason.encode!(%{memory_ref: ref, offset: 6_000})
             )

    assert changed.versions == %{ref => 5}
    assert hd(pages).versions == %{ref => 4}
    assert changed.outcome == :partial
    assert changed.omissions != []

    continuation = %{tool: "memory_recall", kind: "detail", memory_ref: ref, next_offset: 6_000}

    assert ExplorationService.continuation_request?(
             "memory_recall",
             Jason.encode!(%{memory_ref: ref, offset: 6_000}),
             continuation
           )

    refute ExplorationService.continuation_request?(
             "memory_recall",
             Jason.encode!(%{memory_ref: ref, offset: 6_001}),
             continuation
           )

    refute ExplorationService.continuation_request?(
             "memory_recall",
             Jason.encode!(%{memory_ref: "memory:#{Ecto.UUID.generate()}", offset: 6_000}),
             continuation
           )
  end

  @tag :r05_exploration
  test "记忆详情继续受作品、召回状态约束且拒绝伪造读范围", %{work: work, other_work: other_work} do
    good = recall_memory(work.id, %{content: "当前记忆", version: 3})
    foreign = recall_memory(other_work.id, %{content: "他作记忆"})
    disabled = recall_memory(work.id, %{content: "禁止召回", recallable: false})
    draft = recall_memory(work.id, %{content: "草稿记忆", status: MemoryStatus.draft()})

    for item <- [foreign, disabled, draft] do
      assert {:error, :memory_not_found} =
               ExplorationService.run(
                 work.id,
                 "memory_recall",
                 Jason.encode!(%{memory_ref: "memory:#{item.id}", offset: 0})
               )
    end

    assert {:error, :memory_offset_out_of_range} =
             ExplorationService.run(
               work.id,
               "memory_recall",
               Jason.encode!(%{memory_ref: "memory:#{good.id}", offset: 100})
             )

    assert {:error, :invalid_memory_query} =
             ExplorationService.run(
               work.id,
               "memory_recall",
               Jason.encode!(%{
                 memory_ref: "memory:#{good.id}",
                 offset: 0,
                 work_id: other_work.id
               })
             )
  end

  defp recall_memory(work_id, attrs) do
    attrs =
      Map.merge(
        %{
          id: Ecto.UUID.generate(),
          work_id: work_id,
          content: "记忆原文",
          type: MemoryType.world_rule(),
          scope: "WORK",
          status: MemoryStatus.confirmed(),
          source_type: MemorySourceType.author_confirmed(),
          recallable: true,
          version: 1
        },
        attrs
      )

    NovelPersistence.Schemas.MemoryItem |> struct(attrs) |> Repo.insert!()
  end

  test "foreign memory ids cannot be read or governed from the current work", %{
    work: work,
    other_work: other_work
  } do
    {:ok, foreign} =
      MemoryManagementService.create(other_work.id, %{
        "content" => "其他作品专属伏笔",
        "summary" => "外部伏笔",
        "type" => MemoryType.foreshadowing(),
        "scope" => "WORK",
        "source_type" => MemorySourceType.author_created()
      })

    assert {:error, :not_found} = MemoryManagementService.get(work.id, foreign.id)
    assert {:error, :not_found} = MemoryManagementService.confirm(work.id, foreign.id)
    assert {:error, :not_found} = MemoryManagementService.references(work.id, foreign.id)

    assert {:ok, %{items: []}} = MemoryManagementService.list(work.id, %{"keyword" => "其他作品专属"})
  end
end
