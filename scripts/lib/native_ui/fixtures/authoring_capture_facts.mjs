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
