// 单一输入门/投递边界：先授权与落盘，再调用注入的真实 event adapter。
//
// 真实 adapter 是 Swift `ax_cua input`：它按同一 target 重新核验路径/PID/前台/焦点，
// 并用 CGEventPostToPid 投递。这里不包含任何按应用名猜测目标的 fallback；没有绑定
// target 就没有投递。测试通过注入 probe/deliver/sink 证明拒绝时 deliver 零调用。
import fs from "node:fs";
import {
  INPUT_EVENT_SCHEMA,
  OwnershipError,
  authorizeInput,
  inputEvent,
  isValidPid,
  splitUtf16Chunks,
} from "./input_target.mjs";

const SAFE_REASON = /^[a-z][a-z0-9_]{0,80}$/;

// 错误只能输出稳定 reason 与 code/signal/status 等结构元数据；argv、stdout/stderr、
// error.message、request/facts 都可能含输入文本，禁止整包回显。
function safeValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^[A-Za-z0-9_.-]{1,40}$/.test(value)) return value;
  return undefined;
}

export function safeDetails(error) {
  const out = {};
  for (const key of ["code", "signal", "status", "errno"]) {
    const value = safeValue(error?.[key]);
    if (value !== undefined) out[key] = value;
  }
  for (const key of ["stdout", "stderr"]) {
    const value = error?.[key];
    if (value != null) out[`${key}_length`] = String(value).length;
  }
  return out;
}

export function safeReason(error, fallback = "adapter_failure") {
  const reason = error instanceof OwnershipError ? error.reason : error?.reason;
  return typeof reason === "string" && SAFE_REASON.test(reason) ? reason : fallback;
}

export function adapterFailure(error, command = "adapter") {
  return new OwnershipError("adapter_exec_failed", {
    command: SAFE_REASON.test(command) ? command : "adapter",
    ...safeDetails(error),
  });
}

export function parseAdapterJson(raw, command = "adapter") {
  try {
    return JSON.parse(raw);
  } catch {
    throw new OwnershipError("adapter_output_invalid", {
      command: SAFE_REASON.test(command) ? command : "adapter",
      output_length: String(raw).length,
    });
  }
}

export function makeJsonlSink(file) {
  return {
    file,
    record(event) {
      try {
        fs.appendFileSync(file, `${JSON.stringify(event)}\n`);
      } catch (error) {
        throw new OwnershipError("input_evidence_write_failed", safeDetails(error));
      }
    },
  };
}

function reasonOf(error) {
  return safeReason(error, "delivery_error");
}

export class NativeInputBoundary {
  constructor({ target, probe, deliver, sink, now = () => new Date().toISOString() }) {
    if (!target || typeof target !== "object") throw new OwnershipError("target_unbound");
    if (target.pid == null) throw new OwnershipError("target_unbound");
    if (!isValidPid(target.pid)) throw new OwnershipError("target_pid_invalid");
    if (typeof probe !== "function") throw new TypeError("probe_required");
    if (typeof deliver !== "function") throw new TypeError("deliver_required");
    if (!sink || typeof sink.record !== "function") throw new TypeError("sink_required");
    this.target = target;
    this.probe = probe;
    this.deliver = deliver;
    this.sink = sink;
    this.now = now;
  }

  record(event) {
    try {
      this.sink.record(event);
    } catch (error) {
      if (error instanceof OwnershipError) throw error;
      throw new OwnershipError("input_evidence_write_failed", safeDetails(error));
    }
  }

  facts(request) {
    let facts;
    try {
      facts = this.probe(request);
    } catch (error) {
      const reason = safeReason(error, "probe_error");
      this.record(this.event("rejected", request, {}, { reason }));
      throw new OwnershipError(reason, { gesture: request.gesture, ...safeDetails(error) });
    }
    if (!facts || typeof facts !== "object") {
      const reason = "probe_failed";
      this.record(this.event("rejected", request, {}, { reason }));
      throw new OwnershipError(reason, { gesture: request.gesture });
    }
    if (facts.ok === false) {
      const reason = safeReason({ reason: facts.reason }, "probe_failed");
      this.record(this.event("rejected", request, facts, { reason }));
      throw new OwnershipError(reason, { gesture: request.gesture });
    }
    return facts;
  }

