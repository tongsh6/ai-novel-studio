// B26 CP4：judgment-plan-multi-step 的三路径真实原生窗口验收驱动。
//
// 外部自动化边界：只通过 macOS CGEvent/AX 像作者一样操作当前真实 Tauri 窗口
// （点底部输入框 → 粘贴自然语言 → 回车），再读取原生窗口截图、真实 Channel
// 帧（native-transport.jsonl）、应用 JSONL 日志与 provider 调用日志作为证据。
// 不读取任何产品验收开关，不在产品代码放置验收钩子，不直推 Channel。
//
// 驱动程序（可复跑）：
//   swiftc -O scripts/macos_cgevent_plan_matrix_driver.swift -o /tmp/plan_matrix_driver
//   SLICE_VERIFY_ARTIFACT_DIR=<artifact-dir> /tmp/plan_matrix_driver
// 环境变量 NATIVE_PLAN_PROBE=1 时只做窗口/AX 探针并落 native-driver-probe.json。
//
// 复用 scripts/macos_cgevent_local_secret_file_driver.swift 的 helper 语义
// （findTauriWindow / activate / click / pressKey / typeText / readJsonlRecords /
// writeJson），本文件独立可复跑，不依赖其它 Swift 源文件。

import AppKit
import CoreGraphics
import Foundation

struct DriverFailure: Error, CustomStringConvertible {
  let description: String
}

struct ReadyInfo {
  let runRef: String
  let appPath: String
  let apiUrl: String
  let tauriHome: String
  let desktopProfile: String
  let readyAt: Date
}

