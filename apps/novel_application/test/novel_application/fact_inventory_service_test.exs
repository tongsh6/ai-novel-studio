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

  # VS00F 刀④ CP3：回收提案解析分组 + 核对段注入（模型只提议、作者采纳落账）。
  test "foreshadowing_resolution 提案解析进独立分组并成独立 artifact set" do
    json =
      Jason.encode!([
        %{
          "artifact_type" => "foreshadowing_resolution",
          "item_id" => "res-1",
          "title" => "矿区旧账",
          "body" => "第7章中旧账编号被当面兑现。",
          "rationale" => "依据第7章",
          "resolution_target" => "foreshadow_m1",
          "resolved_at_seq" => 7
        }
      ])

    {:ok, proposal} =
      Inventory.inventory(materials(), provider(fn _p -> {:ok, %{content: json}} end))

    assert [item] = proposal.foreshadowing_resolutions
    assert item.resolution_target == "foreshadow_m1"
    assert item.resolved_at_seq == 7

    sets =
      Inventory.artifact_sets(proposal, %{
        source_turn_ref: "turn-1",
        source_tool_result_ref: "tr-1"
      })

    assert [%{artifact_type: :foreshadowing_resolution, items: [_]}] = sets
  end

  test "未回收伏笔核对段注入账面引用；无未回收时无该段" do
    prompt =
      Inventory.inventory_prompt("正文", 2, [], [], [
        %{ref: "foreshadow_m1", label: "伏笔：矿区旧账"}
      ])

    assert prompt =~ "## 未回收伏笔核对"
    assert prompt =~ "[foreshadow_m1] 伏笔：矿区旧账"
    assert prompt =~ "foreshadowing_resolution"
    refute Inventory.inventory_prompt("正文", 2) =~ "未回收伏笔核对"
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

  # ── VS-00G CP4d：全书规划字段建议 ──────────────────────

  defp skeleton_item_json(field, value) do
    %{
      "artifact_type" => "work_skeleton_suggestion",
      "item_id" => "skeleton_#{field}",
      "title" => "目标体量",
      "body" => "按已写节奏推断建议值 #{value}",
      "rationale" => "依据前2章体量",
      "skeleton_field" => field,
      "skeleton_value" => value
    }
  end

  # 同名角色（M4 实锤）：盘点材料只有正文时，模型看不到档案已有谁，每次都把
  # 已在档角色当新发现重提，采纳后堆重复行。已在档名单进 prompt 消除该重复源。
  test "已在档角色进 prompt 并明示不要重复提案" do
    prompt = Inventory.inventory_prompt("正文", 2, [], ["沈洛", "云栖"])

    assert prompt =~ "已登记的角色"
    assert prompt =~ "沈洛、云栖"
    assert prompt =~ "不要再作为新角色提案"
  end

  test "无已在档角色时 prompt 不出现该段（空档案首盘不加噪声）" do
    prompt = Inventory.inventory_prompt("正文", 2, [], [])
    refute prompt =~ "已登记的角色"
  end

  test "已在档名单去空白去重，接受字符串与角色 map 两种形状" do
    {:ok, agent} = Agent.start_link(fn -> nil end)

    {:ok, _} =
      Inventory.inventory(
        materials(),
        provider(fn p ->
          Agent.update(agent, fn _ -> p end)
          {:ok, %{content: valid_proposal_json()}}
        end),
        known_characters: [" 沈洛 ", %{name: "沈洛"}, %{"name" => "云栖"}, "", nil]
      )

    prompt = Agent.get(agent, & &1)
    assert prompt =~ "沈洛、云栖"
  end

  test "CP4d：缺位字段时 prompt 才含全书规划指令段，且只列缺位字段" do
    prompt_with =
      Inventory.inventory_prompt("正文", 2, ["target_length", "serial_form"])

    assert prompt_with =~ "work_skeleton_suggestion"
    assert prompt_with =~ "target_length"
    assert prompt_with =~ "serial_form"
    refute prompt_with =~ "planned_volumes：预计卷数"

    prompt_without = Inventory.inventory_prompt("正文", 2, [])
    refute prompt_without =~ "work_skeleton_suggestion"
  end

  test "CP4d：解析全书规划建议——结构化槽位保留，字符串数值收敛为正整数" do
    json = Jason.encode!([skeleton_item_json("target_length", "300000")])

    {:ok, proposal} = Inventory.parse_proposal(json)

    assert [item] = proposal.skeleton_suggestions
    assert item.skeleton_field == "target_length"
    assert item.skeleton_value == 300_000
    assert item.title == "目标体量"
  end

  test "CP4d：全书规划建议缺合法槽位 → 坏输出（走重试而非静默丢弃）" do
    missing_slot =
      Jason.encode!([Map.drop(skeleton_item_json("target_length", 300_000), ["skeleton_value"])])

    assert {:error, :invalid_skeleton_suggestion} = Inventory.parse_proposal(missing_slot)

    bad_field = Jason.encode!([skeleton_item_json("premise", "文本")])
    assert {:error, :invalid_skeleton_suggestion} = Inventory.parse_proposal(bad_field)
  end

  test "CP4d：artifact_sets 含 work_skeleton_suggestion 集，item 槽位不改写" do
    json =
      Jason.encode!([
        skeleton_item_json("serial_form", "连载"),
        %{
          "artifact_type" => "character_seed",
          "item_id" => "c1",
          "title" => "甲",
          "body" => "档案",
          "rationale" => nil
        }
      ])

    {:ok, proposal} = Inventory.parse_proposal(json)

    sets =
      Inventory.artifact_sets(proposal, %{
        source_turn_ref: "turn-inventory",
        source_tool_result_ref: "tr-inventory"
      })

    assert Enum.map(sets, & &1.artifact_type) == [:character_seed, :work_skeleton_suggestion]

    skeleton_set = Enum.find(sets, &(&1.artifact_type == :work_skeleton_suggestion))
    assert [item] = skeleton_set.items
    assert item.skeleton_field == "serial_form"
    assert item.skeleton_value == "连载"
  end
end