  event(kind, request, facts, result = {}) {
    const safeResult = { ...result };
    if (safeResult.reason != null) {
      safeResult.reason = safeReason({ reason: safeResult.reason }, "adapter_failure");
    }
    const event = inputEvent({
      target: this.target,
      event: kind,
      gesture: request.gesture,
      request,
      facts,
      result: safeResult,
      at: this.now(),
    });
    event.ok = safeResult.ok ?? null;
    if (safeResult.reason) event.reason = safeResult.reason;
    return event;
  }

  authorize(full, facts) {
    // facts 只提供被观测事实；target/request 始终来自构造时绑定与本次调用，
    // 不允许 probe 返回值覆盖已固定的 target/PID/generation/gesture。
    // 前台授权只消费 probe 的单一观测字段 frontmost；probe 不是 activate 操作结果。
    const authorization = authorizeInput({
      target: this.target,
      request: full,
      resolution: facts.resolution,
      frontmost: facts.frontmost,
      permissions: facts.permissions,
      focus: facts.focus,
    });
    if (!authorization.allowed) {
      this.record(this.event("rejected", full, facts, { reason: authorization.reason }));
      throw new OwnershipError(authorization.reason, { gesture: full.gesture });
    }
    this.record(this.event("attempt", full, facts));
  }

  failDelivery(full, facts, error) {
    const reason = reasonOf(error);
    this.record(this.event("result", full, facts, { reason }));
    throw error instanceof OwnershipError
      ? error
      : new OwnershipError(reason, { gesture: full.gesture, ...safeDetails(error) });
  }

  deliverAndRecord(full, facts) {
    let result;
    try {
      result = this.deliver(full);
    } catch (error) {
      this.failDelivery(full, facts, error);
    }
    this.record(this.event("result", full, facts, result || {}));
    if (!result || result.ok !== true) {
      const fallback = full.gesture === "activate" ? "activation_unconfirmed" : "input_rejected";
      const reason = safeReason({ reason: result?.reason }, fallback);
      throw new OwnershipError(reason, { gesture: full.gesture, ok: result?.ok ?? null });
    }
    return result;
  }

  dispatch(gesture, request = {}) {
    const full = {
      ...request,
      gesture,
      pid: this.target.pid,
      generation: this.target.generation,
    };
    const facts = this.facts(full);
    this.authorize(full, facts);
    return this.deliverAndRecord(full, facts);
  }

  activate() {
    return this.dispatch("activate", {});
  }

  focus(path, expected = null) {
    return this.dispatch("focus", { path, focus_required: false, expected_focus: expected });
  }

  key(key, { focusRequired = false, expected = null } = {}) {
    return this.dispatch("key", {
      key,
      focus_required: focusRequired,
      expected_focus: expected,
    });
  }

  clear(expected) {
    this.key("cmd+a", { focusRequired: true, expected });
    this.key("delete", { focusRequired: true, expected });
    return { ok: true, delivered_chunks: 2 };
  }

  insert(text, expected) {
    return this.dispatch("insert", {
      text,
      focus_required: true,
      expected_focus: expected,
    });
  }

  type(text, expected) {
    const chunks = splitUtf16Chunks(text);
    let delivered = 0;
    for (const chunk of chunks) {
      try {
        this.insert(chunk, expected);
        delivered += 1;
      } catch (error) {
        throw new OwnershipError(reasonOf(error), {
          delivered_chunks: delivered,
          total_chunks: chunks.length,
          input_length: text.length,
        });
      }
    }
    return { ok: true, input_length: text.length, delivered_chunks: delivered };
  }

  click(path, action = "AXPress") {
    return this.dispatch("click", { path, action, focus_required: false });
  }

  clickAt(x, y, count = 1) {
    return this.dispatch("click_at", { x: Number(x), y: Number(y), count: Number(count), focus_required: false });
  }

  scrollAt(x, y, dy) {
    return this.dispatch("scroll", { x: Number(x), y: Number(y), dy: Number(dy), focus_required: false });
  }

  scrollTo(path) {
    return this.dispatch("scroll_to", { path, focus_required: false });
  }

  setValue(path, value) {
    return this.dispatch("set", { path, value, focus_required: false });
  }

  recordRelaunch(fromPid, toPid) {
    this.record({
      schema: INPUT_EVENT_SCHEMA,
      at: this.now(),
      event: "relaunch",
      run_ref: this.target.run_ref,
      gesture: "relaunch",
      generation: this.target.generation,
      target: {
        bundle_identifier: this.target.bundle_identifier,
        app_path: this.target.app_path,
        executable_path: this.target.executable_path,
        pid: toPid,
      },
      from_pid: fromPid,
    });
  }
}
