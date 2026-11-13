# docs/engineering/

工程实践规则目录。

本目录记录“如何建设这个项目”的长期方法，不替代 `docs/design/` 的产品与系统设计，也不替代 `tasks/` 的执行日志。

本项目画像按既有文档 SSOT 手动接入 AIEF Project Operating Context v1；不生成 AIEF 默认 `context/` 知识树。

| 文档 | 角色 |
|---|---|
| [project-operating-profile.yaml](project-operating-profile.yaml) | 项目身份、生命周期、发布状态、责任约束与事实来源的唯一画像；遵循 [AIEF Project Operating Context v1](https://github.com/tongsh6/ai-engineering-framework/blob/main/docs/standards/patterns/project-operating-context.md) 与 [Profile Schema](https://github.com/tongsh6/ai-engineering-framework/blob/main/docs/standards/schemas/project-profile.schema.json) |
| `architecture-operating-system.md` | 工程操作系统蓝图：原则、DAG、深模块、性能、前沿建模与阶段规划 |
| `vertical-slice.md` | 承重竖切面试行规则 |
| `architecture-guardrails.md` | 技术架构护栏：把当前主链、umbrella 边界和可复用工程经验落成实现前规则 |
| `quality-gates.md` | 质量门禁护栏：收口工程门禁、slice 门禁、小说质量门禁和 trace / replay 证明 |

## 项目画像专项校验

[Project Operating Context 工作流](../../.github/workflows/project-operating-context.yml) 固定 AIEF 检查器到不可变 commit，直接校验本仓库的真实画像和入口；不复制另一份 Schema 或画像，不运行 Retrofit，不新建 `context/`。升级检查器须显式更新工作流中的 `AIEF_REVISION` 并重新验收。

本地复跑：在项目之外准备上述工作流固定版本的 AIEF 源码，安装其 canonical package 依赖；从本仓库根目录执行：

```sh
node /path/to/AIEF/packages/ai-engineering-framework-init/bin/aief-init.mjs doctor \
  --profile-only --profile-path docs/engineering/project-operating-profile.yaml --json
```

使用支持该选项的固定源码版本，不假设 npm `latest` 已发布。专项模式的 `scope=profile` 只证明 YAML/Schema、来源声明及确定性语义检查；人工确认的真实性、AI 实际是否消费画像、模型工程决策效果和全仓 CI 必须分别取证。unknown 警告不会被改写为已确认事实。

执行状态、验收证据和剩余工作见[画像接入任务](../../tasks/2026-11-13-project-operating-context-adoption.md)，不在本索引维护第二份状态。
