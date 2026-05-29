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
const modelTokenPolicy = {
  maxContextWindowTokens: 204800,
  maxOutputTokens: 16384,
  reservedInstructionTokens: 1800,
  minContextTokens: 1200,
  tokenizerMode: "heuristic-estimate"
};
const publicTracePhases = new Set(["Observe", "Plan", "Draft", "Review"]);
const continuationPolicy = {
  maxPasses: 8,
  tailChars: 1200,
  digestChars: 1800,
  maxHeadingCount: 8
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
    inputSchema: [
      {
        key: "seed",
        label: "立项文本",
        type: "textarea",
        required: true,
        placeholder: "粘贴书名、题材、主角设定、剧情大纲、人物小传、爽点与伏笔。"
      }
    ],
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
    inputSchema: [
      {
        key: "characterName",
        label: "角色名",
        type: "text",
        required: true,
        placeholder: "例如：嬴政 / 马库斯 / 新角色名"
      },
      {
        key: "roleType",
        label: "角色类型",
        type: "select",
        required: true,
        options: ["主角", "重要配角", "次要配角", "龙套", "组织/团体"],
        defaultValue: "重要配角"
      },
      {
        key: "changeIntent",
        label: "本次任务",
        type: "select",
        required: true,
        options: ["新增角色档案", "补全既有角色", "重写角色定位"],
        defaultValue: "补全既有角色"
      },
      {
        key: "notes",
        label: "补充要求",
        type: "textarea",
        required: false,
        placeholder: "例如：补出关键关系、首次出场章节、记忆点、禁区。"
      }
    ],
    contextProfile: ({ projectSlug }) => [
      "company/模板/角色模板.md",
      "company/共享方法/写作规则.md",
      ...bookScopePaths(projectSlug, ["圣经/书籍圣经.md", "角色/角色总表.md", "剧情/剧情总纲.md"])
    ],
    workflow: ({ input }) => [
      `围绕 ${input?.characterName || "目标角色"} 读取现有角色总表，而不是新建散落角色文件。`,
      "按角色档案库思路补齐身份标签、记忆点、关系网络、核心动机和当前正式状态。",
      "同步更新角色索引与对应角色分区，确认前展示为写回角色总表。"
    ],
    targetResolver: ({ projectSlug }) => requireProjectTarget(projectSlug, "资料库/角色/角色总表.md", "角色总表")
  },
  {
    id: "plotline-plan",
    label: "生成卷纲/篇章线",
    stage: "剧情工作台",
    skill: "卷纲与篇章线规划",
    scope: "project",
    inputSchema: [
      {
        key: "arcName",
        label: "篇章/卷名",
        type: "text",
        required: true,
        placeholder: "例如：角斗场脱困卷 / 神选角斗篇"
      },
      {
        key: "chapterRange",
        label: "章节范围",
        type: "text",
        required: false,
        placeholder: "例如：第1-30章"
      },
      {
        key: "planningFocus",
        label: "规划重点",
        type: "select",
        required: true,
        options: ["主线推进", "篇章拆解", "章节推进"],
        defaultValue: "篇章拆解"
      },
      {
        key: "notes",
        label: "补充要求",
        type: "textarea",
        required: false,
        placeholder: "例如：强化中点反转、补足爽点节奏、明确章尾钩。"
      }
    ],
    contextProfile: ({ projectSlug }) => [
      "company/共享方法/写作规则.md",
      "company/公司标准/情绪原则.md",
      ...bookScopePaths(projectSlug, ["圣经/书籍圣经.md", "剧情/剧情总纲.md", "伏笔/伏笔总表.md"])
    ],
    workflow: ({ input }) => [
      `围绕 ${input?.arcName || "目标篇章"} 梳理主问题、阶段驱动力和大高潮位置。`,
      "按情节大纲总档案思路，把主线、篇章和章节推进写回同一份剧情总纲。",
      "确认前展示为剧情总纲更新，不另起临时剧情散文件。"
    ],
    targetResolver: ({ projectSlug }) => requireProjectTarget(projectSlug, "资料库/剧情/剧情总纲.md", "剧情总纲")
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

function uniqueList(items = []) {
  return [...new Set(compactList(items))];
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

function estimateTokenCount(text) {
  let total = 0;
  for (const char of String(text || "")) {
    if (/[\u3400-\u9fff\uf900-\ufaff]/u.test(char)) {
      total += 1.2;
    } else if (/\s/u.test(char)) {
      total += 0.15;
    } else if (/[a-z0-9]/i.test(char)) {
      total += 0.28;
    } else {
      total += 0.45;
    }
  }
  return Math.max(1, Math.ceil(total));
}

function clipText(text, maxChars) {
  const value = String(text || "");
  if (value.length <= maxChars) return value;
  return `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

function compactWhitespace(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function pickSampleLines(lines, limit) {
  const picked = [];
  for (const line of lines) {
    const clean = line.trim();
    if (!clean) continue;
    picked.push(clean);
    if (picked.length >= limit) break;
  }
  return picked;
}

function structuredExcerpt(repoPath, content, tokenBudget) {
  const normalized = compactWhitespace(normalizeWorkspaceLanguage(content));
  if (!normalized) {
    return {
      selectedText: "",
      selectedTokens: 0,
      compressionLevel: "empty",
      note: "文件为空。"
    };
  }

  const ext = path.extname(repoPath);
  const fullTokens = estimateTokenCount(normalized);
  if (fullTokens <= tokenBudget) {
    return {
      selectedText: normalized,
      selectedTokens: fullTokens,
      compressionLevel: "full",
      note: "预算允许，保留全文。"
    };
  }

  let excerpt = "";
  if (ext === ".md") {
    const lines = normalized.split("\n");
    const headings = pickSampleLines(lines.filter((line) => /^#{1,4}\s/.test(line)), 10);
    const bullets = pickSampleLines(lines.filter((line) => /^[-*]\s/.test(line)), 8);
    const plain = pickSampleLines(lines.filter((line) => !/^#{1,4}\s/.test(line) && !/^[-*]\s/.test(line) && !/^```/.test(line)), 12);
    excerpt = [
      headings.length ? "## 结构\n" + headings.join("\n") : "",
      plain.length ? "## 关键信息\n" + plain.join("\n") : "",
      bullets.length ? "## 列表片段\n" + bullets.join("\n") : "",
      `## 开头摘录\n${clipText(normalized, 900)}`,
      normalized.length > 900 ? `## 结尾摘录\n${clipText(normalized.slice(-480), 480)}` : ""
    ].filter(Boolean).join("\n\n");
  } else if (ext === ".json") {
    let keys = [];
    try {
      const parsed = JSON.parse(normalized);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        keys = Object.keys(parsed).slice(0, 16);
      }
    } catch {}
    excerpt = [
      keys.length ? `顶层键：${keys.join("、")}` : "",
      `开头摘录：\n${clipText(normalized, 900)}`,
      normalized.length > 900 ? `结尾摘录：\n${clipText(normalized.slice(-480), 480)}` : ""
    ].filter(Boolean).join("\n\n");
  } else {
    const middleStart = Math.max(0, Math.floor(normalized.length / 2) - 180);
    excerpt = [
      `开头摘录：\n${clipText(normalized, 800)}`,
      normalized.length > 1200 ? `中段摘录：\n${clipText(normalized.slice(middleStart, middleStart + 360), 360)}` : "",
      normalized.length > 800 ? `结尾摘录：\n${clipText(normalized.slice(-420), 420)}` : ""
    ].filter(Boolean).join("\n\n");
  }

  let selectedText = excerpt;
  let selectedTokens = estimateTokenCount(selectedText);
  if (selectedTokens > tokenBudget) {
    const ratio = Math.max(0.2, tokenBudget / selectedTokens);
    selectedText = clipText(selectedText, Math.max(160, Math.floor(selectedText.length * ratio)));
    selectedTokens = estimateTokenCount(selectedText);
  }

  return {
    selectedText,
    selectedTokens,
    compressionLevel: "compressed",
    note: `原始约 ${fullTokens} tokens，已按预算压缩到约 ${selectedTokens} tokens。`
  };
}

function buildContextPreview(content) {
  return clipText(compactWhitespace(normalizeWorkspaceLanguage(content)), 680);
}

function extractBookTitle(seed) {
  const text = String(seed || "").trim();
  const quoted = text.match(/《([^》]+)》/);
  if (quoted) return quoted[1].trim();
  const labeled = text.match(/(?:^|\n)\s*书名\s*[:：]\s*(.+)\s*(?:$|\n)/);
  if (labeled?.[1]) return labeled[1].trim();
  const firstLine = text.split("\n").map((line) => line.trim()).find(Boolean) || "未命名项目";
  return firstLine
    .replace(/^书名\s*[:：]\s*/, "")
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
      const normalized = normalizeWorkspaceLanguage(content);
      context.push({
        path: repoPath,
        status: classifyStatus(repoPath),
        available: true,
        excerpt: buildContextPreview(normalized),
        rawContent: normalized,
        fullTokens: estimateTokenCount(normalized),
        bytes: Buffer.byteLength(normalized, "utf8")
      });
    } catch {
      context.push({
        path: repoPath,
        status: classifyStatus(repoPath),
        available: false,
        excerpt: "",
        rawContent: "",
        fullTokens: 0,
        bytes: 0
      });
    }
  }
  return context;
}

