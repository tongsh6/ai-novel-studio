import http from "node:http";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { anthropicConfig } from "./config.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appRoot, "../..");
const distRoot = path.join(appRoot, "dist");

const textExtensions = new Set([".md", ".json", ".toml", ".txt"]);
const blockedSegments = new Set([".git", "node_modules", "dist", ".vite", ".DS_Store", "archive"]);
const runs = new Map();
const modelHealth = {
  lastError: null,
  lastFailureAt: null,
  retryAfterUntil: null,
  endpoint: null
};

const departments = [
  {
    id: "main-agent",
    name: "主控部",
    tagline: "把作者意图变成可执行写作队列",
    responsibilities: ["接收作者目标", "拆解任务路线", "协调公司层与书层状态", "提示资料冲突"],
    capabilities: ["工作流拆解", "写入计划生成", "资料完整度检查"],
    inputs: ["公司章程", "写作规则", "项目当前状态", "相关业务文件"],
    outputs: ["任务队列", "执行摘要", "写入计划"],
    actions: ["project-skeleton", "plotline-plan"]
  },
  {
    id: "research",
    name: "研究部",
    tagline: "把题材与方法沉淀成可复用资料",
    responsibilities: ["拆解题材套路", "整理参考方法", "抽象可复用写作动作"],
    capabilities: ["方法论摘要", "题材资料卡", "抽象模式卡"],
    inputs: ["公司共享研究", "外部参考资料", "作者输入"],
    outputs: ["研究结果", "方法结果", "能力卡结果"],
    actions: ["core-selling-point"]
  },
  {
    id: "bible",
    name: "圣经一致性部",
    tagline: "保证人物、世界、时间线和伏笔不互相打架",
    responsibilities: ["维护书籍圣经", "检查角色动机", "检查伏笔与时间线", "发现矛盾"],
    capabilities: ["角色卡", "世界规则检查", "伏笔影响检查", "时间线矛盾检查"],
    inputs: ["本书圣经", "角色库", "伏笔表", "时间线"],
    outputs: ["角色卡", "矛盾报告", "状态差异"],
    actions: ["character-card", "foreshadow-check", "timeline-check"]
  },
  {
    id: "writing",
    name: "写作部",
    tagline: "从大纲推进到章节合同、场景序列和章节草稿",
    responsibilities: ["生成章节合同", "生成场景序列", "生成章节草稿", "控制现场感与段落节奏"],
    capabilities: ["章节合同", "场景卡", "章节草稿", "反概括化执行卡"],
    inputs: ["章节大纲", "角色卡", "公司写作规则", "上一章摘要"],
    outputs: ["章节合同", "章节草稿", "章节摘要"],
    actions: ["chapter-contract", "scene-sequence", "chapter-draft"]
  },
  {
    id: "review",
    name: "审核部",
    tagline: "按网文商业阅读体验审稿",
    responsibilities: ["检查爽点密度", "检查黄金三章", "检查章尾钩", "检查反 AI 味"],
    capabilities: ["爽点审查", "钩子审查", "商业开篇审查", "反 AI 味审查"],
    inputs: ["章节草稿", "章节合同", "质量检查清单", "公司评价规则"],
    outputs: ["章节审稿", "风险清单", "修改建议"],
    actions: ["payoff-audit", "anti-ai-audit"]
  },
  {
    id: "market",
    name: "市场部",
    tagline: "把题材、卖点和读者期待压成能点击的表达",
    responsibilities: ["审查一句话卖点", "优化简介", "检查开篇期待", "判断题材商业性"],
    capabilities: ["三秒钩子", "简介结果", "商业包装审查"],
    inputs: ["核心设定", "黄金三章", "题材资料", "市场参考"],
    outputs: ["卖点结果", "简介结果", "商业风险"],
    actions: ["core-selling-point", "golden-three"]
  },
  {
    id: "library-ops",
    name: "资料运营部",
    tagline: "让公司层与书层资料保持清晰、可追踪、可交接",
    responsibilities: ["生成文件地图", "检查知识库完整度", "建议写入位置"],
    capabilities: ["文件地图", "完整度检查", "状态标记", "写入预览"],
    inputs: ["公司资料", "书籍资料", "项目模板"],
    outputs: ["文件地图", "缺口清单", "写入预览"],
    actions: ["timeline-check", "foreshadow-check"]
  }
];

