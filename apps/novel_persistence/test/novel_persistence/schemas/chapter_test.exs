defmodule NovelPersistence.Schemas.ChapterTest do
  use NovelPersistence.DataCase, async: true

  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Chapter

  describe "changeset/2" do
    test "inserts a valid chapter" do
      {:ok, chapter} =
        %Chapter{}
        |> Chapter.changeset(%{
          work_id: Ecto.UUID.generate(),
          volume_id: Ecto.UUID.generate(),
          title: "第一章",
          seq: 1,
          status: "PLANNED"
        })
        |> Repo.insert()

      assert chapter.seq == 1
      assert chapter.status == "PLANNED"
    end

    test "rejects missing required fields" do
      changeset = Chapter.changeset(%Chapter{}, %{})
      refute changeset.valid?
      assert Keyword.has_key?(changeset.errors, :volume_id)
    end
  end

  describe "query" do
    test "finds chapters by volume_id" do
      vid = Ecto.UUID.generate()
      wid = Ecto.UUID.generate()
      {:ok, _} = %Chapter{} |> Chapter.changeset(%{work_id: wid, volume_id: vid, title: "C1", seq: 1, status: "PLANNED"}) |> Repo.insert()
      {:ok, _} = %Chapter{} |> Chapter.changeset(%{work_id: wid, volume_id: vid, title: "C2", seq: 2, status: "PLANNED"}) |> Repo.insert()

      count = Repo.aggregate(from(c in Chapter, where: c.volume_id == ^vid), :count)
      assert count == 2
    end
  end
end
