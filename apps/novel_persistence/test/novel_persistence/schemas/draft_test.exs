defmodule NovelPersistence.Schemas.DraftTest do
  use NovelPersistence.DataCase, async: false

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Draft

  describe "changeset/2" do
    test "inserts a valid tentative draft" do
      {:ok, draft} =
        %Draft{}
        |> Draft.changeset(%{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文内容"
        })
        |> Repo.insert()

      assert draft.status == AdoptionStatus.tentative()
      assert draft.revision >= 1
    end

    test "rejects missing scene_id" do
      changeset = Draft.changeset(%Draft{}, %{work_id: Ecto.UUID.generate(), content: "正文"})
      refute changeset.valid?
      assert Keyword.has_key?(changeset.errors, :scene_id)
    end
  end

  describe "adopt_changeset/1" do
    test "transitions tentative → accepted and bumps revision on update" do
      {:ok, draft} =
        %Draft{}
        |> Draft.changeset(%{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文"
        })
        |> Repo.insert()

      assert {:ok, adopted} =
               draft
               |> Draft.adopt_changeset()
               |> Repo.update()

      assert adopted.status == AdoptionStatus.accepted()
      assert adopted.revision == draft.revision + 1
    end
  end

  describe "discard_changeset/1" do
    test "transitions tentative → discarded" do
      {:ok, draft} =
        %Draft{}
        |> Draft.changeset(%{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文"
        })
        |> Repo.insert()

      assert {:ok, discarded} =
               draft
               |> Draft.discard_changeset()
               |> Repo.update()

      assert discarded.status == AdoptionStatus.discarded()
    end
  end

  describe "optimistic_lock on revision" do
    test "concurrent adopt raises StaleEntryError" do
      {:ok, draft} =
        %Draft{}
        |> Draft.changeset(%{
          work_id: Ecto.UUID.generate(),
          scene_id: Ecto.UUID.generate(),
          content: "正文"
        })
        |> Repo.insert()

      stale_revision = draft.revision
      Repo.update_all(Draft, set: [revision: stale_revision + 1])

      assert_raise Ecto.StaleEntryError, fn ->
        draft |> Draft.adopt_changeset() |> Repo.update()
      end
    end
  end
end
