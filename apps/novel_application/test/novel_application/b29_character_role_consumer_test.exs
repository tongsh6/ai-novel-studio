defmodule NovelApplication.B29CharacterRoleConsumerTest do
  use ExUnit.Case, async: true

  alias NovelApplication.{CharacterProfile, ExplorationService}
  alias NovelApplication.JudgmentProtocol

  @ref "character:11111111-1111-1111-1111-111111111111"

  defp target(role) do
    %{
      character_ref: @ref,
      name: "沈砚",
      aliases: ["老沈"],
      role: "查账人",
      summary: "主角与账房",
      narrative_role: role,
      status: "ACCEPTED",
      updated_at: "2026-10-24T22:24:08Z",
      base_fingerprint: "fp"
    }
  end

  defp input(opts) do
    %{
      author_text: Keyword.get(opts, :author_text, "根据本章实际内容判断"),
      context_block: "章计划/读取范围",
      source_input_ref: "author-turn",
      supplied_context_refs: [],
      options: opts
    }
  end

  test "判断 prompt：角色索引携带当前 narrative_role，并声明主档案优先于旧记忆" do
    content =
      JudgmentProtocol.prompt(
        input(
          capabilities: ["revise_character_profile"],
          character_targets: [target("PROTAGONIST")]
        )
      )
      |> Map.fetch!(:messages)
      |> List.first()
      |> Map.fetch!(:content)

    assert content =~ "narrative_role=PROTAGONIST"
    assert content =~ "Character 主档案 narrative_role 为当前事实"
    assert content =~ "记忆/摘要中的"
    assert content =~ "旧主角描述只是历史参考"
    assert content =~ "多主角照实全列，无主角诚实说明"
  end

  test "memory_recall 事实注记：主档案当前主角优先，旧记忆不冒充；无主角诚实" do
    assert note = ExplorationService.role_fact_note([target("PROTAGONIST")])
    assert note =~ "主角=沈砚"
    assert note =~ "记忆中的旧身份描述属历史"

    assert note = ExplorationService.role_fact_note([target("ENSEMBLE_POV")])
    assert note =~ "尚无被标记为主角的角色"
    assert note =~ "记忆中的旧身份描述属历史"

    assert ExplorationService.role_fact_note([]) == ""
  end
end

defmodule NovelApplication.B29CharacterRoleConsumerRefreshTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.{CharacterProfile, CharacterRosterNarration}
  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.{Repo, WorkArchiveRepo}
  alias NovelPersistence.Schemas.{Character, Work}

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
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
