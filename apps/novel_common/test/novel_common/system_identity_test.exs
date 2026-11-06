defmodule NovelCommon.SystemIdentityTest do
  use ExUnit.Case, async: true

  alias NovelCommon.SystemIdentity

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
end
