defmodule NovelPersistence.WorkRepoTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelPersistence.Repo
  alias NovelPersistence.WorkRepo

  setup do
    :ok = Sandbox.checkout(Repo)
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
  end

  describe "create/1" do
    test "creates a work with default tentative status" do
      assert {:ok, work} = WorkRepo.create(%{title: "Hello"})
      assert work.title == "Hello"
      assert work.status == "TENTATIVE"
      assert is_binary(work.id)
    end

    test "rejects missing title" do
      assert {:error, changeset} = WorkRepo.create(%{})
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
      {:ok, _} = WorkRepo.touch(a)
      assert WorkRepo.list() |> Enum.map(& &1.id) == [a.id, b.id]
    end
  end

  defp errors_on(changeset, field) do
    changeset
    |> Ecto.Changeset.traverse_errors(fn {msg, _} -> msg end)
    |> Map.get(field, [])
  end
end
