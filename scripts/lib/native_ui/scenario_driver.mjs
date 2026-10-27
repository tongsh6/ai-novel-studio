// B61：AU11/AU07 原生验收外部驱动的共用运行时。
//
// 只被外部驱动脚本（scripts/native_au11_drive.mjs、scripts/native_au07_drive.mjs）使用；
// 产品代码不读取本文件。全部操作都走真实 Tauri 窗口的用户可见语义：
// 窗口标题/按钮文案/输入框/AX 可见文本 + 真实 WS/HTTP 传输帧（外部代理采证）。
// 判据来自既有浏览器 canonical driver，驱动面换成 AX/CGEvent，断言语义不降级。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  appPid,
  activate,
  click,
  clickAt,
  dump,
  dumpAll,
  pressKey,
  readJson,
  screenshot,
  sleep,
  textOf,
  typeText,
  writeAX,
  Step,
} from "./driver.mjs";
import { cleanupNativeApp } from "../native_app_ownership.mjs";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const AX_MAX_NODES = 14000;

export const frameOf = (record) =>
  Array.isArray(record?.frame) && record.frame.length >= 5 ? record.frame : null;
export const frameEvent = (record) => frameOf(record)?.[3] ?? null;
export const frameBody = (record) => frameOf(record)?.[4] ?? null;
export const lastIndexWhere = (nodes, predicate) => {
  for (let index = nodes.length - 1; index >= 0; index -= 1) {
    if (predicate(nodes[index])) return index;
  }
  return -1;
};
export const isVisibleNode = (node) =>
  Array.isArray(node.frame) && node.frame[1] > 0 && node.frame[2] > 0 && node.frame[3] > 0;

export class NativeScenarioHarness {
  constructor(dir) {
    this.dir = path.resolve(dir);
    this.ready = readJson(path.join(this.dir, "native-driver-ready.json"));
    this.APP = this.ready.bundle_identifier;
    this.provider = this.ready.provider ?? "slice_verify";
    this.dbFile = path.join(this.dir, "database", "ai_novel_studio_test.sqlite3");
    this.step = new Step(this.dir);
    this.log = [];
    this.captures = [];
    this.screenshots = [];
    this.phase = "init";
    this.failing = false;
  }

  nowIso() {
    return new Date().toISOString();
  }

  writeJson(name, value) {
    fs.writeFileSync(path.join(this.dir, name), JSON.stringify(value, null, 2));
  }

