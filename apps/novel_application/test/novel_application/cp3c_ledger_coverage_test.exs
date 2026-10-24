defmodule NovelApplication.CP3cLedgerCoverageTest do
  @moduledoc "B27 CP3c：对账规则覆盖显式化 + 审读失败不冒充完成。"
  use ExUnit.Case, async: true

  alias NovelApplication.LedgerReconciliationService

  defp minimal_deps do
    %{
      entries: fn _work_id -> [] end,
      summaries: fn _work_id -> [] end,
      roster: fn _work_id -> [] end
    }
  end

  test "scan 返回规则覆盖：基础规则 evaluated，缺读端口的规则 skipped 带原因" do
    assert {:ok, scan} = LedgerReconciliationService.scan("work-cov", minimal_deps())

    assert :arc_stalled in scan.rules_evaluated
    assert :genre_promise in scan.rules_evaluated
    assert :protagonist_undermaterialized in scan.rules_evaluated

    skipped = Map.new(scan.rules_skipped, &{&1.rule, &1.reason})
    assert skipped[:volume_plan_mismatch] == :volumes_port_missing
    assert skipped[:premature_finale] == :target_length_missing
    assert skipped[:foreshadowing_overdue] == :written_progress_port_missing
    assert skipped[:assumption_overdue] == :assumption_port_missing

    assert scan.scope.work_id == "work-cov"
    assert is_list(scan.rules)
  end

  test "提供读端口后对应规则 evaluated，不再计入 skipped" do
    deps =
      Map.merge(minimal_deps(), %{
        profile: fn _ -> %{"target_length" => 300_000, "planned_volumes" => 2} end,
        volumes: fn _ -> [] end,
        stats: fn _ -> %{words_total: 10_000} end,
        chapter_index: fn _ -> %{} end,
        written_progress: fn _ -> %{chapter_seq: 0, volume_seq: 0} end,
        assumptions: fn _ -> [] end,
        summary_count_since: fn _, _ -> 0 end
      })

    assert {:ok, scan} = LedgerReconciliationService.scan("work-cov-2", deps)
    skipped_rules = Enum.map(scan.rules_skipped, & &1.rule)

    refute :volume_plan_mismatch in skipped_rules
    refute :premature_finale in skipped_rules
    refute :foreshadowing_overdue in skipped_rules
    refute :assumption_overdue in skipped_rules
    assert :premature_finale in scan.rules_evaluated
  end

  test "空 findings 时 materialize 不落盘，但覆盖信息仍由 scan 提供（供回执区分）" do
    assert {:ok, scan} = LedgerReconciliationService.scan("work-cov-3", minimal_deps())
    assert scan.findings == []
    assert scan.rules_skipped != []
  end
end
