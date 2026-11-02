// 进程观测适配的行为测试：ps 可用路径、ps 被环境拒绝时的 pgrep+lsof 等价路径、
// 同名不同路径/参数里带路径/进程已退出等负例。全部用注入 exec 跑纯逻辑，
// 不启动真实应用、不发信号。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  observeOwnedExecutable,
  ownProcesses,
  ownedNativeProcesses,
} from "./process_observation.mjs";

const EXE = "/tmp/run-a/AI Novel Studio.app/Contents/MacOS/app";

function eperm() {
  return Object.assign(new Error("spawnSync ps EPERM"), { code: "EPERM" });
}

function exited() {
  return Object.assign(new Error("Command failed"), { status: 1 });
}

function fakeExec(handlers) {
  const calls = [];
  const exec = (command, args) => {
    calls.push([command, ...args]);
    const handler = handlers[command];
    if (!handler) throw new Error(`unexpected_command:${command}`);
    return handler(args);
  };
  return { calls, exec };
}

test("ps 可用时按精确路径识别 owned 进程，不混入同名不同路径/参数里带路径", () => {
  const { calls, exec } = fakeExec({
    ps: () =>
      [
        ` 101 1 ${EXE}`,
        ` 102 88 ${EXE}`,
        " 103 1 /tmp/run-b/AI Novel Studio.app/Contents/MacOS/app",
        ` 104 1 /usr/bin/printf ${EXE}`,
        ` 105 1 ${EXE}-other`,
      ].join("\n"),
  });
  const snapshot = ownProcesses(EXE, { exec });

  assert.equal(snapshot.method, "ps");
  assert.equal(snapshot.fallback_reason, null);
  assert.deepEqual(
    snapshot.processes.map(({ pid, ppid }) => ({ pid, ppid })),
    [{ pid: 101, ppid: 1 }, { pid: 102, ppid: 88 }],
  );
  assert.deepEqual(calls, [["ps", "-axo", "pid=,ppid=,command=", "-ww"]]);
  assert.deepEqual(ownedNativeProcesses(` 101 1 ${EXE}\n`, EXE), [
    { pid: 101, ppid: 1, command: EXE },
  ]);
});

test("ps 被执行环境拒绝时退化为 pgrep+lsof，最终按 txt 实际路径精确归属", () => {
  const { calls, exec } = fakeExec({
    ps: () => {
      throw eperm();
    },
    pgrep: () => "101\n102\n103",
    lsof: (args) => {
      const pid = args[1];
      if (pid === "101") return `p101\nftxt\nn${EXE}\nftxt\nn/usr/lib/dyld`;
      if (pid === "102") return `p102\nftxt\nn/opt/other/AI Novel Studio.app/Contents/MacOS/app`;
      throw exited(); // 103 已退出
    },
  });
  const snapshot = ownProcesses(EXE, { exec });

  assert.equal(snapshot.method, "pgrep+lsof");
  assert.equal(snapshot.fallback_reason, "EPERM");
  assert.deepEqual(snapshot.processes.map(({ pid }) => pid), [101]);
  assert.equal(snapshot.processes[0].command, EXE);
  assert.deepEqual(calls[0][0], "ps");
  assert.ok(calls.some((call) => call[0] === "pgrep"));
  assert.ok(calls.some((call) => call[0] === "lsof"));
});

test("pgrep 无候选时 fallback 返回空集合，不把退出码 1 当失败", () => {
  const { exec } = fakeExec({
    ps: () => {
      throw eperm();
    },
    pgrep: () => {
      throw exited();
    },
  });
  const snapshot = ownProcesses(EXE, { exec });
  assert.equal(snapshot.method, "pgrep+lsof");
  assert.deepEqual(snapshot.processes, []);
});

test("ps 的非执行类失败不静默降级", () => {
  let pgrepCalled = false;
  const { exec } = fakeExec({
    ps: () => {
      throw Object.assign(new Error("ps usage error"), { status: 2 });
    },
    pgrep: () => {
      pgrepCalled = true;
      return "";
    },
  });
  assert.throws(() => ownProcesses(EXE, { exec }), /ps usage error/);
  assert.equal(pgrepCalled, false);
});

