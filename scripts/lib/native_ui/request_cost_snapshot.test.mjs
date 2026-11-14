// B87 R01 运行清单的纯规则测试：不建 DB、不读文件、不启动原生入口。
// 安全判断只消费它真正需要的 runs_by_mode/long_run_tasks；provider 清单不参与，
// 合法纯例不补无关 provider 假数据。缺失/未知清单的结构拒绝在 snapshot owner 的
// JSON 读取边界（readSnapshotManifest/readSnapshotRecord）完成，见邻接 IO 测试。
import assert from "node:assert/strict";
import test from "node:test";
import {
  assertRunInventoryMatches,
  assertSnapshotRunInventory,
} from "./request_cost_snapshot.mjs";

function safetyInput(overrides = {}) {
  return {
    runs_by_mode: {},
    long_run_tasks: [],
    ...overrides,
  };
}

function completeInventory(overrides = {}) {
  return {
    ...safetyInput(),
    provider_run_count: 0,
    provider_call_refs: [],
    ...overrides,
  };
}

test("运行清单：按可能自动恢复的危险边界判断，不按任务数量", () => {
  // 非 bounded run 可能被恢复执行：危险，拒绝；未知 mode 同样拒绝。
  for (const mode of ["durable", "recoverable", "unknown"]) {
    assert.throws(
      () => assertSnapshotRunInventory(safetyInput({ runs_by_mode: { bounded: 1, [mode]: 1 } })),
      /非 bounded/,
      mode,
    );
  }
  // 非终止/未知 task 状态可能被恢复：危险，拒绝。
  for (const status of ["WAITING", "RUNNING", "PAUSED", "PENDING", null]) {
    assert.throws(
      () =>
        assertSnapshotRunInventory(
          safetyInput({ runs_by_mode: { bounded: 1 }, long_run_tasks: [{ id: "t", status }] }),
        ),
      /非终止状态/,
      String(status),
    );
  }
  // 实测 0 个 run、0 个 task 是安全的空表事实；provider 清单不参与安全判断。
  assert.deepEqual(assertSnapshotRunInventory(safetyInput()), {
    bounded_runs: 0,
    long_run_tasks: [],
    long_run_task_count: 0,
  });
  // 多个已终止任务是安全的，不要求恰好一个。
  assert.deepEqual(
    assertSnapshotRunInventory(
      safetyInput({
        runs_by_mode: { bounded: 124 },
        long_run_tasks: [
          { id: "t1", status: "DONE" },
          { id: "t2", status: "CANCELLED" },
          { id: "t3", status: "ERROR" },
        ],
      }),
    ),
    {
      bounded_runs: 124,
      long_run_tasks: [
        { id: "t1", status: "DONE" },
        { id: "t2", status: "CANCELLED" },
        { id: "t3", status: "ERROR" },
      ],
      long_run_task_count: 3,
    },
  );
  // 非 bounded 的 0 条不危险；只有实际存在的非 bounded run 才拒绝。
  assert.deepEqual(
    assertSnapshotRunInventory(safetyInput({ runs_by_mode: { durable: 0, bounded: 3 } })),
    { bounded_runs: 3, long_run_tasks: [], long_run_task_count: 0 },
  );
});

test("声明与实际清单逐字段对账，安全标签不能替代事实", () => {
  const actual = completeInventory({
    runs_by_mode: { bounded: 1 },
    long_run_tasks: [{ id: "t", status: "DONE" }],
    provider_run_count: 1,
    provider_call_refs: ["pcall-old"],
  });
  assert.deepEqual(assertRunInventoryMatches(actual, structuredClone(actual)), actual);
  assert.throws(
    () => assertRunInventoryMatches(actual, completeInventory({ runs_by_mode: { bounded: 2 } })),
    /不一致/,
  );
  assert.throws(
    () =>
      assertRunInventoryMatches(
        actual,
        completeInventory({
          runs_by_mode: { bounded: 1 },
          long_run_tasks: [{ id: "ghost", status: "DONE" }],
        }),
      ),
    /不一致/,
  );
  // 缺 provider 字段的声明与完整事实对账自然失败，不需要在纯安全规则里预验 shape。
  assert.throws(() => assertRunInventoryMatches(actual, safetyInput()), /不一致/);
});
