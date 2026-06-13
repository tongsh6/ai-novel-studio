defmodule ArchCheck do
  @moduledoc """
  架构门禁脚本。

  检查每个 umbrella app 是否使用了其层禁止的模块/模式。
  设计文档依据：AGENTS.md §架构约束；docs/design/README.md §写作规则。

  用法：mix run scripts/arch_check.exs
  """

  # ---- 禁止规则 ----

  @foundation_forbidden [
    # novel_foundation 是 Shared Kernel，不能包含任何运行时或业务概念
    ~r/NovelFoundation.*(?:GenServer|DynamicSupervisor|Supervisor|Registry)/,
    ~r/NovelFoundation\.(?:Agent|Author|Workspace|Work|Chapter|Novel)(?:\.|$)/,
    ~r/NovelFoundation.*(?:Ecto|Phoenix|Repo|Provider)/,
  ]

  @domain_forbidden [
    # novel_domain 是纯领域模型，不能有副作用或基础设施依赖
    ~r/use Application/,
    ~r/Ecto\./,
    ~r/Phoenix\./,
    ~r/Repo\./,
    ~r/GenServer/,
    ~r/Supervisor\.start_link/,
    ~r/DynamicSupervisor/,
    ~r/Registry\./,
    ~r/HTTPoison|Req\.|Finch/,
  ]

  @agent_forbidden [
    # novel_agent 是业务无关的 Agent Runtime，不能依赖小说业务
    ~r/NovelDomain\./,
    ~r/NovelApplication\./,
  ]

  @web_forbidden [
    # novel_web 是薄网关，不能直接碰数据库和 Agent 运行时内部
    ~r/Ecto\.Query/,
    ~r/NovelPersistence\.Repo/,
    ~r/NovelPersistence\.Schemas\./,
    ~r/NovelAgent\.Runtime\./,
    ~r/NovelAgent\.(?:Turn|Router|Executor|Registry|Memory|Provider)\./,
  ]

  @app_rules %{
    "novel_foundation" => @foundation_forbidden,
    "novel_domain" => @domain_forbidden,
    "novel_agent" => @agent_forbidden,
    "novel_web" => @web_forbidden,
  }

  def run do
    errors = []

    errors =
      Enum.reduce(@app_rules, errors, fn {app, rules}, acc ->
        pattern = "apps/#{app}/lib/**/*.ex"
        files = Path.wildcard(pattern)

        file_errors =
          Enum.flat_map(files, fn file ->
            content = File.read!(file)

            Enum.flat_map(rules, fn rule ->
              if Regex.match?(rule, content) do
                ["[#{app}] #{file}: 匹配到禁止模式 #{inspect(rule)}"]
              else
                []
              end
            end)
          end)

        acc ++ file_errors
      end)

    # 循环依赖检查
    {cycle_output, cycle_status} =
      System.cmd("mix", [
        "xref",
        "graph",
        "--format",
        "cycles",
        "--label",
        "compile-connected",
        "--fail-above",
        "0"
      ])

    cycle_errors =
      if cycle_status != 0, do: ["CYCLE DETECTED:\n#{cycle_output}"], else: []

    # ── novel_e2e 边界检查 ──
    # E2E 只允许引用 novel_web 模块和 novel_application 的公开入口（DialogueGateway, ReplayService）
    e2e_forbidden = [
      ~r/NovelPersistence\./,
      ~r/NovelAgent\./,
      ~r/NovelApplication\.(?!DialogueGateway\b|ReplayService\b)/,
      ~r/Ecto\.Adapters\.SQL\.Sandbox/,
    ]

    e2e_errors =
      if File.dir?("apps/novel_e2e") do
        e2e_files =
          Path.wildcard("apps/novel_e2e/lib/**/*.ex") ++
            Path.wildcard("apps/novel_e2e/test/**/*.exs")

        Enum.flat_map(e2e_files, fn file ->
          content = File.read!(file)

          Enum.flat_map(e2e_forbidden, fn rule ->
            if Regex.match?(rule, content) do
              ["[novel_e2e] #{file}: 禁止直接引用 #{inspect(rule)}"]
            else
              []
            end
          end)
        end)
      else
        []
      end

    errors = errors ++ cycle_errors ++ e2e_errors

    if errors == [] do
      IO.puts("✅ 架构检查通过")
      System.halt(0)
    else
      IO.puts("❌ 架构违规:\n")
      Enum.each(errors, &IO.puts("  - #{&1}"))
      IO.puts("\n共 #{length(errors)} 项违规")
      System.halt(1)
    end
  end
end

ArchCheck.run()