test("fallback 中 lsof 也被拒绝时显式失败，不静默当作无 owned 进程", () => {
  const { exec } = fakeExec({
    ps: () => {
      throw eperm();
    },
    pgrep: () => "101",
    lsof: () => {
      throw eperm();
    },
  });
  assert.throws(() => ownProcesses(EXE, { exec }), /EPERM/);
});

test("ps 可用时 PID 身份按命令精确核验，同名不同路径不命中", () => {
  const { exec } = fakeExec({
    ps: () => `${EXE}\n`,
  });
  const matched = observeOwnedExecutable(101, EXE, { exec });
  assert.equal(matched.method, "ps");
  assert.equal(matched.matches, true);

  const foreign = observeOwnedExecutable(101, EXE, {
    exec: fakeExec({ ps: () => "/tmp/run-b/AI Novel Studio.app/Contents/MacOS/app\n" }).exec,
  });
  assert.equal(foreign.matches, false);
});

test("ps 可用但目标进程已退出时保持不匹配，不发信号", () => {
  const { exec } = fakeExec({
    ps: () => {
      throw exited();
    },
  });
  const result = observeOwnedExecutable(101, EXE, { exec });
  assert.equal(result.method, "ps");
  assert.equal(result.matches, false);
  assert.equal(result.unavailable, "process_gone");
  assert.equal(result.observed_path, null);
});

test("fallback 下 PID 身份由 lsof txt 实际路径判定，同名不同路径不命中", () => {
  const { exec, calls } = fakeExec({
    ps: () => {
      throw eperm();
    },
    lsof: () => `p101\nftxt\nn${EXE}\nftxt\nn/usr/lib/dyld`,
  });
  const matched = observeOwnedExecutable(101, EXE, { exec });
  assert.equal(matched.method, "pgrep+lsof");
  assert.equal(matched.fallback_reason, "EPERM");
  assert.equal(matched.matches, true);
  assert.deepEqual(calls[0].slice(0, 4), ["ps", "-p", "101", "-o"]);

  const foreign = observeOwnedExecutable(101, EXE, {
    exec: fakeExec({ ps: () => { throw eperm(); }, lsof: () => "p101\nftxt\nn/tmp/run-b/AI Novel Studio.app/Contents/MacOS/app" }).exec,
  });
  assert.equal(foreign.matches, false);
});

test("fallback 下目标进程已退出（lsof 无输出）保持不匹配", () => {
  const { exec } = fakeExec({
    ps: () => {
      throw eperm();
    },
    lsof: () => {
      throw exited();
    },
  });
  const result = observeOwnedExecutable(101, EXE, { exec });
  assert.equal(result.matches, false);
  assert.equal(result.unavailable, "process_gone");
});

test("fallback 中 lsof 身份核验被拒绝时显式失败", () => {
  const { exec } = fakeExec({
    ps: () => {
      throw eperm();
    },
    lsof: () => {
      throw eperm();
    },
  });
  assert.throws(() => observeOwnedExecutable(101, EXE, { exec }), /EPERM/);
});

test("realpath 差异不破坏归属：候选按 realpath 发现、按 txt 实际路径判定", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "process-observation-"));
  try {
    const real = fs.realpathSync(dir);
    const executable = path.join(os.tmpdir(), path.basename(dir), "AI Novel Studio.app/Contents/MacOS/app");
    fs.mkdirSync(path.dirname(executable), { recursive: true });
    fs.writeFileSync(executable, "");
    const expected = path.join(real, "AI Novel Studio.app/Contents/MacOS/app");
    const patterns = [];
    const { exec } = fakeExec({
      ps: () => {
        throw eperm();
      },
      pgrep: (args) => {
        patterns.push(args[1]);
        return args[1].includes(expected) ? "202" : "202";
      },
      lsof: () => `p202\nftxt\nn${expected}`,
    });
    const snapshot = ownProcesses(executable, { exec });
    assert.equal(snapshot.processes.length, 1);
    assert.equal(snapshot.processes[0].command, expected);
    assert.ok(patterns.some((pattern) => pattern.includes(path.basename(dir))));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
