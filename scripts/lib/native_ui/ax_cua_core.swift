import Foundation
import ApplicationServices
import CoreGraphics
import AppKit

// External harness AX/CUA driver for native macOS apps.
//
// 读命令（apps/frontmost/dump/dumpall/screenshot/focused/windows/debug/pid）保留按名称的通用
// 只读用途；所有真实输入（AX 动作、键盘、鼠标、滚轮）都走 resolve/probe/input，必须携带本批
// target（run_ref + app_path + executable_path + pid + generation）。输入门在每次投递/分块前
// 重新核验路径、PID、前台、AX 信任、CG post 权限和预期焦点；不按 bundle/name 猜目标。

func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
}
func attrError(_ el: AXUIElement, _ name: String) -> AXError {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &value)
}
func str(_ el: AXUIElement, _ name: String) -> String {
    if let v = attr(el, name) { return String(describing: v) }
    return ""
}
func children(_ el: AXUIElement) -> [AXUIElement] {
    if let v = attr(el, kAXChildrenAttribute) as? [AXUIElement] { return v }
    return []
}
func windows(_ appEl: AXUIElement) -> [AXUIElement] {
    if let v = attr(appEl, kAXWindowsAttribute) as? [AXUIElement] { return v }
    return []
}
func role(_ el: AXUIElement) -> String { str(el, kAXRoleAttribute) }
func title(_ el: AXUIElement) -> String { str(el, kAXTitleAttribute) }
func descString(_ el: AXUIElement) -> String {
    let d = str(el, kAXDescriptionAttribute); if !d.isEmpty { return d }
    let h = str(el, kAXHelpAttribute); if !h.isEmpty { return h }
    return str(el, kAXPlaceholderValueAttribute)
}
func valueString(_ el: AXUIElement) -> String {
    if let v = attr(el, kAXValueAttribute) { return String(describing: v) }
    return ""
}
// 原始 AX 可见语义：控件当前是否可用。nil 表示属性不可得，驱动必须如实记录 unknown。
func enabledOf(_ el: AXUIElement) -> Bool? {
    if let v = attr(el, kAXEnabledAttribute) as? Bool { return v }
    if let v = attr(el, kAXEnabledAttribute) as? NSNumber { return v.boolValue }
    return nil
}
func optionalBool(_ b: Bool?) -> Any { if let b = b { return b }; return NSNull() }
func optionalString(_ s: String?) -> Any { if let s = s { return s }; return NSNull() }
func valueSettable(_ el: AXUIElement) -> Bool? {
    var settable = DarwinBoolean(false)
    return AXUIElementIsAttributeSettable(el, kAXValueAttribute as CFString, &settable) == .success
        ? settable.boolValue : nil
}
func frameOf(_ el: AXUIElement) -> (CGPoint, CGSize)? {
    guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute) else { return nil }
    var pt = CGPoint.zero; var sz = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &pt), AXValueGetValue(s as! AXValue, .cgSize, &sz) else { return nil }
    return (pt, sz)
}
func canonicalPath(_ value: String) -> String {
    return URL(fileURLWithPath: value).resolvingSymlinksInPath().path
}
func pidOf(app: String) -> pid_t? {
    let running = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    let exact = running.filter { ($0.localizedName ?? "") == app || ($0.bundleIdentifier ?? "") == app }
    let partial = running.filter { ($0.executableURL?.path ?? "").contains(app) || ($0.bundleIdentifier ?? "").contains(app) }
    return (exact.first ?? partial.first)?.processIdentifier
}
func allApps() -> [[String: Any]] {
    return NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map {
        ["name": $0.localizedName ?? "", "bundle": $0.bundleIdentifier ?? "", "pid": Int($0.processIdentifier)]
    }
}
func frontmostIdentity() -> [String: Any] {
    guard let app = NSWorkspace.shared.frontmostApplication else {
        return ["pid": 0, "bundle_identifier": ""]
    }
    return ["pid": Int(app.processIdentifier), "bundle_identifier": app.bundleIdentifier ?? ""]
}

// 启动事实只读投影：SDK 已有的 NSRunningApplication 属性，不触发启动/激活。
func iso8601Timestamp(_ date: Date?) -> Any {
    guard let date = date else { return NSNull() }
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(from: date)
}

func activationPolicyName(_ policy: NSApplication.ActivationPolicy) -> String {
    switch policy {
    case .regular: return "regular"
    case .accessory: return "accessory"
    case .prohibited: return "prohibited"
    @unknown default: return "unknown"
    }
}

func startupRunningFacts(
    isFinishedLaunching: Bool,
    launchDate: Date?,
    activationPolicy: NSApplication.ActivationPolicy,
    isHidden: Bool,
    isActive: Bool
) -> [String: Any] {
    return [
        "is_finished_launching": isFinishedLaunching,
        "launch_date": iso8601Timestamp(launchDate),
        "activation_policy": activationPolicyName(activationPolicy),
        "is_hidden": isHidden,
        "is_active": isActive,
    ]
}

