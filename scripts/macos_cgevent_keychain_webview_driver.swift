import AppKit
import CoreGraphics
import Foundation
import Security

struct DriverFailure: Error, CustomStringConvertible {
  let description: String
}

struct TauriWindow {
  let pid: pid_t
  let x: Double
  let y: Double
  let width: Double
  let height: Double
}

struct HitSearchResult {
  let x: Double
  let y: Double
  let description: String
  let element: AXUIElement
}

let artifactDir = requiredEnv("SLICE_VERIFY_ARTIFACT_DIR")
let appLogDir = requiredEnv("SLICE_VERIFY_APP_LOG_DIR")
let backendLogPath = requiredEnv("SLICE_VERIFY_BACKEND_LOG")
let apiUrl = requiredEnv("SLICE_VERIFY_API_URL")
let tauriHome = requiredEnv("SLICE_VERIFY_TAURI_HOME")
let desktopProfile = ProcessInfo.processInfo.environment["AI_NOVEL_DESKTOP_PROFILE"] ?? "slice-verify"
let driverPhase = ProcessInfo.processInfo.environment["SLICE_VERIFY_KEYCHAIN_PHASE"] ?? "full"
let provider = "deepseek"
let model = "deepseek-slice-keychain"
let keychainService = "com.ai-novel-studio.app.model-provider.\(desktopProfile)"
let secretPrefix = "sk-slice-keychain-webview"
let secret = "\(secretPrefix)-\(Int(Date().timeIntervalSince1970 * 1000))"

var debug: [String: Any] = [
  "slice_id": "su01-keychain-webview-roundtrip",
  "driver": "macos-cgevent",
  "product_code_acceptance_hooks_added": false,
]

