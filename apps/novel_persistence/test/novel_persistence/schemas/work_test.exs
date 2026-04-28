defmodule NovelPersistence.Schemas.WorkTest do
  use NovelPersistence.DataCase, async: true

  alias NovelFoundation.Enums.AdoptionStatus
  alias NovelPersistence.Repo
  alias NovelPersistence.Schemas.Work

  describe "optimistic_lock on revision" do
    test "concurrent update raises StaleEntryError on the stale writer (default behavior)" do
      {:ok, work} =
        %Work{}
        |> Work.changeset(%{title: "x", status: AdoptionStatus.tentative()})
        |> Repo.insert()

      stale_revision = work.revision

      # Simulate a concurrent writer by bumping revision out of band.
      Repo.update_all(Work, set: [revision: stale_revision + 1])

      # Default behavior: raises. AdoptionBoundary uses stale_error_field to
      # surface this as a changeset error instead.
      assert_raise Ecto.StaleEntryError, fn ->
        work
        |> Work.adopt_changeset()
        |> Repo.update()
      end
    end

    test "stale_error_field option converts stale into changeset error (Adoption path)" do
      {:ok, work} =
        %Work{}
        |> Work.changeset(%{title: "x", status: AdoptionStatus.tentative()})
        |> Repo.insert()

      Repo.update_all(Work, set: [revision: work.revision + 1])

      assert {:error, %Ecto.Changeset{errors: errors}} =
               work
               |> Work.adopt_changeset()
               |> Repo.update(stale_error_field: :revision)

      assert Keyword.has_key?(errors, :revision)
    end

    test "consecutive updates on the same struct succeed and increment revision" do
      {:ok, work} =
        %Work{}
        |> Work.changeset(%{title: "y", status: AdoptionStatus.tentative()})
        |> Repo.insert()

      assert {:ok, adopted} =
               work
               |> Work.adopt_changeset()
               |> Repo.update()

      assert adopted.revision == work.revision + 1
      assert adopted.status == AdoptionStatus.accepted()
    end
  end
end