function serializeContextForClient(context = []) {
  return context.map((item) => ({
    path: item.path,
    status: item.status,
    available: item.available,
    excerpt: item.excerpt,
    fullTokens: item.fullTokens || 0,
    selectedTokens: item.selectedTokens || 0,
    compressionLevel: item.compressionLevel || (item.available ? "full" : "missing"),
    compressionNote: item.compressionNote || "",
    allocatedBudget: item.allocatedBudget || 0,
    priorityScore: item.priorityScore || 0,
    bytes: item.bytes || 0
  }));
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

function allowedTargetPrefixes(action, projectSlug) {
  if (action.scope === "company" || !projectSlug) return ["company/"];
  if (action.scope === "project") return [`books/${projectSlug}/`];
  return ["company/", `books/${projectSlug}/`];
}

function normalizePlanTargetPath(rawPath, action, payload, fallbackTarget = null) {
  const value = String(rawPath || "").trim().replace(/^\/+/, "");
  if (!value) return "";
  if (value.startsWith("company/") || value.startsWith("books/")) return value;
  if (fallbackTarget?.path) {
    const baseDir = path.posix.dirname(fallbackTarget.path);
    return `${baseDir}/${value}`;
  }
  if (payload.projectSlug && action.scope !== "company") {
    return `books/${payload.projectSlug}/资料库/${value}`;
  }
  return `company/${value}`;
}

function normalizeTargetEntries(action, payload, requestedTargets = [], fallbackTargets = []) {
  const prefixes = allowedTargetPrefixes(action, payload.projectSlug);
  const normalized = [];
  requestedTargets.forEach((target, index) => {
    const fallbackTarget = fallbackTargets[index] || fallbackTargets[0] || null;
    const nextPath = normalizePlanTargetPath(target?.path, action, payload, fallbackTarget);
    if (!nextPath) return;
    if (!prefixes.some((prefix) => nextPath.startsWith(prefix))) return;
    normalized.push({
      path: nextPath,
      label: String(target?.label || fallbackTarget?.label || path.basename(nextPath, path.extname(nextPath)) || "目标文件").trim()
    });
  });
  return normalized.filter((target, index, list) => list.findIndex((item) => item.path === target.path) === index);
}

function normalizeTargetPlanOverride(action, payload, fallbackTargetPlan) {
  const mode = fallbackTargetPlan.mode === "project-bootstrap" ? "project-bootstrap" : "write-artifacts";
  const fallbackTargets = fallbackTargetPlan.targets || [];
  const hasExplicitTargets = Array.isArray(payload.targetPlanOverride?.targets);
  const requestedTargets = hasExplicitTargets ? payload.targetPlanOverride.targets : fallbackTargets;
  const targets = normalizeTargetEntries(action, payload, requestedTargets, fallbackTargets);
  return {
    ...fallbackTargetPlan,
    mode,
    targets: hasExplicitTargets ? targets : (targets.length ? targets : fallbackTargets)
  };
}

function resolveActionExecution(action, payload) {
  const baseTargetPlan = action.targetResolver({
    projectSlug: payload.projectSlug,
    input: payload.input || {}
  });
  const targetPlan = payload.targetPlanOverride
    ? normalizeTargetPlanOverride(action, payload, baseTargetPlan)
    : baseTargetPlan;
  const baseContextPaths = compactList(
    Array.isArray(payload.contextPathsOverride)
      ? payload.contextPathsOverride
      : typeof action.contextProfile === "function"
        ? action.contextProfile({ projectSlug: payload.projectSlug, input: payload.input || {}, targets: targetPlan.targets || [] })
        : action.contextProfile
  );
  const contextPaths = uniqueList([
    ...baseContextPaths,
    ...(targetPlan.targets || []).map((target) => target.path)
  ]);
  const workflow = Array.isArray(payload.workflowOverride) && payload.workflowOverride.length
    ? payload.workflowOverride
    : typeof action.workflow === "function"
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

function planningPromptRules(action, projectSlug) {
  const sharedRules = [
    "ProjectGod 当前工作流不再使用 candidate/workspace/proposal 平行目录。",
    "优先选择当前已存在的总档案文件做增量修改，只有章节生产或明确拆分需求时才新建章节级文件。",
    "角色类任务优先考虑 角色总表/角色档案总表 这类总档案；剧情类任务优先考虑 剧情总纲/情节大纲；连续性类任务优先考虑 伏笔总表、时间线、矛盾检测表、质量检查清单。"
  ];
  const scopeRule = projectSlug
    ? `当前在书层项目 ${projectSlug} 内，新增或修改文件优先落在 books/${projectSlug}/资料库/ 下。`
    : "当前在公司层，新增或修改文件优先落在 company/ 下。";
  const actionRule = {
    "project-skeleton": "新书骨架允许一次规划多个初始化文件。",
    "character-card": "角色动作默认应该修改角色总档案，而不是生成孤立角色散文件，除非用户明确要求拆分。",
    "plotline-plan": "剧情规划默认应该修改剧情总纲这类总档案，而不是单独长出临时卷纲。",
    "chapter-contract": "章节合同、场景序列、正文草稿、审稿类动作通常可以使用章节级文件。",
    "scene-sequence": "场景序列通常落在合同区的章节场景序列文件。",
    "chapter-draft": "章节草稿通常落在正文区单章文件。",
    "payoff-audit": "审稿类动作通常落在审稿区专项文件。",
    "anti-ai-audit": "审稿类动作通常落在审稿区专项文件。",
    "foreshadow-check": "连续性检查优先落在审稿区专项文件，必要时同步伏笔总表。",
    "timeline-check": "时间线检查优先落在审稿区专项文件，必要时同步时间线或矛盾检测表。"
  }[action.id] || "请根据任务本身判断目标文件，不要机械复用按钮名生成文件名。";
  return [...sharedRules, scopeRule, actionRule].join("\n");
}

function planningCandidateFiles(files, projectSlug) {
  return files
    .filter((file) => file.path.startsWith("company/") || (projectSlug && file.path.startsWith(`books/${projectSlug}/`)))
    .filter((file) => file.extension !== "json" || file.path.endsWith("时间线.json"))
    .sort((a, b) => a.path.localeCompare(b.path));
}

function formatPlanningCandidates(files = []) {
  return files
    .map((file) => `- ${file.path} [${file.status}]`)
    .join("\n");
}

function safeJsonParse(text) {
  try {
    return JSON.parse(String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
  } catch {
    return null;
  }
}

function normalizePlannedWorkflow(workflow, fallbackWorkflow = []) {
  if (!Array.isArray(workflow)) return fallbackWorkflow;
  const next = workflow.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 6);
  return next.length ? next : fallbackWorkflow;
}

async function suggestActionPlan(payload) {
  const action = actions.find((item) => item.id === payload.actionId);
  if (!action) throw httpError(404, `Unknown action: ${payload.actionId}`);
  const manifest = await buildManifest();
  const defaultExecution = resolveActionExecution(action, payload);
  const candidateFiles = planningCandidateFiles(manifest.files, payload.projectSlug);
  const candidatePaths = candidateFiles.map((file) => file.path);
  const fallbackTargets = defaultExecution.targetPlan.targets || [];
  const fallbackContextPaths = uniqueList(defaultExecution.contextPaths || []);
  const fallbackWorkflow = defaultExecution.workflow || [];

  const fallbackPlan = {
    summary: "已按当前动作默认规则生成文件计划，可在确认前手动修改。",
    workflow: fallbackWorkflow,
    targets: fallbackTargets,
    contextPaths: fallbackContextPaths,
    note: "当前为默认规划结果。"
  };

  const baseUrl = anthropicConfig.baseUrl;
  const token = anthropicConfig.authToken;
  const model = anthropicConfig.model;
  if (!baseUrl || !token || !model || (modelHealth.retryAfterUntil && Date.now() < modelHealth.retryAfterUntil)) {
    return {
      ...fallbackPlan,
      usedModel: false,
      contextCandidates: candidateFiles
    };
  }

  const endpoint = resolveMessagesEndpoint(baseUrl);
  const prompt = [
    "你是 ProjectGod 写作工作台的执行规划助手。",
    `动作：${action.label}`,
    `阶段：${action.stage}`,
    `作用域：${payload.projectSlug ? `书层 ${payload.projectSlug}` : "公司层"}`,
    `用户输入：${JSON.stringify(payload.input || {}, null, 2)}`,
    `当前默认目标文件：${fallbackTargets.map((item) => item.path).join(" | ") || "无"}`,
    planningPromptRules(action, payload.projectSlug),
    "你要做两件事：",
    "1. 判断这次任务应该新增或修改哪些目标文件。",
    "2. 判断正式执行前最该读取哪些上下文资料。",
    "可选文件列表：",
    formatPlanningCandidates(candidateFiles),
    "严格返回 JSON：",
    "{\"summary\":\"一句话说明\",\"workflow\":[\"最多6条\"],\"targets\":[{\"path\":\"repo path\",\"label\":\"短标签\",\"reason\":\"一句理由\"}],\"contextPaths\":[\"repo path\"],\"note\":\"补充说明\"}",
    "要求：",
    "- targets 里的 path 必须来自合理的 repo 路径，不要输出 candidate/workspace/proposal 目录。",
    "- contextPaths 必须从可选文件列表中挑选。",
    "- 如果现有总档案更合适，优先修改总档案，不要无意义新增散文件。"
  ].join("\n\n");

  const response = await callModelText({
    endpoint,
    token,
    signal: null,
    maxTokens: 900,
    messages: [{ role: "user", content: [{ type: "text", text: prompt }] }]
  });
  const parsed = safeJsonParse(response.text);
  if (!parsed) {
    return {
      ...fallbackPlan,
      usedModel: false,
      note: "模型规划结果不可解析，已回退到默认计划。",
      contextCandidates: candidateFiles
    };
  }

  return {
    summary: String(parsed.summary || fallbackPlan.summary).trim() || fallbackPlan.summary,
    workflow: normalizePlannedWorkflow(parsed.workflow, fallbackWorkflow),
    targets: normalizeTargetEntries(action, payload, Array.isArray(parsed.targets) ? parsed.targets : [], fallbackTargets).length
      ? normalizeTargetEntries(action, payload, Array.isArray(parsed.targets) ? parsed.targets : [], fallbackTargets)
      : fallbackTargets,
    contextPaths: uniqueList((Array.isArray(parsed.contextPaths) ? parsed.contextPaths : []).filter((path) => candidatePaths.includes(path))),
    note: String(parsed.note || "").trim() || "已生成 AI 文件计划。",
    usedModel: true,
    contextCandidates: candidateFiles
  };
}

async function buildActionPlan(payload) {
  const action = actions.find((item) => item.id === payload.actionId);
  if (!action) throw httpError(404, `Unknown action: ${payload.actionId}`);
  const defaultExecution = resolveActionExecution(action, payload);
  const suggested = await suggestActionPlan(payload);
  const suggestedTargets = Array.isArray(suggested.targets) && suggested.targets.length
    ? suggested.targets
    : defaultExecution.targetPlan.targets || [];
  const targetPlan = payload.targetPlanOverride
    ? normalizeTargetPlanOverride(action, payload, defaultExecution.targetPlan)
    : normalizeTargetPlanOverride(action, {
      ...payload,
      targetPlanOverride: {
        targets: suggestedTargets
      }
    }, defaultExecution.targetPlan);
  const contextPaths = uniqueList(
    Array.isArray(payload.contextPathsOverride) && payload.contextPathsOverride.length
      ? payload.contextPathsOverride
      : suggested.contextPaths?.length
        ? suggested.contextPaths
        : defaultExecution.contextPaths
  );
  const workflow = normalizePlannedWorkflow(payload.workflowOverride, suggested.workflow?.length ? suggested.workflow : defaultExecution.workflow);
  const resolved = await resolveContextForPayload(action.id, {
    ...payload,
    targetPlanOverride: targetPlan,
    contextPathsOverride: contextPaths,
    workflowOverride: workflow
  });
  const promptPack = preparePromptContext(resolved.action, resolved.context, payload.input || {}, resolved.targetPlan);
  return {
    action,
    summary: suggested.summary,
    workflow,
    note: suggested.note,
    usedModel: Boolean(suggested.usedModel),
    targetPlan: resolved.targetPlan,
    targetStatuses: await readTargetStatuses(resolved.targetPlan.targets || []),
    contextCandidates: suggested.contextCandidates,
    selectedContextPaths: contextPaths,
    context: serializeContextForClient(promptPack.preparedFiles),
    budget: promptPack.budget,
    promptPreview: promptPack.preview
  };
}

function buildOfflineOutput(action, targetPlan, input = {}) {
  const targets = targetPlan.targets || [];
  const title = input.seed || input.title || input.chapterLabel || input.chapter || "未命名任务";
  if (targets.length > 1) {
    return `${targets.map((target) => [
      `<<<FILE:${target.path}>>>`,
      `# ${target.label || action.label}`,
      "",
      `目标：围绕“${title}”生成可直接写入 ${target.path} 的结果。`,
      "",
      "## 执行重点",
      "- 人物当下欲望优先于设定推进。",
      "- 每个章节产物都要包含目标、冲突、爽点、代价、章尾钩。",
      "- 作者确认前只展示结果，不直接落盘。"
    ].join("\n")).join("\n<<<END_FILE>>>\n\n")}<<<END_FILE>>>\n[[COMPLETE]]`;
  }
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

function buildOfflineWorklog(action, targetPlan, input = {}) {
  const subject = input.seed || input.title || input.chapterLabel || input.chapter || action.label;
  return [
    {
      phase: "Observe",
      summary: `已读取当前动作所需资料，并锁定“${subject}”的执行范围。`,
      bullets: [
        `动作：${action.label}`,
        `阶段：${action.stage}`,
        `目标文件：${(targetPlan.targets || []).map((item) => item.path).join("、") || "待确认"}`
      ]
    },
    {
      phase: "Plan",
      summary: "离线模式下仅返回可审阅骨架，便于你先看结构是否对路。",
      bullets: [
        "保留执行重点、目标文件和下一步动作。",
        "不直接落盘，仍然走确认写入。"
      ]
    },
    {
      phase: "Review",
      summary: "当前没有在线模型结果，建议确认结构后再补模型配置重跑。",
      bullets: [
        "这不是最终写作质量，只是离线兜底结果。",
        "预算与压缩流程仍然会照常执行。"
      ]
    }
  ];
}

function buildPromptBudget(action, input, targetPlan) {
  const modelLabel = anthropicConfig.model || "MiniMax-M2.7-highspeed";
  const outputLimit = Math.min(outputTokenLimitForAction(action), modelTokenPolicy.maxOutputTokens);
  const promptScaffold = [
    "你是 ProjectGod 写作公司工作台的执行模型。",
    `当前任务：${action.label}`,
    `阶段：${action.stage}`,
    `用户输入：${JSON.stringify(input || {}, null, 2)}`,
    `目标文件：${(targetPlan.targets || []).map((item) => item.path).join(" | ")}`
  ].join("\n\n");
  const promptOverheadTokens = estimateTokenCount(promptScaffold) + modelTokenPolicy.reservedInstructionTokens;
  const maxInputTokens = Math.max(
    modelTokenPolicy.minContextTokens,
    modelTokenPolicy.maxContextWindowTokens - outputLimit
  );
  const availableContextTokens = Math.max(
    modelTokenPolicy.minContextTokens,
    maxInputTokens - promptOverheadTokens
  );
  return {
    modelLabel,
    maxContextWindowTokens: modelTokenPolicy.maxContextWindowTokens,
    maxInputTokens,
    maxOutputTokens: outputLimit,
    providerMaxOutputTokens: modelTokenPolicy.maxOutputTokens,
    promptOverheadTokens,
    availableContextTokens,
    tokenizerMode: modelTokenPolicy.tokenizerMode,
    tokenizerNote: `当前 token 预算基于本地启发式估算，不是 MiniMax 官方 tokenizer；按官方文档，${modelLabel} 的 context window 为 ${modelTokenPolicy.maxContextWindowTokens} tokens，max_tokens 最大为 ${modelTokenPolicy.maxOutputTokens}。`
  };
}

function outputTokenLimitForAction(action) {
  return {
    "project-skeleton": 4500,
    "core-selling-point": 3200,
    "golden-three": 5000,
    "plotline-plan": 7000,
    "character-card": 3500,
    "chapter-contract": 5000,
    "scene-sequence": 4500,
    "chapter-draft": 9000,
    "payoff-audit": 3500,
    "anti-ai-audit": 3500,
    "foreshadow-check": 3200,
    "timeline-check": 3200
  }[action.id] || modelTokenPolicy.maxOutputTokens;
}

function resolveCompressionProfile(action) {
  const profileId = {
    "project-skeleton": "bootstrap",
    "core-selling-point": "story-shaping",
    "golden-three": "story-shaping",
    "plotline-plan": "story-shaping",
    "chapter-contract": "chapter-build",
    "scene-sequence": "chapter-build",
    "chapter-draft": "chapter-draft",
    "character-card": "character-focus",
    "payoff-audit": "review-focus",
    "anti-ai-audit": "review-focus",
    "foreshadow-check": "continuity-focus",
    "timeline-check": "continuity-focus"
  }[action.id] || "balanced";
  const label = {
    bootstrap: "项目骨架优先",
    "story-shaping": "剧情主线优先",
    "chapter-build": "章节施工图优先",
    "chapter-draft": "正文素材优先",
    "character-focus": "角色资料优先",
    "review-focus": "审稿对照优先",
    "continuity-focus": "连续性资料优先",
    balanced: "均衡压缩"
  }[profileId] || "均衡压缩";
  return { id: profileId, label };
}

function keywordWeight(repoPath, rules = []) {
  return rules.reduce((score, [keyword, weight]) => (repoPath.includes(keyword) ? score + weight : score), 0);
}

function contextPriorityScore(profileId, item, index) {
  const repoPath = item.path || "";
  const base = Math.max(1, 10 - index);
  const companyBoost = repoPath.startsWith("company/") ? 1 : 0;
  const bookBoost = repoPath.startsWith("books/") ? 2 : 0;

  const profileBoost = {
    bootstrap: keywordWeight(repoPath, [
      ["模板", 8],
      ["公司标准", 6],
      ["共享方法", 5],
      ["共享研究", 4]
    ]),
    "story-shaping": keywordWeight(repoPath, [
      ["/剧情/", 10],
      ["/圣经/", 9],
      ["/伏笔/", 8],
      ["/世界/", 7],
      ["/时间/", 5],
      ["情绪原则", 5],
      ["写作规则", 4]
    ]),
    "chapter-build": keywordWeight(repoPath, [
      ["/合同/", 11],
      ["/剧情/", 8],
      ["/角色/", 7],
      ["/世界/", 6],
      ["章节合同模板", 6],
      ["能力库", 4]
    ]),
    "chapter-draft": keywordWeight(repoPath, [
      ["/合同/", 12],
      ["/正文/", 10],
      ["/角色/", 8],
      ["/世界/", 8],
      ["反AI风格规则", 6],
      ["可读网文语感", 6],
      ["写作规则", 4]
    ]),
    "character-focus": keywordWeight(repoPath, [
      ["/角色/", 12],
      ["/圣经/", 8],
      ["/剧情/", 6],
      ["角色模板", 6],
      ["写作规则", 4]
    ]),
    "review-focus": keywordWeight(repoPath, [
      ["/正文/", 12],
      ["/合同/", 10],
      ["/审稿/", 7],
      ["评估规则", 6],
      ["情绪原则", 6],
      ["爽点", 5],
      ["反AI", 5]
    ]),
    "continuity-focus": keywordWeight(repoPath, [
      ["/时间/", 12],
      ["/伏笔/", 12],
      ["/正文/", 9],
      ["/剧情/", 7],
      ["/角色/", 5],
      ["写作规则", 4]
    ]),
    balanced: keywordWeight(repoPath, [
      ["/圣经/", 6],
      ["/剧情/", 6],
      ["/角色/", 6],
      ["写作规则", 4],
      ["情绪原则", 4]
    ])
  }[profileId] || 0;

  return Math.max(1, base + companyBoost + bookBoost + profileBoost);
}

function allocateContextBudget(availableItems, totalBudget, profile) {
  if (!availableItems.length) return [];
  const weights = availableItems.map((item, index) => contextPriorityScore(profile.id, item, index));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0);
  return availableItems.map((item, index) => ({
    path: item.path,
    budget: Math.max(180, Math.floor((weights[index] / weightTotal) * totalBudget)),
    priority: weights[index]
  }));
}

function preparePromptContext(action, context, input, targetPlan) {
  const budget = buildPromptBudget(action, input, targetPlan);
  const profile = resolveCompressionProfile(action);
  const availableItems = context.filter((item) => item.available);
  const originalAvailableContextTokens = availableItems.reduce((sum, item) => sum + (item.fullTokens || 0), 0);
  const compressionThresholdTokens = Math.floor(budget.availableContextTokens * 0.8);
  const compressionActive = originalAvailableContextTokens >= compressionThresholdTokens;
  const allocations = compressionActive
    ? new Map(allocateContextBudget(availableItems, budget.availableContextTokens, profile).map((item) => [item.path, item]))
    : new Map();

  const preparedFiles = context.map((item) => {
    if (!item.available) {
      return {
        ...item,
        selectedText: "",
        selectedTokens: 0,
        compressionLevel: "missing",
        compressionNote: "路径缺失，模型会按缺资料处理。",
        allocatedBudget: 0,
        priorityScore: 0
      };
    }
    if (!compressionActive) {
      return {
        ...item,
        selectedText: normalizeWorkspaceLanguage(item.rawContent || ""),
        selectedTokens: item.fullTokens || estimateTokenCount(item.rawContent || ""),
        compressionLevel: "full",
        compressionNote: `当前上下文约 ${originalAvailableContextTokens} tokens，未达到压缩阈值 ${compressionThresholdTokens} tokens，保留全文。`,
        allocatedBudget: item.fullTokens || 0,
        priorityScore: 0
      };
    }
    const allocation = allocations.get(item.path);
    const tokenBudget = allocation?.budget || 180;
    const compressed = structuredExcerpt(item.path, item.rawContent, tokenBudget);
    return {
      ...item,
      selectedText: compressed.selectedText,
      selectedTokens: compressed.selectedTokens,
      compressionLevel: compressed.compressionLevel,
      compressionNote: compressed.note,
      allocatedBudget: tokenBudget,
      priorityScore: allocation?.priority || 0
    };
  });

  const originalContextTokens = preparedFiles.reduce((sum, item) => sum + (item.fullTokens || 0), 0);
  const selectedContextTokens = preparedFiles.reduce((sum, item) => sum + (item.selectedTokens || 0), 0);
  const compressedFiles = preparedFiles.filter((item) => item.available && item.compressionLevel === "compressed").length;
  const promptContext = preparedFiles
    .filter((item) => item.available && item.selectedText)
    .map((item) => `--- ${item.path} (${item.compressionLevel}, ${item.selectedTokens} tokens) ---\n${item.selectedText}`)
    .join("\n\n");
  const preview = [
    `动作：${action.label}`,
    `范围：${targetPlan.targets?.length ? targetPlan.targets.map((item) => item.path).join("、") : "未设置目标文件"}`,
    `流程：Observe → Plan → Draft → Review`,
    `上下文预算：${selectedContextTokens}/${budget.availableContextTokens} tokens`
  ].join("\n");

  return {
    budget: {
      ...budget,
      originalContextTokens,
      selectedContextTokens,
      compressedFiles,
      fileCount: preparedFiles.length,
      profileId: profile.id,
      profileLabel: profile.label,
      compressionActive,
      compressionThresholdTokens
    },
    preparedFiles,
    promptContext,
    preview: `${preview}\n压缩策略：${compressionActive ? profile.label : "未触发压缩，保留全文"}`
  };
}

function parseStructuredModelOutput(text) {
  const cleaned = String(text || "")
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const worklog = Array.isArray(parsed.public_worklog)
      ? parsed.public_worklog
        .map((item) => ({
          phase: publicTracePhases.has(item.phase) ? item.phase : "Review",
          summary: String(item.summary || item.message || "").trim(),
          bullets: Array.isArray(item.bullets) ? item.bullets.map((bullet) => String(bullet)) : []
        }))
        .filter((item) => item.summary)
      : [];
    const finalOutput = normalizeWorkspaceLanguage(parsed.final_output || parsed.output || "");
    if (finalOutput) {
      return { worklog, finalOutput };
    }
  } catch {}
  const looseWorklog = extractJsonArrayValue(cleaned, "public_worklog");
  const looseFinalOutput = extractJsonStringValue(cleaned, "final_output");
  if (looseWorklog || looseFinalOutput) {
    let worklog = [];
    try {
      const parsedWorklog = JSON.parse(looseWorklog || "[]");
      worklog = Array.isArray(parsedWorklog)
        ? parsedWorklog
          .map((item) => ({
            phase: publicTracePhases.has(item.phase) ? item.phase : "Review",
            summary: String(item.summary || item.message || "").trim(),
            bullets: Array.isArray(item.bullets) ? item.bullets.map((bullet) => String(bullet)) : []
          }))
          .filter((item) => item.summary)
        : [];
    } catch {
      worklog = extractLooseWorklogItems(looseWorklog);
    }
    const finalOutput = normalizeWorkspaceLanguage(decodeLooseJsonString(looseFinalOutput || extractTrailingJsonStringValue(cleaned, "final_output")));
    if (finalOutput) {
      return { worklog, finalOutput };
    }
  }
  const emergencyFinalOutput = extractTrailingJsonStringValueBroad(cleaned, "final_output");
  if (emergencyFinalOutput) {
    return {
      worklog: extractLooseWorklogItems(looseWorklog || cleaned),
      finalOutput: normalizeWorkspaceLanguage(decodeLooseJsonString(emergencyFinalOutput))
    };
  }
  const coarseFinalOutput = extractCoarseFinalOutput(cleaned, "final_output");
  if (coarseFinalOutput) {
    return {
      worklog: extractLooseWorklogItems(looseWorklog || cleaned),
      finalOutput: normalizeWorkspaceLanguage(decodeLooseJsonString(coarseFinalOutput))
    };
  }
  return {
    worklog: [],
    finalOutput: normalizeWorkspaceLanguage(text)
  };
}

function decodeLooseJsonString(value) {
  return String(value || "")
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, code) => String.fromCharCode(Number.parseInt(code, 16)))
    .replace(/\\"/g, "\"")
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");
}

function extractJsonArrayValue(text, key) {
  const keyIndex = String(text || "").indexOf(`"${key}"`);
  if (keyIndex < 0) return "";
  const colonIndex = text.indexOf(":", keyIndex);
  const arrayStart = text.indexOf("[", colonIndex);
  if (arrayStart < 0) return "";
  const arrayEnd = findMatchingBracket(text, arrayStart, "[", "]");
  if (arrayEnd < 0) return "";
  return text.slice(arrayStart, arrayEnd + 1);
}

function extractJsonStringValue(text, key) {
  const keyIndex = String(text || "").indexOf(`"${key}"`);
  if (keyIndex < 0) return "";
  const colonIndex = text.indexOf(":", keyIndex);
  const quoteStart = text.indexOf("\"", colonIndex);
  if (quoteStart < 0) return "";
  let escaped = false;
  for (let index = quoteStart + 1; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === "\"") {
      return text.slice(quoteStart + 1, index);
    }
  }
  return "";
}

function extractTrailingJsonStringValue(text, key) {
  const source = String(text || "");
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex < 0) return "";
  const colonIndex = source.indexOf(":", keyIndex);
  const quoteStart = source.indexOf("\"", colonIndex);
  if (quoteStart < 0) return "";
  const closingMatch = source.match(/"\s*}\s*$/);
  if (!closingMatch || closingMatch.index == null || closingMatch.index <= quoteStart) return "";
  return source.slice(quoteStart + 1, closingMatch.index);
}

function extractLooseWorklogItems(rawWorklog) {
  const source = String(rawWorklog || "");
  const items = [];
  const phaseRegex = /"phase"\s*:\s*"([^"]+)"[\s\S]*?"summary"\s*:\s*"([\s\S]*?)"[\s\S]*?"bullets"\s*:\s*\[([\s\S]*?)\]/g;
  for (const match of source.matchAll(phaseRegex)) {
    const phase = publicTracePhases.has(match[1]) ? match[1] : "Review";
    const summary = decodeLooseJsonString(match[2]).trim();
    const bullets = [...match[3].matchAll(/"([\s\S]*?)"/g)].map((item) => decodeLooseJsonString(item[1]).trim()).filter(Boolean);
    if (!summary) continue;
    items.push({ phase, summary, bullets });
  }
  return items;
}

function extractTrailingJsonStringValueBroad(text, key) {
  const source = String(text || "");
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex < 0) return "";
  const colonIndex = source.indexOf(":", keyIndex);
  const quoteStart = source.indexOf("\"", colonIndex);
  const closingBrace = source.lastIndexOf("}");
  const quoteEnd = source.lastIndexOf("\"", closingBrace);
  if (quoteStart < 0 || quoteEnd <= quoteStart) return "";
  return source.slice(quoteStart + 1, quoteEnd);
}

function extractCoarseFinalOutput(text, key) {
  const source = String(text || "");
  const keyIndex = source.indexOf(`"${key}"`);
  if (keyIndex < 0) return "";
  const colonIndex = source.indexOf(":", keyIndex);
  if (colonIndex < 0) return "";
  let value = source.slice(colonIndex + 1).trim();
  if (value.startsWith("\"")) value = value.slice(1);
  value = value.replace(/"\s*}\s*$/s, "");
  value = value.replace(/}\s*$/s, "");
  return value.trim();
}

function findMatchingBracket(text, startIndex, openChar, closeChar) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = startIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === openChar) {
      depth += 1;
      continue;
    }
    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function parsePublicPhaseText(text) {
  const cleaned = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try {
    const parsed = JSON.parse(cleaned);
    const summary = String(parsed.summary || parsed.message || parsed.public_summary || "").trim();
    const bullets = Array.isArray(parsed.bullets)
      ? parsed.bullets.map((item) => String(item).trim()).filter(Boolean)
      : [];
    if (summary || bullets.length) {
      return {
        summary: summary || bullets[0] || "已生成公开摘要。",
        bullets
      };
    }
  } catch {}
  const lines = String(text || "")
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines.filter((line) => /^[-*]\s/.test(line)).map((line) => line.replace(/^[-*]\s*/, "").trim());
  const summary = lines.find((line) => !/^[-*]\s/.test(line)) || bullets[0] || "已生成公开摘要。";
  return { summary, bullets };
}

function stripGenerationMarkers(text) {
  return String(text || "")
    .replace(/\n?\[\[(?:TO_BE_CONTINUED|COMPLETE)\]\]\s*$/g, "")
    .trimEnd();
}

function generationMarker(text) {
  const source = String(text || "");
  if (/\[\[COMPLETE\]\]\s*$/m.test(source)) return "complete";
  if (/\[\[TO_BE_CONTINUED\]\]\s*$/m.test(source)) return "continue";
  return "";
}

function buildTaskContextBlock(action, input, targetPlan, promptPack) {
  return [
    `当前任务：${action.label}`,
    `阶段：${action.stage}`,
    `用户输入：${JSON.stringify(input || {}, null, 2)}`,
    `目标文件：${(targetPlan.targets || []).map((item) => item.path).join(" | ") || "未设置目标文件"}`,
    `模型总窗口约 ${promptPack.budget.maxContextWindowTokens} tokens；本次输入上限约 ${promptPack.budget.maxInputTokens} tokens；当前上下文预算约 ${promptPack.budget.availableContextTokens} tokens；当前单次输出上限约 ${promptPack.budget.maxOutputTokens} tokens。`,
    "固定上下文：",
    promptPack.promptContext || "无可用固定上下文。",
    "当前产品术语已经取消候选区、工作区和正式区的对立说法。请使用“当前文件”“目标文件”“确认写入”等表述。"
  ].join("\n\n");
}

function buildObservePrompt(action, input, targetPlan, promptPack) {
  return [
    "你是 ProjectGod 写作工作台的公开观察助手。",
    buildTaskContextBlock(action, input, targetPlan, promptPack),
    "请只输出可公开展示的观察结果，不要写隐藏思维链。",
    "输出格式固定为：第一行一句总结，后面 3 条以内以 - 开头的观察。",
    "观察重点只允许覆盖：当前任务范围、最关键约束、最需要保留的资料。"
  ].join("\n\n");
}

function buildPlanPrompt(action, input, targetPlan, promptPack, observeText) {
  return [
    "你是 ProjectGod 写作工作台的公开计划助手。",
    buildTaskContextBlock(action, input, targetPlan, promptPack),
    `前一步公开观察：\n${observeText}`,
    "请只输出可公开展示的执行计划，不要写隐藏思维链。",
    "输出格式固定为：第一行一句总结，后面 4 条以内以 - 开头的计划。",
    "计划必须包含：先生成什么、怎么控制长度、如何判断是否需要续写、写完后如何自检。"
  ].join("\n\n");
}

function actionSpecificDraftRules(action, input = {}, targetPlan) {
  if (action.id === "character-card") {
    return [
      `本次角色：${input.characterName || "未指定"}；角色类型：${input.roleType || "未指定"}；任务类型：${input.changeIntent || "未指定"}。`,
      `你必须输出完整的目标文件 ${targetPlan.targets?.[0]?.path || "角色总表"}，而不是输出单个角色散文件。`,
      "如果目标文件已有其他角色条目，除非用户明确要求删除，否则必须保留并在原有基础上补写或修订。",
      "输出至少包含：文件标题、角色索引、对应角色分区中的目标角色完整档案、关系网络或关系补充、当前正式状态。",
      "角色档案要突出身份标签、核心欲望、核心恐惧、关键记忆点、关键关系、出场阶段和禁区，不要只给空泛人物小传。"
    ];
  }
  if (action.id === "plotline-plan") {
    return [
      `本次篇章：${input.arcName || "未指定"}；章节范围：${input.chapterRange || "未指定"}；规划重点：${input.planningFocus || "未指定"}。`,
      `你必须输出完整的目标文件 ${targetPlan.targets?.[0]?.path || "剧情总纲"}，而不是输出独立临时卷纲。`,
      "请沿用总档案思路，至少覆盖：一句话主线、篇章目标、主要事件、爽点安排、章节推进或下一阶段钩子。",
      "如果目标文件已有其他篇章内容，除非用户明确要求删除，否则必须保留并在原有结构中新增或修订对应篇章。"
    ];
  }
  return [];
}

function buildTargetOutputFormatRules(targetPlan) {
  const targets = targetPlan.targets || [];
  if (targets.length <= 1) {
    return [
      "本次只有 1 个目标文件，请直接输出该文件的完整正文，不要输出文件包装标记。"
    ];
  }
  return [
    "本次有多个目标文件，你必须按下面的精确格式依次输出每个文件的完整正文：",
    "<<<FILE:repo/path>>>",
    "这里写该文件的完整正文",
    "<<<END_FILE>>>",
    "要求：",
    `- 必须覆盖全部 ${targets.length} 个目标文件，且顺序与下面一致：${targets.map((target) => target.path).join(" | ")}`,
    "- FILE 标记里的 repo/path 必须与目标文件路径完全一致。",
    "- 每个文件都要输出完整正文，不能只输出差异说明。"
  ];
}

function buildDraftPrompt(action, input, targetPlan, promptPack, observeText, planText) {
  return [
    "你是 ProjectGod 写作工作台的正文生成器。",
    buildTaskContextBlock(action, input, targetPlan, promptPack),
    `公开观察：\n${observeText}`,
    `公开计划：\n${planText}`,
    ...actionSpecificDraftRules(action, input, targetPlan),
    ...buildTargetOutputFormatRules(targetPlan),
    "现在只生成目标文件正文，不要输出 JSON，不要输出解释，不要输出代码围栏。",
    "请尽量一次写完整；如果本次输出即将触达长度上限但正文还没完成，必须在自然段落或小节结束后另起一行输出 [[TO_BE_CONTINUED]]。",
    "如果正文已经完整结束，必须在末尾另起一行输出 [[COMPLETE]]。",
    "绝对不要在正文之外输出任何说明句。"
  ].join("\n\n");
}

function buildGeneratedOutputDigest(output) {
  const cleanOutput = stripGenerationMarkers(output);
  const normalized = cleanOutput.replace(/\r/g, "");
  const nonEmptyLines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const headings = nonEmptyLines
    .filter((line) => /^#{1,6}\s/.test(line) || /^[第0-9一二三四五六七八九十]+[章节幕卷篇部节回、.．)\]]/.test(line))
    .slice(0, continuationPolicy.maxHeadingCount);
  const tail = normalized.slice(-continuationPolicy.tailChars);
  const digest = normalized.length > continuationPolicy.digestChars
    ? `${normalized.slice(0, Math.floor(continuationPolicy.digestChars * 0.35))}\n...\n${tail}`
    : normalized;
  return {
    charCount: normalized.length,
    tokenEstimate: estimateTokenCount(normalized),
    headings,
    tail,
    digest,
    recentLines: nonEmptyLines.slice(-6)
  };
}

function renderGeneratedOutputDigest(digest) {
  return [
    `当前累计长度：约 ${digest.tokenEstimate} tokens / ${digest.charCount} 字符`,
    digest.headings.length ? `已生成结构：${digest.headings.join(" | ")}` : "已生成结构：暂未识别到显式标题结构",
    `正文摘要：\n${digest.digest || "（暂无正文）"}`,
    `正文末尾：\n${digest.tail || "（暂无正文末尾）"}`
  ].join("\n\n");
}

function splitOutputSections(output, limit = 10) {
  const cleanOutput = stripGenerationMarkers(output).replace(/\r/g, "").trim();
  if (!cleanOutput) return [];
  const matches = [...cleanOutput.matchAll(/^(#{1,6}\s+.+)$/gm)];
  if (!matches.length) {
    return [{
      id: "section_1",
      title: "正文片段",
      excerpt: clipText(cleanOutput, 260),
      chars: cleanOutput.length,
      tokens: estimateTokenCount(cleanOutput)
    }];
  }
  return matches.slice(0, limit).map((match, index) => {
    const start = match.index ?? 0;
    const end = index + 1 < matches.length ? (matches[index + 1].index ?? cleanOutput.length) : cleanOutput.length;
    const chunk = cleanOutput.slice(start, end).trim();
    return {
      id: `section_${index + 1}`,
      title: match[1].replace(/^#{1,6}\s+/, "").trim() || `片段 ${index + 1}`,
      excerpt: clipText(chunk, 260),
      chars: chunk.length,
      tokens: estimateTokenCount(chunk)
    };
  });
}

function buildResumeState({ action, targetPlan, accumulatedOutput, observeText, planText, review, passIndex }) {
  return {
    actionId: action.id,
    targetPaths: (targetPlan.targets || []).map((item) => item.path),
    accumulatedOutput: stripGenerationMarkers(accumulatedOutput),
    observeText: String(observeText || ""),
    planText: String(planText || ""),
    passIndex,
    reviewSummary: review?.publicSummary || "",
    continuationHint: review?.continuationHint || "",
    sectionCount: splitOutputSections(accumulatedOutput).length,
    tokenEstimate: estimateTokenCount(accumulatedOutput)
  };
}

function buildContinuationPrompt(action, input, targetPlan, promptPack, observeText, planText, currentOutput, passIndex, reviewSummary) {
  const digest = buildGeneratedOutputDigest(currentOutput);
  return [
    {
      role: "user",
      content: [
        {
          type: "text",
          text: buildDraftPrompt(action, input, targetPlan, promptPack, observeText, planText)
        }
      ]
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: digest.tail || "（上一段正文为空）"
        }
      ]
    },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: [
            `这是第 ${passIndex + 1} 次续写。请严格从现有正文最后一句之后继续，不要重复前文，不要重写标题。`,
            renderGeneratedOutputDigest(digest),
            reviewSummary ? `上一轮自检结论：${reviewSummary}` : "",
            "如果续写后仍未完成，继续在末尾单独输出 [[TO_BE_CONTINUED]]；如果已经完整结束，单独输出 [[COMPLETE]]。"
          ].filter(Boolean).join("\n\n")
        }
      ]
    }
  ];
}

function buildReviewPrompt(action, input, targetPlan, promptPack, output, passIndex, marker, stopReason, heuristic) {
  const digest = buildGeneratedOutputDigest(output);
  return [
    "你是 ProjectGod 写作工作台的结果自检器。",
    buildTaskContextBlock(action, input, targetPlan, promptPack),
    `下面是当前第 ${passIndex + 1} 次生成后的正文状态：`,
    renderGeneratedOutputDigest(digest),
    `结束标记：${marker || "无"}`,
    `模型停止原因：${stopReason || "未知"}`,
    heuristic?.issues?.length ? `本地规则提示：${heuristic.issues.join("；")}` : "",
    "请基于当前结果做真实判断，重点检查：是否明显被截断、是否有残缺句、是否已经自然收束、是否满足目标文件任务。",
    "返回严格 JSON：",
    "{\"is_complete\":true,\"needs_continuation\":false,\"issues\":[\"最多3条\"],\"public_summary\":\"一句公开结论\",\"continuation_hint\":\"若需续写，说明缺什么\"}",
    "如果看到断句、半截列表、未收束小节、或明显还没写完，就把 needs_continuation 设为 true。"
  ].filter(Boolean).join("\n\n");
}

function parseReviewResult(text) {
  try {
    const review = JSON.parse(String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, ""));
    return {
      isComplete: Boolean(review.is_complete),
      needsContinuation: Boolean(review.needs_continuation),
      issues: Array.isArray(review.issues) ? review.issues.map((item) => String(item)) : [],
      publicSummary: String(review.public_summary || "").trim() || "已完成结果自检。",
      continuationHint: String(review.continuation_hint || "").trim()
    };
  } catch {
    return {
      isComplete: false,
      needsContinuation: true,
      issues: ["自检结果解析失败，需按保守策略复核。"],
      publicSummary: "自检结果解析失败，按保守策略继续判断。",
      continuationHint: ""
    };
  }
}

function evaluateOutputCompleteness({ action, targetPlan, output, marker, stopReason }) {
  const cleanOutput = stripGenerationMarkers(output).trimEnd();
  const profile = completenessProfileForAction(action);
  const sections = splitOutputSections(cleanOutput);
  const issues = [];
  const weakSignals = [];
  const ending = cleanOutput.slice(-80);
  const lastLine = cleanOutput.split("\n").map((line) => line.trim()).filter(Boolean).pop() || "";

  if (!cleanOutput) {
    issues.push("当前还没有生成出正文内容。");
  }
  if (marker === "continue") {
    issues.push("模型主动声明本轮未完成。");
  }
  if (stopReason === "max_tokens") {
    issues.push("模型触达单次输出上限，存在被截断风险。");
  }
  if (profile.naturalEndingRequired && /[（([{“"《<：:、，,-]$/.test(cleanOutput)) {
    issues.push("正文结尾停在未收束的位置。");
  }
  if (lastLine && /^(?:[-*+]|\d+[.)、．])/.test(lastLine) && !/[。！？.!?]$/.test(lastLine)) {
    issues.push("结尾像是半截条目，尚未自然收束。");
  }
  if (profile.naturalEndingRequired && cleanOutput && !/[。！？.!?】》」』）)]$/.test(cleanOutput)) {
    weakSignals.push("正文末尾没有明显收束标点。");
  }
  if (ending && /(?:如果|然后|但是|并且|于是|同时|接着|因为|直到|随后)\s*$/.test(ending)) {
    weakSignals.push("结尾停在连接词附近，像是后文未完。");
  }
  if (cleanOutput.length < profile.minChars) {
    weakSignals.push(`当前长度偏短，尚未达到 ${profile.minChars} 字符的参考下限。`);
  }
  if (sections.length < profile.minSections) {
    weakSignals.push(`当前只识别到 ${sections.length} 个结构片段，低于参考值 ${profile.minSections}。`);
  }
  if (targetPlan?.targets?.some((item) => item.label?.includes("章节草稿")) && cleanOutput.length < 1800) {
    weakSignals.push("章节草稿长度偏短，可能还没展开完整场景。");
  }

  const strongIncomplete = issues.length > 0;
  const weakIncomplete = weakSignals.length >= 2 && marker !== "complete" && stopReason !== "message_stop";
  const needsContinuation = strongIncomplete || weakIncomplete;
  const summary = needsContinuation
    ? "本地规则判断正文还没有完整收束。"
    : "本地规则判断正文已经基本完整。";

  return {
    isComplete: !needsContinuation,
    needsContinuation,
    issues: [...issues, ...weakSignals].slice(0, 4),
    publicSummary: summary,
    continuationHint: needsContinuation ? "请从当前末尾继续，把未收束的小节写完并补到自然结束。" : "",
    metrics: {
      sectionCount: sections.length,
      charCount: cleanOutput.length,
      minChars: profile.minChars,
      minSections: profile.minSections
    }
  };
}

function mergeReviewResults(modelReview, heuristicReview) {
  const issues = [...new Set([...(heuristicReview?.issues || []), ...(modelReview?.issues || [])])].slice(0, 5);
  const needsContinuation = Boolean(
    heuristicReview?.needsContinuation
    || modelReview?.needsContinuation
    || (!modelReview?.isComplete && heuristicReview?.isComplete !== true)
  );
  const isComplete = !needsContinuation;
  const publicSummary = needsContinuation
    ? heuristicReview?.publicSummary || modelReview?.publicSummary || "自检判断正文尚未完成。"
    : modelReview?.publicSummary || heuristicReview?.publicSummary || "自检判断正文已经完成。";
  return {
    isComplete,
    needsContinuation,
    issues,
    publicSummary,
    continuationHint: heuristicReview?.continuationHint || modelReview?.continuationHint || ""
  };
}

function completenessProfileForAction(action) {
  return {
    "core-selling-point": {
      minChars: 500,
      minSections: 4,
      naturalEndingRequired: true
    },
    "golden-three": {
      minChars: 1000,
      minSections: 4,
      naturalEndingRequired: true
    },
    "plotline-plan": {
      minChars: 1800,
      minSections: 6,
      naturalEndingRequired: true
    },
    "character-card": {
      minChars: 800,
      minSections: 4,
      naturalEndingRequired: true
    },
    "chapter-contract": {
      minChars: 1400,
      minSections: 5,
      naturalEndingRequired: true
    },
    "scene-sequence": {
      minChars: 1200,
      minSections: 4,
      naturalEndingRequired: true
    },
    "chapter-draft": {
      minChars: 2500,
      minSections: 3,
      naturalEndingRequired: true
    },
    "payoff-audit": {
      minChars: 700,
      minSections: 4,
      naturalEndingRequired: true
    },
    "anti-ai-audit": {
      minChars: 700,
      minSections: 4,
      naturalEndingRequired: true
    },
    "foreshadow-check": {
      minChars: 700,
      minSections: 4,
      naturalEndingRequired: true
    },
    "timeline-check": {
      minChars: 700,
      minSections: 4,
      naturalEndingRequired: true
    }
  }[action.id] || {
    minChars: 800,
    minSections: 3,
    naturalEndingRequired: true
  };
}

async function requestModelJson({ endpoint, token, body, signal }) {
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
  return data;
}

async function callModelText({ endpoint, token, messages, maxTokens, signal }) {
  const data = await requestModelJson({
    endpoint,
    token,
    signal,
    body: {
      model: anthropicConfig.model,
      max_tokens: maxTokens,
      messages
    }
  });
  return {
    text: normalizeWorkspaceLanguage(extractModelText(data)),
    stopReason: data.stop_reason || data?.message?.stop_reason || null
  };
}

async function streamModelText({ endpoint, token, messages, maxTokens, signal, onText }) {
  const response = await fetch(endpoint, {
    method: "POST",
    signal,
    headers: {
      "content-type": "application/json",
      "x-api-key": token,
      "anthropic-version": "2023-06-01",
      "authorization": `Bearer ${token}`
    },
    body: JSON.stringify({
      model: anthropicConfig.model,
      max_tokens: maxTokens,
      stream: true,
      messages
    })
  });
  if (!response.ok) {
    const raw = await response.text();
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      data = { message: raw };
    }
    const message = formatModelError(data, endpoint, response.status);
    registerModelFailure(message, endpoint, response.status);
    throw httpError(response.status, message);
  }
  modelHealth.lastError = null;
  modelHealth.lastFailureAt = null;
  modelHealth.retryAfterUntil = null;
  modelHealth.endpoint = redactEndpoint(endpoint);

  const reader = response.body?.getReader();
  if (!reader) throw httpError(502, "Model stream did not expose a readable body.");

  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let stopReason = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const rawEvent = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const parsed = parseSseFrame(rawEvent);
      if (parsed?.data === "[DONE]") {
        boundary = buffer.indexOf("\n\n");
        continue;
      }
      if (parsed?.data) {
        try {
          const json = JSON.parse(parsed.data);
          const eventType = json.type || parsed.event || "";
          const deltaText = extractStreamTextDelta(json);
          if (deltaText) {
            text += deltaText;
            onText?.(normalizeWorkspaceLanguage(deltaText), normalizeWorkspaceLanguage(text));
          }
          const nextStopReason = extractStreamStopReason(json, eventType);
          if (nextStopReason) stopReason = nextStopReason;
        } catch {}
      }
      boundary = buffer.indexOf("\n\n");
    }
  }

  return {
    text: normalizeWorkspaceLanguage(text),
    stopReason
  };
}

function parseSseFrame(frame) {
  const lines = String(frame || "").split("\n");
  let event = "";
  const data = [];
  for (const line of lines) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data.push(line.slice(5).trim());
  }
  return { event, data: data.join("\n") };
}

function extractStreamTextDelta(payload) {
  if (payload?.delta?.type === "text_delta" && payload.delta.text) return payload.delta.text;
  if (payload?.delta?.text) return payload.delta.text;
  if (payload?.content_block?.type === "text" && payload.content_block.text) return payload.content_block.text;
  if (Array.isArray(payload?.content)) {
    return payload.content.filter((item) => item?.type === "text" && item.text).map((item) => item.text).join("");
  }
  if (payload?.text) return payload.text;
  return "";
}

function extractStreamStopReason(payload, eventType) {
  if (payload?.delta?.stop_reason) return payload.delta.stop_reason;
  if (payload?.stop_reason) return payload.stop_reason;
  if (payload?.message?.stop_reason) return payload.message.stop_reason;
  if (eventType === "message_stop") return "message_stop";
  return null;
}

async function callModelIfConfigured({ action, context, input, targetPlan, signal, hooks = {}, resumeState = null }) {
  const promptPack = preparePromptContext(action, context, input, targetPlan);
  const baseUrl = anthropicConfig.baseUrl;
  const token = anthropicConfig.authToken;
  const model = anthropicConfig.model;
  if (!baseUrl || !token || !model) {
    return {
      usedModel: false,
      output: buildOfflineOutput(action, targetPlan, input),
      worklog: buildOfflineWorklog(action, targetPlan, input),
      budget: promptPack.budget,
      preparedContext: promptPack.preparedFiles,
      promptPreview: promptPack.preview,
      review: {
        isComplete: true,
        needsContinuation: false,
        issues: ["当前为离线兜底结果。"],
        publicSummary: "模型环境变量未配置，已返回离线结果骨架。",
        continuationHint: ""
      },
      checkpoints: [],
      outputSections: splitOutputSections(buildOfflineOutput(action, targetPlan, input)),
      resumeState: null
    };
  }
  const endpoint = resolveMessagesEndpoint(baseUrl);
  if (modelHealth.retryAfterUntil && Date.now() < modelHealth.retryAfterUntil) {
    return {
      usedModel: false,
      unavailable: true,
      error: modelHealth.lastError,
      output: buildOfflineOutput(action, targetPlan, input),
      worklog: buildOfflineWorklog(action, targetPlan, input),
      budget: promptPack.budget,
      preparedContext: promptPack.preparedFiles,
      promptPreview: promptPack.preview,
      review: {
        isComplete: true,
        needsContinuation: false,
        issues: [modelHealth.lastError || "模型暂不可用。"],
        publicSummary: `模型暂不可用：${modelHealth.lastError}`,
        continuationHint: ""
      },
      checkpoints: [],
      outputSections: splitOutputSections(buildOfflineOutput(action, targetPlan, input)),
      resumeState: null
    };
  }
  const resuming = Boolean(resumeState?.accumulatedOutput);
  hooks.onObserveStart?.({ resuming });
  const observeResponse = resuming && resumeState?.observeText
    ? { text: String(resumeState.observeText), stopReason: "resume_cache" }
    : await streamModelText({
      endpoint,
      token,
      signal,
      maxTokens: 420,
      messages: [{ role: "user", content: [{ type: "text", text: buildObservePrompt(action, input, targetPlan, promptPack) }] }],
      onText: (_chunk, fullText) => hooks.onObserveChunk?.(fullText, { resuming: false })
    });
  if (resuming && resumeState?.observeText) {
    hooks.onObserveChunk?.(String(resumeState.observeText), { resuming: true });
  }
  const observe = parsePublicPhaseText(observeResponse.text);
  hooks.onObserve?.(observe, observeResponse.text, { resuming });

  hooks.onPlanStart?.({ resuming });
  const planResponse = resuming && resumeState?.planText
    ? { text: String(resumeState.planText), stopReason: "resume_cache" }
    : await streamModelText({
      endpoint,
      token,
      signal,
      maxTokens: 520,
      messages: [{ role: "user", content: [{ type: "text", text: buildPlanPrompt(action, input, targetPlan, promptPack, observeResponse.text) }] }],
      onText: (_chunk, fullText) => hooks.onPlanChunk?.(fullText, { resuming: false })
    });
  if (resuming && resumeState?.planText) {
    hooks.onPlanChunk?.(String(resumeState.planText), { resuming: true });
  }
  const plan = parsePublicPhaseText(planResponse.text);
  hooks.onPlan?.(plan, planResponse.text, { resuming });

  let accumulatedOutput = stripGenerationMarkers(resumeState?.accumulatedOutput || "");
  let continuationCount = Math.max(0, Number(resumeState?.passIndex) || 0);
  let lastReview = null;
  const checkpoints = [];
  hooks.onDraftStart?.({
    maxTokens: promptPack.budget.maxOutputTokens,
    maxPasses: continuationPolicy.maxPasses,
    resuming,
    resumedPassIndex: continuationCount,
    resumedTokenEstimate: accumulatedOutput ? estimateTokenCount(accumulatedOutput) : 0
  });

  while (continuationCount < continuationPolicy.maxPasses) {
    const passIndex = continuationCount;
    const messages = !accumulatedOutput && passIndex === 0
      ? [{ role: "user", content: [{ type: "text", text: buildDraftPrompt(action, input, targetPlan, promptPack, observeResponse.text, planResponse.text) }] }]
      : buildContinuationPrompt(
        action,
        input,
        targetPlan,
        promptPack,
        observeResponse.text,
        planResponse.text,
        accumulatedOutput,
        passIndex,
        lastReview ? `${lastReview.publicSummary}${lastReview.continuationHint ? `；${lastReview.continuationHint}` : ""}` : ""
      );

    hooks.onDraftPassStart?.({
      passIndex,
      isContinuation: passIndex > 0 || Boolean(accumulatedOutput),
      resuming: resuming && passIndex === continuationCount,
      maxTokens: promptPack.budget.maxOutputTokens
    });
    const draftResponse = await streamModelText({
      endpoint,
      token,
      signal,
      maxTokens: promptPack.budget.maxOutputTokens,
      messages,
      onText: (chunk, fullText) => hooks.onDraftChunk?.(chunk, stripGenerationMarkers(accumulatedOutput + fullText), { passIndex })
    });
    const stopReason = draftResponse.stopReason || null;
    const segmentText = draftResponse.text;
    const marker = generationMarker(segmentText);
    const cleanSegment = stripGenerationMarkers(segmentText);
    accumulatedOutput = `${stripGenerationMarkers(accumulatedOutput)}${cleanSegment}`;
    const heuristicReview = evaluateOutputCompleteness({
      action,
      targetPlan,
      output: accumulatedOutput,
      marker,
      stopReason
    });

    const reviewResponse = await callModelText({
      endpoint,
      token,
      signal,
      maxTokens: 650,
      messages: [{
        role: "user",
        content: [{
          type: "text",
          text: buildReviewPrompt(
            action,
            input,
            targetPlan,
            promptPack,
            `${accumulatedOutput}\n${marker === "complete" ? "[[COMPLETE]]" : marker === "continue" ? "[[TO_BE_CONTINUED]]" : ""}`,
            passIndex,
            marker,
            stopReason,
            heuristicReview
          )
        }]
      }]
    });
    const modelReview = parseReviewResult(reviewResponse.text);
    const review = mergeReviewResults(modelReview, heuristicReview);
    const needsContinuation = passIndex + 1 < continuationPolicy.maxPasses
      && (marker === "continue"
        || stopReason === "max_tokens"
        || review.needsContinuation
        || !review.isComplete);
    const combinedReview = {
      ...review,
      passIndex,
      needsContinuation,
      marker,
      stopReason,
      modelReview,
      heuristicReview,
      generatedTokens: estimateTokenCount(accumulatedOutput),
      generatedChars: accumulatedOutput.length
    };
    const outputSections = splitOutputSections(accumulatedOutput);
    const checkpoint = {
      id: `pass_${passIndex + 1}`,
      label: passIndex === 0 && !resuming ? "首轮生成" : `第 ${passIndex + 1} 轮`,
      passIndex,
      isContinuation: passIndex > 0 || Boolean(resumeState?.accumulatedOutput),
      stopReason,
      marker: marker || "none",
      needsContinuation,
      generatedTokens: combinedReview.generatedTokens,
      generatedChars: combinedReview.generatedChars,
      sectionCount: outputSections.length,
      excerpt: clipText(cleanSegment || accumulatedOutput.slice(-320), 320),
      reviewSummary: combinedReview.publicSummary,
      continuationHint: combinedReview.continuationHint,
      sections: outputSections.slice(0, 8),
      resumeState: buildResumeState({
        action,
        targetPlan,
        accumulatedOutput,
        observeText: observeResponse.text,
        planText: planResponse.text,
        review: combinedReview,
        passIndex: passIndex + 1
      })
    };
    checkpoints.push(checkpoint);
    lastReview = combinedReview;
    hooks.onReview?.(combinedReview);
    hooks.onCheckpoint?.(checkpoint, checkpoints);
    if (!needsContinuation) {
      return {
        usedModel: true,
        output: stripGenerationMarkers(accumulatedOutput),
        observe,
        plan,
        review: combinedReview,
        continuationCount: passIndex,
        budget: promptPack.budget,
        preparedContext: promptPack.preparedFiles,
        promptPreview: promptPack.preview,
        checkpoints,
        outputSections,
        resumeState: checkpoint.resumeState
      };
    }
    continuationCount = passIndex + 1;
  }

  return {
    usedModel: true,
    output: stripGenerationMarkers(accumulatedOutput),
    observe,
    plan,
    review: {
      ...(lastReview || {}),
      isComplete: false,
      needsContinuation: false,
      issues: [...new Set([...(lastReview?.issues || []), "已达到最大续写轮次，结果可能仍不完整。"])].slice(0, 5),
      publicSummary: "已达到最大续写轮次，建议检查结果是否还需继续。",
      continuationHint: "考虑进一步拆分目标文件或降低单次范围。"
    },
    continuationCount,
    budget: promptPack.budget,
    preparedContext: promptPack.preparedFiles,
    promptPreview: promptPack.preview,
    checkpoints,
    outputSections: splitOutputSections(accumulatedOutput),
    resumeState: checkpoints.at(-1)?.resumeState || buildResumeState({
      action,
      targetPlan,
      accumulatedOutput,
      observeText: observeResponse.text,
      planText: planResponse.text,
      review: lastReview,
      passIndex: continuationCount
    })
  };
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

function targetStatusMeta(existsNow) {
  return existsNow
    ? { changeType: "overwrite", statusLabel: "将覆盖现有文件" }
    : { changeType: "create", statusLabel: "将创建新文件" };
}

async function readTargetStatuses(targets = []) {
  return Promise.all(targets.map(async (target) => {
    const absPath = safeJoinRepo(target.path);
    const existsNow = await exists(absPath);
    return {
      path: target.path,
      label: target.label,
      exists: existsNow,
      ...targetStatusMeta(existsNow)
    };
  }));
}

function parseArtifactBlocks(output) {
  const cleanOutput = stripGenerationMarkers(output).replace(/\r/g, "");
  const regex = /<<<FILE:([^\n>]+)>>>\n?([\s\S]*?)<<<END_FILE>>>/g;
  const artifacts = [];
  let match = regex.exec(cleanOutput);
  while (match) {
    artifacts.push({
      path: String(match[1] || "").trim(),
      content: String(match[2] || "").replace(/^\n+/, "").trimEnd()
    });
    match = regex.exec(cleanOutput);
  }
  return artifacts;
}

function buildArtifactsFromResult(targetPlan, output) {
  if (targetPlan.mode === "project-bootstrap") {
    return targetPlan.artifacts || [];
  }
  const targets = targetPlan.targets || [];
  if (!targets.length) return [];
  const parsedArtifacts = parseArtifactBlocks(output);
  if (parsedArtifacts.length) {
    const allowedPaths = new Set(targets.map((target) => target.path));
    const filtered = parsedArtifacts.filter((artifact) => allowedPaths.has(artifact.path));
    if (filtered.length) return filtered;
  }
  if (targets.length === 1) {
    return [{ path: targets[0].path, content: stripGenerationMarkers(output) }];
  }
  return targets.map((target) => ({
    path: target.path,
    content: `# ${target.label || "目标文件"}\n\n生成结果未按多文件协议返回，请重新执行。`
  }));
}

