defmodule NovelDomain.TentativeArtifactSetTest do
  use ExUnit.Case, async: true

  alias NovelDomain.TentativeArtifactSet

  defp set(artifact_type, items) do
    %TentativeArtifactSet{
      artifact_set_id: "as_1",
      artifact_type: artifact_type,
      items: items,
      source_turn_ref: "turn_1",
      source_tool_result_ref: "tr_1"
    }
  end

  defp item(id, title), do: %{item_id: id, title: title, body: "档案#{id}", rationale: nil}

  describe "adoptable_units/1（AU-09 角色候选逐项采纳）" do
    test "多候选 character_seed：每条候选成为独立采纳单元，artifact_id 各不相同" do
      units =
        TentativeArtifactSet.adoptable_units(
          set(:character_seed, [item("i1", "沈砚"), item("i2", "云栖")])
        )

      assert [
               %{artifact_id: "as_1::i1", item_id: "i1", items: [%{item_id: "i1"}]},
               %{artifact_id: "as_1::i2", item_id: "i2", items: [%{item_id: "i2"}]}
             ] = units

      # 每个单元只含自己的候选，互不包含。
      assert [%{item_id: "i1"}] = Enum.at(units, 0).items
      assert [%{item_id: "i2"}] = Enum.at(units, 1).items
    end

    test "单候选 character_seed：整体作为一个单元，沿用 set 级 artifact_id" do
      units = TentativeArtifactSet.adoptable_units(set(:character_seed, [item("i1", "沈砚")]))

      assert [%{artifact_id: "as_1", item_id: nil, items: [%{item_id: "i1"}]}] = units
    end

    test "多条 outline_draft 属于同一份大纲：整体一个单元，不逐项拆分" do
      units =
        TentativeArtifactSet.adoptable_units(
          set(:outline_draft, [item("c1", "第1章"), item("c2", "第2章")])
        )

      assert [%{artifact_id: "as_1", item_id: nil}] = units
      assert length(hd(units).items) == 2
    end

    test "VS-00G CP4a：设定盘点 seed 家族各类型都逐项拆分（world_rule/foreshadowing/style/constraint）" do
      for type <- [:world_rule_seed, :foreshadowing_seed, :style_rule_seed, :constraint_seed] do
        units = TentativeArtifactSet.adoptable_units(set(type, [item("i1", "甲"), item("i2", "乙")]))
        assert length(units) == 2, "#{type} 应逐项拆分"
        assert Enum.map(units, & &1.item_id) == ["i1", "i2"]
      end
    end
  end
end
