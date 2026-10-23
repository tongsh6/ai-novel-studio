#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headings = ["当前任务", "后续候选", "阻塞"];
const openStates = new Set(["todo", "pending", "doing", "blocked", "deferred"]);
const terminalStates = new Set(["done", "superseded", "cancelled"]);

// NEXT 只选择工作；执行状态从原任务读取，不再与旅程同步一份 next。
export function validateTaskState(next, { readTask, journeys = "" } = {}) {
  const failures = [];
  const lines = next.trimEnd().split("\n");
  if (lines.length > 80 || next.length > 6000) {
    failures.push("NEXT: 超过 80 行或 6000 字符；历史、证据与细节应回原文档");
  }
  const actual = lines.filter((line) => /^#{2,} /.test(line));
  if (JSON.stringify(actual) !== JSON.stringify(headings.map((name) => "## " + name))) {
    failures.push("NEXT: 只允许按序出现 当前任务 / 后续候选 / 阻塞 三节");
  }
  if (!next.includes("](README.md)")) {
    failures.push("NEXT: 缺少 tasks/README.md 更新规则链接");
  }
  const current = taskRows(section(next, "当前任务"), "当前任务", failures);
  const candidates = taskRows(section(next, "后续候选"), "后续候选", failures);
  if (current.length > 1) failures.push("NEXT: 当前任务至多一项");
  if (candidates.length > 5) failures.push("NEXT: 后续候选至多五项");

  const blocked = section(next, "阻塞");
  if (current.length === 0 && !links(blocked).some((ref) => taskPath(ref))) {
    failures.push("NEXT: 当前任务为空时必须引用原任务中的阻塞/待决策来源");
  }
  const ids = new Set();
  const sources = new Set();
  for (const row of [...current, ...candidates]) {
    const [id, , source] = row;
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(id ?? "")) {
      failures.push("NEXT: 非法任务编号 " + id);
    }
    if (ids.has(id)) failures.push("NEXT: 重复任务编号 " + id);
    ids.add(id);
    const refs = links(source ?? "");
    if (refs.length === 0) failures.push("NEXT: " + id + " 缺少状态来源链接");
    for (const ref of refs) {
      const target = taskPath(ref);
      if (!target) {
        failures.push("NEXT: " + id + " 状态来源必须是 tasks 下的原任务，不能是 NEXT/README/外部路径");
        continue;
      }
      const key = target.file + "#" + target.anchor;
      if (sources.has(key)) failures.push("NEXT: 原任务被重复排期 " + key);
      sources.add(key);
      try {
        const text = readTask(target.file);
        const body = target.anchor ? anchoredSection(text, target.anchor) : text.split(/^## /m)[0];
        if (body === null) {
          failures.push("NEXT: " + id + " 状态来源锚点不存在 " + ref);
          continue;
        }
        const status = body.split("\n")
          .map((line) => line.replace(/[*\u0060]/g, "").trim())
          .map((line) => line.match(/^(?:-\s*)?状态[：:]\s*([A-Za-z_-]+)/)?.[1]?.toLowerCase())
          .find(Boolean);
        if (terminalStates.has(status)) {
          failures.push("NEXT: " + id + " 来源已终结 (" + status + ")，应移出排期");
        } else if (!openStates.has(status)) {
          failures.push("NEXT: " + id + " 状态来源缺少可识别的顶部状态");
        }
      } catch (error) {
        failures.push("NEXT: " + id + " 状态来源不可读 " + target.file + ": " + error.message);
      }
    }
  }
  // 阻塞中的任务引用也要真实可达；不在 NEXT 再造一份阻塞状态。
  for (const ref of links(blocked)) {
    const target = taskPath(ref);
    if (!target) {
      failures.push("NEXT: 阻塞必须链接原任务 " + ref);
      continue;
    }
    try {
      const text = readTask(target.file);
      if (target.anchor && anchoredSection(text, target.anchor) === null) {
        failures.push("NEXT: 阻塞来源锚点不存在 " + ref);
      }
    } catch (error) {
      failures.push("NEXT: 阻塞来源不可读 " + ref + ": " + error.message);
    }
  }
  for (const line of journeys.split("\n")) {
    const cells = tableCells(line);
    if (/^[A-Z]\d+$/.test(cells?.[0] ?? "") &&
        /^(next|queued)(?:$|\s|（|\()/.test((cells[4] ?? "").replace(/[*\u0060]/g, "").trim())) {
      failures.push("journeys: 不再复制 next/queued 排期：" + cells[0]);
    }
    if (/^(Current Focus|Current Journey|Current Breakpoint|Queue head|Next Task|Next closures|Active Journey):/.test(line)) {
      failures.push("journeys: 不再维护队首镜像 " + line.split(":")[0]);
    }
  }
  return failures;
}

function taskRows(text, name, failures) {
  const rows = text.split("\n").filter((line) => line.startsWith("|")).map(tableCells);
  const header = rows.shift();
  if (!header || header.length !== 3 || header[0] !== "任务" || header[2] !== "状态来源") {
    failures.push("NEXT: " + name + " 表头必须为 任务 / 说明 / 状态来源 三列");
  }
  const result = rows.filter((cells) => cells && !cells.every((cell) => /^:?-+:?$/.test(cell)));
  for (const row of result) {
    if (row.length !== 3 || row.some((cell) => !cell)) failures.push("NEXT: " + name + " 表格行损坏");
  }
  // 畸形表格不能靠丢弃解析失败行获得空队列。
  if (rows.some((row) => !row)) failures.push("NEXT: " + name + " 表格缺少边界");
  return result;
}

function tableCells(line) {
  if (!/^\|.*\|\s*$/.test(line)) return null;
  return line.trim().slice(1, -1).split("|").map((cell) => cell.trim());
}

function links(text) {
  return [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => match[1]);
}

function taskPath(ref) {
  let decoded;
  try { decoded = decodeURIComponent(ref); } catch { return null; }
  const [filename, anchor = "", extra] = decoded.split("#");
  if (extra !== undefined || filename.startsWith("/") || filename.includes(":") || filename.includes("\\")) return null;
  const file = path.posix.normalize(path.posix.join("tasks", filename));
  if (!file.startsWith("tasks/") || !file.endsWith(".md") ||
      ["NEXT.md", "README.md"].includes(path.posix.basename(file))) return null;
  return { file, anchor };
}

function slug(heading) {
  return heading.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/\s+/g, "-");
}

function anchoredSection(text, anchor) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => /^(#+) /.test(line) && slug(line.replace(/^#+ /, "")) === anchor);
  if (start < 0) return null;
  const level = lines[start].match(/^#+/)[0].length;
  let end = start + 1;
  while (end < lines.length) {
    const heading = lines[end].match(/^(#+) /);
    if (heading && heading[1].length <= level) break;
    end += 1;
  }
  return lines.slice(start + 1, end).join("\n");
}

function section(text, heading) {
  return anchoredSection(text, slug(heading)) ?? "";
}

function main() {
  try {
    const failures = validateTaskState(readFileSync(path.join(rootDir, "tasks/NEXT.md"), "utf8"), {
      readTask: (file) => readFileSync(path.join(rootDir, file), "utf8"),
      journeys: readFileSync(path.join(rootDir, "docs/product/user-journeys.md"), "utf8"),
    });
    if (failures.length) {
      console.error("next-task-check: failed\n- " + failures.join("\n- "));
      process.exitCode = 1;
    } else {
      console.log("next-task-check: ok");
    }
  } catch (error) {
    console.error("next-task-check: " + error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