function buildPreludeEvents({ action, payload, context, missing, targetPlan, targetStatuses, workflow, preparedContext, budget, promptPreview }) {
  return [
    {
      phase: "Scope",
      message: `${action.skill} 已进入 ${payload.projectSlug ? "书层" : "公司层"} 执行范围。`,
      details: {
        note: payload.resumeState?.accumulatedOutput
          ? `当前项目：${payload.projectSlug || "公司层"}；本次将从已有恢复点继续。`
          : payload.projectSlug ? `当前项目：${payload.projectSlug}` : "当前为公司层执行。"
      }
    },
    {
      phase: "Context",
      message: `读取执行资料：${context.length} 个文件，缺失 ${missing.length} 个。`,
      details: {
        files: serializeContextForClient(preparedContext || context)
      }
    },
    {
      phase: "Budget",
      message: `上下文预算已计算：约 ${budget.selectedContextTokens}/${budget.availableContextTokens} tokens。`,
      details: {
        metrics: [
          { label: "模型总窗口", value: `${budget.maxContextWindowTokens} tok` },
          { label: "压缩策略", value: budget.profileLabel },
          { label: "压缩阈值", value: `${budget.compressionThresholdTokens || 0} tok` },
          { label: "输入上限", value: `${budget.maxInputTokens} tok` },
          { label: "输出上限", value: `${budget.maxOutputTokens} tok` },
          { label: "原始上下文", value: `${budget.originalContextTokens} tok` },
          { label: "压缩后上下文", value: `${budget.selectedContextTokens} tok` },
          { label: "压缩文件数", value: `${budget.compressedFiles}` }
        ],
        note: budget.compressionActive
          ? `${budget.tokenizerNote} 当前上下文已达到压缩阈值，使用“${budget.profileLabel}”策略分配预算。`
          : `${budget.tokenizerNote} 当前上下文未达到压缩阈值 ${budget.compressionThresholdTokens || 0} tok，保留全文。`
      }
    },
    {
      phase: "Workflow",
      message: `执行 ${action.stage} 阶段动作：${action.label}。`,
      details: {
        actionId: action.id,
        input: payload.input || {},
        plan: workflow,
        note: payload.resumeState?.accumulatedOutput
          ? `已检测到约 ${payload.resumeState.tokenEstimate || estimateTokenCount(payload.resumeState.accumulatedOutput || "")} tokens 的恢复点，会直接从中断位置继续。`
          : "本次将按标准流程完整执行。"
      }
    },
    {
      phase: "Prompt",
      message: "将按 Observe → Plan → Draft → Review 的公开执行轨迹生成结果。",
      details: {
        preview: promptPreview,
        note: "这里展示的是可公开工作流框架，不展示隐藏思维链。"
      }
    },
    {
      phase: "Write Plan",
      message: `已规划 ${targetPlan.targets?.length || 0} 个目标文件。`,
      details: {
        targets: targetStatuses || [],
        note: "确认前不落盘；确认后直接写入这些文件。"
      }
    }
  ];
}