struct TauriWindow {
  let pid: pid_t
  let number: UInt32
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct Composer {
  let element: AXUIElement
  let x: Double
  let y: Double
  let width: Double
  let height: Double
  let description: String
}

struct TerminalRun {
  let runId: String
  let status: String
  let profileRef: String
  let providerCalls: Int
  let toolCalls: Int
  let replans: Int
}

let artifactDir: String = {
  guard
    let value = ProcessInfo.processInfo.environment["SLICE_VERIFY_ARTIFACT_DIR"],
    !value.isEmpty
  else {
    fputs("[plan-matrix-driver] missing SLICE_VERIFY_ARTIFACT_DIR\n", stderr)
    exit(64)
  }
  return value
}()

let driverName = "macos-cgevent-plan-matrix"
let appBundle = "com.ai-novel-studio.app"
let probeMode = ProcessInfo.processInfo.environment["NATIVE_PLAN_PROBE"] == "1"

let modes = ["同批计划", "另行起草计划", "先核对再补齐计划"]
let messages = [
  "请按同批计划设计一个角色，再设计相关世界设定。",
  "请按另行起草计划设计一个角色，再设计相关世界设定。",
  "请按先核对再补齐计划设计一个角色，再设计相关世界设定。",
]
let expectedProviderCalls = [3, 4, 5]
let expectedReplans = [0, 0, 1]
let turnScreenshotNames = [
  "01-same-batch-plan.jpg",
  "02-independent-draft-plan.jpg",
  "03-verify-then-revise-plan.jpg",
]

var debug: [String: Any] = [
  "driver": driverName,
  "app_bundle": appBundle,
  "product_acceptance_hooks_added": false,
  "started_at": isoNow(),
]

do {
  let ready = try waitForReady(timeout: 600)
  debug["ready"] = [
    "run_ref": ready.runRef,
    "api_url": ready.apiUrl,
    "app_path": ready.appPath,
    "tauri_home": ready.tauriHome,
    "desktop_profile": ready.desktopProfile,
    "ready_at": isoNowString(ready.readyAt),
  ]

  let discovered = try waitForStableTauriWindow(timeout: 120)
  debug["window_discovered"] = [
    "pid": Int(discovered.pid),
    "number": Int(discovered.number),
    "x": discovered.x,
    "y": discovered.y,
    "width": discovered.width,
    "height": discovered.height,
  ]

  // Tauri 窗口初始位置可能是过渡态（实测有一次 window.x=-376，输入框坐标落到屏幕外）。
  // 像用户拖动窗口一样先把它摆到屏幕内固定位置，再取真实 frame 定位 composer。
  let window = try prepareWindowOnScreen(pid: discovered.pid)
  debug["window"] = [
    "pid": Int(window.pid),
    "number": Int(window.number),
    "x": window.x,
    "y": window.y,
    "width": window.width,
    "height": window.height,
  ]
  try? writeJson(debug, to: "\(artifactDir)/native-driver-run.json")

  activate(pid: window.pid)
  dismissSystemEventsPromptIfPresent()

  if probeMode {
    try runProbe(window: window)
    exit(0)
  }

  let joined = try waitForJoinedWork(timeout: 120)
  debug["joined_before_drive"] = ["work_id": joined.workId, "session_id": joined.sessionId]

  // WebView 首帧/窗口落位后仍需一点时间才能稳定接受键盘事件。
  Thread.sleep(forTimeInterval: 1.5)
  guard ensureFrontmost(pid: window.pid) else {
    throw DriverFailure(description: "Tauri app did not become frontmost before driving")
  }
  let composer = try waitForComposer(window: window, timeout: 180)
  debug["composer_initial"] = composer.description
  Thread.sleep(forTimeInterval: 0.8)
  try captureWindow(window, name: "00-workbench-ready.jpg")

  var screenshots = ["00-workbench-ready.jpg"]
  var turns: [String: String] = [:]
  var observations: [[String: Any]] = []
  var workId = joined.workId
  var sessionId = joined.sessionId
  let started = Date()

  for (index, mode) in modes.enumerated() {
    if Date().timeIntervalSince(started) > 900 {
      throw DriverFailure(description: "driver budget exhausted before path \(mode)")
    }

    let message = messages[index]
    let llmBefore = llmLogRowCount()

    let sent = try submitMessage(
      message: message,
      expectedMode: mode,
      window: window,
      timeout: 60
    )
    turns[mode] = sent.turnId
    if !sent.workId.isEmpty { workId = sent.workId }
    if !sent.sessionId.isEmpty { sessionId = sent.sessionId }
    debug["turn_\(index + 1)_sent"] = [
      "mode": mode,
      "turn_id": sent.turnId,
      "work_id": sent.workId,
      "session_id": sent.sessionId,
      "text": sent.text,
    ]
    try? writeJson(debug, to: "\(artifactDir)/native-driver-run.json")

    let terminal = try waitForTerminalRun(parentTurn: sent.turnId, timeout: 300)
    debug["turn_\(index + 1)_terminal"] = [
      "run_id": terminal.runId,
      "status": terminal.status,
      "profile_ref": terminal.profileRef,
      "provider_calls": terminal.providerCalls,
      "tool_calls": terminal.toolCalls,
      "replans": terminal.replans,
      "expected_provider_calls": expectedProviderCalls[index],
      "expected_replans": expectedReplans[index],
    ]

    if terminal.status != "completed" {
      try? captureWindow(window, name: "99-turn-\(index + 1)-\(terminal.status).jpg")
      throw DriverFailure(
        description:
          "run \(terminal.runId) ended with \(terminal.status) for \(mode)"
      )
    }

    Thread.sleep(forTimeInterval: 1.6)
    let shot = turnScreenshotNames[index]
    try captureWindow(window, name: shot)
    screenshots.append(shot)

    let llmRows = llmLogRows(since: llmBefore)
    let appEvents = appLogEventSummary(parentTurn: sent.turnId)
    let observation: [String: Any] = [
      "mode": mode,
      "message": message,
      "turn_id": sent.turnId,
      "run_id": terminal.runId,
      "screenshot": shot,
      "provider_calls": terminal.providerCalls,
      "tool_calls": terminal.toolCalls,
      "replans": terminal.replans,
      "llm_provider_calls": llmRows.map { row -> [String: Any] in
        [
          "turn_id": row["turn_id"] ?? NSNull(),
          "work_id": row["work_id"] ?? NSNull(),
          "session_id": row["session_id"] ?? NSNull(),
          "tool_choice": row["tool_choice"] ?? NSNull(),
          "tools": (row["tools"] as? [[String: Any]] ?? []).compactMap { $0["name"] as? String },
        ]
      },
      "app_log_events": appEvents,
    ]
    observations.append(observation)
    debug["turn_\(index + 1)_observed"] = observation
    try? writeJson(debug, to: "\(artifactDir)/native-driver-run.json")
  }

  try captureWindow(window, name: "04-final-workbench.jpg")
  screenshots.append("04-final-workbench.jpg")

  let evidence: [String: Any] = [
    "harness_run_ref": ready.runRef,
    "driver": driverName,
    "app_bundle": appBundle,
    "screenshots": screenshots,
    "work_id": workId,
    "session_id": sessionId,
    "turns": turns,
    "observed": observations,
    "sent_inputs": messages,
    "captured_at": isoNow(),
  ]
  try writeJson(evidence, to: "\(artifactDir)/native-ui-complete.json")

  debug["status"] = "done"
  debug["screenshots"] = screenshots
  debug["turns"] = turns
  debug["work_id"] = workId
  debug["session_id"] = sessionId
  try writeJson(debug, to: "\(artifactDir)/native-driver-run.json")
  print("[plan-matrix-driver] native-ui-complete.json written to \(artifactDir)")
  exit(0)
} catch {
  debug["status"] = "failed"
  debug["error"] = String(describing: error)
  try? writeJson(debug, to: "\(artifactDir)/native-driver-run.json")
  if let window = findTauriWindow() {
    try? captureWindow(window, name: "99-driver-failed.jpg")
  }
  fputs("[plan-matrix-driver] failed: \(error)\n", stderr)
  exit(1)
}

// MARK: - 真实窗口与 AX/CGEvent 操作

func waitForReady(timeout: TimeInterval) throws -> ReadyInfo {
  let path = "\(artifactDir)/native-driver-ready.json"
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if let data = FileManager.default.contents(atPath: path),
      let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let runRef = object["run_ref"] as? String,
      let appPath = object["app_path"] as? String,
      let apiUrl = object["api_url"] as? String,
      let tauriHome = object["tauri_home"] as? String,
      let desktopProfile = object["desktop_profile"] as? String,
      let readyAtText = object["ready_at"] as? String
    {
      return ReadyInfo(
        runRef: runRef,
        appPath: appPath,
        apiUrl: apiUrl,
        tauriHome: tauriHome,
        desktopProfile: desktopProfile,
        readyAt: parseIsoDate(readyAtText) ?? Date()
      )
    }
    Thread.sleep(forTimeInterval: 0.5)
  }
  throw DriverFailure(description: "native-driver-ready.json did not appear at \(path)")
}

