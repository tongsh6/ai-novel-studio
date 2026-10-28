#!/usr/bin/env node

import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headings = ["当前任务", "后续候选", "阻塞"];
const openStates = new Set(["todo", "pending", "doing", "blocked", "deferred"]);
const terminalStates = new Set(["done", "superseded", "cancelled"]);
const actionableStates = new Set(["todo", "pending", "doing"]);

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
    if (refs.length > 1) failures.push("NEXT: " + id + " 只能有一个状态来源；依赖放说明列或原任务");
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
        const status = sourceStatus(body);
        if (terminalStates.has(status)) {
          failures.push("NEXT: " + id + " 来源已终结 (" + status + ")，应移出排期");
        } else if (!openStates.has(status)) {
          failures.push("NEXT: " + id + " 状态来源缺少可识别的顶部状态");
        } else if (current.includes(row) && !actionableStates.has(status)) {
          failures.push("NEXT: " + id + " 当前任务来源为 " + status + "；应排可推进的 checkpoint 或移入候选/阻塞");
        } else if (current.length === 0 && actionableStates.has(status)) {
          failures.push("NEXT: 当前任务为空但候选 " + id + " 仍为 " + status + "；先选任务或在原文明确阻塞");
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

// 只读派生开放清单，不写状态文件，也不把 todo 自动解释为已获实现授权。
export function collectTaskInventory(files, { readTask, next = "" }) {
  const scheduled = new Map();
  for (const name of ["当前任务", "后续候选"]) {
    for (const row of taskRows(section(next, name), name, [])) {
      for (const ref of links(row[2] ?? "")) {
        const target = taskPath(ref);
        if (target) scheduled.set(target.file + (target.anchor ? "#" + target.anchor : ""), name);
      }
    }
  }
  const entries = [];
  const unclassified = [];
  for (const file of [...files].sort()) {
    if (!file.endsWith(".md") || ["README.md", "NEXT.md"].includes(path.posix.basename(file))) continue;
    const text = readTask(file);
    const sections = [{ source: file, body: text }];
    for (const match of text.matchAll(/^#{2,6} (.+)$/gm)) {
      const anchor = slug(match[1]);
      sections.push({ source: file + "#" + anchor, body: anchoredSection(text, anchor) });
    }
    if (!openStates.has(sourceStatus(text)) && !terminalStates.has(sourceStatus(text))) {
      unclassified.push(file);
    }
    for (const { source, body } of sections) {
      const status = sourceStatus(body);
      if (openStates.has(status)) entries.push({ source, status, schedule: scheduled.get(source) ?? "未排期" });
    }
  }
  return { entries, unclassified };
}

function sourceStatus(body) {
  // 状态只属于当前标题的引言；不得借用子标题中的状态。
  return body.split(/^#{2,6} /m)[0].split("\n")
    .map((line) => line.replace(/[*\u0060]/g, "").trim())
    .map((line) => line.match(/^(?:-\s*)?状态[：:]\s*([A-Za-z_-]+)/)?.[1]?.toLowerCase())
    .find(Boolean);
}

function taskFiles(directory = "tasks") {
  return readdirSync(path.join(rootDir, directory), { withFileTypes: true }).flatMap((entry) => {
    const file = path.posix.join(directory, entry.name);
    return entry.isDirectory() ? taskFiles(file) : entry.isFile() ? [file] : [];
  });
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
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== "--open")) {
      console.error("用法：node scripts/next_task_check.mjs [--open]");
      process.exitCode = 1;
      return;
    }
    const next = readFileSync(path.join(rootDir, "tasks/NEXT.md"), "utf8");
    const readTask = (file) => readFileSync(path.join(rootDir, file), "utf8");
    const failures = validateTaskState(next, {
      readTask,
      journeys: readFileSync(path.join(rootDir, "docs/product/user-journeys.md"), "utf8"),
    });
    if (failures.length) {
      console.error("next-task-check: failed\n- " + failures.join("\n- "));
      process.exitCode = 1;
    } else {
      console.log("next-task-check: ok");
    }
    if (args.includes("--open")) {
      const { entries, unclassified } = collectTaskInventory(taskFiles(), { readTask, next });
      console.log("\n开放来源（原任务即时派生；父任务与 checkpoint 不按独立任务计数；未排期不等于 blocked）");
      for (const entry of entries) console.log(`${entry.status}\t${entry.schedule}\t${entry.source}`);
      console.log("\n未识别顶部状态的历史文档（不等于已完成，换队首时须人工核对）");
      for (const file of unclassified) console.log(file);
      console.log("\n该清单不判断授权、依赖或真实可开工性；须回原任务核对，不能据此自动宣布无可推进项。");
    }
  } catch (error) {
    console.error("next-task-check: " + error.message);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
