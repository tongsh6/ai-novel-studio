defmodule NovelPersistence.WorkRepoTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelPersistence.Repo
  alias NovelPersistence.WorkRepo

  setup do
    :ok = Sandbox.checkout(Repo)
    Repo.delete_all(NovelPersistence.Schemas.WorkSession)
    Repo.delete_all(NovelPersistence.Schemas.Work)
    :ok
  end

  describe "list/0" do
    test "returns empty list when no works" do
      assert WorkRepo.list() == []
    end

    test "returns works newest-first by updated_at" do
      {:ok, a} = WorkRepo.create(%{title: "A"})
      Process.sleep(5)
      {:ok, b} = WorkRepo.create(%{title: "B"})

      ids = WorkRepo.list() |> Enum.map(& &1.id)
      assert ids == [b.id, a.id]
    end

    test "hides discarded and archived works by default" do
      {:ok, active} = WorkRepo.create(%{title: "Active"})
      {:ok, discarded} = WorkRepo.create(%{title: "Discarded"})
      {:ok, archived} = WorkRepo.create(%{title: "Archived", status: "ARCHIVED"})
      {:ok, _} = WorkRepo.discard(discarded)

      assert WorkRepo.list() |> Enum.map(& &1.id) == [active.id]

      ids = WorkRepo.list(include_inactive: true) |> Enum.map(& &1.id) |> MapSet.new()
      assert MapSet.subset?(MapSet.new([active.id, discarded.id, archived.id]), ids)
    end
  end

  describe "create/1" do
    test "creates a work with default tentative status" do
      assert {:ok, work} = WorkRepo.create(%{title: "Hello"})
      assert work.title == "Hello"
      assert work.status == "TENTATIVE"
      assert work.revision == 1
      assert is_binary(work.id)
    end

    test "rejects missing title" do
      assert {:error, changeset} = WorkRepo.create(%{})
      assert "can't be blank" in errors_on(changeset, :title)
    end

    test "trims and rejects blank titles" do
      assert {:ok, work} = WorkRepo.create(%{title: "  灵源纪元  "})
      assert work.title == "灵源纪元"

      assert {:error, changeset} = WorkRepo.create(%{title: "   "})
      assert "can't be blank" in errors_on(changeset, :title)
    end
  end

  describe "get/1" do
    test "returns nil when missing" do
      assert WorkRepo.get(Ecto.UUID.generate()) == nil
    end

    test "returns the work when present" do
      {:ok, w} = WorkRepo.create(%{title: "X"})
      assert WorkRepo.get(w.id).id == w.id
    end
  end

  describe "touch/1" do
    test "advances updated_at, surfaces work first in list/0" do
      {:ok, a} = WorkRepo.create(%{title: "A"})
      Process.sleep(5)
      {:ok, b} = WorkRepo.create(%{title: "B"})
      assert WorkRepo.list() |> Enum.map(& &1.id) == [b.id, a.id]

      Process.sleep(5)
      {:ok, touched} = WorkRepo.touch(a)
      assert touched.revision == a.revision
      assert WorkRepo.list() |> Enum.map(& &1.id) == [a.id, b.id]
    end
  end

  describe "rename/2" do
    test "renames title and increments revision without changing id" do
      {:ok, work} = WorkRepo.create(%{title: "未命名作品"})

      assert {:ok, renamed} = WorkRepo.rename(work, "  灵源纪元  ")
      assert renamed.id == work.id
      assert renamed.title == "灵源纪元"
      assert renamed.revision == work.revision + 1
    end

    test "rejects blank rename" do
      {:ok, work} = WorkRepo.create(%{title: "未命名作品"})

      assert {:error, changeset} = WorkRepo.rename(work, "   ")
      assert "can't be blank" in errors_on(changeset, :title)
    end
  end

  describe "discard/1" do
    test "marks a work discarded without physical deletion" do
      {:ok, work} = WorkRepo.create(%{title: "误建作品"})

      assert {:ok, discarded} = WorkRepo.discard(work)
      assert discarded.status == "DISCARDED"
      assert discarded.revision == work.revision + 1
      assert WorkRepo.get(work.id).id == work.id
      assert WorkRepo.list() == []
    end
  end

  defp errors_on(changeset, field) do
    changeset
    |> Ecto.Changeset.traverse_errors(fn {msg, _} -> msg end)
    |> Map.get(field, [])
  end
end
