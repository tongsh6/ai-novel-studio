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

  it("available_actions 的 label_key/action_type 走 SSOT，未登记兜底不回显内部 code", () => {
    expect(displayName("action", "fact_inventory.start")).toBe("发起设定盘点");
    expect(displayName("action", "fact_inventory.dismiss")).toBe("关闭盘点提议");
    expect(displayName("action", "edit_then_accept")).toBe("修改后采纳");
    expect(displayName("action", "choose_candidate")).toBe("设为后续方向");

    const unknown = displayName("action", "internal_action_type_v9");
    expect(unknown).toBe("操作");
    expect(unknown).not.toContain("internal_action_type_v9");
  });

  it("forbidden tokens 与 SSOT hash 可用（前后端同源）", () => {
    const tokens = authorVisibleForbiddenTokens();
    expect(tokens.protocol_codes).toContain("prose_writing");
    expect(tokens.internal_terms_zh).toContain("工作过程");
    expect(tokens.internal_identifiers).toContain("slice_verify");

    expect(authorVisibleSourceHash()).toMatch(/^[0-9a-f]{64}$/);
  });
});