func waitForTauriWindow(timeout: TimeInterval) throws -> TauriWindow {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if let window = findTauriWindow() {
      return window
    }
    Thread.sleep(forTimeInterval: 0.5)
  }
  throw DriverFailure(description: "real Tauri app window was not found")
}

// Tauri 窗口创建后可能先出现在过渡位置（实测 window.x=-376），等 bounds 连续稳定
// 再取 frame 驱动，避免用过渡坐标点击。
func waitForStableTauriWindow(timeout: TimeInterval) throws -> TauriWindow {
  let deadline = Date().addingTimeInterval(timeout)
  var previous: TauriWindow?
  var stableCount = 0

  while Date() < deadline {
    if let window = findTauriWindow() {
      if let previous, sameBounds(previous, window) {
        stableCount += 1
        if stableCount >= 3 { return window }
      } else {
        stableCount = 0
      }
      previous = window
    }
    Thread.sleep(forTimeInterval: 0.4)
  }
  throw DriverFailure(description: "real Tauri app window did not reach stable bounds")
}

func sameBounds(_ lhs: TauriWindow, _ rhs: TauriWindow) -> Bool {
  abs(lhs.x - rhs.x) < 1 && abs(lhs.y - rhs.y) < 1
    && abs(lhs.width - rhs.width) < 1 && abs(lhs.height - rhs.height) < 1
}

// 像用户拖动窗口一样把真实窗口摆进屏幕可见区域，保证 composer 的 AX frame 坐标
// 落在屏幕内；不改变任何产品状态。
func prepareWindowOnScreen(pid: pid_t) throws -> TauriWindow {
  let targetX = 50.0
  let targetY = 70.0
  let deadline = Date().addingTimeInterval(60)

  while Date() < deadline {
    _ = setAppWindowPosition(pid: pid, x: targetX, y: targetY)
    Thread.sleep(forTimeInterval: 0.7)

    if let window = findTauriWindow() {
      let onScreen = windowOnScreen(window)
      let nearTarget = abs(window.x - targetX) < 40 && abs(window.y - targetY) < 40
      if onScreen && nearTarget {
        Thread.sleep(forTimeInterval: 0.4)
        if let again = findTauriWindow(), sameBounds(window, again) {
          return again
        }
      }
    }
  }

  // 最后兜底：只要窗口在屏幕内且稳定即可。
  while Date() < deadline {
    if let window = findTauriWindow(), windowOnScreen(window) {
      Thread.sleep(forTimeInterval: 0.5)
      if let again = findTauriWindow(), sameBounds(window, again) { return again }
    }
    Thread.sleep(forTimeInterval: 0.5)
  }

  throw DriverFailure(description: "could not place Tauri window on screen")
}

func windowOnScreen(_ window: TauriWindow) -> Bool {
  guard let screen = NSScreen.main else { return true }
  let frame = screen.frame
  return window.x >= frame.origin.x - 2
    && window.y >= frame.origin.y - 2
    && window.x + window.width <= frame.origin.x + frame.width + 2
    && window.y + window.height <= frame.origin.y + frame.height + 2
}

func setAppWindowPosition(pid: pid_t, x: Double, y: Double) -> Bool {
  let app = AXUIElementCreateApplication(pid)
  guard let value = axAttribute(app, kAXWindowsAttribute as String),
    CFGetTypeID(value) == CFArrayGetTypeID()
  else {
    return false
  }
  let array = value as! CFArray
  guard CFArrayGetCount(array) > 0,
    let pointer = CFArrayGetValueAtIndex(array, 0)
  else {
    return false
  }
  let windowElement = Unmanaged<AXUIElement>.fromOpaque(pointer).takeUnretainedValue()
  var point = CGPoint(x: x, y: y)
  guard let axValue = AXValueCreate(.cgPoint, &point) else { return false }
  return AXUIElementSetAttributeValue(
    windowElement,
    kAXPositionAttribute as CFString,
    axValue
  ) == .success
}

// 确保真实 app 是前台应用，键盘/鼠标事件才会落到它的 window 上。
func ensureFrontmost(pid: pid_t, timeout: TimeInterval = 8) -> Bool {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if NSWorkspace.shared.frontmostApplication?.processIdentifier == pid {
      Thread.sleep(forTimeInterval: 0.2)
      return true
    }
    activate(pid: pid)
    let app = AXUIElementCreateApplication(pid)
    _ = AXUIElementSetAttributeValue(
      app,
      kAXFrontmostAttribute as CFString,
      kCFBooleanTrue
    )
    Thread.sleep(forTimeInterval: 0.4)
  }
  return NSWorkspace.shared.frontmostApplication?.processIdentifier == pid
}

func findTauriWindow() -> TauriWindow? {
  guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
    return nil
  }

  for window in windows {
    guard
      (window[kCGWindowOwnerName as String] as? String) == "app",
      (window[kCGWindowLayer as String] as? Int) == 0,
      let pid = window[kCGWindowOwnerPID as String] as? Int,
      let number = window[kCGWindowNumber as String] as? Int,
      let bounds = window[kCGWindowBounds as String] as? [String: Any],
      let x = numberValue(bounds["X"]),
      let y = numberValue(bounds["Y"]),
      let width = numberValue(bounds["Width"]),
      let height = numberValue(bounds["Height"]),
      width >= 1000,
      height >= 700
    else {
      continue
    }
    return TauriWindow(pid: pid_t(pid), number: UInt32(number), x: x, y: y, width: width, height: height)
  }

  return nil
}

