// B70 CP3：失败轨迹 → 新 regression case 候选（只产候选，不自动写 corpus）。
export const PROMOTE_SCHEMA = "author-behavior-regression-promotion/v1";

export function promoteFailureToRegression({ failureTrace, corpus, existingFingerprints = [], seq = 1 }) {
  const failures = failureTrace?.exploration?.failures ?? [];
  const violations = failureTrace?.exploration?.violations ?? [];
  if (failures.length === 0) throw new Error("failure trace 没有失败步骤");
  if (violations.length === 0) {
    throw new Error("no_invariant_violation: 该失败未触发 G1–G6 硬违规（可能是 fixture 不兼容/驱动问题），不得自动转回归");
  }
  const fingerprint = failureTrace.dedupe_fingerprint;
  if (!fingerprint) throw new Error("failure trace 缺 dedupe_fingerprint");
  if (existingFingerprints.includes(fingerprint)) throw new Error(`failure 已登记: ${fingerprint}`);

  const failingCaseId = failures[0].case_id;
  const original = (corpus.cases?.cases ?? corpus.cases ?? []).find((testCase) => testCase.id === failingCaseId);
  if (!original) throw new Error(`找不到原始 case: ${failingCaseId}`);
  const violation = violations[0];

  let candidateId = `${original.id}-REG${String(seq).padStart(2, "0")}`;
  const existingIds = new Set((corpus.cases?.cases ?? corpus.cases ?? []).map((testCase) => testCase.id));
  let counter = seq;
  while (existingIds.has(candidateId)) {
    counter += 1;
    candidateId = `${original.id}-REG${String(counter).padStart(2, "0")}`;
  }

  const candidate = {
    id: candidateId,
    target_id: original.target_id,
    state_id: original.state_id,
    split: "regression",
    tier: "nightly",
    provenance: {
      kind: "derived_frozen",
      source_refs: [
        `failure:${fingerprint}`,
        `case:${original.id}`,
        `plan_hash:${failureTrace.plan_hash ?? "unknown"}`,
        `violation:${violation.behavior}`,
      ],
      frozen_at: new Date().toISOString().slice(0, 10),
    },
    expression: original.expression,
    expression_frozen: true,
    expected: structuredClone(original.expected),
    notes: `由失败缩化候选登记（保留原失败 ${fingerprint}；${violation.behavior}/${failureTrace.shrink?.preserved ?? "unknown"}）。`,
  };

  return {
    schema: PROMOTE_SCHEMA,
    fingerprint,
    preserved: failureTrace.shrink?.preserved ?? violation.behavior,
    minimal_steps: failureTrace.shrink?.minimal_steps ?? [],
    candidate,
    ledger_entry: {
      fingerprint,
      case_id: candidateId,
      original_case_id: original.id,
      violation: violation.behavior,
      plan_hash: failureTrace.plan_hash ?? null,
      promoted_at: new Date().toISOString(),
    },
  };
}
