// B71 memory-detail 证据族的纯事实 owner：只提供内存中的作者可见文本与固定时间，
// 不创建目录、文件、DB 或子进程。真实合成证据目录在
// `authoring_memory_detail_io_fixture.mjs`；纯 D1–D8 判定测试与 IO/端到端测试共享同一组
// 干净文本，避免各自复制期望。
export const CLEAN_LIST_TEXT =
  "记忆管理\n新建记忆\n搜索记忆...\n内容 类型 范围 状态 召回 锁定\n" +
  "陈九斤守着雨港旧灯楼，账页上记着一笔不能公开的旧账。 世界观规则 整部作品 已确认 召回 否\n" +
  "井底回声在雷雨夜出现，与上一笔欠款有关。 伏笔 整部作品 已确认 召回 否\n";

export const CLEAN_DETAIL_TEXT =
  "记忆详情\n已确认\n世界观规则\n整部作品\n摘要\n灯楼旧账\n治理信息\n权重: 1\n来源类型: 作者创建\n" +
  "创建: 2026-11-04 10:00\n更新: 2026-11-04 10:00\n引用记录\n暂无引用\n";

// 固定为历史批次时刻：截图 mtime 必然晚于它，规格在 run 内也保持稳定。
export const MEMORY_READY_AT = "2026-11-04T09:00:00.000Z";
export const MEMORY_WAIT_BASE = Date.parse("2026-11-04T09:59:00.000Z");
export const MEMORY_ENDED_AT = "2026-11-04T10:00:10.000Z";
export const MEMORY_SCREENSHOTS = Object.freeze(["01-workbench.jpg", "memory-detail.jpg"]);

export function png() {
  return Buffer.from("89504e470d0a1a0a", "hex");
}
