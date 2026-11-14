// B71 流式预览证据族唯一的真实文件 fixture owner。
//
// 只服务 `../../../native_b71_evidence.test.mjs`：原生 config/ready/driver-log、
// AX/可见预览文本、终态截图与 wire 帧。帧事实来自
// `native_b71_stream_preview_facts.mjs`；本模块只负责把它们封成只读 payload，
// 不 import 被测 verify 路径，也不启动 GUI/Mix。
//
// 反例由 case 在 `createWorkingCopy` 副本上重写单一真实事实（run/purpose/call
// 归属、顺序、终局边界）或预览文本；模板本身不被修改。
import fs from "node:fs";
import {
  PREVIEW_AX,
  PREVIEW_CONFIG,
  PREVIEW_DRIVER_LOG,
  PREVIEW_FINAL,
  PREVIEW_MESSAGE,
  PREVIEW_READY,
  PREVIEW_TEXT,
  PREVIEW_TRANSPORT,
  PREVIEW_TURN,
  previewText,
  streamPreviewRecords,
} from "./native_b71_stream_preview_facts.mjs";

const CONFIG = {
  slice_id: "b71-authoring-transcript",
  journey: "continuation",
  provider: "streaming_slice_verify",
  message: PREVIEW_MESSAGE,
};
const READY = { provider: "streaming_slice_verify" };
const DRIVER_LOG = {
  provider: "streaming_slice_verify",
  preview_captured: true,
  turn_id: PREVIEW_TURN,
  assistant_text: "已生成预览。",
};

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value));
}

function buildWithInputs(staging, inputs) {
  const records = JSON.parse(inputs.records);
  writeJson(`${staging}/${PREVIEW_CONFIG}`, JSON.parse(inputs.config));
  writeJson(`${staging}/${PREVIEW_READY}`, JSON.parse(inputs.ready));
  writeJson(`${staging}/${PREVIEW_DRIVER_LOG}`, JSON.parse(inputs.driver_log));
  fs.writeFileSync(`${staging}/${PREVIEW_TEXT}`, inputs.preview_text);
  fs.writeFileSync(`${staging}/${PREVIEW_AX}`, "AX preview\n");
  fs.writeFileSync(`${staging}/${PREVIEW_FINAL}`, Buffer.from("ffd8ff00", "hex"));
  fs.writeFileSync(
    `${staging}/${PREVIEW_TRANSPORT}`,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
  );
  return [PREVIEW_CONFIG, PREVIEW_READY, PREVIEW_DRIVER_LOG, PREVIEW_TEXT, PREVIEW_AX, PREVIEW_FINAL, PREVIEW_TRANSPORT];
}

/** 同一预览规格在 run 内只物化一次；builder 只在 claim 后同步执行。 */
export function streamPreviewFixtureSpec() {
  const inputs = {
    records: JSON.stringify(streamPreviewRecords()),
    preview_text: previewText(),
    config: JSON.stringify(CONFIG),
    ready: JSON.stringify(READY),
    driver_log: JSON.stringify(DRIVER_LOG),
    builder_source: fs.readFileSync(new URL(import.meta.url), "utf8"),
    pure_fixture_source: fs.readFileSync(
      new URL("./native_b71_stream_preview_facts.mjs", import.meta.url),
      "utf8",
    ),
    runtime: `node=${process.version}`,
  };
  return {
    name: "b71-stream-preview",
    inputs,
    build: (staging) => buildWithInputs(staging, inputs),
  };
}