func startupRunningFacts(_ app: NSRunningApplication) -> [String: Any] {
    return startupRunningFacts(
        isFinishedLaunching: app.isFinishedLaunching,
        launchDate: app.launchDate,
        activationPolicy: app.activationPolicy,
        isHidden: app.isHidden,
        isActive: app.isActive
    )
}

// AXWindow/AXWebArea 出现事实只读遍历，不等待、不激活；遍历有界，避免异常树拖住驱动。
func axSurfaceFacts(pid: pid_t) -> [String: Any] {
    let appEl = AXUIElementCreateApplication(pid)
    let wins = windows(appEl)
    var hasWebArea = false
    var visited = 0
    func walk(_ el: AXUIElement, _ depth: Int) {
        if hasWebArea || visited >= 4000 || depth > 64 { return }
        visited += 1
        if role(el) == "AXWebArea" { hasWebArea = true; return }
        for child in children(el) { walk(child, depth + 1) }
    }
    for win in wins { walk(win, 0) }
    return [
        "ax_window_count": wins.count,
        "has_ax_window": !wins.isEmpty,
        "has_ax_web_area": hasWebArea,
        "ax_nodes_visited": visited,
    ]
}

func elementAt(pid: pid_t, path: String) -> AXUIElement? {
    let appEl = AXUIElementCreateApplication(pid)
    guard let wins = attr(appEl, kAXWindowsAttribute) as? [AXUIElement], let w = wins.first else { return nil }
    var el = w
    if path != "0" {
        for comp in path.split(separator: "/").dropFirst() {
            guard let i = Int(comp), i < children(el).count else { return nil }
            el = children(el)[i]
        }
    }
    return el
}

func focusedElement(pid: pid_t) -> AXUIElement? {
    let appEl = AXUIElementCreateApplication(pid)
    if let value = attr(appEl, kAXFocusedUIElementAttribute) { return (value as! AXUIElement) }
    return nil
}

func findPath(pid: pid_t, targetEl: AXUIElement) -> String? {
    let appEl = AXUIElementCreateApplication(pid)
    var found: String?
    func walk(_ el: AXUIElement, _ path: String) {
        if found != nil { return }
        if CFEqual(el, targetEl) { found = path; return }
        for (i, child) in children(el).enumerated() { walk(child, "\(path)/\(i)") }
    }
    if let wins = attr(appEl, kAXWindowsAttribute) as? [AXUIElement], let w = wins.first {
        walk(w, "0")
    } else {
        walk(appEl, "0")
    }
    return found
}

func focusedFacts(pid: pid_t, expected: [String: Any] = [:]) -> [String: Any] {
    guard let el = focusedElement(pid: pid) else {
        return ["pid": Int(pid), "matches": false, "reason": "no_focused", "enabled": NSNull(), "value_settable": NSNull()]
    }
    let actualPath = findPath(pid: pid, targetEl: el)
    let expectedPath = expected["path"] as? String
    let expectedRole = expected["role"] as? String
    let expectedDesc = expected["desc_contains"] as? String
    let actualRole = role(el)
    let actualDesc = descString(el)
    let pathMatches = expectedPath == nil || actualPath == expectedPath
    let roleMatches = expectedRole == nil || actualRole == expectedRole
    let descMatches = expectedDesc == nil || actualDesc.contains(expectedDesc!)
    let matches = pathMatches && roleMatches && descMatches
    return [
        "pid": Int(pid),
        "role": actualRole,
        "title": title(el),
        "desc": actualDesc,
        "path": optionalString(actualPath),
        "value_length": valueString(el).utf16.count,
        "enabled": optionalBool(enabledOf(el)),
        "value_settable": optionalBool(valueSettable(el)),
        "matches": matches,
        "path_matches": pathMatches,
        "role_matches": roleMatches,
        "desc_matches": descMatches,
        "expected": expected,
    ]
}

func dump(pid: pid_t, maxNodes: Int, includeAllWindows: Bool = false) -> [[String: Any]] {
    let appEl = AXUIElementCreateApplication(pid)
    let focused = focusedElement(pid: pid)
    var out: [[String: Any]] = []
    func walk(_ el: AXUIElement, _ depth: Int, _ path: String) {
        if out.count >= maxNodes { return }
        var node: [String: Any] = ["path": path, "depth": depth, "role": role(el),
            "title": title(el), "desc": descString(el), "value": valueString(el),
            "subrole": str(el, kAXSubroleAttribute)]
        var actions: [String] = []
        var names: CFArray?
        if AXUIElementCopyActionNames(el, &names) == .success, let arr = names as? [String] { actions = arr }
        node["actions"] = actions
        node["enabled"] = optionalBool(enabledOf(el))
        node["focused"] = focused.map { CFEqual(el, $0) } ?? false
        if let (pt, sz) = frameOf(el) { node["frame"] = [pt.x, pt.y, sz.width, sz.height] }
        out.append(node)
        for (i, c) in children(el).enumerated() { walk(c, depth + 1, "\(path)/\(i)") }
    }
    if let wins = attr(appEl, kAXWindowsAttribute) as? [AXUIElement], let w = wins.first {
        walk(w, 0, "0")
    } else {
        walk(appEl, 0, "0")
    }
    return out
}

