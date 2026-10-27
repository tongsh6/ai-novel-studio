// K4 静态回归（Lead 裁决，B42）：`scripts/quality_accept.sh` 双引号内 `$var` 后紧跟
// 非 ASCII 字符（全角标点等）时会被 bash 并入变量名；`set -u` 下报 unbound variable，
// 退出码变 127，破坏 e2e aggregate 的 65/67/69 透传与失败路径诊断。
//
// 规则：双引号内必须写 `${var}` 再跟全角字符；本测试扫描真实脚本 + 用反例自检扫描器，
// 防止同类写法再次引入。运行：node --test scripts/lib/quality/quality_accept_shell_safety.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "../../..");
const SCRIPT_PATH = "scripts/quality_accept.sh";

/**
 * 扫描双引号内 `$name` 紧跟非 ASCII 字符的写法。
 * 返回 [{line, variable, next, snippet}]；`${name}` 不算违规。
 */
export function findBareVarsBeforeNonAscii(source, file = "<source>") {
  const violations = [];
  let inDoubleQuote = false;
  let line = 1;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === "\n") {
      line += 1;
      continue;
    }
    if (inDoubleQuote && char === "\\") {
      index += 1; // 跳过转义字符
      continue;
    }
    if (char === '"') {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (!inDoubleQuote || char !== "$") continue;
    const rest = source.slice(index + 1);
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest);
    if (!match) continue;
    const nextChar = source[index + 1 + match[0].length];
    if (nextChar === undefined) continue;
    if (nextChar.codePointAt(0) > 0x7f) {
      violations.push({
        file,
        line,
        variable: `$${match[0]}`,
        next: nextChar,
        snippet: source.split("\n")[line - 1].trim().slice(0, 160),
      });
    }
  }
  return violations;
}

test("扫描器自检：双引号内 $var+全角字符命中；${var}/单引号/普通 ASCII 不误报", () => {
  const bad = 'echo "x $scenario_id：y"\necho "e2e $e2e_rc）"\n';
  const hits = findBareVarsBeforeNonAscii(bad, "<bad>");
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((hit) => hit.variable), ["$scenario_id", "$e2e_rc"]);
  const good = [
    'echo "x ${scenario_id}：y"',
    "echo 'x $scenario_id：y'",
    'echo "plain $scenario_id ascii"',
    'echo "price $1 or ${#arr[@]} or $?"',
    "# 注释里的 $scenario_id：不参与 shell 展开",
  ].join("\n");
  assert.deepEqual(findBareVarsBeforeNonAscii(good, "<good>"), []);
});

test("quality_accept.sh 无「双引号内 $var 紧跟非 ASCII」写法（K4 回归）", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, SCRIPT_PATH), "utf8");
  const violations = findBareVarsBeforeNonAscii(source, SCRIPT_PATH);
  assert.deepEqual(
    violations,
    [],
    `发现未加花括号的写法（set -u 下会变 unbound variable）：\n${violations
      .map((hit) => `  ${hit.file}:${hit.line} ${hit.variable}${hit.next} — ${hit.snippet}`)
      .join("\n")}`,
  );
});

test("K4 四处已知修复保持为 ${var} 花括号（防回退）", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, SCRIPT_PATH), "utf8");
  for (const expected of [
    "${scenario_id}（aggregate exit=",
    "${e2e_rc}）",
    "${verdict_rc}）",
    // K5 之后真实 provider 分支以 evidence_missing 退出，消息尾部仍用 ${scenario_id}。
    "evidence_missing（真实 provider pass 缺 B42 模型行为证据",
  ]) {
    assert.ok(source.includes(expected), `缺少已修复写法：${expected}`);
  }
  // 旧写法（无花括号 + 全角）必须绝迹。
  assert.equal(/\$scenario_id（/u.test(source), false);
  assert.equal(/\$e2e_rc）/u.test(source), false);
  assert.equal(/\$scenario_id：/u.test(source), false);
  assert.equal(/\$verdict_rc）/u.test(source), false);
});
