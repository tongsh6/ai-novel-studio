#!/usr/bin/env node

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(scriptPath), "..");
const nextPath = "tasks/NEXT.md";
const journeysPath = "docs/product/user-journeys.md";

// 只从当前队列表取队首；历史 Order、决策日志和正文里的 next 都不是可执行任务。
export function validateTaskState(next, journeys) {
  const failures = [];
  for (const heading of [
    "## 1. Current Focus", "## 3. Active Journey", "## 4. Queue",
    "## 5. Selection Rule", "## 6. Decision Log",
  ]) {
    requireSection(next, nextPath, heading, failures);
  }
  for (const heading of ["## 1. 状态定义", "## 2. Journey A", "## 6. 使用规则"]) {
    requireSection(journeys, journeysPath, heading, failures);
  }
  requireReference(next, nextPath, journeysPath, failures);
  requireReference(next, nextPath, "docs/project-ledger.md", failures);
  requireReference(journeys, journeysPath, nextPath, failures);

  const current = section(section(next, "## 4. Queue"), "### 当前队列");
  if (!current) {
    failures.push(`${nextPath}: missing 当前队列 section inside ## 4. Queue`);
  }
  const rows = tableRows(current);
  const header = rows.find((cells) => cells[0] === "#" && cells.includes("状态"));
  const statusIndex = header?.indexOf("状态") ?? -1;
  if (!header) failures.push(`${nextPath}: 当前队列 must have # and 状态 columns`);

  const tasks = rows.filter((cells) => cells !== header && !cells.every(isSeparator));
  const ids = new Set();
  for (const cells of tasks) {
    if (header && cells.length !== header.length) {
      failures.push(`${nextPath}: malformed 当前队列 row ${cells[0]}`);
    }
    if (ids.has(cells[0])) failures.push(`${nextPath}: duplicate 当前队列 id ${cells[0]}`);
    ids.add(cells[0]);
  }
  const nextTasks = tasks.filter((cells) => isNext(cells[statusIndex]));
  if (nextTasks.length !== 1) {
    failures.push(
      `${nextPath}: expected exactly one 当前队列 row with Status=next, found ${nextTasks.length}`,
    );
  }
  const journeyNext = tableRows(journeys).filter(
    (cells) => /^[A-Z]\d+$/.test(cells[0]) && isNext(cells[4]),
  );
  if (journeyNext.length !== 1) {
    failures.push(
      `${journeysPath}: expected exactly one journey step with Status=next, found ${journeyNext.length}`,
    );
  }
  if (nextTasks.length === 1 && journeyNext.length === 1) {
    const taskId = nextTasks[0][0];
    const references = journeyNext[0].slice(1).join(" ").split(/[^A-Za-z0-9_-]+/);
    if (!references.includes(taskId)) {
      failures.push(`${journeysPath}: next journey row must reference current queue id ${taskId}`);
    }
  }
  return failures;
}

function section(text, heading) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => matchesHeading(line, heading));
  if (start === -1) return "";
  const level = heading.match(/^#+/)[0].length;
  const end = lines.findIndex((line, index) => {
    const match = line.match(/^(#+) /);
    return index > start && match && match[1].length <= level;
  });
  return lines.slice(start + 1, end === -1 ? undefined : end).join("\n");
}

function tableRows(text) {
  return text.split("\n")
    .filter((line) => /^\|.*\|\s*$/.test(line))
    .map((line) => line.trim().slice(1, -1).split("|").map((cell) => cell.trim()));
}

function isSeparator(cell) {
  return /^:?-+:?$/.test(cell);
}

function isNext(status = "") {
  return /^next(?:$|\s|（|\()/.test(status.replace(/[*`]/g, "").trim());
}

function requireSection(text, filename, heading, failures) {
  if (!text.split("\n").some((line) => matchesHeading(line, heading))) {
    failures.push(`${filename}: missing section ${heading}`);
  }
}

function matchesHeading(line, heading) {
  return line === heading || [" ", "（", "："].some((suffix) => line.startsWith(heading + suffix));
}

function requireReference(text, filename, reference, failures) {
  if (!text.includes(reference)) failures.push(`${filename}: must reference ${reference}`);
}

function main() {
  try {
    const next = readFileSync(path.join(rootDir, nextPath), "utf8");
    const journeys = readFileSync(path.join(rootDir, journeysPath), "utf8");
    const failures = validateTaskState(next, journeys);
    if (failures.length) {
      console.error("next-task-check: failed");
      for (const failure of failures) console.error(`- ${failure}`);
      process.exitCode = 1;
    } else {
      console.log("next-task-check: ok");
    }
  } catch (error) {
    console.error(`next-task-check: ${error.message}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) main();
