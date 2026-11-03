// 作者可见文本 AX 通用断言（所有原生 journey 共用同一实现）。
//
// 输入：AX dump 文本（.ax.txt）与/或场景可见文本 .text.txt。
// 输出：{ok, hits}，供 evidence 结构统一记录 `author_visible_no_internal_tokens`。
//
// 边界（D5 裁决）：只扫应用生成文本 + a11y 接缝；模型生成正文不在本断言范围
// （由 prompt/材料治理单列）。AX dump 的 name/description/value 按元素拆分扫描，
// 不做拼接，避免 `AI AI 名称` / `会话 0` 这类伪泄漏误报。

import { extractAxTexts, loadForbiddenTokens, scanAuthorVisibleTexts } from "../author_visible/leak_scan.mjs";

export function checkAuthorVisibleTexts({ axText, visibleText, tokens, categories } = {}) {
  const texts = [];

  if (typeof visibleText === "string" && visibleText.trim() !== "") {
    texts.push({ text: visibleText, source: "visible" });
  }
  if (typeof axText === "string" && axText.trim() !== "") {
    texts.push(...extractAxTexts(axText));
  }

  // 默认不传 categories = 扫描器全类别启用（安全默认）。迁移期调用方如需显式声明
  // 已迁移类别，可传 categories；该收窄必须在 P1 完成后删除（不留长期开关）。
  return scanAuthorVisibleTexts(texts, {
    tokens: tokens ?? loadForbiddenTokens(),
    categories,
  });
}

export function authorVisibleCheckName() {
  return "author_visible_no_internal_tokens";
}
