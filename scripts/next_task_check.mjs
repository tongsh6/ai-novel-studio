#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, "..");

const files = {
  next: "tasks/NEXT.md",
  journeys: "docs/product/user-journeys.md",
};

const failures = [];

const next = readRequired(files.next);
const journeys = readRequired(files.journeys);

if (next) {
  requireSection(next, files.next, "## 1. Current Focus");
  requireSection(next, files.next, "## 3. Active Journey");
  requireSection(next, files.next, "## 4. Queue");
  requireSection(next, files.next, "## 5. Selection Rule");
  requireSection(next, files.next, "## 6. Decision Log");

  const nextTasks = [...next.matchAll(/\|\s*\d+\s*\|\s*([^|\s]+)\s*\|\s*next\s*\|/g)]
    .map((match) => match[1]);

  if (nextTasks.length !== 1) {
    failures.push(
      `${files.next}: expected exactly one Queue row with Status=next, found ${nextTasks.length}`,
    );
  }

  if (!next.includes("docs/product/user-journeys.md")) {
    failures.push(`${files.next}: must reference docs/product/user-journeys.md`);
  }

  if (!next.includes("docs/project-ledger.md")) {
    failures.push(`${files.next}: must mention docs/project-ledger.md update responsibility`);
  }
}

if (journeys) {
  requireSection(journeys, files.journeys, "## 1. 状态定义");
  requireSection(journeys, files.journeys, "## 2. Journey A");
  requireSection(journeys, files.journeys, "## 6. 使用规则");

  const journeyNextSteps = [...journeys.matchAll(/\|\s*[A-Z]\d+\s*\|[^\n]*\|\s*next\s*\|/g)];
  if (journeyNextSteps.length < 1) {
    failures.push(`${files.journeys}: expected at least one journey step with Status=next`);
  }

  if (!journeys.includes("tasks/NEXT.md")) {
    failures.push(`${files.journeys}: must reference tasks/NEXT.md`);
  }
}

if (next && journeys) {
  const queueNext = next.match(/\|\s*1\s*\|\s*([^|\s]+)\s*\|\s*next\s*\|/)?.[1];
  if (queueNext && !journeys.includes(queueNext)) {
    failures.push(`${files.journeys}: must mention current NEXT queue head ${queueNext}`);
  }
}

if (failures.length > 0) {
  console.error("next-task-check: failed");
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log("next-task-check: ok");

function readRequired(relativePath) {
  const absolutePath = path.resolve(rootDir, relativePath);
  if (!existsSync(absolutePath)) {
    failures.push(`${relativePath}: missing`);
    return null;
  }

  return readFileSync(absolutePath, "utf8");
}

function requireSection(content, relativePath, heading) {
  if (!content.includes(heading)) {
    failures.push(`${relativePath}: missing section ${heading}`);
  }
}
