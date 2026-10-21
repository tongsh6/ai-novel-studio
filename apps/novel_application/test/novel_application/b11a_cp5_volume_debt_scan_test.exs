defmodule NovelApplication.B11ACp5VolumeDebtScanTest do
  @moduledoc """
  B11A CP5（VS-00J §4 item5 / §9 决策④）：卷结构设计负债规则接入对账 scan。

  - R10 `volume_plan_mismatch`：works.planned_volumes（意图）vs volumes 行数（事实）；
  - R11 `volume_blueprint_missing`：多卷逐卷检查 design-state blueprint；
  - 可选 `volumes` 读端口缺席/抛错 → 诚实跳过，不阻断 scan（旧 deps 兼容）。
  """
  use ExUnit.Case, async: true

  alias NovelApplication.LedgerReconciliationService

  defp deps(opts) do
    volumes = Keyword.get(opts, :volumes, [])
    profile = Keyword.get(opts, :profile, %{})

    base = %{
      entries: fn _work_id -> [] end,
      summaries: fn _work_id -> [] end,
      roster: fn _work_id -> [] end,
      profile: fn _work_id -> profile end
    }

    case Keyword.fetch(opts, :volumes_reader) do
      {:ok, reader} -> Map.put(base, :volumes, reader)
      :error -> Map.put(base, :volumes, fn _work_id -> volumes end)
    end
  end

  defp blueprint, do: %{"goal_conflict" => "夺回矿脉", "status" => "CONFIRMED"}

  test "计划卷数 ≠ 事实卷数 + 多卷缺蓝图 → 两条 design_debt finding，counts 正确" do
    volumes = [
      %{title: "第一卷·觉醒", seq: 1, blueprint: blueprint()},
      %{title: "第二卷·裂变", seq: 2, blueprint: nil}
    ]

    assert {:ok, %{findings: findings, counts: counts}} =
             LedgerReconciliationService.scan(
               "work-cp5-1",
               deps(profile: %{planned_volumes: 3}, volumes: volumes)
             )

    assert counts == %{"volume_plan_mismatch" => 1, "volume_blueprint_missing" => 1}

    mismatch = Enum.find(findings, &(&1.rule == "volume_plan_mismatch"))
    assert mismatch.ledger == "design_debt"
    assert mismatch.signal =~ "立项计划 3 卷，实际已建 2 卷"
    assert mismatch.source_refs == ["work:planned_volumes=3", "volumes:actual=2"]

    missing = Enum.find(findings, &(&1.rule == "volume_blueprint_missing"))
    assert missing.source_refs == ["volume:第二卷·裂变"]
    assert missing.proposed_disposition == "revise_design"
  end

  test "无偏离不制造空报告：计划=事实且每卷有蓝图 → findings 为空" do
    volumes = [
      %{title: "第一卷", seq: 1, blueprint: blueprint()},
      %{title: "第二卷", seq: 2, blueprint: %{"arc_stage" => "由忍到争"}}
    ]

    assert {:ok, %{findings: [], counts: %{}}} =
             LedgerReconciliationService.scan(
               "work-cp5-2",
               deps(profile: %{planned_volumes: 2}, volumes: volumes)
             )
  end

  test "单卷书：不判蓝图缺失；计划卷数与事实一致 → 无 finding" do
    volumes = [%{title: "第一卷", seq: 1, blueprint: nil}]

    assert {:ok, %{findings: []}} =
             LedgerReconciliationService.scan(
               "work-cp5-3",
               deps(profile: %{planned_volumes: 1}, volumes: volumes)
             )
  end

  test "planned_volumes 未立（nil）→ 不判 R10；多卷缺蓝图仍逐卷提示" do
    volumes = [
      %{title: "第一卷", seq: 1, blueprint: nil},
      %{title: "第二卷", seq: 2, blueprint: nil}
    ]

    assert {:ok, %{findings: findings, counts: counts}} =
             LedgerReconciliationService.scan(
               "work-cp5-4",
               deps(profile: %{}, volumes: volumes)
             )

    assert counts == %{"volume_blueprint_missing" => 2}
    assert Enum.map(findings, & &1.source_refs) == [["volume:第一卷"], ["volume:第二卷"]]
  end

  test "volumes 读端口缺席 → 卷规则诚实跳过，scan 不阻断（旧 deps 兼容）" do
    deps = deps(profile: %{planned_volumes: 3}) |> Map.delete(:volumes)

    assert {:ok, %{findings: [], counts: %{}}} =
             LedgerReconciliationService.scan("work-cp5-5", deps)
  end

  test "volumes 读端口抛错 → 诚实跳过不阻断 scan（不得阻断）" do
    deps =
      deps(
        profile: %{planned_volumes: 3},
        volumes_reader: fn _work_id -> raise "db down" end
      )

    assert {:ok, %{findings: [], counts: %{}}} =
             LedgerReconciliationService.scan("work-cp5-6", deps)
  end

  test "生产端口装配 volumes reader（TOC 卷节点）" do
    deps = LedgerReconciliationService.persistence_deps()
    assert is_function(deps[:volumes], 1)
    # 其余既有端口保持在场（装配未回归）
    assert is_function(deps[:entries], 1)
    assert is_function(deps[:profile], 1)
  end
end
