defmodule NovelDomain.WorkingAssumptionTest do
  @moduledoc """
  VS-00G CP5a：工作假定策略纯函数（零新实体，既有 tentative 态 + 两标注位）。
  """
  use ExUnit.Case, async: true

  alias NovelDomain.WorkingAssumption

  defp assumption(overrides \\ %{}) do
    Map.merge(
      %{
        status: "TENTATIVE",
        provisional_source: "AI_ASSUMPTION",
        provisional_active: false,
        name: "沈砚"
      },
      overrides
    )
  end

  test "assumption?/1：tentative + AI 来源才算假定；作者候选与已转正对象都不算" do
    assert WorkingAssumption.assumption?(assumption())
    refute WorkingAssumption.assumption?(assumption(%{provisional_source: nil}))
    refute WorkingAssumption.assumption?(assumption(%{status: "ACCEPTED"}))
    refute WorkingAssumption.assumption?(assumption(%{status: "DISCARDED"}))
  end

  test "active?/1：假定且 provisional_active 才注入" do
    refute WorkingAssumption.active?(assumption())
    assert WorkingAssumption.active?(assumption(%{provisional_active: true}))
    refute WorkingAssumption.active?(assumption(%{provisional_active: true, status: "ACCEPTED"}))
  end

  test "OQ2 分级放行：required 自动激活，recommended 等作者放行" do
    assert WorkingAssumption.auto_activate?(:required)
    refute WorkingAssumption.auto_activate?(:recommended)
    refute WorkingAssumption.auto_activate?(nil)
  end

  test "激活门禁：canon 冲突一票否决（canon 优先）" do
    assert WorkingAssumption.can_activate?(assumption(), false)
    refute WorkingAssumption.can_activate?(assumption(), true)
    refute WorkingAssumption.can_activate?(assumption(%{status: "ACCEPTED"}), false)
  end

  test "同批一致性：同名候选报冲突，异名不报" do
    conflicts =
      WorkingAssumption.batch_name_conflicts([
        assumption(),
        assumption(%{name: " 沈砚 "}),
        assumption(%{name: "云栖"})
      ])

    assert conflicts == ["沈砚"]
    assert WorkingAssumption.batch_name_conflicts([assumption(), assumption(%{name: "云栖"})]) == []
  end

  test "寿命追踪：达到阈值（OQ3 默认 10 章）催办" do
    refute WorkingAssumption.expired?(9)
    assert WorkingAssumption.expired?(10)
    assert WorkingAssumption.expired?(3, 3)
  end

  test "annotate/2：【暂定】前缀 + 依据（防护①，注入期文本不落持久层）" do
    assert WorkingAssumption.annotate("主角：沈砚") == "【暂定】主角：沈砚"

    assert WorkingAssumption.annotate("主角：沈砚", "盘点自第1-2章") ==
             "【暂定】主角：沈砚（依据：盘点自第1-2章）"
  end
end
