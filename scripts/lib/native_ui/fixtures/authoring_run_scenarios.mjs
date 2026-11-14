// B71 first-consumer run 证据族的纯事实 owner：帧、canonical transcript、ACK/完成
// 结果与 llm 记录只作为内存数据。真实 4 表 SQLite + config 在
// `authoring_run_io_fixture.mjs`；纯测试与 IO 测试共享同一组事实。
import { irBodyFromWire } from "./authoring_request_ir.mjs";

export const F_WORK = "work-first";
export const F_WORKSPACE = "workspace-first";
export const F_SESSION = "session-first";
export const F_PARENT = "message-first";
export const F_RUN = "run-first";
export const F_DECOY = "run-decoy";
export const F_MESSAGE = "「灰烬中的手印」这章我怀疑有重复，请把全章核对一遍。";
export const F_TOPIC = `workspace:${F_WORKSPACE}`;
export const F_T0 = "2026-11-02T01:00:00.000Z";
export const F_T1 = "2026-11-02T01:00:00.100Z";
export const F_T2 = "2026-11-02T01:00:00.200Z";
export const F_T3 = "2026-11-02T01:00:00.300Z";
export const F_T4 = "2026-11-02T01:00:01.000Z";

export const F_FIRST_SPEC = Object.freeze({
  message: F_MESSAGE,
  missingInput: "缺全章核对输入",
  missingAck: "缺真实输入 ack run_id",
  missingCompleted: "缺同一 bounded run 的完成结果",
  completedTurn: "first",
  requireRunMode: "bounded",
});

export const SEGMENT_VERSION = "authoring-run-segment/v1";
export const MESSAGE_FORMAT_VERSION = "authoring-session-message/v1";

export function frame(event, body, direction = "received", at = "2026-11-01T08:00:00.000Z") {
  return { direction, at, frame: ["join", "ref", "room:test", event, body] };
}

export function wf(joinRef, requestRef, event, body, direction = "received", at = F_T0) {
  return { direction, at, frame: [joinRef, requestRef, F_TOPIC, event, body] };
}

export function boundedTranscript(
  runId = F_RUN,
  calls = ["pcall-1", "prun-1", "call-1", "pcall-2", "prun-2", "call-2"],
) {
  const [pcall1, prun1, call1, pcall2, prun2, call2] = calls;
  return {
    version: "authoring-transcript/v1",
    transcript: {
      run: {
        run_id: runId,
        workspace_id: F_WORKSPACE,
        work_id: F_WORK,
        session_id: F_SESSION,
        parent_turn_ref: F_PARENT,
        profile_ref: "judgment_loop_v1",
      },
      system: { identity_ref: "identity:authoring/v1" },
      messages: [
        { role: "user", provenance: "author", blocks: [{ type: "text", text: F_MESSAGE }] },
        {
          role: "assistant",
          provenance: "model",
          provider_call_ref: pcall1,
          provider_run_ref: prun1,
          blocks: [{ type: "tool_call", call_id: call1, name: "search", arguments: {} }],
        },
        { role: "tool", blocks: [{ type: "observation", call_id: call1, content: { query: "{}" } }] },
        {
          role: "assistant",
          provenance: "model",
          provider_call_ref: pcall2,
          provider_run_ref: prun2,
          blocks: [{ type: "tool_call", call_id: call2, name: "search", arguments: {} }],
        },
        { role: "tool", blocks: [{ type: "observation", call_id: call2, content: { query: "{}" } }] },
      ],
      tools: [{ name: "search" }],
      base_refs: [],
      observation_refs: [],
      used_refs: [],
      projection: { target: "chat_completions" },
      call_ids: [call1, call2],
    },
  };
}

export function firstConsumerEvidence() {
  const join = wf("join-3", "join-3", "phx_join", { work_id: F_WORK, session_id: F_SESSION }, "sent", F_T0);
  const joinReply = wf(
    "join-3",
    "join-3",
    "phx_reply",
    { status: "ok", response: { joined: true, work_id: F_WORK, session_id: F_SESSION } },
    "received",
    F_T1,
  );
  const sent = wf(
    "join-3",
    "request-4",
    "user_message",
    { text: F_MESSAGE, turn_id: F_PARENT, work_id: F_WORK, session_id: F_SESSION },
    "sent",
    F_T2,
  );
  const ack = wf(
    "join-3",
    "request-4",
    "phx_reply",
    { status: "ok", response: { turn_id: F_PARENT, run_id: F_RUN, run_mode: "bounded" } },
    "received",
    F_T3,
  );
  const result = wf(
    "join-3",
    "request-4",
    "turn_result",
    {
      turn_id: F_PARENT,
      agent_run: { run_id: F_RUN, status: "completed", run_mode: "bounded" },
      adoption_state: { pending: [] },
    },
    "received",
    F_T4,
  );
  const unrelatedResult = wf("join-3", "request-4", "turn_result", { turn_id: "turn-other" }, "received", F_T4);
  const wire = [join, joinReply, sent, ack, result, unrelatedResult];
  const exchange = (n, turnId = `${F_PARENT}:agent:${n}`) => ({
    provider: "slice_verify",
    request_format: "authoring-request-ir/v1",
    response_format: "fixture_provider_result/v1",
    provider_call_ref: `pcall-${n}`,
    provider_run_ref: `prun-${n}`,
    work_id: F_WORK,
    session_id: F_SESSION,
    turn_id: turnId,
    request_body: irBodyFromWire({ messages: [{ role: "user", content: F_MESSAGE }] }),
    response: {
      status: "ok",
      body: { content: "", tool_calls: [{ id: `call-${n}`, name: "search", arguments: {} }] },
    },
  });
  const llmRecords = [exchange(1), exchange(2), exchange(9)];
  return { wire, sent, ack, result, llmRecords, evidence: { wire, userMessages: [sent], llmRecords } };
}
