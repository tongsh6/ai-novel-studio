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
  clickAt,
  dump,
  dumpAll,
  frontmost,
  pressKey,
  readJson,
  screenshot,
  sleep,
  startupObservation,
  textOf,
  writeAX,
  Step,
  bindTarget,
  buildTarget,
  composerExpectation,
  inputBoundary,
  relaunchTarget,
  targetResolution,
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
  constructor(dir, io = {}) {
    this.dir = path.resolve(dir);
    // 只读探测与输入边界分开注入：failure 采集只能走 io，不允许借 input 改变现场。
    this.io = {
      dump: io.dump ?? dump,
      screenshot: io.screenshot ?? screenshot,
      startup: io.startup ?? startupObservation,
    };
    this.ready = readJson(path.join(this.dir, "native-driver-ready.json"));
    this.target = buildTarget(this.ready, this.dir);
    this.APP = this.target;
    this.input = null;
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

  ensureInput() {
    if (!this.input) this.input = inputBoundary(this.APP);
    return this.input;
  }

  unboundTarget() {
    return { ...this.target, pid: null };
  }

  // 显式绑定本批实际 PID；只有 relaunch 分支允许换代。
  bindBatchTarget(resolution, { relaunch = false } = {}) {
    this.target = relaunch ? relaunchTarget(this.target, resolution) : bindTarget(this.target, resolution);
    this.APP = this.target;
    this.input = inputBoundary(this.target);
    this.log.push({
      op: "target_bound",
      at: this.nowIso(),
      relaunch,
      run_ref: this.target.run_ref,
      app_path: this.target.app_path,
      executable_path: this.target.executable_path,
      pid: this.target.pid,
      generation: this.target.generation,
      // 只读启动事实（isFinishedLaunching/launchDate/activationPolicy/isHidden）随本批身份落盘。
      startup: resolution.startup ?? null,
    });
    return this.target;
  }

  async waitTargetResolution(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      this.checkSupervisor();
      last = targetResolution(this.unboundTarget());
      if (last.ok) return last;
      if (last.reason !== "target_not_running") {
        throw new Error(`target_resolution_failed:${last.reason}`);
      }
      await sleep(300);
    }
    throw new Error(`native_app_did_not_launch:${last?.reason ?? "timeout"}`);
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
    // 纯观测：AX 读取绝不 activate/key/click；窗口不可得时如实返回原始事实。
    return this.io.dump(this.APP, AX_MAX_NODES);
  }

  // 正常交互需要关闭 tooltip/恢复前台时，走这个显式动作，而不是藏在读路径里。
  recoverInteractionSurface(reason) {
    if (!this.input) return { ok: false, reason: "input_unbound" };
    const frontmostBefore = frontmost();
    const activation = this.input.activate();
    const escape = this.input.key("escape", { focusRequired: false });
    this.log.push({
      op: "interaction_recovery",
      reason,
      at: this.nowIso(),
      frontmost_before: frontmostBefore,
      activation,
      escape,
    });
    return { activation, escape };
  }

  activateForInteraction(reason) {
    const frontmostBefore = frontmost();
    const activation = this.input.activate();
    this.log.push({
      op: "interaction_activation",
      reason,
      at: this.nowIso(),
      frontmost_before: frontmostBefore,
      activation,
    });
    return activation;
  }

  // 供正常交互步骤使用：沿用原 dumpNodes 的 tooltip 恢复行为，但恢复动作是命名的。
  dumpNodesForInteraction(reason = "interaction") {
    let nodes = this.dumpNodes();
    for (let attempt = 0; attempt < 12 && !this.mainWindowDump(nodes); attempt += 1) {
      this.recoverInteractionSurface(reason);
      execFileSync("sleep", ["0.25"]);
      nodes = this.dumpNodes();
    }
    return nodes;
  }

  // 启动/失败观测只读；任何观测错误都折成事实字段，不抛给调用方。
  observeStartup(reason) {
    const at = this.nowIso();
    try {
      return { at, reason, ...this.io.startup(this.APP) };
    } catch (error) {
      return { at, reason, ok: false, error: error.message };
    }
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
        nodes = this.dumpNodesForInteraction(`poll_ax:${label}`);
      } catch {
        await sleep(600);
        continue;
      }
      lastText = this.axText(nodes);
      if (predicate(lastText, nodes)) return { nodes, text: lastText };
      if (!nodes.some((node) => node.role === "AXWindow")) {
        this.activateForInteraction(`poll_ax:${label}`);
      }
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
        nodes = this.dumpNodesForInteraction(`try_poll_ax:${label}`);
      } catch {
        await sleep(600);
        continue;
      }
      const text = this.axText(nodes);
      if (predicate(text, nodes)) return { nodes, text };
      if (!nodes.some((node) => node.role === "AXWindow")) {
        this.activateForInteraction(`try_poll_ax:${label}`);
      }
      await sleep(600);
    }
    return null;
  }

  // ── 证据采集（AX 树 + 可见文本 + 窗口截图）──────────────────────────────────
  screenshotSafe(filePath, { allowFullScreenFallback = true } = {}) {
    try {
      this.io.screenshot(this.APP, filePath);
      return { ok: true };
    } catch (error) {
      this.log.push({ op: "screenshot_flake", filePath, error: error.message, at: this.nowIso() });
      try {
        this.io.screenshot(this.APP, filePath);
        return { ok: true, retried: true };
      } catch (retryError) {
        if (!allowFullScreenFallback) {
          // 失败取证只观察本批 target；整屏兜底会看到其它应用，不能用来补失败现场。
          this.log.push({
            op: "screenshot_failed",
            filePath,
            error: retryError.message,
            at: this.nowIso(),
          });
          return { ok: false, reason: retryError.message };
        }
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
      // 回退也走同一 target/PID 的 CGEvent 投递，并由边界核前台/权限；不再有全局点击。
      const result = this.ensureInput().clickAt(node.frame[0] + node.frame[2] / 2, node.frame[1] + node.frame[3] / 2);
      return { ...result, method: "mouse", label, fallback_from: reason, target_pid: this.target.pid };
    };
    try {
      const result = this.ensureInput().click(node.path);
      return { ...result, label };
    } catch (error) {
      // 只有 AXPress 本身被拒才做同目标鼠标回退；归属/权限/前台/焦点失败直接失败。
      if (error?.reason === "axpress_failed") return mouseFallback(error.reason);
      throw error;
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
    execFileSync("open", [this.target.app_path]);
    const resolution = await this.waitTargetResolution(90_000);
    this.bindBatchTarget(resolution);
    const startupBefore = this.observeStartup("launch:before_activation");
    // attempt 先落盘：activate 抛错时仍保留激活前观测，不再丢掉整段 launch 事实。
    this.log.push({ op: "launch_activation_attempt", at: this.nowIso(), startup: startupBefore });
    const activation = this.input.activate();
    const startupAfter = this.observeStartup("launch:after_activation");
    this.log.push({
      op: "launch_activation",
      at: this.nowIso(),
      ...activation,
      startup_before: startupBefore,
      startup_after: startupAfter,
    });
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
      let nodes = this.dumpNodesForInteraction(`work_switch:${label}`);
      if (this.visibleWorkTitle(nodes) === title) return nodes;
      const trigger = nodes.find(
        (node) => node.role === "AXPopUpButton" && String(node.desc ?? "") === "作品",
      );
      if (!trigger) throw new Error("work_menu_trigger_not_found");
      const before = frontmost();
      clickAt(this.APP, trigger.frame[0] + trigger.frame[2] / 2, trigger.frame[1] + trigger.frame[3] / 2);
      const clickResult = { ok: true, method: "cgevent", label: `${label}:menu-open:${attempt}` };
      this.log.push({
        op: "work_menu_open",
        attempt,
        at: this.nowIso(),
        app_pid: appPid(this.APP),
        frontmost_before: before,
        frontmost_after: frontmost(),
        trigger: {
          path: trigger.path,
          frame: trigger.frame,
          enabled: trigger.enabled,
          actions: trigger.actions,
        },
        click: clickResult,
      });
      await sleep(800);
      nodes = this.dumpNodesForInteraction(`work_menu:${label}`);
      if (attempt === 1) {
        writeAX(nodes, path.join(this.dir, `${label}-work-menu.ax.txt`), this.APP);
        fs.writeFileSync(path.join(this.dir, `${label}-work-menu.text.txt`), this.axText(nodes));
      }
      const menuItems = nodes.filter((node) => node.role === "AXMenuItem");
      this.log.push({
        op: "work_menu_after_dump",
        attempt,
        at: this.nowIso(),
        menu_item_count: menuItems.length,
        menu_item_titles: menuItems.map(textOf),
        menu_count: nodes.filter((node) => node.role === "AXMenu").length,
        target_present: menuItems.some((node) => textOf(node).includes(title)),
        frontmost: frontmost(),
      });
      let item =
        nodes.find((node) => node.role === "AXMenuItem" && node.title === title) ??
        nodes.find((node) => node.role === "AXMenuItem" && textOf(node).includes(title));
      if (!item) {
        // macOS 菜单弹出层偶发不在首个窗口树里：dumpall 遍历全部窗口，仍按可见标题
        // 匹配菜单项，命中后按 frame 中心做真实鼠标点击（仍是用户可见语义）。
        try {
          const allNodes = dumpAll(this.APP, 16_000);
          const allMenuItems = allNodes.filter((node) => node.role === "AXMenuItem");
          this.log.push({
            op: "work_menu_after_dump_all",
            attempt,
            at: this.nowIso(),
            menu_item_count: allMenuItems.length,
            menu_item_titles: allMenuItems.map(textOf),
            target_present: allMenuItems.some((node) => textOf(node).includes(title)),
            frontmost: frontmost(),
          });
          item =
            allNodes.find((node) => node.role === "AXMenuItem" && node.title === title) ??
            allNodes.find((node) => node.role === "AXMenuItem" && textOf(node).includes(title));
        } catch (error) {
          this.log.push({ op: "work_menu_dump_all_error", attempt, error: error.message });
          item = null;
        }
      }
      if (!item) {
        pressKey(this.APP, "escape");
        await sleep(400);
        continue;
      }
      this.log.push({
        op: "work_menu_item_click",
        attempt,
        at: this.nowIso(),
        item: { path: item.path, frame: item.frame, title: textOf(item) },
        frontmost: frontmost(),
      });
      const itemClickResult = this.safeClick(item, `${label}:menuitem`);
      this.log.push({
        op: "work_menu_item_after_click",
        click: itemClickResult,
        attempt,
        at: this.nowIso(),
        visible_title: this.visibleWorkTitle(this.dumpNodesForInteraction(`work_menu_item:${label}`)),
        frontmost: frontmost(),
      });
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
    const previousPid = this.target.pid;
    await cleanupNativeApp(this.dir);
    await sleep(500);
    execFileSync("open", [this.target.app_path]);
    const resolution = await this.waitTargetResolution(12_000);
    this.bindBatchTarget(resolution, { relaunch: true });
    this.input.recordRelaunch(previousPid, this.target.pid);
    const startupBefore = this.observeStartup("relaunch:before_activation");
    this.log.push({ op: "relaunch_activation_attempt", at: this.nowIso(), previous_pid: previousPid, startup: startupBefore });
    const activation = this.input.activate();
    this.log.push({
      op: "relaunch_activation",
      at: this.nowIso(),
      previous_pid: previousPid,
      ...activation,
      startup_before: startupBefore,
      startup_after: this.observeStartup("relaunch:after_activation"),
    });
  }

  // 在真实作品菜单里尝试切到目标作品；不重启应用（重启必须在 restore 分型步内做，
  // 否则监督会把「原生窗口进程退出」判成非法退出）。返回是否已选中。
  async rawTrySelectWork(title, label) {
    let nodes = this.dumpNodesForInteraction(`select_work:${label}`);
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
    const composer = this.findComposer(result.nodes);
    const send = this.findSendButton(result.nodes);
    this.log.push({
      op: "input_ready_state",
      at: this.nowIso(),
      target_pid: this.target.pid,
      composer: composer
        ? { path: composer.path, role: composer.role, enabled: composer.enabled ?? null, focused: composer.focused ?? null }
        : null,
      send: send ? { title: send.title, enabled: send.enabled ?? null, focused: send.focused ?? null } : null,
    });
    await sleep(900);
    return result;
  }

  clickSend(nodes, expectedFocus = null) {
    const button = this.findSendButton(nodes);
    if (button?.enabled === false) throw new Error("send_button_disabled");
    this.log.push({
      op: "send_click",
      at: this.nowIso(),
      target_pid: this.target.pid,
      method: button ? "button" : "return_key",
      button_enabled: button?.enabled ?? null,
      button_focused: button?.focused ?? null,
    });
    if (button) return this.safeClick(button, "send-button");
    return this.ensureInput().key("return", { focusRequired: true, expected: expectedFocus });
  }

  async rawTypeAndSend(text, label) {
    this.checkSupervisor();
    const startedAt = this.nowIso();
    let nodes = this.dumpNodesForInteraction(`type_and_send:${label}`);
    let composer = this.findComposer(nodes);
    if (!composer) throw new Error("composer_not_found");
    if (composer.enabled === false) throw new Error(`composer_disabled:${label}`);
    const expected = composerExpectation(composer);
    const input = this.ensureInput();

    // 激活返回/前台确认由边界记录；focused 必须指回同一个 composer path。
    const activation = input.activate();
    this.log.push({ op: "input_activation", at: this.nowIso(), ...activation });
    input.focus(composer.path, expected);
    await sleep(350);
    const value = String(composer.value ?? "");
    if (value.trim() !== "") {
      input.clear(expected);
      await sleep(200);
    }
    input.type(text, expected);
    // 长中文输入逐块投递；AX composer value 与目标文本严格相等才是发送前提。
    // 失败只做一次有界观察，不自动重复输入同一段文本。
    let typedValue = "";
    const deadline = Date.now() + 6_000;
    while (Date.now() < deadline) {
      composer = this.findComposer(this.dumpNodesForInteraction(`type_and_send:observed:${label}`));
      typedValue = String(composer?.value ?? "");
      if (typedValue === text) break;
      await sleep(200);
    }
    if (typedValue !== text) {
      throw new Error(`composer_text_incomplete:${label}:got=${typedValue.length}:want=${text.length}`);
    }
    nodes = this.dumpNodesForInteraction(`type_and_send:send:${label}`);
    this.clickSend(nodes, expected);
    return this.pollWire(
      (wire) => this.sentUserMessageSince(wire, startedAt, text),
      10_000,
      `${label}:user_message_sent`,
    );
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
      app_bundle: this.target.bundle_identifier,
      input_target: this.target,
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
      input_target: this.target,
      log: this.log,
      ...value,
    });
  }

  // 失败现场采集只观察同一本批 target/PID：AX 读取、窗口截图、启动事实全部只读。
  // 不调用 input（activate/key/click/type），不重启、不切换；窗口/AX 不可得时只记录缺失原因。
  observeFailureScene() {
    const observation = { at: this.nowIso(), startup: this.observeStartup("failure") };
    let nodes = null;
    try {
      nodes = this.dumpNodes();
    } catch (error) {
      observation.ax = { ok: false, reason: error.message };
    }
    if (nodes) {
      const hasAxWindow = nodes.some((node) => node.role === "AXWindow");
      const hasAxWebArea = nodes.some((node) => node.role === "AXWebArea");
      observation.ax = {
        ok: true,
        node_count: nodes.length,
        main_window: this.mainWindowDump(nodes),
        has_ax_window: hasAxWindow,
        has_ax_web_area: hasAxWebArea,
      };
      try {
        writeAX(nodes, path.join(this.dir, "failure.ax.txt"), this.APP);
        fs.writeFileSync(path.join(this.dir, "failure.text.txt"), this.axText(nodes));
      } catch (error) {
        observation.ax.evidence_write_error = error.message;
      }
    }
    try {
      observation.screenshot = this.screenshotSafe(path.join(this.dir, "failure.jpg"), {
        allowFullScreenFallback: false,
      });
    } catch (error) {
      observation.screenshot = { ok: false, reason: error.message };
    }
    return observation;
  }

  async fail(error) {
    this.failing = true;
    let observation;
    try {
      observation = this.observeFailureScene();
    } catch (captureError) {
      observation = { at: this.nowIso(), error: captureError.message };
    }
    // failure.json 可能已由监督进程先写；观测单独落盘，保证原因不因竞态丢失。
    try {
      this.writeJson("failure-observation.json", observation);
    } catch (writeError) {
      this.log.push({ op: "failure_observation_write_failed", error: writeError.message, at: this.nowIso() });
    }
    try {
      if (!fs.existsSync(path.join(this.dir, "failure.json"))) {
        this.writeJson("failure.json", {
          at: this.nowIso(),
          phase: this.phase,
          driver: "ax-native-system-ui",
          input_target: this.target,
          reason: error.message,
          stack: String(error.stack ?? "").split("\n").slice(0, 6),
          observation,
          captures: this.captures,
          log_tail: this.log.slice(-14),
        });
      }
    } catch (writeError) {
      this.log.push({ op: "failure_json_write_failed", error: writeError.message, at: this.nowIso() });
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
