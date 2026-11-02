// B71 作者行为覆盖批次入口：校验并读取 B70 冻结 case（供 batch 查 state_env / 元数据）。
// 用法：node scripts/author_behavior_live_case.mjs --case C-F1-003 [--field state_env|expression|expression_sha256] [--out file]
import fs from "node:fs";
import {
  PILOT_GROUP_CASE_IDS,
  loadLiveCaseCorpus,
  selectLiveCase,
} from "./lib/quality/author_behavior_live_cases.mjs";

const args = process.argv.slice(2);
const index = (name) => args.indexOf(name);
const caseId = index("--case") >= 0 ? args[index("--case") + 1] : null;
const field = index("--field") >= 0 ? args[index("--field") + 1] : null;
const out = index("--out") >= 0 ? args[index("--out") + 1] : null;

if (!caseId) {
  console.error("usage: node scripts/author_behavior_live_case.mjs --case <case_id> [--field <name>] [--out <file>]");
  process.exit(64);
}
if (!PILOT_GROUP_CASE_IDS.includes(caseId)) {
  console.error(`case 不在已批准的 pilot 组内: ${caseId}`);
  process.exit(66);
}
try {
  const bundle = loadLiveCaseCorpus();
  const record = selectLiveCase(bundle, caseId);
  if (out) fs.writeFileSync(out, `${JSON.stringify(record, null, 2)}\n`);
  if (field) {
    const value = field === "state_env" ? record.driver?.state_env : record[field];
    if (value === undefined || value === null) {
      console.error(`未知字段: ${field}`);
      process.exit(66);
    }
    process.stdout.write(`${typeof value === "object" ? JSON.stringify(value) : value}\n`);
  } else if (!out) {
    process.stdout.write(`${JSON.stringify(record, null, 2)}\n`);
  }
} catch (error) {
  console.error(`case 读取失败: ${error.message}`);
  process.exit(66);
}
