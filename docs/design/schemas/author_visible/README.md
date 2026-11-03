# author_visible — 作者可见展示名 SSOT

- 索引：本目录只存放「作者可见展示名」数据文件，不是 JSON Schema 类型文件；`frontend/scripts/codegen-schemas.mjs` 会跳过本目录。
- 真源：`display_names.json`
  - `domains`：tool / capability / status / run_status / provider / model / artifact_type / action / error_code / frame_type / reason_code / gate 的 code → 作者可读显示名；
  - `fallbacks`：每个 domain 的作者安全兜底文案（未登记 code 只返回兜底，绝不展示内部 code）；
  - `enum_sources`：登记为作者可见的 enum 源（缺值会让 codegen 失败）；
  - `forbidden_tokens`：作者可见面禁止出现的 token 清单 + 白名单（默认零例外）。
- 生成物（不要手改）：
  - 前端：`frontend/src/generated/author_visible/displayNames.ts`（`pnpm codegen:author-visible`）
  - 后端：`apps/novel_common/lib/novel_common/author_visible/display_names_gen.ex`（`mix codegen.author_visible`）
  - 两端写同一 `source_hash`；`mix codegen.author_visible --check` 同时校验漂移与双端一致。
- 消费入口：`NovelCommon.AuthorVisible.Display`（后端查询）、`NovelApplication.AuthorVisible.Presenter`（作者可见投影）、`frontend/src/lib/authorVisible.ts`（前端转换）。
- 新增内部 code（工具/状态/provider/model/artifact_type/action/error/frame）时只改本文件 `domains` 与（必要时）`enum_sources`，再跑两个生成器；不要在各调用点新增局部映射表。