func dumpAll(pid: pid_t, maxNodes: Int) -> [[String: Any]] {
    let appEl = AXUIElementCreateApplication(pid)
    let focused = focusedElement(pid: pid)
    var out: [[String: Any]] = []
    var stack: [(AXUIElement, Int)] = [(appEl, 0)]
    var seen = Set<CFHashCode>()
    while let (el, depth) = stack.popLast(), out.count < maxNodes {
        let h = CFHash(el)
        if seen.contains(h) { continue }
        seen.insert(h)
        var node: [String: Any] = ["depth": depth, "role": role(el), "title": title(el),
            "desc": descString(el), "value": valueString(el)]
        node["enabled"] = optionalBool(enabledOf(el))
        node["focused"] = focused.map { CFEqual(el, $0) } ?? false
        if let (pt, sz) = frameOf(el) { node["frame"] = [pt.x, pt.y, sz.width, sz.height] }
        var actions: [String] = []
        var names: CFArray?
        if AXUIElementCopyActionNames(el, &names) == .success, let arr = names as? [String] { actions = arr }
        node["actions"] = actions
        out.append(node)
        for c in children(el).reversed() { stack.append((c, depth + 1)) }
    }
    return out
}

func windowId(pid_t p: pid_t) -> CGWindowID? {
    let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
    for w in info {
        if let owner = w[kCGWindowOwnerPID as String] as? pid_t, owner == p,
           let num = w[kCGWindowNumber as String] as? NSNumber,
           let layer = w[kCGWindowLayer as String] as? NSNumber, layer.intValue == 0 {
            return CGWindowID(num.intValue)
        }
    }
    return nil
}

func screenshot(pid t: pid_t, path p: String) -> Bool {
    guard let id = windowId(pid_t: t) else { return false }
    let proc = Process()
    proc.executableURL = URL(fileURLWithPath: "/usr/sbin/screencapture")
    proc.arguments = ["-x", "-l\(id)", p]
    do { try proc.run(); proc.waitUntilExit(); return proc.terminationStatus == 0 } catch { return false }
}

// ── target 解析 ─────────────────────────────────────────────────────────────
struct InputTarget {
    let schema: String
    let runRef: String
    let bundleIdentifier: String
    let appPath: String
    let executablePath: String
    let nativeExecutable: String
    let pid: pid_t?
    let generation: Int

    init?(_ json: [String: Any]) {
        guard let schema = json["schema"] as? String,
              let runRef = json["run_ref"] as? String,
              let bundleIdentifier = json["bundle_identifier"] as? String,
              let appPath = json["app_path"] as? String,
              let executablePath = json["executable_path"] as? String,
              let nativeExecutable = json["native_executable"] as? String else { return nil }
        self.schema = schema
        self.runRef = runRef
        self.bundleIdentifier = bundleIdentifier
        self.appPath = appPath
        self.executablePath = executablePath
        self.nativeExecutable = nativeExecutable
        if let n = json["pid"] as? NSNumber { self.pid = pid_t(n.int32Value) } else { self.pid = nil }
        self.generation = (json["generation"] as? NSNumber)?.intValue ?? 0
    }
}

func targetIdentity(_ target: InputTarget) -> [String: Any] {
    return [
        "run_ref": target.runRef,
        "bundle_identifier": target.bundleIdentifier,
        "app_path": target.appPath,
        "executable_path": target.executablePath,
        "pid": target.pid.map { Int($0) } ?? NSNull(),
        "generation": target.generation,
    ]
}

func failureObject(_ reason: String, _ target: InputTarget? = nil, _ extra: [String: Any] = [:]) -> [String: Any] {
    var out: [String: Any] = ["ok": false, "reason": reason]
    if let target = target { out["target"] = targetIdentity(target) }
    for (key, value) in extra { out[key] = value }
    return out
}

func targetMatches(_ target: InputTarget) -> [NSRunningApplication] {
    let expected = canonicalPath(target.executablePath)
    return NSWorkspace.shared.runningApplications.filter { app in
        guard let url = app.executableURL else { return false }
        return canonicalPath(url.path) == expected
    }
}

func targetMetadataFailure(_ target: InputTarget) -> String? {
    if target.schema != "native-input-target/v1" { return "target_schema_invalid" }
    if target.runRef.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty { return "run_ref_missing" }
    if let pid = target.pid, pid <= 0 { return "target_pid_invalid" }
    if target.generation < 0 { return "target_generation_invalid" }
    if !target.appPath.hasPrefix("/") || !target.executablePath.hasPrefix("/") { return "target_path_not_absolute" }
    if !["app", "native-app"].contains(target.nativeExecutable) { return "native_executable_invalid" }
    let app = canonicalPath(target.appPath)
    let executable = canonicalPath(target.executablePath)
    let derived = URL(fileURLWithPath: executable).deletingLastPathComponent()
        .deletingLastPathComponent().deletingLastPathComponent().path
    if derived != app { return "target_path_mismatch" }
    if executable != app + "/Contents/MacOS/" + target.nativeExecutable { return "target_path_mismatch" }
    if !FileManager.default.isExecutableFile(atPath: executable) { return "target_executable_missing" }
    return nil
}

