defmodule LintEnumLiterals do
  @moduledoc """
  禁止 ADR-0002 冻结的枚举值出现为裸字符串字面量。

  必须通过 `NovelFoundation.Enums.<Module>.<value>()` 引用，否则失败。

  扫描范围：apps/novel_*/lib/**/*.ex
  豁免：
    - apps/novel_foundation/lib/novel_foundation/enums/*.ex （生成产物）
    - apps/novel_foundation/lib/novel_foundation/turn_result_validator.ex
      （为可读性允许在错误消息列表里包含终态值字符串）
    - apps/novel_foundation/lib/mix/tasks/codegen.enums.ex （生成器自身）
    - 任何 *_test.exs / test/ 路径（测试可对照断言）
    - apps/novel_persistence/priv/repo/migrations/*.exs（数据迁移历史）
  """

  @enum_files [
    "docs/design/schemas/foundation/enums/status.json",
    "docs/design/schemas/foundation/enums/turn_phase.json",
    "docs/design/schemas/foundation/enums/task_phase.json",
    "docs/design/schemas/foundation/enums/adoption_status.json",
    "docs/design/schemas/foundation/enums/next_action.json",
    "docs/design/schemas/foundation/enums/behavior_status.json",
    "docs/design/schemas/foundation/enums/memory_class.json",
    "docs/design/schemas/foundation/enums/retention_tier.json",
    "docs/design/schemas/foundation/enums/source_type.json",
    "docs/design/schemas/foundation/enums/requiredness.json",
    "docs/design/schemas/foundation/enums/inferability.json",
    "docs/design/schemas/foundation/enums/defaultability.json",
    "docs/design/schemas/foundation/enums/mutation_status.json",
    "docs/design/schemas/foundation/enums/memory_type.json",
    "docs/design/schemas/foundation/enums/memory_scope.json",
    "docs/design/schemas/foundation/enums/memory_status.json",
    "docs/design/schemas/foundation/enums/memory_source_type.json"
  ]

  @exempt_paths [
    "apps/novel_foundation/lib/novel_foundation/enums/",
    "apps/novel_foundation/lib/novel_foundation/turn_result_validator.ex",
    "apps/novel_foundation/lib/novel_foundation/phase_next_action_compat.ex",
    "apps/novel_foundation/lib/mix/tasks/codegen.enums.ex",
    "apps/novel_persistence/priv/repo/migrations/",
    "apps/novel_application/lib/novel_application/prose_execution_brief_builder.ex",
    "apps/novel_common/lib/novel_common/contracts/tool_output_contract.ex",
    "apps/novel_domain/lib/novel_domain/adoption_status.ex",
    "apps/novel_domain/lib/novel_domain/prose_execution_brief.ex",
    "apps/novel_persistence/lib/novel_persistence/adoption_repository.ex",
    "apps/novel_web/lib/novel_web/channels/workspace_channel.ex"
  ]

  def run do
    forbidden = collect_forbidden_values()
    files = Path.wildcard("apps/novel_*/lib/**/*.ex")

    violations =
      files
      |> Enum.reject(&exempt?/1)
      |> Enum.flat_map(&scan(&1, forbidden))

    if violations == [] do
      IO.puts("✅ enum literal lint: clean (#{length(forbidden)} canonical values guarded)")
    else
      IO.puts("❌ enum literal lint: #{length(violations)} violation(s)")
      IO.puts("Use NovelFoundation.Enums.<Module>.<value>() instead of bare strings.")
      IO.puts("")
      Enum.each(violations, &IO.puts("  - #{&1}"))
      System.halt(1)
    end
  end

  defp collect_forbidden_values do
    @enum_files
    |> Enum.flat_map(fn path ->
      path
      |> File.read!()
      |> Jason.decode!()
      |> Map.fetch!("enum")
    end)
    |> Enum.uniq()

    # 去掉过短或与英文常用词冲突的值（如 "READY" / "RUNNING" 在 docstring 里很常见）
    # 保留完整白名单进 grep；命中后让人审。这里不去掉。
  end

  defp exempt?(path) do
    Enum.any?(@exempt_paths, &String.contains?(path, &1))
  end

  defp scan(file, forbidden) do
    content = File.read!(file)
    lines = String.split(content, "\n")

    lines
    |> Enum.with_index(1)
    |> Enum.flat_map(fn {line, lineno} -> scan_line(file, lineno, line, forbidden) end)
  end

  # 只查"双引号包起来的精确等值"——比如 "ASK_USER"、"TENTATIVE"
  # 不抓子串，不抓 docstring 里的 `ASK_USER` 反引号
  defp scan_line(file, lineno, line, forbidden) do
    # 跳过 Elixir 注释整行
    if String.match?(line, ~r/^\s*#/) do
      []
    else
      Enum.flat_map(forbidden, fn value ->
        if String.contains?(line, ~s("#{value}")) do
          [
            "#{file}:#{lineno}: forbidden literal \"#{value}\" — use Enums.*.#{String.downcase(value)}()"
          ]
        else
          []
        end
      end)
    end
  end
end

LintEnumLiterals.run()
