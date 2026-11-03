import { describe, expect, it } from "vitest";

import {
  authorVisibleForbiddenTokens,
  authorVisibleSourceHash,
  displayName,
  presentAuthorVisible,
  type AuthorVisibleText,
} from "../authorVisible";

describe("authorVisible", () => {
  it("已登记 code 返回作者显示名，未登记 code 走兜底且不回显内部 code", () => {
    expect(displayName("tool", "prose_writing")).toBe("正文写作");
    expect(displayName("provider", "stub")).toBe("本地模型（测试环境）");
    expect(displayName("status", "ACCEPTED")).toBe("已采纳");

    const unknown = displayName("tool", "definitely_unknown_tool");
    expect(unknown).toBe("创作操作");
    expect(unknown).not.toContain("definitely_unknown_tool");

    const empty = displayName("provider", null);
    expect(empty).toBe("当前模型服务");
  });

  it("presentAuthorVisible 产出品牌类型", () => {
    const branded: AuthorVisibleText = presentAuthorVisible("tool", "submit_tentative_artifact");
    expect(branded).toBe("保存候选草稿");
    expect(typeof branded).toBe("string");
  });

  it("forbidden tokens 与 SSOT hash 可用（前后端同源）", () => {
    const tokens = authorVisibleForbiddenTokens();
    expect(tokens.protocol_codes).toContain("prose_writing");
    expect(tokens.internal_terms_zh).toContain("工作过程");
    expect(tokens.internal_identifiers).toContain("slice_verify");

    expect(authorVisibleSourceHash()).toMatch(/^[0-9a-f]{64}$/);
  });
});
