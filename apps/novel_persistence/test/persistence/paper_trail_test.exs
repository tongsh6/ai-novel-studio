defmodule NovelPersistence.PaperTrailTest do
  use NovelPersistence.DataCase, async: true

  alias NovelPersistence.Schemas.Workspace

  describe "PaperTrail.insert/2" do
    test "creates model + version in one transaction" do
      cs = Workspace.changeset(%Workspace{}, %{name: "pt_insert #{System.unique_integer([:positive])}"})

      {:ok, %{model: ws, version: version}} = PaperTrail.insert(cs, origin: "test:insert")

      assert is_binary(ws.id)
      assert version.event == "insert"
      assert version.item_type == "Workspace"
      assert version.item_id == ws.id
      assert version.origin == "test:insert"
    end

    test "version is queryable via get_versions" do
      cs = Workspace.changeset(%Workspace{}, %{name: "pt_query #{System.unique_integer([:positive])}"})

      {:ok, %{model: ws}} = PaperTrail.insert(cs)

      versions = PaperTrail.get_versions(ws)
      assert length(versions) == 1
      assert hd(versions).event == "insert"
    end
  end

  describe "PaperTrail.update/2" do
    test "creates version with item_changes" do
      cs = Workspace.changeset(%Workspace{}, %{name: "pt_before #{System.unique_integer([:positive])}"})
      {:ok, %{model: ws}} = PaperTrail.insert(cs)

      update_cs = Workspace.changeset(ws, %{name: "pt_after"})
      {:ok, %{model: updated, version: version}} = PaperTrail.update(update_cs, origin: "test:update")

      assert updated.name == "pt_after"
      assert version.event == "update"
      assert version.item_id == ws.id

      versions = PaperTrail.get_versions(ws)
      assert length(versions) == 2
    end
  end

  describe "PaperTrail.delete/2" do
    test "creates delete version record" do
      cs = Workspace.changeset(%Workspace{}, %{name: "pt_delete #{System.unique_integer([:positive])}"})
      {:ok, %{model: ws}} = PaperTrail.insert(cs)

      {:ok, %{model: _deleted, version: version}} = PaperTrail.delete(ws, origin: "test:delete")

      assert version.event == "delete"
      assert version.item_id == ws.id

      versions = PaperTrail.get_versions(ws)
      assert length(versions) == 2
      assert Enum.map(versions, & &1.event) |> Enum.sort() == ["delete", "insert"]
    end
  end

  describe "multi with rollback" do
    test "no orphan version on rollback" do
      name = "pt_rollback #{System.unique_integer([:positive])}"

      version_count_before = Repo.aggregate(from(v in "versions", select: count(v.id)), :count)

      insert_cs = Workspace.changeset(%Workspace{}, %{name: name})

      multi =
        PaperTrail.Multi.new()
        |> PaperTrail.Multi.insert(insert_cs, origin: "test:rollback")
        |> Ecto.Multi.run(:forced_fail, fn _repo, _changes -> {:error, :rollback_expected} end)

      assert {:error, :forced_fail, :rollback_expected, _changes_so_far} = Repo.transaction(multi)

      version_count_after = Repo.aggregate(from(v in "versions", select: count(v.id)), :count)
      assert version_count_after == version_count_before
    end
  end

  describe "options passthrough" do
    test "originator_id, origin, and meta are persisted" do
      cs = Workspace.changeset(%Workspace{}, %{name: "pt_meta #{System.unique_integer([:positive])}"})
      originator_uuid = Ecto.UUID.generate()

      {:ok, %{version: version}} =
        PaperTrail.insert(cs,
          origin: "test:options",
          originator: %{id: originator_uuid},
          meta: %{trace_id: "trace-001"}
        )

      assert version.origin == "test:options"
      assert version.originator_id == originator_uuid
      assert version.meta[:trace_id] == "trace-001"
    end
  end
end