func numberValue(_ value: Any?) -> Double? {
  if let number = value as? NSNumber { return number.doubleValue }
  if let double = value as? Double { return double }
  if let integer = value as? Int { return Double(integer) }
  return nil
}

func activate(pid: pid_t) {
  NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateAllWindows])
  Thread.sleep(forTimeInterval: 0.6)
}

func dismissSystemEventsPromptIfPresent() {
  guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
    return
  }

  for window in windows {
    guard
      (window[kCGWindowOwnerName as String] as? String) == "universalAccessAuthWarn",
      let bounds = window[kCGWindowBounds as String] as? [String: Any],
      let x = numberValue(bounds["X"]),
      let y = numberValue(bounds["Y"]),
      let height = numberValue(bounds["Height"])
    else {
      continue
    }
    click(x: x + 170, y: y + height - 25)
    Thread.sleep(forTimeInterval: 0.5)
    return
  }
}

func waitForJoinedWork(timeout: TimeInterval) throws -> (workId: String, sessionId: String) {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    let records = readJsonlRecords("\(artifactDir)/app-log")
    for record in records.reversed() {
      if record["event"] as? String == "channel.join.done",
        let workId = record["work_id"] as? String,
        let sessionId = record["session_id"] as? String,
        !workId.isEmpty
      {
        return (workId, sessionId)
      }
    }
    Thread.sleep(forTimeInterval: 0.5)
  }
  throw DriverFailure(description: "workbench did not emit channel.join.done")
}

// MARK: - 底部输入框定位

func waitForComposer(window: TauriWindow, timeout: TimeInterval) throws -> Composer {
  let deadline = Date().addingTimeInterval(timeout)
  var lastSeen = ""
  while Date() < deadline {
    if let composer = findComposer(window: window) {
      return composer
    }
    lastSeen = composerProbeSummary(window: window)
    Thread.sleep(forTimeInterval: 0.5)
  }
  throw DriverFailure(description: "composer input not found; last=\(lastSeen)")
}

func waitForEnabledComposer(window: TauriWindow, timeout: TimeInterval) throws -> Composer {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if let composer = findComposer(window: window) {
      let enabled = axBoolAttribute(composer.element, kAXEnabledAttribute as String)
      if enabled != false {
        return composer
      }
      Thread.sleep(forTimeInterval: 0.4)
      continue
    }
    Thread.sleep(forTimeInterval: 0.5)
  }
  throw DriverFailure(description: "composer input did not become enabled")
}

func findComposer(window: TauriWindow) -> Composer? {
  let xFractions: [Double] = [0.42, 0.30, 0.55, 0.20, 0.66]
  var best: Composer?

  for step in 0...18 {
    let yFraction = 0.83 + Double(step) * 0.009
    let y = window.y + window.height * yFraction
    for xFraction in xFractions {
      let x = window.x + window.width * xFraction
      guard let element = hitElement(x: x, y: y) else { continue }
      let description = describe(element)
      guard
        description.contains("AXTextField") || description.contains("AXTextArea")
          || description.contains("输入你的想法")
      else {
        continue
      }
      let center = centerPoint(of: element) ?? CGPoint(x: x, y: y)
      let frame = elementFrame(of: element)
      let composer = Composer(
        element: element,
        x: center.x,
        y: center.y,
        width: Double(frame?.width ?? 0),
        height: Double(frame?.height ?? 0),
        description: description
      )
      if best == nil || composer.y > best!.y {
        best = composer
      }
    }
    if best != nil { return best }
  }

  return best
}

func composerProbeSummary(window: TauriWindow) -> String {
  var descriptions: [String] = []
  for step in 0...12 {
    let y = window.y + window.height * (0.86 + Double(step) * 0.011)
    for xFraction in [0.25, 0.45, 0.65] {
      let x = window.x + window.width * xFraction
      if let element = hitElement(x: x, y: y) {
        let description = describe(element)
        if !descriptions.contains(description) { descriptions.append(description) }
      }
    }
  }
  return descriptions.joined(separator: " || ").prefix(1200).description
}

// MARK: - 输入、发送与等待 run 终态

struct SentMessage {
  let turnId: String
  let workId: String
  let sessionId: String
  let text: String
}

func submitMessage(
  message: String,
  expectedMode: String,
  window: TauriWindow,
  timeout: TimeInterval
) throws -> SentMessage {
  var lastError = ""

  for attempt in 1...3 {
    let composer = try waitForEnabledComposer(window: window, timeout: timeout)
    guard ensureFrontmost(pid: window.pid) else {
      lastError = "app not frontmost before attempt \(attempt)"
      debug["send_attempt_\(attempt)"] = lastError
      Thread.sleep(forTimeInterval: 1.0)
      continue
    }

    do {
      try focusAndFill(composer: composer, text: message, window: window)
    } catch {
      lastError = "fill attempt \(attempt): \(error)"
      debug["send_attempt_\(attempt)"] = lastError
      Thread.sleep(forTimeInterval: 0.8)
      continue
    }

    let before = sentUserMessageCount()
    pressKey(36) // Enter submits the real workbench composer.
    if let sent = try? waitForSentUserMessage(after: before, expectedText: message, timeout: 10) {
      return try acceptSentMessage(sent, message: message, expectedMode: expectedMode)
    }

    // 回车未发出时点击真实发送按钮（不是「本次只做一步」），仍不行再重试填充。
    if clickSendButton(window: window),
      let sent = try? waitForSentUserMessage(after: before, expectedText: message, timeout: 8)
    {
      return try acceptSentMessage(sent, message: message, expectedMode: expectedMode)
    }

    lastError = "enter attempt \(attempt) produced no user_message frame"
    debug["send_attempt_\(attempt)"] = lastError
  }

  throw DriverFailure(description: "could not submit \(expectedMode): \(lastError)")
}

