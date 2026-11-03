// 作者可见文本 AX 通用断言（所有原生 journey 共用同一实现）。
//
// 输入：AX dump 文本（.ax.txt）与/或场景可见文本 .text.txt。
// 输出：{ok, hits}，供 evidence 结构统一记录 `author_visible_no_internal_tokens`。
//
// 边界（D5 裁决）：只扫应用生成文本 + a11y 接缝；模型生成正文不在本断言范围
// （由 prompt/材料治理单列）。AX dump 的 name/description/value 按元素拆分扫描，
// 不做拼接，避免 `AI AI 名称` / `会话 0` 这类伪泄漏误报。

import { extractAxTexts, loadForbiddenTokens, scanAuthorVisibleTexts } from "../author_visible/leak_scan.mjs";

export function checkAuthorVisibleTexts({ axText, visibleText, tokens } = {}) {
  const texts = [];

  if (typeof visibleText === "string" && visibleText.trim() !== "") {
    texts.push({ text: visibleText, source: "visible" });
  }
  if (typeof axText === "string" && axText.trim() !== "") {
    texts.push(...extractAxTexts(axText));
  }

  return scanAuthorVisibleTexts(texts, { tokens: tokens ?? loadForbiddenTokens() });
}

export function authorVisibleCheckName() {
  return "author_visible_no_internal_tokens";
}
