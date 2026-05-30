import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";

const root = path.resolve(process.cwd());
const children = [];

function start(name, command, args) {
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    shell: false
  });
  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    stopAll(signal ? 0 : code ?? 0);
  });
  children.push(child);
  console.log(`[dev] ${name} started pid=${child.pid}`);
  return child;
}

function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}

function stopAll(exitCode = 0) {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => {
    for (const child of children) {
      if (!child.killed) child.kill("SIGKILL");
    }
    process.exit(exitCode);
  }, 500).unref();
}

let shuttingDown = false;
process.on("SIGINT", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopAll(0);
});
process.on("SIGTERM", () => {
  if (shuttingDown) return;
  shuttingDown = true;
  stopAll(0);
});

if (await isPortOpen(4174)) {
  console.log("[dev] api port 4174 already in use, reusing existing service");
} else {
  start("api", process.execPath, ["server/server.mjs", "--port", "4174"]);
}

if (await isPortOpen(4173)) {
  console.log("[dev] client port 4173 already in use, reusing existing Vite server");
} else {
  start("client", process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:client"]);
}
