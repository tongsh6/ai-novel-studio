defmodule NovelPersistence.Schemas.VolumeTest do
  use NovelPersistence.DataCase, async: true

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Volume

  describe "changeset/2" do
    test "inserts a valid volume" do
      {:ok, volume} =
        %Volume{}
        |> Volume.changeset(%{
          work_id: Ecto.UUID.generate(),
          title: "第一卷",
          seq: 1,
          status: "PLANNED"
        })
        |> Repo.insert()

      assert volume.status == "PLANNED"
      assert volume.seq == 1
    end

    test "rejects missing required fields" do
      changeset = Volume.changeset(%Volume{}, %{})
      refute changeset.valid?
      assert Keyword.has_key?(changeset.errors, :work_id)
      assert Keyword.has_key?(changeset.errors, :title)
    end

    test "rejects invalid status" do
      changeset =
        Volume.changeset(%Volume{}, %{
          work_id: Ecto.UUID.generate(),
          title: "x",
          seq: 1,
          status: "INVALID"
        })

      refute changeset.valid?
      assert Keyword.has_key?(changeset.errors, :status)
    end

    test "rejects seq <= 0" do
      changeset =
        Volume.changeset(%Volume{}, %{
          work_id: Ecto.UUID.generate(),
          title: "x",
          seq: 0,
          status: "PLANNED"
        })

      refute changeset.valid?
      assert Keyword.has_key?(changeset.errors, :seq)
    end
  end

  describe "query" do
    test "finds volumes by work_id" do
      work_id = Ecto.UUID.generate()

      {:ok, _} =
        %Volume{}
        |> Volume.changeset(%{work_id: work_id, title: "V1", seq: 1, status: "PLANNED"})
        |> Repo.insert()

      {:ok, _} =
        %Volume{}
        |> Volume.changeset(%{work_id: work_id, title: "V2", seq: 2, status: "PLANNED"})
        |> Repo.insert()

      count = Repo.aggregate(from(v in Volume, where: v.work_id == ^work_id), :count)
      assert count == 2
    end
  end
end
