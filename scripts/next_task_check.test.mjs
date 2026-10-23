import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { validateTaskState } from "./next_task_check.mjs";

const row = (id = "A", target = "A.md") =>
  "| " + id + " | 推进真实任务 | [任务](slices/" + target + ") |";
const task = (status = "todo") => "# 原任务\n\n- 状态：**" + status + "（阶段说明）**\n\n## 验证\n待完成";
const files = { "tasks/slices/A.md": task(), "tasks/slices/B.md": task("pending") };
function next({ current = row(), candidates = row("B", "B.md"), blocked = "暂无其他阻塞。" } = {}) {
  return [
    "# NEXT", "> [更新规则](README.md)", "## 当前任务",
    "| 任务 | 下一步 | 状态来源 |", "|---|---|---|", current,
    "## 后续候选", "| 任务 | 目的 | 状态来源 |", "|---|---|---|", candidates,
    "## 阻塞", blocked,
  ].join("\n");
}
function check(text = next(), sources = files, journeys = "") {
  return validateTaskState(text, {
    readTask: (file) => {
      if (!(file in sources)) throw new Error("不存在");
      return sources[file];
    },
    journeys,
  });
}
function rejects(failures, message) {
  assert.ok(failures.some((failure) => failure.includes(message)), failures.join("\n"));
}

test("原任务是状态真源，旅程不需要复制 next", () => {
  assert.deepEqual(check(), []);
  assert.deepEqual(check(next(), files, "| C1 | 体验 | AU | 对象 | gap | 无 |"), []);
});
test("只改原任务为 done 就能挡住陈旧排期，不依赖 NEXT 双写", () => {
  for (const status of ["done", "superseded", "cancelled"]) {
    rejects(check(next(), { ...files, "tasks/slices/A.md": task(status) }), "来源已终结");
  }
});
test("识别设计 doing、blocked、deferred，不把进入排期当实现获批", () => {
  for (const status of ["doing", "blocked", "deferred"]) {
    assert.deepEqual(check(next(), { ...files, "tasks/slices/A.md": task(status) }), []);
  }
});
test("当前至多一项，候选不能重复编号或重复排同一来源", () => {
  rejects(check(next({ current: row() + "\n" + row("B", "B.md"), candidates: "" })), "当前任务至多一项");
  rejects(check(next({ candidates: row() })), "重复任务编号");
  rejects(check(next({ candidates: row("C", "A.md") })), "原任务被重复排期");
});
test("空当前任务仅在有可达的阻塞来源时允许", () => {
  rejects(check(next({ current: "" })), "必须引用");
  assert.deepEqual(check(next({ current: "", blocked: "待决策见 [原任务](slices/A.md)。" })), []);
  rejects(check(next({ current: "", blocked: "[缺失](slices/missing.md)" })), "阻塞来源不可读");
});
test("拒绝不存在、非任务路径以及缺失的状态来源", () => {
  rejects(check(next({ current: row("A", "missing.md") })), "来源不可读");
  for (const target of ["../NEXT.md", "../README.md", "../../docs/project-ledger.md", "/tmp/A.md", "https://example.com/A.md"]) {
    const text = next().replace("slices/A.md", target);
    rejects(check(text), "必须是 tasks");
  }
  rejects(check(next().replace("[任务](slices/A.md)", "只有任务名")), "缺少状态来源");
});
test("未知状态与后文才出现的状态都不能冒充顶部状态", () => {
  rejects(check(next(), { ...files, "tasks/slices/A.md": task("maybe") }), "顶部状态");
  rejects(check(next(), { ...files, "tasks/slices/A.md": "# 标题\n## 历史\n- 状态：todo" }), "顶部状态");
});
test("子任务以锚点小节为真源，不受已完成对账批次顶部状态误导", () => {
  const aggregate = "# 对账\n- 状态：done\n\n## 余项\n- 状态：todo\n\n## 历史\n- 状态：done";
  assert.deepEqual(check(next({ current: row("A", "A.md#余项") }), { ...files, "tasks/slices/A.md": aggregate }), []);
  rejects(check(next({ current: row("A", "A.md#缺失") }), { ...files, "tasks/slices/A.md": aggregate }), "锚点不存在");
  rejects(check(next({ blocked: "[原因](slices/A.md#缺失)" })), "阻塞来源锚点不存在");
});
test("拒绝增加历史节、损坏表格、缺少规则链接", () => {
  rejects(check(next() + "\n## Decision Log\n历史 next"), "只允许");
  rejects(check(next().replace("## 当前任务", "## 旧队列")), "只允许");
  rejects(check(next().replace("| A | 推进真实任务 |", "| A | 多余 | 推进真实任务 |")), "表格行损坏");
  rejects(check(next().replace(row(), row().slice(0, -1))), "表格缺少边界");
  rejects(check(next().replace("](README.md)", "](unknown.md)")), "更新规则链接");
});
test("限制规模，防止长行或大量候选重新把 NEXT 变为总台账", () => {
  rejects(check(next() + "\n".repeat(81) + "尾"), "超过 80 行");
  rejects(check(next() + "长".repeat(6001)), "6000 字符");
  const candidates = Array.from({ length: 6 }, (_, i) => row("C" + i, "C" + i + ".md")).join("\n");
  const sources = Object.fromEntries(Array.from({ length: 6 }, (_, i) => ["tasks/slices/C" + i + ".md", task()]));
  rejects(check(next({ candidates }), { ...files, ...sources }), "候选至多五项");
});
test("旅程只保留覆盖，不允许复制 next/queued 或队首镜像", () => {
  for (const status of ["**next**", "queued（后续）"]) {
    rejects(check(next(), files, "| C1 | 体验 | AU | 对象 | " + status + " | 无 |"), "不再复制");
  }
  rejects(check(next(), files, "Queue head: A"), "不再维护队首镜像");
  assert.deepEqual(check(next(), files, "历史记录曾提及 next；当前覆盖 partial。"), []);
});

