#!/usr/bin/env node
// 作者可见文本泄漏扫描器单测（node --test）。
//
// 覆盖三类证据面：
// 1. 作者可见产品文案必须命中内部 token；
// 2. AX 提取伪泄漏（`AI AI 名称`、`会话 0`）不得因 dump 拼接而误报；
// 3. 白名单只按 SSOT 登记生效。

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AUTHOR_VISIBLE_MIGRATION_CATEGORIES,
  extractAxTexts,
  loadForbiddenTokens,
  scanAuthorVisibleTexts,
  scanAxDump,
} from "./leak_scan.mjs";

test("SSOT forbidden tokens 可加载且包含协议 code/内部术语/内部标识", () => {
  const tokens = loadForbiddenTokens();
  assert.ok(tokens.protocol_codes.includes("prose_writing"));
  assert.ok(tokens.internal_terms_zh.includes("工作过程"));
  assert.ok(tokens.internal_identifiers.includes("Stub"));
  assert.ok(tokens.ref_patterns.length > 0);
});

test("应用文案命中内部 code / 术语 / ref 时报告命中", () => {
  const result = scanAuthorVisibleTexts([
    "已取消等待；「prose_writing」不会执行",
    "当前创作请求的工作过程",
    "artifact:abc123def",
  ]);

  assert.equal(result.ok, false);
  const tokens = result.hits.map((hit) => hit.token);
  assert.ok(tokens.includes("prose_writing"));
  assert.ok(tokens.includes("工作过程"));
  assert.ok(tokens.includes("artifact:abc123def"));
});

test("作者可读文案零命中", () => {
  const result = scanAuthorVisibleTexts([
    "已取消等待；这项操作不会执行，也没有写入作品事实。",
    "本轮创作过程",
    "已确认「正文写作」操作",
  ]);

  assert.equal(result.ok, true);
  assert.deepEqual(result.hits, []);
});

test("AX 伪泄漏不误报：AI 名称（name+description 拼接）与 会话 0（Value 折叠态）", () => {
  const ax = [
    "0/0/0/0/0/1 AXPopUpButton, AI, Description: AI 名称, enabled=true, focused=false, Actions: AXPress",
    "0/0/0/0/0/2/0 AXDisclosureTriangle, 会话, subrole=AXSummary, Value: 0, enabled=true, focused=false",
    "0/0/0/0/0/11/0 AXStaticText, Value: 欢迎使用 AI Novel Studio！, enabled=true",
  ].join("\n");

  const result = scanAxDump(ax);
  assert.equal(result.ok, true, JSON.stringify(result.hits));
});

test("AX 真实 a11y 泄漏会命中：provider/model 内部标识与工具 code", () => {
  const ax = [
    "0/0/0/0/0/8 AXPopUpButton, 模型已连接, Description: Stub · 当前模型：slice_verify, enabled=true, focused=false",
    "0/0/0/0/0/12 AXStaticText, Value: 已取消等待；「prose_writing」不会执行，也没有写入作品事实。, enabled=true",
  ].join("\n");

  const result = scanAxDump(ax);
  assert.equal(result.ok, false);
  const tokens = result.hits.map((hit) => hit.token);
  assert.ok(tokens.includes("Stub"));
  assert.ok(tokens.includes("slice_verify"));
  assert.ok(tokens.includes("prose_writing"));
});

test("AX 提取按元素拆分 name/description/value，不做跨字段拼接", () => {
  const texts = extractAxTexts(
    "0/0/0/0/0/1 AXPopUpButton, AI, Description: AI 名称, enabled=true\n" +
      "0/0/0/0/0/11/0 AXStaticText, Value: 第一行\n第二行, enabled=true",
  );
  const values = texts.map((entry) => entry.text);
  assert.ok(values.includes("AI"));
  assert.ok(values.includes("AI 名称"));
  assert.ok(values.includes("第一行"));
});

test("白名单只来自 SSOT allow 字段", () => {
  const tokens = {
    allow: ["工作过程"],
    protocol_codes: ["prose_writing"],
    internal_terms_zh: ["工作过程"],
    internal_identifiers: [],
    ref_patterns: [],
  };

  const allowed = scanAuthorVisibleTexts(["当前创作请求的工作过程"], { tokens });
  assert.equal(allowed.ok, true);

  const denied = scanAuthorVisibleTexts(["prose_writing 正在执行"], { tokens });
  assert.equal(denied.ok, false);
});

test("categories 只在调用方显式声明已迁移类别时收窄；默认全类别安全", () => {
  const mixed = "当前创作请求的工作过程与 prose_writing";
  // 默认：全类别启用 → 中文内部术语也命中。
  assert.equal(scanAuthorVisibleTexts([mixed]).ok, false);

  // 迁移期显式收窄：协议 code（prose_writing）仍命中。
  assert.equal(
    scanAuthorVisibleTexts([mixed], { categories: AUTHOR_VISIBLE_MIGRATION_CATEGORIES }).ok,
    false,
  );

  // internal_terms_zh 未启用时，仅含中文内部术语的文本不命中（P1 迁移后必须恢复全开）。
  assert.equal(
    scanAuthorVisibleTexts(["当前创作请求的工作过程"], {
      categories: AUTHOR_VISIBLE_MIGRATION_CATEGORIES,
    }).ok,
    true,
  );
});
