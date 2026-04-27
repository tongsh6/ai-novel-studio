defmodule NovelPersistence.Schemas.WorkspaceTest do
  use NovelPersistence.DataCase, async: true

  alias NovelPersistence.Schemas.Workspace

  describe "changeset/2" do
    test "minimal valid attrs" do
      cs = Workspace.changeset(%Workspace{}, %{name: "玄幻一号"})
      assert cs.valid?
    end

    test "name required" do
      cs = Workspace.changeset(%Workspace{}, %{})
      refute cs.valid?
      assert {:name, {"can't be blank", _}} = List.keyfind(cs.errors, :name, 0)
    end
  end

  describe "Repo round-trip" do
    test "insert + reload" do
      {:ok, ws} =
        %Workspace{}
        |> Workspace.changeset(%{name: "玄幻一号", description: "首部测试 workspace"})
        |> Repo.insert()

      assert is_binary(ws.id)
      assert byte_size(ws.id) == 36
      assert ws.name == "玄幻一号"

      reloaded = Repo.get!(Workspace, ws.id)
      assert reloaded.name == ws.name
      assert reloaded.description == "首部测试 workspace"
    end

    test "name unique constraint" do
      {:ok, _} =
        %Workspace{}
        |> Workspace.changeset(%{name: "重名 workspace"})
        |> Repo.insert()

      {:error, changeset} =
        %Workspace{}
        |> Workspace.changeset(%{name: "重名 workspace"})
        |> Repo.insert()

      refute changeset.valid?
      assert {:name, {"has already been taken", _}} = List.keyfind(changeset.errors, :name, 0)
    end
  end
end
