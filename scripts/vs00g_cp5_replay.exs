# VS-00G CP5c 百章标本重放验证（标本只验不标定；零写入）
#
# 验证靶（契约 §7 CP5）：
# 1. 标本真实现状（characters=0、无假定）→ 主角缺席守则照常注入（CP1 行为不回归）；
# 2. 叠加一条内存态激活假定（模拟盘点物化产物，不写标本库）→ 在场判定翻转、
#    缺席守则让位、【暂定】标注段可渲染（三防护①）。
#
# 用法：NOVEL_TEST_DB_DIR=tmp/dogfood-db MIX_TEST_PARTITION=_dogfood \
#       PHX_SERVER=false MIX_ENV=test mix run scripts/vs00g_cp5_replay.exs <work_id>

alias NovelDomain.AbsenceDirective
alias NovelDomain.CapabilityFactManifest, as: Manifest
alias NovelDomain.WorkingAssumption
alias NovelPersistence.AssumptionRepo
alias NovelPersistence.WorkArchiveRepo

work_id = System.argv() |> List.first() || raise "需要 work_id 参数"

roster = WorkArchiveRepo.characters(work_id)
persisted_assumptions = AssumptionRepo.list_assumption_characters(work_id)

IO.puts("== VS-00G CP5c 百章标本重放 ==")
IO.puts("work_id=#{work_id}")
IO.puts("真实 roster（accepted）角色数=#{length(roster)}")
IO.puts("真实持久假定数=#{length(persisted_assumptions)}")

# 靶 1：标本真实现状 → 缺席守则照常（CP1 不回归）
missing_baseline = Manifest.evaluate_presence("prose_writing", %{roster: roster})
directive_baseline = AbsenceDirective.render(missing_baseline)

if Enum.any?(missing_baseline, &(&1.element == :protagonist)) and
     directive_baseline =~ "尚未确立主角档案" do
  IO.puts("靶1 PASS：真实现状仍触发主角缺席守则（CP1 行为保留）")
else
  IO.puts("靶1 FAIL：缺席守则未按真实现状触发")
  System.halt(1)
end

# 靶 2：叠加内存态激活假定（模拟 CP4b live 探针提炼出的主角林浩；不写标本库）
assumption = %{
  name: "林浩",
  narrative_role: "PROTAGONIST",
  summary: "百章标本正文中的核心视角人物（盘点提炼）。",
  status: "TENTATIVE",
  provisional_source: "AI_ASSUMPTION",
  provisional_active: true
}

true = WorkingAssumption.active?(assumption)

missing_with_assumption =
  Manifest.evaluate_presence("prose_writing", %{roster: roster ++ [assumption]})

annotated = WorkingAssumption.annotate("主角：#{assumption.name}——#{assumption.summary}", "设定盘点")

if Enum.all?(missing_with_assumption, &(&1.element != :protagonist)) and
     annotated =~ "【暂定】主角：林浩" do
  IO.puts("靶2 PASS：激活假定使主角在场判定翻转，【暂定】标注段可渲染")
  IO.puts("标注示例：#{annotated}")
else
  IO.puts("靶2 FAIL：假定未翻转在场判定或标注缺失")
  System.halt(1)
end

IO.puts("== CP5c 重放全部 PASS（零写入，标本未动） ==")