function buildPublicTraceEvents(result = {}) {
  const events = [];
  if (result.observe?.summary) {
    events.push({
      phase: "Observe",
      message: result.observe.summary,
      details: result.observe.bullets?.length ? { items: result.observe.bullets } : undefined
    });
  }
  if (result.plan?.summary) {
    events.push({
      phase: "Plan",
      message: result.plan.summary,
      details: result.plan.bullets?.length ? { items: result.plan.bullets } : undefined
    });
  }
  if (result.review?.publicSummary) {
    events.push({
      phase: "Review",
      message: result.review.publicSummary,
      details: {
        metrics: [
          { label: "轮次", value: `第 ${(result.review.passIndex || 0) + 1} 轮` },
          { label: "累计长度", value: `${result.review.generatedTokens || estimateTokenCount(result.output || "")} tok` },
          { label: "停止原因", value: result.review.stopReason || "正常结束" },
          { label: "结束标记", value: result.review.marker || "无" },
          { label: "结构片段", value: `${result.review.heuristicReview?.metrics?.sectionCount || result.outputSections?.length || 0}` }
        ],
        items: result.review.issues?.length ? result.review.issues : [],
        note: result.review.continuationHint || `生成轮次：${(result.review.passIndex || 0) + 1}`
      }
    });
  }
  return events;
}

