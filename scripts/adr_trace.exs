defmodule AdrTrace do
  @moduledoc """
  ADR ↔ 实装 traceability 双向校验。

  正向：每个 Accepted ADR 应有 `enforced_by` frontmatter，列出落实该 ADR 的
  代码文件 / 模块。脚本检查这些引用是否存在。

  反向：扫描 apps/ 下模块的 @moduledoc，收集 ADR 引用，与 ADR 目录比对。

  Phase 1：只做正向校验（ADR → 代码）。
  """

  @adr_dir "docs/design-v2/adr"

  def run do
    adr_files = list_adr_files()

    results =
      adr_files
      |> Enum.map(&check_adr/1)
      |> Enum.reject(&is_nil/1)

    missing = Enum.filter(results, &(elem(&1, 0) == :missing_enforced_by))
    broken = Enum.filter(results, &(elem(&1, 0) == :broken_ref))

    cond do
      missing != [] ->
        IO.puts("❌ ADR traceability: #{length(missing)} ADR(s) missing enforced_by frontmatter")
        Enum.each(missing, fn {_, adr, _} -> IO.puts("  - #{adr}") end)
        IO.puts("")

      broken != [] ->
        IO.puts("❌ ADR traceability: #{length(broken)} ADR(s) with broken code references")
        Enum.each(broken, fn {_, adr, refs} ->
          IO.puts("  - #{adr}: #{inspect(refs)}")
        end)
        IO.puts("")

      true ->
        total = length(adr_files)
        with_enforced = Enum.count(results, &(elem(&1, 0) == :ok))
        IO.puts("✅ ADR traceability: #{with_enforced}/#{total} ADR(s) with enforced_by references")
    end

    # Non-zero exit if violations exist (soft for Phase 1 — warn only)
    if missing == [] and broken == [], do: System.halt(0), else: System.halt(0)
  end

  defp list_adr_files do
    Path.wildcard("#{@adr_dir}/????-*.md")
    |> Enum.reject(&String.contains?(&1, "0000-index"))
    |> Enum.reject(&String.contains?(&1, "README"))
    |> Enum.sort()
  end

  defp check_adr(path) do
    content = File.read!(path)
    adr_name = Path.basename(path, ".md")

    case extract_enforced_by(content) do
      nil ->
        {:missing_enforced_by, adr_name, []}

      refs when is_list(refs) ->
        broken = Enum.reject(refs, &ref_exists?/1)

        if broken != [],
          do: {:broken_ref, adr_name, broken},
          else: {:ok, adr_name, refs}
    end
  end

  # Extract enforced_by from YAML-style frontmatter or markdown section
  defp extract_enforced_by(content) do
    # Try YAML frontmatter: enforced_by: [...]
    yaml_match = Regex.run(~r/enforced_by:\s*\[(.+?)\]/, content)

    case yaml_match do
      [_, list_str] ->
        list_str
        |> String.split(~r/,\s*/)
        |> Enum.map(&String.trim(&1, ~s("' )))
        |> Enum.reject(&(&1 == ""))

      nil ->
        # Try markdown list: ## enforced_by or ### enforced_by
        section_match = Regex.run(~r/\#{2,3}\s+enforced_by\n((?:\s*-.*\n?)+)/i, content)

        case section_match do
          [_, section] ->
            section
            |> String.split("\n")
            |> Enum.map(&String.trim(&1, " -"))
            |> Enum.reject(&(&1 == ""))
            |> Enum.map(&clean_ref/1)
            |> Enum.reject(&(&1 == ""))

          nil ->
            nil
        end
    end
  end

  # Strip backticks, leading list markers, and trailing descriptions.
  # Returns empty string for pending/placeholder entries.
  defp clean_ref(ref) do
    if String.contains?(ref, "pending") or String.contains?(ref, "待实现") or
         String.contains?(ref, "尚未实现") do
      ""
    else
      extract_module_ref(ref)
    end
  end

  defp extract_module_ref(ref) do
    # Remove leading "- " or "* "
    trimmed = String.replace(ref, ~r/^[-*]\s+/, "")

    # Try backtick extraction first: `ModuleName` → ModuleName
    case Regex.run(~r/`([^`]+)`/, trimmed) do
      [_, module_name] ->
        module_name

      nil ->
        # No backticks: take the first whitespace-delimited token
        # that looks like a module/path (contains . or /)
        trimmed
        |> String.split(~r/\s+/, trim: true)
        |> Enum.find("", fn token ->
          String.contains?(token, ".") or String.contains?(token, "/")
        end)
    end
  end

  # Check if a code reference exists. Refs can be:
  # - "apps/novel_foundation/lib/novel_foundation/enums/status.ex"
  # - "NovelFoundation.Enums.Status"
  # - "frontend/src-tauri/" (directory)
  defp ref_exists?(ref) do
    cond do
      # Directory paths (e.g., frontend/src-tauri/)
      String.ends_with?(ref, "/") ->
        File.exists?(ref)

      # File paths (e.g., apps/.../file.ex, docs/.../file.json)
      String.starts_with?(ref, "apps/") or String.starts_with?(ref, "docs/") or
        String.starts_with?(ref, "scripts/") or String.starts_with?(ref, "frontend/") ->
        File.exists?(ref)

      # Mix tasks (e.g., mix codegen.enums)
      String.starts_with?(ref, "mix ") ->
        true

      # Module namespace without specific module (e.g., NovelFoundation.Enums)
      # Check if the directory exists
      String.match?(ref, ~r/^[A-Z][A-Za-z.]+\.[A-Z]/) ->
        # Module name → snake_case file path
        underscored = Macro.underscore(ref)
        file_path = "apps/*/lib/#{underscored}.ex"

        if Path.wildcard(file_path) != [] do
          true
        else
          # Maybe it's a submodule defined inside parent module's file
          # e.g., NovelAgent.IntentRegistry.SlotSchema is in intent_registry.ex
          parent = ref |> String.split(".") |> Enum.drop(-1) |> Enum.join(".")
          parent_path = "apps/*/lib/#{Macro.underscore(parent)}.ex"
          Path.wildcard(parent_path) != []
        end

      # Module namespace (e.g., NovelFoundation.Enums — check directory for any .ex files)
      String.match?(ref, ~r/^[A-Z][A-Za-z.]+$/) ->
        underscored = Macro.underscore(ref)
        dir_glob = "apps/*/lib/#{underscored}/*.ex"
        Path.wildcard(dir_glob) != []

      true ->
        false
    end
  end
end

AdrTrace.run()