func acceptSentMessage(
  _ sent: SentMessage,
  message: String,
  expectedMode: String
) throws -> SentMessage {
  guard sent.text == message else {
    throw DriverFailure(
      description: "sent text differs from authored input (mode=\(expectedMode)): \(sent.text)"
    )
  }
  // 真实 Channel 侧应用日志确认这次输入确实作为 user_message 进入后端。
  try waitForAppLogTurnStart(turnId: sent.turnId, timeout: 10)
  return sent
}

func focusAndFill(composer: Composer, text: String, window: TauriWindow) throws {
  let focused = focusComposer(composer)

  // 清空可能残留的旧内容，再用系统剪贴板粘贴中文自然语言（React 受控 input 经真实
  // 键盘事件更新，不直接写 AXValue）。
  pressKey(0, flags: .maskCommand) // Cmd+A
  Thread.sleep(forTimeInterval: 0.12)
  pasteText(text)
  Thread.sleep(forTimeInterval: 0.6)

  if let value = composerValue(composer.element) {
    if value.contains(text) { return }
    if !focused {
      throw DriverFailure(
        description: "composer did not take focus (value=\(value.prefix(80)))"
      )
    }
    replaceByTyping(text, composer: composer)
    if let retryValue = composerValue(composer.element), !retryValue.contains(text) {
      throw DriverFailure(
        description: "composer value mismatch after paste/type: \(retryValue.prefix(120))"
      )
    }
    return
  }

  // WebView 不暴露 value 时，用真实发送按钮的可用态交叉确认输入非空。
  guard focused else {
    throw DriverFailure(description: "composer did not take focus (no AXValue exposed)")
  }
  replaceByTyping(text, composer: composer)
  if sendButtonEnabled(window: window) == false {
    throw DriverFailure(description: "send button stayed disabled after typing")
  }
}

func replaceByTyping(_ text: String, composer: Composer) {
  pressKey(0, flags: .maskCommand) // Cmd+A
  Thread.sleep(forTimeInterval: 0.1)
  typeText(text)
  Thread.sleep(forTimeInterval: 0.6)
}

// 点击输入框并确认键盘焦点进入 web 内容；AX 焦点偶尔报在 AXWebArea 上，
// 但真正的输入是否成功由随后的 AXValue / 发送按钮可用态校验兜底。
func focusComposer(_ composer: Composer) -> Bool {
  var points: [CGPoint] = [CGPoint(x: composer.x, y: composer.y)]
  if composer.width > 40 {
    points.append(CGPoint(x: composer.x - composer.width * 0.30, y: composer.y))
    points.append(CGPoint(x: composer.x + composer.width * 0.30, y: composer.y))
  }
  for point in points {
    click(x: point.x, y: point.y)
    Thread.sleep(forTimeInterval: 0.35)
    if let focused = focusedElement(), isFocusInWebContent(focused) {
      return true
    }
  }
  return false
}

func isFocusInWebContent(_ element: AXUIElement) -> Bool {
  let role = axStringAttribute(element, kAXRoleAttribute as String) ?? ""
  return role == "AXTextField" || role == "AXTextArea" || role == "AXWebArea"
}

func focusedElementDescription() -> String {
  guard let element = focusedElement() else { return "(none)" }
  return describe(element)
}

func sendButtonEnabled(window: TauriWindow) -> Bool? {
  for yStep in 0...8 {
    let y = window.y + window.height * (0.90 + Double(yStep) * 0.012)
    for xFraction in [0.82, 0.86, 0.90, 0.94] {
      let x = window.x + window.width * xFraction
      guard let element = hitElement(x: x, y: y) else { continue }
      guard axStringAttribute(element, kAXRoleAttribute as String) == "AXButton",
        axStringAttribute(element, kAXTitleAttribute as String) == "发送"
      else {
        continue
      }
      return axBoolAttribute(element, kAXEnabledAttribute as String)
    }
  }
  return nil
}

func clickSendButton(window: TauriWindow) -> Bool {
  for yStep in 0...8 {
    let y = window.y + window.height * (0.90 + Double(yStep) * 0.012)
    for xFraction in [0.86, 0.90, 0.94, 0.82] {
      let x = window.x + window.width * xFraction
      guard let element = hitElement(x: x, y: y) else { continue }
      let description = describe(element)
      guard description.contains("AXButton") else { continue }
      guard !description.contains("本次只做一步") else { continue }
      if let center = centerPoint(of: element) {
        click(x: center.x, y: center.y)
        Thread.sleep(forTimeInterval: 0.4)
        return true
      }
      click(x: x, y: y)
      Thread.sleep(forTimeInterval: 0.4)
      return true
    }
  }
  return false
}

