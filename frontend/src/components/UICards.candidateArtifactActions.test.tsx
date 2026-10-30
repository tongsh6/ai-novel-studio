// B74：候选内容卡内承载 artifact 级动作（保存按钮贴在该候选内容下方）。
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CandidateSetCard } from "./UICards";

const card = {
  card_type: "candidate_set" as const,
  title: "第03章：灯楼夜戏正文草稿",
  artifact_type: "prose_fragment",
  candidate_set_ref: "candidate_set:turn-1",
  items: [{ item_id: "prose-1", title: "灯楼夜戏", body: "正文内容", rationale: "依据" }],
};

describe("候选内容卡内动作", () => {
  it("提供 renderArtifactActions 时，保存按钮渲染在卡内且位于正文之后", () => {
    const html = renderToStaticMarkup(
      <CandidateSetCard
        card={card}
        renderArtifactActions={() => <button type="button">保存原稿</button>}
      />,
    );
    expect(html).toContain("保存原稿");
    // 同一卡片容器中：正文内容先于动作按钮出现（按钮贴在候选内容下方）。
    expect(html.indexOf("正文内容")).toBeGreaterThanOrEqual(0);
    expect(html.indexOf("正文内容")).toBeLessThan(html.indexOf("保存原稿"));
  });

  it("未提供动作时只读，不渲染动作区", () => {
    const html = renderToStaticMarkup(<CandidateSetCard card={card} />);
    expect(html).not.toContain("<button");
  });
});
