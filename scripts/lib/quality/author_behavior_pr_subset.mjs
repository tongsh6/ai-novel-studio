// B70 CP3：PR 受影响子集选择器。
//
// 只做“变更路径 → 应跑哪些冻结 case/场景”的确定性映射，不判产品正确性、不改 corpus。
// 未知路径按保守策略全选（宁可多跑，不静默漏跑）。
export const PR_SUBSET_SCHEMA = "author-behavior-pr-subset/v1";

const RULE_TABLE = Object.freeze([
  { id: "corpus-assets", match: /^quality\/acceptance\/author-behavior\//u, targets: null, reason: "corpus/oracle/fixture 变更 → 全量语义子集" },
  { id: "harness", match: /^(scripts\/(author_behavior|slice_verify|lib\/quality\/author_behavior)|frontend\/slice-verify\/author-behavior)/u, targets: null, reason: "author-behavior harness/驱动变更 → 全量语义子集" },
  { id: "judgment-core", match: /^apps\/novel_application\/lib\/novel_application\/(dialogue_planning_service|judgment_protocol|context_assembler)/u, targets: null, reason: "判断/上下文核心变更 → 全量语义子集" },
  { id: "agent-runtime", match: /^apps\/novel_agent\//u, targets: null, reason: "agent/provider 变更 → 全量语义子集" },
  { id: "domain-rules", match: /^apps\/novel_domain\//u, targets: null, reason: "领域规则变更 → 全量语义子集" },
  { id: "acceptance-registry", match: /^quality\/acceptance\/(scenarios|scenarios\.yml|README)/u, targets: null, reason: "场景注册/清单变更 → 全量语义子集" },
  { id: "docs-only", match: /^(docs|tasks)\//u, targets: [], reason: "仅文档/任务变更 → 不跑页面语义子集" },
  { id: "tests-only", match: /(_test\.exs|\.test\.mjs|test\/support\/)/u, targets: [], reason: "仅测试/测试支持变更 → 交给常规门禁，不额外跑语义子集" },
]);

export function selectPrSubset({ paths, corpus }) {
  const changedPaths = [...new Set((paths ?? []).map((path) => String(path).trim()).filter(Boolean))];
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : corpus?.cases?.cases ?? [];
  const allCaseIds = cases.map((testCase) => testCase.id);
  const selected = new Set();
  const hits = [];
  const unmapped = [];

  for (const changedPath of changedPaths) {
    const rule = RULE_TABLE.find((entry) => entry.match.test(changedPath));
    if (!rule) {
      unmapped.push(changedPath);
      for (const caseId of allCaseIds) selected.add(caseId);
      continue;
    }
    hits.push({ path: changedPath, rule: rule.id, reason: rule.reason });
    if (rule.targets === null) {
      for (const caseId of allCaseIds) selected.add(caseId);
    } else if (rule.targets.length === 0) {
      continue;
    } else {
      for (const testCase of cases) {
        if (rule.targets.includes(testCase.target_id)) selected.add(testCase.id);
      }
    }
  }

  const selectedCaseIds = allCaseIds.filter((caseId) => selected.has(caseId));
  const selectedTargets = [...new Set(cases.filter((testCase) => selected.has(testCase.id)).map((testCase) => testCase.target_id))];
  const tier = selectedCaseIds.length === 0 ? "none" : selectedCaseIds.length <= 3 ? "pr-smoke" : "nightly";
  return {
    schema: PR_SUBSET_SCHEMA,
    changed_paths: changedPaths,
    rule_hits: hits,
    unmapped_paths: unmapped,
    selected_targets: selectedTargets,
    selected_cases: selectedCaseIds,
    tier,
    conservative_all: unmapped.length > 0,
    reason:
      changedPaths.length === 0
        ? "no changes"
        : unmapped.length > 0
          ? "存在未知路径 → 保守全选"
          : selectedCaseIds.length === 0
            ? "仅文档/测试变更 → 不跑页面语义子集"
            : "按规则映射",
  };
}
