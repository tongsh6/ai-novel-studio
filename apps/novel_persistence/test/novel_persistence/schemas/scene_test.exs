defmodule NovelPersistence.Schemas.SceneTest do
  use NovelPersistence.DataCase, async: true

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Scene

  describe "changeset/2" do
    test "inserts a valid scene" do
      {:ok, scene} =
        %Scene{}
        |> Scene.changeset(%{
          work_id: Ecto.UUID.generate(),
          chapter_id: Ecto.UUID.generate(),
          title: "第一场",
          seq: 1,
          status: "PLANNED"
        })
        |> Repo.insert()

      assert scene.status == "PLANNED"
    end

    test "rejects missing required fields" do
      changeset = Scene.changeset(%Scene{}, %{})
      refute changeset.valid?
      assert Keyword.has_key?(changeset.errors, :chapter_id)
    end
  end

  describe "query" do
    test "finds scenes by chapter_id" do
      cid = Ecto.UUID.generate()
      wid = Ecto.UUID.generate()
      {:ok, _} = %Scene{} |> Scene.changeset(%{work_id: wid, chapter_id: cid, title: "S1", seq: 1, status: "PLANNED"}) |> Repo.insert()
      {:ok, _} = %Scene{} |> Scene.changeset(%{work_id: wid, chapter_id: cid, title: "S2", seq: 2, status: "PLANNED"}) |> Repo.insert()

      count = Repo.aggregate(from(s in Scene, where: s.chapter_id == ^cid), :count)
      assert count == 2
    end
  end
end
