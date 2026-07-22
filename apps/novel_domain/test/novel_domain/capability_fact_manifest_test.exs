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
    text = AbsenceDirective.render(missing)
    assert text =~ "承重事实缺席提示"
    assert text =~ "尚未确立主角档案"
    assert text =~ "不得另立新主角"
  end

  test "缺席守则：无缺失或无守则时空段" do
    assert AbsenceDirective.render([]) == ""
    assert AbsenceDirective.render([%{absence_directive: nil}]) == ""
  end
end
