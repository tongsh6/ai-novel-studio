# VS-00G CP1 百章标本重放验证（标本只验不标定）
#
# 验证靶（契约 §7 CP1）：空 roster 书的 prose 请求 → 主角缺席守则注入。
# 用真实 WorkArchiveRepo.characters 读端口读百章标本现状（characters=0），走真实
# CapabilityFactManifest + AbsenceDirective，证明"真实数据现状 → CP1 机制触发"。
#
# 用法：NOVEL_TEST_DB_DIR=tmp/dogfood-db MIX_TEST_PARTITION=_dogfood \
#       PHX_SERVER=false MIX_ENV=test mix run scripts/vs00g_cp1_replay.exs <work_id>

alias NovelDomain.AbsenceDirective
alias NovelDomain.CapabilityFactManifest, as: Manifest
alias NovelPersistence.WorkArchiveRepo

work_id = System.argv() |> List.first() || raise "需要 work_id 参数"

# 真实读端口（CP1 前就是"只读 accepted"）——百章标本零采纳角色 → 空 roster。
roster = WorkArchiveRepo.characters(work_id)
snapshot = %{roster: roster}

missing = Manifest.evaluate_presence("prose_writing", snapshot)
directive = AbsenceDirective.render(missing)

IO.puts("== VS-00G CP1 百章标本重放 ==")
IO.puts("work_id=#{work_id}")
IO.puts("真实 roster 角色数=#{length(roster)}")
IO.puts("PROTAGONIST 数=#{Enum.count(roster, &(Map.get(&1, :narrative_role) == "PROTAGONIST"))}")
IO.puts("承重事实缺失=#{inspect(Enum.map(missing, & &1.element))}")
IO.puts("缺席守则段：\n#{directive}")

# 断言：地基真空标本必触发主角缺席守则
protagonist_missing? = Enum.any?(missing, &(&1.element == :protagonist))
directive_present? = directive =~ "尚未确立主角档案"

if protagonist_missing? and directive_present? do
  IO.puts("\n[PASS] 空 roster 标本 → 主角缺席守则注入（M3 地基真空病例产品级下药生效）")
else
  IO.puts("\n[FAIL] protagonist_missing=#{protagonist_missing?} directive=#{directive_present?}")
  System.halt(1)
end