const actions = [
  {
    id: "project-skeleton",
    label: "生成新书骨架",
    stage: "开新书",
    skill: "新书项目构建",
    scope: "company",
    contextProfile: ({ input }) => [
      "company/公司标准/公司章程.md",
      "company/共享方法/写作规则.md",
      "company/模板/书籍圣经模板.md",
      input?.seed ? null : "company/共享研究/说明.md"
    ],
    workflow: () => [
      "解析立项文本，抽取书名、题材、主角、节奏和卷级承诺。",
      "按书籍资料树规划初始文件，而不是先落单个临时稿。",
      "生成可直接写入 books/<Book>/... 的多文件结果。"
    ],
    targetResolver: ({ input }) => resolveProjectBootstrap(input?.seed)
  },
  {
    id: "core-selling-point",
    label: "生成核心卖点",
    stage: "开新书",
    skill: "卖点压缩与简介钩子",
    scope: "either",
    contextProfile: ({ projectSlug }) => [
      "company/公司标准/情绪原则.md",
      "company/评价标准/审稿评分卡.md",
      ...bookScopePaths(projectSlug, ["圣经/书籍圣经.md", "剧情/剧情总纲.md", "世界/世界规则.md"])
    ],
    workflow: () => [
      "读取情绪原则和题材现状。",
      "压一句话卖点、三秒钩子和简介首段。",
      "把结果写进该书的卖点文件，供后续反复调用。"
    ],
    targetResolver: ({ projectSlug }) => requireProjectTarget(projectSlug, "资料库/圣经/核心卖点.md", "核心卖点")
  },
  {
    id: "golden-three",
    label: "生成黄金三章方案",
    stage: "开新书",
    skill: "黄金三章设计",
    scope: "project",
    contextProfile: ({ projectSlug }) => [
      "company/共享方法/写作规则.md",
      "company/模板/章节合同模板.md",
      "company/共享方法/爽点与强开篇规则.md",
      ...bookScopePaths(projectSlug, ["圣经/书籍圣经.md", "剧情/剧情总纲.md", "世界/世界规则.md"])
    ],
    workflow: () => [
      "锁定前三章的特殊性、金手指、小爽点和章尾钩。",
      "把结构拆成可执行章节方案，而不是只给概括。",
      "直接落入剧情线资料，供写作部和审核部共用。"
    ],
    targetResolver: ({ projectSlug }) => requireProjectTarget(projectSlug, "资料库/剧情/黄金三章方案.md", "黄金三章方案")
  },
  {
    id: "character-card",
    label: "生成角色卡",
    stage: "角色工作台",
    skill: "角色卡构建",
    scope: "project",
    contextProfile: ({ projectSlug }) => [
      "company/模板/角色模板.md",
      "company/共享方法/写作规则.md",
      ...bookScopePaths(projectSlug, ["圣经/书籍圣经.md", "角色/角色总表.md", "剧情/剧情总纲.md"])
    ],
    workflow: () => [
      "抽取主配角欲望、弱点、关系和成长线。",
      "识别角色空洞、重复功能和缺失动机。",
      "把新角色卡或补充卡直接写入角色目录。"
    ],
    targetResolver: ({ projectSlug, input }) => requireProjectTarget(projectSlug, `资料库/角色/${resolveCharacterFileName(input)}.md`, "角色卡")
  },
  {
    id: "plotline-plan",
    label: "生成卷纲/篇章线",
    stage: "剧情工作台",
    skill: "卷纲与篇章线规划",
    scope: "project",
    contextProfile: ({ projectSlug }) => [
      "company/共享方法/写作规则.md",
      "company/公司标准/情绪原则.md",
      ...bookScopePaths(projectSlug, ["圣经/书籍圣经.md", "剧情/剧情总纲.md", "伏笔/伏笔总表.md"])
    ],
    workflow: () => [
      "确认卷级主问题、阶段驱动力和大高潮位置。",
      "把剧情线拆成可继续写章节的篇章结构。",
      "更新剧情线文件，而不是落独立临时稿。"
    ],
    targetResolver: ({ projectSlug }) => requireProjectTarget(projectSlug, "资料库/剧情/卷纲与篇章线.md", "卷纲与篇章线")
  },
  {
    id: "chapter-contract",
    label: "生成章节合同",
    stage: "章节工厂",
    skill: "章节合同生成",
    scope: "project",
    contextProfile: ({ projectSlug, input }) => [
      "company/模板/章节合同模板.md",
      "company/共享方法/写作规则.md",
      "company/能力库/能力库说明.md",
      ...bookScopePaths(projectSlug, [
        "圣经/书籍圣经.md",
        "角色/角色总表.md",
        "剧情/剧情总纲.md",
        `合同/${resolveChapterStem(input)}_场景序列.md`,
        `正文/${resolveChapterStem(input)}_草稿.md`
      ])
    ],
    workflow: ({ input }) => [
      `围绕 ${resolveChapterLabel(input)} 生成章节目标、冲突、爽点、代价和章尾钩。`,
      "补齐场景细纲、信息边界和段落动作。",
      "把合同写入章节合同文件，供后续场景序列和草稿直接读取。"
    ],
    targetResolver: ({ projectSlug, input }) => requireProjectTarget(projectSlug, `资料库/合同/${resolveChapterStem(input)}_章节合同.md`, "章节合同")
  },
  {
    id: "scene-sequence",
    label: "生成场景序列",
    stage: "章节工厂",
    skill: "场景序列生成",
    scope: "project",
    contextProfile: ({ projectSlug, input }) => [
      "company/模板/章节合同模板.md",
      "company/能力库/段落功能/场景建立.md",
      "company/能力库/段落功能/剧情推进.md",
      ...bookScopePaths(projectSlug, [
        `合同/${resolveChapterStem(input)}_章节合同.md`,
        "角色/角色总表.md",
        "剧情/剧情总纲.md"
      ])
    ],
    workflow: ({ input }) => [
      `基于 ${resolveChapterLabel(input)} 的合同拆出场景序列。`,
      "保证每场都有进入、冲突、转折和场尾钩。",
      "把结果写进章节场景序列文件。"
    ],
    targetResolver: ({ projectSlug, input }) => requireProjectTarget(projectSlug, `资料库/合同/${resolveChapterStem(input)}_场景序列.md`, "场景序列")
  },
  {
    id: "chapter-draft",
    label: "生成章节草稿",
    stage: "章节工厂",
    skill: "章节草稿生成",
    scope: "project",
    contextProfile: ({ projectSlug, input }) => [
      "company/共享方法/写作规则.md",
      "company/能力库/风格控制/反AI风格规则.md",
      "company/能力库/风格控制/可读网文语感.md",
      ...bookScopePaths(projectSlug, [
        `合同/${resolveChapterStem(input)}_章节合同.md`,
        `合同/${resolveChapterStem(input)}_场景序列.md`,
        "角色/角色总表.md",
        "世界/世界规则.md"
      ])
    ],
    workflow: ({ input }) => [
      `围绕 ${resolveChapterLabel(input)} 合同与场景序列生成章节草稿。`,
      "保持近身视角、可读性和网文节奏。",
      "结果直接写入正文文件，供审稿继续使用。"
    ],
    targetResolver: ({ projectSlug, input }) => requireProjectTarget(projectSlug, `资料库/正文/${resolveChapterStem(input)}_草稿.md`, "章节草稿")
  },
  {
    id: "payoff-audit",
    label: "审查爽点密度",
    stage: "审稿",
    skill: "爽点密度审查",
    scope: "project",
    contextProfile: ({ projectSlug, input }) => [
      "company/公司标准/情绪原则.md",
      "company/评价标准/审稿评分卡.md",
      "company/共享方法/爽点与强开篇规则.md",
      ...bookScopePaths(projectSlug, [
        `正文/${resolveChapterStem(input)}_草稿.md`,
        `合同/${resolveChapterStem(input)}_章节合同.md`,
        "剧情/剧情总纲.md"
      ])
    ],
    workflow: ({ input }) => [
      `审查 ${resolveChapterLabel(input)} 的低门槛爽点、中等兑现和章尾拉力。`,
      "指出缺失的反杀、进账、打脸、称呼变化或情绪回报。",
      "把结果写入对应审稿文件。"
    ],
    targetResolver: ({ projectSlug, input }) => requireProjectTarget(projectSlug, `资料库/审稿/${resolveChapterStem(input)}_爽点审查.md`, "爽点密度审查")
  },
  {
    id: "anti-ai-audit",
    label: "审查反 AI 味",
    stage: "审稿",
    skill: "反 AI 味审查",
    scope: "project",
    contextProfile: ({ projectSlug, input }) => [
      "company/能力库/风格控制/反AI风格规则.md",
      "company/共享方法/商业开篇审核经验.md",
      ...bookScopePaths(projectSlug, [
        `正文/${resolveChapterStem(input)}_草稿.md`,
        `合同/${resolveChapterStem(input)}_章节合同.md`
      ])
    ],
    workflow: ({ input }) => [
      `审查 ${resolveChapterLabel(input)} 是否存在说明文、概括腔和机械短句。`,
      "把需要删改的位置转成可执行修改意见。",
      "把结果写入反 AI 味审稿文件。"
    ],
    targetResolver: ({ projectSlug, input }) => requireProjectTarget(projectSlug, `资料库/审稿/${resolveChapterStem(input)}_反AI审查.md`, "反 AI 味审查")
  },
  {
    id: "foreshadow-check",
    label: "检查伏笔影响",
    stage: "连续性",
    skill: "伏笔影响检查",
    scope: "project",
    contextProfile: ({ projectSlug, input }) => [
      "company/共享方法/写作规则.md",
      ...bookScopePaths(projectSlug, [
        "伏笔/伏笔总表.md",
        "时间/时间线.json",
        `正文/${resolveChapterStem(input)}_草稿.md`,
        "剧情/剧情总纲.md"
      ])
    ],
    workflow: ({ input }) => [
      `检查 ${resolveChapterLabel(input)} 对伏笔埋设和回收的影响。`,
      "标出新增伏笔、提前泄露和遗漏回收。",
      "把结果写入连续性检查文件。"
    ],
    targetResolver: ({ projectSlug, input }) => requireProjectTarget(projectSlug, `资料库/审稿/${resolveChapterStem(input)}_伏笔检查.md`, "伏笔影响检查")
  },
  {
    id: "timeline-check",
    label: "检查时间线矛盾",
    stage: "连续性",
    skill: "时间线矛盾检查",
    scope: "project",
    contextProfile: ({ projectSlug, input }) => [
      "company/模板/章节审稿模板.md",
      "company/共享方法/写作规则.md",
      ...bookScopePaths(projectSlug, [
        "时间/时间线.json",
        `正文/${resolveChapterStem(input)}_草稿.md`,
        "角色/角色总表.md",
        "剧情/剧情总纲.md"
      ])
    ],
    workflow: ({ input }) => [
      `检查 ${resolveChapterLabel(input)} 是否与全书时间线、角色位置和事件顺序冲突。`,
      "标出硬冲突、软冲突和需要同步修订的地方。",
      "把结果写入时间线检查文件。"
    ],
    targetResolver: ({ projectSlug, input }) => requireProjectTarget(projectSlug, `资料库/审稿/${resolveChapterStem(input)}_时间线检查.md`, "时间线检查")
  }
];