  supervisorFailure() {
    const file = path.join(this.dir, "failure.json");
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return { reason: "failure_json_unreadable" };
    }
  }

  checkSupervisor() {
    const failure = this.supervisorFailure();
    if (failure && !this.failing) {
      this.failing = true;
      throw new Error(`supervisor_failed:${failure.reason ?? "unknown"}`);
    }
  }

  // 每个分型等待只允许单层 begin/finish（B37 等待账拒绝嵌套）。
  async runStep(kind, label, fn) {
    this.checkSupervisor();
    this.phase = `${kind}:${label}`;
    this.log.push({ op: "step_begin", kind, label, at: this.nowIso() });
    this.step.begin(kind, label);
    try {
      return await fn();
    } catch (error) {
      this.log.push({ op: "step_failed", kind, label, at: this.nowIso(), error: error.message });
      throw error;
    } finally {
      this.step.finish();
      this.log.push({ op: "step_end", kind, label, at: this.nowIso() });
    }
  }

  // ── AX 读取/等待 ───────────────────────────────────────────────────────────
  mainWindowDump(nodes) {
    // macOS 偶发把 AXHelpTag（tooltip/帮助标签）作为首个窗口返回，此时整棵树只有 help tag 节点。
    return (
      nodes.length > 8 &&
      (nodes.some((node) => node.role === "AXWebArea") ||
        nodes.some((node) => node.role === "AXWindow"))
    );
  }

  dumpNodes() {
    let nodes = dump(this.APP, AX_MAX_NODES);
    for (let attempt = 0; attempt < 12 && !this.mainWindowDump(nodes); attempt += 1) {
      try {
        pressKey(this.APP, "escape");
      } catch {
        /* tooltip may already be gone */
      }
      try {
        activate(this.APP);
      } catch {
        /* ignore activation failure */
      }
      execFileSync("sleep", ["0.25"]);
      try {
        nodes = dump(this.APP, AX_MAX_NODES);
      } catch {
        nodes = [];
      }
    }
    return nodes;
  }

  axText(nodes) {
    return nodes.map(textOf).filter(Boolean).join("\n");
  }

  async pollAx(predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    let lastText = "";
    while (Date.now() < deadline) {
      this.checkSupervisor();
      let nodes = null;
      try {
        nodes = this.dumpNodes();
      } catch {
        await sleep(600);
        continue;
      }
      lastText = this.axText(nodes);
      if (predicate(lastText, nodes)) return { nodes, text: lastText };
      if (!nodes.some((node) => node.role === "AXWindow")) activate(this.APP);
      await sleep(600);
    }
    throw new Error(`wait_ax_timeout:${label}:${lastText.slice(-400)}`);
  }

  async tryPollAx(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.checkSupervisor();
      let nodes = null;
      try {
        nodes = this.dumpNodes();
      } catch {
        await sleep(600);
        continue;
      }
      const text = this.axText(nodes);
      if (predicate(text, nodes)) return { nodes, text };
      if (!nodes.some((node) => node.role === "AXWindow")) activate(this.APP);
      await sleep(600);
    }
    return null;
  }

  // ── 证据采集（AX 树 + 可见文本 + 窗口截图）──────────────────────────────────
  screenshotSafe(filePath) {
    try {
      screenshot(this.APP, filePath);
      return { ok: true };
    } catch (error) {
      this.log.push({ op: "screenshot_flake", filePath, error: error.message, at: this.nowIso() });
      try {
        screenshot(this.APP, filePath);
        return { ok: true, retried: true };
      } catch (retryError) {
        // 窗口动画/遮挡期间 screencapture -l 会失败；整屏兜底仍写入同一证据文件，
        // AX 树与可见文本始终是主证据，截图 flake 不中断真实工作台链路。
        try {
          execFileSync("screencapture", ["-x", filePath], { stdio: "ignore" });
          this.log.push({ op: "screenshot_fallback", filePath, at: this.nowIso() });
          return { ok: true, fallback: true };
        } catch (fallbackError) {
          this.log.push({
            op: "screenshot_failed",
            filePath,
            error: fallbackError.message,
            first_error: retryError.message,
            at: this.nowIso(),
          });
          return { ok: false };
        }
      }
    }
  }

  capture(name) {
    this.checkSupervisor();
    const nodes = this.dumpNodes();
    const text = this.axText(nodes);
    writeAX(nodes, path.join(this.dir, `${name}.ax.txt`), this.APP);
    fs.writeFileSync(path.join(this.dir, `${name}.text.txt`), text);
    const shot = this.screenshotSafe(path.join(this.dir, `${name}.jpg`));
    if (shot.ok) this.screenshots.push(`${name}.jpg`);
    this.captures.push({ name, at: this.nowIso(), nodes: nodes.length, screenshot: shot });
    this.log.push({ op: "capture", name, at: this.nowIso() });
    return nodes;
  }

  // ── 传输帧（外部 WS/HTTP 代理采证，非产品验收钩子）────────────────────────────
  transport() {
    const file = path.join(this.dir, "native-transport.jsonl");
    if (!fs.existsSync(file)) return [];
    return fs
      .readFileSync(file, "utf8")
      .split("\n")
      .filter((line) => line.includes("{"))
      .map((line) => JSON.parse(line.slice(line.indexOf("{"))));
  }

  async pollWire(predicate, timeoutMs, label) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.checkSupervisor();
      const hit = predicate(this.transport());
      if (hit) return hit;
      await sleep(300);
    }
    throw new Error(`wait_wire_timeout:${label}`);
  }

  async tryPollWire(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      this.checkSupervisor();
      const hit = predicate(this.transport());
      if (hit) return hit;
      await sleep(300);
    }
    return null;
  }

  sentUserMessageSince(wire, sinceIso, text) {
    return (
      wire.find(
        (entry) =>
          entry.direction === "sent" &&
          frameOf(entry) &&
          entry.at >= sinceIso &&
          frameEvent(entry) === "user_message" &&
          String(frameBody(entry)?.text ?? "") === text,
      ) ?? null
    );
  }

  ackFor(wire, messageRecord) {
    const turnId = String(frameBody(messageRecord)?.turn_id ?? "");
    return (
      wire.find(
        (entry) =>
          entry.direction === "received" &&
          frameOf(entry) &&
          entry.at >= messageRecord.at &&
          entry.frame[1] === messageRecord.frame[1] &&
          frameEvent(entry) === "phx_reply" &&
          frameBody(entry)?.status === "ok" &&
          frameBody(entry)?.response?.turn_id === turnId,
      ) ?? null
    );
  }

  // 收集 run 期间收到的全部 turn_result（父消息与内部 step 都保留）。
  turnResultsSince(wire, sinceIso) {
    return wire.filter(
      (entry) =>
        entry.direction === "received" &&
        frameOf(entry) &&
        entry.at >= sinceIso &&
        frameEvent(entry) === "turn_result",
    );
  }

  // ── 高层工作台动作（函数本身不 begin/finish；调用方用 runStep 包一层）──────────────
  safeClick(node, label) {
    if (!node) throw new Error(`click_target_missing:${label}`);
    const mouseFallback = (reason) => {
      if (!Array.isArray(node.frame) || node.frame.length < 4) {
        throw new Error(`click_failed:${label}:${reason}:no_frame`);
      }
      clickAt(this.APP, node.frame[0] + node.frame[2] / 2, node.frame[1] + node.frame[3] / 2);
      return { ok: true, method: "mouse", label, fallback_from: reason };
    };
    try {
      const result = click(node, this.APP);
      if (result && result.ok === false) return mouseFallback("axpress_rejected");
      return { ...result, label };
    } catch (error) {
      return mouseFallback(error.message);
    }
  }

  findButton(nodes, title, { afterIndex = -1 } = {}) {
    const matches = [];
    for (let index = afterIndex + 1; index < nodes.length; index += 1) {
      const node = nodes[index];
      if (node.role === "AXButton" && (node.title === title || node.value === title)) {
        matches.push(node);
      }
    }
    if (matches.length === 0) return null;
    const visible = matches.filter(isVisibleNode);
    return (visible.length ? visible : matches).at(-1);
  }

  visibleWorkTitle(nodes) {
    const trigger = nodes.find(
      (node) => node.role === "AXPopUpButton" && String(node.desc ?? "") === "作品",
    );
    return trigger?.title ?? null;
  }

  findComposer(nodes) {
    return (
      nodes.find(
        (node) => node.role === "AXTextField" && String(node.desc ?? "").includes("输入"),
      ) ?? null
    );
  }

  findSendButton(nodes) {
    return this.findButton(nodes, "发送");
  }

  async rawLaunchApp() {
    execFileSync("open", [this.ready.app_path]);
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      this.checkSupervisor();
      if (appPid(this.APP)) break;
      await sleep(400);
    }
    if (!appPid(this.APP)) throw new Error("native_app_did_not_launch");
    activate(this.APP);
  }

  async rawWaitWorkbench(label, timeoutMs = 170_000) {
    return this.pollAx(
      (_text, nodes) =>
        nodes.some((node) => node.role === "AXWebArea") &&
        nodes.some(
          (node) => node.role === "AXTextField" && String(node.desc ?? "").includes("输入"),
        ) &&
        nodes.some((node) => node.role === "AXButton" && node.title === "发送"),
      timeoutMs,
      `workbench_ready:${label}`,
    );
  }

  // 工作台就绪 ≠ 工作区已恢复：启动瞬间作品下拉标题是占位「当前作品」、同步显示离线。
  // 必须等真实作品标题与「同步已连接」出现后再采集/发送，否则会把加载态误判成工作切换失败。
  async rawWaitWorkbenchSettled(label, timeoutMs = 180_000) {
    await this.rawWaitWorkbench(`${label}:frame`, timeoutMs);
    const connected = await this.pollAx(
      (text) => /同步已连接/u.test(text),
      120_000,
      `${label}:connected`,
    );
    const title = this.visibleWorkTitle(connected.nodes);
    if (title && title !== "当前作品" && !/^AI$/u.test(title)) return connected;
    return this.pollAx(
      (_text, nodes) => {
        const current = this.visibleWorkTitle(nodes);
        return Boolean(current) && current !== "当前作品" && !/^AI$/u.test(current);
      },
      90_000,
      `${label}:work_title`,
    );
  }

  markWorkNewest(workId) {
    execFileSync(
      "python3",
      [
        "-c",
        [
          "import sqlite3,sys,datetime",
          "db=sqlite3.connect(sys.argv[1], timeout=10)",
          "ts=datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.%f')+'Z'",
          "db.execute('update works set updated_at=? where id=?',(ts,sys.argv[2]))",
          "db.commit(); db.close()",
        ].join("\n"),
        this.dbFile,
        workId,
      ],
      { stdio: "ignore" },
    );
  }

  async rawSwitchWork(title, label) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      let nodes = this.dumpNodes();
      if (this.visibleWorkTitle(nodes) === title) return nodes;
      const trigger = nodes.find(
        (node) => node.role === "AXPopUpButton" && String(node.desc ?? "") === "作品",
      );
      if (!trigger) throw new Error("work_menu_trigger_not_found");
      this.safeClick(trigger, `${label}:menu-open:${attempt}`);
      await sleep(800);
      nodes = this.dumpNodes();
      if (attempt === 1) {
        writeAX(nodes, path.join(this.dir, `${label}-work-menu.ax.txt`), this.APP);
        fs.writeFileSync(path.join(this.dir, `${label}-work-menu.text.txt`), this.axText(nodes));
      }
      let item =
        nodes.find((node) => node.role === "AXMenuItem" && node.title === title) ??
        nodes.find((node) => node.role === "AXMenuItem" && textOf(node).includes(title));
      if (!item) {
        // macOS 菜单弹出层偶发不在首个窗口树里：dumpall 遍历全部窗口，仍按可见标题
        // 匹配菜单项，命中后按 frame 中心做真实鼠标点击（仍是用户可见语义）。
        try {
          const allNodes = dumpAll(this.APP, 16_000);
          item =
            allNodes.find((node) => node.role === "AXMenuItem" && node.title === title) ??
            allNodes.find((node) => node.role === "AXMenuItem" && textOf(node).includes(title));
          if (item) item = { ...item, __mouseOnly: true };
        } catch {
          item = null;
        }
      }
      if (!item) {
        pressKey(this.APP, "escape");
        await sleep(400);
        continue;
      }
      if (item.__mouseOnly) {
        clickAt(this.APP, item.frame[0] + item.frame[2] / 2, item.frame[1] + item.frame[3] / 2);
      } else {
        this.safeClick(item, `${label}:menuitem`);
      }
      const switched = await this.pollAx(
        (_text, current) => this.visibleWorkTitle(current) === title,
        30_000,
        `${label}:switched`,
      );
      await this.pollAx(
        (text) => /同步已连接/u.test(text) || /已连接/u.test(text),
        60_000,
        `${label}:connected`,
      ).catch(() => null);
      return switched.nodes;
    }
    throw new Error(`work_switch_failed:${title}`);
  }

  async rawCloseAppAndRelaunch() {
    await cleanupNativeApp(this.dir);
    await sleep(500);
    execFileSync("open", [this.ready.app_path]);
    const deadline = Date.now() + 12_000;
    while (Date.now() < deadline) {
      this.checkSupervisor();
      if (appPid(this.APP)) break;
      await sleep(300);
    }
    if (!appPid(this.APP)) throw new Error("native_app_did_not_relaunch");
    activate(this.APP);
  }

  // 在真实作品菜单里尝试切到目标作品；不重启应用（重启必须在 restore 分型步内做，
  // 否则监督会把「原生窗口进程退出」判成非法退出）。返回是否已选中。
  async rawTrySelectWork(title, label) {
    let nodes = this.dumpNodes();
    if (this.visibleWorkTitle(nodes) === title) return true;
    try {
      nodes = await this.rawSwitchWork(title, `${label}:menu`);
    } catch (error) {
      this.log.push({ op: "work_menu_failed", label, error: error.message });
      return false;
    }
    return this.visibleWorkTitle(nodes) === title;
  }

  async rawWaitInputReady(label, timeoutMs = 45_000) {
    const result = await this.pollAx(
      (_text, nodes) => Boolean(this.findComposer(nodes)) && Boolean(this.findSendButton(nodes)),
      timeoutMs,
      `input_ready:${label}`,
    );
    await sleep(900);
    return result;
  }

  clickSend(nodes) {
    const button = this.findSendButton(nodes);
    if (button) this.safeClick(button, "send-button");
    else pressKey(this.APP, "return");
  }

  async rawTypeAndSend(text, label) {
    this.checkSupervisor();
    const startedAt = this.nowIso();
    let nodes = this.dumpNodes();
    let composer = this.findComposer(nodes);
    if (!composer) throw new Error("composer_not_found");
    this.safeClick(composer, `${label}:composer`);
    await sleep(350);
    const value = String(composer.value ?? "");
    if (value.trim() !== "") {
      pressKey(this.APP, "cmd+a");
      pressKey(this.APP, "delete");
      await sleep(200);
    }
    typeText(this.APP, text);
    await sleep(700);
    nodes = this.dumpNodes();
    composer = this.findComposer(nodes);
    const typedValue = String(composer?.value ?? "");
    if (typedValue.trim() !== "" && !typedValue.includes(text.slice(0, 3))) {
      // CGEvent 偶发丢字：仅在 AX 能读到非空值且确实不含预期文本时重试一次；
      // 最终仍以 user_message 帧文本严格核对（帧文本不等即等待超时失败）。
      this.safeClick(composer, `${label}:composer-retry`);
      await sleep(250);
      pressKey(this.APP, "cmd+a");
      pressKey(this.APP, "delete");
      await sleep(200);
      typeText(this.APP, text);
      await sleep(600);
      nodes = this.dumpNodes();
    }
    this.clickSend(nodes);
    let sent = await this.tryPollWire(
      (wire) => this.sentUserMessageSince(wire, startedAt, text),
      8_000,
    );
    if (!sent) {
      // 发送按钮偶发未命中（焦点/渲染抖动）：真实 UI 重试一次点击，不做旁路提交。
      await sleep(400);
      this.clickSend(this.dumpNodes());
      sent = await this.pollWire(
        (wire) => this.sentUserMessageSince(wire, startedAt, text),
        10_000,
        `${label}:user_message_sent`,
      );
    }
    return sent;
  }

  // ── 「为什么」决策溯源面板：按钮文案 + 面板可见文本 ─────────────────────────────
  findWhyButton(nodes) {
    const matches = nodes.filter(
      (node) =>
        node.role === "AXButton" &&
        (node.title === "为什么" || textOf(node).includes("为什么")) &&
        isVisibleNode(node),
    );
    return matches.at(-1) ?? null;
  }

  // 返回 { button, beforeText, afterText, nodes }；点击前不得已显示面板文本。
  async rawOpenWhy(label) {
    const before = await this.pollAx(
      (_text, nodes) => Boolean(this.findWhyButton(nodes)),
      45_000,
      `${label}:why_button`,
    );
    const beforeText = before.text;
    if (beforeText.includes("参考来源")) throw new Error(`why_already_open:${label}`);
    const button = this.findWhyButton(before.nodes);
    this.safeClick(button, `${label}:why`);
    const opened = await this.pollAx(
      (text) => text.includes("参考来源") && text.includes("不会重新调用模型"),
      30_000,
      `${label}:why_dialog`,
    );
    return { button, beforeText, afterText: opened.text, nodes: opened.nodes };
  }

  // ── 收尾 ─────────────────────────────────────────────────────────────────
  writeUiComplete(scope) {
    this.writeJson("native-ui-complete.json", {
      harness_run_ref: this.ready.run_ref,
      driver: "ax-native-system-ui",
      app_bundle: "com.ai-novel-studio.app",
      screenshots: this.screenshots,
      scope,
    });
  }

  writeDriverLog(name, value) {
    this.writeJson(name, {
      slice_id: value.slice_id,
      provider: value.provider ?? this.provider,
      driver: "ax-native-system-ui",
      finished_at: this.nowIso(),
      captures: this.captures,
      log: this.log,
      ...value,
    });
  }

  async fail(error) {
    this.failing = true;
    try {
      const nodes = this.dumpNodes();
      writeAX(nodes, path.join(this.dir, "failure.ax.txt"), this.APP);
      fs.writeFileSync(path.join(this.dir, "failure.text.txt"), this.axText(nodes));
      this.screenshotSafe(path.join(this.dir, "failure.jpg"));
    } catch {
      /* app may be gone */
    }
    if (!fs.existsSync(path.join(this.dir, "failure.json"))) {
      this.writeJson("failure.json", {
        at: this.nowIso(),
        phase: this.phase,
        driver: "ax-native-system-ui",
        reason: error.message,
        stack: String(error.stack ?? "").split("\n").slice(0, 6),
        captures: this.captures,
        log_tail: this.log.slice(-14),
      });
    }
    console.error(error);
    process.exitCode = 1;
  }
}