enum ResolveOutcome {
    case ok(NSRunningApplication)
    case failure([String: Any])
}

func resolveTarget(_ target: InputTarget) -> ResolveOutcome {
    if let reason = targetMetadataFailure(target) {
        return .failure(failureObject(reason, target))
    }
    let matches = targetMatches(target)
    if matches.isEmpty { return .failure(failureObject("target_not_running", target, ["matches": 0])) }
    if matches.count > 1 {
        return .failure(failureObject("target_ambiguous", target, [
            "matches": matches.count,
            "pids": matches.map { Int($0.processIdentifier) },
        ]))
    }
    let app = matches[0]
    if let pid = target.pid, pid != app.processIdentifier {
        return .failure(failureObject("target_process_changed", target, ["actual_pid": Int(app.processIdentifier)]))
    }
    if let bundle = app.bundleIdentifier, bundle != target.bundleIdentifier {
        return .failure(failureObject("target_bundle_mismatch", target, ["actual_bundle": bundle]))
    }
    return .ok(app)
}

func permissionsFacts() -> [String: Any] {
    return ["ax_trusted": AXIsProcessTrusted(), "post_access": CGPreflightPostEventAccess()]
}

// 激活等待必须推进主 run loop 的 common-mode 轮次：NSRunningApplication 的动态属性
// 与 NSWorkspace.runningApplications 只在下一次 common-mode 轮次后更新；activateWithOptions
// 的 Bool 只表示请求已发送。这里用真实时钟、独立观测 frontmost PID/目标 isActive，不把
// 返回 true 当完成，也不靠更长 sleep。
struct ActivationWaitHooks {
    let now: () -> TimeInterval
    let advance: (TimeInterval) -> Void
    let frontmostPid: () -> pid_t?
    let targetActive: () -> Bool
    let frontmostIdentity: () -> [String: Any]
}

struct ActivationWaitResult {
    let confirmed: Bool
    let waitedMs: Int
    let advances: Int
    let frontmostBefore: [String: Any]
    let frontmostAfter: [String: Any]
    let targetActive: Bool
}

func waitForActivation(targetPid: pid_t, timeout: TimeInterval = 2.0, slice: TimeInterval = 0.05,
                       hooks: ActivationWaitHooks) -> ActivationWaitResult {
    let started = hooks.now()
    let before = hooks.frontmostIdentity()
    let maxTurns = max(1, Int(ceil(timeout / max(slice, 0.001))) + 2)
    var advances = 0
    var confirmed = false
    while advances < maxTurns {
        let elapsed = hooks.now() - started
        if elapsed >= timeout { break }
        hooks.advance(min(slice, timeout - elapsed))
        advances += 1
        if hooks.frontmostPid() == targetPid && hooks.targetActive() {
            confirmed = true
            break
        }
    }
    let elapsedMs = Int((((hooks.now() - started) * 1000)).rounded())
    return ActivationWaitResult(
        confirmed: confirmed,
        waitedMs: max(0, elapsedMs),
        advances: advances,
        frontmostBefore: before,
        frontmostAfter: hooks.frontmostIdentity(),
        targetActive: hooks.targetActive()
    )
}

// 主 run loop 的 default mode 是 common modes 成员；推进它才会刷新 AppKit 动态属性。
func advanceMainRunLoopCommonMode(_ interval: TimeInterval) {
    CFRunLoopRunInMode(CFRunLoopMode.defaultMode, interval, true)
}

func activationEvidence(_ app: NSRunningApplication) -> [String: Any] {
    let returned = app.activate(options: [])
    let hooks = ActivationWaitHooks(
        now: { ProcessInfo.processInfo.systemUptime },
        advance: { advanceMainRunLoopCommonMode($0) },
        frontmostPid: { NSWorkspace.shared.frontmostApplication?.processIdentifier },
        targetActive: { app.isActive },
        frontmostIdentity: { frontmostIdentity() }
    )
    let waited = waitForActivation(targetPid: app.processIdentifier, hooks: hooks)
    return [
        "requested": true,
        "returned": returned,
        "frontmost_before": waited.frontmostBefore,
        "frontmost_after": waited.frontmostAfter,
        "confirmed": waited.confirmed,
        "waited_ms": waited.waitedMs,
        "target_active": waited.targetActive,
        "advances": waited.advances,
    ]
}

func needsPostAccess(_ gesture: String) -> Bool {
    return ["insert", "key", "click_at", "scroll"].contains(gesture)
}

