import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../../..");
const outputPath = path.join(repoRoot, "tools/workspace-viewer/data/content-manifest.json");

const roots = ["README.md", "AGENTS.md", "company", "books"];
const allowedExt = new Set([".md", ".json", ".toml"]);
const ignoredNames = new Set([".git", ".DS_Store", "node_modules"]);

const files = [];

for (const root of roots) {
  await collect(path.join(repoRoot, root));
}

files.sort((a, b) => a.path.localeCompare(b.path, "zh-Hans-CN"));

const manifest = {
  generatedAt: new Date().toISOString(),
  sourceRoots: roots,
  stats: {
    files: files.length,
    company: files.filter((file) => file.scope === "company").length,
    books: files.filter((file) => file.scope === "books").length,
    root: files.filter((file) => file.scope === "root").length,
  },
  files,
};

await writeFile(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Generated ${path.relative(repoRoot, outputPath)} with ${files.length} files`);

async function collect(absPath) {
  const name = path.basename(absPath);
  if (ignoredNames.has(name)) return;

  let info;
  try {
    info = await stat(absPath);
  } catch {
    return;
  }

  if (info.isDirectory()) {
    const entries = await readdir(absPath);
    for (const entry of entries) {
      await collect(path.join(absPath, entry));
    }
    return;
  }

  if (!info.isFile()) return;

  const ext = path.extname(absPath);
  if (!allowedExt.has(ext)) return;

  const relativePath = toPosix(path.relative(repoRoot, absPath));
  const content = await readFile(absPath, "utf8");
  files.push({
    path: relativePath,
    scope: getScope(relativePath),
    kind: getKind(ext),
    bytes: Buffer.byteLength(content, "utf8"),
    content,
  });
}

function getScope(relativePath) {
  if (relativePath.startsWith("company/")) return "company";
  if (relativePath.startsWith("books/")) return "books";
  return "root";
}

function getKind(ext) {
  if (ext === ".md") return "markdown";
  if (ext === ".json") return "json";
  if (ext === ".toml") return "toml";
  return "text";
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

