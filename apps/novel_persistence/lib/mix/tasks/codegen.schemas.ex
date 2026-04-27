defmodule Mix.Tasks.Codegen.Schemas do
  @moduledoc """
  Phase 0 minimal codegen task — runs schema-drift check between
  `docs/design-v2/schemas/` (JSON SSOT, ADR-0001) and Ecto embedded_schema
  mirrors under `NovelPersistence.Schemas.*`.

  Plan A from T8 (see tasks/2026-04-26-phase-0-week-1-bootstrap.md):
  no real generation; just verifies the manual mirror is in sync.

  Phase 1 will upgrade this to real codegen once schema count grows.
  """

  use Mix.Task

  @shortdoc "Verify Ecto schemas mirror docs/design-v2/schemas/ JSON SSOT"

  @impl Mix.Task
  def run(_args) do
    Mix.Task.run("app.config")
    Application.ensure_all_started(:ecto)

    case NovelPersistence.SchemaDrift.check() do
      :ok ->
        mirrors = NovelPersistence.SchemaDrift.mirrors() |> length()
        Mix.shell().info("schema drift check: ok (#{mirrors} mirrors verified)")

      {:error, diffs} ->
        Mix.shell().error("schema drift detected:")
        Enum.each(diffs, fn d -> Mix.shell().error("  - #{d}") end)
        Mix.raise("schema drift — fix Ecto schemas or JSON SSOT")
    end
  end
end
