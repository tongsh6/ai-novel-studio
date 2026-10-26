# AI Novel Studio Frontend

This frontend is part of the AI Novel Studio Tauri desktop application.

## Run

```bash
pnpm tauri dev
```

## Local checks

```bash
pnpm format:check
pnpm typecheck
pnpm lint
pnpm test
pnpm check
pnpm build
pnpm tauri build
```

## Scenario acceptance

外部驱动与证据验证文件索引见 [slice-verify/README.md](slice-verify/README.md)。浏览器交互与原生系统 UI 证据分别标记，启动 Tauri 进程本身不构成原生交互证明。

```bash
bash ../scripts/quality_accept.sh --list
bash ../scripts/quality_accept.sh --tier pr-smoke
bash ../scripts/quality_accept.sh au03-context-source-ui --surface tauri
```

## Rules

- Desktop-first: do not assume browser-only runtime.
- Use `frontend/src/lib/env.ts` for platform/environment abstraction.
- Do not add acceptance-only DOM hooks.
- Do not add `data-testid` for scenario acceptance.
- Prefer visible semantics: role, label, placeholder, button text, visible page text.
- User-visible copy belongs in `frontend/src/lib/copy.ts`.
- UI components must keep design trace headers when required by project rules.

## B26 / B27 共享入口

- [AuthorQuestionReply.tsx](src/components/AuthorQuestionReply.tsx)：单调用共同任务、明确问题来源与持久回复链的实现/验证；契约见 UA-01 §2.2 与 VS-00D §11。


## B28 分段预览

- [UICards.tsx](src/components/UICards.tsx)：candidate_set 中区分模型方案说明与计算出的排版预览。
- [UICards.formattingPlan.test.tsx](src/components/UICards.formattingPlan.test.tsx)：预览独立、换行可见与模型说明保真。


## 阅读投影查询

- [readingProjectionQuery.ts](src/lib/readingProjectionQuery.ts)：ADR-0016只读查询、整组成功/失败与作品级缓存；采纳hint仅失效查询。
- [readingProjectionQuery.test.ts](src/lib/__tests__/readingProjectionQuery.test.ts)：刷新新正文、失败不冒充完整结果、空历史scene不进入阅读。
