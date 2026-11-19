// B71 capture 证据族纯事实 owner：批次身份、作者可见目标与冻结消息只作为内存数据。
// 真实 12 表 SQLite 批次模板在 `authoring_capture_io_fixture.mjs`；本模块不 import
// fs/os/path、不建目录/DB、不 import 被测 SUT，也不读取环境批次。
export const WORK = "22222222-2222-4222-8222-222222222222";
export const SESSION = "88888888-8888-4888-8888-888888888888";
export const CHAPTER = "77777777-7777-4777-8777-777777777777";
export const AT = "2026-11-02T06:14:42.000000Z";

export const DEFAULT_LIVE_MESSAGE =
  "先看看第01章现在的设定和正文，再按现有设定写一段更紧张的开场：主角在雨夜收到一封没有署名的信，生成待采纳的候选，先不要保存。";

export const G2_MESSAGE =
  "请先读第02章《灰烬中的手印》已经保存的正文，前后都核对一下，再把发现的重复写法改成一段候选给我看，先不要保存。";

export const G3_MESSAGE = "我想先安静读一遍第02章已经保存的正文，只核对，不改也不保存。";

export const G2_VISIBLE_TARGET = Object.freeze({
  work_title: "灰烬手印验证作品",
  chapter_title: "灰烬中的手印",
  reading_excerpt: "井底浮现第七枚手印",
});

export const LIVE_MODEL = process.env.B71_STRATA_MODEL || "iq3_s";

export const R05_BUDGET = Object.freeze({
  batches: 1, author_sends: 1, manual_retries: 0, scenario_seconds: 900,
  input_timeout_ms: 120000, turn_timeout_ms: 360000,
});

const R05_FULL_READ_TARGET = Object.freeze({
  work_title: "灰烬手印验证作品",
  chapter_title: "第2章：灰烬中的手印",
  reading_excerpt: "末页锚点：井底浮现第七枚手印",
});

// 独立冻结的作者目标；不导入生产场景表生成期望。
export const R05_CASES = Object.freeze([
  {
    id: "b87-r05-chapter-count", mode: "read_only",
    seed_script: "scripts/seed_judgment_explore_chapter_full_read.exs",
    message: "这部作品目前一共有多少章？有正文和还没写正文的各几章？只告诉我这三个数量。",
    target: R05_FULL_READ_TARGET,
  },
  {
    id: "b87-r05-quality", mode: "read_only",
    seed_script: "scripts/seed_au11_quality_diagnosis_message_envelope.exs",
    message: "请先阅读第01章《灵源账单》已经保存的正文，再判断主角的胜利来得是否太容易，指出依据和可改方向。只分析，不生成修订候选，也不要保存。",
    target: { work_title: "灵源纪元", chapter_title: "第01章：灵源账单",
      reading_excerpt: "而妹妹的名字，正写在矿井最深处那面显示屏的最上面一行。" },
  },
  {
    id: "b87-r05-whole-chapter", mode: "candidate",
    seed_script: "scripts/seed_judgment_explore_chapter_full_read.exs",
    message: "请先把第02章《灰烬中的手印》已保存的正文从头到尾读完，再给我一份整章修订候选，减少重复描写，保留开头和结尾的线索；先不要保存。",
    target: R05_FULL_READ_TARGET,
  },
  {
    id: "b87-r05-style-material", mode: "candidate",
    seed_script: "scripts/seed_ca04_carry_gaps.exs",
    message: "请先查看本作品已经确认的风格规则，并阅读第01章《黑市对账夜》已保存的正文。据此把这一章改写成一份修订候选，突出人物之间的试探；先不要保存。",
    target: { work_title: "CA04 携带缺口验收作品", chapter_title: "第01章：黑市对账夜",
      reading_excerpt: "巡检的脚步声从巷口传来，他把账牌收进袖中。" },
  },
]);
