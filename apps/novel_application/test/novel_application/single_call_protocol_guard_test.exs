defmodule NovelApplication.SingleCallProtocolGuardTest do
  use ExUnit.Case, async: true

  # B26 CP2：判断/计划协议只有单调用 `tool_choice: "auto"`，两段式实现已删除。
  # 行为级守卫见 scripts/model_contracts/single_call_compliance.exs；本测试是静态
  # 源码守卫，防止旧构造（前置叙事调用 / 无 tools 叙事段 prompt / none 强制关闭）回流。
  @root Path.expand("../../../..", __DIR__)

  @forbidden ~r/request_narrative\s*\(|narrative_fn|draft_reasoning_prompt\s*\(|revision_reasoning_prompt\s*\(|tool_choice:\s*"none"/

  test "生产 lib 不再构造旧两段式判断/计划协议" do
    files = @root |> Path.join("apps/*/lib/**/*.ex") |> Path.wildcard()
    assert length(files) > 50, "源码守卫扫描路径失效：#{@root}"

    offenders =
      files
      |> Enum.flat_map(fn file ->
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

    assert offenders == [],
           "生产 lib 发现旧两段式协议构造（唯一协议为单调用 tool_choice: \"auto\"）：\n" <>
             Enum.join(offenders, "\n")
  end
end