async function runAction(payload) {
  const { action, context, missing, targetPlan, workflow } = await resolveContextForPayload(payload.actionId, payload);
  const promptPack = preparePromptContext(action, context, payload.input || {}, targetPlan);
  const targetStatuses = await readTargetStatuses(targetPlan.targets || []);
  const runId = `run_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const events = buildPreludeEvents({
    action,
    payload,
    context,
    missing,
    targetPlan,
    targetStatuses,
    workflow,
    preparedContext: promptPack.preparedFiles,
    budget: promptPack.budget,
    promptPreview: promptPack.preview
  });
  let result;
  try {
    result = await callModelIfConfigured({
      action,
      context,
      input: payload.input || {},
      targetPlan
    });
    events.push(...buildPublicTraceEvents(result));
    events.push({ phase: "Output", message: result.output });
  } catch (error) {
    events.push({
      phase: "Review",
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
    context: serializeContextForClient(promptPack.preparedFiles),
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
    targets: targetStatuses,
    artifacts: buildArtifactsFromResult(targetPlan, result.output),
    checkpoints: result.checkpoints || [],
    outputSections: result.outputSections || splitOutputSections(result.output),
    resumeState: result.resumeState || null,
    resumeAvailable: Boolean(result.resumeState?.accumulatedOutput)
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
    controller: new AbortController(),
    nextEventId: 1,
    started: false,
    startPromise: null
  };
  runs.set(runId, record);
  return record;
}

function emitRunEvent(record, event) {
  const payload = {
    id: event.id || `evt_${record.nextEventId++}`,
    at: event.at || new Date().toISOString(),
    ...event
  };
  record.events.push(payload);
  for (const res of record.listeners) {
    res.write(`event: step\n`);
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }
  return payload;
}

function patchRunEvent(record, eventId, patch) {
  const index = record.events.findIndex((event) => event.id === eventId);
  if (index < 0) return null;
  const current = record.events[index];
  const next = {
    ...current,
    ...patch,
    details: patch.details ? { ...(current.details || {}), ...patch.details } : current.details
  };
  record.events[index] = next;
  for (const res of record.listeners) {
    res.write(`event: patch\n`);
    res.write(`data: ${JSON.stringify(next)}\n\n`);
  }
  return next;
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

function startRunRecord(record) {
  if (record.started) return record.startPromise;
  record.started = true;
  record.startPromise = executeRunRecord(record).catch((error) => {
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
  return record.startPromise;
}

async function executeRunRecord(record) {
  const payload = record.payload;
  const { action, context, missing, targetPlan, workflow } = await resolveContextForPayload(payload.actionId, payload);
  const promptPack = preparePromptContext(action, context, payload.input || {}, targetPlan);
  const targetStatuses = await readTargetStatuses(targetPlan.targets || []);
  const runtime = {
    latestOutput: stripGenerationMarkers(payload.resumeState?.accumulatedOutput || ""),
    checkpoints: [],
    outputSections: splitOutputSections(payload.resumeState?.accumulatedOutput || ""),
    resumeState: payload.resumeState || null
  };
  const currentResumeState = () => {
    if (runtime.resumeState?.accumulatedOutput) return runtime.resumeState;
    if (!runtime.latestOutput) return runtime.resumeState;
    return buildResumeState({
      action,
      targetPlan,
      accumulatedOutput: runtime.latestOutput,
      observeText: runtime.resumeState?.observeText,
      planText: runtime.resumeState?.planText,
      review: null,
      passIndex: runtime.checkpoints.length
    });
  };
  for (const event of buildPreludeEvents({
    action,
    payload,
    context,
    missing,
    targetPlan,
    targetStatuses,
    workflow,
    preparedContext: promptPack.preparedFiles,
    budget: promptPack.budget,
    promptPreview: promptPack.preview
  })) {
    emitRunEvent(record, event);
  }
  const canStreamPublicTrace = Boolean(anthropicConfig.baseUrl && anthropicConfig.authToken && anthropicConfig.model)
    && !(modelHealth.retryAfterUntil && Date.now() < modelHealth.retryAfterUntil);
  const observeEvent = canStreamPublicTrace
    ? emitRunEvent(record, {
      phase: "Observe",
      message: "公开观察阶段准备中。",
      details: {
        note: "将逐步回传当前任务范围、关键约束和需保留资料。"
      }
    })
    : null;
  const planEvent = canStreamPublicTrace
    ? emitRunEvent(record, {
      phase: "Plan",
      message: "执行计划阶段准备中。",
      details: {
        note: "将逐步回传公开执行计划和目标文件安排。"
      }
    })
    : null;
  const draftEvent = emitRunEvent(record, {
    phase: "Draft",
    message: "正文正在流式生成中。",
    details: {
      note: "模型正在流式生成正文。",
      generatedText: runtime.latestOutput,
      checkpoints: runtime.checkpoints,
      sections: runtime.outputSections
    }
  });

  try {
    const result = await callModelIfConfigured({
      action,
      context,
      input: payload.input || {},
      targetPlan,
      signal: record.controller.signal,
      resumeState: payload.resumeState || null,
      hooks: {
        onObserveStart: ({ resuming }) => {
          if (!observeEvent) return;
          patchRunEvent(record, observeEvent.id, {
            message: resuming ? "正在复用上一轮公开观察。" : "正在生成公开观察。",
            details: {
              note: resuming ? "已命中恢复点缓存，会直接回放上一轮观察结果。" : "公开观察会边生成边回传。"
            }
          });
        },
        onObserveChunk: (fullText, meta = {}) => {
          if (!observeEvent) return;
          patchRunEvent(record, observeEvent.id, {
            details: {
              streamedText: fullText,
              note: meta.resuming ? "正在回放恢复点中的公开观察。" : "公开观察正在流式回传。"
            }
          });
        },
        onObserve: (observe, observeText, meta = {}) => {
          runtime.resumeState = {
            ...(runtime.resumeState || {}),
            observeText
          };
          if (observeEvent) {
            patchRunEvent(record, observeEvent.id, {
              message: observe.summary,
              details: {
                ...(observe.bullets?.length ? { items: observe.bullets } : {}),
                streamedText: observeText,
                note: meta.resuming ? "本轮复用了上一次已生成的观察结果。" : "本轮重新生成了公开观察。"
              }
            });
            return;
          }
          emitRunEvent(record, {
            phase: "Observe",
            message: observe.summary,
            details: {
              ...(observe.bullets?.length ? { items: observe.bullets } : {}),
              streamedText: observeText,
              note: meta.resuming ? "本轮复用了上一次已生成的观察结果。" : "本轮重新生成了公开观察。"
            }
          });
        },
        onPlanStart: ({ resuming }) => {
          if (!planEvent) return;
          patchRunEvent(record, planEvent.id, {
            message: resuming ? "正在复用上一轮公开计划。" : "正在生成公开计划。",
            details: {
              note: resuming ? "已命中恢复点缓存，会直接回放上一轮计划结果。" : "公开计划会边生成边回传。"
            }
          });
        },
        onPlanChunk: (fullText, meta = {}) => {
          if (!planEvent) return;
          patchRunEvent(record, planEvent.id, {
            details: {
              streamedText: fullText,
              note: meta.resuming ? "正在回放恢复点中的公开计划。" : "公开计划正在流式回传。"
            }
          });
        },
        onPlan: (plan, planText, meta = {}) => {
          runtime.resumeState = {
            ...(runtime.resumeState || {}),
            planText
          };
          if (planEvent) {
            patchRunEvent(record, planEvent.id, {
              message: plan.summary,
              details: {
                ...(plan.bullets?.length ? { items: plan.bullets } : {}),
                streamedText: planText,
                note: meta.resuming ? "本轮复用了上一次已生成的执行计划。" : "本轮重新生成了公开计划。"
              }
            });
            return;
          }
          emitRunEvent(record, {
            phase: "Plan",
            message: plan.summary,
            details: {
              ...(plan.bullets?.length ? { items: plan.bullets } : {}),
              streamedText: planText,
              note: meta.resuming ? "本轮复用了上一次已生成的执行计划。" : "本轮重新生成了公开计划。"
            }
          });
        },
        onDraftStart: ({ maxTokens, maxPasses, resuming, resumedPassIndex, resumedTokenEstimate }) => {
          patchRunEvent(record, draftEvent.id, {
            message: "开始生成正文，下面内容会持续流入。",
            details: {
              note: resuming
                ? `本次从第 ${resumedPassIndex + 1} 轮附近继续，已恢复约 ${resumedTokenEstimate} tokens；单次输出上限约 ${maxTokens} tokens，最多自动续写 ${maxPasses - 1} 次。`
                : `单次输出上限约 ${maxTokens} tokens；最多自动续写 ${maxPasses - 1} 次。`
            }
          });
        },
        onDraftPassStart: ({ passIndex, isContinuation, resuming, maxTokens }) => {
          emitRunEvent(record, {
            phase: "Draft",
            message: resuming
              ? `从恢复点继续第 ${passIndex + 1} 轮生成。`
              : isContinuation ? `开始第 ${passIndex} 次续写。` : "开始首轮正文生成。",
            details: {
              note: resuming
                ? `系统已加载上一次中断前的正文尾部与结构摘要，本轮继续向后生成，单次上限约 ${maxTokens} tokens。`
                : isContinuation
                ? `本轮会延续上一轮末尾继续写，单次上限约 ${maxTokens} tokens。`
                : `正文会边生成边回传，单次上限约 ${maxTokens} tokens。`
            }
          });
        },
        onDraftChunk: (_chunk, fullText, meta = {}) => {
          runtime.latestOutput = fullText;
          runtime.outputSections = splitOutputSections(fullText);
          patchRunEvent(record, draftEvent.id, {
            details: {
              note: `正在第 ${meta.passIndex != null ? meta.passIndex + 1 : 1} 轮生成正文。`,
              generatedText: fullText,
              sections: runtime.outputSections
            }
          });
        },
        onReview: (review) => {
          emitRunEvent(record, {
            message: review.publicSummary,
            phase: "Review",
            details: {
              metrics: [
                { label: "轮次", value: `第 ${review.passIndex + 1} 轮` },
                { label: "累计长度", value: `${review.generatedTokens || 0} tok` },
                { label: "停止原因", value: review.stopReason || "正常结束" },
                { label: "结束标记", value: review.marker || "无" },
                { label: "结构片段", value: `${review.heuristicReview?.metrics?.sectionCount || 0}` }
              ],
              items: review.issues?.length ? review.issues : [],
              note: review.needsContinuation
                ? `自检判断仍需续写。${review.continuationHint || ""}`.trim()
                : `自检判断正文已完整。${review.continuationHint || ""}`.trim()
            }
          });
        },
        onCheckpoint: (checkpoint, checkpoints) => {
          runtime.checkpoints = checkpoints;
          runtime.resumeState = checkpoint.resumeState;
          patchRunEvent(record, draftEvent.id, {
            details: {
              checkpoints,
              sections: checkpoint.sections
            }
          });
        }
      }
    });
    runtime.latestOutput = result.output;
    runtime.checkpoints = result.checkpoints || runtime.checkpoints;
    runtime.outputSections = result.outputSections || runtime.outputSections;
    runtime.resumeState = result.resumeState || runtime.resumeState;
    patchRunEvent(record, draftEvent.id, {
      details: {
        note: `生成完成，共续写 ${result.continuationCount || 0} 次，最终约 ${estimateTokenCount(result.output || "")} tokens。`,
        generatedText: result.output,
        checkpoints: runtime.checkpoints,
        sections: runtime.outputSections
      }
    });
    emitRunEvent(record, { phase: "Output", message: result.output });
    finishRun(record, {
      runId: record.id,
      status: "result",
      action,
      context: serializeContextForClient(promptPack.preparedFiles),
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
      targets: targetStatuses,
      artifacts: buildArtifactsFromResult(targetPlan, result.output),
      checkpoints: runtime.checkpoints,
      outputSections: runtime.outputSections,
      resumeState: runtime.resumeState,
      resumeAvailable: Boolean(runtime.resumeState?.accumulatedOutput)
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
        output: runtime.latestOutput || "",
        usedModel: false,
        modelUnavailable: false,
        targets: targetStatuses,
        error: "本次请求已取消。",
        checkpoints: runtime.checkpoints,
        outputSections: runtime.outputSections,
        resumeState: currentResumeState(),
        resumeAvailable: Boolean(currentResumeState()?.accumulatedOutput)
      });
      return;
    }
    emitRunEvent(record, {
      phase: "Review",
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
        context: serializeContextForClient(promptPack.preparedFiles),
        missing,
      events: record.events,
      output: runtime.latestOutput || output,
      usedModel: false,
      modelUnavailable: Boolean(modelHealth.lastError),
      targets: targetStatuses,
      error: error.message,
      checkpoints: runtime.checkpoints,
      outputSections: runtime.outputSections,
      resumeState: currentResumeState(),
      resumeAvailable: Boolean(currentResumeState()?.accumulatedOutput)
    });
  }
}

function reflectionMessage(result) {
  if (result.usedModel) return result.review?.publicSummary || "已调用配置模型，结果已生成，确认后可直接写入目标文件。";
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
  const created = [];
  const overwritten = [];
  const unchanged = [];
  for (const artifact of artifacts) {
    const repoPath = String(artifact.path || "");
    if (!repoPath) throw httpError(400, "Artifact path is required");
    if (repoPath.includes("/archive/")) throw httpError(403, "Archive paths are disabled");
    if (!repoPath.startsWith("company/") && !repoPath.startsWith("books/")) {
      throw httpError(403, `Invalid artifact target: ${repoPath}`);
    }
    const absPath = safeJoinRepo(repoPath);
    const existedBefore = await exists(absPath);
    const previousContent = existedBefore ? await readFile(absPath, "utf8") : null;
    const nextContent = String(artifact.content || "");
    await mkdir(path.dirname(absPath), { recursive: true });
    await writeFile(absPath, nextContent, "utf8");
    written.push(repoPath);
    if (!existedBefore) {
      created.push(repoPath);
    } else if (previousContent === nextContent) {
      unchanged.push(repoPath);
    } else {
      overwritten.push(repoPath);
    }
  }
  const projectRoots = [...new Set(written.filter((item) => item.startsWith("books/")).map((item) => item.split("/").slice(0, 2).join("/")))];
  return {
    ok: true,
    written,
    created,
    overwritten,
    unchanged,
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
  if (req.method === "POST" && pathname === "/api/action-plan") {
    const payload = await readRequestBody(req);
    return sendJson(res, await buildActionPlan(payload));
  }
  if (req.method === "POST" && pathname === "/api/context/resolve") {
    const payload = await readRequestBody(req);
    const resolved = await resolveContextForPayload(payload.actionId, payload);
    const promptPack = preparePromptContext(resolved.action, resolved.context, payload.input || {}, resolved.targetPlan);
    return sendJson(res, {
      ...resolved,
      context: serializeContextForClient(promptPack.preparedFiles),
      targetStatuses: await readTargetStatuses(resolved.targetPlan.targets || []),
      budget: promptPack.budget,
      promptPreview: promptPack.preview
    });
  }
  if (req.method === "POST" && pathname === "/api/actions/start") {
    const payload = await readRequestBody(req);
    const record = createRunRecord(payload);
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
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    res.flushHeaders?.();
    res.write(": stream-open\n\n");
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
    const keepAlive = setInterval(() => {
      res.write(": ping\n\n");
    }, 15000);
    req.on("close", () => {
      clearInterval(keepAlive);
      run.listeners.delete(res);
    });
    startRunRecord(run);
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