// 每次投递/分块前都重新解析 target，拒绝检查后的 PID/路径/前台竞争。
func revalidate(_ target: InputTarget, request: [String: Any], gesture: String) -> [String: Any]? {
    let resolved: NSRunningApplication
    switch resolveTarget(target) {
    case .failure(let failure): return failure
    case .ok(let app): resolved = app
    }
    let permissions = permissionsFacts()
    if permissions["ax_trusted"] as? Bool != true {
        return failureObject("ax_trust_required", target, ["permissions": permissions])
    }
    if needsPostAccess(gesture) && permissions["post_access"] as? Bool != true {
        return failureObject("post_access_required", target, ["permissions": permissions])
    }
    if gesture != "activate" {
        let current = frontmostIdentity()
        if (current["pid"] as? Int) != Int(resolved.processIdentifier) {
            return failureObject("not_frontmost", target, ["frontmost": current, "permissions": permissions])
        }
    }
    if request["focus_required"] as? Bool == true {
        let expected = request["expected_focus"] as? [String: Any] ?? [:]
        let focus = focusedFacts(pid: resolved.processIdentifier, expected: expected)
        if focus["matches"] as? Bool != true {
            return failureObject("focus_mismatch", target, ["focus": focus, "permissions": permissions])
        }
        if let enabled = focus["enabled"] as? Bool, enabled == false {
            return failureObject("composer_disabled", target, ["focus": focus, "permissions": permissions])
        }
        let enabledKnown = focus["enabled"] is Bool
        let settable = focus["value_settable"] as? Bool == true
        if !enabledKnown && !settable {
            return failureObject("composer_state_unconfirmed", target, ["focus": focus, "permissions": permissions])
        }
    }
    return nil
}

// ── 事件投递：全部显式 postToPid；factory/poster 可注入以便纯行为测试 ──────────
struct EventPoster<Event> {
    let key: (CGKeyCode, Bool, CGEventFlags) -> Event?
    let chunk: ([UInt16], Bool) -> Event?
    let mouse: (CGEventType, CGPoint, Int64?) -> Event?
    let scroll: (CGPoint, Int32) -> Event?
    let post: (Event, pid_t) -> Void
}

extension EventPoster where Event == CGEvent {
    static let real = EventPoster(
        key: { code, down, flags in
            guard let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down) else { return nil }
            event.flags = flags
            return event
        },
        chunk: { chunk, down in
            guard let event = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: down) else { return nil }
            event.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
            return event
        },
        mouse: { type, point, clickState in
            guard let event = CGEvent(mouseEventSource: nil, mouseType: type, mouseCursorPosition: point, mouseButton: .left) else { return nil }
            if let clickState = clickState {
                event.setIntegerValueField(.mouseEventClickState, value: clickState)
            }
            return event
        },
        scroll: { point, dy in
            guard let event = CGEvent(scrollWheelEvent2Source: nil, units: .pixel, wheelCount: 1,
                                      wheel1: dy, wheel2: 0, wheel3: 0) else { return nil }
            event.location = point
            return event
        },
        post: { event, pid in event.postToPid(pid) }
    )
}

// 投递 ok 只表示事件创建并 post 成功，不表示文本已到达；文本到达仍由 AX 精确值与 WS 判据。
func deliveryOutcome(posted: Int, expected: Int, method: String, extra: [String: Any] = [:]) -> [String: Any] {
    var out = extra
    let ok = expected > 0 && posted >= expected
    out["ok"] = ok
    out["reason"] = ok ? NSNull() : "event_creation_failed"
    out["method"] = method
    out["events"] = posted
    return out
}

func postKeyToPid<Event>(_ pid: pid_t, code: CGKeyCode, flags: CGEventFlags = [],
                         poster: EventPoster<Event>) -> Int {
    var count = 0
    if let down = poster.key(code, true, flags) {
        poster.post(down, pid)
        count += 1
    }
    usleep(40_000)
    if let up = poster.key(code, false, flags) {
        poster.post(up, pid)
        count += 1
    }
    return count
}

func postKeyToPid(_ pid: pid_t, code: CGKeyCode, flags: CGEventFlags = []) -> Int {
    postKeyToPid(pid, code: code, flags: flags, poster: EventPoster<CGEvent>.real)
}

func postChunkToPid<Event>(_ pid: pid_t, chunk: Array<UInt16>, poster: EventPoster<Event>) -> Int {
    var count = 0
    if let down = poster.chunk(chunk, true) {
        poster.post(down, pid)
        count += 1
    }
    usleep(15_000)
    if let up = poster.chunk(chunk, false) {
        poster.post(up, pid)
        count += 1
    }
    usleep(25_000)
    return count
}

func postChunkToPid(_ pid: pid_t, chunk: Array<UInt16>) -> Int {
    postChunkToPid(pid, chunk: chunk, poster: EventPoster<CGEvent>.real)
}