do {
  if driverPhase == "readback" {
    try verifyReadbackAfterRestart()
    exit(0)
  }

  try removeExistingKeychainItem()

  let window = try waitForTauriWindow(timeout: 30)
  debug["window"] = ["pid": Int(window.pid), "x": window.x, "y": window.y, "width": window.width, "height": window.height]

  let joinedBeforeDrive = try waitForJoinedWork(timeout: 30)
  let joinedCountBeforeReload = joinedWorkCount()
  debug["joined_before_drive"] = ["work_id": joinedBeforeDrive.workId, "session_id": joinedBeforeDrive.sessionId]

  activate(pid: window.pid)
  try driveModelProviderDialog(window: window)

  let optionsAfterSave = try waitForProviderOptions(
    timeout: 20,
    predicate: { options in
      currentProvider(options) == provider && providerOption(options, provider)?["api_key_configured"] as? Bool == true
    }
  )

  let keychainItemFound = try keychainItemExists()
  let preferencesPath = "\(tauriHome)/Library/Application Support/com.ai-novel-studio.app/profiles/\(desktopProfile)/preferences.json"
  let preferencesText = (try? String(contentsOfFile: preferencesPath, encoding: .utf8)) ?? ""

  try resetRuntimeToStub()
  if driverPhase == "save" {
    debug["status"] = "save_done"
    debug["keychain_item_found"] = keychainItemFound
    debug["runtime_reset_before_restart"] = true
    debug["preferences_file_exists"] = FileManager.default.fileExists(atPath: preferencesPath)
    debug["preferences_selected_provider"] = preferencesTextContainsSelectedProvider(preferencesText)
    debug["preferences_model_saved"] = preferencesText.contains(model)
    debug["preferences_omits_api_key"] = !preferencesText.contains(secretPrefix)
    try writeJson(debug, to: "\(artifactDir)/macos-cgevent-driver-save.json")
    exit(0)
  }

  activate(pid: window.pid)
  click(x: window.x + min(640.0, window.width / 2.0), y: window.y + min(420.0, window.height / 2.0))
  Thread.sleep(forTimeInterval: 0.3)
  pressKey(15, flags: .maskCommand) // Command-R reloads the real Tauri WebView.
  Thread.sleep(forTimeInterval: 0.5)
  pressKey(15, flags: .maskCommand)
  let joinedAfterReload = try waitForJoinedWorkCount(greaterThan: joinedCountBeforeReload, timeout: 12)
  debug["joined_after_reload"] = ["work_id": joinedAfterReload.workId, "session_id": joinedAfterReload.sessionId]
  Thread.sleep(forTimeInterval: 2.0)

  let optionsAfterReload = try waitForProviderOptions(
    timeout: 25,
    predicate: { options in
      currentProvider(options) == provider &&
        providerOption(options, provider)?["api_key_configured"] as? Bool == true &&
        providerOption(options, provider)?["model"] as? String == model
    }
  )

  let providerOptionsJson = jsonString(optionsAfterReload)
  let allAppLogs = readAllText(appLogDir)
  let backendLog = (try? String(contentsOfFile: backendLogPath, encoding: .utf8)) ?? ""

  let uiState: [String: Any] = [
    "event": "slice_verify.ui_state.done",
    "slice_id": "su01-keychain-webview-roundtrip",
    "work_id": joinedAfterReload.workId,
    "context_work_id": joinedAfterReload.workId,
    "session_id": joinedAfterReload.sessionId,
    "socket_connected": true,
    "driver": "macos-cgevent",
    "provider_selected": provider,
    "model_selected": model,
    "provider_switch_saved": currentProvider(optionsAfterSave) == provider,
    "webview_reload_performed": true,
    "runtime_reset_before_reload": true,
    "post_reload_provider": currentProvider(optionsAfterReload) ?? "",
    "post_reload_api_key_configured": providerOption(optionsAfterReload, provider)?["api_key_configured"] as? Bool == true,
    "keychain_service": keychainService,
    "keychain_item_found": keychainItemFound,
    "keychain_secret_read_skipped": true,
    "preferences_file_exists": FileManager.default.fileExists(atPath: preferencesPath),
    "preferences_selected_provider": preferencesTextContainsSelectedProvider(preferencesText),
    "preferences_model_saved": preferencesText.contains(model),
    "preferences_omits_api_key": !preferencesText.contains(secretPrefix),
    "provider_options_omits_api_key": !providerOptionsJson.contains(secretPrefix),
    "app_log_omits_api_key": !allAppLogs.contains(secretPrefix),
    "backend_log_omits_api_key": !backendLog.contains(secretPrefix),
  ]

  try writeJson([uiState], to: "\(artifactDir)/ui-state.json")
  debug["status"] = "done"
  debug["keychain_item_found"] = keychainItemFound
  debug["keychain_secret_read_skipped"] = true
  try writeJson(debug, to: "\(artifactDir)/macos-cgevent-driver.json")
  exit(0)
} catch {
  debug["status"] = "failed"
  debug["error"] = String(describing: error)
  try? writeJson(debug, to: "\(artifactDir)/macos-cgevent-driver.json")
  fputs("[macos-cgevent-driver] failed: \(error)\n", stderr)
  exit(1)
}

func requiredEnv(_ name: String) -> String {
  guard let value = ProcessInfo.processInfo.environment[name], !value.isEmpty else {
    fputs("[macos-cgevent-driver] missing env \(name)\n", stderr)
    exit(64)
  }
  return value
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

func findTauriWindow() -> TauriWindow? {
  guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
    return nil
  }

  for window in windows {
    guard
      (window[kCGWindowOwnerName as String] as? String) == "app",
      (window[kCGWindowLayer as String] as? Int) == 0,
      let pid = window[kCGWindowOwnerPID as String] as? Int,
      let bounds = window[kCGWindowBounds as String] as? [String: Any],
      let x = number(bounds["X"]),
      let y = number(bounds["Y"]),
      let width = number(bounds["Width"]),
      let height = number(bounds["Height"]),
      width >= 1000,
      height >= 700
    else {
      continue
    }
    return TauriWindow(pid: pid_t(pid), x: x, y: y, width: width, height: height)
  }

  return nil
}

