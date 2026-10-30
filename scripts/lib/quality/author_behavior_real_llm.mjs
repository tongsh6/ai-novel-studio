// B70 CP3：真实模型语义子集预注册生成器（不运行模型、不代签语义/文学质量）。
export const REAL_LLM_PREREGISTRATION_SCHEMA = "author-behavior-real-llm-preregistration/v1";

export function buildRealLlmPreregistration({ corpus, evidenceDir, gitHead = null, budget = {} }) {
  const cases = Array.isArray(corpus?.cases) ? corpus.cases : corpus?.cases?.cases ?? [];
  const holdout = cases.filter((testCase) => testCase.split === "holdout");
  if (holdout.length === 0) throw new Error("corpus 没有 holdout case，不能生成真实模型预注册");
  const devRegressionExpressions = new Set(
    cases.filter((testCase) => ["dev", "regression"].includes(testCase.split)).map((testCase) => String(testCase.expression).trim()),
  );
  for (const testCase of holdout) {
    if (devRegressionExpressions.has(String(testCase.expression).trim())) {
      throw new Error(`holdout case ${testCase.id} 表达与 dev/regression 重复，禁止实模预注册`);
    }
  }

  return {
    schema: REAL_LLM_PREREGISTRATION_SCHEMA,
    generated_at: new Date().toISOString(),
    git_head: gitHead,
    status: "blocked_pending_authorization",
    scope: {
      holdout_only: true,
      case_ids: holdout.map((testCase) => testCase.id),
      cases: holdout.map((testCase) => ({
        case_id: testCase.id,
        target_id: testCase.target_id,
        state_id: testCase.state_id,
        expression: testCase.expression,
        allowed_actions: testCase.expected.allowed_actions,
      })),
      excluded_splits: ["dev", "regression", "explore"],
    },
    model_requirements: {
      single_slot: true,
      one_model_at_a_time: true,
      unload_required_after_run: true,
      cleanup: {
        lmstudio: ["lms unload --all", "lms ps（必须无 loaded 模型）"],
        strata: ["POST /api/models/unload", "GET /api/models（loaded 必须为 null）"],
      },
      same_model_across_tools: "工具对比时必须同 GGUF/同 prompt/同参数，记录 tok/s/TTFT/失败模式",
    },
    budget: {
      input_timeout_ms: budget.input_timeout_ms ?? 120_000,
      turn_timeout_ms: budget.turn_timeout_ms ?? 360_000,
      max_turns: holdout.length,
      max_duration_minutes: budget.max_duration_minutes ?? 30,
      retries: 0,
      note: "超时不得重发同一指令；失败批次只读保留。",
    },
    criteria: {
      mechanism: "真实产品链 + 外部页面；不得用 stub 代签",
      semantic: "holdout allowed results 由作者/B42 语义流程裁决；本预注册不预设 PASS",
      literary_quality: "I10 文学质量只能由作者指定负责人/时机盲评，AI 不代签",
      unknown_policy: "未知/证据不足不得记 PASS",
    },
    evidence: {
      dir: evidenceDir,
      required: ["真实页面截图", "WebSocket/请求证据", "provider 请求/响应字节", "app-log", "B42 model_behavior 证据链"],
      decision_ref: "B42-model-behavior-evidence-tier",
    },
    no_run_until: ["作者授权资源窗口", "B42 前置证据链就绪", "本预注册落盘并复核"],
  };
}
