defmodule NovelDomain.CapabilityFactManifestTest do
  @moduledoc "VS-00G CP1：承重事实完备性判定（纯函数，机械查现状快照）。"
  use ExUnit.Case, async: true

  alias NovelDomain.AbsenceDirective
  alias NovelDomain.CapabilityFactManifest, as: Manifest

  test "prose_writing 主角为 required 事实（E07）" do
    facts = Manifest.facts("prose_writing")
    assert Enum.any?(facts, &(&1.element == :protagonist and &1.tier == :required))
    assert Enum.find(facts, &(&1.element == :protagonist)).element_ref == "E07"
  end

  test "roster 无 PROTAGONIST → 主角缺失" do
    snapshot = %{roster: [%{name: "沈砚", narrative_role: "SUPPORTING"}, %{name: "白露"}]}
    missing = Manifest.evaluate_presence("prose_writing", snapshot)
    assert Enum.any?(missing, &(&1.element == :protagonist))
  end

  test "roster 含 PROTAGONIST → 主角在场（不缺失）" do
    snapshot = %{roster: [%{name: "沈砚", narrative_role: "PROTAGONIST"}]}
    assert Manifest.evaluate_presence("prose_writing", snapshot) == []
  end

  test "字符串 key 的 narrative_role 也识别（provider map 兼容）" do
    snapshot = %{roster: [%{"name" => "沈砚", "narrative_role" => "PROTAGONIST"}]}
    assert Manifest.evaluate_presence("prose_writing", snapshot) == []
  end

  test "快照缺 roster 数据源 → 诚实缺席（不假定在场）" do
    assert Manifest.evaluate_presence("prose_writing", %{}) != []
  end

  test "未登记能力 → 无承重事实、无缺失" do
    assert Manifest.facts("world_building") == []
    assert Manifest.evaluate_presence("world_building", %{roster: []}) == []
  end

  test "缺席守则从缺失清单渲染（含守则的才产文本）" do
    missing = Manifest.evaluate_presence("prose_writing", %{roster: []})
    # D1：真空态（roster 显式为空）换真空守则 key；缺数据源维持原 key
    assert Enum.any?(missing, &(&1.absence_directive == :protagonist_missing_vacuum))

    unmarked = Manifest.evaluate_presence("prose_writing", %{roster: [%{name: "甲"}]})
    assert Enum.any?(unmarked, &(&1.absence_directive == :protagonist_missing))

    no_source = Manifest.evaluate_presence("prose_writing", %{})
    assert Enum.any?(no_source, &(&1.absence_directive == :protagonist_missing))
    assert NovelDomain.AbsenceDirective.directive(:protagonist_missing_vacuum) =~ "取用稳定的具体名字"

    text = AbsenceDirective.render(missing)
    assert text =~ "承重事实缺席提示"
    # D1：真空清单渲染真空守则（取名指令），不再是死锁令
    assert text =~ "尚无任何角色档案"
    assert text =~ "取用稳定的具体名字"
    refute text =~ "不得另立新主角"

    assert AbsenceDirective.render(unmarked) =~ "不得另立新主角"
  end

  test "缺席守则：无缺失或无守则时空段" do
    assert AbsenceDirective.render([]) == ""
    assert AbsenceDirective.render([%{absence_directive: nil}]) == ""
  end
end