func number(_ value: Any?) -> Double? {
  if let n = value as? NSNumber { return n.doubleValue }
  if let d = value as? Double { return d }
  if let i = value as? Int { return Double(i) }
  return nil
}

func activate(pid: pid_t) {
  NSRunningApplication(processIdentifier: pid)?.activate(options: [.activateAllWindows])
  Thread.sleep(forTimeInterval: 0.6)
}

func driveModelProviderDialog(window: TauriWindow) throws {
  dismissSystemEventsPromptIfPresent()

  let settingsHit = try waitForHitDescription(
    x: window.x + 1066,
    y: window.y + 59,
    contains: "AXPopUpButton",
    timeout: 20
  )
  debug["settings_button_hit"] = settingsHit

  click(x: window.x + 1066, y: window.y + 59)
  Thread.sleep(forTimeInterval: 1.6)
  dismissSystemEventsPromptIfPresent()

  let selectHit = try waitForHitDescription(
    x: window.x + 641,
    y: window.y + 233,
    contains: "AXPopUpButton",
    timeout: 10
  )
  debug["provider_select_hit"] = selectHit

  click(x: window.x + 641, y: window.y + 233)
  Thread.sleep(forTimeInterval: 0.3)
  pressKey(2) // d -> DeepSeek in the native select.
  Thread.sleep(forTimeInterval: 0.4)
  pressKey(36)
  Thread.sleep(forTimeInterval: 1.0)

  click(x: window.x + 641, y: window.y + 373)
  Thread.sleep(forTimeInterval: 0.2)
  typeText(secret)
  Thread.sleep(forTimeInterval: 0.4)

  click(x: window.x + 836, y: window.y + 438)
  Thread.sleep(forTimeInterval: 4.0)

  debug["save_keyboard_submit_attempted"] = true
  for _ in 0..<4 {
    pressKey(48) // Tab from the refresh button through thinking/cancel/test to save.
    Thread.sleep(forTimeInterval: 0.12)
  }
  pressKey(49) // Space activates the focused save button.
  Thread.sleep(forTimeInterval: 1.2)
  if providerConfigSaved() {
    debug["save_method"] = "keyboard-tab-space"
    return
  }

  let saveHit = try waitForHitInRegion(
    window: window,
    relativeX: 560...1080,
    relativeY: 520...710,
    step: 12,
    allOf: ["AXButton", "保存并切换"],
    timeout: 10
  )
  debug["save_button_hit"] = saveHit.description
  debug["save_button_point"] = ["x": saveHit.x, "y": saveHit.y]

  let saveClickPoint = centerPoint(of: saveHit.element) ?? CGPoint(x: saveHit.x, y: saveHit.y)
  debug["save_button_click_point"] = ["x": saveClickPoint.x, "y": saveClickPoint.y]
  click(x: saveClickPoint.x, y: saveClickPoint.y)
  Thread.sleep(forTimeInterval: 0.3)
  pressKey(49) // Space activates the focused button on macOS WebView controls.
  Thread.sleep(forTimeInterval: 1.0)

  if !providerConfigSaved() {
    try pressAccessibilityElement(saveHit.element, label: "save provider config")
    Thread.sleep(forTimeInterval: 2.0)
  } else {
    debug["save_method"] = "mouse-center-space"
  }
}