const requiredBookLibrary = ["圣经", "角色", "剧情", "伏笔", "时间", "世界", "合同", "审稿", "正文"];

function compactList(items) {
  return items.filter(Boolean);
}

function bookScopePaths(projectSlug, suffixes = []) {
  if (!projectSlug) return [];
  return suffixes.map((suffix) => `books/${projectSlug}/资料库/${suffix}`);
}

function slugifySegment(value, fallback = "item") {
  return String(value || "")
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_-]/gu, "")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase() || fallback;
}

function resolveChapterStem(input = {}) {
  const raw = input.chapterId || input.chapterLabel || input.chapter || "当前章节";
  return `章节_${slugifySegment(raw, "当前章节")}`;
}

function resolveChapterLabel(input = {}) {
  return input.chapterLabel || input.chapterId || input.chapter || "当前章节";
}

function resolveCharacterFileName(input = {}) {
  const raw = input.characterName || input.title || "character_card";
  const cleaned = String(raw || "角色卡").replace(/\.[^.]+$/, "").trim() || "角色卡";
  return cleaned.endsWith(".md") ? cleaned : `${cleaned}.md`;
}

function requireProjectTarget(projectSlug, relativePath, label) {
  if (!projectSlug) {
    throw httpError(400, `${label} 需要在某一本书内执行，请先进入项目或在部门页选择书籍范围。`);
  }
  return {
    mode: "write-artifacts",
    targets: [
      {
        path: `books/${projectSlug}/${relativePath}`,
        label
      }
    ]
  };
}

function resolveProjectBootstrap(seed) {
  const bundle = buildProjectArtifacts(seed, "");
  return {
    mode: "project-bootstrap",
    projectTitle: bundle.title,
    projectSlug: bundle.slug,
    artifacts: bundle.artifacts,
    targets: bundle.artifacts.map((artifact) => ({ path: artifact.path, label: "项目初始化文件" }))
  };
}

