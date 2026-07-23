defmodule NovelApplication.FactInventoryServiceTest do
  @moduledoc """
  VS-00G CP4b：设定盘点提炼引擎（确定性可测；真实提炼 live 已验证）。
  """
  use ExUnit.Case, async: true

  alias NovelAgent.Provider.Execution
  alias NovelApplication.FactInventoryService, as: Inventory

  defp provider(fun), do: %Execution{result_fn: fun}

  defp materials do
    [
      %{seq: 1, title: "底层灵气账单", prose: "沈砚发现灵气被公司暗抽。"},
      %{seq: 2, title: "旧服务器里的残诀", prose: "残诀《碎影》可将灵气与代码绑定。"}
    ]
  end

  defp valid_proposal_json do
    Jason.encode!(%{
      "characters" => [
        %{"name" => "沈砚", "narrative_role" => "PROTAGONIST", "summary" => "稽查官", "basis" => "第1章"}
      ],
      "world_rules" => [%{"rule" => "灵气按频段计费", "basis" => "第1章"}],
      "foreshadowings" => [%{"content" => "残诀缺后半", "basis" => "第2章"}]
    })
  end

  test "材料+确定性 provider → 结构化提案（角色/规则/伏笔）" do
    {:ok, proposal} =
      Inventory.inventory(materials(), provider(fn _p -> {:ok, %{content: valid_proposal_json()}} end))

    assert [%{"name" => "沈砚", "narrative_role" => "PROTAGONIST"}] = proposal.characters
    assert [%{"rule" => "灵气按频段计费"}] = proposal.world_rules
    assert length(proposal.foreshadowings) == 1
  end

  test "提炼 prompt 含材料正文与结构化输出契约" do
    prompt = Inventory.inventory_prompt(Inventory.build_material_text(materials()), 2)
    assert prompt =~ "设定盘点助手"
    assert prompt =~ "第1章 底层灵气账单"
    assert prompt =~ "残诀《碎影》"
    assert prompt =~ "narrative_role"
    assert prompt =~ "只返回 JSON"
  end

  test "坏 JSON 携带片段重试一次；重试产合法 JSON → 成功" do
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn prompt ->
      n = Agent.get_and_update(counter, &{&1, &1 + 1})

      if n == 0 do
        assert prompt =~ "设定盘点助手"
        {:ok, %{content: ~s({"characters": [{"name": 沈砚}]})}}
      else
        assert prompt =~ "上一次的输出不是合法 JSON"
        {:ok, %{content: valid_proposal_json()}}
      end
    end

    {:ok, proposal} = Inventory.inventory(materials(), provider(result_fn))
    assert length(proposal.characters) == 1
    assert Agent.get(counter, & &1) == 2
  end

  test "重试后仍坏 → 报错（不无限重试）" do
    {:error, _} =
      Inventory.inventory(materials(), provider(fn _p -> {:ok, %{content: "not json at all"}} end))
  end

  test "provider 缺失 → 诚实报错" do
    {:error, :provider_execution_missing} = Inventory.inventory(materials(), %Execution{})
  end

  test "parse_proposal：缺字段补空列表、宽松抽 JSON" do
    {:ok, p} = Inventory.parse_proposal(~s(前言 {"characters": [{"name": "甲"}]} 尾巴))
    assert length(p.characters) == 1
    assert p.world_rules == []
    assert p.foreshadowings == []
  end
end