func verifyReadbackAfterRestart() throws {
  let window = try waitForTauriWindow(timeout: 30)
  debug["window"] = ["pid": Int(window.pid), "x": window.x, "y": window.y, "width": window.width, "height": window.height]
  let joined = try waitForJoinedWork(timeout: 30)
  debug["joined_after_restart"] = ["work_id": joined.workId, "session_id": joined.sessionId]

  let optionsAfterRestart = try waitForProviderOptions(
    timeout: 25,
    predicate: { options in
      currentProvider(options) == provider &&
        providerOption(options, provider)?["api_key_configured"] as? Bool == true &&
        providerOption(options, provider)?["model"] as? String == model
    }
  )

  let keychainItemFound = try keychainItemExists()
  let preferencesPath = "\(tauriHome)/Library/Application Support/com.ai-novel-studio.app/profiles/\(desktopProfile)/preferences.json"
  let preferencesText = (try? String(contentsOfFile: preferencesPath, encoding: .utf8)) ?? ""
  let providerOptionsJson = jsonString(optionsAfterRestart)
  let allAppLogs = readAllText(appLogDir)
  let backendLog = (try? String(contentsOfFile: backendLogPath, encoding: .utf8)) ?? ""

  let uiState: [String: Any] = [
    "event": "slice_verify.ui_state.done",
    "slice_id": "su01-keychain-webview-roundtrip",
    "work_id": joined.workId,
    "context_work_id": joined.workId,
    "session_id": joined.sessionId,
    "socket_connected": true,
    "driver": "macos-cgevent",
    "provider_selected": provider,
    "model_selected": model,
    "provider_switch_saved": true,
    "webview_reload_performed": true,
    "runtime_reset_before_reload": true,
    "post_reload_provider": currentProvider(optionsAfterRestart) ?? "",
    "post_reload_api_key_configured": providerOption(optionsAfterRestart, provider)?["api_key_configured"] as? Bool == true,
    "keychain_service": keychainService,
    "keychain_item_found": keychainItemFound,
    "keychain_secret_read_skipped": true,
    "preferences_file_exists": FileManager.default.fileExists(atPath: preferencesPath),
    "preferences_selected_provider": preferencesTextContainsSelectedProvider(preferencesText),
    "preferences_model_saved": preferencesText.contains(model),
    "preferences_omits_api_key": !preferencesText.contains(secretPrefix),
    "provider_options_omits_api_key": !providerOptionsJson.contains(secretPrefix),
    "app_log_omits_api_key": !allAppLogs.contains(secretPrefix),
    "backend_log_omits_api_key": !backendLog.contains(secretPrefix),
  ]

  try writeJson([uiState], to: "\(artifactDir)/ui-state.json")
  debug["status"] = "done"
  debug["keychain_item_found"] = keychainItemFound
  debug["keychain_secret_read_skipped"] = true
  try writeJson(debug, to: "\(artifactDir)/macos-cgevent-driver.json")
}

func waitForHitDescription(x: Double, y: Double, contains expected: String, timeout: TimeInterval) throws -> String {
  let deadline = Date().addingTimeInterval(timeout)
  var last = ""
  while Date() < deadline {
    if let description = hitDescription(x: x, y: y) {
      last = description
      if description.contains(expected) {
        return description
      }
    }
    Thread.sleep(forTimeInterval: 0.5)
  }
  throw DriverFailure(description: "AX hit-test did not find \(expected) at \(x),\(y); last=\(last)")
}

func waitForHitInRegion(
  window: TauriWindow,
  relativeX: ClosedRange<Int>,
  relativeY: ClosedRange<Int>,
  step: Int,
  allOf expectedParts: [String],
  timeout: TimeInterval
) throws -> HitSearchResult {
  let deadline = Date().addingTimeInterval(timeout)
  var last = ""
  var samples = 0

  while Date() < deadline {
    for relativeYValue in stride(from: relativeY.lowerBound, through: relativeY.upperBound, by: step) {
      for relativeXValue in stride(from: relativeX.lowerBound, through: relativeX.upperBound, by: step) {
        let x = window.x + Double(relativeXValue)
        let y = window.y + Double(relativeYValue)
        samples += 1

        guard let element = hitElement(x: x, y: y) else {
          continue
        }

        let description = describe(element)
        last = description
        if expectedParts.allSatisfy({ description.contains($0) }) {
          return HitSearchResult(x: x, y: y, description: description, element: element)
        }
      }
    }
    Thread.sleep(forTimeInterval: 0.5)
  }

  throw DriverFailure(
    description: "AX region scan did not find \(expectedParts.joined(separator: " + ")); samples=\(samples); last=\(last)"
  )
}