function parseArgs() {
  const portIndex = process.argv.lastIndexOf("--port");
  const port = portIndex >= 0 ? Number(process.argv[portIndex + 1]) : 4174;
  return { port };
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

function toRepoPath(absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join("/");
}

function safeJoinRepo(repoPath) {
  const clean = String(repoPath || "").replace(/^\/+/, "");
  const absPath = path.resolve(repoRoot, clean);
  if (!absPath.startsWith(repoRoot + path.sep) && absPath !== repoRoot) {
    throw httpError(400, "Path is outside repository");
  }
  return absPath;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function walkFiles(rootDir, files = []) {
  if (!(await exists(rootDir))) return files;
  const entries = await readdir(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (blockedSegments.has(entry.name)) continue;
    const absPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(absPath, files);
      continue;
    }
    if (!entry.isFile() || !textExtensions.has(path.extname(entry.name))) continue;
    const repoPath = toRepoPath(absPath);
    if (repoPath.includes("/archive/") || repoPath.endsWith("/archive")) continue;
    if (repoPath.startsWith("books/_template/")) continue;
    if (repoPath.includes("/candidate/")) continue;
    const fileStat = await stat(absPath);
    files.push({
      path: repoPath,
      name: path.basename(repoPath),
      extension: path.extname(repoPath).slice(1) || "text",
      bytes: fileStat.size,
      status: classifyStatus(repoPath),
      area: classifyArea(repoPath)
    });
  }
  return files;
}

function classifyStatus(repoPath) {
  if (repoPath.startsWith("company/")) return "company";
  if (repoPath.startsWith("books/")) return "book";
  return "reference";
}

function classifyArea(repoPath) {
  if (repoPath.startsWith("company/")) return "company";
  if (repoPath.startsWith("books/")) return "book";
  return "root";
}

async function readText(repoPath) {
  const absPath = safeJoinRepo(repoPath);
  if (!(await exists(absPath))) throw httpError(404, `Missing file: ${repoPath}`);
  return readFile(absPath, "utf8");
}

function firstMarkdownHeading(content) {
  const match = String(content || "").match(/^#\s+(.+)$/m);
  return match ? match[1].trim() : "";
}

function firstMeaningfulLine(content) {
  return String(content || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#") && !line.startsWith("|") && !line.startsWith("- ")) || "";
}

function extractBookTitle(seed) {
  const text = String(seed || "").trim();
  const quoted = text.match(/《([^》]+)》/);
  if (quoted) return quoted[1].trim();
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || "未命名项目";
  return firstLine
    .replace(/第[一二三四五六七八九十0-9]+卷.*$/, "")
    .replace(/[（(].*?[)）]\s*$/, "")
    .trim() || "未命名项目";
}

function sanitizeBookSlug(title) {
  return String(title || "未命名项目")
    .replace(/[\\/:*?"<>|]/g, "_")
    .replace(/\s+/g, "")
    .trim() || "未命名项目";
}

function splitSeedSections(seed) {
  const text = String(seed || "").replace(/\r\n/g, "\n").trim();
  const lines = text.split("\n");
  const sections = [];
  let current = null;
  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (/^[一二三四五六七八九十]+、/.test(line)) {
      if (current) sections.push(current);
      current = { heading: line.trim(), body: [] };
      continue;
    }
    if (!current) {
      current = { heading: "原始输入", body: [] };
    }
    current.body.push(rawLine);
  }
  if (current) sections.push(current);
  return sections;
}

function sectionBody(sections, keyword) {
  const hit = sections.find((item) => item.heading.includes(keyword));
  return hit ? hit.body.join("\n").trim() : "";
}

function parseArcs(plotText) {
  return String(plotText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^第.+幕：/.test(line))
    .map((line, index) => {
      const match = line.match(/^(.+?)：(.+?)（ch(\d+)-(\d+)）$/);
      if (!match) {
        return {
          id: `act-${index + 1}`,
          label: line
        };
      }
      return {
        id: `act-${index + 1}`,
        stage: match[1],
        title: match[2],
        chapterStart: Number(match[3]),
        chapterEnd: Number(match[4])
      };
    });
}

function buildProjectArtifacts(seed, output) {
  const title = extractBookTitle(seed);
  const slug = sanitizeBookSlug(title);
  const sections = splitSeedSections(seed);
  const powerSystem = sectionBody(sections, "力量体系");
  const mindset = sectionBody(sections, "心态转变");
  const plotline = sectionBody(sections, "剧情大纲");
  const characters = sectionBody(sections, "人物小传");
  const payoff = sectionBody(sections, "爽点");
  const foreshadow = sectionBody(sections, "伏笔");
  const rhythm = sectionBody(sections, "节奏");
  const artifacts = [
    {
      path: `books/${slug}/资料库/圣经/书籍圣经.md`,
      content: [
        `# ${title} 书籍总纲`,
        "",
        "## 项目摘要",
        normalizeWorkspaceLanguage(output || "待补充。"),
        "",
        "## 原始立项文本",
        "```text",
        String(seed || "").trim(),
        "```"
      ].join("\n")
    },
    {
      path: `books/${slug}/资料库/世界/世界规则.md`,
      content: [
        `# ${title} 世界规则`,
        "",
        "## 力量体系",
        powerSystem || "待补充。",
        "",
        "## 主角心态与世界交互规则",
        mindset || "待补充。"
      ].join("\n")
    },
    {
      path: `books/${slug}/资料库/角色/角色总表.md`,
      content: [
        `# ${title} 角色库`,
        "",
        characters || "待补充角色资料。"
      ].join("\n")
    },
    {
      path: `books/${slug}/资料库/剧情/剧情总纲.md`,
      content: [
        `# ${title} 剧情线`,
        "",
        plotline || "待补充剧情大纲。",
        "",
        "## 节奏总控",
        rhythm || "待补充。"
      ].join("\n")
    },
    {
      path: `books/${slug}/资料库/伏笔/伏笔总表.md`,
      content: [
        `# ${title} 伏笔总表`,
        "",
        foreshadow || "待补充伏笔系统。"
      ].join("\n")
    },
    {
      path: `books/${slug}/资料库/时间/时间线.json`,
      content: JSON.stringify({
        bookTitle: title,
        version: 1,
        arcs: parseArcs(plotline),
        notes: payoff ? [payoff] : []
      }, null, 2)
    },
    {
      path: `books/${slug}/资料库/合同/总览.md`,
      content: `# ${title} 合同区\n\n- 待生成章节合同。\n`
    },
    {
      path: `books/${slug}/资料库/审稿/总览.md`,
      content: `# ${title} 审稿区\n\n- 待生成章节审稿与节奏检查。\n`
    },
    {
      path: `books/${slug}/资料库/正文/总览.md`,
      content: `# ${title} 正文章节\n\n- 待生成正文。\n`
    }
  ];
  return { title, slug, artifacts };
}

async function readContext(paths, projectSlug) {
  const uniquePaths = [...new Set(compactList(paths))];
  const context = [];
  for (const repoPath of uniquePaths) {
    try {
      const content = await readText(repoPath);
      context.push({
        path: repoPath,
        status: classifyStatus(repoPath),
        available: true,
        excerpt: normalizeWorkspaceLanguage(content.slice(0, 1400))
      });
    } catch {
      context.push({
        path: repoPath,
        status: classifyStatus(repoPath),
        available: false,
        excerpt: ""
      });
    }
  }
  return context;
}

async function buildProjects() {
  const booksDir = path.join(repoRoot, "books");
  if (!(await exists(booksDir))) return [];
  const entries = await readdir(booksDir, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const slug = entry.name;
    if (slug === "_template") continue;
    const root = path.join(booksDir, slug);
    const libraryRoot = path.join(root, "资料库");
    const libraryBase = libraryRoot;
    const library = await Promise.all(requiredBookLibrary.map(async (name) => ({
      name,
      ready: await exists(path.join(libraryBase, name))
    })));
    const files = await walkFiles(root, []);
    const readyLibrary = library.filter((item) => item.ready).length;
    projects.push({
      slug,
      title: titleFromSlug(slug),
      stage: readyLibrary === 0 ? "待初始化" : "写作准备",
      currentTask: readyLibrary === 0 ? "建立新书骨架" : "补齐章节生产资料",
      library,
      fileCount: files.length,
      knowledgeCompleteness: Math.round((readyLibrary / requiredBookLibrary.length) * 100)
    });
  }
  return projects;
}

async function buildPlotCards(projectSlug) {
  if (!projectSlug) return [];
  const projectRoot = path.join(repoRoot, "books", projectSlug);
  if (!(await exists(projectRoot))) return [];
  const files = await walkFiles(projectRoot, []);
  const plotFiles = files
    .filter((file) => ["/剧情/", "/合同/"].some((segment) => file.path.includes(segment)))
    .slice(0, 48);

  const cards = [];
  for (const file of plotFiles) {
    try {
      const content = await readText(file.path);
      cards.push({
        key: file.path,
        path: file.path,
        status: file.status,
        title: firstMarkdownHeading(content) || file.name.replace(/\.[^.]+$/, ""),
        summary: firstMeaningfulLine(content) || "该文件目前还没有可提取的摘要。",
        role: file.path.includes("/剧情/") ? "卷纲与篇章线" : "章节合同与场景序列"
      });
    } catch {
      cards.push({
        key: file.path,
        path: file.path,
        status: file.status,
        title: file.name.replace(/\.[^.]+$/, ""),
        summary: "读取失败。",
        role: file.path.includes("/剧情/") ? "卷纲与篇章线" : "章节合同与场景序列"
      });
    }
  }
  return cards;
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

async function buildManifest() {
  const companyFiles = await walkFiles(path.join(repoRoot, "company"), []);
  const bookFiles = await walkFiles(path.join(repoRoot, "books"), []);
  const rootFiles = [];
  for (const repoPath of ["README.md", "AGENTS.md"]) {
    const absPath = safeJoinRepo(repoPath);
    if (await exists(absPath)) {
      const fileStat = await stat(absPath);
      rootFiles.push({
        path: repoPath,
        name: path.basename(repoPath),
        extension: path.extname(repoPath).slice(1),
        bytes: fileStat.size,
        status: "reference",
        area: "root"
      });
    }
  }
  const files = [...rootFiles, ...companyFiles, ...bookFiles]
    .filter((file, index, list) => list.findIndex((item) => item.path === file.path) === index)
    .sort((a, b) => a.path.localeCompare(b.path));
  const projects = await buildProjects();
  return {
    generatedAt: new Date().toISOString(),
    departments,
    actions,
    projects,
    files,
    stats: {
      departments: departments.length,
      actions: actions.length,
      projects: projects.length,
      bookFiles: files.filter((file) => file.status === "book").length,
      companyFiles: files.filter((file) => file.status === "company").length
    }
  };
}

async function resolveContext(actionId, projectSlug) {
  const action = actions.find((item) => item.id === actionId);
  if (!action) throw httpError(404, `Unknown action: ${actionId}`);
  return { action, projectSlug, context: [], missing: [] };
}

function resolveActionExecution(action, payload) {
  const targetPlan = action.targetResolver({
    projectSlug: payload.projectSlug,
    input: payload.input || {}
  });
  const contextPaths = compactList(
    typeof action.contextProfile === "function"
      ? action.contextProfile({ projectSlug: payload.projectSlug, input: payload.input || {}, targets: targetPlan.targets || [] })
      : action.contextProfile
  );
  const workflow = typeof action.workflow === "function"
    ? action.workflow({ projectSlug: payload.projectSlug, input: payload.input || {}, targets: targetPlan.targets || [] })
    : action.workflow || [];
  return {
    action,
    targetPlan,
    contextPaths,
    workflow
  };
}

async function resolveContextForPayload(actionId, payload) {
  const action = actions.find((item) => item.id === actionId);
  if (!action) throw httpError(404, `Unknown action: ${actionId}`);
  const execution = resolveActionExecution(action, payload);
  const context = await readContext(execution.contextPaths, payload.projectSlug);
  return {
    action,
    projectSlug: payload.projectSlug,
    targetPlan: execution.targetPlan,
    workflow: execution.workflow,
    context,
    missing: context.filter((item) => !item.available)
  };
}

function buildOfflineOutput(action, targetPlan, input = {}) {
  const targets = targetPlan.targets || [];
  const title = input.seed || input.title || input.chapterLabel || input.chapter || "未命名任务";
  return [
    `# ${action.label}`,
    "",
    `目标：围绕“${title}”生成可直接写入目标文件的结果。`,
    "",
    "## 执行重点",
    "- 人物当下欲望优先于设定推进。",
    "- 每个章节产物都要包含目标、冲突、爽点、代价、章尾钩。",
    "- 作者确认前只展示结果，不直接落盘。",
    "",
    "## 目标文件",
    ...targets.map((target) => `- \`${target.path}\``),
    "",
    "## 下一步",
    "- 若内容方向正确，确认后直接写入目标文件。",
    "- 若缺少本书圣经、角色卡或伏笔表，先补齐资料再重新执行。"
  ].join("\n");
}

async function callModelIfConfigured({ action, context, input, targetPlan, signal }) {
  const baseUrl = anthropicConfig.baseUrl;
  const token = anthropicConfig.authToken;
  const model = anthropicConfig.model;
  if (!baseUrl || !token || !model) {
    return {
      usedModel: false,
      output: buildOfflineOutput(action, targetPlan, input)
    };
  }
  const endpoint = resolveMessagesEndpoint(baseUrl);
  if (modelHealth.retryAfterUntil && Date.now() < modelHealth.retryAfterUntil) {
    return {
      usedModel: false,
      unavailable: true,
      error: modelHealth.lastError,
      output: buildOfflineOutput(action, targetPlan, input)
    };
  }
  const body = {
    model,
    max_tokens: 1800,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: [
              "你是 ProjectGod 写作公司工作台的执行模型。",
              `当前任务：${action.label}`,
              `阶段：${action.stage}`,
              `用户输入：${JSON.stringify(input || {}, null, 2)}`,
              `目标文件：${(targetPlan.targets || []).map((item) => item.path).join(" | ")}`,
              "固定上下文：",
              context.map((item) => `--- ${item.path} (${item.available ? "available" : "missing"}) ---\n${item.excerpt}`).join("\n\n"),
              "请输出可直接写入目标文件的最终文件内容，必须服务网文写作流畅生产；不要提到搜索。不要输出隐藏思维链。",
              "不要写“目标文件”“文档内容”“说明”“如下”等包装词，不要使用代码围栏，直接从文件标题和正文开始输出。",
              "当前产品术语已经取消候选区、工作区和正式区的对立说法。请使用“当前文件”“目标文件”“确认写入”等表述。"
            ].join("\n\n")
          }
        ]
      }
    ]
  };
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
      "authorization": `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const raw = await response.text();
  const contentType = response.headers.get("content-type") || "";
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    const preview = raw.replace(/\s+/g, " ").slice(0, 260);
    throw httpError(
      response.status || 502,
      `Model response was not JSON. endpoint=${redactEndpoint(endpoint)} status=${response.status} content-type=${contentType} body=${preview}`
    );
  }
  if (!response.ok) {
    const message = formatModelError(data, endpoint, response.status);
    registerModelFailure(message, endpoint, response.status);
    throw httpError(response.status, message);
  }
  modelHealth.lastError = null;
  modelHealth.lastFailureAt = null;
  modelHealth.retryAfterUntil = null;
  modelHealth.endpoint = redactEndpoint(endpoint);
  const text = normalizeWorkspaceLanguage(extractModelText(data));
  return { usedModel: true, output: text };
}

function resolveMessagesEndpoint(baseUrl) {
  const clean = String(baseUrl || "").replace(/\/+$/, "");
  if (clean.endsWith("/messages")) return clean;
  if (clean.endsWith("/v1")) return `${clean}/messages`;
  return `${clean}/v1/messages`;
}

function redactEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    return `${url.origin}${url.pathname}`;
  } catch {
    return String(endpoint || "").replace(/[?].*$/, "");
  }
}

function formatModelError(data, endpoint, status) {
  const detail = data?.error?.message || data?.message || data?.base_resp?.status_msg || JSON.stringify(data).slice(0, 500);
  return `Model request failed. endpoint=${redactEndpoint(endpoint)} status=${status} detail=${detail}`;
}

function registerModelFailure(message, endpoint, status) {
  modelHealth.lastError = message;
  modelHealth.lastFailureAt = new Date().toISOString();
  modelHealth.endpoint = redactEndpoint(endpoint);
  if (status === 429) {
    const resetMatch = /resets at ([0-9T:+-]+)/i.exec(message);
    const resetTime = resetMatch ? Date.parse(resetMatch[1]) : Number.NaN;
    modelHealth.retryAfterUntil = Number.isFinite(resetTime) ? resetTime : Date.now() + 5 * 60 * 1000;
  }
}

function extractModelText(data) {
  if (Array.isArray(data.content)) {
    const text = data.content
      .filter((part) => !part.type || part.type === "text")
      .map((part) => part.text || "")
      .filter(Boolean)
      .join("\n");
    if (text) return text;
  }
  return data.output_text || data.text || JSON.stringify(stripThinking(data), null, 2);
}

function stripThinking(value) {
  if (Array.isArray(value)) return value.map(stripThinking);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, nested] of Object.entries(value)) {
    if (key === "thinking" || key === "signature") continue;
    result[key] = stripThinking(nested);
  }
  return result;
}

function normalizeWorkspaceLanguage(text) {
  return String(text || "")
    .replace(/候选区/g, "当前文件区")
    .replace(/候选文件/g, "目标文件")
    .replace(/候选内容/g, "结果")
    .replace(/候选结果/g, "结果")
    .replace(/候选稿/g, "结果")
    .replace(/候选/g, "结果")
    .replace(/工作区/g, "当前文件区")
    .replace(/工作稿/g, "结果")
    .replace(/\bcandidate\b/gi, "当前文件")
    .replace(/\bworkspace\b/gi, "当前文件")
    .replace(/\bStory Bible\b/gi, "书籍圣经");
}

function targetExistsMap(targets = [], context = []) {
  const availablePaths = new Set(context.filter((item) => item.available).map((item) => item.path));
  return targets.map((target) => ({
    path: target.path,
    label: target.label,
    exists: availablePaths.has(target.path)
  }));
}

function buildArtifactsFromResult(targetPlan, output) {
  if (targetPlan.mode === "project-bootstrap") {
    return targetPlan.artifacts || [];
  }
  const target = targetPlan.targets?.[0];
  if (!target) return [];
  return [{ path: target.path, content: output }];
}

async function runAction(payload) {
  const { action, context, missing, targetPlan, workflow } = await resolveContextForPayload(payload.actionId, payload);
  const runId = `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const events = [
    {
      phase: "Scope",
      message: `${action.skill} 已进入 ${payload.projectSlug ? "书层" : "公司层"} 执行范围。`,
      details: {
        note: payload.projectSlug ? `当前项目：${payload.projectSlug}` : "当前为公司层执行。"
      }
    },
    {
      phase: "Context",
      message: `读取执行资料：${context.length} 个文件，缺失 ${missing.length} 个。`,
      details: {
        files: context.map((item) => ({
          path: item.path,
          status: item.status,
          available: item.available,
          excerpt: normalizeWorkspaceLanguage(item.excerpt)
        }))
      }
    },
    {
      phase: "Workflow",
      message: `执行 ${action.stage} 阶段动作：${action.label}。`,
      details: {
        actionId: action.id,
        input: payload.input || {},
        plan: workflow
      }
    },
    {
      phase: "Write Plan",
      message: `已规划 ${targetPlan.targets?.length || 0} 个目标文件。`,
      details: {
        targets: targetExistsMap(targetPlan.targets || [], context),
        note: "确认前不落盘；确认后直接写入这些文件。"
      }
    }
  ];
  let result;
  try {
    result = await callModelIfConfigured({
      action,
      context,
      input: payload.input || {},
      targetPlan
    });
    events.push({
      phase: "Reflection",
      message: reflectionMessage(result),
      details: {
        usedModel: result.usedModel,
        unavailable: Boolean(result.unavailable),
        missingContext: missing.map((item) => item.path),
        note: "这里展示的是可审阅的执行摘要，不展示隐藏思维链。"
      }
    });
    events.push({ phase: "Output", message: result.output });
  } catch (error) {
    events.push({
      phase: "Reflection",
      message: `模型调用失败：${error.message}`,
      details: {
        usedModel: false,
        unavailable: Boolean(modelHealth.lastError),
        error: error.message,
        missingContext: missing.map((item) => item.path)
      }
    });
    events.push({ phase: "Output", message: buildOfflineOutput(action, targetPlan, payload.input || {}) });
    result = { usedModel: false, unavailable: Boolean(modelHealth.lastError), output: events.at(-1).message, error: error.message };
  }
  const response = {
    runId,
    action,
    context,
    missing,
    events,
    output: result.output,
    usedModel: result.usedModel,
    modelUnavailable: Boolean(result.unavailable),
    error: result.error || null,
    saveMode: targetPlan.mode,
    saveLabel: targetPlan.mode === "project-bootstrap" ? "确认创建书籍项目" : "确认写入目标文件",
    projectSlug: targetPlan.projectSlug || payload.projectSlug || null,
    projectTitle: targetPlan.projectTitle || null,
    targets: targetPlan.targets || [],
    artifacts: buildArtifactsFromResult(targetPlan, result.output)
  };
  runs.set(runId, response);
  return response;
}

function createRunRecord(payload) {
  const runId = `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const record = {
    id: runId,
    payload,
    events: [],
    listeners: new Set(),
    done: false,
    response: null,
    controller: new AbortController()
  };
  runs.set(runId, record);
  return record;
}

function emitRunEvent(record, event) {
  record.events.push(event);
  for (const res of record.listeners) {
    res.write(`event: step\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }
}

