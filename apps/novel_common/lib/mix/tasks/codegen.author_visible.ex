defmodule Mix.Tasks.Codegen.AuthorVisible do
  @moduledoc """
  Generate `NovelCommon.AuthorVisible.DisplayNames` from the author-visible
  display-name SSOT under `docs/design/schemas/author_visible/display_names.json`.

  输出模块写入 `apps/novel_common/lib/novel_common/author_visible/display_names_gen.ex`，
  文件头标记 AUTO-GENERATED。前端半由 `frontend/scripts/codegen-author-visible.mjs`
  生成同一份 SSOT 的 TS 产物。

  Fail-closed（生成期）：
  - SSOT 结构/兜底文案校验；
  - `enum_sources` 声明的每个 enum 值必须在对应 display 域登记（缺项 → raise）；
  - 生成物带同一 `source_hash`；`--check` 同时比对本模块与前端 TS 生成物的 hash。

  运行：`mix codegen.author_visible`；漂移检查：`mix codegen.author_visible --check`
  （root `mix check` alias 已包含）。
  """

  use Mix.Task

  @shortdoc "Generate author-visible display-name module from JSON SSOT"

  @module "NovelCommon.AuthorVisible.DisplayNames"

  @forbidden_keys [
    "allow",
    "protocol_codes",
    "internal_terms_zh",
    "internal_identifiers",
    "ref_patterns"
  ]

  defp ssot_relative, do: "docs/design/schemas/author_visible/display_names.json"

  defp ssot_path, do: Path.join(File.cwd!(), ssot_relative())

  defp schemas_root, do: Path.join(File.cwd!(), "docs/design/schemas")

  defp output_path do
    Path.join(
      File.cwd!(),
      "apps/novel_common/lib/novel_common/author_visible/display_names_gen.ex"
    )
  end

  defp frontend_ts_path do
    Path.join(File.cwd!(), "frontend/src/generated/author_visible/displayNames.ts")
  end

  @impl Mix.Task
  def run(args) do
    {opts, _, _} = OptionParser.parse(args, switches: [check: :boolean])

    ssot = ssot_path() |> File.read!() |> Jason.decode!()
    validate!(ssot)
    rendered = render(ssot)

    if Keyword.get(opts, :check, false) do
      check!(rendered)
    else
      File.mkdir_p!(Path.dirname(output_path()))
      File.write!(output_path(), rendered)
      Mix.shell().info("codegen.author_visible: wrote #{relative(output_path())}")
    end
  end

  defp check!(rendered) do
    drifts =
      [current_drift(rendered), frontend_hash_drift()]
      |> Enum.reject(&is_nil/1)

    if drifts == [] do
      Mix.shell().info("codegen.author_visible: in sync")
    else
      Mix.shell().error("author-visible display-name codegen drift:")
      Enum.each(drifts, &Mix.shell().error("  - #{&1}"))

      Mix.raise("author-visible display names out of sync — run `mix codegen.author_visible`")
    end
  end

  defp current_drift(rendered) do
    path = output_path()

    cond do
      not File.exists?(path) ->
        "#{relative(path)}: missing"

      File.read!(path) != rendered ->
        "#{relative(path)}: out of sync with #{ssot_relative()}"

      true ->
        nil
    end
  end

  # 双端 codegen 一致性：前端 TS 生成物必须带同一 SSOT hash。
  defp frontend_hash_drift do
    path = frontend_ts_path()

    if File.exists?(path) do
      check_frontend_hash(File.read!(path))
    else
      "#{relative(path)}: missing (run `pnpm codegen:author-visible`)"
    end
  end

  defp check_frontend_hash(content) do
    case Regex.run(~r/SOURCE_HASH = "([0-9a-f]{64})"/, content) do
      [_, hash] ->
        if hash == source_hash(),
          do: nil,
          else: "frontend generated hash mismatch (run `pnpm codegen:author-visible`)"

      _no_hash ->
        "#{relative(frontend_ts_path())}: SOURCE_HASH 缺失或格式不合法"
    end
  end

  # ── 校验 ──────────────────────────────────────────────────────────────

  defp validate!(ssot) do
    domains = Map.fetch!(ssot, "domains")
    fallbacks = Map.get(ssot, "fallbacks", %{})

    Enum.each(domains, &validate_domain!(&1, fallbacks))
    validate_enum_sources!(ssot, domains)
  end

  defp validate_domain!({name, entries}, fallbacks) do
    unless is_map(entries) and map_size(entries) > 0 do
      Mix.raise("display domain #{name} 必须是非空对象")
    end

    fallback = fallbacks[name]

    unless is_binary(fallback) and String.trim(fallback) != "" do
      Mix.raise("display domain #{name} 缺少 author-safe fallback 文案")
    end

    Enum.each(entries, fn {_code, label} -> ensure_non_empty_label!(name, label) end)
  end

  defp ensure_non_empty_label!(domain, label) do
    unless is_binary(label) and String.trim(label) != "" do
      Mix.raise("display domain #{domain} 存在空显示名")
    end
  end

  defp validate_enum_sources!(ssot, domains) do
    ssot
    |> Map.get("enum_sources", %{})
    |> Enum.each(fn {domain, files} ->
      entries = Map.get(domains, domain) || Mix.raise("enum_sources.#{domain} 对应 display 域不存在")
      Enum.each(files, &validate_enum_file!(domain, entries, &1))
    end)
  end

  defp validate_enum_file!(domain, entries, rel) do
    enum_path = Path.join(schemas_root(), rel)
    enum = enum_path |> File.read!() |> Jason.decode!()

    Enum.each(Map.fetch!(enum, "enum"), fn value ->
      unless Map.has_key?(entries, value) do
        Mix.raise(
          "enum 值 #{value}（来自 #{rel}）未在 display_names.json 的 domains.#{domain} 登记"
        )
      end
    end)
  end

  # ── 渲染 ──────────────────────────────────────────────────────────────

  defp render(ssot) do
    domains = Map.fetch!(ssot, "domains")
    fallbacks = Map.get(ssot, "fallbacks", %{})
    forbidden = Map.get(ssot, "forbidden_tokens", %{})

    domain_names = domains |> Map.keys() |> Enum.sort()

    rendered_domains =
      Enum.map_join(domain_names, ",\n", fn name ->
        entries = Map.fetch!(domains, name)
        codes = entries |> Map.keys() |> Enum.sort()

        body =
          Enum.map_join(codes, ",\n", fn code ->
            "      #{inspect(code)} => #{inspect(Map.fetch!(entries, code))}"
          end)

        "    #{inspect(name)} => %{\n#{body}\n    }"
      end)

    rendered_fallbacks =
      Enum.map_join(domain_names, ",\n", fn name ->
        "    #{inspect(name)} => #{inspect(Map.fetch!(fallbacks, name))}"
      end)

    rendered_forbidden =
      forbidden
      |> Map.take(@forbidden_keys)
      |> Enum.sort_by(fn {key, _values} -> key end)
      |> Enum.map_join(",\n", fn {key, values} ->
        "      #{inspect(key)} => #{inspect(List.wrap(values))}"
      end)

    """
    # AUTO-GENERATED FROM #{ssot_relative()} — DO NOT EDIT.
    # Run `mix codegen.author_visible` to regenerate; `mix codegen.author_visible --check` detects drift.
    defmodule #{@module} do
      @moduledoc \"\"\"
      作者可见展示名生成数据（来源 `#{ssot_relative()}`）。

      只允许通过 `NovelCommon.AuthorVisible.Display` 查询；作者可见面不得直接使用内部 code。
      \"\"\"

      @source_hash #{inspect(source_hash())}

      @domains %{
    #{rendered_domains}
      }

      @fallbacks %{
    #{rendered_fallbacks}
      }

      @forbidden_tokens %{
    #{rendered_forbidden}
      }

      @doc "SSOT 内容哈希；前后端生成物必须一致。"
      @spec source_hash() :: String.t()
      def source_hash, do: @source_hash

      @spec domains() :: %{String.t() => %{String.t() => String.t()}}
      def domains, do: @domains

      @spec fallbacks() :: %{String.t() => String.t()}
      def fallbacks, do: @fallbacks

      @spec forbidden_tokens() :: %{String.t() => [String.t()]}
      def forbidden_tokens, do: @forbidden_tokens
    end
    """
    |> Code.format_string!()
    |> IO.iodata_to_binary()
    |> Kernel.<>("\n")
  end

  defp source_hash do
    ssot_path()
    |> File.read!()
    |> then(&:crypto.hash(:sha256, &1))
    |> Base.encode16(case: :lower)
  end

  defp relative(path), do: Path.relative_to(path, File.cwd!())
end