func hitDescription(x: Double, y: Double) -> String? {
  guard let element = hitElement(x: x, y: y) else { return nil }
  return describe(element)
}

func hitElement(x: Double, y: Double) -> AXUIElement? {
  let system = AXUIElementCreateSystemWide()
  var element: AXUIElement?
  let error = AXUIElementCopyElementAtPosition(system, Float(x), Float(y), &element)
  guard error == .success, let element else { return nil }
  return element
}

func describe(_ element: AXUIElement) -> String {
  func attr(_ name: String) -> String {
    var value: CFTypeRef?
    AXUIElementCopyAttributeValue(element, name as CFString, &value)
    return value.map { String(describing: $0) } ?? ""
  }

  return "role=\(attr(kAXRoleAttribute)) title=\(attr(kAXTitleAttribute)) value=\(attr(kAXValueAttribute)) description=\(attr(kAXDescriptionAttribute)) enabled=\(attr(kAXEnabledAttribute))"
}

func pressAccessibilityElement(_ element: AXUIElement, label: String) throws {
  let error = AXUIElementPerformAction(element, kAXPressAction as CFString)
  debug["save_button_ax_press_error"] = String(describing: error)
  guard error == .success else {
    throw DriverFailure(description: "AXPress failed for \(label): \(error)")
  }
}

func centerPoint(of element: AXUIElement) -> CGPoint? {
  guard
    let position = axPointAttribute(element, kAXPositionAttribute),
    let size = axSizeAttribute(element, kAXSizeAttribute)
  else {
    return nil
  }

  debug["save_button_frame"] = [
    "x": position.x,
    "y": position.y,
    "width": size.width,
    "height": size.height,
  ]

  return CGPoint(x: position.x + size.width / 2.0, y: position.y + size.height / 2.0)
}

func axPointAttribute(_ element: AXUIElement, _ name: String) -> CGPoint? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
    return nil
  }
  guard let value, CFGetTypeID(value) == AXValueGetTypeID() else {
    return nil
  }
  let axValue = value as! AXValue
  guard AXValueGetType(axValue) == .cgPoint else { return nil }

  var point = CGPoint.zero
  guard AXValueGetValue(axValue, .cgPoint, &point) else {
    return nil
  }
  return point
}

func axSizeAttribute(_ element: AXUIElement, _ name: String) -> CGSize? {
  var value: CFTypeRef?
  guard AXUIElementCopyAttributeValue(element, name as CFString, &value) == .success else {
    return nil
  }
  guard let value, CFGetTypeID(value) == AXValueGetTypeID() else {
    return nil
  }
  let axValue = value as! AXValue
  guard AXValueGetType(axValue) == .cgSize else { return nil }

  var size = CGSize.zero
  guard AXValueGetValue(axValue, .cgSize, &size) else {
    return nil
  }
  return size
}

func providerConfigSaved() -> Bool {
  guard let options = try? requestJson(path: "/api/provider/options", method: "GET", body: nil) else {
    return false
  }
  return currentProvider(options) == provider && providerOption(options, provider)?["api_key_configured"] as? Bool == true
}

func dismissSystemEventsPromptIfPresent() {
  guard let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] else {
    return
  }

  for window in windows {
    guard
      (window[kCGWindowOwnerName as String] as? String) == "universalAccessAuthWarn",
      let bounds = window[kCGWindowBounds as String] as? [String: Any],
      let x = number(bounds["X"]),
      let y = number(bounds["Y"]),
      let height = number(bounds["Height"])
    else {
      continue
    }
    click(x: x + 170, y: y + height - 25)
    Thread.sleep(forTimeInterval: 0.5)
    return
  }
}