function finishRun(record, response) {
  record.done = true;
  record.response = response;
  for (const res of record.listeners) {
    res.write(`event: done\n`);
    res.write(`data: ${JSON.stringify(response)}\n\n`);
    res.end();
  }
  record.listeners.clear();
}

async function executeRunRecord(record) {
  const payload = record.payload;
  const { action, context, missing, targetPlan, workflow } = await resolveContextForPayload(payload.actionId, payload);
  emitRunEvent(record, {
    phase: "Scope",
    message: `${action.skill} 已进入 ${payload.projectSlug ? "书层" : "公司层"} 执行范围。`,
    details: {
      note: payload.projectSlug ? `当前项目：${payload.projectSlug}` : "当前为公司层执行。"
    }
  });
  emitRunEvent(record, {
    phase: "Context",
    message: `读取执行资料：${context.length} 个文件，缺失 ${missing.length} 个。`,
    details: {
      files: context.map((item) => ({
        path: item.path,
        status: item.status,
        available: item.available,
        excerpt: normalizeWorkspaceLanguage(item.excerpt)
      }))
    }
  });
  emitRunEvent(record, {
    phase: "Workflow",
    message: `执行 ${action.stage} 阶段动作：${action.label}。`,
    details: {
      actionId: action.id,
      input: payload.input || {},
      plan: workflow
    }
  });
  emitRunEvent(record, {
    phase: "Write Plan",
    message: `已规划 ${targetPlan.targets?.length || 0} 个目标文件。`,
    details: {
      targets: targetExistsMap(targetPlan.targets || [], context),
      note: "确认前不落盘；确认后直接写入这些文件。"
    }
  });
  emitRunEvent(record, {
    phase: "Reflection",
    message: "模型正在生成，等待返回可审阅结果。"
  });

  try {
    const result = await callModelIfConfigured({
      action,
      context,
      input: payload.input || {},
      targetPlan,
      signal: record.controller.signal
    });
    emitRunEvent(record, {
      phase: "Reflection",
      message: reflectionMessage(result),
      details: {
        usedModel: result.usedModel,
        unavailable: Boolean(result.unavailable),
        missingContext: missing.map((item) => item.path),
        note: "这里展示的是可审阅的执行摘要，不展示隐藏思维链。"
      }
    });
    emitRunEvent(record, { phase: "Output", message: result.output });
    finishRun(record, {
      runId: record.id,
      status: "result",
      action,
      context,
      missing,
      events: record.events,
      output: result.output,
      usedModel: result.usedModel,
      modelUnavailable: Boolean(result.unavailable),
      error: result.error || null,
      saveMode: targetPlan.mode,
      saveLabel: targetPlan.mode === "project-bootstrap" ? "确认创建书籍项目" : "确认写入目标文件",
      projectSlug: targetPlan.projectSlug || payload.projectSlug || null,
      projectTitle: targetPlan.projectTitle || null,
      targets: targetPlan.targets || [],
      artifacts: buildArtifactsFromResult(targetPlan, result.output)
    });
  } catch (error) {
    if (error.name === "AbortError") {
      finishRun(record, {
        runId: record.id,
        status: "cancelled",
        action,
        context,
        missing,
        events: record.events,
        output: "",
        usedModel: false,
        modelUnavailable: false,
        targets: targetPlan.targets || [],
        error: "本次请求已取消。"
      });
      return;
    }
    emitRunEvent(record, {
      phase: "Reflection",
      message: `模型调用失败：${error.message}`,
      details: {
        usedModel: false,
        unavailable: Boolean(modelHealth.lastError),
        error: error.message,
        missingContext: missing.map((item) => item.path)
      }
    });
    const output = buildOfflineOutput(action, targetPlan, payload.input || {});
    emitRunEvent(record, { phase: "Output", message: output });
    finishRun(record, {
      runId: record.id,
      status: "error",
      action,
      context,
      missing,
      events: record.events,
      output,
      usedModel: false,
      modelUnavailable: Boolean(modelHealth.lastError),
      targets: targetPlan.targets || [],
      error: error.message
    });
  }
}

