import Foundation
import ApplicationServices
import CoreGraphics
import AppKit

// External harness AX/CUA driver for native macOS apps (OpenAI Computer-Use replacement).
func attr(_ el: AXUIElement, _ name: String) -> CFTypeRef? {
    var value: CFTypeRef?
    return AXUIElementCopyAttributeValue(el, name as CFString, &value) == .success ? value : nil
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
func title(_ el: AXUIElement) -> String { let t = str(el, kAXTitleAttribute); return t }
func descString(_ el: AXUIElement) -> String {
    let d = str(el, kAXDescriptionAttribute); if !d.isEmpty { return d }
    let h = str(el, kAXHelpAttribute); if !h.isEmpty { return h }
    return str(el, kAXPlaceholderValueAttribute)
}
func valueString(_ el: AXUIElement) -> String {
    if let v = attr(el, kAXValueAttribute) { return String(describing: v) }
    return ""
}
func frameOf(_ el: AXUIElement) -> (CGPoint, CGSize)? {
    guard let p = attr(el, kAXPositionAttribute), let s = attr(el, kAXSizeAttribute) else { return nil }
    var pt = CGPoint.zero; var sz = CGSize.zero
    guard AXValueGetValue(p as! AXValue, .cgPoint, &pt), AXValueGetValue(s as! AXValue, .cgSize, &sz) else { return nil }
    return (pt, sz)
}
func pidOf(app: String) -> pid_t? {
    let running = NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }
    let exact = running.filter { ($0.localizedName ?? "") == app || ($0.bundleIdentifier ?? "") == app }
    let partial = running.filter { ($0.executableURL?.path ?? "").contains(app) || ($0.bundleIdentifier ?? "").contains(app) }
    return (exact.first ?? partial.first)?.processIdentifier
}
func allApps() -> [[String: Any]] {
    return NSWorkspace.shared.runningApplications.filter { $0.activationPolicy == .regular }.map { ["name": $0.localizedName ?? "", "bundle": $0.bundleIdentifier ?? "", "pid": Int($0.processIdentifier)] }
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

func dump(pid: pid_t, maxNodes: Int) -> [[String: Any]] {
    var out: [[String: Any]] = []
    func walk(_ el: AXUIElement, _ depth: Int, _ path: String) {
        if out.count >= maxNodes { return }
        var node: [String: Any] = ["path": path, "depth": depth, "role": role(el),
            "title": title(el), "desc": descString(el), "value": valueString(el), "subrole": str(el, kAXSubroleAttribute)]
        var actions: [String] = []
        var names: CFArray?
        if AXUIElementCopyActionNames(el, &names) == .success, let arr = names as? [String] { actions = arr }
        node["actions"] = actions
        if let (pt, sz) = frameOf(el) { node["frame"] = [pt.x, pt.y, sz.width, sz.height] }
        out.append(node)
        for (i, c) in children(el).enumerated() { walk(c, depth + 1, "\(path)/\(i)") }
    }
    let appEl = AXUIElementCreateApplication(pid)
    if let wins = attr(appEl, kAXWindowsAttribute) as? [AXUIElement], let w = wins.first { walk(w, 0, "0") }
    else { walk(appEl, 0, "0") }
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

func mouseClick(_ point: CGPoint, count: Int = 1) {
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    usleep(40_000)
    for i in 1...max(1, count) {
        let down = CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)
        down?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        down?.post(tap: .cghidEventTap)
        usleep(30_000)
        let up = CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)
        up?.setIntegerValueField(.mouseEventClickState, value: Int64(i))
        up?.post(tap: .cghidEventTap)
        usleep(60_000)
    }
}

func typeText(_ text: String) {
    let scalars = Array(text.utf16)
    var i = 0
    while i < scalars.count {
        let chunk = Array(scalars[i..<min(i + 16, scalars.count)])
        let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
        down?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
        down?.post(tap: .cghidEventTap)
        usleep(15_000)
        let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
        up?.keyboardSetUnicodeString(stringLength: chunk.count, unicodeString: chunk)
        up?.post(tap: .cghidEventTap)
        usleep(25_000)
        i += chunk.count
    }
}

