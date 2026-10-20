defmodule NovelAgent.Provider.SystemIdentityGuardTest do
  use ExUnit.Case, async: true

  @root Path.expand("../../../../..", __DIR__)

  @forbidden ~r/你是[^\n]*(小说创作系统|长篇小说写作台|小说创作 AI)/u

  test "所有 lib 调用点不得再自述产品身份（I-SYS-2）" do
    offenders =
      @root
      |> Path.join("apps/*/lib/**/*.ex")
      |> Path.wildcard()
      |> Enum.flat_map(fn file ->
        file
        |> File.stream!()
        |> Enum.with_index(1)
        |> Enum.filter(fn {line, _number} -> Regex.match?(@forbidden, line) end)
        |> Enum.map(fn {line, number} ->
          "#{Path.relative_to(file, @root)}:#{number}: #{String.trim(line)}"
        end)
      end)

    assert offenders == [],
           "发现调用点自述产品身份，应改为“本次你承担…的角色”并让身份层唯一负责产品前提：\n" <>
             Enum.join(offenders, "\n")
  end
end
