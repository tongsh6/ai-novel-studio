import Foundation
import CoreGraphics
import Darwin

// 与真实 ax_cua 编译同一 ax_cua_core.swift；不创建 App、不发真实 CGEvent。
// 覆盖：激活等待必须推进 run loop 才可能确认；超时不得成功；事件创建为 0/不完整
// 时投递结果必须明确失败（ok:false + event_creation_failed）。
@main
struct AxCuaBehaviorTest {
    static func main() {
        // Node 行为测试直接消费这份 JSON：probeEvidence 与 operationEvidence 是真实
        // probe/input 使用的纯 producer；这里只注入事实，不启动 App、不读 AX、不发事件。
        if CommandLine.arguments.contains("--emit-contract") {
            let targetJson: [String: Any] = [
                "schema": "native-input-target/v1",
                "run_ref": "run",
                "bundle_identifier": "com.ai-novel-studio.app",
                "app_path": "/tmp/AI Novel Studio.app",
                "executable_path": "/tmp/AI Novel Studio.app/Contents/MacOS/app",
                "native_executable": "app",
                "pid": 7399,
                "generation": 0,
            ]
            guard let target = InputTarget(targetJson) else {
                print("{}")
                exit(1)
            }
            let frontmost: [String: Any] = [
                "pid": 7399,
                "bundle_identifier": "com.ai-novel-studio.app",
            ]
            let permissions: [String: Any] = ["ax_trusted": true, "post_access": true]
            let focus: [String: Any] = [
                "pid": 7399,
                "role": "AXWebArea",
                "path": "0/0/0/0/0",
                "desc": "AI Novel Studio",
                "enabled": true,
                "value_settable": false,
                "matches": false,
                "expected": [
                    "role": "AXTextField",
                    "path": "0/0/0/0/0/12",
                    "desc_contains": "输入",
                ],
            ]
            let probe = probeEvidence(
                target: target,
                pid: 7399,
                executablePath: target.executablePath,
                bundleIdentifier: target.bundleIdentifier,
                frontmost: frontmost,
                permissions: permissions,
                focus: focus
            )
            let activation: [String: Any] = [
                "requested": true,
                "returned": true,
                "confirmed": true,
                "waited_ms": 50,
                "frontmost_before": ["pid": 999, "bundle_identifier": "com.other"],
                "frontmost_after": frontmost,
                "target_active": true,
                "advances": 2,
            ]
            let result = operationEvidence(
                target: target,
                result: ["ok": true, "reason": NSNull(), "activation": activation],
                permissions: permissions,
                frontmostAfter: frontmost
            )
            let startup = startupRunningFacts(
                isFinishedLaunching: false,
                launchDate: Date(timeIntervalSince1970: 1_700_000_000),
                activationPolicy: .regular,
                isHidden: false,
                isActive: false
            )
            json(["probe": probe, "activation_result": result, "startup": startup])
            exit(0)
        }

        var failures: [String] = []
        func expect(_ condition: Bool, _ name: String) {
            if !condition { failures.append(name) }
        }

        // 0) Swift 入口与 Node 同一边界：非法 PID/负 generation 不能进入 resolve。
        let baseTarget: [String: Any] = [
            "schema": "native-input-target/v1",
            "run_ref": "run",
            "bundle_identifier": "com.example.app",
            "app_path": "/tmp/AI Novel Studio.app",
            "executable_path": "/tmp/AI Novel Studio.app/Contents/MacOS/app",
            "native_executable": "app",
            "generation": 0,
        ]
        if let invalidPid = InputTarget(baseTarget.merging(["pid": 0]) { _, new in new }) {
            expect(targetMetadataFailure(invalidPid) == "target_pid_invalid", "swift rejects pid 0")
        } else {
            failures.append("InputTarget pid fixture")
        }
        if let invalidGeneration = InputTarget(baseTarget.merging(["generation": -1]) { _, new in new }) {
            expect(targetMetadataFailure(invalidGeneration) == "target_generation_invalid", "swift rejects negative generation")
        } else {
            failures.append("InputTarget generation fixture")
        }

        // 0b) 启动事实只由 NSRunningApplication 字段投影；缺失 launchDate 如实为 null。
        let startupFacts = startupRunningFacts(
            isFinishedLaunching: false,
            launchDate: Date(timeIntervalSince1970: 1_700_000_000),
            activationPolicy: .regular,
            isHidden: true,
            isActive: false
        )
        expect(startupFacts["is_finished_launching"] as? Bool == false, "startup finished flag")
        expect(startupFacts["launch_date"] as? String == "2023-11-14T22:13:20Z", "startup launch date iso")
        expect(startupFacts["activation_policy"] as? String == "regular", "startup activation policy")
        expect(startupFacts["is_hidden"] as? Bool == true, "startup hidden flag")
        let startupWithoutDate = startupRunningFacts(
            isFinishedLaunching: true,
            launchDate: nil,
            activationPolicy: .accessory,
            isHidden: false,
            isActive: true
        )
        expect(startupWithoutDate["launch_date"] is NSNull, "missing launch date stays null")
        expect(startupWithoutDate["activation_policy"] as? String == "accessory", "startup accessory policy")
        expect(startupWithoutDate["is_active"] as? Bool == true, "startup active flag")

        // 1) 不推进 run loop / observer 不更新：即使循环在跑也不能确认。
        var clock1 = 0.0
        var advances1 = 0
        let noAdvanceHooks = ActivationWaitHooks(
            now: { clock1 },
            advance: { _ in advances1 += 1 },
            frontmostPid: { 1 },
            targetActive: { false },
            frontmostIdentity: { ["pid": 1] }
        )
        let noAdvance = waitForActivation(targetPid: 42, timeout: 0.2, slice: 0.05, hooks: noAdvanceHooks)
        expect(!noAdvance.confirmed, "no-advance must not confirm")
        expect(advances1 > 0, "wait must attempt bounded advances")
        expect(noAdvance.waitedMs == 0, "no clock advance means zero elapsed")

        // 2) 有界推进后目标 PID + isActive 更新：确认；elapsed 用真实注入时钟。
        var clock2 = 0.0
        var front2: pid_t? = 1
        var active2 = false
        let advancingHooks = ActivationWaitHooks(
            now: { clock2 },
            advance: { interval in
                clock2 += interval
                if clock2 >= 0.1 {
                    front2 = 42
                    active2 = true
                }
            },
            frontmostPid: { front2 },
            targetActive: { active2 },
            frontmostIdentity: { ["pid": Int(front2 ?? 0)] }
        )
        let advanced = waitForActivation(targetPid: 42, timeout: 1.0, slice: 0.05, hooks: advancingHooks)
        expect(advanced.confirmed, "advance then observed frontmost must confirm")
        expect(advanced.waitedMs >= 100, "elapsed must come from clock")
        expect(advanced.advances >= 2, "confirmation needs bounded run-loop turns")

        // 3) 超时：推进了时钟但从未观测到目标前台，不能成功。
        var clock3 = 0.0
        let timeoutHooks = ActivationWaitHooks(
            now: { clock3 },
            advance: { interval in clock3 += interval },
            frontmostPid: { 1 },
            targetActive: { false },
            frontmostIdentity: { ["pid": 1] }
        )
        let timedOut = waitForActivation(targetPid: 42, timeout: 2.0, slice: 0.05, hooks: timeoutHooks)
        expect(!timedOut.confirmed, "timeout must not confirm")
        expect(timedOut.waitedMs >= 2000, "timeout waited_ms must reflect actual clock")

        // 4) factory 创建 nil：0 投递；投递结果必须明确失败，不能 ok:true。
        var postedNil = 0
        let nilPoster = EventPoster<Int>(
            key: { _, _, _ in nil },
            chunk: { _, _ in nil },
            mouse: { _, _, _ in nil },
            scroll: { _, _ in nil },
            post: { _, _ in postedNil += 1 }
        )
        expect(postKeyToPid(42, code: 0, flags: [], poster: nilPoster) == 0, "nil key creation posts 0")
        expect(postChunkToPid(42, chunk: [65], poster: nilPoster) == 0, "nil chunk creation posts 0")
        expect(postMouseToPid(42, point: .zero, count: 1, poster: nilPoster) == 0, "nil mouse creation posts 0")
        expect(postScrollToPid(42, point: .zero, dy: 1, poster: nilPoster) == 0, "nil scroll creation posts 0")
        expect(postedNil == 0, "nil factory must not post")
        let failed = deliveryOutcome(posted: 0, expected: 2, method: "cgevent_to_pid")
        expect(failed["ok"] as? Bool == false, "zero events must fail")
        expect(failed["reason"] as? String == "event_creation_failed", "zero events reason")
        let partial = deliveryOutcome(posted: 1, expected: 2, method: "cgevent_to_pid")
        expect(partial["ok"] as? Bool == false, "incomplete events must fail")

        // 5) 正向：factory 提供事件且 poster 只计数（不调用 postToPid 真实系统事件）。
        var postedPositive = 0
        let positivePoster = EventPoster<Int>(
            key: { _, _, _ in 1 },
            chunk: { _, _ in 2 },
            mouse: { _, _, _ in 3 },
            scroll: { _, _ in 4 },
            post: { _, _ in postedPositive += 1 }
        )
        expect(postKeyToPid(42, code: 0, flags: [], poster: positivePoster) == 2, "key down+up")
        expect(postChunkToPid(42, chunk: [65], poster: positivePoster) == 2, "chunk down+up")
        expect(postMouseToPid(42, point: .zero, count: 1, poster: positivePoster) == 3, "move+down+up")
        expect(postScrollToPid(42, point: .zero, dy: 1, poster: positivePoster) == 2, "move+scroll")
        expect(postedPositive == 9, "fake poster counts every event, no real post")
        let ok = deliveryOutcome(posted: 2, expected: 2, method: "cgevent_to_pid")
        expect(ok["ok"] as? Bool == true, "all expected events posted is ok")

        if failures.isEmpty {
            print("ok ax_cua activation/delivery seams")
            exit(0)
        }
        print("FAIL: \(failures.joined(separator: ", "))")
        exit(1)
    }
}
