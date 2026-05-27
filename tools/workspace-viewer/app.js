const state = {
  files: [],
  filtered: [],
  selectedPath: "",
  scope: "all",
  query: "",
};

const els = {
  tree: document.querySelector("#fileTree"),
  search: document.querySelector("#searchInput"),
  tabs: [...document.querySelectorAll(".scope-tab")],
  markdown: document.querySelector("#markdownView"),
  title: document.querySelector("#docTitle"),
  meta: document.querySelector("#metaLine"),
  copyPath: document.querySelector("#copyPathButton"),
  quickLinks: [...document.querySelectorAll(".quick-links button")],
};

init();

async function init() {
  try {
    const response = await fetch("./data/content-manifest.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`manifest ${response.status}`);
    const manifest = await response.json();
    state.files = manifest.files || [];
    state.filtered = state.files;
    bindEvents();
    renderTree();
    selectInitialFile();
    els.meta.textContent = `${state.files.length} 个文件 · ${manifest.generatedAt || "未标记生成时间"}`;
  } catch (error) {
    els.markdown.innerHTML = `<div class="notice">无法加载 content-manifest.json。请先运行 <code>rtk run "node tools/workspace-viewer/scripts/build-manifest.mjs"</code>。</div>`;
    els.meta.textContent = "manifest 加载失败";
    console.error(error);
  }
}

function bindEvents() {
  els.search.addEventListener("input", (event) => {
    state.query = event.target.value.trim().toLowerCase();
    filterFiles();
  });

  els.tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      state.scope = tab.dataset.scope;
      els.tabs.forEach((item) => item.classList.toggle("active", item === tab));
      filterFiles();
    });
  });

  els.copyPath.addEventListener("click", async () => {
    if (!state.selectedPath) return;
    await navigator.clipboard.writeText(state.selectedPath);
    els.copyPath.textContent = "已复制";
    setTimeout(() => {
      els.copyPath.textContent = "复制路径";
    }, 900);
  });

  els.quickLinks.forEach((button) => {
    button.addEventListener("click", () => selectFile(button.dataset.path));
  });
}

function selectInitialFile() {
  const preferred = [
    "company/proposals/department_responsibility_and_capability_catalog_2026-05-21_v1.md",
    "company/standards/company_charter.md",
    "README.md",
  ];
  const target = preferred.find((path) => state.files.some((file) => file.path === path));
  if (target) selectFile(target);
}

function filterFiles() {
  state.filtered = state.files.filter((file) => {
    const scopeOk = state.scope === "all" || file.scope === state.scope;
    const haystack = `${file.path}\n${file.content}`.toLowerCase();
    const queryOk = !state.query || haystack.includes(state.query);
    return scopeOk && queryOk;
  });
  renderTree();
}

function renderTree() {
  if (!state.filtered.length) {
    els.tree.innerHTML = `<p class="meta-line">没有匹配文件。</p>`;
    return;
  }

  const grouped = groupByTopDirectory(state.filtered);
  els.tree.innerHTML = Object.entries(grouped)
    .map(([group, files]) => {
      const items = files
        .map((file) => {
          const active = file.path === state.selectedPath ? " active" : "";
          return `
            <button class="file-button${active}" type="button" data-path="${escapeAttr(file.path)}">
              <span class="file-path">${escapeHtml(file.path)}</span>
              <span class="file-kind">${escapeHtml(file.kind)} · ${formatBytes(file.bytes)}</span>
            </button>
          `;
        })
        .join("");
      return `<div class="tree-group"><div class="tree-folder">${escapeHtml(group)}</div>${items}</div>`;
    })
    .join("");

  els.tree.querySelectorAll(".file-button").forEach((button) => {
    button.addEventListener("click", () => selectFile(button.dataset.path));
  });
}

function groupByTopDirectory(files) {
  return files.reduce((acc, file) => {
    const group = file.scope === "root" ? "根目录" : file.path.split("/")[0];
    acc[group] ||= [];
    acc[group].push(file);
    return acc;
  }, {});
}

function selectFile(path) {
  const file = state.files.find((item) => item.path === path);
  if (!file) {
    els.markdown.innerHTML = `<div class="notice">manifest 中没有这个文件：<code>${escapeHtml(path)}</code></div>`;
    return;
  }

  state.selectedPath = path;
  els.title.textContent = file.path.split("/").pop();
  els.meta.textContent = `${file.path} · ${file.kind} · ${formatBytes(file.bytes)}`;
  els.markdown.innerHTML = file.kind === "markdown"
    ? renderMarkdown(file.content)
    : `<pre><code>${escapeHtml(file.content)}</code></pre>`;
  renderTree();
}

function renderMarkdown(source) {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const code = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        code.push(lines[index]);
        index += 1;
      }
      index += 1;
      blocks.push(`<pre><code data-lang="${escapeAttr(lang)}">${escapeHtml(code.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${inlineMarkdown(heading[2])}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*---+\s*$/.test(line)) {
      blocks.push("<hr />");
      index += 1;
      continue;
    }

    if (line.trim().startsWith(">")) {
      const quote = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${quote.map(inlineMarkdown).join("<br />")}</blockquote>`);
      continue;
    }

    if (isTableStart(lines, index)) {
      const tableLines = [];
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        tableLines.push(lines[index]);
        index += 1;
      }
      blocks.push(renderTable(tableLines));
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*[-*]\s+/, ""));
        index += 1;
      }
      blocks.push(`<ul>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+\.\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+\.\s+/.test(lines[index])) {
        items.push(lines[index].replace(/^\s*\d+\.\s+/, ""));
        index += 1;
      }
      blocks.push(`<ol>${items.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ol>`);
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].startsWith("```") &&
      !/^(#{1,4})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+\.\s+/.test(lines[index]) &&
      !lines[index].trim().startsWith(">") &&
      !isTableStart(lines, index)
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push(`<p>${inlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return blocks.join("\n");
}

function isTableStart(lines, index) {
  return (
    index + 1 < lines.length &&
    lines[index].includes("|") &&
    /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[index + 1])
  );
}

function renderTable(tableLines) {
  const rows = tableLines
    .filter((_, index) => index !== 1)
    .map((line) => trimTableCells(line).map(inlineMarkdown));
  if (!rows.length) return "";
  const [head, ...body] = rows;
  return `
    <table>
      <thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>
      <tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
    </table>
  `;
}

function trimTableCells(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function inlineMarkdown(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value) {
  return escapeHtml(value);
}

