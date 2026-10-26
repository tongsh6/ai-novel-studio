import test from "node:test";
import assert from "node:assert/strict";
import { ownedNativeProcesses, nativeExecutablePath } from "./native_app_ownership.mjs";

test("launchd重开仍按本批精确路径识别，不混入同名程序、其他批次、相似参数", () => {
  const exe = "/tmp/run-a/AI Novel Studio.app/Contents/MacOS/native-app";
  const rows = ` 101 1 ${exe}\n102 88 ${exe}\n103 1 /tmp/run-b/AI Novel Studio.app/Contents/MacOS/native-app\n104 1 /usr/bin/printf ${exe}\n105 1 ${exe}-other\n106 1 /Applications/AI Novel Studio.app/Contents/MacOS/native-app`;
  assert.deepEqual(ownedNativeProcesses(rows, exe).map(({ pid, ppid }) => ({ pid, ppid })), [{ pid: 101, ppid: 1 }, { pid: 102, ppid: 88 }]);
});

test("原生bundle仅允许已知原生入口，拒绝任意路径扩大清理范围", () => {
  assert.equal(nativeExecutablePath("/tmp/run", { native_executable: "app" }), "/tmp/run/AI Novel Studio.app/Contents/MacOS/app");
  assert.throws(() => nativeExecutablePath("/tmp/run", { native_executable: "../../other" }), /unexpected/);
});