// 真实 shell/Python 入口在隔离目录运行：验证迁移不会使旧债务悄悄消失。
const gapScript = readFileSync(new URL("./gap_ledger.sh", import.meta.url), "utf8");
const debtFile = "tasks/slices/VS00D-G-GAP-RECONCILIATION.md";
const debtHeader = "## 6. 开放债务状态\n\n| 编号 | 事项 | 状态 | 承接 |\n|---|---|---|---|\n";
const debtRows = "| B3 | 召回 | todo | B27 |\n| B4 | 实模 | blocked | 凭据 |\n| B9 | 狗粮余项 | deferred | 复验 |";
function fixture(run) {
  const root = mkdtempSync(path.join(tmpdir(), "gap-source-test-"));
  const put = (file, value) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), value);
  };
  put("scripts/gap_ledger.sh", gapScript);
  put("docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md", "| G1 | 共同输入 | 开放 |\n");
  put("docs/design/08-novel-element-model.md", "| NEM-GAP-01 | 主题 | 部分关闭 |\n| NEM-GAP-02 | 旧项 | 已关闭 |\n");
  put(debtFile, debtHeader + debtRows + "\n## 7. 历史\n| B99 | 历史开放 | todo | 旧项 |\n");
  put("tasks/NEXT.md", "# NEXT\n| B3 | 原位置已删除 | done |");
  const prior = { scanned_at: "2026-10-23", gaps: { "VS-00D:G1": "共同输入", "08:NEM-GAP-01": "主题", "B轨:B3": "召回", "B轨:B4": "实模" }, streak: { "B轨:B3": 7 } };
  put("reports/gap-ledger/latest.json", JSON.stringify(prior));
  const execute = () => spawnSync("bash", ["scripts/gap_ledger.sh"], { cwd: root, encoding: "utf8" });
  const snapshot = () => readFileSync(path.join(root, "reports/gap-ledger/latest.json"), "utf8");
  try { run({ root, put, execute, snapshot }); } finally { rmSync(root, { recursive: true, force: true }); }
}
test("差距源移出 NEXT 后原 ID 仍开放；条件/历史不重复扫，连续次数保留", () => {
  fixture(({ execute, snapshot }) => {
    const result = execute();
    assert.equal(result.status, 0, result.stderr);
    const data = JSON.parse(snapshot());
    assert.deepEqual(Object.keys(data.gaps).sort(), ["08:NEM-GAP-01", "B轨:B3", "B轨:B4", "B轨:B9", "VS-00D:G1"]);
    assert.equal(data.streak["B轨:B3"], 8);
    assert.ok(result.stdout.includes("新增: B轨:B9"));
    assert.ok(!result.stdout.includes("关闭:"));
  });
});
test("差距源显式终态才关闭，部分关闭仍开放", () => {
  fixture(({ put, execute, snapshot }) => {
    put(debtFile, debtHeader + debtRows.replace("| todo |", "| done |"));
    const result = execute();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes("关闭: B轨:B3"));
    assert.ok(JSON.parse(snapshot()).gaps["08:NEM-GAP-01"]);
  });
});
for (const [name, content] of [
  ["源节丢失", "# 只有历史"],
  ["源表为空", debtHeader],
  ["未知状态", debtHeader + debtRows.replace("| todo |", "| maybe |")],
  ["重复编号", debtHeader + debtRows + "\n| B3 | 重复 | todo | B27 |"],
  ["损坏行", debtHeader + "| B3 | 余项 | todo |"],
  ["重复源节", debtHeader + debtRows + "\n" + debtHeader + debtRows],
]) {
  test("扫描" + name + "时失败，保留上一完整快照", () => {
    fixture(({ put, execute, snapshot }) => {
      const before = snapshot();
      put(debtFile, content);
      assert.notEqual(execute().status, 0);
      assert.equal(snapshot(), before);
    });
  });
}
test("G/NEM 源表意外丢失时不能把整组差距清空", () => {
  fixture(({ put, execute, snapshot }) => {
    const before = snapshot();
    put("docs/design/08-novel-element-model.md", "# 空表");
    assert.notEqual(execute().status, 0);
    assert.equal(snapshot(), before);
  });
});

test("单行从原表消失不能冒充关闭，上一快照不变", () => {
  fixture(({ put, execute, snapshot }) => {
    const before = snapshot();
    put(debtFile, debtHeader + debtRows.split("\n").slice(1).join("\n"));
    const result = execute();
    assert.notEqual(result.status, 0);
    assert.ok(result.stderr.includes("B轨:B3"));
    assert.equal(snapshot(), before);
  });
});

test("设计差距单行被删也需明确关闭或转交记录", () => {
  fixture(({ put, execute, snapshot }) => {
    const before = snapshot();
    put("docs/design/contracts/VS-00D-ai-guided-authoring-contract-pack.md", "| G2 | 新项 | 开放 |\n");
    assert.notEqual(execute().status, 0);
    assert.equal(snapshot(), before);
  });
});