func waitForSentUserMessage(
  after count: Int,
  expectedText: String,
  timeout: TimeInterval
) throws -> SentMessage {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    let rows = readTransportRows()
    let sentRows = rows.filter { row in
      guard (row["direction"] as? String) == "sent",
        let frame = row["frame"] as? [Any],
        frame.count > 4,
        (frame[3] as? String) == "user_message"
      else {
        return false
      }
      return true
    }
    if sentRows.count > count {
      let row = sentRows[count]
      let frame = row["frame"] as! [Any]
      let payload = frame[4] as! [String: Any]
      let turnId = payload["turn_id"] as? String ?? ""
      let workId = payload["work_id"] as? String ?? ""
      let sessionId = payload["session_id"] as? String ?? ""
      let text = payload["text"] as? String ?? ""
      if !turnId.isEmpty {
        return SentMessage(turnId: turnId, workId: workId, sessionId: sessionId, text: text)
      }
    }
    Thread.sleep(forTimeInterval: 0.4)
  }
  throw DriverFailure(description: "no new user_message frame after \(expectedText.prefix(20))")
}

func waitForTerminalRun(parentTurn: String, timeout: TimeInterval) throws -> TerminalRun {
  let deadline = Date().addingTimeInterval(timeout)
  var last: TerminalRun?

  while Date() < deadline {
    let rows = readTransportRows()
    for row in rows {
      guard (row["direction"] as? String) == "received",
        let frame = row["frame"] as? [Any],
        frame.count > 4,
        (frame[3] as? String) == "agent_run_state",
        let payload = frame[4] as? [String: Any],
        (payload["parent_turn_ref"] as? String) == parentTurn
      else {
        continue
      }
      let budget = payload["consumed_budget"] as? [String: Any] ?? [:]
      last = TerminalRun(
        runId: payload["run_id"] as? String ?? "",
        status: payload["status"] as? String ?? "",
        profileRef: payload["profile_ref"] as? String ?? "",
        providerCalls: budget["provider_calls"] as? Int ?? -1,
        toolCalls: budget["tool_calls"] as? Int ?? -1,
        replans: budget["replans"] as? Int ?? -1
      )
    }

    if let last, ["completed", "failed", "cancelled", "stopped", "awaiting_author"].contains(last.status) {
      return last
    }
    Thread.sleep(forTimeInterval: 0.5)
  }

  if let last {
    throw DriverFailure(description: "run \(last.runId) stuck in status \(last.status)")
  }
  throw DriverFailure(description: "no agent_run_state for turn \(parentTurn)")
}

// MARK: - 证据读取

func sentUserMessageCount() -> Int {
  readTransportRows().filter { row in
    guard (row["direction"] as? String) == "sent",
      let frame = row["frame"] as? [Any],
      frame.count > 3,
      (frame[3] as? String) == "user_message"
    else {
      return false
    }
    return true
  }.count
}

func readTransportRows() -> [[String: Any]] {
  return readJsonlFile("\(artifactDir)/native-transport.jsonl")
}

func readJsonlFile(_ path: String) -> [[String: Any]] {
  guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
  return text.split(separator: "\n").compactMap { line in
    guard let data = String(line).data(using: .utf8) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }
}

func llmLogRowCount() -> Int {
  llmLogFilePaths().reduce(0) { total, path in
    total + readJsonlFile(path).count
  }
}

func llmLogRows(since: Int) -> [[String: Any]] {
  let rows = llmLogFilePaths().flatMap { readJsonlFile($0) }
  guard rows.count > since else { return [] }
  return Array(rows.dropFirst(since))
}

func llmLogFilePaths() -> [String] {
  for folder in ["\(artifactDir)/llm-calls"] {
    guard let files = try? FileManager.default.contentsOfDirectory(atPath: folder) else { continue }
    return files.filter { $0.hasSuffix(".jsonl") }.sorted().map { "\(folder)/\($0)" }
  }
  return []
}

func appLogEventSummary(parentTurn: String) -> [String: Int] {
  let records = readJsonlRecords("\(artifactDir)/app-log")
  var counts: [String: Int] = [:]
  for record in records {
    guard let turnId = record["turn_id"] as? String else { continue }
    guard turnId == parentTurn || turnId.hasPrefix("\(parentTurn):") else { continue }
    let event = record["event"] as? String ?? "(none)"
    counts[event, default: 0] += 1
  }
  return counts
}

// 真实 Channel 侧证据：确认该 turn 由 app 的 user_message 进入后端主链。
func waitForAppLogTurnStart(turnId: String, timeout: TimeInterval) throws {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    let records = readJsonlRecords("\(artifactDir)/app-log")
    let found = records.contains { record in
      (record["event"] as? String) == "channel.user_message.start"
        && (record["turn_id"] as? String) == turnId
    }
    if found { return }
    Thread.sleep(forTimeInterval: 0.3)
  }
  throw DriverFailure(description: "app-log has no channel.user_message.start for \(turnId)")
}

// MARK: - 截图与探针

func captureWindow(_ window: TauriWindow, name: String) throws {
  let path = "\(artifactDir)/\(name)"
  let result = runProcess("/usr/sbin/screencapture", ["-x", "-o", "-l", String(window.number), path])
  guard result.status == 0 else {
    throw DriverFailure(description: "screencapture failed for \(name): \(result.stderr)")
  }
  Thread.sleep(forTimeInterval: 0.2)
  let attributes = try? FileManager.default.attributesOfItem(atPath: path)
  let size = (attributes?[.size] as? NSNumber)?.intValue ?? 0
  guard size > 5_000 else {
    throw DriverFailure(description: "screenshot \(name) is empty (\(size) bytes)")
  }
}