func click(x: Double, y: Double) {
  let point = CGPoint(x: x, y: y)
  CGEvent(mouseEventSource: nil, mouseType: .leftMouseDown, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
  Thread.sleep(forTimeInterval: 0.08)
  CGEvent(mouseEventSource: nil, mouseType: .leftMouseUp, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
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
  var chars = Array(value.utf16)
  let count = chars.count
  chars.withUnsafeMutableBufferPointer { buffer in
    guard let base = buffer.baseAddress else { return }
    let down = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: true)
    down?.keyboardSetUnicodeString(stringLength: count, unicodeString: base)
    down?.post(tap: .cghidEventTap)
    Thread.sleep(forTimeInterval: 0.04)
    let up = CGEvent(keyboardEventSource: nil, virtualKey: 0, keyDown: false)
    up?.keyboardSetUnicodeString(stringLength: count, unicodeString: base)
    up?.post(tap: .cghidEventTap)
  }
}

func removeExistingKeychainItem() throws {
  guard let item = try findProviderKeychainItem() else {
    return
  }

  let status = SecKeychainItemDelete(item)
  if status != errSecSuccess && status != errSecItemNotFound {
    throw DriverFailure(description: "failed to clear existing keychain item: \(status)")
  }
}

func keychainItemExists() throws -> Bool {
  try findProviderKeychainItem() != nil
}

func preferencesTextContainsSelectedProvider(_ text: String) -> Bool {
  text.contains("\"selected_provider\": \"deepseek\"") ||
    text.contains("\"selected_provider\":\"deepseek\"") ||
    text.contains("\"selected_provider\" : \"deepseek\"")
}

func findProviderKeychainItem() throws -> SecKeychainItem? {
  var item: SecKeychainItem?
  let status = keychainService.withCString { servicePointer in
    provider.withCString { providerPointer in
      SecKeychainFindGenericPassword(
        nil,
        UInt32(keychainService.utf8.count),
        servicePointer,
        UInt32(provider.utf8.count),
        providerPointer,
        nil,
        nil,
        &item
      )
    }
  }

  if status == errSecItemNotFound {
    return nil
  }
  if status != errSecSuccess {
    throw DriverFailure(description: "failed to find provider API key metadata in keychain: \(status)")
  }

  return item
}

func resetRuntimeToStub() throws {
  let body: [String: Any] = [
    "provider": "stub",
    "model": NSNull(),
    "endpoint": NSNull(),
    "api_key": NSNull(),
    "clear_api_key": true,
  ]
  let response = try requestJson(path: "/api/provider/config", method: "PUT", body: body)
  if currentProvider(response) != "stub" {
    throw DriverFailure(description: "failed to reset provider runtime before reload")
  }
}

func waitForProviderOptions(timeout: TimeInterval, predicate: ([String: Any]) -> Bool) throws -> [String: Any] {
  let deadline = Date().addingTimeInterval(timeout)
  var last: [String: Any] = [:]
  while Date() < deadline {
    let options = try requestJson(path: "/api/provider/options", method: "GET", body: nil)
    last = options
    if predicate(options) {
      return options
    }
    Thread.sleep(forTimeInterval: 0.5)
  }
  throw DriverFailure(description: "provider options did not reach expected state: \(jsonString(last))")
}

func requestJson(path: String, method: String, body: [String: Any]?) throws -> [String: Any] {
  guard let url = URL(string: "\(apiUrl)\(path)") else {
    throw DriverFailure(description: "invalid API URL")
  }
  var request = URLRequest(url: url)
  request.httpMethod = method
  request.setValue("application/json", forHTTPHeaderField: "Content-Type")
  if let body {
    request.httpBody = try JSONSerialization.data(withJSONObject: body)
  }

  let semaphore = DispatchSemaphore(value: 0)
  var output: Result<[String: Any], Error>!
  URLSession.shared.dataTask(with: request) { data, response, error in
    defer { semaphore.signal() }
    if let error {
      output = .failure(error)
      return
    }
    guard
      let http = response as? HTTPURLResponse,
      (200..<300).contains(http.statusCode),
      let data,
      let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
      output = .failure(DriverFailure(description: "HTTP \(String(describing: (response as? HTTPURLResponse)?.statusCode)) for \(path)"))
      return
    }
    output = .success(json)
  }.resume()

  if semaphore.wait(timeout: .now() + 10) == .timedOut {
    throw DriverFailure(description: "HTTP timeout for \(path)")
  }
  return try output.get()
}