function reflectionMessage(result) {
  if (result.usedModel) return "已调用配置模型，结果已生成，确认后可直接写入目标文件。";
  if (result.unavailable) return `模型暂不可用：${result.error}`;
  return "模型环境变量未配置，已返回离线结果骨架。";
}

async function writeEditableFile(payload) {
  const repoPath = String(payload.path || "");
  if (!repoPath) throw httpError(400, "Missing file path");
  if (repoPath.includes("/archive/")) throw httpError(403, "Archive paths are disabled");
  const allowed = repoPath.startsWith("company/") || repoPath.startsWith("books/");
  if (!allowed) throw httpError(403, "Only company and book files can be edited");
  const absPath = safeJoinRepo(repoPath);
  await mkdir(path.dirname(absPath), { recursive: true });
  await writeFile(absPath, String(payload.content || ""), "utf8");
  return { ok: true, path: repoPath };
}

async function deleteEditableFile(payload) {
  const repoPath = String(payload.path || "");
  if (!repoPath) throw httpError(400, "Missing file path");
  if (repoPath.includes("/archive/")) throw httpError(403, "Archive paths are disabled");
  const allowed = repoPath.startsWith("company/") || repoPath.startsWith("books/");
  if (!allowed) throw httpError(403, "Only company and book files can be deleted");
  const absPath = safeJoinRepo(repoPath);
  if (!(await exists(absPath))) throw httpError(404, `Missing file: ${repoPath}`);
  await rm(absPath, { force: false });
  return { ok: true, path: repoPath };
}

