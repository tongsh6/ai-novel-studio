// B28 原矩阵共用的合成正文与冻结归一；不操作产品或页面。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";

// 原T2只有一个明确年龄位置。按原fixture的LF空行段落独立重建锚点，校验B36输出。
export function b28ExpectedAgeReplacement(source) {
  assert.equal(source.split("二十五岁").length, 2, "T2源年龄必须唯一");
  assert(!source.includes("\r"), "T2原fixture采用LF段落");
  const segments = source.split(/(?<=\n\n)/u).filter(Boolean);
  const index = segments.findIndex((raw) => raw.includes("二十五岁"));
  const raw = segments[index], sha256 = createHash("sha256").update(raw).digest("hex");
  return { segment_id: `seg_${index}_${sha256.slice(0, 12)}`, sha256,
    replacement: raw.replace(/(?:\n[ \t]*){2,}$/u, "").replace("二十五岁", "三十岁"),
    final_text: source.replace("二十五岁", "三十岁") };
}

export function b28SegmentCandidateMatches(body, effect, source, versions) {
  const expected = b28ExpectedAgeReplacement(source);
  const canonicalVersions = (rows) => rows.map((r) => ({ ref: r.ref ?? r.draft_ref, version: Number(r.version) })).sort((a, b) => a.ref.localeCompare(b.ref));
  return body === expected.replacement && effect?.mode === "replace_segments" &&
    JSON.stringify(effect.target_segment_ids) === JSON.stringify([expected.segment_id]) &&
    JSON.stringify(effect.expected_segment_hashes) === JSON.stringify([{ segment_id: expected.segment_id, sha256: expected.sha256 }]) &&
    JSON.stringify(canonicalVersions(effect.base_versions ?? [])) === JSON.stringify(canonicalVersions(versions));
}

// ADR-0029：计算预览与模型原始说明分别验证；阅读器按单换行产生段落。
export const b28NonNewlineText = (text) => String(text ?? "").replace(/[\r\n]/g, "");
function newlineOffsets(text) {
  let prefix = "";
  const plain = b28NonNewlineText(text), positions = new Set();
  for (const part of text.split(/([\r\n]+)/)) {
    if (/^[\r\n]+$/.test(part)) {
      if (prefix.trim() && plain.slice(prefix.length).trim()) positions.add(Buffer.byteLength(prefix));
    } else prefix += part;
  }
  return positions;
}
export function b28FormattingPlanMatches(candidate, source) {
  const payload = candidate?.payload ?? {}, effect = payload.adoption_effect ?? {};
  const preview = payload.formatting_preview, items = payload.items ?? [];
  const changes = items[0]?.line_break_changes;
  const hash = (text) => createHash("sha256").update(text).digest("hex");
  if (candidate?.artifact_type !== "prose_formatting_plan" || effect.mode !== "format_paragraphs" ||
      typeof source !== "string" || payload.base_text !== source || typeof preview !== "string" ||
      items.length !== 1 || !Array.isArray(changes) || changes.length === 0 ||
      !Array.isArray(effect.line_break_changes) || effect.line_break_changes.length !== changes.length) return false;
  const sourceOffsets = newlineOffsets(source);
  return effect.source_hash === hash(source) && effect.preview_hash === hash(preview) &&
    preview !== source && b28NonNewlineText(preview) === b28NonNewlineText(source) &&
    [...newlineOffsets(preview)].some((offset) => !sourceOffsets.has(offset)) &&
    changes.every((change, i) => typeof change.boundary_id === "string" && Number.isInteger(change.lines) &&
      [0, 1, 2].includes(change.lines) && change.boundary_id === effect.line_break_changes[i].boundary_id &&
      change.lines === effect.line_break_changes[i].lines) &&
    typeof items[0].body === "string" && items[0].body !== preview;
}

// 冻结归一规则（B28 CP1）：行尾空白删除 → 换行归一 → 文末空行折叠；其余字节相等。
export function b28NormalizeFormatText(text) {
  return String(text ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t\u3000]+$/u, ""))
    .join("\n")
    .replace(/\n+$/, "");
}

export function b28BuildInitialFragment() {
  const paragraphs = [
    "夜潮漫上雨港的石阶时，沈砚正在旧书铺里核对灯楼送来的第七本旧账。",
    "账页被潮气泡得发软，指尖一按就留下浅浅的水痕。",
    "他把三盏灯下的数字抄在草纸上，发现每一笔灯油都比账上多出半钱。",
    "井底黑泉的运费从没有单独列过，却每月准时出现在「杂耗」一栏里。",
    "沈砚记得很清楚，点灯人第一次点灯时才二十五岁，那一年灯楼还没有第七盏灯。",
    "子时将近，楼下忽然传来灯焰爆响的声音，像有人在井口轻轻敲了三下。",
    "他披上旧毡衣，把账本塞进怀里，顺着后巷的湿墙往灯楼走。",
    "巷子尽头的灯楼只有一扇窗亮着，窗上蒙着潮气，看不清里面的人。",
    "守夜的门房没有拦他，只指了指井口，说今晚的灯油已经烧到井底了。",
    "沈砚俯身去看，井水里沉着一点蓝灰色的光，像一枚被水泡胀的火星。",
    "他把手伸进井绳的旧扣里，听见自己在心里数：一、二、三。",
    "第七次灯焰爆响的同时，井口浮起一枚灯芯，芯上缠着一小片写着名字的纸。",
    "【初稿末句】井口浮起一枚灯芯，像谁留下的问号。",
  ];
  let body = paragraphs.join("\n\n");
  const padUnit = "潮气顺着墙缝往里渗，他把呼吸放轻，听见灯楼深处传来灯油滴落的声音。";
  while (body.length < 2517) body += "\n\n" + padUnit;
  return body.slice(0, 2517);
}

export function b28BuildContinuationFragment() {
  const seedLine =
    "沈砚把灯芯摊在掌心，纸片上只有半个名字；他沿井壁的旧梯继续往下，脚底的石阶被灯油浸得发黑，守夜人的灯在下面转蓝，他听见有人用很轻的声音说：点灯人不能回头看灯焰。他没有回头，只把账本翻到最后一页，上面记着第七盏灯的数量与井底黑泉的取油时辰，字迹和他自己的很像。";
  const endingAnchor = "【续写末句】灯焰在子时之后转蓝，井底有人轻轻应了一声。";
  let body = seedLine;
  while (body.length + endingAnchor.length < 1075) {
    body += "井底的风把灯焰吹得低下去，他数着台阶继续走，账页上的名字慢慢清晰。";
  }
  return body.slice(0, 1075 - endingAnchor.length) + endingAnchor;
}


export function b28SourceFingerprint() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const names = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "--", "frontend/src", ":(glob)apps/*/lib/**"], { cwd: root, encoding: "utf8" }).trim().split("\n").filter(Boolean).sort();
  return Object.fromEntries(names.map((name) => [name, createHash("sha256").update(fs.readFileSync(path.join(root, name))).digest("hex")]));
}
