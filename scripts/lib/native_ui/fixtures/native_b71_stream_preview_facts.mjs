// B71 流式预览证据族纯事实 owner：只提供内存帧/文本，不创建目录、DB 或子进程。
// 真实文件模板在 `native_b71_stream_preview_io_fixture.mjs`；反例仍只替换单一
// 真实事实（run/purpose/call 归属、顺序、终局边界），不另造一套场景期望。
export const PREVIEW_MESSAGE = "先写第01章正文草稿，再做质量复核；这是一项可恢复的长任务。";
export const PREVIEW_TOPIC = "workspace:stream-preview";
export const PREVIEW_RUN = "run_stream_preview_1";
export const PREVIEW_CALL = "pcall_stream_preview_1";
export const PREVIEW_PROVIDER_RUN = "prun_stream_preview_1";
export const PREVIEW_DELTAS = [
  "夜色压在这座赛博修仙城市上，",
  "灵气账单从屋檐下垂落，像一串",
  "像一串即将燃尽的符纸。",
];
export const PREVIEW_PROSE = PREVIEW_DELTAS.join("");
export const PREVIEW_TURN = "message_stream_preview_1";
export const PREVIEW_CONFIG = "native-b71-config.json";
export const PREVIEW_READY = "native-driver-ready.json";
export const PREVIEW_DRIVER_LOG = "native-b71-driver-log.json";
export const PREVIEW_TEXT = "02-prose-preview.text.txt";
export const PREVIEW_AX = "02-prose-preview.ax.txt";
export const PREVIEW_FINAL = "03-final.jpg";
export const PREVIEW_TRANSPORT = "native-transport.jsonl";

export function previewText(previewProse = PREVIEW_PROSE) {
  return `正文生成中\n${previewProse.slice(0, 20)}\n生成中，尚未保存为候选。\n`;
}

export function streamPreviewRecords() {
  const at = (second) => `2026-01-01T00:00:${String(second).padStart(2, "0")}.000Z`;
  let accumulated = 0;
  return [
    {
      at: at(1),
      direction: "sent",
      frame: ["5", "9", PREVIEW_TOPIC, "user_message", {
        turn_id: PREVIEW_TURN,
        text: PREVIEW_MESSAGE,
      }],
    },
    {
      at: at(2),
      direction: "received",
      frame: ["5", "9", PREVIEW_TOPIC, "phx_reply", {
        status: "ok",
        response: { turn_id: PREVIEW_TURN, run_id: PREVIEW_RUN },
      }],
    },
    ...PREVIEW_DELTAS.map((delta, index) => {
      accumulated += delta.length;
      return {
        at: at(3 + index),
        direction: "received",
        frame: [null, null, PREVIEW_TOPIC, "agent_event", {
          payload: {
            status: "running",
            provider_call_ref: PREVIEW_CALL,
            provider_run_ref: PREVIEW_PROVIDER_RUN,
            purpose: "writer",
            output_type: "text",
            chunk_index: index + 1,
            accumulated_content_length: accumulated,
            author_content_delta: delta,
            chunk_content_length: delta.length,
            provider_event_type: "chunk",
          },
          run_id: PREVIEW_RUN,
          run_ref: PREVIEW_RUN,
          event_type: "provider_progress",
          event_id: `evt_stream_${index + 1}`,
          sequence: index + 1,
        }],
      };
    }),
    {
      at: at(20),
      direction: "received",
      frame: [null, null, PREVIEW_TOPIC, "turn_result", {
        turn_id: `${PREVIEW_TURN}:agent:1`,
        agent_run: { status: "completed", run_id: PREVIEW_RUN },
        assistant_message: { text: "已生成预览。" },
      }],
    },
  ];
}