// 顶层选中目标作品：正常走真实作品菜单；菜单不可用才用隔离副本 DB 的「最近打开」
// 时间戳模拟作者上次打开该作品后重开应用（等价重开，不改产品）。close/relaunch 必须
// 单独登记为 restore 分型等待（B37 监督据此区分「恢复重开」与「窗口意外退出」）。
export async function ensureWorkSelected(harness, workId, title, label) {
  const ok = await harness.runStep("maintenance", `select_work:${label}`, () =>
    harness.rawTrySelectWork(title, label),
  );
  if (ok) return true;
  harness.log.push({ op: "work_restart_fallback", label, at: harness.nowIso() });
  harness.markWorkNewest(workId);
  await harness.runStep("restore", `relaunch:${label}`, () => harness.rawCloseAppAndRelaunch());
  await harness.runStep("maintenance", `workbench_ready:${label}:restored`, () =>
    harness.rawWaitWorkbenchSettled(`${label}:restored`),
  );
  const settled = await harness.runStep("maintenance", `select_work:${label}:restored`, () =>
    harness.rawTrySelectWork(title, `${label}:restored`),
  );
  if (!settled) throw new Error(`work_not_selected:${title}`);
  return false;
}

// 通过 CLI 调用对应 evidence 脚本的 prepare/capture 模式（证据始终由 evidence 模块写）。
export function runEvidenceMode(scriptPath, mode, dir, extra = []) {
  execFileSync("node", [scriptPath, mode, dir, ...extra], { cwd: ROOT, stdio: "inherit" });
}