func runProbe(window: TauriWindow) throws {
  Thread.sleep(forTimeInterval: 4)
  try captureWindow(window, name: "00-probe.jpg")

  var probe: [String: Any] = [
    "driver": driverName,
    "window": [
      "pid": Int(window.pid),
      "number": Int(window.number),
      "x": window.x,
      "y": window.y,
      "width": window.width,
      "height": window.height,
    ],
    "probe_at": isoNow(),
  ]

  if let composer = findComposer(window: window) {
    probe["composer"] = [
      "description": composer.description,
      "x": composer.x,
      "y": composer.y,
      "value": composerValue(composer.element) ?? "(nil)",
      "enabled": axBoolAttribute(composer.element, kAXEnabledAttribute as String)
        .map { $0 ? 1 : 0 } ?? -1,
    ]
  } else {
    probe["composer"] = "not found"
  }

  probe["hit_scan"] = hitScanSummary(window: window)
  probe["ax_tree"] = axTreeDump(pid: window.pid, limit: 4000)
  try writeJson(probe, to: "\(artifactDir)/native-driver-probe.json")
  print("[plan-matrix-driver] probe written to \(artifactDir)/native-driver-probe.json")
}

func hitScanSummary(window: TauriWindow) -> [[String: Any]] {
  var results: [[String: Any]] = []
  var seen = Set<String>()
  for yStep in 0...16 {
    let y = window.y + window.height * (0.85 + Double(yStep) * 0.009)
    let x = window.x + window.width * 0.45
    guard let element = hitElement(x: x, y: y) else { continue }
    let description = describe(element)
    guard !seen.contains(description) else { continue }
    seen.insert(description)
    results.append(["y_fraction": Double(yStep) * 0.009 + 0.85, "description": description])
  }
  return results
}

func axTreeDump(pid: pid_t, limit: Int) -> [[String: Any]] {
  let app = AXUIElementCreateApplication(pid)
  var output: [[String: Any]] = []
  var queue: [(AXUIElement, Int)] = [(app, 0)]
  var visited = 0

  while !queue.isEmpty && visited < limit {
    let (element, depth) = queue.removeFirst()
    visited += 1
    let role = axStringAttribute(element, kAXRoleAttribute as String) ?? ""
    let title = axStringAttribute(element, kAXTitleAttribute as String) ?? ""
    let value = axStringAttribute(element, kAXValueAttribute as String) ?? ""
    let description = axStringAttribute(element, kAXDescriptionAttribute as String) ?? ""
    if ["AXTextField", "AXTextArea", "AXButton"].contains(role) || description.contains("输入")
      || title.contains("输入") || title == "发送" || description == "发送"
    {
      var record: [String: Any] = [
        "depth": depth,
        "role": role,
        "title": title,
        "value": value,
        "description": description,
        "enabled": axBoolAttribute(element, kAXEnabledAttribute as String).map { $0 ? 1 : 0 } ?? -1,
      ]
      if let position = axPointAttribute(element, kAXPositionAttribute as String) {
        record["x"] = position.x
        record["y"] = position.y
      }
      if let size = axSizeAttribute(element, kAXSizeAttribute as String) {
        record["width"] = size.width
        record["height"] = size.height
      }
      output.append(record)
      if output.count >= 200 { break }
    }
    if depth < 60 {
      for child in axChildren(element) {
        queue.append((child, depth + 1))
      }
    }
  }

  return output
}

// MARK: - AX 基础 helper

func axAttribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else { return nil }
  return value
}

func axStringAttribute(_ element: AXUIElement, _ name: String) -> String? {
  guard let value = axAttribute(element, name) else { return nil }
  if let string = value as? String { return string }
  if let number = value as? NSNumber { return number.stringValue }
  return nil
}

func axBoolAttribute(_ element: AXUIElement, _ name: String) -> Bool? {
  guard let value = axAttribute(element, name) else { return nil }
  if let number = value as? NSNumber { return number.boolValue }
  if let boolean = value as? Bool { return boolean }
  return nil
}

func axChildren(_ element: AXUIElement) -> [AXUIElement] {
  guard let value = axAttribute(element, kAXChildrenAttribute as String) else { return [] }
  guard CFGetTypeID(value) == CFArrayGetTypeID() else { return [] }
  let array = value as! CFArray
  var children: [AXUIElement] = []
  for index in 0..<CFArrayGetCount(array) {
    guard let pointer = CFArrayGetValueAtIndex(array, index) else { continue }
    children.append(Unmanaged<AXUIElement>.fromOpaque(pointer).takeUnretainedValue())
  }
  return children
}

func axPointAttribute(_ element: AXUIElement, _ name: String) -> CGPoint? {
  guard let value = axAttribute(element, name), CFGetTypeID(value) == AXValueGetTypeID() else {
    return nil
  }
  let axValue = value as! AXValue
  guard AXValueGetType(axValue) == .cgPoint else { return nil }
  var point = CGPoint.zero
  guard AXValueGetValue(axValue, .cgPoint, &point) else { return nil }
  return point
}

func axSizeAttribute(_ element: AXUIElement, _ name: String) -> CGSize? {
  guard let value = axAttribute(element, name), CFGetTypeID(value) == AXValueGetTypeID() else {
    return nil
  }
  let axValue = value as! AXValue
  guard AXValueGetType(axValue) == .cgSize else { return nil }
  var size = CGSize.zero
  guard AXValueGetValue(axValue, .cgSize, &size) else { return nil }
  return size
}

