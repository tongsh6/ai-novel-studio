# VS-00G CP2 百章标本重放验证（标本只验不标定）
#
# 验证靶（契约 §7 CP2）：百章标本（characters=0）经真实对账扫描 → R5 主角未物化
# finding 产出。用真实 LedgerReconciliationService.scan + 持久化端口读百章标本现状，
# 证明"该建未建"型负债被审读机制主动揪出（M3 弧光线结构性失明的检测层修复）。
#
# 用法：NOVEL_TEST_DB_DIR=tmp/dogfood-db MIX_TEST_PARTITION=_dogfood \
#       PHX_SERVER=false MIX_ENV=test mix run scripts/vs00g_cp2_replay.exs <work_id>

alias NovelApplication.LedgerReconciliationService

work_id = System.argv() |> List.first() || raise "需要 work_id 参数"

{:ok, %{findings: findings, counts: counts}} =
  LedgerReconciliationService.scan(work_id, LedgerReconciliationService.persistence_deps())

IO.puts("== VS-00G CP2 百章标本重放（真实对账扫描）==")
IO.puts("work_id=#{work_id}")
IO.puts("偏离项总数=#{length(findings)}")
IO.puts("规则分布=#{inspect(counts)}")

r5 = Enum.find(findings, &(&1.rule == "protagonist_undermaterialized"))

if r5 do
  IO.puts("\nR5 主角未物化 finding：")
  IO.puts("  ledger=#{r5.ledger} severity=#{r5.severity} disposition=#{r5.proposed_disposition}")
  IO.puts("  source_refs=#{inspect(r5.source_refs)}")
  IO.puts("  signal=#{r5.signal}")
  IO.puts("\n[PASS] 百章零角色标本 → R5 主角未物化被对账扫描揪出（弧光线失明检测层修复生效）")
else
  IO.puts("\n[FAIL] 未产 R5 主角未物化 finding（标本 characters=0 应触发）")
  System.halt(1)
end
