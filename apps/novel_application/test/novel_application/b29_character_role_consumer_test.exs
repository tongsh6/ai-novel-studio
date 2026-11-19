defmodule NovelApplication.B29CharacterRoleConsumerTest do
  use ExUnit.Case, async: true

  alias NovelApplication.JudgmentProtocol

  test "判断固定规则保留主档案身份优先级，但不把未请求的角色材料塞入 Scope" do
    request =
      JudgmentProtocol.request_for_production(%{
        author_text: "根据本章实际内容判断",
        scope: %{facts: %{}, context: %{}, coverage: %{}},
        source_input_ref: "author-turn",
        supplied_context_refs: [],
        options: [
          capabilities: ["revise_character_profile"],
          plan_run: %{run_id: "run-b29-character-role"}
        ]
      })

    content = NovelApplication.TestAgenticLoopFixtures.prompt_text(request)
    scope = NovelTest.TestProviderPrompt.scope_content(request)

    refute Map.has_key?(scope["facts"], "characters")
    assert content =~ "Character 主档案 narrative_role 为当前事实"
    assert content =~ "记忆/摘要中的"
    assert content =~ "旧主角描述只是历史参考"
    assert content =~ "多主角照实全列，无主角诚实说明"
  end
end

defmodule NovelApplication.B29CharacterRoleConsumerRefreshTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox

  alias NovelApplication.{
    CharacterProfile,
    CharacterRosterNarration,
    ExplorationService,
    WorkService
  }

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{Repo, WorkArchiveRepo}
  alias NovelPersistence.Schemas.{Character, Work}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  @tag :scope_archive_index
  test "memory_recall 的角色关键词不暗读主档案或塞入无角色来源的当前事实" do
    {:ok, work} = WorkService.create(%{title: "记忆与人物来源分离"})

    character =
      Repo.insert!(%NovelPersistence.Schemas.Character{
        work_id: work.id,
        name: "只能主动查档案才可见的人物",
        narrative_role: "PROTAGONIST",
        status: "ACCEPTED"
      })

    assert {:ok, observation} = ExplorationService.run(work.id, "memory_recall", "谁是主角")
    assert observation.refs == []
    assert observation.outcome == :empty_result
    refute observation.summary =~ character.name
    refute observation.summary =~ "当前角色主档案"
  end

  test "采纳 narrative_role 后：主档案读端口/roster 同批返回新值，旧值不留当前事实" do
    work = Repo.insert!(%Work{title: "B29 消费者一致性"})

    character =
      Repo.insert!(%Character{
        work_id: work.id,
        name: "沈砚",
        aliases: ["老沈"],
        role: "查账人",
        summary: "灯楼查账人",
        narrative_role: "ENSEMBLE_POV",
        status: AdoptionStatus.accepted()
      })

    # 采纳前：判断/写作共用读端口看到旧值
    assert {:ok, [before]} = CharacterProfile.targets(work.id)
    assert before.character_ref == "character:#{character.id}"
    assert before.narrative_role == "ENSEMBLE_POV"
    assert before.base_fingerprint != nil

    # 采纳字段修订（等价 CP2 原子 update；这里只改主档案字段）
    assert {:ok, _updated} =
             character
             |> Ecto.Changeset.change(%{narrative_role: "PROTAGONIST"})
             |> Repo.update()

    # 刷新/重开：同一读端口立即返回新值，角色数/id 不变
    assert {:ok, [after_character]} = CharacterProfile.targets(work.id)
    assert after_character.character_ref == before.character_ref
    assert after_character.narrative_role == "PROTAGONIST"
    assert length(CharacterProfile.targets(work.id) |> elem(1)) == 1

    # 档案/StructurePanel 同源读取（WorkArchiveRepo.characters）也已经是新值
    archive_characters = WorkArchiveRepo.characters(work.id)
    assert [%{narrative_role: "PROTAGONIST", name: "沈砚"}] = archive_characters

    # 花名册叙述以主档案为当前事实
    message = CharacterRosterNarration.message(archive_characters)
    assert message =~ "当前作品的主角是 沈砚"
    refute message =~ "还没有谁被标记为主角"
  end
end