func postMouseToPid<Event>(_ pid: pid_t, point: CGPoint, count: Int = 1,
                           poster: EventPoster<Event>) -> Int {
    var posted = 0
    if let move = poster.mouse(.mouseMoved, point, nil) {
        poster.post(move, pid)
        posted += 1
    }
    usleep(40_000)
    for i in 1...max(1, count) {
        if let down = poster.mouse(.leftMouseDown, point, Int64(i)) {
            poster.post(down, pid)
            posted += 1
        }
        usleep(30_000)
        if let up = poster.mouse(.leftMouseUp, point, Int64(i)) {
            poster.post(up, pid)
            posted += 1
        }
        usleep(60_000)
    }
    return posted
}

func postMouseToPid(_ pid: pid_t, point: CGPoint, count: Int = 1) -> Int {
    postMouseToPid(pid, point: point, count: count, poster: EventPoster<CGEvent>.real)
}

func postScrollToPid<Event>(_ pid: pid_t, point: CGPoint, dy: Int32,
                            poster: EventPoster<Event>) -> Int {
    var posted = 0
    if let move = poster.mouse(.mouseMoved, point, nil) {
        poster.post(move, pid)
        posted += 1
    }
    usleep(80_000)
    if let scroll = poster.scroll(point, dy) {
        poster.post(scroll, pid)
        posted += 1
    }
    return posted
}

func postScrollToPid(_ pid: pid_t, point: CGPoint, dy: Int32) -> Int {
    postScrollToPid(pid, point: point, dy: dy, poster: EventPoster<CGEvent>.real)
}

let keyCodes: [String: CGKeyCode] = ["return": 36, "enter": 36, "tab": 48, "escape": 53, "esc": 53,
    "space": 49, "delete": 51, "backspace": 51, "up": 126, "down": 125, "left": 123, "right": 124,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "a": 0, "c": 8, "v": 9, "x": 7, "z": 6, "g": 5, "f": 3, "l": 37]

func json(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) { print(s) }
}

func jsonArray(_ obj: [[String: Any]]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) { print(s) }
}

func readObjectArg(_ value: String) -> [String: Any]? {
    guard let data = value.data(using: .utf8),
          let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
    return object
}

// probe 是观测：只组装 target/resolution/permissions/frontmost/focus，不产出 activation。
// activation 是 input 操作事实，由 runInput 的 activationEvidence/operationEvidence 提供。
func probeEvidence(target: InputTarget, pid: pid_t, executablePath: String, bundleIdentifier: String,
                   frontmost: [String: Any], permissions: [String: Any],
                   focus: [String: Any]? = nil) -> [String: Any] {
    var out: [String: Any] = [
        "ok": true,
        "target": targetIdentity(target),
        "resolution": [
            "matches": [[
                "pid": Int(pid),
                "executable_path": executablePath,
                "bundle_identifier": bundleIdentifier,
            ]],
            "pid": Int(pid),
        ],
        "permissions": permissions,
        "frontmost": frontmost,
    ]
    if let focus = focus { out["focus"] = focus }
    return out
}

// input 操作结果：保留本次操作自己的 activation/method/focus/events 等字段，
// 只补 target、操作后 permissions 与 frontmost_after；不拿 probe 的事前快照顶替。
func operationEvidence(target: InputTarget, result: [String: Any],
                       permissions: [String: Any], frontmostAfter: [String: Any]) -> [String: Any] {
    var out = result
    out["target"] = targetIdentity(target)
    out["permissions"] = permissions
    out["frontmost_after"] = frontmostAfter
    return out
}

func probe(target: InputTarget, request: [String: Any]) -> [String: Any] {
    switch resolveTarget(target) {
    case .failure(let failure): return failure
    case .ok(let app):
        let focus: [String: Any]? = (request["focus_required"] as? Bool == true || request["expected_focus"] != nil)
            ? focusedFacts(pid: app.processIdentifier, expected: request["expected_focus"] as? [String: Any] ?? [:])
            : nil
        return probeEvidence(
            target: target,
            pid: app.processIdentifier,
            executablePath: canonicalPath(app.executableURL?.path ?? ""),
            bundleIdentifier: app.bundleIdentifier ?? "",
            frontmost: frontmostIdentity(),
            permissions: permissionsFacts(),
            focus: focus
        )
    }
}

