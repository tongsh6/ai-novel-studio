defmodule AdrTrace do
  @moduledoc """
  ADR ↔ 实装 traceability **门禁**（B13a）。

  正向：每个 Accepted ADR 必须有 `## enforced_by` 段，列出落实该决策的
  代码文件 / 测试 / 验收场景 / schema / 前端文件。脚本逐条检查引用存在。

  失败条件（exit 1）：
  - Accepted ADR 缺少 `## enforced_by` 段；
  - `## enforced_by` 段没有任何有效引用；
  - 引用路径不存在。

  非 Accepted ADR（Proposed / Superseded / Deferred）不参与本门禁——
  未冻结的决策不能被要求实装。

  `enforced_by` 内允许 `- pending: <说明>` 行申明已知缺口（不计入引用）；
  缺口解释也可写在 `## enforcement_gaps` 段（自由文本，不解析）。
  """

  @adr_dir "docs/design/adr"
  @adr_glob "ADR-????-*.md"

  def run do
    adr_files = list_adr_files()

    if adr_files == [] do
      IO.puts("❌ ADR traceability: no ADR files found under #{@adr_dir} with #{@adr_glob}")
      System.halt(1)
    end

    results = Enum.map(adr_files, &check_adr/1)
    accepted_results = Enum.filter(results, &(&1.status == :accepted))
    skipped_results = Enum.reject(results, &(&1.status == :accepted))

    missing = Enum.filter(accepted_results, &(&1.verdict == :missing_enforced_by))
    empty = Enum.filter(accepted_results, &(&1.verdict == :empty_enforced_by))
    broken = Enum.filter(accepted_results, &(&1.verdict == :broken_ref))

    with_enforced = Enum.count(accepted_results, &(&1.verdict == :ok))
    total_refs = accepted_results |> Enum.map(&length(&1.refs)) |> Enum.sum()
    pending_refs = accepted_results |> Enum.map(&length(&1.pending_refs)) |> Enum.sum()

    cond do
      missing != [] ->
        report("❌", "Accepted ADR(s) missing ## enforced_by", missing)
        IO.puts("")
        IO.puts("每个 Accepted ADR 必须用 `## enforced_by` 列出真正落实它的代码/测试/验收文件。")
        System.halt(1)

      empty != [] ->
        report("❌", "Accepted ADR(s) with empty ## enforced_by", empty)

        IO.puts(
          "`## enforced_by` 至少需要一条存在的引用；已知缺口请用 `- pending: ...` 或 `## enforcement_gaps` 申明。"
        )

        System.halt(1)

      broken != [] ->
        report("❌", "ADR(s) with broken enforced_by references", broken)
        IO.puts("引用的文件/目录不存在：要么补实现，要么修正或降级为 `- pending: ...`。")
        System.halt(1)

      true ->
        IO.puts(
          "✅ ADR traceability: #{with_enforced}/#{length(accepted_results)} Accepted ADR(s) with valid enforced_by " <>
            "(#{total_refs} refs, #{pending_refs} pending)"
        )

        if skipped_results != [] do
          names = skipped_results |> Enum.map(& &1.adr) |> Enum.join(", ")
          IO.puts("ℹ️  Skipped non-Accepted ADR(s): #{names}")
        end

        System.halt(0)
    end
  end

  defp report(marker, title, results) do
    IO.puts("#{marker} ADR traceability: #{title}")

    Enum.each(results, fn result ->
      case result.verdict do
        :broken_ref -> IO.puts("  - #{result.adr}: #{inspect(result.broken)}")
        _ -> IO.puts("  - #{result.adr}")
      end
    end)
  end

  defp list_adr_files do
    Path.wildcard("#{@adr_dir}/#{@adr_glob}")
    |> Enum.reject(&String.contains?(&1, "README"))
    |> Enum.sort()
  end

  defp check_adr(path) do
    content = File.read!(path)
    adr_name = Path.basename(path, ".md")
    status = extract_status(content)

    if status == :accepted do
      case extract_enforced_by(content) do
        :missing ->
          %{adr: adr_name, status: status, verdict: :missing_enforced_by, refs: [], pending_refs: []}

        {:ok, refs, pending_refs} ->
          broken = Enum.reject(refs, &ref_exists?/1)

          %{
            adr: adr_name,
            status: status,
            verdict: classify(refs, broken),
            refs: refs,
            pending_refs: pending_refs,
            broken: broken
          }
      end
    else
      %{adr: adr_name, status: status, verdict: :skipped, refs: [], pending_refs: []}
    end
  end

  defp classify([], _broken), do: :empty_enforced_by
  defp classify(_refs, []), do: :ok
  defp classify(_refs, _broken), do: :broken_ref

  # ----- status -----

  defp extract_status(content) do
    case Regex.run(~r/^-\s*状态[:：]\s*(.+)$/mu, content) do
      [_, raw] ->
        normalized =
          raw
          |> String.replace("*", "")
          |> String.split(~r/[（(]/u, parts: 2)
          |> hd()
          |> String.trim()

        cond do
          String.starts_with?(normalized, "Accepted") -> :accepted
          String.starts_with?(normalized, "Proposed") -> :proposed
          String.starts_with?(normalized, "Superseded") -> :superseded
          String.starts_with?(normalized, "Deferred") -> :deferred
          true -> :unknown
        end

      nil ->
        :unknown
    end
  end

  # ----- enforced_by extraction -----

  defp extract_enforced_by(content) do
    case Regex.run(~r/^##\s+enforced_by\s*$\n(.*?)(?=^##\s|\z)/ms, content) do
      [_, section] ->
        {refs, pending_refs} = parse_enforced_by_section(section)

        if refs == [] and pending_refs == [],
          do: :missing,
          else: {:ok, Enum.uniq(refs), pending_refs}

      nil ->
        :missing
    end
  end

  defp parse_enforced_by_section(section) do
    section
    |> String.split("\n")
    |> Enum.map(&String.trim/1)
    |> Enum.filter(&String.starts_with?(&1, ["- ", "* "]))
    |> Enum.map(&String.replace(&1, ~r/^[-*]\s+/, ""))
    |> Enum.map(&String.trim/1)
    |> Enum.reject(&(&1 == ""))
    |> Enum.map(fn entry -> String.trim(entry, "`") end)
    |> Enum.reduce({[], []}, fn entry, {refs, pending} ->
      case extract_ref(entry) do
        nil -> {refs, [entry | pending]}
        ref -> {[ref | refs], pending}
      end
    end)
    |> then(fn {refs, pending} -> {Enum.reverse(refs), Enum.reverse(pending)} end)
  end

  defp extract_ref(entry) do
    cond do
      # Mix task whitelist: "mix codegen.enums"
      String.starts_with?(entry, "mix ") ->
        entry

      true ->
        # Backtick extraction: `apps/foo/bar.ex`
        case Regex.run(~r/`([^`]+)`/, entry) do
          [_, ref] ->
            ref

          nil ->
            # First whitespace-delimited token that looks like a path/module
            entry
            |> String.split(~r/\s+/, trim: true)
            |> Enum.find(nil, fn token ->
              String.contains?(token, "/") or
                String.match?(token, ~r/^[A-Z][A-Za-z0-9_.]+$/)
            end)
        end
    end
  end

  # ----- reference existence -----

  defp ref_exists?(ref) do
    cond do
      String.starts_with?(ref, "mix ") ->
        true

      # Directory paths end with "/"
      String.ends_with?(ref, "/") ->
        File.exists?(ref)

      # Any concrete repository-relative path
      String.contains?(ref, "/") ->
        File.exists?(ref)

      # Module name → snake_case file path (may live inside parent module file)
      String.match?(ref, ~r/^[A-Z][A-Za-z0-9_.]*$/) ->
        module_exists?(ref)

      true ->
        false
    end
  end

  defp module_exists?(module_name) do
    underscored = Macro.underscore(module_name)

    if Path.wildcard("apps/*/lib/#{underscored}.ex") != [] do
      true
    else
      parent = module_name |> String.split(".") |> Enum.drop(-1) |> Enum.join(".")
      parent_path = "apps/*/lib/#{Macro.underscore(parent)}.ex"
      Path.wildcard(parent_path) != []
    end
  end
end

AdrTrace.run()
