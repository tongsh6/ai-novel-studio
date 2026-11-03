defmodule CheckSingleCallProtocol do
  @moduledoc """
  单调用协议源码守卫（B26 CP2，L2 静态门禁）。

  生产 lib 不得再出现旧两段式判断/计划协议构造（前置叙事调用、无 tools 的叙事段
  prompt、`tool_choice: "none"` 强制关闭）。唯一允许协议是单调用 `tool_choice: "auto"`。

  行为级守卫见 `scripts/model_contracts/single_call_compliance.exs`；本脚本只做静态
  源码扫描。2026-11-04 从
  `apps/novel_application/test/novel_application/single_call_protocol_guard_test.exs`
  迁出：该测试每次 `mix test` 都要全量扫描 `apps/*/lib`（实测约 2.45s），属 L2 静态
  门禁职责，不应占用测试套件墙钟。

  用法：mix run scripts/check_single_call_protocol.exs
  """

  @root Path.expand("..", __DIR__)

  @forbidden ~r/request_narrative\s*\(|narrative_fn|draft_reasoning_prompt\s*\(|revision_reasoning_prompt\s*\(|tool_choice:\s*"none"/

  def run do
    files = @root |> Path.join("apps/*/lib/**/*.ex") |> Path.wildcard()

    if length(files) <= 50 do
      IO.puts(:stderr, "❌ 源码守卫扫描路径失效：#{@root}（只找到 #{length(files)} 个文件）")
      System.halt(1)
    end

    offenders =
      Enum.flat_map(files, fn file ->
        file
        |> File.stream!()
        |> Enum.with_index(1)
        |> Enum.reject(fn {line, _number} ->
          line |> String.trim() |> String.starts_with?("#")
        end)
        |> Enum.filter(fn {line, _number} -> Regex.match?(@forbidden, line) end)
        |> Enum.map(fn {line, number} ->
          "#{Path.relative_to(file, @root)}:#{number}: #{String.trim(line)}"
        end)
      end)

    case offenders do
      [] ->
        IO.puts("✅ 单调用协议源码守卫通过（扫描 #{length(files)} 个文件）")
        System.halt(0)

      _ ->
        IO.puts(
          :stderr,
          "❌ 生产 lib 发现旧两段式协议构造（唯一协议为单调用 tool_choice: \"auto\"）：\n"
        )

        Enum.each(offenders, &IO.puts(:stderr, "  - #{&1}"))
        System.halt(1)
    end
  end
end

CheckSingleCallProtocol.run()