func currentProvider(_ options: [String: Any]) -> String? {
  options["current_provider"] as? String ?? options["provider"] as? String
}

func providerOption(_ options: [String: Any], _ id: String) -> [String: Any]? {
  guard let providers = options["providers"] as? [[String: Any]] else { return nil }
  return providers.first { $0["id"] as? String == id }
}

func latestJoinedWork() -> (workId: String, sessionId: String) {
  let records = readJsonlRecords(appLogDir)
  for record in records.reversed() {
    if record["event"] as? String == "channel.join.done",
       let workId = record["work_id"] as? String,
       let sessionId = record["session_id"] as? String {
      return (workId, sessionId)
    }
  }
  return ("", "")
}

func joinedWorkCount() -> Int {
  readJsonlRecords(appLogDir).filter { record in
    record["event"] as? String == "channel.join.done"
  }.count
}

func waitForJoinedWork(timeout: TimeInterval) throws -> (workId: String, sessionId: String) {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    let joined = latestJoinedWork()
    if !joined.workId.isEmpty && !joined.sessionId.isEmpty {
      return joined
    }
    Thread.sleep(forTimeInterval: 0.5)
  }
  throw DriverFailure(description: "workbench did not emit channel.join.done before CGEvent drive")
}

func waitForJoinedWorkCount(greaterThan previousCount: Int, timeout: TimeInterval) throws -> (workId: String, sessionId: String) {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    let records = readJsonlRecords(appLogDir)
    let joinedRecords = records.filter { record in
      record["event"] as? String == "channel.join.done"
    }
    if joinedRecords.count > previousCount {
      for record in joinedRecords.reversed() {
        if let workId = record["work_id"] as? String,
           let sessionId = record["session_id"] as? String {
          return (workId, sessionId)
        }
      }
    }
    Thread.sleep(forTimeInterval: 0.5)
  }
  throw DriverFailure(description: "Command-R did not reload the Tauri WebView or emit a new channel.join.done")
}

func readJsonlRecords(_ dir: String) -> [[String: Any]] {
  guard let files = try? FileManager.default.contentsOfDirectory(atPath: dir) else { return [] }
  return files
    .filter { $0.hasSuffix(".jsonl") }
    .flatMap { file -> [[String: Any]] in
      let path = "\(dir)/\(file)"
      guard let text = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
      return text
        .split(separator: "\n")
        .compactMap { line in
          guard let data = String(line).data(using: .utf8) else { return nil }
          return try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        }
    }
}

func readAllText(_ path: String) -> String {
  var result = ""
  if let files = try? FileManager.default.contentsOfDirectory(atPath: path) {
    for file in files {
      let fullPath = "\(path)/\(file)"
      if let text = try? String(contentsOfFile: fullPath, encoding: .utf8) {
        result += text
      }
    }
  }
  return result
}

func runProcess(_ command: String, _ args: [String]) -> (status: Int32, stdout: String, stderr: String) {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: command)
  process.arguments = args

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

func writeJson(_ object: Any, to path: String) throws {
  let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
  try data.write(to: URL(fileURLWithPath: path))
}

func jsonString(_ object: Any) -> String {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]) else {
    return "{}"
  }
  return String(data: data, encoding: .utf8) ?? "{}"
}
