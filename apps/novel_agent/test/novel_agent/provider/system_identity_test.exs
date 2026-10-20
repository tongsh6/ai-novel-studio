defmodule NovelAgent.Provider.SystemIdentityTest do
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.SystemIdentity

  test "身份文本是唯一产品前提，不含输出格式/语言/角色名" do
    content = SystemIdentity.content()

    assert content =~ "AI Novel Studio"
    assert content =~ "长篇小说创作工作台"
    assert content =~ "作者是唯一裁决者"
    assert content =~ "待确认材料"
    assert content =~ "材料缺失时如实说明"
    assert content =~ "角色与任务由后续消息给出"

    refute content =~ "JSON"
    refute content =~ "markdown"
    refute content =~ "输出语言"
    refute content =~ "判断器"
    refute content =~ "起草器"
  end

  test "identity ref 稳定且 hash 由文本机械派生" do
    expected_hash =
      :crypto.hash(:sha256, SystemIdentity.content())
      |> Base.encode16(case: :lower)

    assert SystemIdentity.version() == "sys-identity-v1"
    assert SystemIdentity.content_hash() == expected_hash

    assert SystemIdentity.identity_ref() == %{
             version: "sys-identity-v1",
             content_hash: expected_hash
           }
  end

  test "inject 对 binary/list/map 都只在首位注入一条 system 消息" do
    {binary_prompt, ref} = SystemIdentity.inject("hello")

    assert [system, %{role: "user", content: "hello"}] = binary_prompt
    assert system.role == "system"
    assert system.content == SystemIdentity.content()
    assert ref == SystemIdentity.identity_ref()

    {list_prompt, _} = SystemIdentity.inject([%{role: "user", content: "hello"}])
    assert [system, %{role: "user", content: "hello"}] = list_prompt
    assert system.content == SystemIdentity.content()

    {map_prompt, _} =
      SystemIdentity.inject(%{
        messages: [%{role: "user", content: "hello"}],
        tools: [%{name: "tool"}]
      })

    assert [system, %{role: "user", content: "hello"}] = map_prompt.messages
    assert system.content == SystemIdentity.content()
    assert map_prompt.tools == [%{name: "tool"}]
  end

  test "重复 inject 幂等，识别依据是 metadata 不是 content 前缀" do
    {once, _} = SystemIdentity.inject("hello")
    {twice, _} = SystemIdentity.inject(once)

    assert twice == once
    assert Enum.count(twice, &SystemIdentity.identity_message?/1) == 1

    {map_once, _} =
      SystemIdentity.inject(%{"messages" => [%{"role" => "user", "content" => "hello"}]})

    {map_twice, _} = SystemIdentity.inject(map_once)

    assert map_twice == map_once
  end

  test "identity_message? 只看 metadata 标记" do
    [system | _] = elem(SystemIdentity.inject("hello"), 0)

    assert SystemIdentity.identity_message?(system)

    refute SystemIdentity.identity_message?(%{
             role: "system",
             content: SystemIdentity.content()
           })

    refute SystemIdentity.identity_message?(%{role: "user", content: "hello"})
  end

  test "不支持的 prompt 形态原样返回，ref 为 nil" do
    assert {123, nil} = SystemIdentity.inject(123)
  end
end
