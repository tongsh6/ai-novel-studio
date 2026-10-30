// B73 回归守卫：AgentRun 叙事段落间距由父容器 flex gap 单一来源控制，禁止段落 margin 与 gap 叠加。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = path.resolve(import.meta.dirname, "../../..");
const CSS = fs.readFileSync(path.join(ROOT, "frontend/src/components/WorkspaceChat.module.css"), "utf8");

function rule(css, selector) {
  const start = css.indexOf(`${selector} {`);
  assert.ok(start >= 0, `missing rule ${selector}`);
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
}

test("父容器用 flex gap 控制叙事段落间距", () => {
  assert.match(CSS, /\.agenticLoopReasoning \{[^}]*gap: 12px;/su);
});

test("叙事段落自身不叠加 margin（避免 gap+margin 双倍空行）", () => {
  const paragraph = rule(CSS, ".agenticLoopNarrativeParagraph");
  assert.match(paragraph, /margin: 0;/u);
  assert.doesNotMatch(paragraph, /margin-bottom:/u);
});
