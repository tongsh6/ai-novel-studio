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
test("release 观察保存启动时刻/PGID/精确 exec，不包含 argv 或 env", async () => {
  const {parseReleaseProcesses} = await import("./process_observation.mjs");
  assert.deepEqual(parseReleaseProcesses(" 101 99 101 Wed Nov 18 10:00:00 2026 /tmp/A B/app"),[
    {pid:101,ppid:99,pgid:101,started:"Wed Nov 18 10:00:00 2026",executable:"/tmp/A B/app"}]);
});
const releaseApp = {pid:101,ppid:99,pgid:99,started:"Wed Nov 18 10:00:00 2026",executable:EXE};
const releaseChild = {pid:102,ppid:101,pgid:102,started:"Wed Nov 18 10:00:01 2026",executable:"/tmp/run-a/runtime/beam.smp"};
const releaseState = () => ({app:releaseApp,processes:[releaseApp]});
test("release 仅从已确认 child lineage 建立归属，不从同名/home/PGID猜测", async () => {
  const {extendReleaseOwnership} = await import("./process_observation.mjs");
  const unrelated={...releaseChild,pid:202,ppid:1};
  const result=extendReleaseOwnership(releaseState(),[releaseApp,releaseChild,unrelated]);
  assert.deepEqual(result.processes.map(p=>p.pid),[101,102]);
});
test("release reparent 后保留先前已证明身份；PID复用不授权信号", async () => {
  const {extendReleaseOwnership,releaseSignalCandidates}=await import("./process_observation.mjs");
  const state=extendReleaseOwnership(releaseState(),[releaseApp,releaseChild]);
  assert.deepEqual(extendReleaseOwnership(state,[{...releaseChild,ppid:1}]).processes.map(p=>p.pid),[102]);
  assert.deepEqual(releaseSignalCandidates(state,[{...releaseChild,started:"Wed Nov 18 11:00:01 2026"}]),[]);
});
test("release live parent 下合法 exec 变更可归属，失去lineage不能静默消失",async()=>{
  const {extendReleaseOwnership}=await import("./process_observation.mjs");
  const state=extendReleaseOwnership(releaseState(),[releaseApp,releaseChild]);
  const changed={...releaseChild,executable:"/tmp/run-a/runtime/erl_child"};
  assert.equal(extendReleaseOwnership(state,[releaseApp,changed]).processes[1].executable,changed.executable);
  assert.throws(()=>extendReleaseOwnership(state,[{...changed,ppid:1}]),/identity_changed_without_lineage/);
});
test("release 发信号前逐次复核，复用PID不收到TERM；从不kill进程组",async()=>{
  const {signalReleaseOwned}=await import("./process_observation.mjs");
  let count=0;const signals=[];
  signalReleaseOwned({app:releaseApp,processes:[releaseApp,releaseChild]},"SIGTERM","sidecar",{
    read:()=>++count===1?[releaseApp,releaseChild]:[releaseApp,{...releaseChild,started:"changed"}],
    kill:(...args)=>signals.push(args)});
  assert.deepEqual(signals,[]);
});
test("release sidecar故障注入不杀app，清理仅正PID且子进程先",async()=>{
  const {signalReleaseOwned}=await import("./process_observation.mjs");
  const state={app:releaseApp,processes:[releaseApp,releaseChild]},signals=[];
  const io={read:()=>[releaseApp,releaseChild],kill:(...a)=>signals.push(a)};
  signalReleaseOwned(state,"SIGTERM","sidecar",io);
  assert.deepEqual(signals,[[102,"SIGTERM"]]);signals.length=0;
  signalReleaseOwned(state,"SIGKILL","all",io);
  assert.deepEqual(signals,[[102,"SIGKILL"],[101,"SIGKILL"]]);
  assert.throws(()=>signalReleaseOwned(state,"SIGHUP","all",io),/invalid_release_signal/);
});
test("release ps身份观察失败必须暴露，不退成名字匹配",async()=>{
  const {readReleaseProcesses}=await import("./process_observation.mjs");
  assert.throws(()=>readReleaseProcesses(()=>{throw eperm();}),/EPERM/);
});
test("release 候选 comm不是exec，proc_pidpath实际路径核验且不查询无关PID",async()=>{
 const {readReleaseProcesses}=await import("./process_observation.mjs"),lookups=[];
 const rows=readReleaseProcesses((cmd,args)=>{
  if(cmd==="ps")return "101 99 99 Wed Nov 18 10:00:00 2026 app\n102 101 102 Wed Nov 18 10:00:01 2026 beam.smp\n999 1 999 Wed Nov 18 10:00:00 2026 app";
  if(cmd.endsWith("/ax_cua")){lookups.push(args[1]);return JSON.stringify({pid:Number(args[1]),executable:args[1]==="101"?"/tmp/batch/app":"/tmp/batch/beam.smp"});}
  throw Error("unexpected");
 },[{pid:101}]);
 assert.deepEqual(rows.map(p=>p.executable),["/tmp/batch/app","/tmp/batch/beam.smp"]);
 assert.deepEqual(lookups,["101","102"]);
});
test("release 活进程拿不到实际exec不得作为消失清理成功",async()=>{
 const {readReleaseProcesses}=await import("./process_observation.mjs");
 assert.throws(()=>readReleaseProcesses((cmd,args)=>{
   if(cmd.endsWith("/ax_cua"))throw Object.assign(Error("no executable"),{status:1});
   return args[0]==="-axo"?"101 99 99 Wed Nov 18 10:00:00 2026 app":"101";
 },[{pid:101}]),/executable_unobservable/);
});
