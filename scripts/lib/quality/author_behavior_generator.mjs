// B70 CP1：author-behavior 离线语料生成器（确定性模板，不调用模型）。
//
// 输入 = 冻结 target/case 语料；输出 = 候选表达（带 provenance/split 建议），供人工审阅后
// 追加到 cases.yml。生成器不定义“正确性”：候选必须经 author_behavior validator 与人工冻结；
// 不允许自动把生成结果当作 PASS 或 holdout。
export const GENERATOR_VERSION = "author-behavior-template-generator/v1";

const TEMPLATE_RULES = Object.freeze({
  "F1-progress-query": [
    { suffix: "现在到哪一步了？", note: "progress-query 口语缩写" },
    { prefix: "我有点记不清了，", suffix: "现在是什么状态？", note: "progress-query 自述遗忘" },
  ],
  "F2-chapter-write-or-rewrite": [
    { prefix: "麻烦你", suffix: "接着往下写，别动前面的。", note: "write 口语请求" },
    { suffix: "从断的地方继续，其他保持不动。", note: "write 范围限制" },
  ],
  "F3-world-foreshadow-boundary": [
    { prefix: "先不急着定，", suffix: "你觉得合理吗？", note: "discussion 边界" },
    { suffix: "这个设定能聊聊吗？先别存。", note: "discussion 零写限制" },
  ],
});

function normalize(value) {
  return String(value ?? "").replace(/\s+/gu, " ").trim();
}

/**
 * 生成候选 cases（不写文件、不改 corpus）。
 *
 * @returns {{generator_version: string, candidates: Array<object>}}
 */
export function generateCaseCandidates(corpus, options = {}) {
  const seedCaseIds = Array.isArray(options.seedCaseIds) ? new Set(options.seedCaseIds) : null;
  const targets = corpus.targets?.targets ?? [];
  const cases = corpus.cases?.cases ?? [];
  const candidates = [];

  for (const target of targets) {
    const rules = TEMPLATE_RULES[target.id];
    if (!Array.isArray(rules)) continue;
    const seedCase = cases.find(
      (testCase) =>
        testCase.target_id === target.id &&
        testCase.split === "dev" &&
        (seedCaseIds === null || seedCaseIds.has(testCase.id)),
    );
    if (!seedCase) continue;

    rules.forEach((rule, index) => {
      const expression = normalize(`${rule.prefix ?? ""}${seedCase.expression}${rule.suffix ?? ""}`);
      candidates.push({
        id: `${seedCase.id}-G${String(index + 1).padStart(2, "0")}`,
        target_id: target.id,
        state_id: seedCase.state_id,
        split: "dev",
        tier: "nightly",
        provenance: {
          kind: "generated_frozen",
          generator: GENERATOR_VERSION,
          generated_at: new Date().toISOString(),
          frozen_at: new Date().toISOString().slice(0, 10),
          source_refs: [
            `target:${target.id}`,
            `seed-case:${seedCase.id}`,
            "rule:deterministic_template",
          ],
        },
        expression,
        expression_frozen: true,
        expected: {
          allowed_actions: seedCase.expected.allowed_actions,
          allowed_effects: seedCase.expected.allowed_effects,
          forbidden_behaviors: seedCase.expected.forbidden_behaviors,
          oracle_refs: seedCase.expected.oracle_refs,
        },
        notes: `offline template 生成（${rule.note || "template"}）；须人工审阅后再冻结，不得自动当 holdout/PASS。`,
      });
    });
  }

  return { generator_version: GENERATOR_VERSION, candidates };
}