async function writeArtifacts(payload) {
  const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
  if (!artifacts.length) {
    throw httpError(400, "No artifacts to write");
  }
  const written = [];
  for (const artifact of artifacts) {
    const repoPath = String(artifact.path || "");
    if (!repoPath) throw httpError(400, "Artifact path is required");
    if (repoPath.includes("/archive/")) throw httpError(403, "Archive paths are disabled");
    if (!repoPath.startsWith("company/") && !repoPath.startsWith("books/")) {
      throw httpError(403, `Invalid artifact target: ${repoPath}`);
    }
    const absPath = safeJoinRepo(repoPath);
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, String(artifact.content || ""), "utf8");
    written.push(repoPath);
  }
  const projectRoots = [...new Set(written.filter((item) => item.startsWith("books/")).map((item) => item.split("/").slice(0, 2).join("/")))];
  return {
    ok: true,
    written,
    projectRoots
  };
}

function sendJson(res, data, status = 200) {
  const body = JSON.stringify(data, null, 2);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function sendText(res, text, status = 200, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": type, "cache-control": "no-store" });
  res.end(text);
}

async function readRequestBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? "/index.html" : pathname;
  const absPath = path.resolve(distRoot, `.${filePath}`);
  if (!absPath.startsWith(distRoot + path.sep) && absPath !== distRoot) throw httpError(403, "Forbidden");
  let finalPath = absPath;
  if (!(await exists(finalPath))) finalPath = path.join(distRoot, "index.html");
  const ext = path.extname(finalPath);
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";
  res.writeHead(200, { "content-type": contentType });
  createReadStream(finalPath).pipe(res);
}