func centerPoint(of element: AXUIElement) -> CGPoint? {
  guard
    let position = axPointAttribute(element, kAXPositionAttribute as String),
    let size = axSizeAttribute(element, kAXSizeAttribute as String)
  else {
    return nil
  }
  return CGPoint(x: position.x + size.width / 2.0, y: position.y + size.height / 2.0)
}

func elementFrame(of element: AXUIElement) -> CGRect? {
  guard
    let position = axPointAttribute(element, kAXPositionAttribute as String),
    let size = axSizeAttribute(element, kAXSizeAttribute as String)
  else {
    return nil
  }
  return CGRect(x: position.x, y: position.y, width: size.width, height: size.height)
}

func composerValue(_ element: AXUIElement) -> String? {
  if let value = axStringAttribute(element, kAXValueAttribute as String), !value.isEmpty {
    return value
  }
  return focusedElementValue()
}

func focusedElement() -> AXUIElement? {
  let system = AXUIElementCreateSystemWide()
  guard let value = axAttribute(system, kAXFocusedUIElementAttribute as String) else { return nil }
  return unsafeBitCast(value, to: AXUIElement.self)
}

func focusedElementValue() -> String? {
  guard let element = focusedElement() else { return nil }
  return axStringAttribute(element, kAXValueAttribute as String)
}

func hitElement(x: Double, y: Double) -> AXUIElement? {
  let system = AXUIElementCreateSystemWide()
  var element: AXUIElement?
  let error = AXUIElementCopyElementAtPosition(system, Float(x), Float(y), &element)
  guard error == .success, let element else { return nil }
  return element
}

func describe(_ element: AXUIElement) -> String {
  func attribute(_ name: String) -> String {
    guard let value = axAttribute(element, name) else { return "" }
    return String(describing: value)
  }

  return
    "role=\(attribute(kAXRoleAttribute as String)) title=\(attribute(kAXTitleAttribute as String)) value=\(attribute(kAXValueAttribute as String)) description=\(attribute(kAXDescriptionAttribute as String)) enabled=\(attribute(kAXEnabledAttribute as String))"
}

// MARK: - CGEvent 输入

func click(x: Double, y: Double) {
  let point = CGPoint(x: x, y: y)
  CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?
    .post(tap: .cghidEventTap)
  Thread.sleep(forTimeInterval: 0.08)
  CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?
    .post(tap: .cghidEventTap)
}

func pressKey(_ keyCode: CGKeyCode, flags: CGEventFlags = []) {
  let down = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: true)
  down?.flags = flags
  down?.post(tap: .cghidEventTap)
  Thread.sleep(forTimeInterval: 0.06)
  let up = CGEvent(keyboardEventSource: nil, virtualKey: keyCode, keyDown: false)
  up?.flags = flags
  up?.post(tap: .cghidEventTap)
}

func typeText(_ value: String) {
  var characters = Array(value.utf16)
  let length = characters.count
  characters.withUnsafeMutableBufferPointer { buffer in
    guard let base = buffer.baseAddress else { return }
    let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
    down?.keyboardSetUnicodeString(stringLength: length, unicodeString: base)
    down?.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.04)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
    up?.keyboardSetUnicodeString(stringLength: length, unicodeString: base)
    up?.post(tap: .cghidEventTap)
  }
}

func pasteText(_ value: String) {
  let pasteboard = NSPasteboard.general
  pasteboard.clearContents()
  pasteboard.setString(value, forType: .string)
  Thread.sleep(forTimeInterval: 0.15)
  pressKey(9, flags: .maskCommand) // Command-V
}

// MARK: - 进程 / 文件 / 时间 helper

func runProcess(_ command: String, _ arguments: [String]) -> (status: Int32, stdout: String, stderr: String) {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: command)
  process.arguments = arguments

  let stdoutPipe = Pipe()
  let stderrPipe = Pipe()
  process.standardOutput = stdoutPipe
  process.standardError = stderrPipe

  do {
    try process.run()
    process.waitUntilExit()
  } catch {
    return (127, "", String(describing: error))
  }

  let stdout = String(data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  let stderr = String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
  return (process.terminationStatus, stdout, stderr)
}

func readJsonlRecords(_ dir: String) -> [[String: Any]] {
  guard let files = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return [] }
  return files
    .filter { $0.hasSuffix(".jsonl") }
    .sorted()
    .flatMap { file -> [[String: Any]] in
      guard let text = try? String(contentsOfFile: "\(dir)/\(file)", encoding: .utf8) else { return [] }
      return text.split(separator: "\n").compactMap { line in
        guard let data = String(line).data(using: .utf8) else { return nil }
        return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
      }
    }
}

func writeJson(_ object: Any, to path: String) throws {
  let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
  try data.write(to: URL(fileURLWithPath: path))
}

func isoNow() -> String {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.string(from: Date())
}

func isoNowString(_ date: Date) -> String {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  return formatter.string(from: date)
}

func parseIsoDate(_ text: String) -> Date? {
  let formatter = ISO8601DateFormatter()
  formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
  if let date = formatter.date(from: text) { return date }
  formatter.formatOptions = [.withInternetDateTime]
  return formatter.date(from: text)
}
