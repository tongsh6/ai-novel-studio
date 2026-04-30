defmodule NovelPersistence.Schemas.CharacterTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Character

  describe "changeset/2" do
    test "inserts a valid character" do
      {:ok, character} =
        %Character{}
        |> Character.changeset(%{
          work_id: Ecto.UUID.generate(),
          name: "小明",
          aliases: ["明哥"],
          role: "主角",
          summary: "一个普通的少年"
        })
        |> Repo.insert()

      assert character.name == "小明"
      assert character.status == AdoptionStatus.tentative()
      assert character.aliases == ["明哥"]
    end

    test "rejects missing required fields" do
      changeset = Character.changeset(%Character{}, %{})
      refute changeset.valid?
      assert Keyword.has_key?(changeset.errors, :work_id)
      assert Keyword.has_key?(changeset.errors, :name)
    end
  end

  describe "query" do
    test "finds characters by work_id" do
      wid = Ecto.UUID.generate()
      {:ok, _} = %Character{} |> Character.changeset(%{work_id: wid, name: "小明"}) |> Repo.insert()
      {:ok, _} = %Character{} |> Character.changeset(%{work_id: wid, name: "小红"}) |> Repo.insert()

      count = Repo.aggregate(from(c in Character, where: c.work_id == ^wid), :count)
      assert count == 2
    end
  end
end