async function router(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathname = url.pathname;
  if (req.method === "GET" && pathname === "/api/model/status") {
    const retryAfter = modelHealth.retryAfterUntil ? new Date(modelHealth.retryAfterUntil).toISOString() : null;
    return sendJson(res, {
      configured: Boolean(anthropicConfig.baseUrl && anthropicConfig.authToken && anthropicConfig.model),
      baseUrlConfigured: Boolean(anthropicConfig.baseUrl),
      modelConfigured: Boolean(anthropicConfig.model),
      model: anthropicConfig.model || null,
      endpoint: modelHealth.endpoint || (anthropicConfig.baseUrl ? redactEndpoint(resolveMessagesEndpoint(anthropicConfig.baseUrl)) : null),
      lastError: modelHealth.lastError,
      lastFailureAt: modelHealth.lastFailureAt,
      retryAfter
    });
  }
  if (req.method === "GET" && pathname === "/api/manifest") {
    return sendJson(res, await buildManifest());
  }
  if (req.method === "GET" && pathname === "/api/file") {
    const repoPath = url.searchParams.get("path");
    const content = await readText(repoPath);
    return sendJson(res, { path: repoPath, content, status: classifyStatus(repoPath), area: classifyArea(repoPath) });
  }
  if (req.method === "GET" && pathname === "/api/plot-cards") {
    const projectSlug = url.searchParams.get("projectSlug");
    return sendJson(res, { projectSlug, cards: await buildPlotCards(projectSlug) });
  }
  if (req.method === "POST" && pathname === "/api/context/resolve") {
    const payload = await readRequestBody(req);
    return sendJson(res, await resolveContextForPayload(payload.actionId, payload));
  }
  if (req.method === "POST" && pathname === "/api/actions/start") {
    const payload = await readRequestBody(req);
    const record = createRunRecord(payload);
    executeRunRecord(record).catch((error) => {
      finishRun(record, {
        runId: record.id,
        status: "error",
        action: null,
        context: [],
        missing: [],
        events: record.events,
        output: "",
        usedModel: false,
        modelUnavailable: Boolean(modelHealth.lastError),
        targets: [],
        error: error.message || "执行失败"
      });
    });
    return sendJson(res, { runId: record.id });
  }
  if (req.method === "POST" && pathname === "/api/actions/run") {
    const payload = await readRequestBody(req);
    return sendJson(res, await runAction(payload));
  }
  const runMatch = /^\/api\/actions\/([^/]+)\/events$/.exec(pathname);
  if (req.method === "GET" && runMatch) {
    const run = runs.get(runMatch[1]);
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive"
    });
    if (!run) {
      res.write(`event: step\n`);
      res.write(`data: ${JSON.stringify({ phase: "Reflection", message: "执行记录不存在或已过期。" })}\n\n`);
      res.write(`event: done\n`);
      res.write(`data: ${JSON.stringify({ status: "error", error: "执行记录不存在或已过期。" })}\n\n`);
      return res.end();
    }
    for (const event of run.events) {
      res.write(`event: step\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
    if (run.done) {
      res.write(`event: done\n`);
      res.write(`data: ${JSON.stringify(run.response || {})}\n\n`);
      return res.end();
    }
    run.listeners.add(res);
    req.on("close", () => {
      run.listeners.delete(res);
    });
    return;
  }
  const cancelMatch = /^\/api\/actions\/([^/]+)\/cancel$/.exec(pathname);
  if (req.method === "POST" && cancelMatch) {
    const run = runs.get(cancelMatch[1]);
    if (!run) throw httpError(404, "Run not found");
    if (!run.done) {
      run.controller.abort();
    }
    return sendJson(res, { ok: true, runId: run.id, status: run.done ? run.response?.status || "done" : "cancelling" });
  }
  if (req.method === "POST" && pathname === "/api/artifacts/write") {
    const payload = await readRequestBody(req);
    return sendJson(res, await writeArtifacts(payload));
  }
  if (req.method === "POST" && pathname === "/api/file/write") {
    const payload = await readRequestBody(req);
    return sendJson(res, await writeEditableFile(payload));
  }
  if (req.method === "POST" && pathname === "/api/file/delete") {
    const payload = await readRequestBody(req);
    return sendJson(res, await deleteEditableFile(payload));
  }
  if (req.method === "GET" && !pathname.startsWith("/api/")) {
    return serveStatic(req, res, pathname);
  }
  throw httpError(404, "Not found");
}

const { port } = parseArgs();
const server = http.createServer(async (req, res) => {
  try {
    await router(req, res);
  } catch (error) {
    sendJson(res, { error: error.message || "Internal error" }, error.status || 500);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`ProjectGod company console listening on http://127.0.0.1:${port}`);
});
