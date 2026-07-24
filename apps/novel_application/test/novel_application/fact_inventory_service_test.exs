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
    Jason.encode!([
      %{
        "artifact_type" => "character_seed",
        "item_id" => "char-shenyan",
        "title" => "沈砚",
        "body" => "稽查官",
        "rationale" => "依据第1章",
        "narrative_role" => "PROTAGONIST"
      },
      %{
        "artifact_type" => "world_rule_seed",
        "item_id" => "rule-frequency",
        "title" => "灵气频段计费",
        "body" => "灵气按频段计费",
        "rationale" => "依据第1章"
      },
      %{
        "artifact_type" => "foreshadowing_seed",
        "item_id" => "foreshadow-manual",
        "title" => "残诀后半",
        "body" => "残诀缺后半",
        "rationale" => "依据第2章"
      }
    ])
  end

  test "材料+确定性 provider → 结构化提案（角色/规则/伏笔）" do
    {:ok, proposal} =
      Inventory.inventory(
        materials(),
        provider(fn _p -> {:ok, %{content: valid_proposal_json()}} end)
      )

    assert [%{title: "沈砚", narrative_role: "PROTAGONIST"}] = proposal.characters
    assert [%{body: "灵气按频段计费"}] = proposal.world_rules
    assert length(proposal.foreshadowings) == 1
  end

  test "Provider canonical 创作字节原样保留并挂 provider_call_ref" do
    {:ok, proposal} =
      Inventory.inventory(
        materials(),
        provider(fn _prompt ->
          {:ok, %{content: valid_proposal_json(), provider_call_ref: "pcall-inventory-1"}}
        end)
      )

    [character] = proposal.characters
    assert character.item_id == "char-shenyan"
    assert character.title == "沈砚"
    assert character.body == "稽查官"
    assert character.rationale == "依据第1章"
    assert character.provider_call_ref == "pcall-inventory-1"
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
        {:ok, %{content: ~s([{"artifact_type":"character_seed","item_id":"bad","title": 沈砚}])}}
      else
        assert prompt =~ "上一次的输出不是合法 JSON"
        {:ok, %{content: valid_proposal_json()}}
      end
    end

    {:ok, proposal} = Inventory.inventory(materials(), provider(result_fn))
    assert length(proposal.characters) == 1
    assert Agent.get(counter, & &1) == 2
  end

  test "重试成功时如实返回两次 provider 调用预算" do
    {:ok, counter} = Agent.start_link(fn -> 0 end)

    result_fn = fn _prompt ->
      n = Agent.get_and_update(counter, &{&1, &1 + 1})

      if n == 0 do
        {:ok, %{content: "not json"}}
      else
        {:ok, %{content: valid_proposal_json()}}
      end
    end

    assert {:ok, _proposal, %{provider_call_count: 2}} =
             Inventory.inventory_with_meta(materials(), provider(result_fn))
  end

  test "重试后仍坏 → 报错（不无限重试）" do
    {:error, _} =
      Inventory.inventory(
        materials(),
        provider(fn _p -> {:ok, %{content: "not json at all"}} end)
      )
  end

  test "provider 缺失 → 诚实报错" do
    {:error, :provider_execution_missing} = Inventory.inventory(materials(), %Execution{})
  end

  test "parse_proposal：按 artifact_type 分组、允许某类为空、宽松抽 JSON 数组" do
    {:ok, p} =
      Inventory.parse_proposal(
        ~s(前言 [{"artifact_type":"character_seed","item_id":"c1","title":"甲","body":"档案","rationale":null}] 尾巴)
      )

    assert length(p.characters) == 1
    assert p.world_rules == []
    assert p.foreshadowings == []
  end

  test "parse_proposal：拒绝未知 artifact_type 与空提案" do
    assert {:error, {:unsupported_inventory_artifact_type, "world_setting"}} =
             Inventory.parse_proposal(
               ~s([{"artifact_type":"world_setting","item_id":"x","title":"甲","body":"档案","rationale":null}])
             )

    assert {:error, :empty_proposal} = Inventory.parse_proposal("[]")
  end

  test "artifact_sets：按既有 seed 家族分组，canonical item 字节和 ref 不改写" do
    {:ok, proposal} =
      Inventory.parse_proposal(valid_proposal_json(), "pcall-inventory-2")

    sets =
      Inventory.artifact_sets(proposal, %{
        source_turn_ref: "turn-inventory",
        source_tool_result_ref: "tr-inventory",
        context_refs: ["work:work-inventory"]
      })

    assert Enum.map(sets, & &1.artifact_type) == [
             :character_seed,
             :world_rule_seed,
             :foreshadowing_seed
           ]

    assert Enum.all?(sets, &(&1.adoption_status == :tentative))
    assert Enum.all?(sets, &(&1.source_turn_ref == "turn-inventory"))

    [character_set | _] = sets
    assert [item] = character_set.items
    assert item.title == "沈砚"
    assert item.body == "稽查官"
    assert item.rationale == "依据第1章"
    assert item.provider_call_ref == "pcall-inventory-2"
  end
end