func pressKey(_ code: CGKeyCode, flags: CGEventFlags = []) {
    let down = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: true)
    down?.flags = flags
    down?.post(tap: .cghidEventTap)
    usleep(40_000)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: false)
    up?.flags = flags
    up?.post(tap: .cghidEventTap)
}

let keyCodes: [String: CGKeyCode] = ["return": 36, "enter": 36, "tab": 48, "escape": 53, "esc": 53,
    "space": 49, "delete": 51, "backspace": 51, "up": 126, "down": 125, "left": 123, "right": 124,
    "home": 115, "end": 119, "pageup": 116, "pagedown": 121, "a": 0, "c": 8, "v": 9, "x": 7, "z": 6, "g": 5, "f": 3, "l": 37]

func json(_ obj: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: obj), let s = String(data: data, encoding: .utf8) { print(s) }
}

func main() {
    let args = CommandLine.arguments
    guard args.count >= 2, args[1] != "--help" else { print("usage: axcua <cmd> <app> ..."); exit(64) }
    let cmd = args[1]
    if cmd == "apps" {
        if let d = try? JSONSerialization.data(withJSONObject: allApps()), let s = String(data: d, encoding: .utf8) { print(s) }
        exit(0)
    }
    guard args.count >= 3 else { print("usage: axcua <cmd> <app> ..."); exit(64) }
    let app = args[2]
    guard let pid = pidOf(app: app) else { json(["error": "app_not_running", "app": app]); exit(3) }
    switch cmd {
    case "pid": json(["pid": pid])
    case "dump":
        let maxNodes = args.count > 3 ? (Int(args[3]) ?? 3000) : 3000
        let nodes = dump(pid: pid, maxNodes: maxNodes)
        if let data = try? JSONSerialization.data(withJSONObject: nodes), let s = String(data: data, encoding: .utf8) { print(s) }
    case "click":
        guard let el = elementAt(pid: pid, path: args[3]) else { json(["ok": false, "error": "no_element"]); exit(4) }
        var names: CFArray?
        let actionName = args.count > 4 ? args[4] : "AXPress"
        let ok = AXUIElementPerformAction(el, actionName as CFString) == .success
        if !ok, let (pt, sz) = frameOf(el) {
            if let app2 = NSWorkspace.shared.runningApplications.first(where: { $0.processIdentifier == pid }) {
                app2.activate(options: [.activateIgnoringOtherApps]); usleep(150_000)
            }
            mouseClick(CGPoint(x: pt.x + sz.width / 2, y: pt.y + sz.height / 2))
            json(["ok": true, "method": "mouse"]); return
        }
        json(["ok": ok, "method": "axpress"])
    case "clickxy":
        let x = Double(args[3]) ?? 0, y = Double(args[4]) ?? 0
        if let app2 = NSWorkspace.shared.runningApplications.first(where: { $0.processIdentifier == pid }) {
            app2.activate(options: [.activateIgnoringOtherApps]); usleep(120_000)
        }
        mouseClick(CGPoint(x: x, y: y), count: args.count > 5 ? (Int(args[5]) ?? 1) : 1)
        json(["ok": true])
    case "set":
        guard let el = elementAt(pid: pid, path: args[3]) else { json(["ok": false, "error": "no_element"]); exit(4) }
        json(["ok": AXUIElementSetAttributeValue(el, kAXValueAttribute as CFString, args[4] as CFString) == .success])
    case "focus":
        guard let el = elementAt(pid: pid, path: args[3]) else { json(["ok": false, "error": "no_element"]); exit(4) }
        let f = AXUIElementSetAttributeValue(el, kAXFocusedAttribute as CFString, kCFBooleanTrue) == .success
        json(["ok": f])
    case "focused":
        let appEl = AXUIElementCreateApplication(pid)
        if let fe = attr(appEl, kAXFocusedUIElementAttribute) {
            let el = fe as! AXUIElement
            var node: [String: Any] = ["role": role(el), "title": title(el), "desc": descString(el), "value": valueString(el)]
            if let (pt, sz) = frameOf(el) { node["frame"] = [pt.x, pt.y, sz.width, sz.height] }
            json(node)
        } else { json(["error": "no_focused"]) }
    case "screenshot":
        json(["ok": screenshot(pid: pid, path: args[3])])
    case "type":
        if let app2 = NSWorkspace.shared.runningApplications.first(where: { $0.processIdentifier == pid }) {
            app2.activate(options: [.activateIgnoringOtherApps]); usleep(100_000)
        }
        typeText(args[3]); json(["ok": true])
    case "key":
        if let app2 = NSWorkspace.shared.runningApplications.first(where: { $0.processIdentifier == pid }) {
            app2.activate(options: [.activateIgnoringOtherApps]); usleep(80_000)
        }
        let names = args[3].lowercased().split(separator: "+").map(String.init)
        guard let keyName = names.last, let code = keyCodes[keyName] else { json(["error": "unknown_key"]); exit(64) }
        var flags: CGEventFlags = []
        for m in names.dropLast() { if m == "cmd" { flags.insert(.maskCommand) } else if m == "shift" { flags.insert(.maskShift) } else if m == "alt" { flags.insert(.maskAlternate) } else if m == "ctrl" { flags.insert(.maskControl) } }
        pressKey(code, flags: flags); json(["ok": true])
    case "activate":
        if let app2 = NSWorkspace.shared.runningApplications.first(where: { $0.processIdentifier == pid }) {
            app2.activate(options: [.activateIgnoringOtherApps]); json(["ok": true])
        } else { json(["ok": false]) }
    case "enhance":
        let appEl = AXUIElementCreateApplication(pid)
        let r1 = AXUIElementSetAttributeValue(appEl, "AXEnhancedUserInterface" as CFString, kCFBooleanTrue)
        let r2 = AXUIElementSetAttributeValue(appEl, "AXManualAccessibility" as CFString, kCFBooleanTrue)
        json(["enhanced": r1 == .success, "manual": r2 == .success])
    case "apps":
        if let d = try? JSONSerialization.data(withJSONObject: allApps()), let s = String(data: d, encoding: .utf8) { print(s) }
    case "dumpall":
        let maxNodes = args.count > 3 ? (Int(args[3]) ?? 4000) : 4000
        do {
            let appEl = AXUIElementCreateApplication(pid)
            var out: [[String: Any]] = []
            var stack: [(AXUIElement, Int)] = [(appEl, 0)]
            var seen = Set<CFHashCode>()
            while let (el, depth) = stack.popLast(), out.count < maxNodes {
                let h = CFHash(el)
                if seen.contains(h) { continue }
                seen.insert(h)
                var node: [String: Any] = ["depth": depth, "role": role(el), "title": title(el), "desc": descString(el), "value": valueString(el)]
                if let (pt, sz) = frameOf(el) { node["frame"] = [pt.x, pt.y, sz.width, sz.height] }
                var actions: [String] = []
                var names: CFArray?
                if AXUIElementCopyActionNames(el, &names) == .success, let arr = names as? [String] { actions = arr }
                node["actions"] = actions
                out.append(node)
                for c in children(el).reversed() { stack.append((c, depth + 1)) }
            }
            if let data = try? JSONSerialization.data(withJSONObject: out), let s = String(data: data, encoding: .utf8) { print(s) }
        }
        exit(0)
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
        if let d = try? JSONSerialization.data(withJSONObject: out), let s = String(data: d, encoding: .utf8) { print(s) }
    case "windows":
        let appEl = AXUIElementCreateApplication(pid)
        json(["windows": windows(appEl).enumerated().map { i, w in ["index": i, "title": title(w)] }])
    case "closewindow":
        guard let el = elementAt(pid: pid, path: "0") else { json(["ok": false]); exit(4) }
        json(["ok": AXUIElementPerformAction(el, "AXClose" as CFString) == .success])
    default: json(["error": "unknown_cmd"]); exit(64)
    }
}
main()
