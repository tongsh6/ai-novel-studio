defmodule NovelPersistence.SchemaDrift do
  @moduledoc """
  Compares JSON Schema files under `docs/design/schemas/` against the Ecto
  embedded_schema modules that mirror them.

  Phase 0 minimum: ensures top-level field set and required-field set match.
  Does NOT validate types, formats, $refs (those are deferred until downstream
  ADRs land their respective schemas).

  This is the safety net for the manual mirror workflow chosen in T8 plan A:
  if someone edits the JSON Schema and forgets to update the Ecto module
  (or vice versa), CI fails here.
  """

  alias NovelPersistence.Schemas.Foundation.{ArtifactAdoptionEntry, TurnResult}

  @schemas_root Path.expand("../../../../docs/design/schemas", __DIR__)

  @mirrors [
    ArtifactAdoptionEntry,
    TurnResult
  ]

  @spec schemas_root() :: String.t()
  def schemas_root, do: @schemas_root

  @spec mirrors() :: [module()]
  def mirrors, do: @mirrors

  @doc """
  Returns `:ok` if every mirror module agrees with its JSON Schema source,
  otherwise `{:error, [diff]}` where each diff describes the mismatch.
  """
  @spec check() :: :ok | {:error, [String.t()]}
  def check do
    diffs =
      Enum.flat_map(@mirrors, fn module ->
        compare(module)
      end)

    case diffs do
      [] -> :ok
      _ -> {:error, diffs}
    end
  end

  @doc """
  Compares one mirror module against its source JSON Schema.
  Returns a list of human-readable diff strings (empty if in sync).
  """
  @spec compare(module()) :: [String.t()]
  def compare(module) do
    json_path = Path.join(@schemas_root, module.schema_source())

    case File.read(json_path) do
      {:error, reason} ->
        ["#{inspect(module)}: cannot read #{json_path}: #{inspect(reason)}"]

      {:ok, body} ->
        json = Jason.decode!(body)
        compare_loaded(module, json, json_path)
    end
  end

  defp compare_loaded(module, json, json_path) do
    json_props =
      json
      |> Map.get("properties", %{})
      |> Map.keys()
      |> Enum.map(&String.to_atom/1)
      |> MapSet.new()

    json_required = json |> Map.get("required", []) |> Enum.map(&String.to_atom/1) |> MapSet.new()

    elixir_fields = (module.required_fields() ++ module.optional_fields()) |> MapSet.new()
    elixir_required = module.required_fields() |> MapSet.new()

    diffs = []

    diffs =
      diff(json_props, elixir_fields, "properties")
      |> case do
        [] -> diffs
        msgs -> diffs ++ Enum.map(msgs, &"#{inspect(module)} (#{json_path}): #{&1}")
      end

    diffs =
      diff(json_required, elixir_required, "required")
      |> case do
        [] -> diffs
        msgs -> diffs ++ Enum.map(msgs, &"#{inspect(module)} (#{json_path}): #{&1}")
      end

    diffs
  end

  defp diff(json_set, elixir_set, label) do
    only_json = MapSet.difference(json_set, elixir_set)
    only_elixir = MapSet.difference(elixir_set, json_set)

    msgs = []

    msgs =
      if MapSet.size(only_json) > 0,
        do: msgs ++ ["#{label}: in JSON but not in Ecto: #{inspect(MapSet.to_list(only_json))}"],
        else: msgs

    msgs =
      if MapSet.size(only_elixir) > 0,
        do:
          msgs ++ ["#{label}: in Ecto but not in JSON: #{inspect(MapSet.to_list(only_elixir))}"],
        else: msgs

    msgs
  end
end
