defmodule V2Verification.Spike.PaperTrail do
  @moduledoc """
  Spike runner for `verification/paper-trail-ecto-compatibility.md`.

  Steps mirror section 3.2 of the verification doc: insert / update title /
  update status / delete, plus a Multi rollback case and a final query that
  reconstructs the version trail.

  Output is a structured map; `run/1` also prints a one-screen report.
  """

  import Ecto.Query, only: [from: 2]
  alias V2Verification.{Migrations, RepoSqlite, RepoPostgres}
  alias V2Verification.Schema.Work

  def run(target) when target in [:sqlite, :postgres] do
    System.put_env("SPIKE_DB", Atom.to_string(target))
    repo = repo_for(target)
    Application.put_env(:paper_trail, :repo, repo)

    {:ok, _} = Application.ensure_all_started(:v2_verification)
    Migrations.reset!(repo)

    workspace = Ecto.UUID.generate()
    author = Ecto.UUID.generate()
    origin = "spike:paper_trail"
    pt_opts = [origin: origin, originator_id: nil, meta: %{"trace_id" => "spike-#{:erlang.unique_integer([:positive])}"}]

    results = %{
      target: target,
      checks: []
    }

    # 1. insert
    {:ok, %{model: work, version: v_insert}} =
      %Work{}
      |> Work.changeset(%{workspace_id: workspace, author_id: author, title: "初稿标题"})
      |> PaperTrail.insert(pt_opts)

    results = add(results, :insert_emits_version, v_insert.event == "insert" and v_insert.item_id == work.id)

    # 2. update title
    {:ok, %{model: work, version: v_title}} =
      work
      |> Work.changeset(%{title: "新标题 v2"})
      |> PaperTrail.update(pt_opts)

    results =
      add(results, :update_title_emits_version, v_title.event == "update" and changes_get(v_title, :title) == "新标题 v2")

    # 3. update status
    {:ok, %{model: work, version: v_status}} =
      work
      |> Work.changeset(%{status: :active})
      |> PaperTrail.update(pt_opts)

    status_changed = changes_get(v_status, :status) in [:active, "active"]
    results = add(results, :update_status_emits_version, v_status.event == "update" and status_changed)

    # 4. delete
    {:ok, %{model: deleted, version: v_delete}} =
      work
      |> PaperTrail.delete(pt_opts)

    results = add(results, :delete_emits_version, v_delete.event == "delete" and v_delete.item_id == deleted.id)

    # 5. Multi rollback should NOT produce orphan version
    versions_before_rollback = repo.aggregate("versions", :count, :id)

    rollback_changeset =
      %Work{}
      |> Work.changeset(%{workspace_id: workspace, author_id: author, title: "rollback target"})

    # Drive the transaction directly so we can return a non-changeset error
    # without tripping PaperTrail.Multi.commit/1's error remapping.
    rollback_result =
      Ecto.Multi.new()
      |> PaperTrail.Multi.insert(rollback_changeset, pt_opts)
      |> Ecto.Multi.run(:forced_failure, fn _, _ -> {:error, :forced_failure} end)
      |> repo.transaction()

    versions_after_rollback = repo.aggregate("versions", :count, :id)

    rollback_ok =
      match?({:error, :forced_failure, :forced_failure, _}, rollback_result) and
        versions_after_rollback == versions_before_rollback

    results = add(results, :multi_rollback_no_orphan, rollback_ok)

    # 6. version trail can reconstruct lifecycle
    versions =
      from(v in PaperTrail.Version,
        where: v.item_type == ^"Work" and v.item_id == ^work.id,
        order_by: [asc: v.id]
      )
      |> repo.all()

    expected_events = ["insert", "update", "update", "delete"]
    actual_events = Enum.map(versions, & &1.event)
    results = add(results, :version_trail_reconstructable, actual_events == expected_events)

    # 7. originator/origin/meta round-trip
    meta_ok =
      Enum.all?(versions, fn v ->
        v.origin == origin and is_map(v.meta) and Map.has_key?(v.meta, "trace_id")
      end)

    results = add(results, :originator_origin_meta_persisted, meta_ok)

    # 8. paper_trail.versions.id is stable bigint usable as source_revision_id
    id_stable =
      Enum.all?(versions, fn v -> is_integer(v.id) and v.id > 0 end)

    results = add(results, :version_id_usable_as_source_revision_id, id_stable)

    print_report(results, versions)
    results
  end

  defp repo_for(:sqlite), do: RepoSqlite
  defp repo_for(:postgres), do: RepoPostgres

  defp add(results, key, value), do: Map.update!(results, :checks, &[{key, value} | &1])

  defp changes_get(%{item_changes: changes}, key) when is_atom(key) do
    Map.get(changes, key) || Map.get(changes, Atom.to_string(key))
  end

  defp print_report(%{target: target, checks: checks}, versions) do
    IO.puts("\n=== paper_trail spike (#{target}) ===")

    checks
    |> Enum.reverse()
    |> Enum.each(fn {key, value} ->
      mark = if value, do: "PASS", else: "FAIL"
      IO.puts("  [#{mark}] #{key}")
    end)

    IO.puts("\nversions captured: #{length(versions)}")

    Enum.each(versions, fn v ->
      IO.puts(
        "  v#{v.id} #{String.pad_trailing(v.event, 7)} item=#{v.item_id} origin=#{v.origin} changes=#{Jason.encode!(v.item_changes)}"
      )
    end)
  end
end
