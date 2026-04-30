defmodule Mix.Tasks.Codegen.Enums do
  @moduledoc """
  Generate `NovelFoundation.Enums.*` modules from JSON SSOT under
  `docs/design-v2/schemas/foundation/enums/`.

  Each JSON file describes one enum (string values). Output modules are
  written to `apps/novel_foundation/lib/novel_foundation/enums/<snake>.ex`
  with a header marking them auto-generated.

  Run as part of `mix check` (see root `mix.exs` aliases). Drift between
  JSON and generated module is detected by `mix codegen.enums --check`.
  """

  use Mix.Task

  @shortdoc "Generate Foundation enum modules from JSON SSOT (ADR-0002)"

  @namespace "NovelFoundation.Enums"

  defp schemas_dir,
    do: Path.join(File.cwd!(), "docs/design-v2/schemas/foundation/enums")

  defp output_dir,
    do: Path.join(File.cwd!(), "apps/novel_foundation/lib/novel_foundation/enums")

  @impl Mix.Task
  def run(args) do
    {opts, _, _} = OptionParser.parse(args, switches: [check: :boolean])
    check_only? = Keyword.get(opts, :check, false)

    File.mkdir_p!(output_dir())

    drifts =
      schemas_dir()
      |> File.ls!()
      |> Enum.filter(&String.ends_with?(&1, ".json"))
      |> Enum.sort()
      |> Enum.flat_map(&process(&1, check_only?))

    cond do
      check_only? and drifts != [] ->
        Mix.shell().error("enum codegen drift:")
        Enum.each(drifts, &Mix.shell().error("  - #{&1}"))
        Mix.raise("enums out of sync — run `mix codegen.enums`")

      check_only? ->
        Mix.shell().info("enum codegen: in sync")

      true ->
        Mix.shell().info("enum codegen: wrote #{length(File.ls!(output_dir()))} modules")
    end
  end

  defp process(filename, check_only?) do
    base = Path.rootname(filename)
    json_path = Path.join(schemas_dir(), filename)
    out_path = Path.join(output_dir(), "#{base}.ex")

    json = json_path |> File.read!() |> Jason.decode!()
    # Render with project-root-relative source path so output is reproducible
    relative_source = Path.join("docs/design-v2/schemas/foundation/enums", filename)
    rendered = render(base, json, relative_source)

    cond do
      check_only? and not File.exists?(out_path) ->
        ["#{out_path}: missing"]

      check_only? and File.read!(out_path) != rendered ->
        ["#{out_path}: out of sync with #{json_path}"]

      check_only? ->
        []

      true ->
        File.write!(out_path, rendered)
        []
    end
  end

  defp render(base, json, source) do
    module = "#{@namespace}.#{Macro.camelize(base)}"
    string_values = Map.fetch!(json, "enum")
    form = Map.get(json, "x-form", "string")
    title = Map.get(json, "title", base)
    description = Map.get(json, "description", "")
    adr = Map.get(json, "x-adr", "")
    section = Map.get(json, "x-section", "")

    {values, type, guard} =
      case form do
        "atom" ->
          atoms = Enum.map(string_values, &String.to_atom/1)
          {atoms, "atom()", "is_atom(v)"}

        "string" ->
          {string_values, "String.t()", "is_binary(v)"}

        other ->
          raise ~s(unknown x-form #{inspect(other)} in #{source}; expected "string" or "atom")
      end

    accessors =
      values
      |> Enum.map_join("\n", &"  def #{value_to_function_name(&1)}, do: #{inspect(&1)}")

    """
    # AUTO-GENERATED FROM #{source} — DO NOT EDIT.
    # Run `mix codegen.enums` to regenerate; CI runs `mix codegen.enums --check`.
    defmodule #{module} do
      @moduledoc \"\"\"
      #{title} — generated from `#{source}`.

      #{adr} #{section}

      #{description}
      \"\"\"

      @values #{inspect(values)}

      @type t :: #{type}

      @doc "All canonical values, in declaration order."
      @spec values() :: [t()]
      def values, do: @values

      @doc "Returns true if `v` is a canonical value."
      @spec valid?(any()) :: boolean()
      def valid?(v) when #{guard}, do: v in @values
      def valid?(_), do: false

    #{accessors}
    end
    """
  end

  # "WAITING_USER" -> :waiting_user; :writer -> :writer
  defp value_to_function_name(value) when is_atom(value), do: Atom.to_string(value)

  defp value_to_function_name(value) when is_binary(value) do
    value
    |> String.downcase()
    |> String.replace("-", "_")
  end
end
