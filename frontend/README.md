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
pnpm test:slice-verify   # 外部验收脚本自测（slice-verify/*.test.mjs），不启动浏览器/后端/原生窗口
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

## 会话运行事件恢复（46 §9.9 / B87 R03）

- [agentRunTimeline.ts](src/lib/agentRunTimeline.ts)：同一运行事件的形状、身份合并、按 run 选择与作者面纯投影；HTTP activity 和 WS 都进入 WorkspaceChat 现有 agentEvents，TurnResult 不保存事件副本。
- [WorkspaceChat.agentRunActivityHydration.test.tsx](src/components/WorkspaceChat.agentRunActivityHydration.test.tsx)：父回合查询与 activity/旧 ACK 交错、事件身份、跨 run 隔离、终态不回退的纯机制测试。原生重启/原文导航证据仍由外部 request-cost driver 给出。

## 只读 Markdown 与流式接管（ADR-0036 / 46 §9.5）

- [MarkdownText.tsx](src/components/MarkdownText.tsx)：助手讨论/过程叙事的唯一只读渲染与安全边界；不改变保存原文，不解析作者输入或小说正文。
- [MarkdownText.module.css](src/components/MarkdownText.module.css)：文档流排版、代码与表格局部滚动，沿用现有 token。
- [MarkdownText.test.tsx](src/components/MarkdownText.test.tsx)：中文强调、结构、安全 URL/HTML/外图与非生成状态的独立反例。
- [WorkspaceChat.agentRunTimeline.test.tsx](src/components/WorkspaceChat.agentRunTimeline.test.tsx)：已有来源接管、跨调用/运行隔离、独立过程与流式字节；不是原生页面验收替代。
- [WorkspaceChat.authorQuestionOwnership.test.tsx](src/components/WorkspaceChat.authorQuestionOwnership.test.tsx)：真实工作台组合的提问唯一正文、Markdown、历史状态、流式接管、身份与底部操作边界；不以文本去重替代语义责任，不替代原生验收。
