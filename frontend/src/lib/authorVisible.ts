// Design: docs/design/schemas/author_visible/display_names.json（作者可见展示名 SSOT）
// 作者可见文本的唯一转换入口：内部 code 必须经 displayName/presentAuthorVisible 转成作者可读文本。
// 未登记的 code 使用 SSOT domain 兜底文案（绝不展示内部 code 本身）。

import {
  DISPLAY_NAMES,
  FALLBACKS,
  FORBIDDEN_TOKENS,
  SOURCE_HASH,
  type DisplayKind,
} from "../generated/author_visible/displayNames";

/** 品牌类型：只有本模块的转换函数能产出，防止裸 string 冒充作者可见文本。 */
export type AuthorVisibleText = string & { readonly __authorVisible: unique symbol };

const importMeta = import.meta as ImportMeta & { env?: { DEV?: boolean } };
const isDev = importMeta.env?.DEV === true;

/** 某 domain 的已登记内部 code 列表（用于过滤器/枚举 UI；顺序取 SSOT 定义序）。 */
export function displayCodes(kind: DisplayKind): string[] {
  return Object.keys(DISPLAY_NAMES[kind]);
}

/** 内部 code → 作者显示名；未登记 code 返回 domain 兜底文案。 */
export function displayName(kind: DisplayKind, code: string | null | undefined): string {
  const table = DISPLAY_NAMES[kind] as Record<string, string>;
  const key = typeof code === "string" ? code : "";
  const value =
    key !== "" && Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;

  if (typeof value === "string") return value;

  if (isDev) {
    console.warn(`[authorVisible] missing display name for ${kind}:${key || "(empty)"}`);
  }

  return FALLBACKS[kind];
}

/** 内部 code → 作者可见文本（branded）。 */
export function presentAuthorVisible(
  kind: DisplayKind,
  code: string | null | undefined,
): AuthorVisibleText {
  return displayName(kind, code) as AuthorVisibleText;
}

/** 作者可见禁止 token（协议 code / 内部术语 / 内部标识 / ref 模式 / 白名单）。 */
export function authorVisibleForbiddenTokens() {
  return FORBIDDEN_TOKENS;
}

/** SSOT 内容哈希；前后端生成物必须一致。 */
export function authorVisibleSourceHash(): string {
  return SOURCE_HASH;
}
