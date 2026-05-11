defmodule NovelApplication.WorkServiceTest do
  use ExUnit.Case, async: false

  alias Ecto.Adapters.SQL.Sandbox
  alias NovelApplication.WorkService
  alias NovelPersistence.Repo

  setup do
    :ok = Sandbox.checkout(Repo)
    :ok
  end

  describe "list/0" do
    test "empty initially, then newest-first after creates" do
      assert WorkService.list() == []

      {:ok, a} = WorkService.create(%{title: "A"})
      Process.sleep(5)
      {:ok, b} = WorkService.create(%{title: "B"})

      assert WorkService.list() |> Enum.map(& &1.id) == [b.id, a.id]
    end
  end

  describe "create/1" do
    test "returns DTO and accepts only allow-listed attrs" do
      {:ok, work} =
        WorkService.create(%{
          title: "Cyber",
          genre: "scifi",
          # ignored — not in allow-list
          status: "ACCEPTED",
          unrelated: "noise"
        })

      assert work.title == "Cyber"
      assert work.genre == "scifi"
      # default came from schema, not from caller-provided "ACCEPTED"
      assert work.status == "TENTATIVE"
      refute Map.has_key?(work, :unrelated)
    end

    test "missing title surfaces changeset error" do
      assert {:error, %Ecto.Changeset{}} = WorkService.create(%{genre: "x"})
    end

    test "accepts string-keyed attrs (HTTP body shape)" do
      {:ok, work} = WorkService.create(%{"title" => "Str"})
      assert work.title == "Str"
    end
  end

  describe "get/1" do
    test "nil when missing" do
      assert WorkService.get(Ecto.UUID.generate()) == nil
    end

    test "returns DTO when present" do
      {:ok, w} = WorkService.create(%{title: "G"})
      assert WorkService.get(w.id).title == "G"
    end
  end

  describe "mark_opened/1" do
    test ":not_found for unknown id" do
      assert WorkService.mark_opened(Ecto.UUID.generate()) == :not_found
    end

    test "surfaces work first in subsequent list/0" do
      {:ok, a} = WorkService.create(%{title: "A"})
      Process.sleep(5)
      {:ok, b} = WorkService.create(%{title: "B"})
      assert WorkService.list() |> Enum.map(& &1.id) == [b.id, a.id]

      Process.sleep(5)
      {:ok, _} = WorkService.mark_opened(a.id)
      assert WorkService.list() |> Enum.map(& &1.id) == [a.id, b.id]
    end
  end
end