func runInput(target: InputTarget, request: [String: Any]) -> [String: Any] {
    guard let gesture = request["gesture"] as? String else { return failureObject("gesture_missing", target) }
    if let failure = revalidate(target, request: request, gesture: gesture) { return failure }
    let app: NSRunningApplication
    switch resolveTarget(target) {
    case .failure(let failure): return failure
    case .ok(let resolved): app = resolved
    }
    let pid = app.processIdentifier
    let result: [String: Any]
    switch gesture {
    case "activate":
        let activation = activationEvidence(app)
        let ok = activation["confirmed"] as? Bool == true
        result = ["ok": ok, "reason": ok ? NSNull() : "activation_unconfirmed", "activation": activation]
    case "focus":
        guard let path = request["path"] as? String,
              let element = elementAt(pid: pid, path: path) else {
            return failureObject("no_element", target)
        }
        let setOk = AXUIElementSetAttributeValue(element, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
        let expected = request["expected_focus"] as? [String: Any] ?? [:]
        let deadline = Date().addingTimeInterval(0.6)
        var focus = focusedFacts(pid: pid, expected: expected)
        var confirmed = false
        while Date() < deadline {
            focus = focusedFacts(pid: pid, expected: expected)
            if setOk && focus["matches"] as? Bool == true { confirmed = true; break }
            usleep(50_000)
        }
        result = ["ok": confirmed, "reason": confirmed ? NSNull() : "focus_not_confirmed",
                  "method": "axfocus", "focus": focus]
    case "click":
        guard let path = request["path"] as? String,
              let element = elementAt(pid: pid, path: path) else {
            return failureObject("no_element", target)
        }
        let action = (request["action"] as? String) ?? "AXPress"
        let ok = AXUIElementPerformAction(element, action as CFString) == .success
        result = ["ok": ok, "reason": ok ? NSNull() : "axpress_failed", "method": "axpress", "action": action]
    case "click_at":
        let point = CGPoint(x: request["x"] as? Double ?? 0, y: request["y"] as? Double ?? 0)
        let count = request["count"] as? Int ?? 1
        let posted = postMouseToPid(pid, point: point, count: count)
        result = deliveryOutcome(posted: posted, expected: 1 + 2 * max(1, count), method: "cgevent_to_pid")
    case "scroll":
        let point = CGPoint(x: request["x"] as? Double ?? 0, y: request["y"] as? Double ?? 0)
        let posted = postScrollToPid(pid, point: point, dy: Int32(request["dy"] as? Int ?? 0))
        result = deliveryOutcome(posted: posted, expected: 2, method: "cgevent_to_pid")
    case "scroll_to":
        guard let path = request["path"] as? String,
              let element = elementAt(pid: pid, path: path) else {
            return failureObject("no_element", target)
        }
        let ok = AXUIElementPerformAction(element, "AXScrollToVisible" as CFString) == .success
        result = ["ok": ok, "reason": ok ? NSNull() : "axscrolltovisible_failed",
                  "method": "axscrolltovisible"]
    case "key":
        guard let name = request["key"] as? String else { return failureObject("key_missing", target) }
        let names = name.lowercased().split(separator: "+").map(String.init)
        guard let keyName = names.last, let code = keyCodes[keyName] else {
            return failureObject("unknown_key", target)
        }
        var flags: CGEventFlags = []
        for modifier in names.dropLast() {
            if modifier == "cmd" { flags.insert(.maskCommand) }
            else if modifier == "shift" { flags.insert(.maskShift) }
            else if modifier == "alt" { flags.insert(.maskAlternate) }
            else if modifier == "ctrl" { flags.insert(.maskControl) }
        }
        let posted = postKeyToPid(pid, code: code, flags: flags)
        result = deliveryOutcome(posted: posted, expected: 2, method: "cgevent_to_pid", extra: ["key": keyName])
    case "insert":
        guard let text = request["text"] as? String else { return failureObject("text_missing", target) }
        let scalars = Array(text.utf16)
        var delivered = 0
        var i = 0
        while i < scalars.count {
            // 每块前重新核验；焦点/前台/进程变化立即停，不补发、不重试。
            if let failure = revalidate(target, request: request, gesture: gesture) {
                var out = failure
                out["delivered_chunks"] = delivered
                out["input_length"] = scalars.count
                return out
            }
            let chunk = Array(scalars[i..<min(i + 16, scalars.count)])
            let events = postChunkToPid(pid, chunk: chunk)
            if events < 2 {
                // 创建/投递失败必须显式失败；不把“函数返回了”当成文本已到达。
                return failureObject("event_creation_failed", target, [
                    "delivered_chunks": delivered,
                    "input_length": scalars.count,
                    "events": events,
                    "method": "cgevent_to_pid",
                ])
            }
            delivered += 1
            i += chunk.count
        }
        result = ["ok": true, "reason": NSNull(), "method": "cgevent_to_pid",
                  "delivered_chunks": delivered, "events": delivered * 2,
                  "input_length": scalars.count]
    case "set":
        guard let path = request["path"] as? String,
              let element = elementAt(pid: pid, path: path),
              let value = request["value"] as? String else {
            return failureObject("no_element", target)
        }
        let ok = AXUIElementSetAttributeValue(element, kAXValueAttribute as CFString, value as CFString) == .success
        result = ["ok": ok, "reason": ok ? NSNull() : "axset_failed", "method": "axset"]
    default:
        return failureObject("unknown_gesture", target)
    }
    return operationEvidence(
        target: target,
        result: result,
        permissions: permissionsFacts(),
        frontmostAfter: frontmostIdentity()
    )
}

func runMain() {
    let args = CommandLine.arguments
    guard args.count >= 2, args[1] != "--help" else {
        print("usage: axcua <read-cmd> <app> ... | axcua resolve <target-json> | axcua startup <target-json> | axcua probe <target-json> <request-json> | axcua input <target-json> <request-json>")
        exit(64)
    }
    let cmd = args[1]
    if cmd == "apps" {
        jsonArray(allApps())
        exit(0)
    }
    if cmd == "frontmost" {
        json(frontmostIdentity())
        exit(0)
    }
    if cmd == "resolve" {
        guard args.count >= 3, let object = readObjectArg(args[2]), let target = InputTarget(object) else {
            json(failureObject("target_json_invalid")); exit(64)
        }
        switch resolveTarget(target) {
        case .failure(let failure):
            json(failure)
        case .ok(let app):
            json([
                "ok": true,
                "target": targetIdentity(target),
                "matches": [[
                    "pid": Int(app.processIdentifier),
                    "executable_path": canonicalPath(app.executableURL?.path ?? ""),
                    "bundle_identifier": app.bundleIdentifier ?? "",
                ]],
                "pid": Int(app.processIdentifier),
                "startup": startupRunningFacts(app),
            ])
        }
        exit(0)
    }
    if cmd == "startup" {
        guard args.count >= 3, let object = readObjectArg(args[2]), let target = InputTarget(object) else {
            json(failureObject("target_json_invalid")); exit(64)
        }
        switch resolveTarget(target) {
        case .failure(let failure): json(failure)
        case .ok(let app):
            var facts = startupRunningFacts(app)
            for (key, value) in axSurfaceFacts(pid: app.processIdentifier) { facts[key] = value }
            facts["ok"] = true
            facts["pid"] = Int(app.processIdentifier)
            facts["target"] = targetIdentity(target)
            json(facts)
        }
        exit(0)
    }
    if ["dump-target", "dumpall-target", "screenshot-target", "focused-target"].contains(cmd) {
        guard args.count >= 3, let object = readObjectArg(args[2]), let target = InputTarget(object) else {
            json(failureObject("target_json_invalid")); exit(64)
        }
        switch resolveTarget(target) {
        case .failure(let failure): json(failure)
        case .ok(let app):
            let pid = app.processIdentifier
            switch cmd {
            case "dump-target":
                let maxNodes = args.count > 3 ? (Int(args[3]) ?? 3000) : 3000
                jsonArray(dump(pid: pid, maxNodes: maxNodes))
            case "dumpall-target":
                let maxNodes = args.count > 3 ? (Int(args[3]) ?? 4000) : 4000
                jsonArray(dumpAll(pid: pid, maxNodes: maxNodes))
            case "screenshot-target":
                guard args.count > 3 else { json(failureObject("path_missing", target)); exit(64) }
                json(["ok": screenshot(pid: pid, path: args[3]), "target": targetIdentity(target)])
            default:
                json(focusedFacts(pid: pid))
            }
        }
        exit(0)
    }
    if cmd == "probe" || cmd == "input" {
        guard args.count >= 4, let targetObject = readObjectArg(args[2]),
              let target = InputTarget(targetObject), let request = readObjectArg(args[3]) else {
            json(failureObject("target_or_request_json_invalid")); exit(64)
        }
        json(cmd == "probe" ? probe(target: target, request: request) : runInput(target: target, request: request))
        exit(0)
    }

    guard args.count >= 3 else {
        print("usage: axcua <read-cmd> <app> ...")
        exit(64)
    }
    let app = args[2]
    guard let pid = pidOf(app: app) else { json(["error": "app_not_running", "app": app]); exit(3) }
    switch cmd {
    case "pid": json(["pid": pid])
    case "dump":
        let maxNodes = args.count > 3 ? (Int(args[3]) ?? 3000) : 3000
        jsonArray(dump(pid: pid, maxNodes: maxNodes))
    case "dumpall":
        let maxNodes = args.count > 3 ? (Int(args[3]) ?? 4000) : 4000
        jsonArray(dumpAll(pid: pid, maxNodes: maxNodes))
    case "screenshot":
        json(["ok": screenshot(pid: pid, path: args[3])])
    case "focused":
        json(focusedFacts(pid: pid))
    case "windows":
        let appEl = AXUIElementCreateApplication(pid)
        json(["windows": windows(appEl).enumerated().map { i, w in ["index": i, "title": title(w)] }])
    case "debug":
        let appEl = AXUIElementCreateApplication(pid)
        var out: [String: Any] = [:]
        for name in ["AXWindows", "AXFocusedWindow", "AXMainWindow", "AXChildren", "AXFocusedUIElement"] {
            var v: CFTypeRef?
            let err = AXUIElementCopyAttributeValue(appEl, name as CFString, &v)
            var info: [String: Any] = ["err": err.rawValue]
            if let v = v {
                if let arr = v as? [AXUIElement] { info["count"] = arr.count }
                else { info["value"] = String(describing: v).prefix(80).description }
            }
            out[name] = info
        }
        json(out)
    default: json(["error": "unknown_cmd"]); exit(64)
    }
}
