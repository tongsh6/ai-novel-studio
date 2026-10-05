import assert from "node:assert/strict";
import test from "node:test";
import { validateTaskState } from "./next_task_check.mjs";

const currentRow = "| Q3d | A | 作者义务决策 | **next**（实现等 ADR Accepted） | 决策冻结 |";
const journeyRow = "| C9 | 作者重复诉求 | Q3d / ADR-0027 | 义务 | next | 提案 | ADR | 待决策 |";

function documents({ rows = currentRow, journey = journeyRow, history = "" } = {}) {
  return [
    `## 1. Current Focus
 docs/product/user-journeys.md
## 3. Active Journey
## 4. Queue
### 当前队列（2026-10-05 校准）
| # | 轨 | 任务 | 状态 | 完成判据 |
|---|---|---|---|---|
${rows}
### 历史 Order 表
${history}
## 5. Selection Rule
 docs/project-ledger.md
## 6. Decision Log`,
    `## 1. 状态定义
 tasks/NEXT.md
## 2. Journey A：启动
${journey}
## 6. 使用规则`,
  ];
}

test("当前字母编号队首与旅程精确对应", () => {
  assert.deepEqual(validateTaskState(...documents()), []);
});

test("历史 next 不能补足当前队列缺失的队首", () => {
  const failures = validateTaskState(...documents({
    rows: currentRow.replace("**next**", "done"),
    history: "| 6 | M3 | A | 旧任务 | **next** | 旧验收 |",
  }));
  assert.ok(failures.some((message) => message.includes("当前队列 row") && message.includes("found 0")));
});

test("历史记录和任务说明中的 next 不产生第二个队首", () => {
  assert.deepEqual(validateTaskState(...documents({
    rows: `${currentRow}\n| Q4 | B | 说明 next 检查 | done | 下个 checkpoint |`,
    history: "| 6 | M3 | A | 旧任务 | next | 历史状态 |",
  })), []);
});

test("拒绝当前队列的多个 next", () => {
  const failures = validateTaskState(...documents({
    rows: `${currentRow}\n${currentRow.replace("Q3d", "DS02")}`,
  }));
  assert.ok(failures.some((message) => message.includes("当前队列 row") && message.includes("found 2")));
});

test("拒绝重复任务编号", () => {
  const failures = validateTaskState(...documents({
    rows: `${currentRow}\n${currentRow.replace("**next**", "done")}`,
  }));
  assert.ok(failures.some((message) => message.includes("duplicate 当前队列 id Q3d")));
});

test("任务编号必须在 next 旅程行内完整匹配", () => {
  for (const wrongId of ["Q2", "Q3d-extra", "Q3d2"]) {
    const failures = validateTaskState(...documents({
      journey: `${journeyRow.replace("Q3d", wrongId)}\nQ3d 在别处提及不算对应。`,
    }));
    assert.ok(failures.some((message) => message.includes("must reference current queue id Q3d")));
  }
});

test("旅程同样只能有一个 next", () => {
  const failures = validateTaskState(...documents({
    journey: `${journeyRow}\n${journeyRow.replace("C9", "C10")}`,
  }));
  assert.ok(failures.some((message) => message.includes("journey step") && message.includes("found 2")));
});

test("缺少当前队列标题和畸形表格均拒绝通过", () => {
  const [next, journeys] = documents();
  assert.ok(validateTaskState(next.replace("### 当前队列", "### 旧队列"), journeys).length > 0);
  const failures = validateTaskState(...documents({
    rows: currentRow.replace("| A |", "| A | 多余列 |"),
  }));
  assert.ok(failures.some((message) => message.includes("malformed 当前队列 row")));
});
