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
    # novel_web 是薄网关，不能直接碰数据库和 Agent 运行时内部。
    # NovelPersistence 的 Repo/Schema 之外，Repo wrapper（如 AgentRunLog）同样是
    # 持久层内部；Web 只能经 Application 公开入口读取。
    ~r/Ecto\.Query/,
    ~r/NovelPersistence\./,
    ~r/NovelAgent\.Runtime\./,
    ~r/NovelAgent\.(?:Turn|Router|Executor|Registry|Memory|Provider)\./,
  ]

  @common_forbidden [
    # novel_common 是跨 app 纯契约/纯规则层（B27 CP3 边界）：只依赖 novel_foundation，
    # 不得引用其他生产 app 或测试辅助 app 的模块。文档/注释也不写具体模块名，
    # 用「Provider 执行边界」这类文字描述。
    ~r/Novel(?:Agent|Application|Domain|Persistence|Web|Test|E2E)\.[A-Z]/,
    # ADR-0034（2026-11-08 作者裁决 C）：日志运行时迁往 novel_telemetry 后，
    # 纯契约层不得再出现文件 I/O / 异步写出 / 进程副作用。
    ~r/\b(?:File\.(?:read|read!|write|write!|mkdir_p|mkdir_p!|exists\?|rm|rm_rf|open)|:file\.|Task\.(?:start|async)|GenServer\.|Supervisor\.start_link)/,
  ]

  @telemetry_forbidden [
    # novel_telemetry 是可观测性运行时 app（ADR-0034）：只做日志 I/O 与关联协议，
    # 不得引用任何业务 app、持久层或 Web 框架，也不引入长驻进程状态。
    ~r/Novel(?:Agent|Application|Domain|Persistence|Web|Test|E2E)\.[A-Z]/,
    ~r/\bEcto\.|Repo\.|Phoenix\.|GenServer\.(?:start_link|call|cast|start)\(|Supervisor\.start_link\(|Registry\./,
  ]

  @test_helper_forbidden [
    # novel_test 只承载跨 app 测试 helper（NovelTest.TestRequestIR/TestProviderPrompt）：
    # 不得依赖任何生产运行时 app，避免 helper 反向拉入运行时。
    ~r/Novel(?:Agent|Application|Domain|Persistence|Web|E2E)\.[A-Z]/,
  ]

  # 生产 lib 不得引用测试 helper app（AGENTS.md「novel_test 不被生产代码依赖」）。
  @prod_lib_forbidden [
    ~r/NovelTest\.[A-Z]/,
  ]

  # 跨 app 测试引用 novel_agent test/support 行为替身的白名单：替身依赖 agent 运行时
  # 实现，不能迁 novel_test（会形成 compile 环），只允许已登记的精确模块，禁止扩散。
  # 依据 AGENTS.md 场景化验收红线：替身只位于 test/support，且只能测试/脚本环境显式注入。
  @cross_app_test_support %{
    "novel_application" => [
      "NovelAgent.Test.Provider.SliceVerify",
      "NovelAgent.Provider.Stub"
    ],
    "novel_web" => ["NovelAgent.Provider.Stub"],
    "novel_e2e" => []
  }

  @test_support_markers [
    "NovelAgent.Test.Provider.SliceVerify",
    "NovelAgent.Provider.StubChapterSummary",
    "NovelAgent.Provider.Stub",
    "NovelAgent.Provider.PendingDialogueInput",
    "NovelAgent.Test.Support.",
    "NovelAgent.Test.WireToolFacts",
    "NovelAgent.TestProviderPrompt",
    "NovelAgent.TestRequestIR"
  ]

  @app_rules %{
    "novel_foundation" => @foundation_forbidden,
    "novel_domain" => @domain_forbidden,
    "novel_agent" => @agent_forbidden,
    "novel_common" => @common_forbidden,
    "novel_telemetry" => @telemetry_forbidden,
    "novel_test" => @test_helper_forbidden,
    "novel_web" => @web_forbidden,
  }

  def run do
    errors = []

    errors =
      Enum.reduce(@app_rules, errors, fn {app, rules}, acc ->
        pattern = "apps/#{app}/lib/**/*.ex"

        # `lib/mix/tasks/*` 是构建期任务（如 codegen 生成器），不在运行时边界内。
        files = Path.wildcard(pattern) |> Enum.reject(&String.contains?(&1, "/mix/tasks/"))

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

    # ── 生产 lib 不得引用测试 helper app ──
    prod_test_helper_errors =
      Path.wildcard("apps/*")
      |> Enum.reject(&(&1 == "apps/novel_test"))
      |> Enum.flat_map(fn app_dir ->
        app = Path.basename(app_dir)

        Enum.flat_map(Path.wildcard("#{app_dir}/lib/**/*.ex"), fn file ->
          content = File.read!(file)

          Enum.flat_map(@prod_lib_forbidden, fn rule ->
            if Regex.match?(rule, content) do
              ["[#{app}] #{file}: 生产代码禁止引用测试 helper #{inspect(rule)}"]
            else
              []
            end
          end)
        end)
      end)

    # ── 跨 app 测试引用 novel_agent test/support 行为替身：只允许白名单 ──
    cross_app_test_errors =
      Enum.flat_map(@cross_app_test_support, fn {app, allowed} ->
        app_dir = "apps/#{app}/test"

        if File.dir?(app_dir) do
          allowed_patterns =
            allowed
            |> Enum.map(fn marker -> Regex.compile!("\\b" <> Regex.escape(marker) <> "\\b") end)

          Enum.flat_map(Path.wildcard("#{app_dir}/**/*.exs"), fn file ->
            content = File.read!(file)

            Enum.flat_map(@test_support_markers, fn marker ->
              pattern = Regex.compile!("\\b" <> Regex.escape(marker) <> "\\b")

              if Regex.match?(pattern, content) and
                   not Enum.any?(allowed_patterns, &Regex.match?(&1, content)) do
                [
                  "[#{app}] #{file}: 跨 app 引用未登记的 agent test/support 模块 #{marker}"
                ]
              else
                []
              end
            end)
          end)
        else
          []
        end
      end)

    errors = errors ++ cycle_errors ++ e2e_errors ++ prod_test_helper_errors ++ cross_app_test_errors

    if errors == [] do
      IO.puts("✅ 架构检查通过")
      # 2026-11-07：成功时不再 System.halt(0)，否则在 `mix check` alias 中会
      # 截断后续门禁命令（adr_trace / I-CACHE 曾因此未执行）。失败仍 halt(1)。
      :ok
    else
      IO.puts("❌ 架构违规:\n")
      Enum.each(errors, &IO.puts("  - #{&1}"))
      IO.puts("\n共 #{length(errors)} 项违规")
      System.halt(1)
    end
  end
end

ArchCheck.run()
