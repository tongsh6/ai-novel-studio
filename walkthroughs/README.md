# 产品体验走查 / Product Walkthroughs

## 目标

在真实环境下验证产品的端到端用户体验，发现工程测试无法覆盖的问题：

- **交互完整性**：用户操作 → 系统响应 → UI 渲染是否闭环
- **语义正确性**：AI 回复是否符合当前上下文和对话阶段
- **边界行为**：异常输入、快速连续操作、长时间等待时的表现
- **信息架构**：关键信息（状态、候选、档案）是否正确呈现

工程门禁（`mix test`、`pnpm typecheck`）验证代码正确性；走查验证产品可用性。

## 设计原则

| 原则 | 说明 |
|------|------|
| **真实环境** | 真实 LLM + 真实 DB + 真实浏览器渲染，模拟实际创作场景 |
| **完整链路** | 从用户输入到 UI 渲染全流程，不跳过任何环节 |
| **可复现** | 每次走查有明确的输入序列、环境描述和结果记录 |
| **自动化优先** | 通过 Playwright 驱动 GUI 操作，人工仅做判断和记录 |
| **关键路径优先** | 先覆盖核心创作流程，再扩展到边缘场景 |

## 自动化要求

走查必须基于 **GUI 自动化**，不允许纯后端 API 调用模拟。

| 要求 | 说明 |
|------|------|
| **GUI 交互** | Playwright 操作真实浏览器：fill input → click button → wait response |
| **真实 LLM** | 走查期间 LM Studio 必须运行并加载模型 |
| **截图证据** | 每个关键步骤 Playwright 自动截图，嵌入报告 |
| **耗时记录** | 记录每个步骤的 LLM 响应时间 |
| **可脚本复现** | 每次走查路线对应一个可执行的 Playwright 脚本 |

自动化脚本模板：`scripts/walkthrough_template.ts`

## 走查路线

### 路线 A：首次创作（30 min）
```
A1. 起项目 → "我想写一部赛博朋克小说"
A2. 探索方向 → 验证 Candidate cards 渲染
A3. 选择方向 → 验证 adoption 流程
A4. 生成角色 → 验证 creative artifact 产出
A5. 写开头 → 验证正文生成
A6. 回看 replay → 验证 trace 可追溯
```

### 路线 B：多轮对话（20 min）
```
B1. 建立上下文 → 连续 3 轮同主题对话
B2. 检查上下文引用 → AI 是否引用前文
B3. 切换主题 → AI 是否合理过渡
B4. 错误恢复 → 输入乱码或无意义内容
```

### 路线 C：边界测试（15 min）
```
C1. 空输入 / 超长输入
C2. 快速连续发送
C3. 断网恢复
C4. LLM 不可用时的降级表现
```

## 目录结构

```
walkthroughs/
  README.md                    ← 本文件
  YYYY-MM-DD/
    REPORT.md                  ← 走查报告
    screenshot-*.png           ← 关键截图
```

## 报告格式

每次走查的 `REPORT.md` 必须包含：

```markdown
# 产品体验走查报告

日期：YYYY-MM-DD
走查人：
环境：
  模型：qwen/qwen3.5-122b-a10b
  LM Studio：localhost:1234
  Phoenix：localhost:4657
  启动方式：bash scripts/dev.sh --web

## 走查路线
A1 → A2 → A3（实际执行的路线）

## 结果摘要
- 通过：X 项
- 失败：Y 项  
- 发现问题：Z 个

## 逐项记录

### A1：起项目
- 输入："我想写一部赛博朋克小说"
- 预期：AI 回应探索方向，展示候选卡片
- 实际：[通过/失败]
- 耗时：Xs
- 截图：screenshot-a1.png
- 备注：[观察到的任何问题]

### A2：...
...

## 发现的问题
| # | 严重 | 问题 | 复现条件 |
|---|------|------|---------|
| 1 | P1  | Candidate cards 不渲染 | 每次 |

## 结论
[整体评估，是否建议发布/继续开发]
```

## 与 smoketest 的关系

| | smoke test | walkthrough |
|------|-----------|------------|
| 目的 | 工程健康检查 | 产品体验验证 |
| 方式 | `bash scripts/smoke_test.sh` | Playwright 脚本 + 人工判断 |
| 依赖 | 无需 LLM | 需要 LM Studio 运行真实模型 |
| 频率 | 每次 push | 每次 release / 大改动后 |
| 产出 | PASS/FAIL | 自动截图 + 报告 + 问题清单 |

## 走查脚本示例

```typescript
// walkthroughs/2026-05-09/route-a.ts
// 路线 A：首次创作。用法：npx tsx walkthroughs/2026-05-09/route-a.ts

import { chromium } from "playwright";

const BASE = "http://localhost:5768";

async function step(page, name: string, msg: string) {
  console.log(`\n[${name}] 输入: ${msg}`);
  const input = page.locator("input, textarea").first();
  await input.fill(msg);
  await page.locator("button").filter({ hasText: "发送" }).click();

  // 等 AI 回复
  await page.waitForTimeout(2000);
  
  // 截图
  await page.screenshot({ path: `${name}.png`, fullPage: true });
  console.log(`  ✅ 截图: ${name}.png`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(BASE);

  await step(page, "A1-起项目", "我想写一部赛博朋克小说");
  await step(page, "A2-探索方向", "帮我想想可以怎么切入");
  await step(page, "A3-生成角色", "帮我设计一个主角");

  await browser.close();
  console.log("\n✅ 路线 A 完成");
})();
```
