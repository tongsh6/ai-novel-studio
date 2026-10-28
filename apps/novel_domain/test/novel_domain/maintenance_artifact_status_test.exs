defmodule NovelDomain.MaintenanceArtifactStatusTest do
  use ExUnit.Case, async: true

  alias NovelDomain.AdoptionStatus
  alias NovelDomain.MaintenanceArtifactStatus

  describe "通用 adoption 矩阵不变（ADR-0019 一字不改）" do
    test "TENTATIVE→SUPERSEDED 在通用矩阵仍非法" do
      refute AdoptionStatus.transition_allowed?("TENTATIVE", "SUPERSEDED")
    end

    test "维护类策略不放松任何通用矩阵之外的转换" do
      # 仅维护类替换一条被追加；其余非矩阵转换仍拒。
      for {from, to} <- [
            {"TENTATIVE", "ARCHIVED"},
            {"SUPERSEDED", "ACCEPTED"},
            {"DISCARDED", "ACCEPTED"},
            {"ARCHIVED", "ACCEPTED"},
            {"ACCEPTED", "TENTATIVE"},
            {"BOGUS", "ACCEPTED"},
            {"ACCEPTED", "BOGUS"}
          ] do
        refute MaintenanceArtifactStatus.transition_allowed?(from, to)
      end
    end
  end

  describe "维护类替换 replacement_allowed?/2" do
    test "只声明 TENTATIVE → SUPERSEDED（新版替代旧版、旧版留史）" do
      assert MaintenanceArtifactStatus.replacement_allowed?("TENTATIVE", "SUPERSEDED")
    end

    test "替换规则不作用于其它 from/to 组合" do
      refute MaintenanceArtifactStatus.replacement_allowed?("TENTATIVE", "ACCEPTED")
      refute MaintenanceArtifactStatus.replacement_allowed?("ACCEPTED", "SUPERSEDED")
      refute MaintenanceArtifactStatus.replacement_allowed?("SUPERSEDED", "TENTATIVE")
      refute MaintenanceArtifactStatus.replacement_allowed?("TENTATIVE", "ARCHIVED")
      refute MaintenanceArtifactStatus.replacement_allowed?(nil, "SUPERSEDED")
    end

    test "replacement_transitions/0 是 canonical 单条，供审计/测试" do
      assert MaintenanceArtifactStatus.replacement_transitions() == %{
               "TENTATIVE" => ["SUPERSEDED"]
             }
    end
  end

  describe "统一入口 transition_allowed?/2" do
    test "通用矩阵合法转换仍合法（采纳/退场/复活/自反）" do
      for {from, to} <- [
            {"TENTATIVE", "ACCEPTED"},
            {"TENTATIVE", "DISCARDED"},
            {"ACCEPTED", "SUPERSEDED"},
            {"ACCEPTED", "ARCHIVED"},
            {"SUPERSEDED", "TENTATIVE"},
            {"TENTATIVE", "TENTATIVE"}
          ] do
        assert MaintenanceArtifactStatus.transition_allowed?(from, to)
      end
    end

    test "维护类替换被统一入口放行" do
      assert MaintenanceArtifactStatus.transition_allowed?("TENTATIVE", "SUPERSEDED")
    end

    test "未知/缺失状态仍拒" do
      refute MaintenanceArtifactStatus.transition_allowed?("BOGUS", "SUPERSEDED")
      refute MaintenanceArtifactStatus.transition_allowed?("TENTATIVE", "BOGUS")
      refute MaintenanceArtifactStatus.transition_allowed?(nil, "SUPERSEDED")
      refute MaintenanceArtifactStatus.transition_allowed?("TENTATIVE", nil)
    end
  end
end
